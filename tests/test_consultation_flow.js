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
    nextPhase,
    persistDraftCards,
    runSavedInterpretation,
    submitReview
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
        /Unsupported review verdict/
    );
    await assert.rejects(
        submitReview(10, { verdict: 'edited', editedContent: '   ' }, deps),
        /editedContent is required/
    );
    for (const rating of [0, 6, 'not-a-number']) {
        await assert.rejects(
            submitReview(10, { verdict: 'accepted', rating }, deps),
            /rating must be between 1 and 5/
        );
    }
    assert.strictEqual(reviewCount, 0);
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

function testBrowserGlobalExport() {
    const source = fs.readFileSync(require.resolve('../js/consultation_flow.js'), 'utf8');
    const browserWindow = {};
    const sandbox = { globalThis: browserWindow, window: browserWindow };

    vm.runInNewContext(source, sandbox, { filename: 'consultation_flow.js' });

    assert.ok(browserWindow.ConsultationFlow);
    assert.strictEqual(typeof browserWindow.ConsultationFlow.createInitialDraft, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.persistDraftCards, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.runSavedInterpretation, 'function');
    assert.strictEqual(typeof browserWindow.ConsultationFlow.submitReview, 'function');
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
    ['persist draft cards routes consultation once', testPersistDraftCardsRoutesConsultationOnce],
    ['persist draft cards routes reading once', testPersistDraftCardsRoutesReadingOnce],
    ['run saved interpretation streams and selects latest complete', testRunSavedInterpretationStreamsAndSelectsLatestComplete],
    ['run saved interpretation without consultation', testRunSavedInterpretationWithoutConsultation],
    ['run saved interpretation converts stream error', testRunSavedInterpretationConvertsStreamError],
    ['run saved interpretation rejects early end', testRunSavedInterpretationRejectsEarlyEnd],
    ['submit review rejects invalid inputs', testSubmitReviewRejectsInvalidInputs],
    ['submit review normalizes successful payloads', testSubmitReviewNormalizesSuccessfulPayloads],
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
