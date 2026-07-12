'use strict';

const assert = require('assert');

function jsonResponse(payload, options = {}) {
    return {
        ok: options.ok !== undefined ? options.ok : true,
        status: options.status || 200,
        statusText: options.statusText || 'OK',
        json: async () => payload
    };
}

async function withFetch(fetchImpl, callback) {
    const originalFetch = global.fetch;
    global.fetch = fetchImpl;
    try {
        return await callback();
    } finally {
        global.fetch = originalFetch;
    }
}

const TarotAPI = require('../js/api.js');

async function testLoadConsultationModules() {
    const expected = [{ key: 'manual', name: '手动咨询' }];
    await withFetch(async (path, options) => {
        assert.strictEqual(path, '/api/consultation-modules');
        assert.strictEqual(options.cache, 'no-store');
        return jsonResponse(expected);
    }, async () => {
        assert.deepStrictEqual(await TarotAPI.loadConsultationModules(), expected);
    });
}

async function testCreateConsultation() {
    const payload = { userQuery: '我应该如何应对当前的工作变化？' };
    const expected = { id: 12, readingId: 34 };
    await withFetch(async (path, options) => {
        assert.strictEqual(path, '/api/consultations');
        assert.strictEqual(options.method, 'POST');
        assert.deepStrictEqual(JSON.parse(options.body), payload);
        assert.strictEqual(options.headers['Content-Type'], 'application/json; charset=utf-8');
        return jsonResponse(expected);
    }, async () => {
        assert.deepStrictEqual(await TarotAPI.createConsultation(payload), expected);
    });
}

async function testCreateReading() {
    const payload = { spreadNumber: 1, cards: [{ cardId: 0 }] };
    const expected = { id: 56 };
    await withFetch(async (path, options) => {
        assert.strictEqual(path, '/api/readings');
        assert.strictEqual(options.method, 'POST');
        assert.deepStrictEqual(JSON.parse(options.body), payload);
        return jsonResponse(expected);
    }, async () => {
        assert.deepStrictEqual(await TarotAPI.createReading(payload), expected);
    });
}

async function testLoadConsultation() {
    const expected = { id: 'consultation/with spaces' };
    await withFetch(async (path, options) => {
        assert.strictEqual(path, '/api/consultations/consultation%2Fwith%20spaces');
        assert.strictEqual(options.cache, 'no-store');
        return jsonResponse(expected);
    }, async () => {
        assert.deepStrictEqual(await TarotAPI.loadConsultation('consultation/with spaces'), expected);
    });
}

async function testReviewInterpretation() {
    const payload = { rating: 5, notes: '解读准确' };
    const expected = { ok: true };
    await withFetch(async (path, options) => {
        assert.strictEqual(path, '/api/interpretations/version%2F7/review');
        assert.strictEqual(options.method, 'PUT');
        assert.deepStrictEqual(JSON.parse(options.body), payload);
        return jsonResponse(expected);
    }, async () => {
        assert.deepStrictEqual(await TarotAPI.reviewInterpretation('version/7', payload), expected);
    });
}

async function testStrictMethodPreservesJsonError() {
    const payload = { error: 'userQuery must be 4-500 characters' };
    await withFetch(async () => jsonResponse(payload, {
        ok: false,
        status: 400,
        statusText: 'Bad Request'
    }), async () => {
        await assert.rejects(
            () => TarotAPI.createConsultation({ userQuery: 'x' }),
            error => {
                assert.strictEqual(error.status, 400);
                assert.deepStrictEqual(error.payload, payload);
                assert.match(error.message, /userQuery/);
                return true;
            }
        );
    });
}

async function testSaveReadingKeepsOfflineFallback() {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await withFetch(async () => {
            throw new Error('network unavailable');
        }, async () => {
            const result = await TarotAPI.saveReading(1, [{ cardId: 0 }]);
            assert.strictEqual(result, null);
        });
    } finally {
        console.warn = originalWarn;
    }
}

async function main() {
    const tests = [
        ['loadConsultationModules GETs modules', testLoadConsultationModules],
        ['createConsultation POSTs JSON', testCreateConsultation],
        ['createReading POSTs reading', testCreateReading],
        ['loadConsultation encodes id', testLoadConsultation],
        ['reviewInterpretation PUTs JSON', testReviewInterpretation],
        ['strict methods preserve JSON errors', testStrictMethodPreservesJsonError],
        ['saveReading keeps offline fallback', testSaveReadingKeepsOfflineFallback]
    ];

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
    console.log(`\nAPI tests: ${passed}/${tests.length} passed`);
}

main();
