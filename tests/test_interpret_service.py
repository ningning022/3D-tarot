"""
Tests for interpret_prompts + interpret_service.

Network calls are mocked through a fake urllib.request.urlopen so the
suite runs offline. Persistence is tested against an in-memory SQLite.

Run from the repo root:
    python -m unittest tests.test_interpret_service -v
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import unittest
from contextlib import contextmanager
from unittest import mock

# Make the worktree root importable so `import interpret_service` works
# regardless of where unittest is invoked from.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import interpret_prompts  # noqa: E402
import interpret_service  # noqa: E402


# ── Fixture helpers ──────────────────────────────────────────────


def make_conn() -> sqlite3.Connection:
    """In-memory DB with the readings + interpret tables ready."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spread_number INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'spread',
            template_key TEXT NOT NULL DEFAULT 'free',
            template_name TEXT NOT NULL DEFAULT 'Free',
            reading_date TEXT
        );
        """
    )
    interpret_service.migrate(conn)
    return conn


SAMPLE_CARDS = [
    {"slot": 1, "slot_label": "过去 / Past", "zh": "隐士", "en": "The Hermit", "is_reversed": False},
    {"slot": 2, "slot_label": "现在 / Present", "zh": "月亮", "en": "The Moon", "is_reversed": True},
    {"slot": 3, "slot_label": "未来 / Future", "zh": "太阳", "en": "The Sun", "is_reversed": False},
]


class FakeResponse:
    """Minimal urllib response double — iterable yields raw bytes lines."""

    def __init__(self, lines: list[bytes]):
        self._lines = list(lines)

    def __iter__(self):
        return iter(self._lines)

    def read(self) -> bytes:
        return b"".join(self._lines)

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


@contextmanager
def patch_urlopen(handler):
    """Replace urllib.request.urlopen with a callable that returns a
    FakeResponse the test supplies. The handler receives (url, data,
    timeout, headers) and returns a FakeResponse."""
    captured: list[dict] = []

    def fake_urlopen(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        data = req.data if hasattr(req, "data") else None
        headers = dict(req.headers) if hasattr(req, "headers") else {}
        call = {"url": url, "data": data, "headers": headers, "timeout": timeout}
        captured.append(call)
        return handler(call)

    with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
        yield captured


# ── Prompt builder ──────────────────────────────────────────────


class TestBuildMessages(unittest.TestCase):
    def test_includes_all_cards(self):
        msgs = interpret_prompts.build_messages(SAMPLE_CARDS, "三张牌时间线")
        user_msg = msgs[-1]["content"]
        for card in SAMPLE_CARDS:
            self.assertIn(card["zh"], user_msg)
            self.assertIn(card["slot_label"], user_msg)

    def test_reversed_orientation_marked(self):
        msgs = interpret_prompts.build_messages(SAMPLE_CARDS, "Test")
        user_msg = msgs[-1]["content"]
        # "月亮" is the only reversed card in SAMPLE_CARDS
        # The slot containing 月亮 must say 逆位
        moon_block_idx = user_msg.index("月亮")
        # Find the surrounding 50 chars
        context = user_msg[max(0, moon_block_idx - 100): moon_block_idx + 200]
        self.assertIn("逆位", context)
        # And other slots should say 正位
        self.assertIn("正位", user_msg)

    def test_language_zh_returns_chinese_system_prompt(self):
        msgs = interpret_prompts.build_messages(SAMPLE_CARDS, "Test", language="zh")
        self.assertIn("塔罗", msgs[0]["content"])

    def test_language_en_returns_english_system_prompt(self):
        msgs = interpret_prompts.build_messages(SAMPLE_CARDS, "Test", language="en")
        self.assertIn("tarot", msgs[0]["content"].lower())

    def test_style_overlay_appended(self):
        zh_traditional = interpret_prompts.build_messages(
            SAMPLE_CARDS, "Test", style="traditional"
        )[0]["content"]
        zh_intuitive = interpret_prompts.build_messages(
            SAMPLE_CARDS, "Test", style="intuitive"
        )[0]["content"]
        self.assertNotEqual(zh_traditional, zh_intuitive)
        self.assertIn("Rider-Waite", zh_traditional)
        self.assertIn("直觉", zh_intuitive)

    def test_unknown_style_raises(self):
        with self.assertRaises(ValueError):
            interpret_prompts.build_messages(SAMPLE_CARDS, "Test", style="bogus")

    def test_unknown_language_raises(self):
        with self.assertRaises(ValueError):
            interpret_prompts.build_messages(SAMPLE_CARDS, "Test", language="jp")

    def test_few_shot_present(self):
        # Should have at least system + few-shot pair + user
        msgs = interpret_prompts.build_messages(SAMPLE_CARDS, "Test")
        self.assertGreaterEqual(len(msgs), 4)
        roles = [m["role"] for m in msgs]
        self.assertEqual(roles[0], "system")
        self.assertEqual(roles[-1], "user")


class TestSlopDetector(unittest.TestCase):
    def test_catches_chinese_slop(self):
        self.assertTrue(interpret_prompts.detect_slop("重要的是要相信", "zh"))
        self.assertTrue(interpret_prompts.detect_slop("作为 AI 我建议", "zh"))
        self.assertTrue(interpret_prompts.detect_slop("1. 第一", "zh"))

    def test_catches_english_slop(self):
        self.assertTrue(interpret_prompts.detect_slop("As an AI, I cannot", "en"))
        self.assertTrue(interpret_prompts.detect_slop("It is important to note", "en"))

    def test_clean_text_passes(self):
        clean = "过去你曾选择独处，像隐士那样把灯笼朝向内心。"
        self.assertEqual(interpret_prompts.detect_slop(clean, "zh"), [])


# ── Ollama client ────────────────────────────────────────────────


class TestOllamaClient(unittest.TestCase):
    def test_streams_chunks(self):
        # Three NDJSON lines: two content chunks then done
        lines = [
            json.dumps({"message": {"content": "Hello"}, "done": False}).encode() + b"\n",
            json.dumps({"message": {"content": " world"}, "done": False}).encode() + b"\n",
            json.dumps({"message": {"content": "!"}, "done": True}).encode() + b"\n",
        ]

        def handler(call):
            # Verify body has UTF-8 encoded content
            body = json.loads(call["data"].decode("utf-8"))
            self.assertEqual(body["model"], "qwen2.5:7b")
            self.assertTrue(body["stream"])
            return FakeResponse(lines)

        with patch_urlopen(handler):
            chunks = list(
                interpret_service.stream_ollama(
                    "http://localhost:11434",
                    "qwen2.5:7b",
                    [{"role": "user", "content": "ping"}],
                )
            )
        self.assertEqual("".join(chunks), "Hello world!")

    def test_handles_invalid_json_chunks_gracefully(self):
        lines = [
            b"not json\n",
            json.dumps({"message": {"content": "ok"}, "done": True}).encode() + b"\n",
        ]
        with patch_urlopen(lambda call: FakeResponse(lines)):
            chunks = list(
                interpret_service.stream_ollama(
                    "http://localhost:11434", "qwen2.5:7b", [{"role": "user", "content": "x"}]
                )
            )
        self.assertEqual("".join(chunks), "ok")


# ── OpenRouter client ────────────────────────────────────────────


class TestOpenRouterClient(unittest.TestCase):
    def test_streams_sse_chunks(self):
        sse = [
            b"data: " + json.dumps({"choices": [{"delta": {"content": "Hi"}}]}).encode() + b"\n",
            b"data: " + json.dumps({"choices": [{"delta": {"content": " there"}}]}).encode() + b"\n",
            b"data: [DONE]\n",
        ]

        def handler(call):
            self.assertIn("Authorization", call["headers"])
            return FakeResponse(sse)

        with patch_urlopen(handler):
            chunks = list(
                interpret_service.stream_openrouter(
                    "https://openrouter.ai/api/v1",
                    "qwen/qwen-2.5-72b-instruct",
                    [{"role": "user", "content": "ping"}],
                    api_key="sk-test",
                )
            )
        self.assertEqual("".join(chunks), "Hi there")


# ── Strategy resolver ────────────────────────────────────────────


class TestResolveStrategy(unittest.TestCase):
    def _settings(self, **overrides):
        base = {"backend": "ollama"}
        base.update(overrides)
        return base

    def test_ollama_when_healthy(self):
        with mock.patch.object(
            interpret_service,
            "check_ollama_health",
            return_value={"status": "ready", "model": "qwen2.5:7b", "message": "ok"},
        ):
            strategy = interpret_service.resolve_strategy(self._settings())
        self.assertEqual(strategy.backend, "ollama")

    def test_falls_back_to_openrouter_when_ollama_down(self):
        with mock.patch.object(
            interpret_service,
            "check_ollama_health",
            return_value={"status": "down", "model": "qwen2.5:7b", "message": "fail"},
        ):
            strategy = interpret_service.resolve_strategy(
                self._settings(openrouter_api_key="sk-x")
            )
        self.assertEqual(strategy.backend, "openrouter")
        self.assertEqual(strategy.api_key, "sk-x")

    def test_raises_when_ollama_down_no_key(self):
        with mock.patch.object(
            interpret_service,
            "check_ollama_health",
            return_value={"status": "down", "model": "qwen2.5:7b", "message": "fail"},
        ):
            with self.assertRaises(interpret_service.OllamaUnreachable):
                interpret_service.resolve_strategy(self._settings())

    def test_raises_when_model_missing_no_key(self):
        with mock.patch.object(
            interpret_service,
            "check_ollama_health",
            return_value={
                "status": "model_missing",
                "model": "qwen2.5:7b",
                "message": "[]",
            },
        ):
            with self.assertRaises(interpret_service.OllamaModelMissing):
                interpret_service.resolve_strategy(self._settings())

    def test_explicit_openrouter_requires_key(self):
        with self.assertRaises(interpret_service.OpenRouterNoKey):
            interpret_service.resolve_strategy(self._settings(backend="openrouter"))


# ── Persistence ──────────────────────────────────────────────────


class TestPersistence(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()
        # Insert a reading row so foreign key is happy
        self.conn.execute(
            "INSERT INTO readings(spread_number, created_at) VALUES (1, '2026-01-01T00:00:00+00:00')"
        )
        self.conn.commit()
        self.reading_id = self.conn.execute("SELECT id FROM readings").fetchone()["id"]

    def tearDown(self):
        self.conn.close()

    def test_save_and_load_latest(self):
        interpret_service.save_interpretation(
            self.conn,
            reading_id=self.reading_id,
            model="ollama:qwen2.5:7b",
            style="traditional",
            language="zh",
            content="first interp",
            prompt_hash="abc123",
            duration_ms=1200,
            created_at="2026-01-01T00:00:00+00:00",
        )
        interpret_service.save_interpretation(
            self.conn,
            reading_id=self.reading_id,
            model="ollama:qwen2.5:7b",
            style="intuitive",
            language="zh",
            content="second interp",
            prompt_hash="def456",
            duration_ms=900,
            created_at="2026-01-02T00:00:00+00:00",
        )
        latest = interpret_service.load_interpretation(self.conn, self.reading_id)
        self.assertEqual(latest["content"], "second interp")

        history = interpret_service.load_interpretation(
            self.conn, self.reading_id, all_rows=True
        )
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["style"], "intuitive")
        self.assertEqual(history[1]["style"], "traditional")

    def test_load_returns_none_when_no_rows(self):
        self.assertIsNone(interpret_service.load_interpretation(self.conn, 9999))
        self.assertEqual(interpret_service.load_interpretation(self.conn, 9999, all_rows=True), [])

    def test_prompt_hash_stable(self):
        msgs = interpret_prompts.build_messages(SAMPLE_CARDS, "Test")
        h1 = interpret_service.compute_prompt_hash(msgs)
        h2 = interpret_service.compute_prompt_hash(msgs)
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 16)

    def test_save_loads_versioned_snapshots(self):
        interpretation_id = interpret_service.save_interpretation(
            self.conn,
            reading_id=self.reading_id,
            model="ollama:qwen2.5:7b",
            style="traditional",
            language="zh",
            content="完整回答",
            prompt_hash="abc123",
            duration_ms=1200,
            created_at="2026-07-10T00:00:00+00:00",
            input_snapshot={
                "userQuery": "我应该换工作吗？",
                "cards": SAMPLE_CARDS,
            },
            rag_snapshot={"status": "ready", "entries": [{"card_id": 9}]},
            trace_id="a" * 32,
            prompt_version="manual-general-v1",
            generation_status="complete",
            safety_flags=[],
        )
        row = interpret_service.load_interpretation(self.conn, self.reading_id)
        self.assertEqual(row["id"], interpretation_id)
        self.assertEqual(len(row["public_id"]), 32)
        self.assertEqual(
            row["input_snapshot"]["userQuery"], "我应该换工作吗？"
        )
        self.assertEqual(row["generation_status"], "complete")

    def test_migrate_backfills_public_id_on_legacy_row(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(
            """
            CREATE TABLE readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                spread_number INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            INSERT INTO readings(spread_number, created_at)
            VALUES (1, '2026-01-01');
            CREATE TABLE interpretations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reading_id INTEGER NOT NULL,
                model TEXT NOT NULL,
                style TEXT NOT NULL,
                language TEXT NOT NULL,
                content TEXT NOT NULL,
                prompt_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                duration_ms INTEGER
            );
            INSERT INTO interpretations
                (reading_id, model, style, language, content, prompt_hash, created_at)
            VALUES
                (1, 'legacy', 'traditional', 'zh', '旧回答', 'hash', '2026-01-01');
            """
        )
        try:
            interpret_service.migrate(conn)
            row = conn.execute(
                "SELECT public_id, input_snapshot_json FROM interpretations"
            ).fetchone()
            self.assertEqual(len(row["public_id"]), 32)
            self.assertIsNone(row["input_snapshot_json"])
        finally:
            conn.close()


class TestSettings(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def tearDown(self):
        self.conn.close()

    def test_set_and_get(self):
        interpret_service.set_setting(self.conn, "backend", "openrouter")
        interpret_service.set_setting(self.conn, "openrouter_api_key", "sk-test")
        s = interpret_service.get_settings(self.conn)
        self.assertEqual(s["backend"], "openrouter")
        self.assertEqual(s["openrouter_api_key"], "sk-test")

    def test_upsert_overwrites(self):
        interpret_service.set_setting(self.conn, "backend", "ollama")
        interpret_service.set_setting(self.conn, "backend", "openrouter")
        self.assertEqual(interpret_service.get_settings(self.conn)["backend"], "openrouter")


# ── End-to-end orchestration ─────────────────────────────────────


class TestInterpretReadingStream(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()
        self.conn.execute(
            "INSERT INTO readings(spread_number, created_at) VALUES (1, '2026-01-01T00:00:00+00:00')"
        )
        self.conn.commit()
        self.reading_id = self.conn.execute("SELECT id FROM readings").fetchone()["id"]

    def tearDown(self):
        self.conn.close()

    def test_streams_and_persists(self):
        lines = [
            json.dumps({"message": {"content": "过去"}, "done": False}).encode() + b"\n",
            json.dumps({"message": {"content": "的你"}, "done": False}).encode() + b"\n",
            json.dumps({"message": {"content": "。"}, "done": True}).encode() + b"\n",
        ]
        with mock.patch.object(
            interpret_service,
            "check_ollama_health",
            return_value={"status": "ready", "model": "qwen2.5:7b", "message": "ok"},
        ), patch_urlopen(lambda call: FakeResponse(lines)):
            chunks = list(
                interpret_service.interpret_reading_stream(
                    self.conn,
                    reading_id=self.reading_id,
                    cards=SAMPLE_CARDS,
                    template_name="三张牌时间线",
                    language="zh",
                )
            )
        self.assertEqual("".join(chunks), "过去的你。")
        latest = interpret_service.load_interpretation(self.conn, self.reading_id)
        self.assertEqual(latest["content"], "过去的你。")
        self.assertEqual(latest["model"], "ollama:qwen2.5:7b")
        self.assertGreater(latest["duration_ms"], -1)

    def test_partial_stream_is_persisted_but_marked_partial(self):
        def broken_stream():
            yield "部分回答"
            raise interpret_service.InterpretBackendError("stream interrupted")

        strategy = interpret_service.StrategyResult(
            backend="ollama",
            model="qwen2.5:7b",
            url="http://localhost:11434",
        )
        with mock.patch.object(
            interpret_service, "resolve_strategy", return_value=strategy
        ), mock.patch.object(
            interpret_service,
            "stream_from_strategy",
            return_value=broken_stream(),
        ):
            with self.assertRaises(interpret_service.InterpretBackendError):
                list(
                    interpret_service.interpret_reading_stream(
                        self.conn,
                        reading_id=self.reading_id,
                        cards=SAMPLE_CARDS,
                        template_name="三张牌时间线",
                        language="zh",
                        enable_rag=False,
                    )
                )
        row = interpret_service.load_interpretation(self.conn, self.reading_id)
        self.assertEqual(row["content"], "部分回答")
        self.assertEqual(row["generation_status"], "partial")


if __name__ == "__main__":
    unittest.main()
