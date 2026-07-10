import sqlite3
import unittest

import consultation_service
import interpret_service


def make_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
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
    consultation_service.migrate(conn)
    return conn


class TestConsultationSchema(unittest.TestCase):
    def test_migrate_creates_tables_and_indexes(self):
        conn = make_conn()
        try:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            self.assertIn("consultations", tables)
            self.assertIn("interpretation_reviews", tables)
            consultation_service.migrate(conn)
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM consultations").fetchone()[0],
                0,
            )
        finally:
            conn.close()

    def test_deleting_reading_cascades_consultation(self):
        conn = make_conn()
        try:
            reading_id = conn.execute(
                "INSERT INTO readings(spread_number, created_at) "
                "VALUES (1, '2026-07-10T00:00:00+00:00')"
            ).lastrowid
            consultation_service.insert_consultation(
                conn,
                reading_id=reading_id,
                values={
                    "language": "zh",
                    "module_type": "general_reading",
                    "input_mode": "manual",
                    "user_query": "我应该如何看待这次工作机会？",
                    "user_context": "",
                    "module_payload": {},
                },
                created_at="2026-07-10T00:00:00+00:00",
                public_id="c" * 32,
            )
            conn.execute("DELETE FROM readings WHERE id = ?", (reading_id,))
            conn.commit()
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM consultations").fetchone()[0],
                0,
            )
        finally:
            conn.close()


class TestConsultationValidation(unittest.TestCase):
    def test_normalizes_valid_manual_input(self):
        value = consultation_service.normalize_consultation_input(
            {
                "language": "zh",
                "moduleType": "general_reading",
                "inputMode": "manual",
                "userQuery": "  我应该如何看待这次工作机会？  ",
                "userContext": "目前稳定，但成长空间有限。",
                "modulePayload": {},
            }
        )
        self.assertEqual(value["user_query"], "我应该如何看待这次工作机会？")
        self.assertEqual(value["module_type"], "general_reading")

    def test_rejects_short_question(self):
        with self.assertRaisesRegex(ValueError, "userQuery must be 4-500"):
            consultation_service.normalize_consultation_input(
                {
                    "language": "zh",
                    "moduleType": "general_reading",
                    "inputMode": "manual",
                    "userQuery": "工作？",
                }
            )

    def test_rejects_duplicate_manual_cards(self):
        cards = [
            {"slot": 1, "cardId": 9, "isReversed": False},
            {"slot": 2, "cardId": 9, "isReversed": True},
        ]
        with self.assertRaisesRegex(ValueError, "duplicate cardId"):
            consultation_service.validate_manual_cards(cards, template_key="free")

    def test_rejects_underfilled_fixed_spread(self):
        cards = [
            {"slot": 1, "cardId": 9, "isReversed": False},
            {"slot": 2, "cardId": 10, "isReversed": True},
        ]
        with self.assertRaisesRegex(ValueError, "three_timeline requires 3 cards"):
            consultation_service.validate_manual_cards(
                cards, template_key="three_timeline"
            )


class TestConsultationPersistence(unittest.TestCase):
    def test_insert_and_load_by_reading(self):
        conn = make_conn()
        try:
            reading_id = conn.execute(
                "INSERT INTO readings(spread_number, created_at) "
                "VALUES (1, '2026-07-10T00:00:00+00:00')"
            ).lastrowid
            values = consultation_service.normalize_consultation_input(
                {
                    "language": "zh",
                    "moduleType": "general_reading",
                    "inputMode": "manual",
                    "userQuery": "我应该如何看待这次工作机会？",
                    "modulePayload": {"source": "physical_deck"},
                }
            )
            consultation_id = consultation_service.insert_consultation(
                conn,
                reading_id=reading_id,
                values=values,
                created_at="2026-07-10T00:00:00+00:00",
                public_id="d" * 32,
            )
            conn.commit()
            loaded = consultation_service.load_by_reading_id(conn, reading_id)
            self.assertEqual(loaded["id"], consultation_id)
            self.assertEqual(loaded["publicId"], "d" * 32)
            self.assertEqual(
                loaded["modulePayload"], {"source": "physical_deck"}
            )
        finally:
            conn.close()


class TestInterpretContext(unittest.TestCase):
    def test_creates_three_d_consultation_from_legacy_question(self):
        conn = make_conn()
        try:
            reading_id = conn.execute(
                "INSERT INTO readings(spread_number, created_at) "
                "VALUES (1, '2026-07-10')"
            ).lastrowid
            question, consultation = (
                consultation_service.resolve_interpret_context(
                    conn,
                    reading_id=reading_id,
                    request_question="我应该换工作吗？",
                    created_at="2026-07-10T00:00:00+00:00",
                )
            )
            conn.commit()
            self.assertEqual(question, "我应该换工作吗？")
            self.assertEqual(consultation["inputMode"], "three_d")
        finally:
            conn.close()

    def test_saved_question_rejects_conflicting_override(self):
        conn = make_conn()
        try:
            reading_id = conn.execute(
                "INSERT INTO readings(spread_number, created_at) "
                "VALUES (1, '2026-07-10')"
            ).lastrowid
            consultation_service.insert_consultation(
                conn,
                reading_id=reading_id,
                values={
                    "language": "zh",
                    "module_type": "general_reading",
                    "input_mode": "manual",
                    "user_query": "原问题内容是什么？",
                    "user_context": "",
                    "module_payload": {},
                },
                created_at="2026-07-10T00:00:00+00:00",
            )
            with self.assertRaisesRegex(
                ValueError, "does not match saved consultation"
            ):
                consultation_service.resolve_interpret_context(
                    conn,
                    reading_id=reading_id,
                    request_question="另一个不同问题",
                    created_at="2026-07-10T00:00:00+00:00",
                )
        finally:
            conn.close()


class TestReviews(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()
        self.reading_id = self.conn.execute(
            "INSERT INTO readings(spread_number, created_at) "
            "VALUES (1, '2026-07-10')"
        ).lastrowid
        self.interpretation_id = interpret_service.save_interpretation(
            self.conn,
            reading_id=self.reading_id,
            model="ollama:qwen2.5:7b",
            style="traditional",
            language="zh",
            content="模型原始回答",
            prompt_hash="hash",
            duration_ms=10,
            created_at="2026-07-10T00:00:00+00:00",
        )

    def tearDown(self):
        self.conn.close()

    def test_edited_review_round_trip(self):
        review = consultation_service.upsert_review(
            self.conn,
            interpretation_id=self.interpretation_id,
            payload={
                "verdict": "edited",
                "rating": 5,
                "issueTags": ["空泛套话"],
                "editedContent": "人工修改后的理想回答",
                "privacyConfirmed": True,
            },
            reviewed_at="2026-07-10T00:05:00+00:00",
        )
        self.assertEqual(review["verdict"], "edited")
        self.assertEqual(review["editedContent"], "人工修改后的理想回答")
        self.assertTrue(review["privacyConfirmed"])

    def test_edited_review_requires_content(self):
        with self.assertRaisesRegex(ValueError, "editedContent is required"):
            consultation_service.upsert_review(
                self.conn,
                interpretation_id=self.interpretation_id,
                payload={"verdict": "edited", "privacyConfirmed": True},
                reviewed_at="2026-07-10T00:05:00+00:00",
            )


if __name__ == "__main__":
    unittest.main()
