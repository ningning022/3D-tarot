'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {
    createInitialDraft,
    searchDeck,
    getSlotPlan,
    validateDraft,
    buildReadingPayload,
    buildConsultationPayload,
    chooseSaveOperation,
    nextPhase
} = require('../js/consultation_flow.js');

const deck = [
    { zh: '愚人', en: 'The Fool', file: 'RWS_Tarot_00_Fool.jpg' },
    { zh: '女祭司', en: 'The High Priestess', file: 'RWS_Tarot_02_High_Priestess.jpg' },
    { zh: '太阳', en: 'The Sun', file: 'RWS_Tarot_19_Sun.jpg' }
];

const generalModule = {
    moduleType: 'general_reading',
    questionRequired: true,
    allowedSpreads: ['three_timeline', 'free'],
    defaultSpread: 'three_timeline'
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

function testBrowserGlobalExport() {
    const source = fs.readFileSync(require.resolve('../js/consultation_flow.js'), 'utf8');
    const browserWindow = {};
    const sandbox = { globalThis: browserWindow, window: browserWindow };

    vm.runInNewContext(source, sandbox, { filename: 'consultation_flow.js' });

    assert.ok(browserWindow.ConsultationFlow);
    assert.strictEqual(typeof browserWindow.ConsultationFlow.createInitialDraft, 'function');
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
    ['reading payload', testReadingPayload],
    ['unknown card materialization', testUnknownCardMaterialization],
    ['phase transitions', testPhaseTransitions],
    ['browser global export', testBrowserGlobalExport]
];

let passed = 0;
for (const [name, test] of tests) {
    try {
        test();
        console.log(`  ok   ${name}`);
        passed += 1;
    } catch (error) {
        console.error(`  FAIL ${name}: ${error.stack || error.message}`);
        process.exitCode = 1;
    }
}

console.log(`\nConsultation flow tests: ${passed}/${tests.length} passed`);
