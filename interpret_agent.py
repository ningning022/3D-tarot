"""
interpret_agent — Agent loop wrapping the interpretation pipeline.

Pipeline:
    classify(question)  →  retrieve(cards, question, topic-bias)
                        →  generate(messages)       [streamed]
                        →  critique(answer)         [logged]

Each step is persisted to ``agent_steps`` so the run is fully
inspectable later (admin telemetry, eval framework).

The classifier and critic are small Ollama calls with JSON-mode
output and tight token caps — they add ~500-1500 ms total, but
only when the user supplies a question. Without a question we
skip the loop entirely and the fast path stays as fast as before.

This module never raises out of the public functions: a
classifier/critic failure is logged into the trace as a step with
``ok=False`` and the pipeline keeps running. Quality of generation
must not depend on the agent loop succeeding.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable

log = logging.getLogger("interpret.agent")

# ── Closed vocabularies (keep tight; expand only with eval signal) ──

TOPICS = ("career", "relationship", "health", "growth", "general")
INTENTS = ("decision", "clarity", "timing", "perspective")
TONES = ("anxious", "curious", "grieving", "hopeful", "neutral")

CRITIQUE_ISSUES = (
    "off_topic",       # doesn't address the question
    "missing_card",    # ignores one or more drawn cards
    "slop_phrase",     # AI-tell phrases caught by detector
    "too_short",       # under length floor
    "too_listy",       # bullet/list-y when narrative was asked
    "platitude",       # vague, non-committal, advice-column tone
    "mind_reading",    # claims certainty about a third party's thoughts
    "fear_escalation", # invents betrayal, surveillance, curses, or threats
    "fatalism",        # presents a symbolic reading as fixed destiny
    "high_stakes_overreach",  # substitutes for medical/legal/financial judgment
)

# ── Defaults ────────────────────────────────────────────────────

CLASSIFY_NUM_PREDICT = 120
CRITIQUE_NUM_PREDICT = 200
JSON_CALL_TIMEOUT_S = 60
JSON_TEMPERATURE = 0.2   # tight — these are structured calls, not prose


# ── Schema ──────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reading_id INTEGER NOT NULL,
    trace_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step TEXT NOT NULL,
    model TEXT,
    duration_ms INTEGER NOT NULL,
    input_summary TEXT,
    output_json TEXT,
    ok INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_steps_reading
    ON agent_steps(reading_id, trace_id, step_index);
CREATE INDEX IF NOT EXISTS idx_agent_steps_trace
    ON agent_steps(trace_id);
"""


def migrate(conn: sqlite3.Connection) -> None:
    """Create the agent_steps table + indexes if missing."""
    with conn:
        conn.executescript(SCHEMA)


# ── Step record ─────────────────────────────────────────────────


@dataclass(frozen=True)
class AgentStep:
    step: str                 # classify | retrieve | generate | critique
    model: str | None
    duration_ms: int
    input_summary: str
    output: dict              # JSON-serializable
    ok: bool
    error: str | None = None


def new_trace_id() -> str:
    """One UUID-hex per orchestration run, shared across all steps."""
    return uuid.uuid4().hex


def record_step(
    conn: sqlite3.Connection,
    *,
    reading_id: int,
    trace_id: str,
    step_index: int,
    step: AgentStep,
) -> int:
    """Persist one step. Returns the inserted row id."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with conn:
        cur = conn.execute(
            """INSERT INTO agent_steps
               (reading_id, trace_id, step_index, step, model, duration_ms,
                input_summary, output_json, ok, error, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                reading_id, trace_id, step_index, step.step, step.model,
                step.duration_ms, step.input_summary,
                json.dumps(step.output, ensure_ascii=False),
                1 if step.ok else 0, step.error, now,
            ),
        )
        return int(cur.lastrowid)


def load_trace(conn: sqlite3.Connection, reading_id: int) -> list[dict]:
    """Return the most recent trace for this reading as plain dicts,
    ordered by step_index. Empty list if no trace exists yet."""
    row = conn.execute(
        """SELECT trace_id FROM agent_steps
           WHERE reading_id = ?
           ORDER BY id DESC LIMIT 1""",
        (reading_id,),
    ).fetchone()
    if row is None:
        return []
    trace_id = row[0] if not isinstance(row, sqlite3.Row) else row["trace_id"]
    rows = conn.execute(
        """SELECT step_index, step, model, duration_ms, input_summary,
                  output_json, ok, error, created_at
           FROM agent_steps
           WHERE reading_id = ? AND trace_id = ?
           ORDER BY step_index ASC""",
        (reading_id, trace_id),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r) if isinstance(r, sqlite3.Row) else {
            "step_index": r[0], "step": r[1], "model": r[2],
            "duration_ms": r[3], "input_summary": r[4],
            "output_json": r[5], "ok": r[6], "error": r[7],
            "created_at": r[8],
        }
        try:
            d["output"] = json.loads(d.pop("output_json") or "{}")
        except json.JSONDecodeError:
            d["output"] = {}
        d["ok"] = bool(d["ok"])
        out.append(d)
    return out


# ── JSON-mode Ollama call ───────────────────────────────────────


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _utf8_post_json(url: str, body_dict: dict, *, timeout: int):
    """Match interpret_service._utf8_post — UTF-8 body bytes to dodge
    Windows-Python non-ASCII mangling."""
    body_bytes = json.dumps(body_dict, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body_bytes, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    return urllib.request.urlopen(req, timeout=timeout)


def call_ollama_json(
    messages: list[dict],
    *,
    model: str,
    url: str,
    num_predict: int,
    temperature: float = JSON_TEMPERATURE,
) -> dict:
    """One-shot non-streaming chat call asking for JSON output.

    Returns the parsed dict. Raises on transport failure. If the
    model returns garbage that isn't a JSON object, raises ValueError
    — callers should treat that as a step failure, not a crash.
    """
    body = {
        "model": model,
        "stream": False,
        "format": "json",  # Ollama JSON-mode: model must emit valid JSON
        "messages": messages,
        "options": {"temperature": temperature, "num_predict": num_predict},
    }
    endpoint = f"{url.rstrip('/')}/api/chat"
    resp = _utf8_post_json(endpoint, body, timeout=JSON_CALL_TIMEOUT_S)
    with resp:
        raw = resp.read().decode("utf-8")
    payload = json.loads(raw)
    content = (payload.get("message") or {}).get("content", "")
    if not content:
        raise ValueError("Empty content from model")
    # Ollama JSON-mode usually returns clean JSON, but be defensive:
    # strip any code fences or surrounding prose.
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        m = _JSON_BLOCK_RE.search(content)
        if not m:
            raise ValueError(f"No JSON object in model output: {content[:120]!r}")
        return json.loads(m.group(0))


# ── Classifier ──────────────────────────────────────────────────


def _classify_messages(question: str, language: str) -> list[dict]:
    if language == "en":
        sys = (
            "You classify a single tarot question into a strict schema. "
            "Reply ONLY with JSON of this exact shape: "
            '{"topic": one of '
            f'{list(TOPICS)}, '
            '"intent": one of '
            f'{list(INTENTS)}, '
            '"tone": one of '
            f'{list(TONES)}'
            "}. Map ambiguous questions conservatively. "
            "Use 'general' when no specific life domain fits."
        )
    else:
        sys = (
            "你是一个分类器，把一个塔罗问题归入严格的模式。"
            "只能用 JSON 回复，结构如下："
            '{"topic": '
            f'{list(TOPICS)} 中的一个,'
            '"intent": '
            f'{list(INTENTS)} 中的一个,'
            '"tone": '
            f'{list(TONES)} 中的一个'
            "}。模糊问题保守分类，无法对应到某个生活领域时用 general。"
        )
    return [
        {"role": "system", "content": sys},
        {"role": "user", "content": question.strip()},
    ]


def _coerce_enum(value: object, allowed: tuple[str, ...], fallback: str) -> str:
    """Map model-returned label to closed vocabulary; fallback on mismatch."""
    if isinstance(value, str):
        v = value.strip().lower()
        if v in allowed:
            return v
        # tolerate simple aliasing
        for opt in allowed:
            if v.startswith(opt) or opt in v:
                return opt
    return fallback


def classify(
    question: str,
    *,
    model: str,
    url: str,
    language: str = "zh",
) -> tuple[AgentStep, dict]:
    """Classify the question. Always returns a step + a classification
    dict. If the call fails, returns an ok=False step and a safe
    default classification (general / clarity / neutral) so downstream
    code can proceed."""
    started = time.monotonic()
    summary = question.strip()[:200]
    default = {"topic": "general", "intent": "clarity", "tone": "neutral"}
    try:
        raw = call_ollama_json(
            _classify_messages(question, language),
            model=model, url=url, num_predict=CLASSIFY_NUM_PREDICT,
        )
    except (urllib.error.URLError, ValueError, json.JSONDecodeError) as exc:
        dur = int((time.monotonic() - started) * 1000)
        step = AgentStep(
            step="classify", model=model, duration_ms=dur,
            input_summary=summary, output=default, ok=False, error=str(exc)[:200],
        )
        return step, default

    result = {
        "topic": _coerce_enum(raw.get("topic"), TOPICS, "general"),
        "intent": _coerce_enum(raw.get("intent"), INTENTS, "clarity"),
        "tone": _coerce_enum(raw.get("tone"), TONES, "neutral"),
    }
    dur = int((time.monotonic() - started) * 1000)
    step = AgentStep(
        step="classify", model=model, duration_ms=dur,
        input_summary=summary, output=result, ok=True,
    )
    return step, result


# ── Critic ──────────────────────────────────────────────────────


def _critique_messages(
    answer: str,
    *,
    question: str,
    cards: list[dict],
    language: str,
) -> list[dict]:
    # Compact card descriptor so the critic prompt stays small.
    def _name(c: dict) -> str:
        key = "zh" if language == "zh" else "en"
        nm = c.get(key) or c.get("zh") or c.get("en") or f"#{c.get('card_id', c.get('cardId', '?'))}"
        rev = bool(c.get("is_reversed", c.get("isReversed", False)))
        suffix = ("逆位" if language == "zh" else " (reversed)") if rev else ""
        return f"{nm}{suffix}"

    card_list = ", ".join(_name(c) for c in cards) if cards else "(none)"

    if language == "en":
        sys = (
            "You are a strict critic of tarot interpretations. "
            "Score the answer 0-10 on whether it (a) addresses the user's question, "
            "(b) references all drawn cards, (c) avoids stock 'AI-assistant' phrasing, "
            "(d) reads as natural prose (not a numbered list), "
            "(e) does not claim to know a third party's private thoughts, "
            "escalate fear, present fate as fixed, or overreach on high-stakes decisions. "
            "Reply ONLY with JSON: "
            '{"score": 0-10 int, "issues": [array of any of '
            f'{list(CRITIQUE_ISSUES)}'
            '], "needs_retry": bool, "summary": "one short sentence"}.'
        )
        user = (
            f"Question: {question}\n"
            f"Cards drawn: {card_list}\n\n"
            f"Answer to judge:\n{answer}"
        )
    else:
        sys = (
            "你是塔罗解读的严格审查者。"
            "请按 0-10 分给答案打分，依据是："
            "(a) 是否回应了用户的问题，(b) 是否提到了所有抽到的牌，"
            "(c) 是否避免了 AI 客套套话，(d) 读起来是否自然的散文（而非编号列表）。"
            "同时检查是否读心、制造恐惧、使用宿命论，或在医疗、法律、财务等高风险问题上越界。"
            "只能用 JSON 回复："
            '{"score": 0-10 整数, "issues": ['
            f'{list(CRITIQUE_ISSUES)} 中的任意子集'
            '], "needs_retry": 布尔值, "summary": "一句话总结"}。'
        )
        user = (
            f"问题：{question}\n"
            f"抽到的牌：{card_list}\n\n"
            f"要评判的答案：\n{answer}"
        )
    return [{"role": "system", "content": sys}, {"role": "user", "content": user}]


def critique(
    answer: str,
    *,
    question: str,
    cards: list[dict],
    model: str,
    url: str,
    language: str = "zh",
) -> tuple[AgentStep, dict]:
    """Critique a generated answer against the question + cards.

    Always returns a step + a critique dict. On failure: ok=False
    step and a benign critique ({score:5, issues:[], needs_retry:false})
    so the orchestrator never blocks on the critic.
    """
    started = time.monotonic()
    summary = f"answer_len={len(answer)} q={question[:60]!r}"
    default = {"score": 5, "issues": [], "needs_retry": False, "summary": "(critic unavailable)"}

    if not answer.strip():
        dur = int((time.monotonic() - started) * 1000)
        out = {"score": 0, "issues": ["too_short"], "needs_retry": True,
               "summary": "empty answer"}
        return AgentStep(
            step="critique", model=model, duration_ms=dur,
            input_summary=summary, output=out, ok=True,
        ), out

    try:
        raw = call_ollama_json(
            _critique_messages(answer, question=question, cards=cards, language=language),
            model=model, url=url, num_predict=CRITIQUE_NUM_PREDICT,
        )
    except (urllib.error.URLError, ValueError, json.JSONDecodeError) as exc:
        dur = int((time.monotonic() - started) * 1000)
        step = AgentStep(
            step="critique", model=model, duration_ms=dur,
            input_summary=summary, output=default, ok=False, error=str(exc)[:200],
        )
        return step, default

    # Coerce + sanitize
    try:
        score = int(raw.get("score", 5))
    except (TypeError, ValueError):
        score = 5
    score = max(0, min(10, score))
    issues = raw.get("issues") or []
    if not isinstance(issues, list):
        issues = []
    issues = [i for i in issues if isinstance(i, str) and i in CRITIQUE_ISSUES]
    needs_retry = bool(raw.get("needs_retry", score < 5))
    summary_text = str(raw.get("summary") or "")[:200]
    out = {"score": score, "issues": issues, "needs_retry": needs_retry,
           "summary": summary_text}
    dur = int((time.monotonic() - started) * 1000)
    step = AgentStep(
        step="critique", model=model, duration_ms=dur,
        input_summary=summary, output=out, ok=True,
    )
    return step, out


# ── Helper: synthesize retrieve + generate steps for trace symmetry ─


def retrieve_step(
    *, retrieved: list[dict], duration_ms: int, topic_bias: str | None,
) -> AgentStep:
    """Wrap an already-computed retrieval result as a trace step.
    Retrieval itself happens in interpret_rag; this just records it."""
    return AgentStep(
        step="retrieve",
        model=None,  # retrieval uses the embed model, recorded elsewhere
        duration_ms=duration_ms,
        input_summary=f"topic_bias={topic_bias or 'none'}",
        output={
            "count": len(retrieved),
            "entries": [
                {
                    "card_id": c.get("card_id"),
                    "orientation": c.get("orientation"),
                    "score": round(float(c.get("score", 0.0)), 4),
                }
                for c in retrieved
            ],
            "topic_bias": topic_bias,
        },
        ok=True,
    )


def generate_step(
    *, model: str, duration_ms: int, answer: str, prompt_hash: str,
) -> AgentStep:
    """Wrap a finished generation as a trace step."""
    return AgentStep(
        step="generate",
        model=model,
        duration_ms=duration_ms,
        input_summary=f"prompt_hash={prompt_hash[:12]}",
        output={
            "length": len(answer),
            "preview": answer[:160],
            "prompt_hash": prompt_hash,
        },
        ok=True,
    )
