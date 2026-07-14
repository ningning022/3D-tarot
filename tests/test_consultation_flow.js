'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    createInitialDraft,
    searchDeck,
    getSlotPlan,
    validateDraft,
    buildReadingPayload,
    buildConsultationPayload,
    getModuleFieldValue,
    setModuleFieldValue,
    validateModuleDetails,
    chooseSaveOperation,
    nextPhase,
    getPublicStep,
    persistDraftCards,
    runSavedInterpretation,
    validateReview,
    submitReview,
    mount,
    open,
    close,
    reset,
    isOpen,
    hasActiveDraft,
    saveAcquiredCards,
    getDraft,
    setDraftForTest
} = require('../js/consultation_flow.js');

const deck = [
    { zh: '愚人', en: 'The Fool', file: 'RWS_Tarot_00_Fool.jpg' },
    { zh: '女祭司', en: 'The High Priestess', file: 'RWS_Tarot_02_High_Priestess.jpg' },
    { zh: '太阳', en: 'The Sun', file: 'RWS_Tarot_19_Sun.jpg' }
];

const generalModule = {
    moduleType: 'general_reading',
    questionRequired: true,
    inputFields: [
        {
            key: 'userQuery',
            label: '你的问题',
            type: 'textarea',
            required: true,
            maxLength: 500,
            placeholder: '请输入问题'
        },
        {
            key: 'userContext',
            label: '补充背景',
            type: 'textarea',
            required: false,
            maxLength: 1000,
            placeholder: '可选背景'
        }
    ],
    allowedSpreads: ['three_timeline', 'free'],
    defaultSpread: 'three_timeline'
};

const choiceModule = {
    moduleType: 'choice_compare',
    displayName: '二选一',
    questionRequired: false,
    inputFields: [
        {
            key: 'optionA',
            label: '选项 A',
            type: 'textarea',
            required: true,
            maxLength: 120,
            placeholder: '填写选项 A'
        },
        {
            key: 'optionB',
            label: '选项 B',
            type: 'textarea',
            required: true,
            maxLength: 120,
            placeholder: '填写选项 B'
        },
        {
            key: 'decisionPriorities',
            label: '你最在意的判断标准',
            type: 'textarea',
            required: false,
            maxLength: 200,
            placeholder: '可选'
        }
    ],
    allowedSpreads: ['choice_six'],
    defaultSpread: 'choice_six'
};

const fixedTemplate = {
    key: 'three_timeline',
    fixedCount: 3,
    slots: [
        { slot: 1, label: '过去 / Past' },
        { slot: 2, label: '现在 / Present' },
        { slot: 3, label: '未来 / Future' }
    ]
};

const freeTemplate = {
    key: 'free',
    fixedCount: null,
    slots: []
};

function completeDraft() {
    return {
        ...createInitialDraft(),
        questionMode: 'module',
        moduleType: 'general_reading',
        userQuery: '我该如何面对变化？',
        userContext: '近期工作职责有所调整。',
        modulePayload: { focus: 'work' },
        inputMode: 'manual',
        interpretationAction: 'now',
        spreadNumber: 2,
        cards: [
            { slot: 1, slotLabel: '过去 / Past', cardId: 0, isReversed: false },
            { slot: 2, slotLabel: '现在 / Present', cardId: 1, isReversed: true },
            { slot: 3, slotLabel: '未来 / Future', cardId: 2, isReversed: false }
        ]
    };
}

function testInitialDraftDefaultsAndIndependence() {
    const first = createInitialDraft();
    const second = createInitialDraft();

    assert.deepStrictEqual(first, {
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
    });
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.modulePayload, second.modulePayload);
    assert.notStrictEqual(first.cards, second.cards);
    first.modulePayload.focus = 'changed';
    first.cards.push({ cardId: 0 });
    assert.deepStrictEqual(second.modulePayload, {});
    assert.deepStrictEqual(second.cards, []);
}

function testDeckSearch() {
    assert.deepStrictEqual(searchDeck(deck, '女祭', 12), [{ ...deck[1], cardId: 1 }]);
    assert.deepStrictEqual(searchDeck(deck, 'hIgH pRiEsTeSs', 12), [{ ...deck[1], cardId: 1 }]);
    const deckWithNumberInName = [
        { ...deck[0], en: 'The Fool 2' },
        deck[1],
        deck[2]
    ];
    assert.deepStrictEqual(searchDeck(deckWithNumberInName, '2', 12), [{ ...deck[2], cardId: 2 }]);
    assert.deepStrictEqual(searchDeck(deck, ' ', 12), []);
    assert.strictEqual(searchDeck(deck, 'the', 2).length, 2);
    assert.strictEqual(searchDeck(deck, 'the', 0).length, 1);
}

function testSlotPlans() {
    assert.deepStrictEqual(getSlotPlan(fixedTemplate, 10), [
        { slot: 1, slotLabel: '过去 / Past' },
        { slot: 2, slotLabel: '现在 / Present' },
        { slot: 3, slotLabel: '未来 / Future' }
    ]);
    assert.deepStrictEqual(getSlotPlan(freeTemplate), [
        { slot: 1, slotLabel: 'Slot 1' },
        { slot: 2, slotLabel: 'Slot 2' },
        { slot: 3, slotLabel: 'Slot 3' }
    ]);
    assert.strictEqual(getSlotPlan(freeTemplate, 0).length, 1);
    assert.strictEqual(getSlotPlan(freeTemplate, 11).length, 10);
}

function testValidCompleteDraft() {
    assert.deepStrictEqual(
        validateDraft(completeDraft(), generalModule, { requireCards: true }),
        {}
    );
}

function testDraftValidationErrors() {
    assert.ok(validateDraft({ ...completeDraft(), questionMode: 'other' }, generalModule).questionMode);
    assert.ok(validateDraft({ ...completeDraft(), inputMode: 'camera' }, generalModule).inputMode);
    assert.ok(validateDraft({ ...completeDraft(), interpretationAction: 'soon' }, generalModule).interpretationAction);
    assert.ok(validateDraft({ ...completeDraft(), moduleType: null }, generalModule).moduleType);
    assert.ok(validateDraft({ ...completeDraft(), moduleType: 'other' }, generalModule).moduleType);
    assert.ok(validateDraft({ ...completeDraft(), templateKey: 'five_cross' }, generalModule).templateKey);
    assert.ok(validateDraft({ ...completeDraft(), userQuery: '短' }, generalModule).userQuery);
    assert.ok(validateDraft({ ...completeDraft(), userQuery: '问'.repeat(501) }, generalModule).userQuery);
    assert.ok(validateDraft({ ...completeDraft(), userContext: '背'.repeat(1001) }, generalModule).userContext);
    assert.ok(validateDraft({ ...completeDraft(), cards: [] }, generalModule, { requireCards: true }).cards);

    const duplicateCards = completeDraft();
    duplicateCards.cards[1] = { ...duplicateCards.cards[1], cardId: 0 };
    assert.strictEqual(
        validateDraft(duplicateCards, generalModule, { requireCards: true }).cards,
        '牌阵中不能重复选择同一张牌'
    );

    const invalidCardId = completeDraft();
    invalidCardId.cards[0] = { ...invalidCardId.cards[0], cardId: 78 };
    assert.ok(validateDraft(invalidCardId, generalModule, { requireCards: true }).cards);

    const invalidOrientation = completeDraft();
    invalidOrientation.cards[0] = { ...invalidOrientation.cards[0], isReversed: 'false' };
    assert.ok(validateDraft(invalidOrientation, generalModule, { requireCards: true }).cards);
}

function testOptionalCardsStillValidateProvidedCards() {
    assert.deepStrictEqual(
        validateDraft({ ...completeDraft(), cards: [] }, generalModule, { requireCards: false }),
        {}
    );

    const duplicateCards = completeDraft();
    duplicateCards.cards[1] = { ...duplicateCards.cards[1], cardId: 0 };
    assert.strictEqual(
        validateDraft(duplicateCards, generalModule, { requireCards: false }).cards,
        '牌阵中不能重复选择同一张牌'
    );

    const invalidCardId = completeDraft();
    invalidCardId.cards[0] = { ...invalidCardId.cards[0], cardId: -1 };
    assert.ok(validateDraft(invalidCardId, generalModule, { requireCards: false }).cards);

    const invalidOrientation = completeDraft();
    invalidOrientation.cards[0] = { ...invalidOrientation.cards[0], isReversed: null };
    assert.ok(validateDraft(invalidOrientation, generalModule, { requireCards: false }).cards);
}

function testSaveOperationSelection() {
    const moduleDraft = completeDraft();
    const readingDraft = createInitialDraft();

    assert.strictEqual(chooseSaveOperation(moduleDraft), 'consultation');
    assert.strictEqual(chooseSaveOperation(readingDraft), 'reading');
}

function testConsultationPayload() {
    const draft = completeDraft();
    draft.userQuery = '  我该如何面对变化？  ';
    draft.userContext = '  近期工作职责有所调整。  ';

    assert.deepStrictEqual(buildConsultationPayload(draft, deck), {
        kind: 'spread',
        spreadNumber: 2,
        templateKey: 'three_timeline',
        templateName: '三张牌 / Past Present Future',
        cards: [
            {
                slot: 1,
                slotLabel: '过去 / Past',
                cardId: 0,
                zh: '愚人',
                en: 'The Fool',
                imageFile: 'RWS_Tarot_00_Fool.jpg',
                isReversed: false
            },
            {
                slot: 2,
                slotLabel: '现在 / Present',
                cardId: 1,
                zh: '女祭司',
                en: 'The High Priestess',
                imageFile: 'RWS_Tarot_02_High_Priestess.jpg',
                isReversed: true
            },
            {
                slot: 3,
                slotLabel: '未来 / Future',
                cardId: 2,
                zh: '太阳',
                en: 'The Sun',
                imageFile: 'RWS_Tarot_19_Sun.jpg',
                isReversed: false
            }
        ],
        language: 'zh',
        moduleType: 'general_reading',
        inputMode: 'manual',
        userQuery: '我该如何面对变化？',
        userContext: '近期工作职责有所调整。',
        modulePayload: { focus: 'work' }
    });
}

function testReadingPayload() {
    const draft = completeDraft();
    draft.spreadNumber = '4';
    const payload = buildReadingPayload(draft, deck);

    assert.strictEqual(payload.kind, 'spread');
    assert.strictEqual(payload.spreadNumber, 4);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, 'userQuery'), false);
    assert.deepStrictEqual(payload.cards[1], {
        slot: 2,
        slotLabel: '现在 / Present',
        cardId: 1,
        zh: '女祭司',
        en: 'The High Priestess',
        imageFile: 'RWS_Tarot_02_High_Priestess.jpg',
        isReversed: true
    });
}

function testUnknownCardMaterialization() {
    const draft = completeDraft();
    draft.cards[0] = { ...draft.cards[0], cardId: 99 };
    assert.throws(() => buildReadingPayload(draft, deck), /Unknown cardId 99/);
    assert.throws(() => buildConsultationPayload(draft, deck), /Unknown cardId 99/);
}

function testPhaseTransitions() {
    const phases = [
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

    phases.forEach((phase, index) => {
        const requestedPhase = phases[(index + 1) % phases.length];
        assert.strictEqual(nextPhase(phase, requestedPhase), requestedPhase);
    });
    assert.throws(() => nextPhase('unknown', 'saved'), /Unknown consultation phase/);
    assert.throws(() => nextPhase('saved', 'unknown'), /Unknown consultation phase/);
}

function testRegistryDrivenModuleFieldsAndPayload() {
    const original = {
        ...createInitialDraft(),
        moduleType: 'choice_compare',
        userQuery: '通用问题',
        userContext: '通用背景',
        modulePayload: {
            optionA: '留任',
            optionB: '跳槽',
            staleFromAnotherModule: '应剔除'
        }
    };

    assert.strictEqual(getModuleFieldValue(original, { key: 'userQuery' }), '通用问题');
    assert.strictEqual(getModuleFieldValue(original, { key: 'optionA' }), '留任');
    assert.strictEqual(getModuleFieldValue(original, { key: 'missing' }), '');

    const changedTopLevel = setModuleFieldValue(original, { key: 'userContext' }, '新背景');
    const changedPayload = setModuleFieldValue(original, { key: 'optionA' }, '创业');
    assert.strictEqual(changedTopLevel.userContext, '新背景');
    assert.strictEqual(changedTopLevel.modulePayload.optionA, '留任');
    assert.strictEqual(changedPayload.modulePayload.optionA, '创业');
    assert.strictEqual(changedPayload.modulePayload.optionB, '跳槽');
    assert.strictEqual(original.modulePayload.optionA, '留任');

    assert.deepStrictEqual(
        validateModuleDetails(choiceModule, {
            ...original,
            modulePayload: { optionA: '', optionB: '跳槽' }
        }),
        { optionA: '请填写选项 A' }
    );
    assert.deepStrictEqual(
        validateModuleDetails(choiceModule, {
            ...original,
            modulePayload: { optionA: '同一选择', optionB: ' 同一选择 ' }
        }),
        { optionB: '两个选项不能相同' }
    );
    assert.deepStrictEqual(
        validateModuleDetails(choiceModule, {
            ...original,
            modulePayload: { optionA: '甲'.repeat(121), optionB: '乙' }
        }),
        { optionA: '选项 A不能超过 120 个字符' }
    );

    const payload = buildConsultationPayload(
        { ...original, cards: completeDraft().cards },
        deck,
        choiceModule
    );
    assert.deepStrictEqual(payload.modulePayload, { optionA: '留任', optionB: '跳槽' });
}

function testInternalPhasesMapToPublicSteps() {
    const expected = {
        choosing_type: [1, '选择咨询类型'],
        editing_details: [2, '填写咨询信息'],
        choosing_spread_source: [3, '选择牌阵与取牌方式'],
        choosing_interpretation: [4, '选择解读方式'],
        acquiring_cards: [5, '录入牌面'],
        confirming: [6, '确认本次咨询'],
        saving: [6, '确认本次咨询'],
        saved: [7, '结果与审核'],
        generating: [7, '结果与审核'],
        review_ready: [7, '结果与审核'],
        review_saved: [7, '结果与审核']
    };

    Object.entries(expected).forEach(([internalPhase, [index, label]]) => {
        assert.deepStrictEqual(
            getPublicStep(internalPhase, { inputMode: 'manual' }),
            { index, total: 7, label }
        );
    });
    assert.deepStrictEqual(
        getPublicStep('acquiring_cards', { inputMode: 'three_d' }),
        { index: 5, total: 7, label: '抽取牌面' }
    );
    assert.deepStrictEqual(
        getPublicStep('unknown_internal_phase', {}),
        { index: 1, total: 7, label: '选择咨询类型' }
    );

    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'consultation_flow.js'),
        'utf8'
    );
    assert.strictEqual(source.includes('PHASES.indexOf(phase)'), false);
    assert.strictEqual(source.includes('· ${phase}'), false);
}

function testThreePageConsultationFlowIntegration() {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'Three.html'),
        'utf8'
    );

    assert.ok(html.includes('id="consultation-flow"'));
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes('aria-labelledby="consultation-flow-title"'));
    assert.ok(html.includes('id="consultation-flow-close"'));
    assert.ok(html.includes('id="consultation-flow-steps"'));
    assert.ok(html.includes('id="consultation-flow-status"'));
    assert.ok(html.includes('aria-live="polite"'));
    assert.ok(html.includes('id="consultation-flow-mount"'));
    assert.ok(html.includes('id="consultation-flow-actions"'));
    assert.ok(html.includes('id="active-consultation-summary"'));

    const featureCss = html.indexOf('css/consultation_flow.css');
    const responsiveCss = html.indexOf('css/responsive.css');
    assert.ok(featureCss >= 0 && featureCss < responsiveCss);

    const templatesScript = html.indexOf('js/spread_templates.js');
    const flowScript = html.indexOf('js/consultation_flow.js');
    const mainScript = html.indexOf('js/main.js');
    assert.ok(templatesScript >= 0 && templatesScript < flowScript);
    assert.ok(flowScript < mainScript);
}

function testControllerExportsStateAndSafeRenderers() {
    for (const controllerMethod of [
        mount,
        open,
        close,
        reset,
        isOpen,
        hasActiveDraft,
        saveAcquiredCards,
        getDraft,
        setDraftForTest
    ]) {
        assert.strictEqual(typeof controllerMethod, 'function');
    }

    const initial = createInitialDraft();
    setDraftForTest({ ...initial, userQuery: '<img src=x onerror=alert(1)>' });
    const copy = getDraft();
    assert.strictEqual(copy.userQuery, '<img src=x onerror=alert(1)>');
    copy.userQuery = 'changed outside';
    assert.strictEqual(getDraft().userQuery, '<img src=x onerror=alert(1)>');
    reset();

    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'consultation_flow.js'),
        'utf8'
    );
    assert.strictEqual(source.includes('.innerHTML'), false);
    for (const phase of [
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
    ]) {
        assert.ok(source.includes(`${phase}: render`), `missing renderer for ${phase}`);
    }
}

function testConsultationFlowCssContract() {
    const css = fs.readFileSync(
        path.join(__dirname, '..', 'css', 'consultation_flow.css'),
        'utf8'
    );
    const responsive = fs.readFileSync(
        path.join(__dirname, '..', 'css', 'responsive.css'),
        'utf8'
    );
    assert.match(css, /z-index:\s*320/);
    assert.match(css, /\.consultation-flow\[hidden\]/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /\.consultation-card-grid/);
    assert.match(
        css,
        /\.consultation-flow-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\([^;]+;/s
    );
    assert.match(
        css,
        /\.consultation-flow-layout\s*\{[^}]*grid-template-rows:\s*repeat\(3, max-content\);[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s
    );
    assert.match(
        css,
        /\.consultation-flow-layout\s*>\s*\.consultation-flow-mount\s*\{[^}]*overflow:\s*visible;/s
    );
    assert.match(css, /\.consultation-flow-status\.is-success\s*\{/);
    assert.match(css, /\.consultation-flow-status\.is-warning\s*\{/);
    assert.match(css, /\.consultation-field-error\s*\{/);
    assert.match(
        css,
        /\.consultation-flow-actions:empty\s*\{[^}]*display:\s*none;/s
    );
    assert.match(
        responsive,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.consultation-flow\s*\{[^}]*inset:\s*0;[^}]*border-radius:\s*0;[^}]*padding:\s*14px;[^}]*\}[\s\S]*?\.consultation-flow-layout\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*grid-template-rows:\s*repeat\(5, max-content\);[^}]*\}[\s\S]*?\.consultation-flow-actions\s*\{[^}]*position:\s*static;[^}]*background:\s*var\(--panel-bg\);[^}]*\}/
    );
    assert.match(
        responsive,
        /@media\s*\(max-width:\s*420px\)\s*\{[\s\S]*?\.consultation-flow\s*\{[^}]*padding:\s*10px;[^}]*\}[\s\S]*?\.consultation-card-grid\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*\}[\s\S]*?\.consultation-flow-steps\s*\{[^}]*overflow-x:\s*auto;[^}]*\}[\s\S]*?\.consultation-choice-grid\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*\}/
    );
}

function makeFakeControllerDocument() {
    const documentListeners = {};
    const makeClassList = () => {
        const values = new Set();
        return {
            add(...items) { items.forEach(item => values.add(item)); },
            remove(...items) { items.forEach(item => values.delete(item)); },
            toggle(item, force) {
                const enabled = force === undefined ? !values.has(item) : force;
                if (enabled) values.add(item); else values.delete(item);
                return enabled;
            },
            contains(item) { return values.has(item); }
        };
    };
    const document = {
        activeElement: null,
        createElement(tagName) {
            const listeners = {};
            const node = {
                nodeType: 1,
                tagName: tagName.toUpperCase(),
                children: [],
                dataset: {},
                classList: makeClassList(),
                hidden: false,
                disabled: false,
                value: '',
                checked: false,
                attributes: {},
                addEventListener(type, listener) {
                    (listeners[type] = listeners[type] || []).push(listener);
                },
                listenerCount(type) {
                    return (listeners[type] || []).length;
                },
                dispatch(type, event = {}) {
                    const results = (listeners[type] || []).map(listener => listener({
                        target: node,
                        preventDefault() {},
                        ...event
                    }));
                    return Promise.all(results);
                },
                append(...items) {
                    items.forEach(item => {
                        node.children.push(item);
                        if (item && typeof item === 'object') item.parentNode = node;
                    });
                },
                appendChild(item) {
                    node.children.push(item);
                    if (item && typeof item === 'object') item.parentNode = node;
                    return item;
                },
                replaceChildren(...items) {
                    node.children = [...items];
                    items.forEach(item => {
                        if (item && typeof item === 'object') item.parentNode = node;
                    });
                },
                setAttribute(name, value) {
                    node.attributes[name] = String(value);
                    node[name] = String(value);
                },
                getAttribute(name) {
                    return Object.prototype.hasOwnProperty.call(node.attributes, name)
                        ? node.attributes[name]
                        : null;
                },
                focus() {
                    document.activeElement = node;
                    node.focusCount = (node.focusCount || 0) + 1;
                },
                querySelectorAll(selector) {
                    const matches = [];
                    const visit = current => {
                        if (!current || typeof current !== 'object') return;
                        const isCheckedInput = selector === 'input:checked'
                            && current.tagName === 'INPUT'
                            && current.checked;
                        const isFocusable = selector.includes('button:not([disabled])')
                            && ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(current.tagName)
                            && !current.disabled
                            && !current.hidden;
                        if (isCheckedInput || isFocusable) matches.push(current);
                        (current.children || []).forEach(visit);
                    };
                    node.children.forEach(visit);
                    return matches;
                },
                contains(candidate) {
                    if (candidate === node) return true;
                    return node.children.some(child => (
                        child && typeof child.contains === 'function'
                            ? child.contains(candidate)
                            : child === candidate
                    ));
                }
            };
            return node;
        },
        getElementById(id) {
            if (nodes[id]) return nodes[id];
            const visit = current => {
                if (!current || typeof current !== 'object') return null;
                if (current.id === id) return current;
                for (const child of current.children || []) {
                    const match = visit(child);
                    if (match) return match;
                }
                return null;
            };
            return visit(document.body);
        },
        addEventListener(type, listener) {
            (documentListeners[type] = documentListeners[type] || []).push(listener);
        },
        listenerCount(type) {
            return (documentListeners[type] || []).length;
        },
        dispatch(type, event) {
            const dispatched = {
                target: document.activeElement,
                preventDefault() {},
                ...(event || {})
            };
            (documentListeners[type] || []).forEach(listener => listener(dispatched));
        }
    };
    document.body = document.createElement('body');
    const nodes = {};
    [
        ['consultation-flow', 'section'],
        ['consultation-flow-title', 'h2'],
        ['consultation-flow-close', 'button'],
        ['consultation-flow-steps', 'nav'],
        ['consultation-flow-status', 'div'],
        ['consultation-flow-mount', 'main'],
        ['consultation-flow-actions', 'footer'],
        ['active-consultation-summary', 'div']
    ].forEach(([id, tag]) => {
        const node = document.createElement(tag);
        node.id = id;
        nodes[id] = node;
        document.body.append(node);
    });
    document.body.replaceChildren();
    nodes['consultation-flow'].append(
        nodes['consultation-flow-title'],
        nodes['consultation-flow-close'],
        nodes['consultation-flow-steps'],
        nodes['consultation-flow-status'],
        nodes['consultation-flow-mount'],
        nodes['consultation-flow-actions']
    );
    document.body.append(
        nodes['consultation-flow'],
        nodes['active-consultation-summary']
    );
    nodes['consultation-flow'].hidden = true;
    nodes['active-consultation-summary'].hidden = true;
    return { document, nodes };
}

function findFakeNode(rootNode, predicate) {
    if (!rootNode || typeof rootNode !== 'object') return null;
    if (predicate(rootNode)) return rootNode;
    for (const child of rootNode.children || []) {
        const match = findFakeNode(child, predicate);
        if (match) return match;
    }
    return null;
}

function collectFakeNodes(rootNode, predicate, matches = []) {
    if (!rootNode || typeof rootNode !== 'object') return matches;
    if (predicate(rootNode)) matches.push(rootNode);
    for (const child of rootNode.children || []) {
        collectFakeNodes(child, predicate, matches);
    }
    return matches;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function loadControllerRuntime(overrides = {}) {
    const { document, nodes } = makeFakeControllerDocument();
    const runtime = {
        document,
        confirm: () => true,
        FULL_DECK: deck,
        SpreadTemplates: require('../js/spread_templates.js'),
        TarotAPI: {
            async loadConsultationModules() { return [generalModule]; },
            ...overrides.api
        },
        AkashicInterpret: {
            async *streamInterpretation() { yield { done: true }; },
            ...overrides.interpret
        },
        AbortController: class {
            constructor() { this.signal = { aborted: false }; }
            abort() { this.signal.aborted = true; }
        },
        ...overrides.runtime
    };
    const commonJsModule = { exports: {} };
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'consultation_flow.js'),
        'utf8'
    );
    vm.runInNewContext(source, {
        globalThis: runtime,
        window: runtime,
        module: commonJsModule,
        console,
        encodeURIComponent
    }, { filename: 'consultation_flow.js' });
    return {
        runtime,
        document,
        nodes,
        browserFlow: runtime.ConsultationFlow,
        testFlow: commonJsModule.exports
    };
}

async function testSaveAcquiredCardsPersistsOnceAndCopiesCapture() {
    const saveGate = deferred();
    const saveStarted = deferred();
    const readingCalls = [];
    const controller = loadControllerRuntime({
        api: {
            async createReading(payload) {
                readingCalls.push(JSON.parse(JSON.stringify(payload)));
                saveStarted.resolve();
                return saveGate.promise;
            }
        }
    });
    const { browserFlow, testFlow, nodes, runtime } = controller;
    browserFlow.mount();
    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'acquiring_cards',
        inputMode: 'three_d'
    });
    const capturedCards = [{
        slot: 1,
        slotLabel: '主题 / Focus',
        cardId: 0,
        isReversed: false
    }];
    const meta = {
        spreadNumber: 6,
        templateKey: 'free',
        templateName: '自由牌阵 / Free Spread',
        readingDate: '2026-07-13'
    };

    const first = browserFlow.saveAcquiredCards(capturedCards, meta);
    capturedCards[0].cardId = 2;
    const second = browserFlow.saveAcquiredCards(capturedCards, meta);
    await saveStarted.promise;

    assert.strictEqual(readingCalls.length, 1);
    assert.strictEqual(browserFlow.isOpen(), true);
    assert.ok(findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'H3' && node.textContent === '正在保存'
    ));
    assert.deepStrictEqual(readingCalls[0], {
        kind: 'spread',
        spreadNumber: 6,
        templateKey: 'free',
        templateName: '自由牌阵 / Free Spread',
        cards: [{
            slot: 1,
            slotLabel: '主题 / Focus',
            cardId: 0,
            zh: '愚人',
            en: 'The Fool',
            imageFile: 'RWS_Tarot_00_Fool.jpg',
            isReversed: false
        }]
    });

    saveGate.resolve({ id: 61 });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.strictEqual(firstResult.readingId, 61);
    assert.strictEqual(secondResult.readingId, 61);
    assert.strictEqual(runtime.lastSavedReadingId, 61);
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(testFlow.getDraft().cards)),
        [{ slot: 1, slotLabel: '主题 / Focus', cardId: 0, isReversed: false }]
    );
    assert.strictEqual(testFlow.getDraft().readingDate, '2026-07-13');
}

async function testSaveAcquiredCardsThrowsThenAllowsRetry() {
    let saveCalls = 0;
    const controller = loadControllerRuntime({
        api: {
            async createReading() {
                saveCalls += 1;
                if (saveCalls === 1) throw new Error('capture save failed');
                return { id: 71 };
            }
        }
    });
    const { browserFlow, testFlow, nodes, runtime } = controller;
    browserFlow.mount();
    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'acquiring_cards',
        inputMode: 'three_d'
    });
    const cards = [{ slot: 1, slotLabel: 'Slot 1', cardId: 1, isReversed: true }];

    await assert.rejects(
        browserFlow.saveAcquiredCards(cards, { spreadNumber: 2 }),
        /capture save failed/
    );
    assert.strictEqual(nodes['consultation-flow-status'].textContent, 'capture save failed');
    assert.ok(findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'H3' && node.textContent === '确认并保存'
    ));

    const result = await browserFlow.saveAcquiredCards(cards, { spreadNumber: 2 });
    assert.strictEqual(result.readingId, 71);
    assert.strictEqual(saveCalls, 2);
    assert.strictEqual(runtime.lastSavedReadingId, 71);
}

async function testSaveAcquiredCardsIgnoresStaleCloseAndReset() {
    for (const invalidate of ['close', 'reset']) {
        const saveGate = deferred();
        const saveStarted = deferred();
        let streamCalls = 0;
        const controller = loadControllerRuntime({
            api: {
                async createReading() {
                    saveStarted.resolve();
                    return saveGate.promise;
                }
            },
            interpret: {
                async *streamInterpretation() {
                    streamCalls += 1;
                    yield { done: true };
                }
            }
        });
        const { browserFlow, testFlow, runtime } = controller;
        browserFlow.mount();
        testFlow.setDraftForTest({
            ...createInitialDraft(),
            phase: 'acquiring_cards',
            inputMode: 'three_d',
            interpretationAction: 'now'
        });
        const pending = browserFlow.saveAcquiredCards(
            [{ slot: 1, slotLabel: 'Slot 1', cardId: 0, isReversed: false }],
            { spreadNumber: 9 }
        );
        await saveStarted.promise;

        if (invalidate === 'close') browserFlow.close();
        else browserFlow.reset();
        testFlow.setDraftForTest({
            ...createInitialDraft(),
            phase: 'choosing_type',
            userQuery: `fresh-${invalidate}`
        });
        saveGate.resolve({ id: 81 });

        assert.strictEqual(await pending, undefined);
        assert.strictEqual(runtime.lastSavedReadingId, undefined);
        assert.strictEqual(streamCalls, 0);
        assert.strictEqual(testFlow.getDraft().userQuery, `fresh-${invalidate}`);
    }
}

async function testBrowserControllerMountOpenCloseLifecycle() {
    const { document, nodes } = makeFakeControllerDocument();
    const opener = document.createElement('button');
    opener.focus();
    let moduleLoads = 0;
    const runtime = {
        document,
        confirm: () => true,
        TarotAPI: {
            async loadConsultationModules() {
                moduleLoads += 1;
                return [generalModule];
            }
        }
    };
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'consultation_flow.js'),
        'utf8'
    );
    vm.runInNewContext(source, {
        globalThis: runtime,
        window: runtime,
        console,
        encodeURIComponent
    }, { filename: 'consultation_flow.js' });
    const browserFlow = runtime.ConsultationFlow;

    browserFlow.mount();
    browserFlow.mount();
    assert.strictEqual(
        nodes['consultation-flow'].classList.contains('consultation-flow-layout'),
        true
    );
    assert.strictEqual(nodes['consultation-flow-close'].listenerCount('click'), 1);
    assert.strictEqual(document.listenerCount('keydown'), 1);
    assert.strictEqual(await browserFlow.open(), true);
    assert.strictEqual(browserFlow.isOpen(), true);
    assert.strictEqual(nodes['consultation-flow'].hidden, false);
    assert.strictEqual(document.body.classList.contains('consultation-flow-open'), true);
    assert.strictEqual(document.activeElement, nodes['consultation-flow-title']);
    assert.strictEqual(moduleLoads, 1);
    assert.strictEqual(await browserFlow.open(), false);
    assert.strictEqual(moduleLoads, 1);

    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = nodes['consultation-flow'].querySelectorAll(focusableSelector);
    const firstFocusable = focusables[0];
    const lastFocusable = focusables[focusables.length - 1];
    let titleBackwardPrevented = false;
    nodes['consultation-flow-title'].focus();
    document.dispatch('keydown', {
        key: 'Tab',
        shiftKey: true,
        preventDefault() { titleBackwardPrevented = true; }
    });
    assert.strictEqual(titleBackwardPrevented, true);
    assert.strictEqual(document.activeElement, lastFocusable);
    let titleForwardPrevented = false;
    nodes['consultation-flow-title'].focus();
    document.dispatch('keydown', {
        key: 'Tab',
        shiftKey: false,
        preventDefault() { titleForwardPrevented = true; }
    });
    assert.strictEqual(titleForwardPrevented, true);
    assert.strictEqual(document.activeElement, firstFocusable);

    let outsideForwardPrevented = false;
    opener.focus();
    document.dispatch('keydown', {
        key: 'Tab',
        shiftKey: false,
        preventDefault() { outsideForwardPrevented = true; }
    });
    assert.strictEqual(outsideForwardPrevented, true);
    assert.strictEqual(document.activeElement, firstFocusable);

    let forwardPrevented = false;
    lastFocusable.focus();
    document.dispatch('keydown', {
        key: 'Tab',
        shiftKey: false,
        preventDefault() { forwardPrevented = true; }
    });
    assert.strictEqual(forwardPrevented, true);
    assert.strictEqual(document.activeElement, firstFocusable);
    let backwardPrevented = false;
    firstFocusable.focus();
    document.dispatch('keydown', {
        key: 'Tab',
        shiftKey: true,
        preventDefault() { backwardPrevented = true; }
    });
    assert.strictEqual(backwardPrevented, true);
    assert.strictEqual(document.activeElement, lastFocusable);

    assert.strictEqual(browserFlow.close(), true);
    assert.strictEqual(document.activeElement, opener);

    await browserFlow.open();
    document.dispatch('keydown', { key: 'Escape' });
    assert.strictEqual(browserFlow.isOpen(), false);
}

async function testFinishClearsCompletedConsultationBeforeReopen() {
    const { browserFlow, testFlow, nodes } = loadControllerRuntime();
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'saved',
        saved: { consultationId: 17, readingId: 29 },
        generated: { content: 'completed output', interpretation: { id: 10 } }
    });
    nodes['active-consultation-summary'].hidden = false;
    nodes['active-consultation-summary'].textContent = '普通咨询 · 三张牌';

    const finish = findFakeNode(
        nodes['consultation-flow-actions'],
        node => node.tagName === 'BUTTON' && node.textContent === '完成'
    );
    assert.ok(finish, 'saved step should expose a finish button');
    await finish.dispatch('click');
    assert.strictEqual(browserFlow.isOpen(), false);
    assert.strictEqual(nodes['active-consultation-summary'].hidden, true);
    assert.strictEqual(nodes['active-consultation-summary'].textContent, '');

    await browserFlow.open();
    assert.ok(findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'type-none'
    ), 'reopening after finish should start a fresh consultation');
}

async function testSelectionControlsExposePressedState() {
    const { browserFlow, testFlow, nodes } = loadControllerRuntime();
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'choosing_spread_source',
        templateKey: 'three_timeline',
        inputMode: 'manual'
    });

    const selectedSpread = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'spread-three_timeline'
    );
    const otherSpread = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'spread-five_cross'
    );
    const manualMode = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'BUTTON' && node.textContent === '手动录入'
    );
    const threeDMode = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'BUTTON' && node.textContent === '3D 抽牌'
    );
    assert.strictEqual(selectedSpread.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(otherSpread.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(manualMode.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(threeDMode.getAttribute('aria-pressed'), 'false');

    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'choosing_interpretation',
        interpretationAction: 'later'
    });
    const interpretationButtons = collectFakeNodes(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'BUTTON'
    );
    const pressedStates = interpretationButtons.map(
        button => button.getAttribute('aria-pressed')
    );
    assert.deepStrictEqual(pressedStates, ['false', 'true', 'false']);
}

async function testDetailsUsesOnlyBackendSupportedStyles() {
    const { browserFlow, nodes } = loadControllerRuntime();
    browserFlow.mount();
    await browserFlow.open();
    const moduleButton = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'type-general_reading'
    );
    await moduleButton.dispatch('click');
    const styleSelect = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'SELECT' && node.name === 'style'
    );
    assert.deepStrictEqual(
        styleSelect.children.map(option => option.value),
        ['psychological', 'traditional', 'intuitive']
    );
    assert.strictEqual(
        styleSelect.children.some(option => option.value === 'concise'),
        false
    );
}

async function testSpreadChangesReconcileCards() {
    const { browserFlow, testFlow, nodes } = loadControllerRuntime();
    browserFlow.mount();
    await browserFlow.open();
    const fiveCards = Array.from({ length: 5 }, (_, index) => ({
        slot: index + 1,
        slotLabel: `Slot ${index + 1}`,
        cardId: index,
        isReversed: false
    }));
    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'choosing_spread_source',
        questionMode: 'none',
        templateKey: 'free',
        templateName: 'Free Spread',
        freeCount: 5,
        inputMode: 'manual',
        cards: fiveCards
    });
    const freeCount = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'INPUT' && node.type === 'number'
    );
    assert.ok(freeCount, 'free-count input should render');
    freeCount.value = '3';
    await freeCount.dispatch('input');
    assert.deepStrictEqual(testFlow.getDraft().cards.map(card => card.slot), [1, 2, 3]);

    const timeline = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'spread-three_timeline'
    );
    await timeline.dispatch('click');
    assert.strictEqual(testFlow.getDraft().cards.length, 0);

    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'choosing_spread_source',
        questionMode: 'none',
        inputMode: 'manual',
        cards: fiveCards.slice(0, 3)
    });
    const threeD = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'BUTTON' && node.textContent === '3D 抽牌'
    );
    await threeD.dispatch('click');
    assert.strictEqual(testFlow.getDraft().cards.length, 0);
}

async function testStaleSaveCannotStartGenerationAfterCloseOrReset() {
    for (const invalidate of ['close', 'reset']) {
        const saveGate = deferred();
        let streamCalls = 0;
        let confirmCalls = 0;
        const controller = loadControllerRuntime({
            api: {
                async createConsultation() { return saveGate.promise; },
                async createReading() { throw new Error('wrong save path'); }
            },
            interpret: {
                async *streamInterpretation() {
                    streamCalls += 1;
                    yield { done: true };
                }
            },
            runtime: {
                confirm() { confirmCalls += 1; return true; }
            }
        });
        const { browserFlow, testFlow, nodes, runtime } = controller;
        browserFlow.mount();
        await browserFlow.open();
        testFlow.setDraftForTest({ ...completeDraft(), phase: 'confirming' });
        const saveButton = findFakeNode(
            nodes['consultation-flow-actions'],
            node => node.dataset && node.dataset.flowAction === 'save'
        );
        const pendingClick = saveButton.dispatch('click');
        if (invalidate === 'close') {
            assert.strictEqual(browserFlow.close(), true);
            assert.strictEqual(confirmCalls, 1);
            testFlow.setDraftForTest({
                ...createInitialDraft(),
                phase: 'choosing_type',
                userQuery: 'new draft'
            });
        } else {
            browserFlow.reset();
        }
        saveGate.resolve({ id: 41, readingId: 51 });
        await pendingClick;
        assert.strictEqual(streamCalls, 0, `${invalidate} must suppress stale stream`);
        assert.strictEqual(runtime.lastSavedReadingId, undefined);
        assert.strictEqual(
            testFlow.getDraft().userQuery,
            invalidate === 'close' ? 'new draft' : ''
        );
    }
}

async function testCloseAbortsGenerationAndIgnoresLateEvents() {
    const streamStarted = deferred();
    const streamGate = deferred();
    let observedSignal = null;
    const controller = loadControllerRuntime({
        api: {
            async createConsultation() { return { id: 41, readingId: 51 }; },
            async createReading() { throw new Error('wrong save path'); },
            async loadConsultation() { return { interpretations: [] }; }
        },
        interpret: {
            async *streamInterpretation(_readingId, options) {
                observedSignal = options.signal;
                streamStarted.resolve();
                await streamGate.promise;
                yield { chunk: 'late' };
                yield { done: true };
            }
        }
    });
    const { browserFlow, testFlow, nodes } = controller;
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({ ...completeDraft(), phase: 'confirming' });
    const saveButton = findFakeNode(
        nodes['consultation-flow-actions'],
        node => node.dataset && node.dataset.flowAction === 'save'
    );
    const pendingClick = saveButton.dispatch('click');
    await streamStarted.promise;
    assert.strictEqual(browserFlow.close(), true);
    assert.strictEqual(observedSignal.aborted, true);
    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'choosing_type',
        streamContent: 'fresh'
    });
    streamGate.resolve();
    await pendingClick;
    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'saved',
        saved: { consultationId: null, readingId: 77 }
    });
    const article = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'ARTICLE'
    );
    assert.strictEqual(article.textContent, 'fresh');
}

async function testGenerationProgressFeedback() {
    const { browserFlow, testFlow, nodes } = loadControllerRuntime();
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'generating',
        saved: { consultationId: 17, readingId: 29 },
        streamContent: '正在输出的解读'
    });

    const mount = nodes['consultation-flow-mount'];
    const status = findFakeNode(
        mount,
        node => node.className === 'consultation-generation-status'
    );
    const progress = findFakeNode(
        mount,
        node => node.getAttribute && node.getAttribute('role') === 'progressbar'
    );
    const indicator = findFakeNode(
        mount,
        node => node.className === 'consultation-generation-progress-bar'
    );
    const stop = findFakeNode(
        nodes['consultation-flow-actions'],
        node => node.tagName === 'BUTTON' && node.textContent === '停止生成'
    );

    assert.ok(status);
    assert.strictEqual(status.getAttribute('role'), 'status');
    assert.strictEqual(status.getAttribute('aria-live'), 'polite');
    assert.ok(findFakeNode(
        status,
        node => node.textContent === '正在分析牌面并组织回答，请稍候…'
    ));
    assert.ok(progress);
    assert.strictEqual(progress.getAttribute('aria-label'), '解读生成中');
    assert.strictEqual(progress.getAttribute('aria-valuenow'), null);
    assert.strictEqual(indicator.getAttribute('aria-hidden'), 'true');
    assert.ok(stop);
}

async function testReviewPrivacyFollowsConsultationAndVerdict() {
    const controller = loadControllerRuntime();
    const { browserFlow, testFlow, nodes } = controller;
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_ready',
        saved: { consultationId: 17, readingId: 29 },
        generated: {
            content: 'safe output',
            interpretation: { id: 9 }
        }
    });
    const verdict = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'SELECT' && node.name === 'verdict'
    );
    const privacy = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'INPUT' && node.name === 'privacyConfirmed'
    );
    assert.strictEqual(verdict.value, 'accepted');
    assert.strictEqual(privacy.parentNode.hidden, false);
    verdict.value = 'needs_work';
    await verdict.dispatch('change');
    assert.strictEqual(privacy.parentNode.hidden, true);
    verdict.value = 'edited';
    await verdict.dispatch('change');
    assert.strictEqual(privacy.parentNode.hidden, false);
    verdict.value = 'rejected';
    await verdict.dispatch('change');
    assert.strictEqual(privacy.parentNode.hidden, true);

    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_ready',
        saved: { consultationId: null, readingId: 29 },
        generated: {
            content: 'plain reading',
            interpretation: { id: 10 }
        }
    });
    const plainPrivacy = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'INPUT' && node.name === 'privacyConfirmed'
    );
    assert.strictEqual(plainPrivacy.parentNode.hidden, true);
}

async function testDynamicFormAccessibilityAndReviewErrors() {
    const controller = loadControllerRuntime();
    const { browserFlow, testFlow, nodes } = controller;
    browserFlow.mount();
    await browserFlow.open();

    const assertControlsAreLabelled = phaseDraft => {
        testFlow.setDraftForTest(phaseDraft);
        const mountNode = nodes['consultation-flow-mount'];
        const controls = collectFakeNodes(
            mountNode,
            node => ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)
        );
        const labels = collectFakeNodes(mountNode, node => node.tagName === 'LABEL');
        assert.ok(controls.length > 0, `${phaseDraft.phase} should render controls`);
        controls.forEach(control => {
            assert.ok(control.id, `${phaseDraft.phase} ${control.tagName} should have an id`);
            assert.ok(
                labels.some(label => label.htmlFor === control.id),
                `${control.id} should have a persistent label`
            );
        });
    };

    assertControlsAreLabelled({
        ...completeDraft(),
        phase: 'editing_details'
    });
    assertControlsAreLabelled({
        ...createInitialDraft(),
        phase: 'choosing_spread_source',
        templateKey: 'free',
        inputMode: 'manual'
    });
    assertControlsAreLabelled({
        ...completeDraft(),
        phase: 'acquiring_cards'
    });
    const firstCardEditor = collectFakeNodes(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'ARTICLE'
    )[0];
    const upright = findFakeNode(
        firstCardEditor,
        node => node.tagName === 'BUTTON' && node.textContent === '正位'
    );
    const reversed = findFakeNode(
        firstCardEditor,
        node => node.tagName === 'BUTTON' && node.textContent === '逆位'
    );
    assert.strictEqual(upright.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(reversed.getAttribute('aria-pressed'), 'false');

    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_ready',
        saved: { consultationId: 17, readingId: 29 },
        generated: { content: 'output', interpretation: { id: 10 } }
    });
    const currentStep = findFakeNode(
        nodes['consultation-flow-steps'],
        node => node.getAttribute && node.getAttribute('aria-current') === 'step'
    );
    assert.ok(currentStep, 'the current flow step should expose aria-current="step"');

    const form = findFakeNode(nodes['consultation-flow-mount'], node => node.tagName === 'FORM');
    const controls = collectFakeNodes(
        form,
        node => ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)
    );
    const labels = collectFakeNodes(form, node => node.tagName === 'LABEL');
    controls.forEach(control => {
        assert.ok(control.id, `review ${control.tagName} should have an id`);
        assert.ok(labels.some(label => label.htmlFor === control.id));
    });

    const verdict = controls.find(control => control.name === 'verdict');
    const rating = controls.find(control => control.name === 'rating');
    const edited = controls.find(control => control.name === 'editedContent');
    const ratingLabel = labels.find(label => label.htmlFor === rating.id);
    const ratingOptions = collectFakeNodes(rating, node => node.tagName === 'OPTION');
    assert.strictEqual(ratingLabel.textContent, '评分（1–5 分，5 分最高）');
    assert.deepStrictEqual(
        ratingOptions.map(option => option.textContent),
        ['不评分', '1 分', '2 分', '3 分', '4 分', '5 分（最高）']
    );
    verdict.value = 'pending';
    rating.value = '0';
    await form.dispatch('submit');
    const verdictError = controller.document.getElementById('consultation-review-verdict-error');
    const ratingError = controller.document.getElementById('consultation-review-rating-error');
    assert.strictEqual(verdictError.textContent, '请选择审核结论');
    assert.strictEqual(verdictError.hidden, false);
    assert.strictEqual(verdict.getAttribute('aria-describedby'), verdictError.id);
    assert.strictEqual(ratingError.textContent, '评分应为 1–5');
    assert.strictEqual(ratingError.hidden, false);
    assert.strictEqual(rating.getAttribute('aria-describedby'), ratingError.id);

    verdict.value = 'edited';
    rating.value = '';
    edited.value = '   ';
    await form.dispatch('submit');
    const editedError = controller.document.getElementById('consultation-review-edited-error');
    assert.strictEqual(editedError.textContent, '编辑后的理想答案不能为空');
    assert.strictEqual(editedError.hidden, false);
    assert.strictEqual(edited.getAttribute('aria-describedby'), editedError.id);
}

async function testFocusTrapExcludesDisabledAndAncestorHiddenControls() {
    const controller = loadControllerRuntime();
    const { browserFlow, testFlow, nodes, document } = controller;
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_ready',
        saved: { consultationId: 17, readingId: 29 },
        generated: { content: 'output', interpretation: { id: 10 } }
    });

    const dialog = nodes['consultation-flow'];
    const form = findFakeNode(nodes['consultation-flow-mount'], node => node.tagName === 'FORM');
    const submit = findFakeNode(form, node => node.tagName === 'BUTTON' && node.type === 'submit');
    const verdict = findFakeNode(form, node => node.name === 'verdict');
    const edited = findFakeNode(form, node => node.name === 'editedContent');
    const privacy = findFakeNode(form, node => node.name === 'privacyConfirmed');
    const closeButton = nodes['consultation-flow-close'];

    submit.disabled = true;
    submit.focus();
    let disabledForwardPrevented = false;
    document.dispatch('keydown', {
        key: 'Tab',
        shiftKey: false,
        preventDefault() { disabledForwardPrevented = true; }
    });
    assert.strictEqual(disabledForwardPrevented, true);
    assert.strictEqual(document.activeElement, closeButton);

    submit.focus();
    let disabledBackwardPrevented = false;
    document.dispatch('keydown', {
        key: 'Tab',
        shiftKey: true,
        preventDefault() { disabledBackwardPrevented = true; }
    });
    assert.strictEqual(disabledBackwardPrevented, true);
    assert.strictEqual(document.activeElement, privacy);

    verdict.value = 'needs_work';
    await verdict.dispatch('change');
    assert.strictEqual(privacy.parentNode.hidden, true);
    nodes['consultation-flow-title'].focus();
    let hiddenBackwardPrevented = false;
    document.dispatch('keydown', {
        key: 'Tab',
        shiftKey: true,
        preventDefault() { hiddenBackwardPrevented = true; }
    });
    assert.strictEqual(hiddenBackwardPrevented, true);
    assert.strictEqual(document.activeElement, edited);
    assert.notStrictEqual(document.activeElement, privacy);

    assert.strictEqual(dialog.contains(document.activeElement), true);
}

async function testCompletionFocusAndNoQuestionReviewEligibility() {
    const noQuestion = loadControllerRuntime({
        api: {
            async createReading() { return { id: 51 }; }
        },
        interpret: {
            async *streamInterpretation() {
                yield { chunk: 'generated answer' };
                yield { done: true };
            }
        }
    });
    noQuestion.browserFlow.mount();
    await noQuestion.browserFlow.open();
    noQuestion.testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'confirming',
        questionMode: 'none',
        moduleType: null,
        userQuery: '',
        userContext: '',
        interpretationAction: 'now'
    });
    const save = findFakeNode(
        noQuestion.nodes['consultation-flow-actions'],
        node => node.dataset && node.dataset.flowAction === 'save'
    );
    await save.dispatch('click');
    assert.strictEqual(
        noQuestion.document.activeElement.id,
        'consultation-result-title'
    );
    assert.strictEqual(
        findFakeNode(noQuestion.nodes['consultation-flow-mount'], node => node.tagName === 'FORM'),
        null
    );
    assert.strictEqual(
        findFakeNode(noQuestion.nodes['consultation-flow-mount'], node => node.tagName === 'ARTICLE').textContent,
        'generated answer'
    );

    const reviewed = loadControllerRuntime({
        api: {
            async reviewInterpretation() { return { id: 7, verdict: 'accepted' }; }
        }
    });
    reviewed.browserFlow.mount();
    await reviewed.browserFlow.open();
    reviewed.testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_ready',
        saved: { consultationId: 17, readingId: 29 },
        generated: { content: 'output', interpretation: { id: 10 } }
    });
    const reviewForm = findFakeNode(
        reviewed.nodes['consultation-flow-mount'],
        node => node.tagName === 'FORM'
    );
    await reviewForm.dispatch('submit');
    assert.strictEqual(
        reviewed.document.activeElement.id,
        'consultation-review-saved-status'
    );
}

async function testReviewSubmitGuardsDuplicateAndAllowsRetry() {
    const reviewGate = deferred();
    let reviewCalls = 0;
    const controller = loadControllerRuntime({
        api: {
            async reviewInterpretation() {
                reviewCalls += 1;
                return reviewGate.promise;
            }
        }
    });
    const { browserFlow, testFlow, nodes } = controller;
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_ready',
        saved: { consultationId: 17, readingId: 29 },
        generated: { content: 'output', interpretation: { id: 9 } }
    });
    const form = findFakeNode(nodes['consultation-flow-mount'], node => node.tagName === 'FORM');
    const submit = findFakeNode(form, node => node.tagName === 'BUTTON' && node.type === 'submit');
    const first = form.dispatch('submit');
    const second = form.dispatch('submit');
    assert.strictEqual(reviewCalls, 1);
    assert.strictEqual(submit.disabled, true);
    reviewGate.resolve({ id: 1 });
    await Promise.all([first, second]);

    let retryCalls = 0;
    const retryController = loadControllerRuntime({
        api: {
            async reviewInterpretation() {
                retryCalls += 1;
                if (retryCalls === 1) throw new Error('temporary failure');
                return { id: 2 };
            }
        }
    });
    retryController.browserFlow.mount();
    await retryController.browserFlow.open();
    retryController.testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_ready',
        saved: { consultationId: 17, readingId: 29 },
        generated: { content: 'output', interpretation: { id: 10 } }
    });
    const retryForm = findFakeNode(
        retryController.nodes['consultation-flow-mount'],
        node => node.tagName === 'FORM'
    );
    const retrySubmit = findFakeNode(
        retryForm,
        node => node.tagName === 'BUTTON' && node.type === 'submit'
    );
    await retryForm.dispatch('submit');
    assert.strictEqual(retrySubmit.disabled, false);
    await retryForm.dispatch('submit');
    assert.strictEqual(retryCalls, 2);
}

async function testStaleReviewCannotMutateAfterCloseOrReset() {
    for (const invalidate of ['close', 'reset']) {
        for (const outcome of ['resolve', 'reject']) {
            const reviewGate = deferred();
            let reviewCalls = 0;
            const controller = loadControllerRuntime({
                api: {
                    async reviewInterpretation() {
                        reviewCalls += 1;
                        return reviewGate.promise;
                    }
                }
            });
            const { browserFlow, testFlow, nodes } = controller;
            browserFlow.mount();
            await browserFlow.open();
            testFlow.setDraftForTest({
                ...completeDraft(),
                phase: 'review_ready',
                saved: { consultationId: 17, readingId: 29 },
                generated: { content: 'old output', interpretation: { id: 9 } }
            });
            const form = findFakeNode(
                nodes['consultation-flow-mount'],
                node => node.tagName === 'FORM'
            );
            const pendingSubmit = form.dispatch('submit');
            assert.strictEqual(reviewCalls, 1);
            if (invalidate === 'close') browserFlow.close();
            else browserFlow.reset();
            testFlow.setDraftForTest({
                ...createInitialDraft(),
                phase: 'choosing_type',
                userQuery: `fresh-${invalidate}-${outcome}`
            });
            nodes['consultation-flow-status'].textContent = 'fresh status';
            if (outcome === 'resolve') reviewGate.resolve({ id: 88 });
            else reviewGate.reject(new Error('stale review failure'));
            await pendingSubmit;

            assert.strictEqual(
                testFlow.getDraft().userQuery,
                `fresh-${invalidate}-${outcome}`
            );
            assert.ok(findFakeNode(
                nodes['consultation-flow-mount'],
                node => node.dataset && node.dataset.flowAction === 'type-none'
            ));
            assert.strictEqual(
                nodes['consultation-flow-status'].textContent,
                'fresh status'
            );
        }
    }
}

async function testModuleDefaultSpreadClearsOldCards() {
    const { browserFlow, testFlow, nodes } = loadControllerRuntime();
    browserFlow.mount();
    await browserFlow.open();
    const oldCards = Array.from({ length: 5 }, (_, index) => ({
        slot: index + 1,
        slotLabel: `Slot ${index + 1}`,
        cardId: index,
        isReversed: false
    }));
    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'choosing_type',
        questionMode: 'none',
        templateKey: 'free',
        templateName: 'Free Spread',
        freeCount: 5,
        cards: oldCards
    });
    const moduleButton = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'type-general_reading'
    );
    await moduleButton.dispatch('click');
    const nextDraft = testFlow.getDraft();
    assert.strictEqual(nextDraft.templateKey, 'three_timeline');
    assert.strictEqual(nextDraft.cards.length, 0);
}

async function testChoiceModuleRendersRegistryFieldsAndValidatesBeforeSpread() {
    const { browserFlow, testFlow, nodes } = loadControllerRuntime({
        api: {
            async loadConsultationModules() {
                return [generalModule, choiceModule];
            }
        }
    });
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({
        ...createInitialDraft(),
        phase: 'choosing_type',
        modulePayload: { relationshipContext: '旧模块残留' }
    });

    const choiceButton = findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'type-choice_compare'
    );
    assert.ok(choiceButton);
    await choiceButton.dispatch('click');
    assert.strictEqual(testFlow.getDraft().templateKey, 'choice_six');
    assert.deepStrictEqual(Object.keys(testFlow.getDraft().modulePayload), []);

    const detailInputs = collectFakeNodes(
        nodes['consultation-flow-mount'],
        node => node.tagName === 'TEXTAREA'
    );
    assert.deepStrictEqual(
        detailInputs.map(node => node.name),
        ['optionA', 'optionB', 'decisionPriorities']
    );
    assert.strictEqual(detailInputs[0].placeholder, '填写选项 A');
    assert.strictEqual(String(detailInputs[0].getAttribute('required')), 'true');
    assert.strictEqual(String(detailInputs[0].getAttribute('maxLength')), '120');

    let next = findFakeNode(
        nodes['consultation-flow-actions'],
        node => node.dataset && node.dataset.flowAction === 'details-next'
    );
    await next.dispatch('click');
    assert.strictEqual(nodes['consultation-flow-status'].textContent, '请填写选项 A');
    assert.ok(findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.name === 'optionA'
    ));

    const optionA = findFakeNode(nodes['consultation-flow-mount'], node => node.name === 'optionA');
    const optionB = findFakeNode(nodes['consultation-flow-mount'], node => node.name === 'optionB');
    optionA.value = '留任';
    optionB.value = '跳槽';
    await optionA.dispatch('input');
    await optionB.dispatch('input');
    next = findFakeNode(
        nodes['consultation-flow-actions'],
        node => node.dataset && node.dataset.flowAction === 'details-next'
    );
    await next.dispatch('click');

    assert.ok(findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'spread-choice_six'
    ));
    assert.strictEqual(findFakeNode(
        nodes['consultation-flow-mount'],
        node => node.dataset && node.dataset.flowAction === 'spread-three_timeline'
    ), null);
}

async function testPersistDraftCardsRoutesConsultationOnce() {
    const draft = completeDraft();
    const originalCards = draft.cards;
    const originalDraft = JSON.parse(JSON.stringify(draft));
    const cards = draft.cards.map(card => ({ ...card }));
    const calls = { consultation: [], reading: [] };
    const created = { id: 17, readingId: 29, publicId: 'consultation-17' };
    const deps = {
        deck,
        api: {
            async createConsultation(payload) {
                calls.consultation.push(payload);
                return created;
            },
            async createReading(payload) {
                calls.reading.push(payload);
                return { id: 99 };
            }
        }
    };

    const result = await persistDraftCards(draft, cards, deps);

    assert.deepStrictEqual(result, {
        consultationId: 17,
        readingId: 29,
        created,
        operation: 'consultation'
    });
    assert.deepStrictEqual(calls.consultation, [
        buildConsultationPayload({ ...draft, cards }, deck)
    ]);
    assert.strictEqual(calls.reading.length, 0);
    assert.deepStrictEqual(draft, originalDraft);
    assert.strictEqual(draft.cards, originalCards);
}

async function testPersistDraftCardsRoutesReadingOnce() {
    const draft = {
        ...createInitialDraft(),
        templateKey: 'free',
        templateName: 'Free Spread',
        spreadNumber: 5
    };
    const cards = [
        { slot: 1, slotLabel: 'Slot 1', cardId: 2, isReversed: true }
    ];
    const calls = { consultation: [], reading: [] };
    const created = { id: 31, createdAt: '2026-07-13T00:00:00Z' };
    const deps = {
        deck,
        api: {
            async createConsultation(payload) {
                calls.consultation.push(payload);
                return { id: 100, readingId: 101 };
            },
            async createReading(payload) {
                calls.reading.push(payload);
                return created;
            }
        }
    };

    const result = await persistDraftCards(draft, cards, deps);

    assert.deepStrictEqual(result, {
        consultationId: null,
        readingId: 31,
        created,
        operation: 'reading'
    });
    assert.deepStrictEqual(calls.reading, [
        buildReadingPayload({ ...draft, cards }, deck)
    ]);
    assert.strictEqual(calls.consultation.length, 0);
    assert.deepStrictEqual(draft.cards, []);
}

async function testRunSavedInterpretationStreamsAndSelectsLatestComplete() {
    const oldComplete = {
        id: 4,
        created_at: '2026-07-12T08:00:00Z',
        generation_status: 'complete',
        content: 'old'
    };
    const sameTimeLowerId = {
        id: 7,
        created_at: '2026-07-13T08:00:00Z',
        generation_status: 'complete',
        content: 'same-time older id'
    };
    const latestComplete = {
        id: 8,
        created_at: '2026-07-13T08:00:00Z',
        generation_status: 'complete',
        content: 'latest complete'
    };
    const newerPartial = {
        id: 9,
        created_at: '2026-07-13T09:00:00Z',
        generation_status: 'partial',
        content: 'partial'
    };
    const seenEvents = [];
    const streamCalls = [];
    const loadCalls = [];
    const signal = { name: 'abort-signal' };
    const deps = {
        async *streamInterpretation(readingId, options) {
            streamCalls.push({ readingId, options });
            yield { chunk: 'first ' };
            yield { chunk: 'second' };
            yield { done: true };
        },
        api: {
            async loadConsultation(consultationId) {
                loadCalls.push(consultationId);
                return {
                    interpretations: [
                        oldComplete,
                        newerPartial,
                        sameTimeLowerId,
                        latestComplete
                    ]
                };
            }
        }
    };

    const result = await runSavedInterpretation(
        { readingId: 29, consultationId: 17 },
        { style: 'traditional' },
        deps,
        event => seenEvents.push(event),
        signal
    );

    assert.deepStrictEqual(streamCalls, [{
        readingId: 29,
        options: { style: 'traditional', language: 'zh', signal }
    }]);
    assert.deepStrictEqual(seenEvents, [
        { chunk: 'first ' },
        { chunk: 'second' },
        { done: true }
    ]);
    assert.deepStrictEqual(loadCalls, [17]);
    assert.deepStrictEqual(result, {
        content: 'first second',
        done: true,
        interpretation: latestComplete
    });
}

async function testRunSavedInterpretationWithoutConsultation() {
    let loadCount = 0;
    const deps = {
        async *streamInterpretation() {
            yield { chunk: 'plain reading' };
            yield { done: true };
        },
        api: {
            async loadConsultation() {
                loadCount += 1;
                return { interpretations: [] };
            }
        }
    };

    const result = await runSavedInterpretation(
        { readingId: 31, consultationId: null },
        { style: 'psychological' },
        deps
    );

    assert.deepStrictEqual(result, {
        content: 'plain reading',
        done: true,
        interpretation: null
    });
    assert.strictEqual(loadCount, 0);
}

async function testRunSavedInterpretationConvertsStreamError() {
    const seenEvents = [];
    const deps = {
        async *streamInterpretation() {
            yield { chunk: 'partial' };
            yield { error: 'concurrent', message: 'Interpretation is busy' };
        },
        api: {
            async loadConsultation() {
                throw new Error('must not load after stream error');
            }
        }
    };

    await assert.rejects(
        runSavedInterpretation(
            { readingId: 3, consultationId: 5 },
            { style: 'traditional' },
            deps,
            event => seenEvents.push(event)
        ),
        error => {
            assert.strictEqual(error.message, 'Interpretation is busy');
            assert.strictEqual(error.code, 'concurrent');
            return true;
        }
    );
    assert.deepStrictEqual(seenEvents, [
        { chunk: 'partial' },
        { error: 'concurrent', message: 'Interpretation is busy' }
    ]);
}

async function testRunSavedInterpretationRejectsEarlyEnd() {
    const deps = {
        async *streamInterpretation() {
            yield { chunk: 'unfinished' };
        },
        api: {
            async loadConsultation() {
                throw new Error('must not load before done');
            }
        }
    };

    await assert.rejects(
        runSavedInterpretation(
            { readingId: 3, consultationId: 5 },
            { style: 'traditional' },
            deps
        ),
        /ended before done/
    );
}

async function testSubmitReviewRejectsInvalidInputs() {
    let reviewCount = 0;
    const deps = {
        api: {
            async reviewInterpretation() {
                reviewCount += 1;
            }
        }
    };

    await assert.rejects(
        submitReview(10, { verdict: 'pending' }, deps),
        /请选择审核结论/
    );
    await assert.rejects(
        submitReview(10, { verdict: 'edited', editedContent: '   ' }, deps),
        /编辑后的理想答案不能为空/
    );
    for (const rating of [0, 6, 'not-a-number']) {
        await assert.rejects(
            submitReview(10, { verdict: 'accepted', rating }, deps),
            /评分应为 1–5/
        );
    }
    await assert.rejects(
        submitReview(10, { verdict: 'pending', rating: 0 }, deps),
        /请选择审核结论/
    );
    assert.strictEqual(reviewCount, 0);
}

function testValidateReviewReturnsFieldErrors() {
    assert.deepStrictEqual(validateReview({ verdict: 'accepted' }), {});
    assert.deepStrictEqual(validateReview({ verdict: 'rejected', rating: 1 }), {});
    assert.deepStrictEqual(validateReview({ verdict: 'edited', editedContent: '  revised  ', rating: '5' }), {});

    assert.deepStrictEqual(
        validateReview({ verdict: 'pending' }),
        { verdict: '请选择审核结论' }
    );
    assert.deepStrictEqual(
        validateReview({ verdict: 'edited', editedContent: '   ' }),
        { editedContent: '编辑后的理想答案不能为空' }
    );
    for (const rating of [NaN, 0, 6, 1.5, 'not-a-number']) {
        assert.deepStrictEqual(
            validateReview({ verdict: 'accepted', rating }),
            { rating: '评分应为 1–5' }
        );
    }
}

async function testSubmitReviewNormalizesSuccessfulPayloads() {
    const calls = [];
    const deps = {
        api: {
            async reviewInterpretation(interpretationId, payload) {
                calls.push({ interpretationId, payload });
                return { saved: calls.length };
            }
        }
    };

    const editedResult = await submitReview(21, {
        verdict: 'edited',
        rating: '5',
        issueTags: ['空泛套话'],
        reviewNote: '  needs a concrete action  ',
        editedContent: '  revised interpretation  ',
        privacyConfirmed: 'true'
    }, deps);
    const acceptedResult = await submitReview(22, {
        verdict: 'accepted',
        issueTags: 'not-an-array'
    }, deps);

    assert.deepStrictEqual(editedResult, { saved: 1 });
    assert.deepStrictEqual(acceptedResult, { saved: 2 });
    assert.deepStrictEqual(calls, [
        {
            interpretationId: 21,
            payload: {
                verdict: 'edited',
                rating: 5,
                issueTags: ['空泛套话'],
                reviewNote: 'needs a concrete action',
                editedContent: 'revised interpretation',
                privacyConfirmed: false
            }
        },
        {
            interpretationId: 22,
            payload: {
                verdict: 'accepted',
                rating: null,
                issueTags: [],
                reviewNote: '',
                editedContent: '',
                privacyConfirmed: false
            }
        }
    ]);
}

async function testCapturedReadingUsesActiveConsultationFlow() {
    const { persistCapturedReading } = require('../js/history.js');
    const cards = [{ slot: 1, cardId: 0, isReversed: false }];
    const calls = [];
    const expected = { readingId: 41, consultationId: 12 };
    const runtime = {
        ConsultationFlow: {
            hasActiveDraft: () => true,
            async saveAcquiredCards(receivedCards, meta) {
                calls.push({ receivedCards, meta });
                return expected;
            }
        },
        TarotAPI: {
            async saveReading() {
                throw new Error('legacy save must be bypassed');
            }
        }
    };

    const result = await persistCapturedReading(
        3,
        cards,
        { templateKey: 'free', spreadNumber: 999 },
        runtime
    );

    assert.strictEqual(result, expected);
    assert.deepStrictEqual(calls, [{
        receivedCards: cards,
        meta: { templateKey: 'free', spreadNumber: 3 }
    }]);
}

async function testCapturedReadingFallsBackToLegacyApi() {
    const { persistCapturedReading } = require('../js/history.js');
    const cards = [{ slot: 1, cardId: 2, isReversed: true }];
    const calls = [];
    const created = { id: 52 };
    const runtime = {
        ConsultationFlow: { hasActiveDraft: () => false },
        TarotAPI: {
            async saveReading(spreadNumber, payload) {
                calls.push({ spreadNumber, payload });
                return created;
            }
        }
    };

    const result = await persistCapturedReading(
        4,
        cards,
        { templateName: 'Free', spreadNumber: 999 },
        runtime
    );

    assert.deepStrictEqual(result, {
        readingId: 52,
        consultationId: null,
        created
    });
    assert.deepStrictEqual(calls, [{
        spreadNumber: 4,
        payload: { templateName: 'Free', spreadNumber: 4, cards }
    }]);
}

async function testCapturedReadingSkipsEmptyCardsAndMissingApi() {
    const { persistCapturedReading } = require('../js/history.js');
    let activeSaveCount = 0;
    const activeRuntime = {
        ConsultationFlow: {
            hasActiveDraft: () => true,
            async saveAcquiredCards() {
                activeSaveCount += 1;
            }
        }
    };

    assert.strictEqual(await persistCapturedReading(1, [], {}, activeRuntime), null);
    assert.strictEqual(await persistCapturedReading(1, [{ cardId: 0 }], {}, {}), null);
    assert.strictEqual(await persistCapturedReading(1, [], {}), null);
    assert.strictEqual(activeSaveCount, 0);
}

async function testSettleCapturedReadingConsumesRejectionAndSettlesOnce() {
    const { settleCapturedReading } = require('../js/history.js');

    const successGate = deferred();
    let successSettled = 0;
    const successErrors = [];
    const successPending = settleCapturedReading(
        successGate.promise,
        () => { successSettled += 1; },
        error => successErrors.push(error.message)
    );
    assert.strictEqual(successSettled, 0);
    successGate.resolve({ readingId: 61 });
    assert.deepStrictEqual(await successPending, { readingId: 61 });
    assert.strictEqual(successSettled, 1);
    assert.deepStrictEqual(successErrors, []);

    const failureGate = deferred();
    let failureSettled = 0;
    const failureErrors = [];
    const failurePending = settleCapturedReading(
        failureGate.promise,
        () => { failureSettled += 1; },
        error => failureErrors.push(error.message)
    );
    failureGate.reject(new Error('captured save failed'));
    assert.strictEqual(await failurePending, null);
    assert.strictEqual(failureSettled, 1);
    assert.deepStrictEqual(failureErrors, ['captured save failed']);
}

async function testCompleteReadingHistoryClearsStaleIdAndUpdatesOnSuccess() {
    const saveGate = deferred();
    const historyList = {
        prepend() {},
        appendChild() {}
    };
    const document = {
        getElementById(id) {
            return id === 'history-list' ? historyList : null;
        },
        createElement() {
            return {
                appendChild() {},
                prepend() {}
            };
        }
    };
    const runtime = {
        addEventListener() {},
        TarotAPI: {
            async saveReading() {
                return saveGate.promise;
            }
        }
    };
    const commonJsModule = { exports: {} };
    const sandbox = {
        window: runtime,
        document,
        module: commonJsModule,
        console,
        zhWithRoman: value => value
    };
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'history.js'),
        'utf8'
    );
    vm.runInNewContext(source, sandbox, { filename: 'history.js' });
    sandbox.resetReadingCapture({ templateKey: 'three_timeline' });
    sandbox.recordConfirmedCard({
        userData: {
            slot: 1,
            slotLabel: '过去 / Past',
            cardId: 0,
            zh: '愚人',
            en: 'The Fool',
            imageFile: 'RWS_Tarot_00_Fool.jpg',
            isReversed: false
        }
    });

    runtime.lastSavedReadingId = 77;
    const pending = sandbox.completeReadingHistory(5);
    assert.strictEqual(runtime.lastSavedReadingId, null);
    saveGate.resolve({ id: 91 });
    const result = await pending;

    assert.strictEqual(result.readingId, 91);
    assert.strictEqual(runtime.lastSavedReadingId, 91);
    assert.strictEqual(await sandbox.completeReadingHistory(6), null);
    assert.strictEqual(runtime.lastSavedReadingId, 91);

    runtime.TarotAPI.saveReading = async () => {
        throw new Error('history save failed');
    };
    sandbox.recordConfirmedCard({
        userData: {
            slot: 1,
            cardId: 1,
            zh: '女祭司',
            en: 'The High Priestess',
            imageFile: 'RWS_Tarot_02_High_Priestess.jpg',
            isReversed: true
        }
    });
    const rejected = sandbox.completeReadingHistory(7);
    assert.strictEqual(runtime.lastSavedReadingId, null);
    await assert.rejects(rejected, /history save failed/);
    assert.strictEqual(runtime.lastSavedReadingId, null);

    runtime.TarotAPI.saveReading = async () => null;
    runtime.lastSavedReadingId = 42;
    sandbox.recordConfirmedCard({
        userData: {
            slot: 1,
            cardId: 2,
            zh: '太阳',
            en: 'The Sun',
            imageFile: 'RWS_Tarot_19_Sun.jpg',
            isReversed: false
        }
    });
    assert.strictEqual(await sandbox.completeReadingHistory(8), null);
    assert.strictEqual(runtime.lastSavedReadingId, null);

    runtime.ConsultationFlow = {
        hasActiveDraft: () => true,
        async saveAcquiredCards() { return undefined; }
    };
    runtime.lastSavedReadingId = 43;
    sandbox.recordConfirmedCard({
        userData: {
            slot: 1,
            cardId: 0,
            zh: '愚人',
            en: 'The Fool',
            imageFile: 'RWS_Tarot_00_Fool.jpg',
            isReversed: false
        }
    });
    assert.strictEqual(await sandbox.completeReadingHistory(9), undefined);
    assert.strictEqual(runtime.lastSavedReadingId, null);
}

function testMainAndSpreadConsultationWiring() {
    const mainSource = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'main.js'),
        'utf8'
    );
    const spreadSource = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'spread.js'),
        'utf8'
    );

    assert.match(
        mainSource,
        /window\.startConsultationSpread\s*=\s*function startConsultationSpread\(\)\s*\{\s*startSpread\(idlePinchedCards\.slice\(\)\);\s*\}/
    );
    assert.match(
        mainSource,
        /if \(action === 'OPEN_CONSULTATION'\)\s*\{\s*if \(window\.ConsultationFlow\) ConsultationFlow\.open\(\);\s*\}/
    );
    const bindIndex = mainSource.indexOf('SpreadTemplates.bindTemplateSelector()');
    const mountIndex = mainSource.indexOf('ConsultationFlow.mount()');
    assert.ok(bindIndex >= 0 && mountIndex > bindIndex);

    const idleHandler = spreadSource.slice(
        spreadSource.indexOf('function handleIdleGestures'),
        spreadSource.indexOf('function _returnHeldCardToRing')
    );
    assert.match(
        idleHandler,
        /if \(window\.ConsultationFlow\)\s*\{\s*ConsultationFlow\.open\(\);\s*return;\s*\}/
    );
    assert.ok(idleHandler.indexOf('ConsultationFlow.open()') < idleHandler.indexOf('startSpread('));

    const confirmHandler = spreadSource.slice(
        spreadSource.indexOf('function confirmCard'),
        spreadSource.indexOf('function dealNextSpread')
    );
    assert.match(
        confirmHandler,
        /const savePromise = completeReadingHistory\(spreadCount\);\s*settleCapturedReading\(\s*savePromise,\s*\(\) => setTimeout\(\(\) => showSpreadPrompt\(\), 800\),\s*error => console\.error\('Failed to persist captured reading:', error\)\s*\);/
    );
    assert.strictEqual((confirmHandler.match(/showSpreadPrompt\(\)/g) || []).length, 1);
}

function testBrowserGlobalExport() {
    const source = fs.readFileSync(require.resolve('../js/consultation_flow.js'), 'utf8');
    const browserWindow = {};
    const sandbox = { globalThis: browserWindow, window: browserWindow };

    vm.runInNewContext(source, sandbox, { filename: 'consultation_flow.js' });

    assert.ok(browserWindow.ConsultationFlow);
    assert.strictEqual(typeof browserWindow.ConsultationFlow.createInitialDraft, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.persistDraftCards, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.runSavedInterpretation, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.validateReview, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.submitReview, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.mount, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.open, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.saveAcquiredCards, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.setDraftForTest, 'undefined');
    assert.strictEqual(browserWindow.ConsultationFlow.createInitialDraft().language, 'zh');
}

const tests = [
    ['initial draft defaults and independence', testInitialDraftDefaultsAndIndependence],
    ['deck search', testDeckSearch],
    ['slot plans', testSlotPlans],
    ['valid complete draft', testValidCompleteDraft],
    ['draft validation errors', testDraftValidationErrors],
    ['optional cards still validate provided cards', testOptionalCardsStillValidateProvidedCards],
    ['save operation selection', testSaveOperationSelection],
    ['consultation payload', testConsultationPayload],
    ['registry driven module fields and payload', testRegistryDrivenModuleFieldsAndPayload],
    ['reading payload', testReadingPayload],
    ['unknown card materialization', testUnknownCardMaterialization],
    ['phase transitions', testPhaseTransitions],
    ['internal phases map to public steps', testInternalPhasesMapToPublicSteps],
    ['Three page consultation flow integration', testThreePageConsultationFlowIntegration],
    ['controller exports state and safe renderers', testControllerExportsStateAndSafeRenderers],
    ['consultation flow CSS contract', testConsultationFlowCssContract],
    ['browser controller mount open close lifecycle', testBrowserControllerMountOpenCloseLifecycle],
    ['finish clears completed consultation before reopen', testFinishClearsCompletedConsultationBeforeReopen],
    ['selection controls expose pressed state', testSelectionControlsExposePressedState],
    ['save acquired cards persists once and copies capture', testSaveAcquiredCardsPersistsOnceAndCopiesCapture],
    ['save acquired cards throws then allows retry', testSaveAcquiredCardsThrowsThenAllowsRetry],
    ['save acquired cards ignores stale close and reset', testSaveAcquiredCardsIgnoresStaleCloseAndReset],
    ['details uses only backend-supported styles', testDetailsUsesOnlyBackendSupportedStyles],
    ['spread changes reconcile cards', testSpreadChangesReconcileCards],
    ['stale save cannot generate after close or reset', testStaleSaveCannotStartGenerationAfterCloseOrReset],
    ['close aborts generation and ignores late events', testCloseAbortsGenerationAndIgnoresLateEvents],
    ['generation progress feedback', testGenerationProgressFeedback],
    ['review privacy follows consultation and verdict', testReviewPrivacyFollowsConsultationAndVerdict],
    ['dynamic form accessibility and review errors', testDynamicFormAccessibilityAndReviewErrors],
    ['focus trap excludes disabled and ancestor-hidden controls', testFocusTrapExcludesDisabledAndAncestorHiddenControls],
    ['completion focus and no-question review eligibility', testCompletionFocusAndNoQuestionReviewEligibility],
    ['review submit guards duplicate and allows retry', testReviewSubmitGuardsDuplicateAndAllowsRetry],
    ['stale review cannot mutate after close or reset', testStaleReviewCannotMutateAfterCloseOrReset],
    ['module default spread clears old cards', testModuleDefaultSpreadClearsOldCards],
    ['choice module renders registry fields and validates before spread', testChoiceModuleRendersRegistryFieldsAndValidatesBeforeSpread],
    ['persist draft cards routes consultation once', testPersistDraftCardsRoutesConsultationOnce],
    ['persist draft cards routes reading once', testPersistDraftCardsRoutesReadingOnce],
    ['run saved interpretation streams and selects latest complete', testRunSavedInterpretationStreamsAndSelectsLatestComplete],
    ['run saved interpretation without consultation', testRunSavedInterpretationWithoutConsultation],
    ['run saved interpretation converts stream error', testRunSavedInterpretationConvertsStreamError],
    ['run saved interpretation rejects early end', testRunSavedInterpretationRejectsEarlyEnd],
    ['validate review returns field errors', testValidateReviewReturnsFieldErrors],
    ['submit review rejects invalid inputs', testSubmitReviewRejectsInvalidInputs],
    ['submit review normalizes successful payloads', testSubmitReviewNormalizesSuccessfulPayloads],
    ['captured reading uses active consultation flow', testCapturedReadingUsesActiveConsultationFlow],
    ['captured reading falls back to legacy API', testCapturedReadingFallsBackToLegacyApi],
    ['captured reading skips empty cards and missing API', testCapturedReadingSkipsEmptyCardsAndMissingApi],
    ['settle captured reading consumes rejection and settles once', testSettleCapturedReadingConsumesRejectionAndSettlesOnce],
    ['complete reading history clears stale id and updates on success', testCompleteReadingHistoryClearsStaleIdAndUpdatesOnSuccess],
    ['main and spread consultation wiring', testMainAndSpreadConsultationWiring],
    ['browser global export', testBrowserGlobalExport]
];

(async function runTests() {
    let passed = 0;
    for (const [name, test] of tests) {
        try {
            await test();
            console.log(`  ok   ${name}`);
            passed += 1;
        } catch (error) {
            console.error(`  FAIL ${name}: ${error.stack || error.message}`);
            process.exitCode = 1;
        }
    }

    console.log(`\nConsultation flow tests: ${passed}/${tests.length} passed`);
})();
