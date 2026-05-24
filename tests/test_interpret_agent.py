"""
Tests for interpret_agent — schema, classify/critique JSON contract,
step persistence, trace round-trip. Ollama calls are mocked.

Run:
    python -m unittest tests.test_interpret_agent -v
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import interpret_agent  # noqa: E402


def make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    interpret_agent.migrate(conn)
    return conn


# ── Schema + persistence ──────────────────────────────────────


class TestSchema(unittest.TestCase):
    def test_migrate_is_idempotent(self):
        conn = make_conn()
        try:
            interpret_agent.migrate(conn)  # second call must not error
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(agent_steps)")}
            for required in ("reading_id", "trace_id", "step_index", "step",
                             "output_json", "ok", "duration_ms", "created_at"):
                self.assertIn(required, cols)
        finally:
            conn.close()

    def test_new_trace_id_is_unique_hex(self):
        a = interpret_agent.new_trace_id()
        b = interpret_agent.new_trace_id()
        self.assertNotEqual(a, b)
        self.assertEqual(len(a), 32)
        int(a, 16)  # raises if not hex


class TestRecordAndLoad(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def tearDown(self):
        self.conn.close()

    def test_round_trip_single_trace(self):
        trace = interpret_agent.new_trace_id()
        step1 = interpret_agent.AgentStep(
            step="classify", model="qwen2.5:7b", duration_ms=420,
            input_summary="我应该跳槽吗？",
            output={"topic": "career", "intent": "decision", "tone": "anxious"},
            ok=True,
        )
        step2 = interpret_agent.AgentStep(
            step="generate", model="ollama:qwen2.5:7b", duration_ms=9100,
            input_summary="prompt_hash=abc123",
            output={"length": 412, "preview": "过去你..."},
            ok=True,
        )
        interpret_agent.record_step(self.conn, reading_id=42,
                                    trace_id=trace, step_index=0, step=step1)
        interpret_agent.record_step(self.conn, reading_id=42,
                                    trace_id=trace, step_index=1, step=step2)

        trace_out = interpret_agent.load_trace(self.conn, reading_id=42)
        self.assertEqual(len(trace_out), 2)
        self.assertEqual(trace_out[0]["step"], "classify")
        self.assertEqual(trace_out[0]["output"]["topic"], "career")
        self.assertEqual(trace_out[1]["step"], "generate")
        self.assertEqual(trace_out[1]["duration_ms"], 9100)

    def test_load_trace_returns_only_most_recent_trace(self):
        # Two separate runs for the same reading; load_trace returns
        # only the second one.
        old = interpret_agent.new_trace_id()
        new = interpret_agent.new_trace_id()
        s_old = interpret_agent.AgentStep(
            step="classify", model="m", duration_ms=1, input_summary="x",
            output={"topic": "general"}, ok=True,
        )
        s_new = interpret_agent.AgentStep(
            step="classify", model="m", duration_ms=2, input_summary="y",
            output={"topic": "career"}, ok=True,
        )
        interpret_agent.record_step(self.conn, reading_id=7,
                                    trace_id=old, step_index=0, step=s_old)
        interpret_agent.record_step(self.conn, reading_id=7,
                                    trace_id=new, step_index=0, step=s_new)

        steps = interpret_agent.load_trace(self.conn, reading_id=7)
        self.assertEqual(len(steps), 1)
        self.assertEqual(steps[0]["output"]["topic"], "career")

    def test_load_trace_empty_when_no_steps(self):
        self.assertEqual(interpret_agent.load_trace(self.conn, reading_id=999), [])


# ── Enum coercion ─────────────────────────────────────────────


class TestCoerceEnum(unittest.TestCase):
    def test_exact_match(self):
        self.assertEqual(
            interpret_agent._coerce_enum("career", interpret_agent.TOPICS, "general"),
            "career",
        )

    def test_case_insensitive(self):
        self.assertEqual(
            interpret_agent._coerce_enum("Career", interpret_agent.TOPICS, "general"),
            "career",
        )

    def test_alias_via_substring(self):
        # "career-decision" should still map to "career"
        self.assertEqual(
            interpret_agent._coerce_enum("career-decision", interpret_agent.TOPICS, "general"),
            "career",
        )

    def test_unknown_falls_back(self):
        self.assertEqual(
            interpret_agent._coerce_enum("astrology", interpret_agent.TOPICS, "general"),
            "general",
        )

    def test_non_string_falls_back(self):
        self.assertEqual(
            interpret_agent._coerce_enum(None, interpret_agent.TOPICS, "general"),
            "general",
        )
        self.assertEqual(
            interpret_agent._coerce_enum(42, interpret_agent.TOPICS, "general"),
            "general",
        )


# ── Classifier ────────────────────────────────────────────────


class TestClassify(unittest.TestCase):
    def test_happy_path(self):
        fake = {"topic": "career", "intent": "decision", "tone": "anxious"}
        with mock.patch.object(interpret_agent, "call_ollama_json", return_value=fake):
            step, result = interpret_agent.classify(
                "我应该跳槽吗？", model="qwen2.5:7b",
                url="http://localhost:11434", language="zh",
            )
        self.assertTrue(step.ok)
        self.assertEqual(step.step, "classify")
        self.assertEqual(result["topic"], "career")
        self.assertEqual(result["intent"], "decision")
        self.assertEqual(result["tone"], "anxious")

    def test_coerces_unknown_labels_to_defaults(self):
        fake = {"topic": "astrology", "intent": "guessing", "tone": "vibes"}
        with mock.patch.object(interpret_agent, "call_ollama_json", return_value=fake):
            step, result = interpret_agent.classify(
                "hmm", model="m", url="u", language="en",
            )
        self.assertTrue(step.ok)
        self.assertEqual(result["topic"], "general")
        self.assertEqual(result["intent"], "clarity")
        self.assertEqual(result["tone"], "neutral")

    def test_call_failure_returns_ok_false_step(self):
        def boom(*a, **k):
            raise ValueError("bad json")
        with mock.patch.object(interpret_agent, "call_ollama_json", side_effect=boom):
            step, result = interpret_agent.classify(
                "x", model="m", url="u", language="zh",
            )
        self.assertFalse(step.ok)
        self.assertIn("bad json", step.error or "")
        # Caller still gets a usable default classification:
        self.assertEqual(result, {"topic": "general", "intent": "clarity", "tone": "neutral"})


# ── Critic ────────────────────────────────────────────────────


class TestCritique(unittest.TestCase):
    def test_happy_path_with_clamping(self):
        # Critic returns score outside 0-10; we clamp.
        fake = {"score": 42, "issues": ["off_topic"], "needs_retry": True,
                "summary": "ignores question"}
        with mock.patch.object(interpret_agent, "call_ollama_json", return_value=fake):
            step, out = interpret_agent.critique(
                "some answer", question="q?", cards=[{"card_id": 0, "zh": "愚者"}],
                model="m", url="u", language="zh",
            )
        self.assertTrue(step.ok)
        self.assertEqual(out["score"], 10)
        self.assertEqual(out["issues"], ["off_topic"])
        self.assertTrue(out["needs_retry"])

    def test_invalid_issue_tags_dropped(self):
        fake = {"score": 7, "issues": ["off_topic", "made_up_tag", 123],
                "needs_retry": False, "summary": ""}
        with mock.patch.object(interpret_agent, "call_ollama_json", return_value=fake):
            _step, out = interpret_agent.critique(
                "ans", question="q", cards=[], model="m", url="u", language="en",
            )
        self.assertEqual(out["issues"], ["off_topic"])

    def test_empty_answer_skips_call_and_flags_retry(self):
        with mock.patch.object(interpret_agent, "call_ollama_json") as patched:
            step, out = interpret_agent.critique(
                "   ", question="q", cards=[], model="m", url="u", language="zh",
            )
            patched.assert_not_called()
        self.assertTrue(step.ok)  # local critique, not a call failure
        self.assertEqual(out["score"], 0)
        self.assertIn("too_short", out["issues"])
        self.assertTrue(out["needs_retry"])

    def test_call_failure_returns_safe_default(self):
        with mock.patch.object(interpret_agent, "call_ollama_json",
                               side_effect=ValueError("nope")):
            step, out = interpret_agent.critique(
                "some text", question="q", cards=[], model="m", url="u", language="zh",
            )
        self.assertFalse(step.ok)
        # Caller can still proceed:
        self.assertEqual(out["score"], 5)
        self.assertFalse(out["needs_retry"])


# ── Helper steps (retrieve, generate wrappers) ────────────────


class TestHelperSteps(unittest.TestCase):
    def test_retrieve_step_shape(self):
        retrieved = [
            {"card_id": 9, "orientation": "upright", "score": 1.0},
            {"card_id": 21, "orientation": "reversed", "score": 0.84321},
        ]
        step = interpret_agent.retrieve_step(
            retrieved=retrieved, duration_ms=12, topic_bias="career",
        )
        self.assertEqual(step.step, "retrieve")
        self.assertTrue(step.ok)
        self.assertEqual(step.output["count"], 2)
        self.assertEqual(step.output["topic_bias"], "career")
        # Rounded for compactness:
        self.assertEqual(step.output["entries"][1]["score"], 0.8432)

    def test_generate_step_shape(self):
        step = interpret_agent.generate_step(
            model="ollama:qwen2.5:7b", duration_ms=8800,
            answer="过去你曾选择独处...", prompt_hash="abcdef1234567890",
        )
        self.assertEqual(step.step, "generate")
        self.assertTrue(step.ok)
        self.assertEqual(step.output["length"], len("过去你曾选择独处..."))
        self.assertEqual(step.output["prompt_hash"], "abcdef1234567890")


# ── JSON-mode call output extraction ──────────────────────────


class TestCallOllamaJson(unittest.TestCase):
    def test_extracts_json_from_clean_response(self):
        body = json.dumps({"message": {"content": '{"topic":"career"}'}}).encode("utf-8")
        fake_resp = mock.MagicMock()
        fake_resp.read.return_value = body
        fake_resp.__enter__ = lambda s: s
        fake_resp.__exit__ = lambda *a: None

        with mock.patch.object(interpret_agent, "_utf8_post_json", return_value=fake_resp):
            result = interpret_agent.call_ollama_json(
                [{"role": "user", "content": "q"}],
                model="m", url="http://x", num_predict=64,
            )
        self.assertEqual(result, {"topic": "career"})

    def test_extracts_json_from_prose_wrapped_response(self):
        # Some models prepend chatter even in JSON mode; we recover.
        wrapped = 'Sure, here you go: {"topic":"career","intent":"decision"} done!'
        body = json.dumps({"message": {"content": wrapped}}).encode("utf-8")
        fake_resp = mock.MagicMock()
        fake_resp.read.return_value = body
        fake_resp.__enter__ = lambda s: s
        fake_resp.__exit__ = lambda *a: None

        with mock.patch.object(interpret_agent, "_utf8_post_json", return_value=fake_resp):
            result = interpret_agent.call_ollama_json(
                [{"role": "user", "content": "q"}],
                model="m", url="http://x", num_predict=64,
            )
        self.assertEqual(result["topic"], "career")
        self.assertEqual(result["intent"], "decision")

    def test_empty_content_raises(self):
        body = json.dumps({"message": {"content": ""}}).encode("utf-8")
        fake_resp = mock.MagicMock()
        fake_resp.read.return_value = body
        fake_resp.__enter__ = lambda s: s
        fake_resp.__exit__ = lambda *a: None

        with mock.patch.object(interpret_agent, "_utf8_post_json", return_value=fake_resp):
            with self.assertRaises(ValueError):
                interpret_agent.call_ollama_json(
                    [{"role": "user", "content": "q"}],
                    model="m", url="http://x", num_predict=64,
                )


if __name__ == "__main__":
    unittest.main()
