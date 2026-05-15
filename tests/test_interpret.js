/**
 * Frontend tests for js/interpret.js.
 *
 * Runs in Node — we stub the browser globals (fetch, document,
 * localStorage, performance, navigator) enough that the module loads
 * and the network functions execute against mocks.
 *
 * Run:
 *   node tests/test_interpret.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Browser shim ──────────────────────────────────────────────

function makeStreamFromFrames(frames) {
    // ReadableStream-ish: produces one Uint8Array per frame, then closes.
    let i = 0;
    const enc = new TextEncoder();
    return {
        body: {
            getReader() {
                return {
                    async read() {
                        if (i >= frames.length) return { value: undefined, done: true };
                        return { value: enc.encode(frames[i++]), done: false };
                    },
                    releaseLock() { /* noop */ }
                };
            }
        },
        ok: true,
        status: 200
    };
}

function makeContext({ fetchImpl, lang = 'zh' } = {}) {
    const listeners = {};
    const documentEl = {
        documentElement: { lang, dataset: {}, classList: { add() {}, remove() {} } },
        readyState: 'complete',
        addEventListener(type, fn) {
            (listeners[type] = listeners[type] || []).push(fn);
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById() { return null; },
        createElement(tag) {
            const node = {
                tagName: tag.toUpperCase(),
                children: [],
                dataset: {},
                classList: { add() {}, remove() {}, toggle() {} },
                style: {},
                _listeners: {},
                addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
                appendChild(child) { this.children.push(child); return child; },
                setAttribute(k, v) { this[k] = v; },
                set className(v) { this._cls = v; },
                get className() { return this._cls || ''; },
                set textContent(v) { this._text = v; },
                get textContent() { return this._text || ''; },
                set innerHTML(v) { this._html = v; this.children = []; },
                get innerHTML() { return this._html || ''; },
                append(...args) { for (const a of args) this.children.push(a); },
                querySelector() { return null; },
                querySelectorAll() { return []; }
            };
            return node;
        },
        createTextNode(text) { return { _text: text }; }
    };

    const storage = {
        _store: {},
        getItem(k) { return this._store[k] ?? null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
    };

    return vm.createContext({
        globalThis: undefined, // will be filled below
        window: undefined,
        fetch: fetchImpl,
        TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : require('util').TextDecoder,
        TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : require('util').TextEncoder,
        document: documentEl,
        navigator: { clipboard: { writeText: async () => {} } },
        localStorage: storage,
        performance: { now: () => Date.now() },
        AbortController: typeof AbortController !== 'undefined' ? AbortController : class {
            constructor() { this.signal = { aborted: false }; }
            abort() { this.signal.aborted = true; }
        },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        console
    });
}

function loadModule(ctx) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'interpret.js'), 'utf-8');
    // The module's IIFE references `root` as `globalThis || window`. In our
    // Node context, neither exists — we attach the API to `window` and read
    // it back after evaluation.
    ctx.globalThis = ctx;
    ctx.window = ctx;
    vm.runInContext(code, ctx);
    return ctx.AkashicInterpret;
}

// ── Test 1: streamInterpretation parses chunks + done ─────────

async function testStreamingChunks() {
    const frames = [
        'data: {"chunk":"在"}\n\n',
        'data: {"chunk":"过去"}\n\n',
        'data: {"done":true}\n\n'
    ];
    const fetchImpl = async () => makeStreamFromFrames(frames);
    const ctx = makeContext({ fetchImpl });
    const mod = loadModule(ctx);
    const got = [];
    for await (const ev of mod.streamInterpretation(42, {})) got.push(ev);
    assert.deepStrictEqual(got.map(e => e.chunk).filter(Boolean), ['在', '过去']);
    assert.strictEqual(got[got.length - 1].done, true);
}

// ── Test 2: malformed SSE frame is skipped, valid ones yield ─

async function testTolerantSseParser() {
    const frames = [
        ': comment line should be skipped\n\n',
        'data: not-json\n\n',
        'data: {"chunk":"ok"}\n\n',
        'data: {"done":true}\n\n'
    ];
    const fetchImpl = async () => makeStreamFromFrames(frames);
    const ctx = makeContext({ fetchImpl });
    const mod = loadModule(ctx);
    const got = [];
    for await (const ev of mod.streamInterpretation(1, {})) got.push(ev);
    const chunks = got.map(e => e.chunk).filter(Boolean);
    assert.deepStrictEqual(chunks, ['ok']);
}

// ── Test 3: 409 conflict yields the right error code ──────────

async function testConflictError() {
    const fetchImpl = async () => ({ ok: false, status: 409, text: async () => '' });
    const ctx = makeContext({ fetchImpl });
    const mod = loadModule(ctx);
    const got = [];
    for await (const ev of mod.streamInterpretation(1, {})) got.push(ev);
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].error, 'concurrent');
}

// ── Test 4: 404 yields not_found error ─────────────────────────

async function testNotFoundError() {
    const fetchImpl = async () => ({ ok: false, status: 404, text: async () => '' });
    const ctx = makeContext({ fetchImpl });
    const mod = loadModule(ctx);
    const got = [];
    for await (const ev of mod.streamInterpretation(999, {})) got.push(ev);
    assert.strictEqual(got[0].error, 'not_found');
}

// ── Test 5: fetchHealth handles network failure ───────────────

async function testHealthFallback() {
    const fetchImpl = async () => { throw new Error('network unreachable'); };
    const ctx = makeContext({ fetchImpl });
    const mod = loadModule(ctx);
    const health = await mod.fetchHealth();
    assert.strictEqual(health.ollama, 'down');
    assert.strictEqual(health.fallback_available, false);
}

// ── Test 6: fetchHistory returns [] on 404 ────────────────────

async function testHistoryEmpty() {
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => null });
    const ctx = makeContext({ fetchImpl });
    const mod = loadModule(ctx);
    const rows = await mod.fetchHistory(1);
    // Array comes from inside the vm sandbox so it has a different
    // Array constructor than the outer realm — compare a copy.
    assert.deepStrictEqual([...rows], []);
    assert.strictEqual(rows.length, 0);
}

// ── Runner ────────────────────────────────────────────────────

async function main() {
    const tests = [
        ['streaming chunks parse',           testStreamingChunks],
        ['SSE parser tolerates garbage',     testTolerantSseParser],
        ['409 yields concurrent error',      testConflictError],
        ['404 yields not_found error',       testNotFoundError],
        ['fetchHealth fallback on network err', testHealthFallback],
        ['fetchHistory empty on 404',        testHistoryEmpty]
    ];
    let pass = 0;
    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log(`  ok   ${name}`);
            pass += 1;
        } catch (err) {
            console.error(`  FAIL ${name}: ${err.message}`);
            process.exitCode = 1;
        }
    }
    console.log(`\ninterpret frontend tests: ${pass}/${tests.length} passed`);
}

main();
