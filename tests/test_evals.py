"""
Tests for the eval pipeline. All LLM calls are mocked — no Ollama
or OpenRouter dependency at test time.

Run:
    python -m unittest tests.test_evals -v
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import interpret_agent  # noqa: E402
import interpret_service  # noqa: E402
from evals import judge as judge_mod  # noqa: E402
from evals import report as report_mod  # noqa: E402
from evals import runner as runner_mod  # noqa: E402


def make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    interpret_service.migrate(conn)
    return conn


# ── Golden set integrity ───────────────────────────────────────


class TestGoldenSet(unittest.TestCase):
    def setUp(self):
        self.items = runner_mod.load_golden_set()

    def test_has_30_items(self):
        self.assertEqual(len(self.items), 30)

    def test_all_ids_unique(self):
        ids = [it.id for it in self.items]
        self.assertEqual(len(ids), len(set(ids)))

    def test_topics_in_closed_vocab(self):
        for it in self.items:
            self.assertIn(it.topic, interpret_agent.TOPICS)

    def test_every_item_has_three_cards(self):
        for it in self.items:
            self.assertEqual(len(it.cards), 3, f"{it.id} should have 3 cards")
            for c in it.cards:
                self.assertIn("card_id", c)
                self.assertIn("is_reversed", c)

    def test_every_topic_represented_evenly(self):
        from collections import Counter
        counts = Counter(it.topic for it in self.items)
        for topic in interpret_agent.TOPICS:
            self.assertGreaterEqual(counts[topic], 4,
                                    f"topic {topic} underrepresented: {counts[topic]}")

    def test_every_card_id_resolves_in_corpus(self):
        # Every card_id+orientation in the golden set must exist in
        # the corpus — otherwise the prompt builder would inject "?".
        for it in self.items:
            cards = runner_mod.build_cards_for_item(it)
            for c in cards:
                self.assertNotEqual(c["zh"], f"#{c['card_id']}",
                                    f"{it.id}: card {c['card_id']} missing from corpus")


# ── Trace metric extraction ────────────────────────────────────


class TestExtractMetrics(unittest.TestCase):
    def test_pulls_each_step(self):
        trace = [
            {"step": "classify", "duration_ms": 100,
             "output": {"topic": "career"}},
            {"step": "retrieve", "duration_ms": 5, "output": {}},
            {"step": "generate", "duration_ms": 8000, "output": {}},
            {"step": "critique", "duration_ms": 1200,
             "output": {"score": 7, "issues": ["slop_phrase"]}},
        ]
        m = runner_mod._extract_metrics(trace)
        self.assertEqual(m["classify_ms"], 100)
        self.assertEqual(m["retrieve_ms"], 5)
        self.assertEqual(m["generate_ms"], 8000)
        self.assertEqual(m["critique_ms"], 1200)
        self.assertEqual(m["topic_predicted"], "career")
        self.assertEqual(m["critique_score"], 7)
        self.assertEqual(m["critique_issues"], ["slop_phrase"])

    def test_missing_steps_default_to_zero(self):
        m = runner_mod._extract_metrics([])
        self.assertEqual(m["classify_ms"], 0)
        self.assertIsNone(m["topic_predicted"])
        self.assertEqual(m["critique_issues"], [])


# ── Judge parsing ──────────────────────────────────────────────


class TestJudgeScoreParsing(unittest.TestCase):
    def test_clean_payload(self):
        raw = {"relevance": 5, "card_grounding": 4, "coherence": 4,
               "specificity": 3, "style_match": 4, "notes": "solid"}
        s = judge_mod.parse_score(raw)
        self.assertEqual(s.total(), 20)
        self.assertEqual(s.normalized(), 8.0)
        self.assertEqual(s.notes, "solid")

    def test_out_of_range_is_clamped(self):
        raw = {"relevance": 99, "card_grounding": -3, "coherence": 5,
               "specificity": 2, "style_match": 4}
        s = judge_mod.parse_score(raw)
        self.assertEqual(s.relevance, 5)
        self.assertEqual(s.card_grounding, 0)

    def test_missing_keys_default_to_zero(self):
        s = judge_mod.parse_score({})
        self.assertEqual(s.total(), 0)

    def test_non_numeric_coerces_to_zero(self):
        s = judge_mod.parse_score({"relevance": "good", "coherence": None})
        self.assertEqual(s.relevance, 0)
        self.assertEqual(s.coherence, 0)


class TestJudgeCall(unittest.TestCase):
    def test_returns_none_without_api_key(self):
        score = judge_mod.judge(
            question="q", cards=[], style="traditional", language="zh",
            answer="ans", api_key="",
        )
        self.assertIsNone(score)

    def test_call_failure_returns_none(self):
        with mock.patch.object(judge_mod, "_call_openrouter_json",
                               side_effect=ValueError("nope")):
            score = judge_mod.judge(
                question="q", cards=[], style="traditional", language="zh",
                answer="ans", api_key="sk-xxx",
            )
        self.assertIsNone(score)

    def test_happy_path(self):
        fake = {"relevance": 4, "card_grounding": 5, "coherence": 4,
                "specificity": 3, "style_match": 4, "notes": "ok"}
        with mock.patch.object(judge_mod, "_call_openrouter_json", return_value=fake):
            score = judge_mod.judge(
                question="q", cards=[], style="traditional", language="zh",
                answer="ans", api_key="sk-xxx",
            )
        self.assertIsNotNone(score)
        self.assertEqual(score.normalized(), 8.0)


# ── Aggregation ────────────────────────────────────────────────


def _result(item_id, expected, predicted, *, judge=None, critique=None,
            error=None, gen_ms=1000, total_ms=2000, length=200):
    return runner_mod.EvalResult(
        item_id=item_id, topic_expected=expected, topic_predicted=predicted,
        topic_match=(expected == predicted),
        answer="x" * length, answer_length=length,
        classify_ms=100, retrieve_ms=10, generate_ms=gen_ms,
        critique_ms=500, total_ms=total_ms,
        critique_score=critique, critique_issues=[],
        judge_score=judge, error=error,
    )


class TestSummarize(unittest.TestCase):
    def test_topic_accuracy(self):
        results = [
            _result("a", "career", "career"),
            _result("b", "career", "general"),
            _result("c", "growth", "growth"),
            _result("d", "growth", "growth"),
        ]
        s = runner_mod.summarize(results)
        self.assertEqual(s["n"], 4)
        self.assertEqual(s["topic_correct"], 3)
        self.assertEqual(s["topic_accuracy"], 0.75)
        self.assertEqual(s["by_topic"]["career"]["topic_accuracy"], 0.5)
        self.assertEqual(s["by_topic"]["growth"]["topic_accuracy"], 1.0)

    def test_avg_judge_when_partial(self):
        # Only one of two has a judge score; avg uses only judged rows.
        results = [
            _result("a", "career", "career",
                    judge={"normalized": 8.0, "total": 20}),
            _result("b", "career", "career"),
        ]
        s = runner_mod.summarize(results)
        self.assertEqual(s["avg_judge_score"], 8.0)
        self.assertEqual(s["judge_n"], 1)

    def test_empty_results_is_safe(self):
        s = runner_mod.summarize([])
        self.assertEqual(s, {"n": 0})


# ── Report rendering ───────────────────────────────────────────


class TestReport(unittest.TestCase):
    def test_renders_with_or_without_judge(self):
        results = [
            _result("a", "career", "career", critique=8,
                    judge={"normalized": 7.6, "notes": "good"}),
            _result("b", "growth", "general", critique=4),
        ]
        summary = runner_mod.summarize(results)
        md = report_mod.render_markdown(
            results, summary,
            language="zh", style="traditional", judge_enabled=True,
        )
        self.assertIn("Eval Report", md)
        self.assertIn("Classifier topic accuracy", md)
        self.assertIn("`a`", md)        # sample-answer header
        self.assertIn("✓", md)          # match indicator
        self.assertIn("✗", md)          # mismatch indicator
        self.assertIn("career", md)
        self.assertIn("growth", md)

    def test_escapes_pipe_in_notes(self):
        results = [_result("a", "career", "career",
                           judge={"normalized": 8.0,
                                  "notes": "pipe | char"})]
        summary = runner_mod.summarize(results)
        md = report_mod.render_markdown(
            results, summary,
            language="zh", style="traditional", judge_enabled=True,
        )
        self.assertIn(r"pipe \| char", md)


# ── Single-item runner (mocked stream) ─────────────────────────


class TestRunOne(unittest.TestCase):
    def test_streams_and_collects(self):
        conn = make_conn()
        try:
            item = runner_mod.EvalItem(
                id="career-test", topic="career",
                question_zh="测试问题？", question_en="test?",
                cards=[{"card_id": 0, "is_reversed": False}],
            )

            def fake_stream(*args, **kwargs):
                # Side effect: record a fake classify trace so
                # _extract_metrics can pull a topic.
                rid = kwargs["reading_id"]
                trace_id = interpret_agent.new_trace_id()
                interpret_agent.record_step(
                    conn, reading_id=rid, trace_id=trace_id, step_index=0,
                    step=interpret_agent.AgentStep(
                        step="classify", model="m", duration_ms=42,
                        input_summary="测试问题？",
                        output={"topic": "career", "intent": "decision",
                                "tone": "neutral"},
                        ok=True,
                    ),
                )
                # Emit fake stream pieces.
                for piece in ("Hello ", "world"):
                    yield piece

            with mock.patch.object(
                interpret_service, "interpret_reading_stream",
                side_effect=fake_stream,
            ):
                result = runner_mod.run_one(item, conn, eval_index=0)

            self.assertEqual(result.item_id, "career-test")
            self.assertEqual(result.answer, "Hello world")
            self.assertEqual(result.topic_predicted, "career")
            self.assertTrue(result.topic_match)
            self.assertIsNone(result.error)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
