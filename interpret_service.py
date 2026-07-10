"""
Service layer for the tarot interpretation agent.

Responsibilities:
  - Build prompt messages from a saved reading row
  - Stream chat completions from Ollama (local) or OpenRouter (cloud fallback)
  - Resolve the active strategy from interpret_settings table
  - Persist completed interpretations into the interpretations table

Transport is hand-rolled urllib so this module ships with zero runtime
dependencies beyond the Python standard library (matches the rest of
the project's no-dependency philosophy).
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import urllib.error
import urllib.request
import uuid
from contextlib import closing
from dataclasses import dataclass
from typing import Iterable, Iterator

from interpret_prompts import (
    DEFAULT_STYLE,
    STYLES,
    build_messages,
    detect_slop,
)
import interpret_agent
import interpret_rag


# ── Configuration ──────────────────────────────────────────────

DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen2.5:7b"
DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL = "qwen/qwen-2.5-72b-instruct"
DEFAULT_NUM_PREDICT = 600  # cap output tokens (Chinese ~300-500 chars target)
DEFAULT_TEMPERATURE = 0.78  # warm enough for prose, not chaos

OLLAMA_HEALTH_TIMEOUT_S = 5   # /api/tags can take ~2s when models are loaded; 2s was race-y
OLLAMA_GENERATE_TIMEOUT_S = 180


# ── Exceptions ─────────────────────────────────────────────────


class InterpretError(Exception):
    """Base class for interpretation-pipeline errors."""

    code = "interpret_error"


class OllamaUnreachable(InterpretError):
    code = "ollama_down"


class OllamaModelMissing(InterpretError):
    code = "model_missing"


class OpenRouterNoKey(InterpretError):
    code = "openrouter_no_key"


class InterpretBackendError(InterpretError):
    code = "backend_error"


# ── Strategy descriptors ──────────────────────────────────────


@dataclass(frozen=True)
class StrategyResult:
    """What the strategy resolver returns."""

    backend: str  # 'ollama' | 'openrouter'
    model: str
    url: str
    api_key: str | None = None


# ── Settings persistence ──────────────────────────────────────


def get_settings(conn: sqlite3.Connection) -> dict[str, str]:
    """Read the interpret_settings table into a plain dict."""
    cur = conn.execute("SELECT key, value FROM interpret_settings")
    return {row[0]: row[1] for row in cur.fetchall()}


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    """Upsert a single setting (UI calls this through the HTTP layer)."""
    with conn:
        conn.execute(
            "INSERT INTO interpret_settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def resolve_strategy(settings: dict[str, str]) -> StrategyResult:
    """Pick the active backend based on settings + Ollama health.

    Strategy rules:
      1. If backend explicitly set to 'openrouter' and a key is on file
         → cloud.
      2. Otherwise try Ollama first; if its health probe answers, use it.
      3. If Ollama is down and an OpenRouter key is on file → cloud.
      4. Otherwise raise OllamaUnreachable so the UI can surface a setup
         banner.
    """
    backend = settings.get("backend", "ollama")
    api_key = settings.get("openrouter_api_key", "").strip() or None
    ollama_url = settings.get("ollama_url", DEFAULT_OLLAMA_URL)
    ollama_model = settings.get("ollama_model", DEFAULT_OLLAMA_MODEL)
    openrouter_model = settings.get("openrouter_model", DEFAULT_OPENROUTER_MODEL)
    openrouter_url = settings.get("openrouter_url", DEFAULT_OPENROUTER_URL)

    if backend == "openrouter":
        if not api_key:
            raise OpenRouterNoKey("OpenRouter API key not configured")
        return StrategyResult(
            backend="openrouter",
            model=openrouter_model,
            url=openrouter_url,
            api_key=api_key,
        )

    # Backend = ollama (default). Health-check.
    health = check_ollama_health(ollama_url, ollama_model)
    if health["status"] == "ready":
        return StrategyResult(backend="ollama", model=ollama_model, url=ollama_url)

    # Ollama down → fall back to cloud if key present
    if api_key:
        return StrategyResult(
            backend="openrouter",
            model=openrouter_model,
            url=openrouter_url,
            api_key=api_key,
        )

    # No fallback available
    if health["status"] == "model_missing":
        raise OllamaModelMissing(
            f"Ollama is running but model {ollama_model!r} is not installed"
        )
    raise OllamaUnreachable(f"Ollama not reachable at {ollama_url}")


def check_ollama_health(url: str, model: str) -> dict[str, str]:
    """Probe `${url}/api/tags`. Returns {status, model, message}.

    Possible statuses:
      - 'ready'           — server up + requested model installed
      - 'model_missing'   — server up but model not pulled
      - 'down'            — server not reachable
    """
    try:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/api/tags",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=OLLAMA_HEALTH_TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
        return {"status": "down", "model": model, "message": str(exc)}

    models = {m.get("name") for m in payload.get("models", [])}
    if model in models:
        return {"status": "ready", "model": model, "message": "ok"}
    return {
        "status": "model_missing",
        "model": model,
        "message": f"installed: {sorted(models) or '(none)'}",
    }


# ── HTTP clients (streaming) ──────────────────────────────────


def _utf8_post(url: str, body_dict: dict, headers: dict, timeout: int):
    """POST a JSON body as UTF-8 bytes. Returns the raw urllib response.

    Critical: we encode the body ourselves because the default JSON
    request handling on some Windows Python builds mangles non-ASCII
    characters (we hit this empirically with Chinese prompts via
    PowerShell — same root cause class).
    """
    body_bytes = json.dumps(body_dict, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body_bytes, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    for k, v in headers.items():
        req.add_header(k, v)
    return urllib.request.urlopen(req, timeout=timeout)


def stream_ollama(
    url: str,
    model: str,
    messages: list[dict],
    *,
    temperature: float = DEFAULT_TEMPERATURE,
    num_predict: int = DEFAULT_NUM_PREDICT,
) -> Iterator[str]:
    """Yield content tokens from Ollama's /api/chat streaming endpoint."""
    body = {
        "model": model,
        "stream": True,
        "messages": messages,
        "options": {"temperature": temperature, "num_predict": num_predict},
    }
    endpoint = f"{url.rstrip('/')}/api/chat"
    try:
        resp = _utf8_post(endpoint, body, headers={}, timeout=OLLAMA_GENERATE_TIMEOUT_S)
    except urllib.error.URLError as exc:
        raise InterpretBackendError(f"Ollama POST failed: {exc}") from exc

    with closing(resp):
        for raw in resp:
            if not raw:
                continue
            try:
                chunk = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                continue
            piece = (chunk.get("message") or {}).get("content", "")
            if piece:
                yield piece
            if chunk.get("done"):
                return


def stream_openrouter(
    url: str,
    model: str,
    messages: list[dict],
    *,
    api_key: str,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_NUM_PREDICT,
) -> Iterator[str]:
    """Yield content tokens from OpenRouter's OpenAI-compatible SSE stream."""
    body = {
        "model": model,
        "stream": True,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    endpoint = f"{url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://github.com/ningning022/3D-tarot",
        "X-Title": "Akashic Tarot Interpretation",
    }
    try:
        resp = _utf8_post(endpoint, body, headers=headers, timeout=OLLAMA_GENERATE_TIMEOUT_S)
    except urllib.error.URLError as exc:
        raise InterpretBackendError(f"OpenRouter POST failed: {exc}") from exc

    with closing(resp):
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            piece = delta.get("content", "")
            if piece:
                yield piece


def stream_from_strategy(strategy: StrategyResult, messages: list[dict]) -> Iterator[str]:
    """Dispatch to the right client based on the resolved strategy."""
    if strategy.backend == "ollama":
        return stream_ollama(strategy.url, strategy.model, messages)
    if strategy.backend == "openrouter":
        return stream_openrouter(
            strategy.url, strategy.model, messages, api_key=strategy.api_key or ""
        )
    raise InterpretBackendError(f"Unknown backend {strategy.backend!r}")


# ── Persistence ────────────────────────────────────────────────


def compute_prompt_hash(messages: list[dict]) -> str:
    """Stable hash of the prompt content. Used to detect prompt-template
    changes between regenerations of the same reading."""
    blob = json.dumps(messages, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


def save_interpretation(
    conn: sqlite3.Connection,
    *,
    reading_id: int,
    model: str,
    style: str,
    language: str,
    content: str,
    prompt_hash: str,
    duration_ms: int,
    created_at: str,
    input_snapshot: dict | None = None,
    rag_snapshot: dict | None = None,
    trace_id: str | None = None,
    prompt_version: str = "legacy-v1",
    generation_status: str = "complete",
    safety_flags: list[str] | None = None,
    public_id: str | None = None,
) -> int:
    """Insert a finished interpretation row. Returns the new row id."""
    if generation_status not in {"complete", "partial", "failed"}:
        raise ValueError("Unsupported generation_status")
    public_id = public_id or uuid.uuid4().hex
    with conn:
        cur = conn.execute(
            """
            INSERT INTO interpretations (
                public_id, reading_id, model, style, language, content,
                prompt_hash, created_at, duration_ms, input_snapshot_json,
                rag_snapshot_json, trace_id, prompt_version,
                generation_status, safety_flags_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                public_id,
                reading_id,
                model,
                style,
                language,
                content,
                prompt_hash,
                created_at,
                duration_ms,
                json.dumps(input_snapshot, ensure_ascii=False)
                if input_snapshot is not None
                else None,
                json.dumps(rag_snapshot, ensure_ascii=False)
                if rag_snapshot is not None
                else None,
                trace_id,
                prompt_version,
                generation_status,
                json.dumps(safety_flags or [], ensure_ascii=False),
            ),
        )
        return int(cur.lastrowid or 0)


def load_interpretation(
    conn: sqlite3.Connection, reading_id: int, *, all_rows: bool = False
) -> list[dict] | dict | None:
    """Return the latest interpretation (or all rows) for a reading."""
    rows = conn.execute(
        """
        SELECT id, public_id, reading_id, model, style, language, content,
               prompt_hash, created_at, duration_ms, input_snapshot_json,
               rag_snapshot_json, trace_id, prompt_version,
               generation_status, safety_flags_json
        FROM interpretations
        WHERE reading_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        (reading_id,),
    ).fetchall()
    if not rows:
        return [] if all_rows else None
    records = []
    for row in rows:
        record = dict(row)
        record["input_snapshot"] = json.loads(
            record.pop("input_snapshot_json") or "null"
        )
        record["rag_snapshot"] = json.loads(
            record.pop("rag_snapshot_json") or "null"
        )
        record["safety_flags"] = json.loads(
            record.pop("safety_flags_json") or "[]"
        )
        records.append(record)
    return records if all_rows else records[0]


def update_interpretation_safety(
    conn: sqlite3.Connection,
    interpretation_id: int,
    issues: list[str],
) -> None:
    with conn:
        conn.execute(
            "UPDATE interpretations SET safety_flags_json = ? WHERE id = ?",
            (json.dumps(issues, ensure_ascii=False), interpretation_id),
        )


# ── DB migration ───────────────────────────────────────────────


MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS interpretations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    reading_id INTEGER NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    style TEXT NOT NULL DEFAULT 'traditional',
    language TEXT NOT NULL,
    content TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    duration_ms INTEGER,
    input_snapshot_json TEXT,
    rag_snapshot_json TEXT,
    trace_id TEXT,
    prompt_version TEXT NOT NULL DEFAULT 'legacy-v1',
    generation_status TEXT NOT NULL DEFAULT 'complete',
    safety_flags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_interpretations_reading ON interpretations(reading_id);

CREATE TABLE IF NOT EXISTS interpret_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _ensure_column(
    conn: sqlite3.Connection, table: str, column: str, definition: str
) -> None:
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _migrate_interpretation_columns(conn: sqlite3.Connection) -> None:
    definitions = {
        "public_id": "TEXT",
        "input_snapshot_json": "TEXT",
        "rag_snapshot_json": "TEXT",
        "trace_id": "TEXT",
        "prompt_version": "TEXT NOT NULL DEFAULT 'legacy-v1'",
        "generation_status": "TEXT NOT NULL DEFAULT 'complete'",
        "safety_flags_json": "TEXT NOT NULL DEFAULT '[]'",
    }
    for column, definition in definitions.items():
        _ensure_column(conn, "interpretations", column, definition)
    rows = conn.execute(
        "SELECT id FROM interpretations "
        "WHERE public_id IS NULL OR public_id = ''"
    ).fetchall()
    for row in rows:
        conn.execute(
            "UPDATE interpretations SET public_id = ? WHERE id = ?",
            (uuid.uuid4().hex, row[0]),
        )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_interpretations_public_id "
        "ON interpretations(public_id)"
    )


def migrate(conn: sqlite3.Connection) -> None:
    """Idempotent schema setup. Call once on server boot."""
    with conn:
        conn.executescript(MIGRATION_SQL)
        _migrate_interpretation_columns(conn)
    # RAG + agent_steps tables live in the same DB; co-migrate so a
    # single boot path initializes everything an interpretation needs.
    interpret_rag.migrate(conn)
    interpret_agent.migrate(conn)


# ── RAG retrieval helper ─────────────────────────────────────────


def _retrieve_chunks(
    conn: sqlite3.Connection,
    cards: list[dict],
    question: str | None,
    settings: dict[str, str],
) -> tuple[list[dict], int, str]:
    """Pull RAG chunks for the current spread.

    Returns ``(chunks, duration_ms, status)``. Degrades gracefully:
      - If the embedding index isn't built yet, returns canonical
        entries (deterministic card-id match, no embedder call).
      - If the embed backend is down + a question is supplied, falls
        back to canonical entries rather than failing the whole stream.
    """
    embed_model = settings.get("embed_model", interpret_rag.DEFAULT_EMBED_MODEL)
    ollama_url = settings.get("ollama_url", DEFAULT_OLLAMA_URL)
    started = time.monotonic()
    rag_status = "ready"
    try:
        results = interpret_rag.retrieve_for_cards(
            conn, cards=cards, question=question,
            model=embed_model, ollama_url=ollama_url,
        )
    except interpret_rag.RagError:
        # Embedder unreachable / model missing — fall back to canonical
        # by retrying without the question argument.
        rag_status = "degraded"
        try:
            results = interpret_rag.retrieve_for_cards(
                conn, cards=cards, question=None,
                model=embed_model, ollama_url=ollama_url,
            )
        except interpret_rag.RagError:
            duration_ms = int((time.monotonic() - started) * 1000)
            return [], duration_ms, "unavailable"
    duration_ms = int((time.monotonic() - started) * 1000)
    # Translate dataclasses into plain dicts the prompt builder expects.
    out = []
    for chunk in results:
        e = chunk.entry
        out.append({
            "card_id": e.card_id,
            "zh": e.zh, "en": e.en,
            "orientation": e.orientation,
            "imagery": e.imagery,
            "situations": e.situations,
            "keywords": e.keywords,
            "score": chunk.score,
        })
    return out, duration_ms, rag_status


# ── Public orchestration entry-point ───────────────────────────


def interpret_reading_stream(
    conn: sqlite3.Connection,
    *,
    reading_id: int,
    cards: list[dict],
    template_name: str,
    style: str = DEFAULT_STYLE,
    language: str = "zh",
    question: str | None = None,
    user_context: str | None = None,
    persist: bool = True,
    enable_rag: bool = True,
    enable_agent: bool = True,
    input_snapshot: dict | None = None,
    prompt_version: str = "legacy-v1",
) -> Iterator[str]:
    """High-level: build prompt, resolve strategy, stream output,
    accumulate into a buffer, persist on completion.

    Yields each content chunk as it arrives so callers can forward to
    SSE clients.

    When ``question`` is provided, the user's question is folded into
    the prompt and the model is steered to answer it through the cards.

    When ``enable_rag`` is True (default), retrieves canonical card
    meanings + optional question-relevance ranking from the corpus and
    injects them as a reference block in the prompt.

    When ``enable_agent`` is True AND a question is provided, runs the
    full agent loop: classify → retrieve → generate → critique. Each
    step is persisted to ``agent_steps``. Without a question, the loop
    is skipped (classify/critique are meaningless without one) and the
    fast path runs unchanged.
    """
    settings = get_settings(conn)
    strategy = resolve_strategy(settings)

    # Agent mode only kicks in when there's a question to reason about.
    run_agent = bool(enable_agent and question and question.strip())
    trace_id = interpret_agent.new_trace_id() if run_agent else None
    step_index = 0

    # 1) CLASSIFY (agent mode only) — biases retrieval + future telemetry
    classification: dict = {}
    if run_agent:
        clf_step, classification = interpret_agent.classify(
            question, model=strategy.model,
            url=settings.get("ollama_url", DEFAULT_OLLAMA_URL),
            language=language,
        )
        interpret_agent.record_step(
            conn, reading_id=reading_id, trace_id=trace_id,
            step_index=step_index, step=clf_step,
        )
        step_index += 1

    # 2) RETRIEVE — RAG is unchanged; we just timestamp it for the trace
    retrieved: list[dict] = []
    retrieve_ms = 0
    rag_status = "disabled"
    if enable_rag:
        retrieved, retrieve_ms, rag_status = _retrieve_chunks(
            conn, cards, question, settings
        )
    if run_agent:
        rstep = interpret_agent.retrieve_step(
            retrieved=retrieved, duration_ms=retrieve_ms,
            topic_bias=classification.get("topic"),
        )
        interpret_agent.record_step(
            conn, reading_id=reading_id, trace_id=trace_id,
            step_index=step_index, step=rstep,
        )
        step_index += 1

    # 3) GENERATE — stream tokens to the caller as they arrive
    messages = build_messages(
        cards, template_name,
        language=language, style=style,
        question=question,
        user_context=user_context,
        retrieved_chunks=retrieved,
    )
    prompt_hash = compute_prompt_hash(messages)

    started = time.monotonic()
    buffer: list[str] = []
    completed = False
    interpretation_id = None
    try:
        for piece in stream_from_strategy(strategy, messages):
            buffer.append(piece)
            yield piece
        completed = True
    finally:
        duration_ms = int((time.monotonic() - started) * 1000)
        full = "".join(buffer).strip()
        generation_status = "complete" if completed else "partial"
        if persist and full:
            from datetime import datetime, timezone
            interpretation_id = save_interpretation(
                conn,
                reading_id=reading_id,
                model=f"{strategy.backend}:{strategy.model}",
                style=style,
                language=language,
                content=full,
                prompt_hash=prompt_hash,
                duration_ms=duration_ms,
                created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                input_snapshot=input_snapshot,
                rag_snapshot={"status": rag_status, "entries": retrieved},
                trace_id=trace_id,
                prompt_version=prompt_version,
                generation_status=generation_status,
                safety_flags=[],
            )

        # 4) Trace generation + run critique (agent mode only). All
        # post-stream work happens in finally so a client disconnect
        # doesn't lose the steps recorded so far.
        if run_agent and full:
            gstep = interpret_agent.generate_step(
                model=f"{strategy.backend}:{strategy.model}",
                duration_ms=duration_ms, answer=full, prompt_hash=prompt_hash,
            )
            interpret_agent.record_step(
                conn, reading_id=reading_id, trace_id=trace_id,
                step_index=step_index, step=gstep,
            )
            step_index += 1
            # Critic runs only against the local Ollama (avoid double
            # OpenRouter spend); skip if the local backend isn't there.
            if strategy.backend == "ollama":
                cstep, _crit = interpret_agent.critique(
                    full, question=question, cards=cards,
                    model=strategy.model,
                    url=settings.get("ollama_url", DEFAULT_OLLAMA_URL),
                    language=language,
                )
                interpret_agent.record_step(
                    conn, reading_id=reading_id, trace_id=trace_id,
                    step_index=step_index, step=cstep,
                )
                if interpretation_id is not None:
                    update_interpretation_safety(
                        conn,
                        interpretation_id,
                        list(_crit.get("issues") or []),
                    )
