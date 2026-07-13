# 架构 / Architecture — Akashic Tarot Agent

本文先说明统一咨询主链，再介绍叠加在 3D 塔罗 UI 之上的解读 Agent。界面、牌组渲染和每日一牌等产品说明见 [`README.md`](README.md)。

## 0 · 统一咨询主链

咨询模块负责“用户想解决什么”以及允许哪些牌阵；取牌方式只负责“卡牌从哪里来”。两者是正交维度：`general_reading × manual` 和 `general_reading × three_d` 会落入相同的数据图。

```text
Consultation module (intent + allowed spreads)
        ×
Acquisition mode (three_d | manual)
        ↓
reading + cards [+ consultation]
        ↓
optional interpretation → optional review
```

- `none`（无特定问题）直接保存 reading + cards，不创建 consultation 行；可以选择立即生成、稍后生成或仅保存。即使生成了解读，也不提供人工审核入口。
- `general_reading`（普通咨询）要求中文问题，保存时原子写入 reading、cards 和 consultation。`GET /api/consultation-modules` 是前端模块能力的唯一来源。
- `three_d` 与 `manual` 只改变卡牌采集方式，不改变后续保存、解读或审核语义。
- `now` 立即生成，`later` 稍后生成，`none` 为 save-only。
- review 只属于“有 consultation 且生成成功”的 interpretation；隐私确认只在 `accepted` / `edited` 时出现。未经隐私确认的生成文本不是数据集候选。
- 未来的 choice / message 模块当前未注册、未启用；能力接口不会返回它们。

---

## 1 · System diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Browser (Three.html)                        │
│  3D card cascade → spread → "Interpret" panel → SSE event stream     │
└──────────┬───────────────────────────────────────────────────────────┘
           │  POST /api/interpret/<reading_id>           SSE: data:{chunk}
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    server.py (stdlib http.server)                    │
│   • Routes /api/interpret, /api/interpret/rag-*, /agent-trace        │
│   • Per-reading_id lock (409 on concurrent stream)                   │
│   • Forwards model chunks as SSE frames                              │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│             interpret_service.interpret_reading_stream()             │
│                                                                      │
│   When question is present:                                          │
│                                                                      │
│   ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│   │classify │ → │ retrieve │ → │ generate │ → │ critique │           │
│   └─────────┘   └──────────┘   └──────────┘   └──────────┘           │
│       JSON-      vector RAG     SSE token       JSON-mode             │
│       mode       (Ollama        stream to       audit log             │
│       Ollama     embed +        client           (logged,             │
│                  cosine)                          not shown)         │
│                                                                      │
│   Every step recorded in `agent_steps` under one `trace_id`.         │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│   Strategy resolver: Ollama (local) preferred; OpenRouter fallback   │
│   when local backend down + API key configured                       │
└──────────────────────────────────────────────────────────────────────┘
```

Without a question the loop short-circuits to `retrieve → generate`
and no `agent_steps` rows are written — fast path stays fast.

---

## 2 · Module map

| File | Responsibility |
|---|---|
| [`server.py`](server.py) | stdlib HTTP server, all routes, SSE streaming, lock guard. No business logic. |
| [`js/consultation_flow.js`](js/consultation_flow.js) | Consultation-first browser state machine, acquisition hand-off, persistence routing, generation, review, focus management, and accessible form rendering. |
| [`consultation_service.py`](consultation_service.py) | Chinese consultation validation, persistence, reproducible input snapshots, and human reviews. |
| [`interpret_service.py`](interpret_service.py) | Strategy resolver, Ollama / OpenRouter clients, `interpret_reading_stream()` orchestrator, `interpretations` table. |
| [`interpret_prompts.py`](interpret_prompts.py) | Pure prompt assembly — system + few-shot + retrieved block + question. No I/O. |
| [`interpret_rag.py`](interpret_rag.py) | Corpus loader, embedding cache, cosine retrieval, two-stage filter. |
| [`interpret_agent.py`](interpret_agent.py) | `AgentStep`, classifier, critic, JSON-mode Ollama call, `agent_steps` persistence. |
| [`data/tarot_corpus.json`](data/tarot_corpus.json) | 156 entries — 78 cards × upright/reversed, zh + en, themes, imagery, situations, keywords. |
| [`evals/`](evals/) | Golden set (30 Q), runner, LM-as-judge, markdown report writer. CLI: `python -m evals`. |

---

## 3 · The agent loop in detail

### 3.1 Classify

- One Ollama `/api/chat` call, `format: "json"`, `num_predict: 120`,
  `temperature: 0.2`.
- Closed-vocab output: `topic ∈ {career, relationship, health, growth, general}`,
  `intent ∈ {decision, clarity, timing, perspective}`,
  `tone ∈ {anxious, curious, grieving, hopeful, neutral}`.
- `_coerce_enum()` tolerates case + substring aliases; falls back to safe
  defaults if the model returns anything else.
- A transport / parse failure becomes an `ok=False` step record and the
  pipeline still proceeds with the default classification — **a single LLM
  hiccup never kills the user-facing request**.

### 3.2 Retrieve (RAG)

- Corpus: 156 entries embedded once with `nomic-embed-text` (768-dim).
- Storage: SQLite `corpus_embeddings(entry_key, model, corpus_sig, dim,
  vector BLOB, text_hash, created_at)`. `vector` is float32 little-endian
  packed via `struct`.
- Idempotency: `corpus_sig` is `sha256(sorted_entry_keys + texts)[:16]`.
  Re-running `build_index()` short-circuits when sig + model + text_hash
  haven't changed.
- Two-stage filter:
  1. **Deterministic** — match each drawn card by `(card_id, orientation)`
     → guaranteed-relevant chunks, no embedder call.
  2. **Re-rank (only if question given)** — embed the question once,
     cosine against the matched chunks. Sentinel score `1.0` for canonical-only.
- Graceful degradation: if embedder is unreachable, retry without the
  question (canonical lookup is enough). If even that fails, return `[]` —
  prompt builder skips the retrieval block.

### 3.3 Generate

- The only step the user sees in real time.
- `stream_from_strategy()` chooses Ollama (`qwen2.5:7b`, Q4_K_M) or
  OpenRouter based on backend health + key presence.
- Output is streamed back as SSE frames `data: {"chunk": "..."}\n\n`.
- Buffer is accumulated in `interpret_reading_stream`'s `finally` block,
  so even on client disconnect the partial result + trace are persisted.

### 3.4 Critique

- Runs **after** the stream completes — never blocks the user.
- Another JSON-mode Ollama call (`num_predict: 200`).
- Output: `{score: 0..10, issues: [...], needs_retry: bool, summary: str}`.
- `issues` is filtered against `CRITIQUE_ISSUES` closed vocab
  (`off_topic`, `missing_card`, `slop_phrase`, `too_short`,
  `too_listy`, `platitude`).
- Critic is **skipped when backend is OpenRouter** to avoid doubling
  cloud spend on every interpretation.

### 3.5 Trace persistence

```
CREATE TABLE agent_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reading_id INTEGER NOT NULL,
    trace_id TEXT NOT NULL,        -- one UUID hex per run
    step_index INTEGER NOT NULL,   -- 0..3 (classify..critique)
    step TEXT NOT NULL,
    model TEXT,
    duration_ms INTEGER NOT NULL,
    input_summary TEXT,
    output_json TEXT,              -- ensure_ascii=False
    ok INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
);
```

`load_trace(reading_id)` returns the most recent trace's steps in order.
Eval runs synthesize `reading_id ≥ 100_000` to keep their traces filterable
from real reading traces.

### 3.6 Consultation data graph

```text
readings 1 ── 0..1 consultations
readings 1 ── 0..N interpretations
interpretations 1 ── 0..1 interpretation_reviews
interpretations trace_id ── 0..N agent_steps
```

The first interpretation request for a legacy 3D reading creates an
`input_mode=three_d` consultation when the request contains a question.
Questionless fast-path readings remain valid, but their interpretations lack
a confirmed consultation question and are not eligible for SFT export.

Manual consultation creation writes the reading, ordered cards, and
consultation in one transaction. Each interpretation stores an immutable
input snapshot plus prompt/RAG/trace metadata, while a review can be updated
without overwriting any generated version. Only privacy-confirmed
`accepted` or `edited` reviews are candidates for a later dataset exporter.

---

## 4 · API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/interpret/<id>` | SSE stream. Body: `{style, language, question?, enable_agent?, backend?}`. |
| GET | `/api/interpret/<id>` | Latest persisted interpretation (text). |
| GET | `/api/interpret/<id>/agent-trace` | Most recent agent trace (4 steps). |
| GET | `/api/interpret/rag-status` | Embedding index state — `{indexed, ready, model_installed, …}`. |
| POST | `/api/interpret/rag-build` | Trigger / refresh the embedding index. Idempotent. |
| GET\|POST | `/api/interpret/settings` | Backend, model, OpenRouter key (key never echoed). |
| GET | `/api/consultation-modules` | List enabled consultation modules, fields, allowed spreads, and defaults. |
| POST | `/api/consultations` | Atomically create a Chinese consultation, reading, and cards. |
| GET | `/api/consultations?limit=20` | List recent consultations; optional `module_type` filter. |
| GET | `/api/consultations/<id>` | Load the consultation, reading, interpretation versions, and reviews. |
| PUT | `/api/interpretations/<id>/review` | Upsert a human verdict, rating, issue tags, edits, and privacy confirmation. |

---

## 5 · Failure modes — what happens, what the user sees

| What fails | Where | User impact | Recovery |
|---|---|---|---|
| Ollama down | strategy resolver | Falls back to OpenRouter if key set; else SSE `data: {"error": ...}` frame. | Start Ollama, retry. |
| Embed model missing | RAG retrieval | Canonical-only retrieval (no question re-rank). Prompt still has the right card meanings. | `POST /api/interpret/rag-build` after `ollama pull nomic-embed-text`. |
| Classifier call fails | agent loop | Trace records `ok=false`, default `(general/clarity/neutral)` used. Stream proceeds. | Self-heals on next run. |
| Critic call fails | agent loop, after stream | User already has the answer; only the audit log is missing. | Self-heals on next run. |
| Concurrent interpret request | per-reading lock | HTTP 409 `Interpretation already in progress`. | Caller waits or aborts. |
| Client disconnect mid-stream | server | Server caught `BrokenPipeError`; partial answer + trace still persisted via `finally`. | None needed. |

---

## 6 · UTF-8 on Windows

See [`CLAUDE.md`](CLAUDE.md) for the two rules:

1. **Outgoing HTTP bodies** — always `json.dumps(..., ensure_ascii=False)
   .encode("utf-8")` then POST as bytes. The library defaults mangle
   non-ASCII on Windows.
2. **Inspecting Chinese output** — `python -m json.tool` re-decodes UTF-8
   as cp936 (GBK) on Windows consoles. The bytes are usually fine; the
   display lies.

Both are codified in `_utf8_post` / `_utf8_post_json` across the codebase.

---

## 7 · Testing

```bash
python -m unittest discover -s tests        # 91 tests, all mocked
python -m evals --limit 2                    # smoke (2 items, no judge)
python -m evals                              # full 30-item run
python -m evals --judge                      # full run + OpenRouter judge
```

Test fixtures patch `_post_embed`, `call_ollama_json`, and
`stream_ollama` — CI has zero external dependencies.

---

## 8 · Numbers (measured — 30-item golden set, `qwen2.5:7b` on RTX 3060)

From [`docs/evals/eval-20260524T082210Z.md`](docs/evals/eval-20260524T082210Z.md):

| Step | Avg latency |
|---|---|
| classify | 4.6 s (one Ollama JSON-mode call, ~50 output tokens) |
| retrieve (canonical + re-rank) | < 50 ms (embed once + 3 cosines) |
| generate (stream, avg 257 chars Chinese) | 11.7 s wall-clock; first token < 1 s |
| critique | 6.3 s |
| **Total user-perceived latency** | first token < 1 s, full answer ~12 s |
| **Post-stream agent work** | 6 s, invisible to user |

Quality metrics across all 30 items:

| Metric | Value |
|---|---|
| Classifier topic accuracy | **90.0%** (27/30) |
| Avg local critique score (/10) | **8.17** |
| Errors | 0 / 30 |

Per-topic accuracy: `relationship 100%` · `growth 100%` · `general 100%`
· `career 83.3%` · `health 66.7%`. The two health misses are both
mental-health questions ("therapy", "anxiety") which the classifier
labeled as `general` — a real signal to expand the corpus or sharpen
the `health` topic definition.

`build_index()` cold-start (156 entries × `nomic-embed-text`): ~5–6 min.
Subsequent runs are no-ops (signature short-circuit).

---

## 9 · Where to extend

| Goal | Touch |
|---|---|
| Add a new interpretation style | `interpret_prompts.STYLE_OVERLAYS_*` + tests |
| Add a new topic to the classifier | `interpret_agent.TOPICS` + corpus `themes` |
| Swap embedding model | `interpret_rag.DEFAULT_EMBED_MODEL`, then `rag-build` |
| Add a new agent step | new helper in `interpret_agent`, record between existing steps in `interpret_service.interpret_reading_stream` |
| Add a new eval rubric axis | `evals/judge.RUBRIC_AXES` + `Score.total()` divisor |
| Telemetry visualization | new admin tab consuming `/api/interpret/<id>/agent-trace` |

---

## 10 · Known gaps / follow-ups

### 10.1 · Eval should exercise the production HTTP path, not the orchestrator directly

`evals/runner.py` currently calls `interpret_service.interpret_reading_stream(...)`
directly with cards it built itself via `build_cards_for_item()`. This bypasses
`server._load_reading_for_interpret()` — the transform that turns a stored
reading row into the dict shape the agent expects.

The card-id regression (commit `a955083`) lived in exactly that transform.
The eval reported 90% topic accuracy because eval-mode cards always had
`card_id`. The production path didn't. The two pipelines diverged at the
one layer the eval framework wasn't covering.

**Fix shape (not done):** rework `run_one()` to POST against
`/api/interpret/<id>` (synthesizing reading rows up-front), consume the SSE
stream, and fetch the trace via `/agent-trace`. This costs eval runs an HTTP
round-trip per item but guarantees:

- The cards-loading transform is exercised
- Concurrency lock behavior is exercised
- Settings resolution is exercised
- Any future server-layer change can't silently degrade RAG without the
  eval going red

Until that's done: treat eval numbers as upper bounds on what the
production path can achieve, not necessarily what it currently does.
The telemetry viewer (`telemetry.html`) is the production-path
ground truth — when in doubt, check a real reading's trace there.

### 10.2 · Health-probe latency caching

`check_ollama_health()` runs on every stream start (5s timeout). With both
qwen2.5:7b and nomic-embed-text installed, `/api/tags` takes ~2s and pays
that on every interpret. A short-TTL cache (e.g. 10–30s) would cut p50
stream-start latency from ~2s to <50ms on warm paths without making
the "is Ollama still alive?" answer too stale to trust.
