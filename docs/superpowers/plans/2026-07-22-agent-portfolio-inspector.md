# Agent Portfolio Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a privacy-safe Agent Run Inspector to consultation results, publish an Agent engineering case study, and provide a verified 40-second recording workflow.

**Architecture:** Keep the existing raw trace endpoint for internal debugging and add a server-side `view=summary` projection that only returns allowlisted telemetry. A focused browser module owns trace normalization and rendering; the consultation state machine only mounts, updates, and destroys that module. The portfolio page consumes existing media and checked-in evaluation metrics without changing the generation pipeline.

**Tech Stack:** Python 3 `unittest`, SQLite, stdlib HTTP server, vanilla JavaScript/CommonJS tests, HTML/CSS, existing Qwen2.5/Ollama Agent trace data.

---

## File map

- Modify `interpret_agent.py`: load a trace bundle with its Trace ID and build a privacy-safe summary.
- Modify `server.py`: select raw versus safe summary responses from the existing Agent trace route.
- Modify `tests/test_interpret_agent.py`: unit-test allowlisting, metrics, ordering, empty and degraded traces.
- Modify `tests/test_server.py`: integration-test the `view=summary` query contract and raw compatibility.
- Modify `js/api.js`: add `loadAgentRunSummary(readingId)`.
- Modify `tests/test_api.js`: verify path encoding, summary query and no-cache behavior.
- Create `js/agent_trace.js`: normalize untrusted summary JSON and render the expandable Inspector.
- Create `tests/test_agent_trace.js`: test normalization, privacy, UI states, retries and review updates.
- Modify `Three.html`: add a side-column wrapper and load `agent_trace.js` before `consultation_flow.js`.
- Modify `css/consultation_flow.css`: style the Inspector with existing theme tokens.
- Modify `css/responsive.css`: stack the side column below the main result on narrow screens.
- Modify `js/consultation_flow.js`: mount the Inspector only for result/review phases and clean it up safely.
- Modify `tests/test_consultation_flow.js`: test lifecycle integration and update the HTML/CSS contracts.
- Create `docs/portfolio/akashic-agent-case-study.html`: standalone Agent engineering case study.
- Create `tests/test_portfolio_case_study.py`: prevent metric drift, broken links and unfinished copy.
- Create `docs/demo/agent-trace-recording-script.md`: exact 40-second recording and narration guide.
- Modify `README.md`: add a prominent link to the engineering case study.

## Task 1: Build the safe trace summary in the domain module

**Files:**
- Modify: `interpret_agent.py:141-178`
- Modify: `tests/test_interpret_agent.py:35-118`

- [ ] **Step 1: Write failing trace bundle and summary tests**

Add the following class after `TestRecordAndLoad` in `tests/test_interpret_agent.py`:

```python
class TestTraceSummary(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def tearDown(self):
        self.conn.close()

    def _record(self, trace_id, index, name, output, *, model=None,
                duration_ms=10, ok=True, input_summary="secret question",
                error="secret path D:/private"):
        interpret_agent.record_step(
            self.conn,
            reading_id=15,
            trace_id=trace_id,
            step_index=index,
            step=interpret_agent.AgentStep(
                step=name,
                model=model,
                duration_ms=duration_ms,
                input_summary=input_summary,
                output=output,
                ok=ok,
                error=error if not ok else None,
            ),
        )

    def test_load_trace_run_keeps_trace_id_without_changing_load_trace(self):
        trace_id = "a" * 32
        self._record(trace_id, 0, "classify", {"topic": "growth"})

        run = interpret_agent.load_trace_run(self.conn, 15)

        self.assertEqual(run["trace_id"], trace_id)
        self.assertEqual(run["steps"][0]["step"], "classify")
        self.assertNotIn("trace_id", interpret_agent.load_trace(self.conn, 15)[0])

    def test_summary_allowlists_outputs_and_computes_metrics(self):
        trace_id = "b" * 32
        self._record(
            trace_id, 2, "generate",
            {"length": 308, "preview": "private answer", "prompt_hash": "96405ccdbf7c51ef"},
            model="ollama:qwen2.5:7b", duration_ms=21202,
        )
        self._record(
            trace_id, 0, "classify",
            {"topic": "growth", "intent": "clarity", "tone": "neutral", "secret": "drop"},
            model="qwen2.5:7b", duration_ms=27952,
        )
        self._record(
            trace_id, 3, "critique",
            {"score": 8, "issues": ["too_listy"], "needs_retry": False,
             "summary": "private critique prose"},
            model="qwen2.5:7b", duration_ms=7327,
        )
        self._record(
            trace_id, 1, "retrieve",
            {"count": 6, "entries": [{"card_id": 38, "orientation": "reversed",
                                        "score": 1.0, "text": "private corpus"}],
             "topic_bias": "growth"},
            duration_ms=0,
        )

        summary = interpret_agent.summarize_trace_run(
            15, interpret_agent.load_trace_run(self.conn, 15)
        )
        serialized = json.dumps(summary, ensure_ascii=False)

        self.assertEqual([step["step"] for step in summary["steps"]],
                         ["classify", "retrieve", "generate", "critique"])
        self.assertEqual(summary["trace_id"], trace_id)
        self.assertEqual(summary["status"], "complete")
        self.assertEqual(summary["metrics"], {
            "total_duration_ms": 56481,
            "model": "ollama:qwen2.5:7b",
            "rag_hits": 6,
            "critique_score": 8,
        })
        self.assertNotIn("secret question", serialized)
        self.assertNotIn("secret path", serialized)
        self.assertNotIn("private answer", serialized)
        self.assertNotIn("private corpus", serialized)
        self.assertNotIn("private critique prose", serialized)
        self.assertNotIn('"secret"', serialized)

    def test_summary_handles_empty_unknown_and_failed_steps(self):
        empty = interpret_agent.summarize_trace_run(
            99, {"trace_id": None, "steps": []}
        )
        self.assertEqual(empty, {
            "reading_id": 99,
            "trace_id": None,
            "status": "unavailable",
            "metrics": {},
            "steps": [],
        })

        trace_id = "c" * 32
        self._record(trace_id, 7, "future_step", {"private": "drop"}, ok=False)
        degraded = interpret_agent.summarize_trace_run(
            15, interpret_agent.load_trace_run(self.conn, 15)
        )
        self.assertEqual(degraded["status"], "degraded")
        self.assertEqual(degraded["steps"][0]["output"], {})
        self.assertTrue(degraded["steps"][0]["has_error"])
        self.assertNotIn("error", degraded["steps"][0])

        malformed = interpret_agent.summarize_trace_run(15, {
            "trace_id": trace_id,
            "steps": [{
                "step": "retrieve", "step_index": "not-a-number",
                "duration_ms": "bad", "ok": True,
                "output": {"count": "bad", "entries": [], "topic_bias": None},
            }],
        })
        self.assertEqual(malformed["steps"][0]["duration_ms"], 0)
        self.assertEqual(malformed["steps"][0]["output"]["count"], 0)
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
python -m unittest tests.test_interpret_agent.TestTraceSummary -v
```

Expected: `ERROR` because `load_trace_run` and `summarize_trace_run` do not exist.

- [ ] **Step 3: Implement trace bundles and the allowlisted summary**

Replace the current `load_trace` implementation in `interpret_agent.py` with the following functions:

```python
SUMMARY_STEP_ORDER = ("classify", "retrieve", "generate", "critique")


def load_trace_run(conn: sqlite3.Connection, reading_id: int) -> dict:
    """Return the latest trace id and its ordered raw steps."""
    row = conn.execute(
        """SELECT trace_id FROM agent_steps
           WHERE reading_id = ?
           ORDER BY id DESC LIMIT 1""",
        (reading_id,),
    ).fetchone()
    if row is None:
        return {"trace_id": None, "steps": []}
    trace_id = row[0] if not isinstance(row, sqlite3.Row) else row["trace_id"]
    rows = conn.execute(
        """SELECT step_index, step, model, duration_ms, input_summary,
                  output_json, ok, error, created_at
           FROM agent_steps
           WHERE reading_id = ? AND trace_id = ?
           ORDER BY step_index ASC""",
        (reading_id, trace_id),
    ).fetchall()
    steps = []
    for row_value in rows:
        step = dict(row_value) if isinstance(row_value, sqlite3.Row) else {
            "step_index": row_value[0], "step": row_value[1],
            "model": row_value[2], "duration_ms": row_value[3],
            "input_summary": row_value[4], "output_json": row_value[5],
            "ok": row_value[6], "error": row_value[7],
            "created_at": row_value[8],
        }
        try:
            step["output"] = json.loads(step.pop("output_json") or "{}")
        except json.JSONDecodeError:
            step["output"] = {}
        step["ok"] = bool(step["ok"])
        steps.append(step)
    return {"trace_id": trace_id, "steps": steps}


def load_trace(conn: sqlite3.Connection, reading_id: int) -> list[dict]:
    """Backward-compatible raw step list for internal diagnostics."""
    return load_trace_run(conn, reading_id)["steps"]


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def _summary_output(step_name: str, output: object) -> dict:
    source = output if isinstance(output, dict) else {}
    if step_name == "classify":
        return {
            key: source[key]
            for key in ("topic", "intent", "tone")
            if isinstance(source.get(key), str)
        }
    if step_name == "retrieve":
        entries = []
        for raw in source.get("entries", []):
            if not isinstance(raw, dict):
                continue
            entries.append({
                key: raw[key]
                for key in ("card_id", "orientation", "score")
                if key in raw and isinstance(raw[key], (str, int, float))
            })
        return {
            "count": max(0, _safe_int(source.get("count"))),
            "entries": entries,
            "topic_bias": source.get("topic_bias")
                if isinstance(source.get("topic_bias"), str) else None,
        }
    if step_name == "generate":
        return {
            "length": max(0, _safe_int(source.get("length"))),
            "prompt_hash": source.get("prompt_hash")
                if isinstance(source.get("prompt_hash"), str) else "",
        }
    if step_name == "critique":
        issues = source.get("issues", [])
        return {
            "score": max(0, min(10, _safe_int(source.get("score")))),
            "issues": [item for item in issues if isinstance(item, str)],
            "needs_retry": bool(source.get("needs_retry", False)),
        }
    return {}


def summarize_trace_run(reading_id: int, run: dict) -> dict:
    """Project a raw run into a privacy-safe portfolio/UI response."""
    raw_steps = run.get("steps", []) if isinstance(run, dict) else []
    trace_id = run.get("trace_id") if isinstance(run, dict) else None
    if not raw_steps:
        return {
            "reading_id": reading_id, "trace_id": trace_id,
            "status": "unavailable", "metrics": {}, "steps": [],
        }

    order = {name: index for index, name in enumerate(SUMMARY_STEP_ORDER)}
    ordered = sorted(
        (step for step in raw_steps if isinstance(step, dict)),
        key=lambda step: (
            order.get(step.get("step"), len(order)),
            _safe_int(step.get("step_index")),
        ),
    )
    steps = []
    for raw in ordered:
        name = str(raw.get("step") or "unknown")
        steps.append({
            "step_index": _safe_int(raw.get("step_index")),
            "step": name,
            "model": raw.get("model") if isinstance(raw.get("model"), str) else None,
            "duration_ms": max(0, _safe_int(raw.get("duration_ms"))),
            "ok": bool(raw.get("ok")),
            "has_error": not bool(raw.get("ok")),
            "output": _summary_output(name, raw.get("output")),
        })

    by_name = {step["step"]: step for step in steps}
    generate = by_name.get("generate", {})
    retrieve = by_name.get("retrieve", {}).get("output", {})
    critique = by_name.get("critique", {}).get("output", {})
    required = set(SUMMARY_STEP_ORDER)
    names = set(by_name)
    status = "complete" if required.issubset(names) and all(
        by_name[name]["ok"] for name in required
    ) else "degraded" if any(not step["ok"] for step in steps) else "partial"
    return {
        "reading_id": reading_id,
        "trace_id": trace_id,
        "status": status,
        "metrics": {
            "total_duration_ms": sum(step["duration_ms"] for step in steps),
            "model": generate.get("model") or next(
                (step["model"] for step in steps if step["model"]), None
            ),
            "rag_hits": _safe_int(retrieve.get("count")),
            "critique_score": critique.get("score"),
        },
        "steps": steps,
    }
```

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
python -m unittest tests.test_interpret_agent.TestRecordAndLoad tests.test_interpret_agent.TestTraceSummary -v
```

Expected: all `TestRecordAndLoad` and `TestTraceSummary` tests pass.

- [ ] **Step 5: Commit the domain change**

```powershell
git add interpret_agent.py tests/test_interpret_agent.py
git commit -m "feat: add safe agent trace summaries"
```

## Task 2: Expose summary mode without breaking raw trace diagnostics

**Files:**
- Modify: `server.py:494-503`
- Modify: `server.py:626-633`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Add failing route tests**

Add these methods to `TarotServerTest` in `tests/test_server.py`:

```python
    def _record_agent_step(self, reading_id, trace_id, index, name, output,
                           *, model=None, duration_ms=10, ok=True):
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            interpret_service.migrate(conn)
            interpret_agent.record_step(
                conn,
                reading_id=reading_id,
                trace_id=trace_id,
                step_index=index,
                step=interpret_agent.AgentStep(
                    step=name,
                    model=model,
                    duration_ms=duration_ms,
                    input_summary="private question",
                    output=output,
                    ok=ok,
                    error="private error" if not ok else None,
                ),
            )

    def test_agent_trace_summary_query_is_safe(self):
        trace_id = "d" * 32
        self._record_agent_step(
            51, trace_id, 0, "classify",
            {"topic": "career", "intent": "decision", "tone": "curious"},
            model="qwen2.5:7b", duration_ms=100,
        )
        self._record_agent_step(
            51, trace_id, 1, "generate",
            {"length": 210, "preview": "private answer", "prompt_hash": "abc123"},
            model="ollama:qwen2.5:7b", duration_ms=900,
        )

        status, _, body = self.request_json(
            "GET", "/api/interpret/51/agent-trace?view=summary"
        )
        payload = json.loads(body)

        self.assertEqual(status, 200)
        self.assertEqual(payload["trace_id"], trace_id)
        self.assertEqual(payload["status"], "partial")
        self.assertNotIn("private question", body.decode("utf-8"))
        self.assertNotIn("private answer", body.decode("utf-8"))

    def test_agent_trace_raw_response_remains_compatible(self):
        trace_id = "e" * 32
        self._record_agent_step(
            52, trace_id, 0, "classify", {"topic": "growth"}
        )

        status, _, body = self.request_json(
            "GET", "/api/interpret/52/agent-trace"
        )
        payload = json.loads(body)

        self.assertEqual(status, 200)
        self.assertEqual(payload["reading_id"], 52)
        self.assertEqual(payload["steps"][0]["input_summary"], "private question")
        self.assertNotIn("trace_id", payload)
```

- [ ] **Step 2: Run the route tests to verify the summary test fails**

Run:

```powershell
python -m unittest tests.test_server.TarotServerTest.test_agent_trace_summary_query_is_safe tests.test_server.TarotServerTest.test_agent_trace_raw_response_remains_compatible -v
```

Expected: the summary test fails because the route ignores `view=summary`; the raw compatibility test passes.

- [ ] **Step 3: Add summary selection to the server**

Replace `interpret_agent_trace` in `server.py` with:

```python
def interpret_agent_trace(reading_id: int, *, summary: bool = False) -> dict:
    """Return the latest raw trace or its privacy-safe UI summary."""
    import interpret_agent
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        run = interpret_agent.load_trace_run(conn, reading_id)
    if summary:
        return interpret_agent.summarize_trace_run(reading_id, run)
    return {"reading_id": reading_id, "steps": run["steps"]}
```

Replace the Agent trace route return statement with:

```python
            view = parse_qs(parsed_url.query).get("view", [""])[0]
            return json_response(
                200,
                interpret_agent_trace(reading_id, summary=view == "summary"),
            )
```

- [ ] **Step 4: Run focused server and Agent tests**

Run:

```powershell
python -m unittest tests.test_server tests.test_interpret_agent -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit the HTTP contract**

```powershell
git add server.py tests/test_server.py
git commit -m "feat: expose safe agent trace summary"
```

## Task 3: Add the browser API method

**Files:**
- Modify: `js/api.js:49-76`
- Modify: `js/api.js:146-160`
- Modify: `tests/test_api.js`

- [ ] **Step 1: Write a failing API client test**

Add to `tests/test_api.js`:

```javascript
async function testLoadAgentRunSummary() {
    const expected = { reading_id: 15, status: 'complete', steps: [] };
    await withFetch(async (path, options) => {
        assert.strictEqual(
            path,
            '/api/interpret/reading%2F15/agent-trace?view=summary'
        );
        assert.strictEqual(options.cache, 'no-store');
        return jsonResponse(expected);
    }, async () => {
        assert.deepStrictEqual(
            await TarotAPI.loadAgentRunSummary('reading/15'),
            expected
        );
    });
}
```

Add it to the `tests` array:

```javascript
        ['loadAgentRunSummary GETs safe trace', testLoadAgentRunSummary],
```

- [ ] **Step 2: Run the API tests to verify the new test fails**

Run:

```powershell
node tests/test_api.js
```

Expected: `FAIL loadAgentRunSummary GETs safe trace` because the method is missing.

- [ ] **Step 3: Implement and export the method**

Add after `loadConsultation` in `js/api.js`:

```javascript
    async function loadAgentRunSummary(readingId) {
        const encoded = encodeURIComponent(readingId);
        return requestJson(
            `/api/interpret/${encoded}/agent-trace?view=summary`,
            { cache: 'no-store' }
        );
    }
```

Add `loadAgentRunSummary` to the returned API object immediately after `loadConsultation`.

- [ ] **Step 4: Run the API tests**

Run:

```powershell
node tests/test_api.js
```

Expected: `API tests: 8/8 passed`.

- [ ] **Step 5: Commit the API client**

```powershell
git add js/api.js tests/test_api.js
git commit -m "feat: add agent trace API client"
```

## Task 4: Build the isolated Agent Run Inspector component

**Files:**
- Create: `js/agent_trace.js`
- Create: `tests/test_agent_trace.js`

- [ ] **Step 1: Write failing normalization tests**

Create `tests/test_agent_trace.js` with:

```javascript
'use strict';

const assert = require('assert');
const AgentTrace = require('../js/agent_trace.js');

function samplePayload() {
    return {
        reading_id: 15,
        trace_id: '725886e681f44cfeb5644d87d9c9cd46',
        status: 'complete',
        metrics: {
            total_duration_ms: 56481,
            model: 'ollama:qwen2.5:7b',
            rag_hits: 6,
            critique_score: 8
        },
        input_summary: 'private question',
        steps: [
            { step_index: 2, step: 'generate', ok: true, duration_ms: 21202,
              model: 'ollama:qwen2.5:7b',
              output: { length: 308, prompt_hash: '96405ccdbf7c51ef',
                        preview: 'private answer' } },
            { step_index: 0, step: 'classify', ok: true, duration_ms: 27952,
              model: 'qwen2.5:7b',
              output: { topic: 'growth', intent: 'clarity', tone: 'neutral' } },
            { step_index: 3, step: 'critique', ok: true, duration_ms: 7327,
              model: 'qwen2.5:7b',
              output: { score: 8, issues: ['too_listy'], needs_retry: false,
                        summary: 'private critic prose' } },
            { step_index: 1, step: 'retrieve', ok: true, duration_ms: 0,
              model: null,
              output: { count: 6,
                        entries: [{ card_id: 38, orientation: 'reversed', score: 1.0 }],
                        topic_bias: 'growth' } }
        ]
    };
}

function testNormalizeSummaryIsOrderedAndPrivate() {
    const normalized = AgentTrace.normalizeSummary(samplePayload());
    const serialized = JSON.stringify(normalized);
    assert.deepStrictEqual(
        normalized.steps.map(step => step.step),
        ['classify', 'retrieve', 'generate', 'critique']
    );
    assert.strictEqual(normalized.traceId, '725886e6');
    assert.strictEqual(normalized.metrics.totalDurationMs, 56481);
    assert.strictEqual(normalized.metrics.ragHits, 6);
    assert.strictEqual(normalized.metrics.critiqueScore, 8);
    assert.ok(!serialized.includes('private question'));
    assert.ok(!serialized.includes('private answer'));
    assert.ok(!serialized.includes('private critic prose'));
}

function testNormalizeSummaryHandlesMissingAndUnknownValues() {
    const normalized = AgentTrace.normalizeSummary({
        status: 'partial',
        steps: [{ step: 'future_step', ok: false, has_error: true,
                  duration_ms: -5, output: { private: 'drop' } }]
    });
    assert.strictEqual(normalized.status, 'partial');
    assert.deepStrictEqual(
        normalized.steps.slice(0, 4).map(step => step.step),
        ['classify', 'retrieve', 'generate', 'critique']
    );
    assert.ok(normalized.steps.slice(0, 4).every(step => step.missing));
    const future = normalized.steps.find(step => step.step === 'future_step');
    assert.strictEqual(future.durationMs, 0);
    assert.deepStrictEqual(future.output, {});
    assert.strictEqual(future.hasError, true);
}

function testFormatDuration() {
    assert.strictEqual(AgentTrace.formatDuration(0), '< 1 ms');
    assert.strictEqual(AgentTrace.formatDuration(7327), '7.33 s');
    assert.strictEqual(AgentTrace.formatDuration(56481), '56.48 s');
}

async function main() {
    const tests = [
        ['normalizes ordered private summary', testNormalizeSummaryIsOrderedAndPrivate],
        ['handles missing and unknown values', testNormalizeSummaryHandlesMissingAndUnknownValues],
        ['formats durations', testFormatDuration]
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
    console.log(`\nAgent trace tests: ${passed}/${tests.length} passed`);
}

main();
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests/test_agent_trace.js
```

Expected: module load fails because `js/agent_trace.js` does not exist.

- [ ] **Step 3: Implement the safe normalization core**

Create `js/agent_trace.js` with this first complete version:

```javascript
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AkashicAgentTrace = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
    'use strict';

    const STEP_ORDER = ['classify', 'retrieve', 'generate', 'critique'];
    const STEP_LABELS = {
        classify: '意图识别 / Classify',
        retrieve: '知识检索 / Retrieve',
        generate: '答案生成 / Generate',
        critique: '安全审查 / Critique'
    };
    const REVIEW_LABELS = {
        accepted: 'Accepted',
        needs_work: 'Needs Work',
        rejected: 'Rejected',
        edited: 'Edited'
    };

    function nonNegative(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, number) : 0;
    }

    function safeOutput(name, raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        if (name === 'classify') return {
            topic: String(source.topic || ''),
            intent: String(source.intent || ''),
            tone: String(source.tone || '')
        };
        if (name === 'retrieve') return {
            count: nonNegative(source.count),
            topicBias: String(source.topic_bias || ''),
            entries: (Array.isArray(source.entries) ? source.entries : []).map(entry => ({
                cardId: nonNegative(entry && entry.card_id),
                orientation: String((entry && entry.orientation) || ''),
                score: nonNegative(entry && entry.score)
            }))
        };
        if (name === 'generate') return {
            length: nonNegative(source.length),
            promptHash: String(source.prompt_hash || '').slice(0, 12)
        };
        if (name === 'critique') return {
            score: Math.min(10, nonNegative(source.score)),
            issues: (Array.isArray(source.issues) ? source.issues : [])
                .filter(item => typeof item === 'string'),
            needsRetry: Boolean(source.needs_retry)
        };
        return {};
    }

    function normalizeSummary(payload) {
        const source = payload && typeof payload === 'object' ? payload : {};
        const order = new Map(STEP_ORDER.map((name, index) => [name, index]));
        const rawSteps = (Array.isArray(source.steps) ? source.steps : [])
            .filter(step => step && typeof step === 'object')
            .map(step => {
                const name = String(step.step || 'unknown');
                return {
                    step: name,
                    label: STEP_LABELS[name] || name,
                    ok: Boolean(step.ok),
                    hasError: Boolean(step.has_error),
                    missing: false,
                    durationMs: nonNegative(step.duration_ms),
                    model: typeof step.model === 'string' ? step.model : '',
                    output: safeOutput(name, step.output)
                };
            })
            .sort((left, right) => (
                (order.get(left.step) ?? STEP_ORDER.length)
                - (order.get(right.step) ?? STEP_ORDER.length)
            ));
        const byName = new Map(rawSteps.map(step => [step.step, step]));
        const missingStep = name => ({
            step: name,
            label: STEP_LABELS[name],
            ok: false,
            hasError: false,
            missing: true,
            durationMs: 0,
            model: '',
            output: safeOutput(name, {})
        });
        const steps = [
            ...STEP_ORDER.map(name => byName.get(name) || missingStep(name)),
            ...rawSteps.filter(step => !order.has(step.step))
        ];
        const metrics = source.metrics && typeof source.metrics === 'object'
            ? source.metrics : {};
        return {
            readingId: nonNegative(source.reading_id),
            traceId: String(source.trace_id || '').slice(0, 8),
            status: ['complete', 'partial', 'degraded', 'unavailable'].includes(source.status)
                ? source.status : 'unavailable',
            metrics: {
                totalDurationMs: nonNegative(metrics.total_duration_ms),
                model: typeof metrics.model === 'string' ? metrics.model : '',
                ragHits: nonNegative(metrics.rag_hits),
                critiqueScore: metrics.critique_score == null
                    ? null : Math.min(10, nonNegative(metrics.critique_score))
            },
            steps
        };
    }

    function formatDuration(value) {
        const milliseconds = nonNegative(value);
        if (milliseconds < 1) return '< 1 ms';
        if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
        return `${(milliseconds / 1000).toFixed(2)} s`;
    }

    return { normalizeSummary, formatDuration };
});
```

- [ ] **Step 4: Run normalization tests**

Run:

```powershell
node tests/test_agent_trace.js
```

Expected: `Agent trace tests: 3/3 passed`.

- [ ] **Step 5: Add failing component lifecycle tests**

Before `main` in `tests/test_agent_trace.js`, add a small fake DOM and two tests:

```javascript
function fakeDocument() {
    const document = {
        createElement(tagName) {
            const listeners = {};
            return {
                tagName: tagName.toUpperCase(), children: [], attributes: {},
                hidden: false, textContent: '', className: '', disabled: false,
                append(...items) { this.children.push(...items); },
                replaceChildren(...items) { this.children = [...items]; },
                setAttribute(name, value) { this.attributes[name] = String(value); },
                addEventListener(name, listener) { listeners[name] = listener; },
                async click() { if (listeners.click) await listeners.click(); }
            };
        }
    };
    return document;
}

function flattenText(node) {
    return [node.textContent, ...(node.children || []).map(flattenText)].join(' ');
}

async function testMountLoadsOnceAndNeverRendersSecrets() {
    const document = fakeDocument();
    const container = document.createElement('aside');
    let calls = 0;
    const controller = AgentTrace.mount(container, {
        document,
        readingId: 15,
        async loadSummary() { calls += 1; return samplePayload(); }
    });
    await controller.toggle();
    await controller.toggle();
    await controller.toggle();
    const text = flattenText(container);
    assert.strictEqual(calls, 1);
    assert.ok(text.includes('Agent Run'));
    assert.ok(text.includes('56.48 s'));
    assert.ok(text.includes('#38 reversed 1.00'));
    assert.ok(!text.includes('private question'));
    assert.ok(!text.includes('private answer'));
    controller.destroy();
    assert.strictEqual(container.children.length, 0);
}

async function testMountRetriesAndUpdatesReview() {
    const document = fakeDocument();
    const container = document.createElement('aside');
    let calls = 0;
    const controller = AgentTrace.mount(container, {
        document,
        readingId: 15,
        async loadSummary() {
            calls += 1;
            if (calls === 1) throw new Error('network secret');
            return samplePayload();
        }
    });
    await controller.toggle();
    assert.ok(flattenText(container).includes('轨迹暂不可用'));
    await controller.toggle();
    controller.updateReview({ verdict: 'accepted' });
    assert.ok(flattenText(container).includes('Accepted'));
    assert.ok(!flattenText(container).includes('network secret'));
}
```

Add both tests to the `tests` array:

```javascript
        ['loads once without rendering secrets', testMountLoadsOnceAndNeverRendersSecrets],
        ['retries and updates review', testMountRetriesAndUpdatesReview],
```

- [ ] **Step 6: Run the component tests to verify they fail**

Run:

```powershell
node tests/test_agent_trace.js
```

Expected: two failures because `mount` is not exported.

- [ ] **Step 7: Add the DOM renderer and controller**

Add these functions before the return statement in `js/agent_trace.js`:

```javascript
    function element(document, tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        Object.entries(attrs).forEach(([name, value]) => {
            if (name === 'className') node.className = value;
            else if (name === 'textContent') node.textContent = value;
            else node.setAttribute(name, value);
        });
        node.append(...children.filter(Boolean));
        return node;
    }

    function retrieveDetail(step) {
        const entries = step.output.entries.slice(0, 6)
            .map(entry => `#${entry.cardId} ${entry.orientation || 'unknown'} ${entry.score.toFixed(2)}`)
            .join(' · ');
        return `${step.output.count} hits · ${step.output.topicBias || 'no bias'}`
            + (entries ? ` · ${entries}` : '');
    }

    function stepDetail(document, step) {
        const summary = step.missing
            ? '未记录 / Not recorded'
            : step.step === 'classify'
            ? `${step.output.topic} · ${step.output.intent} · ${step.output.tone}`
            : step.step === 'retrieve'
                ? retrieveDetail(step)
                : step.step === 'generate'
                    ? `${step.model} · ${step.output.length} chars · ${step.output.promptHash}`
                    : step.step === 'critique'
                        ? `${step.output.score}/10 · ${step.output.needsRetry ? 'retry' : 'no retry'} · ${step.output.issues.join(', ') || 'no issues'}`
                        : '未识别的步骤';
        const stateClass = step.missing ? 'is-missing' : step.ok ? 'is-ok' : 'is-error';
        const stateText = step.missing ? '–' : step.ok ? '✓' : '!';
        return element(document, 'div', { className: 'agent-trace-step' }, [
            element(document, 'span', {
                className: `agent-trace-step-state ${stateClass}`,
                textContent: stateText
            }),
            element(document, 'div', { className: 'agent-trace-step-copy' }, [
                element(document, 'strong', { textContent: step.label }),
                element(document, 'small', { textContent: summary })
            ]),
            element(document, 'time', {
                textContent: step.missing ? '—' : formatDuration(step.durationMs)
            })
        ]);
    }

    function mount(container, options) {
        const document = options.document || globalThis.document;
        const readingId = options.readingId;
        let expanded = false;
        let loading = false;
        let summary = null;
        let review = options.review || null;
        let retryableError = false;
        const detailsId = `agent-run-details-${readingId}`;

        async function toggle() {
            if (loading) return;
            if (summary && !retryableError) {
                expanded = !expanded;
                render();
                return;
            }
            loading = true;
            expanded = true;
            retryableError = false;
            render();
            try {
                summary = normalizeSummary(await options.loadSummary(readingId));
            } catch (_error) {
                retryableError = true;
            } finally {
                loading = false;
                render();
            }
        }

        function render() {
            const button = element(document, 'button', {
                type: 'button', className: 'agent-trace-toggle',
                'aria-expanded': String(expanded), 'aria-controls': detailsId,
                textContent: retryableError ? '重试 Agent 轨迹'
                    : expanded ? '收起 Agent 轨迹' : '查看 Agent 轨迹'
            });
            button.addEventListener('click', toggle);
            const children = [
                element(document, 'div', { className: 'agent-trace-heading' }, [
                    element(document, 'strong', { textContent: 'Agent Run' }),
                    element(document, 'span', {
                        textContent: review && review.verdict
                            ? `Human Review · ${REVIEW_LABELS[review.verdict]
                                || String(review.verdict).replaceAll('_', ' ')}`
                            : 'Local-first trace'
                    })
                ]),
                button
            ];
            if (expanded) {
                const details = element(document, 'div', {
                    id: detailsId, className: 'agent-trace-details'
                });
                if (loading) {
                    details.setAttribute('role', 'status');
                    details.textContent = '正在读取本地 Agent 轨迹…';
                } else if (retryableError) {
                    details.setAttribute('role', 'status');
                    details.textContent = '轨迹暂不可用，可重试；解读结果不受影响。';
                } else if (!summary || summary.status === 'unavailable') {
                    details.textContent = '本次运行未启用 Agent Trace。';
                } else {
                    details.append(
                        element(document, 'div', { className: 'agent-trace-metrics' }, [
                            element(document, 'span', { textContent: formatDuration(summary.metrics.totalDurationMs) }),
                            element(document, 'span', { textContent: summary.metrics.model || 'model unavailable' }),
                            element(document, 'span', { textContent: `${summary.metrics.ragHits} RAG hits` }),
                            element(document, 'span', { textContent: summary.metrics.critiqueScore == null
                                ? 'Critic unavailable' : `${summary.metrics.critiqueScore}/10 Critic` })
                        ]),
                        ...summary.steps.map(step => stepDetail(document, step)),
                        element(document, 'small', {
                            className: 'agent-trace-privacy',
                            textContent: `Trace ${summary.traceId || 'unavailable'} · 完整问题与 Prompt 默认隐藏`
                        })
                    );
                }
                children.push(details);
            }
            container.replaceChildren(...children);
        }

        function updateReview(nextReview) {
            review = nextReview || null;
            render();
        }

        function destroy() {
            container.replaceChildren();
        }

        render();
        return { toggle, updateReview, destroy };
    }
```

Change the module return statement to:

```javascript
    return { normalizeSummary, formatDuration, mount };
```

- [ ] **Step 8: Run the complete component tests and syntax check**

Run:

```powershell
node tests/test_agent_trace.js
node --check js/agent_trace.js
```

Expected: `Agent trace tests: 5/5 passed`; syntax check exits 0.

- [ ] **Step 9: Commit the isolated component**

```powershell
git add js/agent_trace.js tests/test_agent_trace.js
git commit -m "feat: add agent run inspector component"
```

## Task 5: Integrate the Inspector into consultation result phases

**Files:**
- Modify: `Three.html:155-164`
- Modify: `Three.html:178-195`
- Modify: `css/consultation_flow.css:20-170`
- Modify: `css/responsive.css:278-299`
- Modify: `js/consultation_flow.js:42-58`
- Modify: `js/consultation_flow.js:1152-1190`
- Modify: `js/consultation_flow.js:1215-1285`
- Modify: `tests/test_consultation_flow.js:450-565`
- Modify: `tests/test_consultation_flow.js:581-760`

- [ ] **Step 1: Add failing HTML and lifecycle contract tests**

In the HTML contract test in `tests/test_consultation_flow.js`, add:

```javascript
    assert.ok(html.includes('class="consultation-flow-side"'));
    assert.ok(html.includes('id="consultation-agent-inspector"'));
    assert.ok(html.indexOf('js/agent_trace.js') < html.indexOf('js/consultation_flow.js'));
```

Add `['consultation-flow-side', 'aside']` and `['consultation-agent-inspector', 'div']` to the fake controller node list, then nest status and Inspector inside the side node:

```javascript
    nodes['consultation-flow-side'].append(
        nodes['consultation-flow-status'],
        nodes['consultation-agent-inspector']
    );
    nodes['consultation-flow'].append(
        nodes['consultation-flow-title'],
        nodes['consultation-flow-close'],
        nodes['consultation-flow-steps'],
        nodes['consultation-flow-side'],
        nodes['consultation-flow-mount'],
        nodes['consultation-flow-actions']
    );
```

Add this lifecycle test before the test runner list:

```javascript
async function testAgentInspectorMountUpdateAndCleanup() {
    const calls = [];
    const controller = loadControllerRuntime({
        runtime: {
            AkashicAgentTrace: {
                mount(container, options) {
                    calls.push(['mount', options.readingId, container.id]);
                    return {
                        updateReview(review) { calls.push(['review', review.verdict]); },
                        destroy() { calls.push(['destroy']); }
                    };
                }
            }
        },
        api: {
            async loadAgentRunSummary() { return { status: 'complete', steps: [] }; }
        }
    });
    const { browserFlow, testFlow, nodes } = controller;
    browserFlow.mount();
    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_ready',
        saved: { readingId: 15, consultationId: 3 },
        generated: { interpretation: { id: 5, trace_id: 'a'.repeat(32) } }
    });
    assert.deepStrictEqual(calls[0], ['mount', 15, 'consultation-agent-inspector']);
    assert.strictEqual(nodes['consultation-agent-inspector'].hidden, false);

    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'review_saved',
        saved: { readingId: 15, consultationId: 3 },
        generated: {
            interpretation: { id: 5, trace_id: 'a'.repeat(32) },
            review: { verdict: 'accepted' }
        }
    });
    assert.ok(calls.some(call => call[0] === 'review' && call[1] === 'accepted'));

    browserFlow.reset();
    assert.ok(calls.some(call => call[0] === 'destroy'));
    assert.strictEqual(nodes['consultation-agent-inspector'].hidden, true);
}
```

Add the new lifecycle test to the async test list used by `main`.

- [ ] **Step 2: Run consultation tests to verify failure**

Run:

```powershell
node tests/test_consultation_flow.js
```

Expected: failures for missing side/Inspector markup and no Inspector mount call.

- [ ] **Step 3: Add the side-column markup and script**

Replace the direct status node in `Three.html` with:

```html
        <aside id="consultation-flow-side" class="consultation-flow-side">
            <div id="consultation-flow-status" class="consultation-flow-status"
                role="status" aria-live="polite"></div>
            <div id="consultation-agent-inspector" class="consultation-agent-inspector" hidden></div>
        </aside>
```

Add this script immediately before `js/consultation_flow.js`:

```html
    <script src="js/agent_trace.js"></script>
```

- [ ] **Step 4: Add Inspector lifecycle state and synchronization**

Add these variables after `fieldSequence` in `js/consultation_flow.js`:

```javascript
    let agentInspectorController = null;
    let agentInspectorReadingId = null;
```

Add these functions before `render()`:

```javascript
    function clearAgentInspector() {
        if (agentInspectorController && agentInspectorController.destroy) {
            agentInspectorController.destroy();
        }
        agentInspectorController = null;
        agentInspectorReadingId = null;
        const host = root.document
            && root.document.getElementById('consultation-agent-inspector');
        if (host) {
            host.replaceChildren();
            host.hidden = true;
        }
    }

    function syncAgentInspector() {
        const host = root.document
            && root.document.getElementById('consultation-agent-inspector');
        const canShow = ['review_ready', 'review_saved'].includes(phase)
            && saved && saved.readingId != null
            && generated && generated.interpretation
            && root.AkashicAgentTrace
            && root.TarotAPI && root.TarotAPI.loadAgentRunSummary;
        if (!host || !canShow) {
            clearAgentInspector();
            return;
        }
        host.hidden = false;
        if (!agentInspectorController || agentInspectorReadingId !== saved.readingId) {
            clearAgentInspector();
            host.hidden = false;
            agentInspectorReadingId = saved.readingId;
            agentInspectorController = root.AkashicAgentTrace.mount(host, {
                document: root.document,
                readingId: saved.readingId,
                review: generated.review || null,
                loadSummary: root.TarotAPI.loadAgentRunSummary
            });
        } else if (agentInspectorController.updateReview) {
            agentInspectorController.updateReview(generated.review || null);
        }
    }
```

Call `syncAgentInspector()` at the end of `render()` after the phase renderer. Call `clearAgentInspector()` inside both `reset()` and `close()` immediately after `invalidateAsyncWork()`.

- [ ] **Step 5: Style the side column and Inspector**

In `css/consultation_flow.css`, change the grid child rule from direct status to side column:

```css
.consultation-flow-layout > .consultation-flow-side {
    grid-column: 3;
    grid-row: 2;
}

.consultation-flow-side {
    display: grid;
    align-content: start;
    gap: 12px;
    min-width: 0;
}
```

Add these component rules:

```css
.consultation-agent-inspector[hidden] { display: none; }

.consultation-agent-inspector {
    display: grid;
    gap: 12px;
    padding: 14px;
    color: var(--ink-text);
    background: color-mix(in oklch, var(--surface-elevated) 86%, transparent);
    border: 1px solid color-mix(in oklch, var(--accent) 45%, var(--panel-line));
    border-radius: 10px;
}

.agent-trace-heading,
.agent-trace-step {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 9px;
    align-items: start;
}

.agent-trace-heading { grid-template-columns: 1fr auto; }
.agent-trace-heading span,
.agent-trace-step small,
.agent-trace-privacy { color: color-mix(in oklch, var(--ink-text) 62%, transparent); }
.agent-trace-step-copy { display: grid; gap: 3px; min-width: 0; }
.agent-trace-step-copy small { overflow-wrap: anywhere; }
.agent-trace-step-state.is-ok { color: var(--success, #78c895); }
.agent-trace-step-state.is-error { color: var(--danger, #ef7777); }
.agent-trace-step-state.is-missing { color: var(--muted, #a9a39a); }
.agent-trace-details { display: grid; gap: 12px; }
.agent-trace-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.agent-trace-metrics span { padding: 7px; border: 1px solid var(--panel-line); border-radius: 7px; }
.agent-trace-toggle { width: 100%; }
```

In the `max-width: 820px` rule in `css/responsive.css`, replace the direct status selector with `.consultation-flow-layout > .consultation-flow-side` so the entire side column stacks in the existing mobile grid order.

- [ ] **Step 6: Update CSS contract assertions**

In `testConsultationFlowCssContract`, change the direct status layout assertion to require `.consultation-flow-side`, and add:

```javascript
    assert.match(css, /\.consultation-agent-inspector\[hidden\]\s*\{[^}]*display:\s*none;/s);
    assert.match(css, /\.agent-trace-step\s*\{[^}]*display:\s*grid;/s);
    assert.match(css, /\.agent-trace-step-state\.is-error\s*\{[^}]*var\(--danger/s);
```

- [ ] **Step 7: Run focused browser tests and syntax checks**

Run:

```powershell
node tests/test_agent_trace.js
node tests/test_api.js
node tests/test_consultation_flow.js
node --check js/agent_trace.js
node --check js/consultation_flow.js
```

Expected: all tests pass and both syntax checks exit 0.

- [ ] **Step 8: Commit the consultation integration**

```powershell
git add Three.html css/consultation_flow.css css/responsive.css js/consultation_flow.js tests/test_consultation_flow.js
git commit -m "feat: show agent traces in consultation results"
```

## Task 6: Publish the Agent engineering case study and recording guide

**Files:**
- Create: `docs/portfolio/akashic-agent-case-study.html`
- Create: `tests/test_portfolio_case_study.py`
- Create: `docs/demo/agent-trace-recording-script.md`
- Modify: `README.md:8-22`

- [ ] **Step 1: Write a failing static case-study contract test**

Create `tests/test_portfolio_case_study.py`:

```python
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CASE_STUDY = ROOT / "docs" / "portfolio" / "akashic-agent-case-study.html"
README = ROOT / "README.md"


class PortfolioCaseStudyTest(unittest.TestCase):
    def test_case_study_has_real_metrics_and_media_fallback(self):
        html = CASE_STUDY.read_text(encoding="utf-8")
        for text in (
            "Akashic Agent", "156", "30", "90%", "8.17", "26.8",
            "classify", "retrieve", "generate", "critique",
            "akashic-tour.mp4", "akashic-agent-trace.mp4",
            "../../Three.html?control=mouse",
        ):
            self.assertIn(text, html)
        self.assertIn("addEventListener('error'", html)
        self.assertNotIn("待补充", html)

    def test_readme_links_case_study(self):
        readme = README.read_text(encoding="utf-8")
        self.assertIn(
            "docs/portfolio/akashic-agent-case-study.html",
            readme,
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
python -m unittest tests.test_portfolio_case_study -v
```

Expected: `FileNotFoundError` because the case-study page is absent.

- [ ] **Step 3: Create the standalone case-study page**

Create `docs/portfolio/akashic-agent-case-study.html` as a complete UTF-8 document with these exact content blocks:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Akashic Agent · Engineering Case Study</title>
  <style>
    :root { color-scheme: dark; --bg:#090607; --panel:#151013; --line:#493829; --ink:#f0e2c4; --muted:#a99d8d; --accent:#d5b36f; }
    * { box-sizing:border-box; }
    body { margin:0; font:16px/1.65 system-ui,sans-serif; background:var(--bg); color:var(--ink); }
    main { width:min(1120px,calc(100% - 32px)); margin:auto; padding:64px 0; }
    h1 { font-size:clamp(2.5rem,7vw,5.6rem); line-height:.95; margin:.25em 0; }
    h2 { margin-top:64px; }
    a { color:var(--accent); }
    .kicker { color:var(--accent); letter-spacing:.13em; text-transform:uppercase; }
    .lede,.muted { color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }
    .card { padding:20px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
    .metric strong { display:block; font-size:2rem; color:var(--accent); }
    .flow { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .flow span { padding:9px 12px; border:1px solid var(--line); border-radius:999px; }
    video { width:100%; border:1px solid var(--line); border-radius:14px; background:#000; }
    .honesty { border-left:3px solid var(--accent); padding:14px 18px; background:var(--panel); }
    [hidden] { display:none !important; }
  </style>
</head>
<body>
<main>
  <header>
    <div class="kicker">Local-first · Multimodal · Observable</div>
    <h1>Akashic Agent</h1>
    <p class="lede">把 3D 交互、结构化咨询、领域 RAG、四阶段 Agent 编排和人工反馈闭环整合为一个可复现的本地应用。</p>
  </header>

  <section>
    <h2>Product proof</h2>
    <video controls preload="metadata" src="../demo/akashic-tour.mp4"></video>
    <video id="agent-trace-video" controls preload="metadata" src="../demo/akashic-agent-trace.mp4"></video>
    <p id="agent-trace-fallback" hidden>Agent Trace 视频尚未随当前副本提供。<a href="../../Three.html?control=mouse">打开本地 Agent Demo</a></p>
  </section>

  <section>
    <h2>System flow</h2>
    <div class="flow"><span>structured consultation</span>→<span>classify</span>→<span>retrieve</span>→<span>generate</span>→<span>critique</span>→<span>human review</span></div>
  </section>

  <section>
    <h2>Measured evidence</h2>
    <div class="grid">
      <div class="card metric"><strong>156</strong>正逆位领域语料</div>
      <div class="card metric"><strong>30</strong>固定评测问题</div>
      <div class="card metric"><strong>90%</strong>意图分类准确率</div>
      <div class="card metric"><strong>8.17 / 10</strong>平均 Critic 分数</div>
      <div class="card metric"><strong>26.8 s</strong>平均端到端延迟</div>
    </div>
  </section>

  <section>
    <h2>Engineering decisions</h2>
    <div class="grid">
      <article class="card"><h3>RAG 与可控生成</h3><p class="muted">card_id 确定性过滤后按问题向量重排；模块级 Prompt、输出契约和安全规则限制回答边界。</p></article>
      <article class="card"><h3>Trace 与评估</h3><p class="muted">每一步记录模型、耗时、结构化输出与错误；固定评测集跟踪分类准确率、延迟和 Critic 质量。</p></article>
      <article class="card"><h3>可靠性与反馈</h3><p class="muted">SSE 流式输出、失败降级、版本化解读和人工接受/编辑/拒绝形成可复现闭环。</p></article>
      <article class="card"><h3>下一阶段</h3><p class="muted">模型预热与缓存、Critic 异步化、队列与并发控制、显式记忆策略、MCP/Function Calling 受控工具边界。</p></article>
    </div>
  </section>

  <section class="honesty"><strong>诚信边界</strong><p class="muted">当前实现是 workflow Agent；不宣称已经具备自主规划器、多智能体、MCP 工具执行或分布式高并发。</p></section>
</main>
<script>
  const traceVideo = document.getElementById('agent-trace-video');
  const traceFallback = document.getElementById('agent-trace-fallback');
  traceVideo.addEventListener('error', () => {
    traceVideo.hidden = true;
    traceFallback.hidden = false;
  });
</script>
</body>
</html>
```

- [ ] **Step 4: Add the README entry**

Immediately after the existing Demo section heading in `README.md`, add:

```markdown
### Agent 工程案例 / Engineering Case Study

[查看 Agent 架构、RAG、Trace、评测指标与演进路线](docs/portfolio/akashic-agent-case-study.html)
```

- [ ] **Step 5: Add the recording guide**

Create `docs/demo/agent-trace-recording-script.md` with:

```markdown
# Agent Run Inspector 补录脚本

目标时长：40 秒；录制分辨率：2560×1440；入口：`http://localhost:8082/Three.html?control=mouse`。

| 时间 | 操作 | 旁白 |
|---|---|---|
| 00–05 秒 | 停留在解读结果 | 用户看到的是最终答案，系统同时保留了完整的 Agent 执行轨迹。 |
| 05–12 秒 | 点击“查看 Agent 轨迹” | 这不是一次普通的模型调用；后台依次完成意图识别、知识检索、生成和安全审查。 |
| 12–23 秒 | 指向指标和四个步骤 | 本次运行使用本地 Qwen2.5-7B，命中 6 条牌义知识，并记录每个阶段的真实延迟。 |
| 23–31 秒 | 指向 Critic 和 Prompt Hash | Critic 给出 8 分并标记表达问题；完整问题与 Prompt 默认隐藏，只保留可复现 Hash。 |
| 31–37 秒 | 保存 Accepted 审核 | 人工结论被保存到版本化记录中，形成后续评估和数据改进闭环。 |
| 37–42 秒 | 打开案例页指标区 | 固定 30 题评测集当前达到 90% 意图准确率，所有限制和下一阶段工程化都公开说明。 |

录制前先运行一次本地模型预热；正式录制中不重新生成答案，直接使用已保存的 reading #15，避免冷启动等待进入补录片段。
```

- [ ] **Step 6: Run the static case-study tests**

Run:

```powershell
python -m unittest tests.test_portfolio_case_study -v
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit the portfolio artifacts**

```powershell
git add README.md docs/portfolio/akashic-agent-case-study.html docs/demo/agent-trace-recording-script.md tests/test_portfolio_case_study.py
git commit -m "docs: add agent engineering case study"
```

## Task 7: Full regression and live acceptance

**Files:**
- Verify only; modify a file only if a failing test reveals a defect in that file.

- [ ] **Step 1: Run Python syntax and full unit tests**

Run:

```powershell
python -m py_compile server.py interpret_agent.py
python -m unittest discover -s tests -p "test_*.py" -v
```

Expected: syntax checks exit 0; every Python test passes.

- [ ] **Step 2: Run every JavaScript test file**

Run:

```powershell
Get-ChildItem tests -Filter 'test_*.js' | Sort-Object Name | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Expected: every test script reports all tests passed and the command exits 0.

- [ ] **Step 3: Run JavaScript syntax checks**

Run:

```powershell
Get-ChildItem js -Filter '*.js' | Sort-Object Name | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Expected: command exits 0 with no syntax errors.

- [ ] **Step 4: Verify the real reading #15 summary against SQLite**

Run:

```powershell
$summary = Invoke-RestMethod 'http://localhost:8082/api/interpret/15/agent-trace?view=summary'
$summary | ConvertTo-Json -Depth 8
```

Expected values from the saved run:

```text
trace_id: 725886e681f44cfeb5644d87d9c9cd46
metrics.total_duration_ms: 56481
metrics.rag_hits: 6
metrics.critique_score: 8
steps: classify, retrieve, generate, critique
```

- [ ] **Step 5: Verify server boundaries**

Run:

```powershell
try { Invoke-WebRequest 'http://localhost:8080/api/health' -TimeoutSec 2 | Out-Null; throw '8080 must remain offline' } catch [System.Net.WebException] { '8080 offline: OK' }
(Invoke-WebRequest 'http://localhost:8082/api/health' -TimeoutSec 5).StatusCode
```

Expected: `8080 offline: OK`, then `200` for 8082.

- [ ] **Step 6: Perform browser acceptance at desktop and narrow widths**

Open `http://localhost:8082/Three.html?control=mouse`, load saved reading #15 through the consultation/admin workflow, and verify:

```text
Desktop 2560×1440:
- Agent Run entry is visible in the third column.
- First click loads exactly one summary request.
- Four steps and the real 56.48s / 6 hits / 8/10 metrics appear.
- Full question, answer preview and raw error are absent from the Network summary response and DOM.
- Saving Accepted changes the Human Review badge without losing the loaded Trace.

Narrow width ≤820px:
- Side column appears after the result content.
- No horizontal overflow is introduced.
- Toggle remains keyboard reachable and aria-expanded changes.

Failure simulation:
- Stop or block only the trace request.
- Result and review remain usable.
- “轨迹暂不可用” appears and the retry button performs another request.
```

- [ ] **Step 7: Verify the case-study page**

Open `http://localhost:8082/docs/portfolio/akashic-agent-case-study.html` and verify:

```text
- Existing product video plays.
- Missing Agent Trace video cleanly falls back to the local Demo link.
- Metrics match docs/evals/latest-results.json.
- The page does not claim autonomous planning, MCP, multi-agent, or distributed production scale.
```

- [ ] **Step 8: Confirm a clean scoped diff**

Run:

```powershell
git status --short
git diff --check
git log --oneline -7
```

Expected: no unstaged changes from this feature; pre-existing unrelated user files remain untouched; the feature appears as the focused commits listed above.

## Task 8: Record and attach the 40-second evidence clip

**Files:**
- Add after recording: `docs/demo/akashic-agent-trace.mp4`

- [ ] **Step 1: Record from the approved script**

Use OBS at 2560×1440/60fps and follow `docs/demo/agent-trace-recording-script.md`. Record the result page and Inspector only; do not repeat the complete 3D consultation flow.

- [ ] **Step 2: Trim without re-encoding**

Use LosslessCut with keyframe mode enabled. Keep only the 00–42 second sequence; do not split contiguous kept regions before merging.

- [ ] **Step 3: Remux to MP4 without quality loss**

In OBS choose `文件 → 重新封装录像`, select the final MKV, and generate MP4. Do not use a transcoding export preset.

- [ ] **Step 4: Add the clip and verify the page switches from fallback to video**

Copy the remuxed file to:

```text
docs/demo/akashic-agent-trace.mp4
```

Open the case-study page and verify the second video plays and the fallback stays hidden.

- [ ] **Step 5: Commit the media asset**

```powershell
git add docs/demo/akashic-agent-trace.mp4
git commit -m "docs: add agent trace demo clip"
```
