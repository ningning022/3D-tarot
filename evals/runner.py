"""
Eval runner. Loads the golden set, runs each item through the
agent pipeline, optionally judges the output with OpenRouter,
and returns structured results.

The runner does NOT write to the interpretations table
(``persist=False``) — eval generations are throwaway. It DOES
write agent_steps rows so the trace is inspectable later. To keep
eval traces separate from real reading traces, runner assigns
synthetic reading_ids in the ``EVAL_READING_ID_OFFSET..`` range.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import interpret_agent  # noqa: E402
import interpret_rag    # noqa: E402
import interpret_service  # noqa: E402
from evals import judge as judge_mod  # noqa: E402

log = logging.getLogger("evals.runner")

DEFAULT_GOLDEN_PATH = HERE / "golden_set.json"
EVAL_READING_ID_OFFSET = 100_000   # eval rows live above this id


# ── Dataclasses ─────────────────────────────────────────────


@dataclass(frozen=True)
class EvalItem:
    id: str
    topic: str
    question_zh: str
    question_en: str
    cards: list[dict]   # each: {card_id, is_reversed}

    def question(self, language: str) -> str:
        return self.question_en if language == "en" else self.question_zh


@dataclass
class EvalResult:
    item_id: str
    topic_expected: str
    topic_predicted: str | None
    topic_match: bool
    answer: str
    answer_length: int
    classify_ms: int
    retrieve_ms: int
    generate_ms: int
    critique_ms: int
    total_ms: int
    critique_score: int | None       # local 0-10
    critique_issues: list[str] = field(default_factory=list)
    judge_score: dict | None = None  # cloud rubric (Score.to_dict())
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "item_id": self.item_id,
            "topic_expected": self.topic_expected,
            "topic_predicted": self.topic_predicted,
            "topic_match": self.topic_match,
            "answer": self.answer,
            "answer_length": self.answer_length,
            "classify_ms": self.classify_ms,
            "retrieve_ms": self.retrieve_ms,
            "generate_ms": self.generate_ms,
            "critique_ms": self.critique_ms,
            "total_ms": self.total_ms,
            "critique_score": self.critique_score,
            "critique_issues": self.critique_issues,
            "judge_score": self.judge_score,
            "error": self.error,
        }


# ── Golden-set loader ───────────────────────────────────────


def load_golden_set(path: Path = DEFAULT_GOLDEN_PATH) -> list[EvalItem]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = []
    for entry in raw["items"]:
        items.append(EvalItem(
            id=entry["id"],
            topic=entry["topic"],
            question_zh=entry["question_zh"],
            question_en=entry["question_en"],
            cards=list(entry["cards"]),
        ))
    return items


# ── Card resolution ─────────────────────────────────────────


def build_cards_for_item(item: EvalItem) -> list[dict]:
    """Translate the golden-set card spec into the dict shape that
    interpret_prompts expects (slot/slot_label/zh/en/is_reversed)."""
    corpus = interpret_rag.load_corpus()
    by_key = {(e.card_id, e.orientation): e for e in corpus}
    cards: list[dict] = []
    for slot_idx, c in enumerate(item.cards, start=1):
        cid = int(c["card_id"])
        rev = bool(c.get("is_reversed"))
        orient = "reversed" if rev else "upright"
        entry = by_key.get((cid, orient))
        zh = entry.zh if entry else f"#{cid}"
        en = entry.en if entry else f"#{cid}"
        cards.append({
            "slot": slot_idx,
            "slot_label": f"Slot {slot_idx}",
            "zh": zh,
            "en": en,
            "card_id": cid,
            "is_reversed": rev,
        })
    return cards


# ── Trace extraction ────────────────────────────────────────


def _extract_metrics(trace: list[dict]) -> dict:
    """Pluck per-step durations + the classifier's topic + critique."""
    out = {
        "classify_ms": 0, "retrieve_ms": 0,
        "generate_ms": 0, "critique_ms": 0,
        "topic_predicted": None,
        "critique_score": None, "critique_issues": [],
    }
    for step in trace:
        s = step["step"]
        dur = int(step.get("duration_ms", 0))
        if s == "classify":
            out["classify_ms"] = dur
            out["topic_predicted"] = step["output"].get("topic")
        elif s == "retrieve":
            out["retrieve_ms"] = dur
        elif s == "generate":
            out["generate_ms"] = dur
        elif s == "critique":
            out["critique_ms"] = dur
            out["critique_score"] = step["output"].get("score")
            out["critique_issues"] = step["output"].get("issues", [])
    return out


# ── Single-item runner ──────────────────────────────────────


def run_one(
    item: EvalItem,
    conn,
    *,
    language: str = "zh",
    style: str = "traditional",
    judge_enabled: bool = False,
    judge_model: str | None = None,
    eval_index: int = 0,
) -> EvalResult:
    """Run the full agent pipeline for one golden-set item."""
    settings = interpret_service.get_settings(conn)
    cards = build_cards_for_item(item)
    question = item.question(language)
    synthetic_reading_id = EVAL_READING_ID_OFFSET + eval_index

    started = time.monotonic()
    try:
        buffer = []
        for chunk in interpret_service.interpret_reading_stream(
            conn,
            reading_id=synthetic_reading_id,
            cards=cards,
            template_name="Eval Spread",
            style=style, language=language,
            question=question,
            persist=False,        # don't pollute interpretations table
            enable_rag=True,
            enable_agent=True,
        ):
            buffer.append(chunk)
        answer = "".join(buffer).strip()
        err = None
    except Exception as exc:   # noqa: BLE001 — eval must capture everything
        answer = ""
        err = f"{type(exc).__name__}: {exc}"
        log.exception("eval item %s failed", item.id)

    total_ms = int((time.monotonic() - started) * 1000)
    trace = interpret_agent.load_trace(conn, reading_id=synthetic_reading_id)
    metrics = _extract_metrics(trace)

    # Optional judge
    judge_payload = None
    if judge_enabled and answer and not err:
        api_key = settings.get("openrouter_api_key", "").strip()
        if api_key:
            score = judge_mod.judge(
                question=question, cards=cards,
                style=style, language=language, answer=answer,
                api_key=api_key,
                model=judge_model or judge_mod.DEFAULT_JUDGE_MODEL,
                url=settings.get("openrouter_url", judge_mod.DEFAULT_OPENROUTER_URL),
            )
            judge_payload = score.to_dict() if score else None

    return EvalResult(
        item_id=item.id,
        topic_expected=item.topic,
        topic_predicted=metrics["topic_predicted"],
        topic_match=(metrics["topic_predicted"] == item.topic),
        answer=answer,
        answer_length=len(answer),
        classify_ms=metrics["classify_ms"],
        retrieve_ms=metrics["retrieve_ms"],
        generate_ms=metrics["generate_ms"],
        critique_ms=metrics["critique_ms"],
        total_ms=total_ms,
        critique_score=metrics["critique_score"],
        critique_issues=metrics["critique_issues"],
        judge_score=judge_payload,
        error=err,
    )


# ── Full-set runner ─────────────────────────────────────────


def run_all(
    items: Iterable[EvalItem],
    conn,
    *,
    language: str = "zh",
    style: str = "traditional",
    limit: int | None = None,
    judge_enabled: bool = False,
    judge_model: str | None = None,
    progress: callable | None = None,
) -> list[EvalResult]:
    results: list[EvalResult] = []
    items_list = list(items)
    if limit:
        items_list = items_list[:limit]
    for i, item in enumerate(items_list):
        if progress:
            progress(i, len(items_list), item.id)
        result = run_one(
            item, conn,
            language=language, style=style,
            judge_enabled=judge_enabled,
            judge_model=judge_model,
            eval_index=i,
        )
        results.append(result)
    return results


# ── Aggregation ─────────────────────────────────────────────


def summarize(results: list[EvalResult]) -> dict:
    """Compute summary stats for the report header."""
    n = len(results)
    if n == 0:
        return {"n": 0}

    topic_correct = sum(1 for r in results if r.topic_match)
    by_topic: dict[str, dict] = {}
    for r in results:
        t = r.topic_expected
        bucket = by_topic.setdefault(t, {"n": 0, "correct": 0, "judge_sum": 0.0, "judge_n": 0})
        bucket["n"] += 1
        if r.topic_match:
            bucket["correct"] += 1
        if r.judge_score:
            bucket["judge_sum"] += r.judge_score["normalized"]
            bucket["judge_n"] += 1

    judge_scored = [r for r in results if r.judge_score]
    critique_scored = [r for r in results if r.critique_score is not None]
    errored = [r for r in results if r.error]

    def avg(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 2) if xs else None

    return {
        "n": n,
        "errors": len(errored),
        "topic_accuracy": round(topic_correct / n, 3),
        "topic_correct": topic_correct,
        "avg_total_ms": int(sum(r.total_ms for r in results) / n),
        "avg_generate_ms": int(sum(r.generate_ms for r in results) / n),
        "avg_classify_ms": int(sum(r.classify_ms for r in results) / n),
        "avg_critique_ms": int(sum(r.critique_ms for r in results) / n),
        "avg_answer_length": int(sum(r.answer_length for r in results) / n),
        "avg_critique_score": avg([r.critique_score for r in critique_scored
                                    if r.critique_score is not None]),
        "avg_judge_score": avg([r.judge_score["normalized"] for r in judge_scored]),
        "judge_n": len(judge_scored),
        "by_topic": {
            t: {
                "n": b["n"],
                "topic_accuracy": round(b["correct"] / b["n"], 3) if b["n"] else 0.0,
                "avg_judge_score": (round(b["judge_sum"] / b["judge_n"], 2)
                                    if b["judge_n"] else None),
            }
            for t, b in sorted(by_topic.items())
        },
    }
