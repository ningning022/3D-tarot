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


if __name__ == "__main__":
    unittest.main()
