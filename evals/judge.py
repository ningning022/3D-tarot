"""
LM-as-judge for the interpretation agent. Calls a strong cloud
model via OpenRouter with a strict JSON-mode rubric and aggregates
scores per item.

Why OpenRouter (cloud) and not the local Ollama qwen2.5:7b? The
critic step inside the agent already uses the local model. Using
a *different, larger* model as the eval judge gives independent
signal — otherwise we'd be grading the student with their own
exam paper.

The judge is OPTIONAL: when no OpenRouter API key is configured
the runner skips judging gracefully and the report falls back to
the local critique score.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Sequence

log = logging.getLogger("evals.judge")

DEFAULT_JUDGE_MODEL = "qwen/qwen-2.5-72b-instruct"
DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1"
JUDGE_TIMEOUT_S = 90
JUDGE_TEMPERATURE = 0.1   # tight: this is structured grading
JUDGE_MAX_TOKENS = 400

# 5 axes × 5 points each = 25 max. Normalized to 10 in `Score.normalized()`.
RUBRIC_AXES: tuple[str, ...] = (
    "relevance",       # does it actually answer the user's question
    "card_grounding",  # does it engage with each drawn card (not just name-drop)
    "coherence",       # natural prose, not a numbered list, no contradictions
    "specificity",     # concrete vs vague platitudes
    "style_match",     # matches the requested interpretation style
)


@dataclass(frozen=True)
class Score:
    relevance: int
    card_grounding: int
    coherence: int
    specificity: int
    style_match: int
    notes: str = ""

    def total(self) -> int:
        return (self.relevance + self.card_grounding + self.coherence
                + self.specificity + self.style_match)

    def normalized(self) -> float:
        """Total /25 → out of 10, two decimals."""
        return round(self.total() / 2.5, 2)

    def to_dict(self) -> dict:
        return {
            "relevance": self.relevance,
            "card_grounding": self.card_grounding,
            "coherence": self.coherence,
            "specificity": self.specificity,
            "style_match": self.style_match,
            "total": self.total(),
            "normalized": self.normalized(),
            "notes": self.notes,
        }


# ── Prompt ──────────────────────────────────────────────────


def _judge_messages(
    *,
    question: str,
    cards: Sequence[dict],
    style: str,
    language: str,
    answer: str,
) -> list[dict]:
    card_names = [
        f"{c.get('zh', c.get('en', '?'))}"
        f"{'（逆位）' if c.get('is_reversed', c.get('isReversed')) else ''}"
        for c in cards
    ]
    card_list = "、".join(card_names) if card_names else "(none)"

    sys = (
        "You are a strict, structured judge of tarot interpretations. "
        "Score the candidate answer on five axes, 0-5 each (integer): "
        "relevance (does it directly address the user's question), "
        "card_grounding (does it meaningfully engage with each drawn card, "
        "not just name them), coherence (natural prose, no contradictions, "
        "not a bullet list when prose was asked), specificity (concrete vs "
        "vague platitudes), style_match (matches the requested style). "
        "Reply ONLY with strict JSON of shape: "
        '{"relevance": int, "card_grounding": int, "coherence": int, '
        '"specificity": int, "style_match": int, "notes": "one short sentence"}'
        ". Be calibrated: 5 is excellent, 3 is acceptable, 1 is poor. "
        "Do not pad scores."
    )
    user = (
        f"Question ({language}): {question}\n"
        f"Cards drawn: {card_list}\n"
        f"Requested style: {style}\n\n"
        f"Candidate answer:\n{answer}"
    )
    return [
        {"role": "system", "content": sys},
        {"role": "user", "content": user},
    ]


# ── Transport ───────────────────────────────────────────────


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _utf8_post(url: str, body: dict, headers: dict, timeout: int):
    """UTF-8 bytes POST — see CLAUDE.md Rule 1."""
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    for k, v in headers.items():
        req.add_header(k, v)
    return urllib.request.urlopen(req, timeout=timeout)


def _call_openrouter_json(
    messages: list[dict],
    *,
    api_key: str,
    model: str,
    url: str,
) -> dict:
    body = {
        "model": model,
        "stream": False,
        "messages": messages,
        "temperature": JUDGE_TEMPERATURE,
        "max_tokens": JUDGE_MAX_TOKENS,
        # OpenRouter supports response_format passthrough for models
        # that implement it; harmless for those that don't.
        "response_format": {"type": "json_object"},
    }
    endpoint = f"{url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://github.com/ningning022/3D-tarot",
        "X-Title": "Akashic Tarot Eval",
    }
    resp = _utf8_post(endpoint, body, headers=headers, timeout=JUDGE_TIMEOUT_S)
    with resp:
        raw = resp.read().decode("utf-8")
    payload = json.loads(raw)
    choices = payload.get("choices") or []
    if not choices:
        raise ValueError(f"OpenRouter returned no choices: {raw[:200]!r}")
    content = (choices[0].get("message") or {}).get("content", "")
    if not content:
        raise ValueError("OpenRouter returned empty content")
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        m = _JSON_BLOCK_RE.search(content)
        if not m:
            raise ValueError(f"No JSON block in judge output: {content[:200]!r}")
        return json.loads(m.group(0))


# ── Parsing ─────────────────────────────────────────────────


def _clamp_axis(value: object) -> int:
    """Coerce to int and clamp to 0..5."""
    try:
        v = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(5, v))


def parse_score(raw: dict) -> Score:
    """Coerce a model-returned dict into a Score. Tolerant of
    missing keys, extra keys, and out-of-range integers."""
    return Score(
        relevance=_clamp_axis(raw.get("relevance")),
        card_grounding=_clamp_axis(raw.get("card_grounding")),
        coherence=_clamp_axis(raw.get("coherence")),
        specificity=_clamp_axis(raw.get("specificity")),
        style_match=_clamp_axis(raw.get("style_match")),
        notes=str(raw.get("notes", ""))[:200],
    )


# ── Public entry ────────────────────────────────────────────


def judge(
    *,
    question: str,
    cards: Sequence[dict],
    style: str,
    language: str,
    answer: str,
    api_key: str,
    model: str = DEFAULT_JUDGE_MODEL,
    url: str = DEFAULT_OPENROUTER_URL,
) -> Score | None:
    """Return a Score, or None if the call failed (caller logs and continues)."""
    if not api_key:
        return None
    try:
        raw = _call_openrouter_json(
            _judge_messages(
                question=question, cards=cards,
                style=style, language=language, answer=answer,
            ),
            api_key=api_key, model=model, url=url,
        )
    except (urllib.error.URLError, ValueError, json.JSONDecodeError) as exc:
        log.warning("judge call failed: %s", exc)
        return None
    return parse_score(raw)
