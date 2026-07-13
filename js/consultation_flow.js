(function (root, factory) {
    const built = factory(root);
    const api = built.api;
    if (typeof module === 'object' && module.exports) {
        module.exports = { ...api, setDraftForTest: built.setDraftForTest };
    }
    root.ConsultationFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
    'use strict';

    const PHASES = [
        'choosing_type',
        'editing_details',
        'choosing_spread_source',
        'choosing_interpretation',
        'acquiring_cards',
        'confirming',
        'saving',
        'saved',
        'generating',
        'review_ready',
        'review_saved'
    ];

    const PUBLIC_STEPS = Object.freeze({
        choosing_type: Object.freeze({ index: 1, label: '选择咨询类型' }),
        editing_details: Object.freeze({ index: 2, label: '填写咨询信息' }),
        choosing_spread_source: Object.freeze({ index: 3, label: '选择牌阵与取牌方式' }),
        choosing_interpretation: Object.freeze({ index: 4, label: '选择解读方式' }),
        acquiring_cards: Object.freeze({ index: 5, label: '录入牌面' }),
        confirming: Object.freeze({ index: 6, label: '确认本次咨询' }),
        saving: Object.freeze({ index: 6, label: '确认本次咨询' }),
        saved: Object.freeze({ index: 7, label: '结果与审核' }),
        generating: Object.freeze({ index: 7, label: '结果与审核' }),
        review_ready: Object.freeze({ index: 7, label: '结果与审核' }),
        review_saved: Object.freeze({ index: 7, label: '结果与审核' })
    });

    function getPublicStep(internalPhase, currentDraft = {}) {
        const fallback = PUBLIC_STEPS.choosing_type;
        const current = PUBLIC_STEPS[internalPhase] || fallback;
        const label = internalPhase === 'acquiring_cards' && currentDraft.inputMode === 'three_d'
            ? '抽取牌面'
            : current.label;
        return { index: current.index, total: 7, label };
    }

    let draft = createInitialDraft();
    let phase = 'choosing_type';
    let modules = [];
    let saved = null;
    let generated = null;
    let streamContent = '';
    let mounted = false;
    let returnFocus = null;
    let abortController = null;
    let flowEpoch = 0;
    let acquiredCardsSavePromise = null;
    let fieldSequence = 0;

    function createInitialDraft() {
        return {
            questionMode: 'none',
            moduleType: null,
            userQuery: '',
            userContext: '',
            modulePayload: {},
            cards: [],
            templateKey: 'three_timeline',
            templateName: '三张牌 / Past Present Future',
            freeCount: 3,
            inputMode: 'three_d',
            interpretationAction: 'none',
            style: 'psychological',
            language: 'zh',
            spreadNumber: 0
        };
    }

    function searchDeck(deck, query, limit = 12) {
        const normalizedQuery = String(query == null ? '' : query).trim();
        if (!normalizedQuery) return [];

        const numericQuery = /^\d+$/.test(normalizedQuery)
            ? Number(normalizedQuery)
            : null;
        const englishQuery = normalizedQuery.toLowerCase();
        const numericLimit = Number(limit);
        const resultLimit = Number.isFinite(numericLimit)
            ? Math.max(1, Math.trunc(numericLimit))
            : 12;

        return (Array.isArray(deck) ? deck : [])
            .map((card, cardId) => ({ ...card, cardId }))
            .filter(card => (
                numericQuery === null
                    ? String(card.zh || '').includes(normalizedQuery)
                        || String(card.en || '').toLowerCase().includes(englishQuery)
                    : card.cardId === numericQuery
            ))
            .slice(0, resultLimit);
    }

    function getSlotPlan(template, freeCount) {
        const currentTemplate = template || {};
        const fixedCount = Number.isFinite(currentTemplate.fixedCount)
            ? currentTemplate.fixedCount
            : null;
        const requestedCount = Number(freeCount);
        const count = fixedCount === null
            ? Math.min(10, Math.max(1, Number.isFinite(requestedCount) ? Math.trunc(requestedCount) : 3))
            : fixedCount;
        const slots = Array.isArray(currentTemplate.slots) ? currentTemplate.slots : [];

        return Array.from({ length: count }, (_, index) => {
            const definedSlot = slots[index] || {};
            const slot = Number.isFinite(definedSlot.slot) ? definedSlot.slot : index + 1;
            return {
                slot,
                slotLabel: definedSlot.label || `Slot ${slot}`
            };
        });
    }

    function getModuleFieldValue(currentDraft, fieldSpec) {
        const key = typeof fieldSpec === 'string' ? fieldSpec : fieldSpec && fieldSpec.key;
        if (!key) return '';
        if (key === 'userQuery' || key === 'userContext') {
            return String((currentDraft && currentDraft[key]) || '');
        }
        return String(
            (currentDraft && currentDraft.modulePayload && currentDraft.modulePayload[key]) || ''
        );
    }

    function setModuleFieldValue(currentDraft, fieldSpec, value) {
        const key = typeof fieldSpec === 'string' ? fieldSpec : fieldSpec && fieldSpec.key;
        const next = {
            ...(currentDraft || {}),
            modulePayload: { ...((currentDraft && currentDraft.modulePayload) || {}) }
        };
        if (!key) return next;
        if (key === 'userQuery' || key === 'userContext') {
            next[key] = String(value == null ? '' : value);
        } else {
            next.modulePayload[key] = String(value == null ? '' : value);
        }
        return next;
    }

    function validateModuleDetails(moduleSpec, currentDraft) {
        const errors = {};
        const fields = moduleSpec && Array.isArray(moduleSpec.inputFields)
            ? moduleSpec.inputFields
            : [];
        fields.forEach(fieldSpec => {
            const key = fieldSpec.key;
            const value = getModuleFieldValue(currentDraft, fieldSpec).trim();
            const label = fieldSpec.label || key;
            if (fieldSpec.required && !value) {
                errors[key] = `请填写${label}`;
                return;
            }
            const maxLength = Number(fieldSpec.maxLength);
            if (Number.isFinite(maxLength) && value.length > maxLength) {
                errors[key] = `${label}不能超过 ${maxLength} 个字符`;
            }
        });

        if (moduleSpec && moduleSpec.moduleType === 'choice_compare') {
            const optionA = getModuleFieldValue(currentDraft, 'optionA').trim();
            const optionB = getModuleFieldValue(currentDraft, 'optionB').trim();
            if (
                optionA
                && optionB
                && optionA.localeCompare(optionB, undefined, { sensitivity: 'accent' }) === 0
            ) {
                errors.optionB = '两个选项不能相同';
            }
        }
        return errors;
    }

    function validateDraft(draft, moduleSpec, options = {}) {
        const currentDraft = draft || {};
        const errors = {};
        const questionModes = ['none', 'module'];
        const inputModes = ['manual', 'three_d'];
        const interpretationActions = ['none', 'now', 'later'];

        if (!questionModes.includes(currentDraft.questionMode)) {
            errors.questionMode = '请选择有效的咨询类型';
        }
        if (!inputModes.includes(currentDraft.inputMode)) {
            errors.inputMode = '请选择有效的抽牌方式';
        }
        if (!interpretationActions.includes(currentDraft.interpretationAction)) {
            errors.interpretationAction = '请选择有效的解读方式';
        }

        if (currentDraft.questionMode === 'module') {
            if (
                !moduleSpec
                || !currentDraft.moduleType
                || currentDraft.moduleType !== moduleSpec.moduleType
            ) {
                errors.moduleType = '请选择有效的咨询模块';
            }

            if (
                moduleSpec
                && Array.isArray(moduleSpec.allowedSpreads)
                && !moduleSpec.allowedSpreads.includes(currentDraft.templateKey)
            ) {
                errors.templateKey = '当前咨询模块不支持这个牌阵';
            }

            if (moduleSpec) {
                Object.assign(errors, validateModuleDetails(moduleSpec, currentDraft));
            }

            const queryLength = String(currentDraft.userQuery || '').trim().length;
            if (moduleSpec && moduleSpec.questionRequired && queryLength < 4) {
                errors.userQuery = '问题长度需为 4 到 500 个字符';
            }
        }

        const cards = currentDraft.cards;
        if (!Array.isArray(cards)) {
            if (options.requireCards || cards != null) {
                errors.cards = '牌阵数据无效';
            }
            return errors;
        }
        if (options.requireCards && cards.length === 0) {
            errors.cards = '请至少选择一张牌';
            return errors;
        }
        if (cards.length === 0) return errors;

        const cardIds = cards.map(card => card && card.cardId);
        if (new Set(cardIds).size !== cardIds.length) {
            errors.cards = '牌阵中不能重复选择同一张牌';
            return errors;
        }
        if (cards.some(card => !card || !Number.isInteger(card.cardId) || card.cardId < 0 || card.cardId > 77)) {
            errors.cards = '牌阵中包含无效的牌';
            return errors;
        }
        if (cards.some(card => typeof card.isReversed !== 'boolean')) {
            errors.cards = '牌的正逆位必须为布尔值';
        }

        return errors;
    }

    function materializeCards(cards, deck) {
        return (Array.isArray(cards) ? cards : []).map(card => {
            const source = deck && deck[card.cardId];
            if (!source) {
                throw new Error(`Unknown cardId ${card.cardId}`);
            }
            return {
                slot: card.slot,
                slotLabel: card.slotLabel,
                cardId: card.cardId,
                zh: source.zh,
                en: source.en,
                imageFile: source.file,
                isReversed: card.isReversed
            };
        });
    }

    function buildReadingPayload(draft, deck) {
        const numericSpread = Number(draft && draft.spreadNumber);
        return {
            kind: 'spread',
            spreadNumber: Number.isFinite(numericSpread) ? numericSpread : 0,
            templateKey: draft && draft.templateKey,
            templateName: draft && draft.templateName,
            cards: materializeCards(draft && draft.cards, deck)
        };
    }

    function buildConsultationPayload(draft, deck, moduleSpec = null) {
        const rawModulePayload = (draft && draft.modulePayload) || {};
        const allowedPayloadKeys = moduleSpec && Array.isArray(moduleSpec.inputFields)
            ? new Set(
                moduleSpec.inputFields
                    .map(fieldSpec => fieldSpec.key)
                    .filter(key => key !== 'userQuery' && key !== 'userContext')
            )
            : null;
        const modulePayload = Object.fromEntries(
            Object.entries(rawModulePayload)
                .filter(([key, value]) => (
                    (!allowedPayloadKeys || allowedPayloadKeys.has(key))
                    && String(value == null ? '' : value).trim()
                ))
                .map(([key, value]) => [key, String(value).trim()])
        );
        return {
            ...buildReadingPayload(draft, deck),
            language: 'zh',
            moduleType: draft && draft.moduleType,
            inputMode: draft && draft.inputMode,
            userQuery: String((draft && draft.userQuery) || '').trim(),
            userContext: String((draft && draft.userContext) || '').trim(),
            modulePayload
        };
    }

    function chooseSaveOperation(draft) {
        return draft && draft.questionMode === 'module' ? 'consultation' : 'reading';
    }

    async function persistDraftCards(draft, cards, deps) {
        const clonedCards = (Array.isArray(cards) ? cards : [])
            .map(card => ({ ...card }));
        const working = { ...(draft || {}), cards: clonedCards };
        const operation = chooseSaveOperation(working);

        if (operation === 'consultation') {
            const created = await deps.api.createConsultation(
                buildConsultationPayload(working, deps.deck, deps.moduleSpec || null)
            );
            return {
                consultationId: created.id,
                readingId: created.readingId,
                created,
                operation
            };
        }

        const created = await deps.api.createReading(
            buildReadingPayload(working, deps.deck)
        );
        return {
            consultationId: null,
            readingId: created.id,
            created,
            operation
        };
    }

    function compareInterpretationRecency(left, right) {
        const leftTime = Date.parse(left.created_at || left.createdAt || '') || 0;
        const rightTime = Date.parse(right.created_at || right.createdAt || '') || 0;
        if (leftTime !== rightTime) return leftTime - rightTime;

        const leftId = Number(left.id);
        const rightId = Number(right.id);
        return (Number.isFinite(leftId) ? leftId : 0)
            - (Number.isFinite(rightId) ? rightId : 0);
    }

    function selectLatestCompleteInterpretation(interpretations) {
        return (Array.isArray(interpretations) ? interpretations : [])
            .filter(item => item && item.generation_status === 'complete')
            .reduce((latest, item) => (
                latest === null || compareInterpretationRecency(item, latest) > 0
                    ? item
                    : latest
            ), null);
    }

    async function runSavedInterpretation(
        saved,
        draft,
        deps,
        onEvent = () => {},
        signal
    ) {
        let content = '';
        let sawDone = false;

        for await (const event of deps.streamInterpretation(saved.readingId, {
            style: draft.style,
            language: 'zh',
            signal
        })) {
            onEvent(event);
            if (event && event.error) {
                const error = new Error(event.message || String(event.error));
                error.code = event.error;
                throw error;
            }
            if (event && event.chunk != null) {
                content += String(event.chunk);
            }
            if (event && event.done) {
                sawDone = true;
                break;
            }
        }

        if (!sawDone) {
            throw new Error('Interpretation stream ended before done');
        }

        let interpretation = null;
        if (saved.consultationId != null) {
            const consultation = await deps.api.loadConsultation(
                saved.consultationId
            );
            interpretation = selectLatestCompleteInterpretation(
                consultation && consultation.interpretations
            );
        }

        return { content, done: true, interpretation };
    }

    function validateReview(review) {
        const currentReview = review || {};
        const verdict = String(currentReview.verdict || '');
        const allowedVerdicts = [
            'accepted',
            'needs_work',
            'rejected',
            'edited'
        ];
        const errors = {};
        if (!allowedVerdicts.includes(verdict)) {
            errors.verdict = '请选择审核结论';
        }

        const editedContent = String(currentReview.editedContent || '').trim();
        if (verdict === 'edited' && !editedContent) {
            errors.editedContent = '编辑后的理想答案不能为空';
        }

        if (
            currentReview.rating !== undefined
            && currentReview.rating !== null
            && currentReview.rating !== ''
        ) {
            const rating = Number(currentReview.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                errors.rating = '评分应为 1–5';
            }
        }

        return errors;
    }

    async function submitReview(interpretationId, review, deps) {
        const currentReview = review || {};
        const errors = validateReview(currentReview);
        const firstError = Object.values(errors)[0];
        if (firstError) throw new Error(firstError);

        const verdict = String(currentReview.verdict || '');
        const editedContent = String(currentReview.editedContent || '').trim();
        const rating = (
            currentReview.rating === undefined
            || currentReview.rating === null
            || currentReview.rating === ''
        ) ? null : Number(currentReview.rating);

        const payload = {
            verdict,
            rating,
            issueTags: Array.isArray(currentReview.issueTags)
                ? [...currentReview.issueTags]
                : [],
            reviewNote: String(currentReview.reviewNote || '').trim(),
            editedContent,
            privacyConfirmed: currentReview.privacyConfirmed === true
        };
        return deps.api.reviewInterpretation(interpretationId, payload);
    }

    function el(tag, attrs = {}, children = []) {
        const node = root.document.createElement(tag);
        Object.entries(attrs || {}).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            if (key === 'className') {
                node.className = value;
            } else if (key === 'textContent') {
                node.textContent = String(value);
            } else if (key === 'htmlFor') {
                node.htmlFor = value;
            } else if (key.startsWith('on') && typeof value === 'function') {
                node.addEventListener(key.slice(2).toLowerCase(), value);
            } else if (key === 'dataset') {
                Object.entries(value).forEach(([name, entry]) => {
                    node.dataset[name] = String(entry);
                });
            } else if (key in node) {
                node[key] = value;
            } else {
                node.setAttribute(key, String(value));
            }
        });
        const items = Array.isArray(children) ? children : [children];
        items.flat(Infinity).forEach(child => {
            if (child === undefined || child === null || child === false) return;
            node.append(child && child.nodeType ? child : String(child));
        });
        return node;
    }

    function getTemplate(key) {
        if (!root.SpreadTemplates) return null;
        return root.SpreadTemplates.getTemplate(key);
    }

    function getCurrentModuleSpec() {
        return modules.find(item => item.moduleType === draft.moduleType) || null;
    }

    function getTemplatesForDraft() {
        if (!root.SpreadTemplates) return [];
        const templates = root.SpreadTemplates.getTemplates();
        if (draft.questionMode !== 'module') return templates;
        const moduleSpec = getCurrentModuleSpec();
        const allowed = new Set(
            moduleSpec && Array.isArray(moduleSpec.allowedSpreads)
                ? moduleSpec.allowedSpreads
                : []
        );
        return templates.filter(template => allowed.has(template.key));
    }

    function setPhase(next) {
        phase = nextPhase(phase, next);
        render();
    }

    function actionButton(label, onClick, options = {}) {
        return el('button', {
            type: 'button',
            className: options.className || 'consultation-action',
            disabled: Boolean(options.disabled),
            'aria-pressed': options.ariaPressed,
            dataset: options.action ? { flowAction: options.action } : {},
            textContent: label,
            onClick
        });
    }

    function field(labelText, control, className = 'consultation-field') {
        const formTags = ['INPUT', 'SELECT', 'TEXTAREA'];
        const isFormControl = Boolean(control && formTags.includes(control.tagName));
        if (isFormControl && !control.id) {
            const hint = String(control.name || control.type || control.tagName)
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, '-');
            fieldSequence += 1;
            control.id = `consultation-${hint}-${fieldSequence}`;
        }
        return el('div', { className }, [
            el('label', {
                className: 'consultation-field-label',
                htmlFor: isFormControl ? control.id : undefined,
                textContent: labelText
            }),
            control
        ]);
    }

    function renderTypeStep(mountNode) {
        const choices = el('div', { className: 'consultation-choice-grid' });
        choices.append(actionButton('无特定问题 / Open Reading', () => {
            draft = {
                ...draft,
                questionMode: 'none',
                moduleType: null,
                userQuery: '',
                userContext: '',
                modulePayload: {}
            };
            setPhase('editing_details');
        }, { action: 'type-none' }));
        modules.forEach(moduleSpec => {
            choices.append(actionButton(
                moduleSpec.displayName || moduleSpec.moduleType,
                () => {
                    const defaultSpread = moduleSpec.defaultSpread || draft.templateKey;
                    if (draft.templateKey !== defaultSpread) draft.cards = [];
                    draft = {
                        ...draft,
                        questionMode: 'module',
                        moduleType: moduleSpec.moduleType,
                        templateKey: defaultSpread,
                        userQuery: '',
                        userContext: '',
                        modulePayload: {}
                    };
                    const template = getTemplate(draft.templateKey);
                    if (template) draft.templateName = template.name;
                    setPhase('editing_details');
                },
                { action: `type-${moduleSpec.moduleType}` }
            ));
        });
        mountNode.append(
            el('section', { className: 'consultation-step' }, [
                el('h3', { textContent: '选择咨询类型' }),
                el('p', { textContent: '从无特定问题的牌面观察开始，或选择一个结构化咨询模块。' }),
                choices
            ])
        );
    }

    function renderDetailsStep(mountNode, actionsNode) {
        const section = el('section', { className: 'consultation-step consultation-details' });
        section.append(el('h3', { textContent: '咨询细节' }));
        if (draft.questionMode === 'module') {
            const moduleSpec = getCurrentModuleSpec();
            const inputFields = moduleSpec && Array.isArray(moduleSpec.inputFields)
                ? moduleSpec.inputFields
                : [];
            inputFields.forEach(fieldSpec => {
                const tag = fieldSpec.type === 'textarea' ? 'textarea' : 'input';
                const control = el(tag, {
                    id: `consultation-module-${fieldSpec.key}`,
                    name: fieldSpec.key,
                    type: tag === 'input' ? (fieldSpec.type || 'text') : undefined,
                    value: getModuleFieldValue(draft, fieldSpec),
                    maxLength: Number(fieldSpec.maxLength) || undefined,
                    placeholder: fieldSpec.placeholder || '',
                    required: Boolean(fieldSpec.required),
                    rows: tag === 'textarea' ? 4 : undefined,
                    onInput: event => {
                        draft = setModuleFieldValue(draft, fieldSpec, event.target.value);
                    }
                });
                section.append(field(
                    `${fieldSpec.label || fieldSpec.key}${fieldSpec.required ? ' *' : ''}`,
                    control
                ));
            });
        } else {
            section.append(el('p', {
                className: 'consultation-muted',
                textContent: '本次不记录特定问题，将只保存牌阵和你的选择。'
            }));
        }
        const styleSelect = el('select', {
            name: 'style',
            value: draft.style,
            onChange: event => { draft.style = event.target.value; }
        }, [
            el('option', { value: 'psychological', textContent: '心理反思' }),
            el('option', { value: 'traditional', textContent: '传统牌义' }),
            el('option', { value: 'intuitive', textContent: '直觉象征 / Intuitive' })
        ]);
        styleSelect.value = draft.style;
        section.append(field('解读风格', styleSelect));
        mountNode.append(section);
        const advance = () => {
            if (draft.questionMode === 'module') {
                const moduleSpec = getCurrentModuleSpec();
                const errors = validateModuleDetails(moduleSpec, draft);
                if (moduleSpec && moduleSpec.questionRequired) {
                    const queryLength = getModuleFieldValue(draft, 'userQuery').trim().length;
                    if (queryLength > 0 && queryLength < 4) {
                        errors.userQuery = '问题长度至少需要 4 个字符';
                    }
                }
                const firstError = Object.entries(errors)[0];
                if (firstError) {
                    setStatus(firstError[1], true);
                    focusFlowNode(`consultation-module-${firstError[0]}`);
                    return;
                }
            }
            setStatus('', false);
            setPhase('choosing_spread_source');
        };
        actionsNode.append(
            actionButton('返回', () => setPhase('choosing_type')),
            actionButton('选择牌阵', advance, {
                className: 'consultation-primary',
                action: 'details-next'
            })
        );
    }

    function renderSpreadSourceStep(mountNode, actionsNode) {
        const section = el('section', { className: 'consultation-step' });
        section.append(el('h3', { textContent: '牌阵与取牌方式' }));
        const templateGrid = el('div', { className: 'consultation-choice-grid' });
        getTemplatesForDraft().forEach(template => {
            templateGrid.append(actionButton(template.name, () => {
                if (draft.templateKey !== template.key) draft.cards = [];
                draft.templateKey = template.key;
                draft.templateName = template.name;
                render();
            }, {
                className: template.key === draft.templateKey
                    ? 'consultation-choice is-selected'
                    : 'consultation-choice',
                ariaPressed: template.key === draft.templateKey,
                action: `spread-${template.key}`
            }));
        });
        section.append(templateGrid);
        const modes = el('div', { className: 'consultation-segmented' }, [
            actionButton('手动录入', () => {
                if (draft.inputMode !== 'manual') draft.cards = [];
                draft.inputMode = 'manual';
                render();
            }, {
                className: draft.inputMode === 'manual' ? 'is-selected' : '',
                ariaPressed: draft.inputMode === 'manual'
            }),
            actionButton('3D 抽牌', () => {
                if (draft.inputMode !== 'three_d') draft.cards = [];
                draft.inputMode = 'three_d';
                render();
            }, {
                className: draft.inputMode === 'three_d' ? 'is-selected' : '',
                ariaPressed: draft.inputMode === 'three_d'
            })
        ]);
        section.append(field('取牌方式', modes));
        if (draft.templateKey === 'free') {
            section.append(field('自由牌阵张数', el('input', {
                type: 'number',
                min: 1,
                max: 10,
                value: draft.freeCount,
                onInput: event => {
                    draft.freeCount = Math.min(10, Math.max(1, Number(event.target.value) || 1));
                    draft.cards = draft.cards.filter(card => card.slot <= draft.freeCount);
                }
            })));
        }
        mountNode.append(section);
        actionsNode.append(
            actionButton('返回', () => setPhase('editing_details')),
            actionButton('解读安排', () => setPhase('choosing_interpretation'), { className: 'consultation-primary' })
        );
    }

    function renderInterpretationStep(mountNode, actionsNode) {
        const section = el('section', { className: 'consultation-step' }, [
            el('h3', { textContent: '何时解读' })
        ]);
        const choices = el('div', { className: 'consultation-choice-grid' });
        [
            ['now', '保存后立即生成'],
            ['later', '稍后再生成'],
            ['none', '只保存牌阵']
        ].forEach(([value, label]) => {
            choices.append(actionButton(label, () => {
                draft.interpretationAction = value;
                render();
            }, {
                className: draft.interpretationAction === value
                    ? 'consultation-choice is-selected'
                    : 'consultation-choice',
                ariaPressed: draft.interpretationAction === value
            }));
        });
        section.append(choices);
        mountNode.append(section);
        actionsNode.append(
            actionButton('返回', () => setPhase('choosing_spread_source')),
            actionButton('开始取牌', () => {
                if (draft.inputMode === 'manual') {
                    setPhase('acquiring_cards');
                } else {
                    beginThreeD();
                }
            }, { className: 'consultation-primary' })
        );
    }

    function replaceCardAtSlot(slotPlan, card) {
        const remaining = draft.cards.filter(item => item.slot !== slotPlan.slot);
        draft.cards = [...remaining, {
            slot: slotPlan.slot,
            slotLabel: slotPlan.slotLabel,
            cardId: card.cardId,
            isReversed: false
        }].sort((left, right) => left.slot - right.slot);
        render();
    }

    function renderManualCardsStep(mountNode, actionsNode) {
        const template = getTemplate(draft.templateKey) || {};
        const slots = getSlotPlan(template, draft.freeCount);
        const grid = el('div', { className: 'consultation-card-grid' });
        slots.forEach(slotPlan => {
            const selected = draft.cards.find(card => card.slot === slotPlan.slot);
            const cardNode = el('article', { className: 'consultation-card-editor' }, [
                el('h4', { textContent: `${slotPlan.slot}. ${slotPlan.slotLabel}` })
            ]);
            if (selected) {
                const deckCard = getBrowserDeck()[selected.cardId];
                cardNode.append(el('p', {
                    className: 'consultation-selected-card',
                    textContent: deckCard
                        ? `${deckCard.zh} / ${deckCard.en}`
                        : `Card ${selected.cardId}`
                }));
                cardNode.append(el('div', { className: 'consultation-segmented' }, [
                    actionButton('正位', () => {
                        selected.isReversed = false;
                        render();
                    }, {
                        className: selected.isReversed ? '' : 'is-selected',
                        ariaPressed: !selected.isReversed
                    }),
                    actionButton('逆位', () => {
                        selected.isReversed = true;
                        render();
                    }, {
                        className: selected.isReversed ? 'is-selected' : '',
                        ariaPressed: selected.isReversed
                    })
                ]));
            }
            const results = el('div', { className: 'consultation-search-results' });
            const search = el('input', {
                type: 'search',
                placeholder: '输入中文、英文或牌号',
                ariaLabel: `搜索第 ${slotPlan.slot} 个位置的牌`,
                onInput: event => {
                    const used = new Set(
                        draft.cards
                            .filter(item => item.slot !== slotPlan.slot)
                            .map(item => item.cardId)
                    );
                    results.replaceChildren();
                    searchDeck(getBrowserDeck(), event.target.value).forEach(card => {
                        results.append(actionButton(
                            `${card.cardId} · ${card.zh} / ${card.en}`,
                            () => replaceCardAtSlot(slotPlan, card),
                            { disabled: used.has(card.cardId) }
                        ));
                    });
                }
            });
            cardNode.append(field(`搜索第 ${slotPlan.slot} 个位置的牌`, search), results);
            grid.append(cardNode);
        });
        mountNode.append(el('section', { className: 'consultation-step' }, [
            el('h3', { textContent: '手动录入牌面' }),
            el('p', { textContent: '逐槽搜索牌名，并明确选择正位或逆位。重复牌会被禁用。' }),
            grid
        ]));
        actionsNode.append(
            actionButton('返回', () => setPhase('choosing_interpretation')),
            actionButton('确认牌面', () => setPhase('confirming'), {
                className: 'consultation-primary',
                disabled: draft.cards.length !== slots.length
            })
        );
    }

    function renderConfirmationStep(mountNode, actionsNode) {
        const section = el('section', { className: 'consultation-step consultation-confirmation' }, [
            el('h3', { textContent: '确认并保存' }),
            el('p', { textContent: draft.templateName })
        ]);
        if (draft.questionMode === 'module') {
            const moduleSpec = getCurrentModuleSpec();
            const summary = el('div', { className: 'consultation-module-summary' });
            (moduleSpec && Array.isArray(moduleSpec.inputFields)
                ? moduleSpec.inputFields
                : []
            ).forEach(fieldSpec => {
                const value = getModuleFieldValue(draft, fieldSpec).trim();
                if (!value) return;
                summary.append(el('p', {
                    textContent: `${fieldSpec.label || fieldSpec.key}：${value}`
                }));
            });
            section.append(summary);
        }
        const cardGrid = el('div', { className: 'consultation-card-grid' });
        materializeCards(draft.cards, getBrowserDeck()).forEach(card => {
            cardGrid.append(el('figure', { className: 'consultation-card-preview' }, [
                el('img', {
                    src: `image2/${encodeURIComponent(card.imageFile || '')}`,
                    alt: `${card.zh} ${card.isReversed ? '逆位' : '正位'}`,
                    className: card.isReversed ? 'is-reversed' : ''
                }),
                el('figcaption', {
                    textContent: `${card.slotLabel} · ${card.zh} / ${card.en} · ${card.isReversed ? '逆位' : '正位'}`
                })
            ]));
        });
        section.append(cardGrid);
        mountNode.append(section);
        const saveButton = actionButton('保存并继续', async () => {
            if (phase !== 'confirming') return;
            saveButton.disabled = true;
            await saveCurrentCards();
        }, { className: 'consultation-primary', action: 'save' });
        actionsNode.append(
            actionButton('返回修改', () => setPhase('acquiring_cards')),
            saveButton
        );
    }

    function renderBusyStep(mountNode) {
        mountNode.append(el('section', { className: 'consultation-busy' }, [
            el('h3', { textContent: '正在保存' }),
            el('p', { textContent: '正在写入牌阵和咨询记录，请稍候。' })
        ]));
    }

    function renderSavedStep(mountNode, actionsNode) {
        mountNode.append(el('section', { className: 'consultation-result-panel' }, [
            el('h3', {
                id: 'consultation-result-title',
                tabIndex: -1,
                textContent: '已保存'
            }),
            el('p', { textContent: saved ? `Reading #${saved.readingId}` : '记录已保存' }),
            streamContent ? el('article', { textContent: streamContent }) : null
        ]));
        actionsNode.append(actionButton('完成', finish, { className: 'consultation-primary' }));
    }

    function renderGenerationStep(mountNode, actionsNode) {
        mountNode.append(el('section', { className: 'consultation-result-panel' }, [
            el('h3', { textContent: '正在生成解读' }),
            el('article', {
                className: 'consultation-stream-result',
                ariaLive: 'polite',
                textContent: streamContent
            })
        ]));
        actionsNode.append(actionButton('停止生成', () => {
            if (abortController) abortController.abort();
        }));
    }

    function renderReviewStep(mountNode) {
        const interpretation = generated && generated.interpretation;
        const form = el('form', { className: 'consultation-review-panel' });
        form.append(
            el('h3', {
                id: 'consultation-result-title',
                tabIndex: -1,
                textContent: '审核解读'
            }),
            el('article', {
                className: 'consultation-stream-result',
                textContent: generated ? generated.content : streamContent
            })
        );
        const verdictError = el('p', {
            id: 'consultation-review-verdict-error',
            className: 'consultation-field-error',
            hidden: true,
            role: 'alert'
        });
        const verdict = el('select', {
            id: 'consultation-review-verdict',
            name: 'verdict',
            'aria-describedby': verdictError.id
        }, [
            el('option', { value: 'accepted', textContent: '接受' }),
            el('option', { value: 'needs_work', textContent: '需要改进' }),
            el('option', { value: 'rejected', textContent: '拒绝' }),
            el('option', { value: 'edited', textContent: '采用编辑版' })
        ]);
        verdict.value = 'accepted';
        const ratingError = el('p', {
            id: 'consultation-review-rating-error',
            className: 'consultation-field-error',
            hidden: true,
            role: 'alert'
        });
        const rating = el('select', {
            id: 'consultation-review-rating',
            name: 'rating',
            'aria-describedby': ratingError.id
        }, [
            el('option', { value: '', textContent: '不评分' }),
            ...[1, 2, 3, 4, 5].map(value => el('option', { value: String(value), textContent: `${value}` }))
        ]);
        const verdictField = field('结论', verdict);
        verdictField.append(verdictError);
        const ratingField = field('评分', rating);
        ratingField.append(ratingError);
        form.append(verdictField, ratingField);
        const tagBox = el('fieldset', { className: 'consultation-review-tags' }, [
            el('legend', { textContent: '问题标签' })
        ]);
        ['不回应问题', '牌义错误', '机械罗列', '空泛套话', '过度宿命', '建议不可执行', '其他']
            .forEach(tag => {
                const checkbox = el('input', { type: 'checkbox', value: tag });
                tagBox.append(field(tag, checkbox, 'consultation-checkbox'));
            });
        form.append(tagBox);
        const note = el('textarea', {
            id: 'consultation-review-note',
            name: 'reviewNote',
            rows: 3
        });
        const editedError = el('p', {
            id: 'consultation-review-edited-error',
            className: 'consultation-field-error',
            hidden: true,
            role: 'alert'
        });
        const edited = el('textarea', {
            id: 'consultation-review-edited',
            name: 'editedContent',
            rows: 6,
            'aria-describedby': editedError.id
        });
        const privacy = el('input', {
            id: 'consultation-review-privacy',
            type: 'checkbox',
            name: 'privacyConfirmed'
        });
        const privacyField = field('我已确认编辑内容不含不应保存的隐私信息', privacy, 'consultation-checkbox');
        const updatePrivacy = () => {
            const isConsultation = Boolean(saved && saved.consultationId !== null);
            privacyField.hidden = !(
                isConsultation
                && ['accepted', 'edited'].includes(verdict.value)
            );
        };
        verdict.addEventListener('change', updatePrivacy);
        updatePrivacy();
        let reviewInFlight = false;
        const submitButton = el('button', {
            type: 'submit',
            className: 'consultation-primary',
            textContent: '保存审核'
        });
        const editedField = field('编辑后的理想答案', edited);
        editedField.append(editedError);
        form.append(
            field('审核备注', note),
            editedField,
            privacyField,
            submitButton
        );
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (reviewInFlight) return;
            const pendingReview = {
                verdict: verdict.value,
                rating: rating.value,
                issueTags: Array.from(tagBox.querySelectorAll('input:checked'))
                    .map(input => input.value),
                reviewNote: note.value,
                editedContent: edited.value,
                privacyConfirmed: privacy.checked
            };
            const validationErrors = validateReview(pendingReview);
            [
                [verdict, verdictError, validationErrors.verdict],
                [rating, ratingError, validationErrors.rating],
                [edited, editedError, validationErrors.editedContent]
            ].forEach(([control, errorNode, message]) => {
                errorNode.textContent = message || '';
                errorNode.hidden = !message;
                control.setAttribute('aria-invalid', message ? 'true' : 'false');
            });
            const firstInvalid = validationErrors.verdict
                ? verdict
                : validationErrors.rating
                    ? rating
                    : validationErrors.editedContent
                        ? edited
                        : null;
            if (firstInvalid) {
                firstInvalid.focus();
                return;
            }
            reviewInFlight = true;
            submitButton.disabled = true;
            const token = flowEpoch;
            try {
                const review = await submitReview(
                    interpretation.id,
                    pendingReview,
                    browserDeps()
                );
                if (token !== flowEpoch || phase !== 'review_ready') return;
                generated = { ...generated, review };
                setPhase('review_saved');
                focusFlowNode('consultation-review-saved-status');
            } catch (error) {
                if (token !== flowEpoch || phase !== 'review_ready') return;
                setStatus(error.message, true);
            } finally {
                if (token === flowEpoch && phase === 'review_ready') {
                    reviewInFlight = false;
                    submitButton.disabled = false;
                }
            }
        });
        mountNode.append(form);
    }

    function renderReviewSavedStep(mountNode, actionsNode) {
        mountNode.append(el('section', { className: 'consultation-result-panel' }, [
            el('h3', { textContent: '审核已保存' }),
            el('p', {
                id: 'consultation-review-saved-status',
                tabIndex: -1,
                textContent: '感谢你的反馈，它将用于改进后续解读。'
            })
        ]));
        actionsNode.append(actionButton('完成', finish, { className: 'consultation-primary' }));
    }

    const renderers = {
        choosing_type: renderTypeStep,
        editing_details: renderDetailsStep,
        choosing_spread_source: renderSpreadSourceStep,
        choosing_interpretation: renderInterpretationStep,
        acquiring_cards: renderManualCardsStep,
        confirming: renderConfirmationStep,
        saving: renderBusyStep,
        saved: renderSavedStep,
        generating: renderGenerationStep,
        review_ready: renderReviewStep,
        review_saved: renderReviewSavedStep
    };

    function render() {
        if (!root.document) return;
        const mountNode = root.document.getElementById('consultation-flow-mount');
        const actionsNode = root.document.getElementById('consultation-flow-actions');
        const stepsNode = root.document.getElementById('consultation-flow-steps');
        if (!mountNode || !actionsNode) return;
        fieldSequence = 0;
        mountNode.replaceChildren();
        actionsNode.replaceChildren();
        if (stepsNode) {
            const publicStep = getPublicStep(phase, draft);
            stepsNode.replaceChildren(el('span', {
                'aria-current': 'step',
                textContent: `步骤 ${publicStep.index} / ${publicStep.total} · ${publicStep.label}`
            }));
        }
        const renderer = renderers[phase];
        if (renderer) renderer(mountNode, actionsNode);
    }

    function setStatus(message, isError = false) {
        if (!root.document) return;
        const node = root.document.getElementById('consultation-flow-status');
        if (!node) return;
        node.textContent = String(message || '');
        node.classList.toggle('is-error', isError);
        node.classList.toggle('is-success', Boolean(message) && !isError);
    }

    function focusFlowNode(id) {
        if (!root.document) return;
        const node = root.document.getElementById(id);
        if (node && node.focus) node.focus();
    }

    function getBrowserDeck() {
        if (root.FULL_DECK) return root.FULL_DECK;
        if (typeof FULL_DECK !== 'undefined') return FULL_DECK;
        throw new Error('Tarot deck is unavailable');
    }

    function browserDeps() {
        return {
            deck: getBrowserDeck(),
            api: root.TarotAPI,
            streamInterpretation: root.AkashicInterpret.streamInterpretation,
            moduleSpec: getCurrentModuleSpec()
        };
    }

    function isOpen() {
        const dialog = root.document
            && root.document.getElementById('consultation-flow');
        return Boolean(dialog && !dialog.hidden);
    }

    function hasActiveDraft() {
        return Boolean(
            draft
            && phase === 'acquiring_cards'
            && draft.inputMode === 'three_d'
        );
    }

    function reset() {
        invalidateAsyncWork();
        draft = createInitialDraft();
        phase = 'choosing_type';
        saved = null;
        generated = null;
        streamContent = '';
        setStatus('', false);
        const summary = root.document
            && root.document.getElementById('active-consultation-summary');
        if (summary) {
            summary.hidden = true;
            summary.textContent = '';
        }
        render();
    }

    function finish() {
        close(true);
        reset();
    }

    async function open() {
        if (!root.document) return false;
        const dialog = root.document.getElementById('consultation-flow');
        if (!dialog || !dialog.hidden) return false;
        returnFocus = root.document.activeElement;
        dialog.hidden = false;
        root.document.body.classList.add('consultation-flow-open');
        const title = root.document.getElementById('consultation-flow-title');
        if (title && title.focus) title.focus();
        if (!modules.length && root.TarotAPI) {
            try {
                modules = await root.TarotAPI.loadConsultationModules();
            } catch (error) {
                setStatus(error.message, true);
            }
        }
        render();
        return true;
    }

    function close(force = false) {
        if (!root.document) return true;
        if (
            !force
            && ['saving', 'generating'].includes(phase)
            && typeof root.confirm === 'function'
            && !root.confirm('当前操作尚未完成，确定关闭吗？')
        ) {
            return false;
        }
        invalidateAsyncWork();
        const dialog = root.document.getElementById('consultation-flow');
        if (dialog) dialog.hidden = true;
        root.document.body.classList.remove('consultation-flow-open');
        if (returnFocus && returnFocus.focus) returnFocus.focus();
        return true;
    }

    function invalidateAsyncWork() {
        flowEpoch += 1;
        if (abortController) abortController.abort();
        abortController = null;
        acquiredCardsSavePromise = null;
        return flowEpoch;
    }

    function mount() {
        if (mounted || !root.document) return;
        const closeButton = root.document.getElementById('consultation-flow-close');
        if (!closeButton) return;
        const dialog = root.document.getElementById('consultation-flow');
        if (dialog) dialog.classList.add('consultation-flow-layout');
        mounted = true;
        closeButton.addEventListener('click', () => close());
        root.document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && isOpen()) close();
            if (event.key !== 'Tab' || !isOpen()) return;
            const dialog = root.document.getElementById('consultation-flow');
            if (!dialog || !dialog.querySelectorAll) return;
            const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
            const focusable = Array.from(dialog.querySelectorAll(focusableSelector))
                .filter(node => {
                    if (node.hidden || node.disabled) return false;
                    let ancestor = node.parentNode;
                    while (ancestor && ancestor !== dialog) {
                        if (ancestor.hidden) return false;
                        ancestor = ancestor.parentNode;
                    }
                    return ancestor === dialog;
                });
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = root.document.activeElement;
            if (!focusable.includes(active)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        });
        render();
    }

    function updateActiveSummary() {
        if (!root.document) return;
        const node = root.document.getElementById('active-consultation-summary');
        if (!node) return;
        node.hidden = false;
        const moduleSpec = getCurrentModuleSpec();
        node.textContent = draft.questionMode === 'module'
            ? `${(moduleSpec && moduleSpec.displayName) || '结构化咨询'} · ${draft.templateName}`
            : `无特定问题 · ${draft.templateName}`;
    }

    function beginThreeD() {
        if (typeof root.startConsultationSpread !== 'function') {
            setStatus('3D 抽牌尚未就绪', true);
            return;
        }
        phase = 'acquiring_cards';
        root.SpreadTemplates.setActiveTemplate(draft.templateKey);
        updateActiveSummary();
        close(true);
        root.startConsultationSpread();
    }

    async function afterSave(token) {
        if (token !== flowEpoch) return;
        if (draft.interpretationAction !== 'now') {
            phase = 'saved';
            render();
            return;
        }
        phase = 'generating';
        streamContent = '';
        const AbortControllerClass = root.AbortController
            || (typeof AbortController !== 'undefined' ? AbortController : null);
        const controller = AbortControllerClass ? new AbortControllerClass() : null;
        abortController = controller;
        let completionFocusId = null;
        render();
        try {
            const nextGenerated = await runSavedInterpretation(
                saved,
                draft,
                browserDeps(),
                event => {
                    if (token !== flowEpoch) return;
                    if (event.chunk) streamContent += event.chunk;
                    render();
                },
                controller ? controller.signal : undefined
            );
            if (token !== flowEpoch) return;
            generated = nextGenerated;
            phase = saved.consultationId !== null && generated.interpretation
                ? 'review_ready'
                : 'saved';
            completionFocusId = 'consultation-result-title';
            setStatus('解读完成', false);
        } catch (error) {
            if (token !== flowEpoch) return;
            phase = 'saved';
            setStatus(error.message, true);
        } finally {
            if (token === flowEpoch) {
                if (abortController === controller) abortController = null;
                render();
                if (completionFocusId) focusFlowNode(completionFocusId);
            }
        }
    }

    async function saveCurrentCards() {
        if (phase === 'saving') return;
        const moduleSpec = modules.find(item => item.moduleType === draft.moduleType) || null;
        const errors = validateDraft(draft, moduleSpec, { requireCards: true });
        if (Object.keys(errors).length) {
            setStatus(Object.values(errors)[0], true);
            return;
        }
        const token = ++flowEpoch;
        phase = 'saving';
        render();
        try {
            const nextSaved = await persistDraftCards(
                draft,
                draft.cards,
                browserDeps()
            );
            if (token !== flowEpoch) return;
            saved = nextSaved;
            root.lastSavedReadingId = saved.readingId;
            await afterSave(token);
        } catch (error) {
            if (token !== flowEpoch) return;
            phase = 'confirming';
            setStatus(error.message, true);
            render();
        }
    }

    function saveAcquiredCards(cards, meta = {}) {
        if (acquiredCardsSavePromise) return acquiredCardsSavePromise;

        const capturedCards = (Array.isArray(cards) ? cards : [])
            .map(card => ({ ...card }));
        const capturedMeta = meta && typeof meta === 'object' ? { ...meta } : {};
        let pending;
        pending = (async () => {
            const token = ++flowEpoch;
            draft = {
                ...draft,
                ...capturedMeta,
                cards: capturedCards,
                spreadNumber: Number(capturedMeta.spreadNumber) || 0
            };
            phase = 'saving';
            render();
            await open();
            if (token !== flowEpoch) return undefined;
            render();

            try {
                const nextSaved = await persistDraftCards(
                    draft,
                    draft.cards,
                    browserDeps()
                );
                if (token !== flowEpoch) return undefined;
                saved = nextSaved;
                root.lastSavedReadingId = saved.readingId;
                await afterSave(token);
                if (token !== flowEpoch) return undefined;
                return saved;
            } catch (error) {
                if (token !== flowEpoch) return undefined;
                phase = 'confirming';
                setStatus(error.message, true);
                render();
                throw error;
            } finally {
                if (acquiredCardsSavePromise === pending) {
                    acquiredCardsSavePromise = null;
                }
            }
        })();
        acquiredCardsSavePromise = pending;
        return pending;
    }

    function getDraft() {
        return {
            ...draft,
            modulePayload: { ...(draft.modulePayload || {}) },
            cards: Array.isArray(draft.cards)
                ? draft.cards.map(card => ({ ...card }))
                : []
        };
    }

    function setDraftForTest(value) {
        const {
            phase: testPhase,
            saved: testSaved,
            generated: testGenerated,
            streamContent: testStreamContent,
            ...draftValue
        } = value || {};
        draft = {
            ...createInitialDraft(),
            ...draftValue,
            modulePayload: { ...(draftValue.modulePayload || {}) },
            cards: Array.isArray(draftValue.cards)
                ? draftValue.cards.map(card => ({ ...card }))
                : []
        };
        if (PHASES.includes(testPhase)) phase = testPhase;
        if (Object.prototype.hasOwnProperty.call(value || {}, 'saved')) {
            saved = testSaved;
        }
        if (Object.prototype.hasOwnProperty.call(value || {}, 'generated')) {
            generated = testGenerated;
        }
        if (Object.prototype.hasOwnProperty.call(value || {}, 'streamContent')) {
            streamContent = String(testStreamContent || '');
        }
        render();
    }

    function nextPhase(currentPhase, requestedPhase) {
        if (!PHASES.includes(currentPhase) || !PHASES.includes(requestedPhase)) {
            throw new Error('Unknown consultation phase');
        }
        return requestedPhase;
    }

    const api = {
        createInitialDraft,
        searchDeck,
        getSlotPlan,
        getModuleFieldValue,
        setModuleFieldValue,
        validateModuleDetails,
        validateDraft,
        buildReadingPayload,
        buildConsultationPayload,
        chooseSaveOperation,
        persistDraftCards,
        runSavedInterpretation,
        validateReview,
        submitReview,
        nextPhase,
        getPublicStep,
        mount,
        open,
        close,
        reset,
        isOpen,
        hasActiveDraft,
        saveAcquiredCards,
        getDraft
    };
    return { api, setDraftForTest };
});
