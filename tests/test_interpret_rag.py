"""
Tests for interpret_rag — corpus loading, embed-cache persistence,
cosine retrieval, two-stage filter behaviour. Network calls are mocked
(no Ollama dependency at test time).

Run:
    python -m unittest tests.test_interpret_rag -v
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import struct
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import interpret_rag  # noqa: E402


# ── Helpers ────────────────────────────────────────────────


def make_conn() -> sqlite3.Connection:
    """In-memory DB with the RAG schema migrated."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    interpret_rag.migrate(conn)
    return conn


def fake_vector(seed: float, dim: int = interpret_rag.EMBED_DIM) -> list[float]:
    """Cheap deterministic vector for tests — varies the first dim
    so cosine differs across entries; rest zeroed."""
    vec = [0.0] * dim
    vec[0] = seed
    vec[1] = 1.0
    return vec


# ── Corpus loading ─────────────────────────────────────────


class TestCorpusLoading(unittest.TestCase):
    def test_load_real_corpus_has_156_entries(self):
        entries = interpret_rag.load_corpus()
        self.assertEqual(len(entries), 156)
        # Spot-check that every (card_id, orientation) is unique
        keys = {(e.card_id, e.orientation) for e in entries}
        self.assertEqual(len(keys), 156)

    def test_corpus_signature_is_stable(self):
        a = interpret_rag.load_corpus()
        b = interpret_rag.load_corpus()
        self.assertEqual(
            interpret_rag.corpus_signature(a),
            interpret_rag.corpus_signature(b),
        )

    def test_embeddable_text_includes_all_situations(self):
        entries = interpret_rag.load_corpus()
        moon_rev = next(
            e for e in entries if e.card_id == 18 and e.orientation == "reversed"
        )
        text = moon_rev.embeddable_text()
        # All four canonical situation slots must be in the text
        for slot in ("career", "relationship", "health", "growth"):
            self.assertIn(slot, text)
        # Imagery is present
        self.assertIn("imagery:", text)


# ── Vector packing ─────────────────────────────────────────


class TestVectorPacking(unittest.TestCase):
    def test_round_trip(self):
        vec = [0.1, -0.5, 3.14, 0.0, -1.0]
        blob = interpret_rag._pack_vector(vec)
        # float32 = 4 bytes per element
        self.assertEqual(len(blob), 4 * len(vec))
        back = interpret_rag._unpack_vector(blob, len(vec))
        for a, b in zip(vec, back):
            self.assertAlmostEqual(a, b, places=5)


# ── Cosine math ────────────────────────────────────────────


class TestCosine(unittest.TestCase):
    def test_identical_vectors_score_one(self):
        v = [1.0, 2.0, 3.0]
        self.assertAlmostEqual(interpret_rag._cosine(v, v), 1.0, places=5)

    def test_orthogonal_scores_zero(self):
        a = [1.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0]
        self.assertAlmostEqual(interpret_rag._cosine(a, b), 0.0, places=5)

    def test_handles_zero_vector_safely(self):
        # Should not raise division-by-zero
        result = interpret_rag._cosine([0.0, 0.0], [1.0, 0.0])
        self.assertEqual(result, 0.0)


# ── Index build (with mocked embedder) ─────────────────────


class TestBuildIndex(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def tearDown(self):
        self.conn.close()

    def _make_fake_post_embed(self, counter: list[int]):
        def fake_post(text, *, model, url):
            counter[0] += 1
            return fake_vector(float(counter[0]) / 1000.0)
        return fake_post

    def test_embeds_every_entry_first_run(self):
        calls = [0]
        with mock.patch.object(
            interpret_rag, "_post_embed", side_effect=self._make_fake_post_embed(calls)
        ):
            stats = interpret_rag.build_index(self.conn)
        self.assertEqual(stats["total"], 156)
        self.assertEqual(stats["embedded"], 156)
        self.assertEqual(stats["skipped"], 0)
        self.assertEqual(calls[0], 156)

    def test_second_run_is_idempotent(self):
        with mock.patch.object(
            interpret_rag, "_post_embed", side_effect=self._make_fake_post_embed([0])
        ):
            interpret_rag.build_index(self.conn)

        # Second build with sig already present — no embedder calls
        calls = [0]
        with mock.patch.object(
            interpret_rag, "_post_embed", side_effect=self._make_fake_post_embed(calls)
        ):
            stats = interpret_rag.build_index(self.conn)
        self.assertEqual(stats["embedded"], 0)
        self.assertEqual(stats["skipped"], 156)
        self.assertEqual(calls[0], 0)


# ── Retrieval ──────────────────────────────────────────────


class TestRetrieve(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()
        # Pre-populate with fake embeddings for every entry so retrieval
        # has something to find. The vector is seeded by card_id so
        # later we can test ranking deterministically.
        from datetime import datetime, timezone
        entries = interpret_rag.load_corpus()
        sig = interpret_rag.corpus_signature(entries)
        with self.conn:
            for entry in entries:
                vec = fake_vector(float(entry.card_id) / 100.0)
                self.conn.execute(
                    """INSERT INTO corpus_embeddings
                       (entry_key, model, corpus_sig, dim, vector, text_hash, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (entry.entry_key, "nomic-embed-text", sig,
                     len(vec), interpret_rag._pack_vector(vec),
                     "abc", datetime.now(timezone.utc).isoformat()),
                )

    def tearDown(self):
        self.conn.close()

    def test_no_question_returns_canonical_per_card(self):
        cards = [
            {"card_id": 18, "is_reversed": True},   # Moon reversed
            {"card_id": 25, "is_reversed": False},  # Four of Wands upright
        ]
        results = interpret_rag.retrieve_for_cards(self.conn, cards=cards)
        self.assertEqual(len(results), 2)
        # Same order as spread
        self.assertEqual(results[0].entry.card_id, 18)
        self.assertEqual(results[0].entry.orientation, "reversed")
        self.assertEqual(results[1].entry.card_id, 25)
        # Canonical lookup → score is the sentinel 1.0
        for r in results:
            self.assertEqual(r.score, 1.0)

    def test_with_question_scores_but_preserves_spread_order(self):
        """Question-aware retrieval scores chunks by cosine but MUST NOT
        reorder them. Spread order encodes narrative position
        (past/present/future, Celtic cross slots) that the LLM reads as
        implicit context — relevance ranking belongs in the score field,
        not in the listing order."""
        cards = [
            # Slot 0 = past, Slot 1 = future — order is the test subject.
            {"card_id": 0, "is_reversed": False},   # Fool (low relevance)
            {"card_id": 77, "is_reversed": False},  # King of Pents (high relevance)
        ]
        target = fake_vector(0.77)  # Matches King of Pents stub exactly
        with mock.patch.object(interpret_rag, "_post_embed", return_value=target):
            results = interpret_rag.retrieve_for_cards(
                self.conn, cards=cards, question="career"
            )
        self.assertEqual(len(results), 2)
        # Spread order preserved — Fool (slot 0) still first, King second.
        self.assertEqual(results[0].entry.card_id, 0)
        self.assertEqual(results[1].entry.card_id, 77)
        # But the score field still reflects relevance ranking — King
        # outscores Fool because its vector matched the question stub.
        self.assertGreater(results[1].score, results[0].score)

    def test_three_card_timeline_order_survives_with_question(self):
        """Regression guard for the 'past/present/future' shape. If the
        retriever sorts by relevance, the reference block in the prompt
        would list the chunks in score order, dissolving the temporal
        narrative the LLM uses as implicit anchor."""
        cards = [
            {"card_id": 22, "is_reversed": False},  # past
            {"card_id": 3,  "is_reversed": False},  # present
            {"card_id": 7,  "is_reversed": False},  # future
        ]
        # Pick a question vector that should rank middle card highest
        # if the retriever were to sort — and verify it doesn't.
        target = fake_vector(0.03)  # closest to card_id=3 by construction
        with mock.patch.object(interpret_rag, "_post_embed", return_value=target):
            results = interpret_rag.retrieve_for_cards(
                self.conn, cards=cards, question="任何问题",
            )
        self.assertEqual([r.entry.card_id for r in results], [22, 3, 7],
                         "spread order must survive question-aware retrieval")

    def test_missing_embeddings_degrades_gracefully(self):
        # Wipe the embedding rows; retrieval should still return
        # canonical entries (no embedder call needed) without raising.
        with self.conn:
            self.conn.execute("DELETE FROM corpus_embeddings")
        cards = [{"card_id": 5, "is_reversed": False}]
        results = interpret_rag.retrieve_for_cards(
            self.conn, cards=cards, question="anything"
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].entry.card_id, 5)

    def test_unknown_card_id_is_skipped(self):
        cards = [
            {"card_id": 18, "is_reversed": False},
            {"card_id": 9999, "is_reversed": False},   # not in deck
        ]
        results = interpret_rag.retrieve_for_cards(self.conn, cards=cards)
        # Only the valid card comes back; unknown skipped cleanly
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].entry.card_id, 18)

    def test_camelcase_keys_accepted(self):
        # Reading rows from /api/readings use camelCase keys (cardId,
        # isReversed). The retriever should accept both shapes.
        cards = [{"cardId": 0, "isReversed": True}]
        results = interpret_rag.retrieve_for_cards(self.conn, cards=cards)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].entry.card_id, 0)
        self.assertEqual(results[0].entry.orientation, "reversed")


# ── Status snapshot ────────────────────────────────────────


class TestRagStatus(unittest.TestCase):
    def test_status_reflects_unbuilt_state(self):
        conn = make_conn()
        try:
            with mock.patch("urllib.request.urlopen", side_effect=ConnectionError()):
                status = interpret_rag.rag_status(conn)
            self.assertEqual(status["indexed"], 0)
            self.assertEqual(status["corpus_total"], 156)
            self.assertFalse(status["ready"])
            self.assertEqual(status["embed_backend"], "down")
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
