(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    root.ConsultationFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
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

            const queryLength = String(currentDraft.userQuery || '').trim().length;
            if (queryLength < 4 || queryLength > 500) {
                errors.userQuery = '问题长度需为 4 到 500 个字符';
            }
            if (String(currentDraft.userContext || '').trim().length > 1000) {
                errors.userContext = '补充背景不能超过 1000 个字符';
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

    function buildConsultationPayload(draft, deck) {
        return {
            ...buildReadingPayload(draft, deck),
            language: 'zh',
            moduleType: draft && draft.moduleType,
            inputMode: draft && draft.inputMode,
            userQuery: String((draft && draft.userQuery) || '').trim(),
            userContext: String((draft && draft.userContext) || '').trim(),
            modulePayload: (draft && draft.modulePayload) || {}
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
                buildConsultationPayload(working, deps.deck)
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

    async function submitReview(interpretationId, review, deps) {
        const currentReview = review || {};
        const verdict = String(currentReview.verdict || '');
        const allowedVerdicts = [
            'accepted',
            'needs_work',
            'rejected',
            'edited'
        ];
        if (!allowedVerdicts.includes(verdict)) {
            throw new Error('Unsupported review verdict');
        }

        const editedContent = String(currentReview.editedContent || '').trim();
        if (verdict === 'edited' && !editedContent) {
            throw new Error('editedContent is required for edited verdict');
        }

        let rating = null;
        if (
            currentReview.rating !== undefined
            && currentReview.rating !== null
            && currentReview.rating !== ''
        ) {
            rating = Number(currentReview.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                throw new Error('rating must be between 1 and 5');
            }
        }

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

    function nextPhase(currentPhase, requestedPhase) {
        if (!PHASES.includes(currentPhase) || !PHASES.includes(requestedPhase)) {
            throw new Error('Unknown consultation phase');
        }
        return requestedPhase;
    }

    return {
        createInitialDraft,
        searchDeck,
        getSlotPlan,
        validateDraft,
        buildReadingPayload,
        buildConsultationPayload,
        chooseSaveOperation,
        persistDraftCards,
        runSavedInterpretation,
        submitReview,
        nextPhase
    };
});
