import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse

import server
import interpret_service


class TarotServerTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.db_path = Path(self.tmpdir.name) / "tarot.sqlite3"
        server.DB_PATH = self.db_path
        server.init_db()

    def request_json(self, method, path, payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else b""
        return server.handle_api_request(method, urlparse(path), body)

    def manual_consultation_payload(self):
        return {
            "language": "zh",
            "moduleType": "general_reading",
            "inputMode": "manual",
            "userQuery": "我应该如何看待这次工作机会？",
            "userContext": "目前工作稳定，但成长空间有限。",
            "modulePayload": {},
            "spreadNumber": 1,
            "templateKey": "three_timeline",
            "templateName": "三张牌时间线",
            "cards": [
                {
                    "slot": 1,
                    "slotLabel": "过去",
                    "cardId": 9,
                    "zh": "隐者",
                    "en": "The Hermit",
                    "imageFile": "RWS_Tarot_09_Hermit.jpg",
                    "isReversed": False,
                },
                {
                    "slot": 2,
                    "slotLabel": "现在",
                    "cardId": 10,
                    "zh": "命运之轮",
                    "en": "Wheel of Fortune",
                    "imageFile": "RWS_Tarot_10_Wheel_of_Fortune.jpg",
                    "isReversed": False,
                },
                {
                    "slot": 3,
                    "slotLabel": "未来",
                    "cardId": 8,
                    "zh": "力量",
                    "en": "Strength",
                    "imageFile": "RWS_Tarot_08_Strength.jpg",
                    "isReversed": False,
                },
            ],
        }

    def test_health_reports_ready_database(self):
        status, headers, body = self.request_json("GET", "/api/health")

        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(json.loads(body), {"ok": True, "database": "ready"})

    def test_reading_insert_list_and_detail_roundtrip(self):
        payload = {
            "spreadNumber": 7,
            "cards": [
                {
                    "slot": 1,
                    "cardId": 0,
                    "zh": "愚人",
                    "en": "The Fool",
                    "imageFile": "RWS_Tarot_00_Fool.jpg",
                    "isReversed": False,
                },
                {
                    "slot": 2,
                    "cardId": 10,
                    "zh": "命运之轮",
                    "en": "Wheel of Fortune",
                    "imageFile": "RWS_Tarot_10_Wheel_of_Fortune.jpg",
                    "isReversed": True,
                },
            ],
        }

        post_status, _, post_body = self.request_json("POST", "/api/readings", payload)
        created = json.loads(post_body)

        self.assertEqual(post_status, 201)
        self.assertEqual(created["id"], 1)
        self.assertIn("createdAt", created)

        list_status, _, list_body = self.request_json("GET", "/api/readings?limit=20")
        readings = json.loads(list_body)

        self.assertEqual(list_status, 200)
        self.assertEqual(readings[0]["id"], 1)
        self.assertEqual(readings[0]["spreadNumber"], 7)
        self.assertEqual([card["slot"] for card in readings[0]["cards"]], [1, 2])
        self.assertTrue(readings[0]["cards"][1]["isReversed"])

        detail_status, _, detail_body = self.request_json("GET", "/api/readings/1")
        detail = json.loads(detail_body)

        self.assertEqual(detail_status, 200)
        self.assertEqual(detail["cards"][0]["zh"], "愚人")
        self.assertEqual(detail["cards"][1]["cardId"], 10)

    def test_database_indexes_are_created(self):
        conn = sqlite3.connect(self.db_path)
        try:
            reading_indexes = {
                row[1] for row in conn.execute("PRAGMA index_list(readings)")
            }
            card_indexes = {
                row[1] for row in conn.execute("PRAGMA index_list(reading_cards)")
            }
        finally:
            conn.close()

        self.assertIn("idx_readings_created_at", reading_indexes)
        self.assertIn("idx_reading_cards_reading_id_slot", card_indexes)
        self.assertIn("idx_reading_cards_card_id", card_indexes)

    def test_list_limit_100_and_detail_preserve_card_order(self):
        for idx in range(12):
            status, _, _ = self.request_json(
                "POST",
                "/api/readings",
                {
                    "spreadNumber": idx + 1,
                    "cards": [
                        {
                            "slot": 2,
                            "cardId": 10,
                            "zh": "命运之轮",
                            "en": "Wheel of Fortune",
                            "imageFile": "RWS_Tarot_10_Wheel_of_Fortune.jpg",
                            "isReversed": True,
                        },
                        {
                            "slot": 1,
                            "cardId": 0,
                            "zh": "愚人",
                            "en": "The Fool",
                            "imageFile": "RWS_Tarot_00_Fool.jpg",
                            "isReversed": False,
                        },
                    ],
                },
            )
            self.assertEqual(status, 201)

        list_status, _, list_body = self.request_json("GET", "/api/readings?limit=100")
        readings = json.loads(list_body)

        self.assertEqual(list_status, 200)
        self.assertEqual(len(readings), 12)
        self.assertEqual(readings[0]["spreadNumber"], 12)

        latest_id = readings[0]["id"]
        detail_status, _, detail_body = self.request_json("GET", f"/api/readings/{latest_id}")
        detail = json.loads(detail_body)

        self.assertEqual(detail_status, 200)
        self.assertEqual([card["slot"] for card in detail["cards"]], [1, 2])
        self.assertEqual([card["en"] for card in detail["cards"]], ["The Fool", "Wheel of Fortune"])

    def test_delete_readings_clears_records_and_resets_ids(self):
        payload = {
            "spreadNumber": 9,
            "cards": [
                {
                    "slot": 1,
                    "cardId": 0,
                    "zh": "愚人",
                    "en": "The Fool",
                    "imageFile": "RWS_Tarot_00_Fool.jpg",
                    "isReversed": False,
                },
                {
                    "slot": 2,
                    "cardId": 10,
                    "zh": "命运之轮",
                    "en": "Wheel of Fortune",
                    "imageFile": "RWS_Tarot_10_Wheel_of_Fortune.jpg",
                    "isReversed": True,
                },
            ],
        }
        post_status, _, post_body = self.request_json("POST", "/api/readings", payload)
        created = json.loads(post_body)

        self.assertEqual(post_status, 201)
        self.assertEqual(created["id"], 1)

        delete_status, _, delete_body = self.request_json("DELETE", "/api/readings")
        self.assertEqual(delete_status, 200)
        self.assertEqual(json.loads(delete_body), {"ok": True, "deleted": True})

        list_status, _, list_body = self.request_json("GET", "/api/readings?limit=100")
        self.assertEqual(list_status, 200)
        self.assertEqual(json.loads(list_body), [])

        detail_status, _, _ = self.request_json("GET", f"/api/readings/{created['id']}")
        self.assertEqual(detail_status, 404)

        second_status, _, second_body = self.request_json("POST", "/api/readings", payload)
        second = json.loads(second_body)

        self.assertEqual(second_status, 201)
        self.assertEqual(second["id"], 1)

    def test_template_metadata_and_slot_label_roundtrip(self):
        payload = {
            "kind": "spread",
            "templateKey": "three_timeline",
            "templateName": "三张牌 / Past Present Future",
            "readingDate": "2026-04-25",
            "spreadNumber": 3,
            "cards": [
                {
                    "slot": 1,
                    "slotLabel": "过去 / Past",
                    "cardId": 0,
                    "zh": "愚人",
                    "en": "The Fool",
                    "imageFile": "RWS_Tarot_00_Fool.jpg",
                    "isReversed": False,
                }
            ],
        }

        post_status, _, post_body = self.request_json("POST", "/api/readings", payload)
        created = json.loads(post_body)
        self.assertEqual(post_status, 201)

        detail_status, _, detail_body = self.request_json("GET", f"/api/readings/{created['id']}")
        detail = json.loads(detail_body)

        self.assertEqual(detail_status, 200)
        self.assertEqual(detail["kind"], "spread")
        self.assertEqual(detail["templateKey"], "three_timeline")
        self.assertEqual(detail["templateName"], "三张牌 / Past Present Future")
        self.assertEqual(detail["readingDate"], "2026-04-25")
        self.assertEqual(detail["cards"][0]["slotLabel"], "过去 / Past")

    def test_init_db_migrates_old_database_shape(self):
        self.db_path.unlink()
        conn = sqlite3.connect(self.db_path)
        try:
            conn.executescript(
                """
                CREATE TABLE readings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    spread_number INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE reading_cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    reading_id INTEGER NOT NULL,
                    slot INTEGER NOT NULL,
                    card_id INTEGER NOT NULL,
                    zh TEXT NOT NULL,
                    en TEXT NOT NULL,
                    image_file TEXT NOT NULL,
                    is_reversed INTEGER NOT NULL CHECK (is_reversed IN (0, 1))
                );
                """
            )
            conn.commit()
        finally:
            conn.close()

        server.init_db()

        conn = sqlite3.connect(self.db_path)
        try:
            reading_cols = {row[1] for row in conn.execute("PRAGMA table_info(readings)")}
            card_cols = {row[1] for row in conn.execute("PRAGMA table_info(reading_cards)")}
        finally:
            conn.close()

        self.assertIn("kind", reading_cols)
        self.assertIn("template_key", reading_cols)
        self.assertIn("template_name", reading_cols)
        self.assertIn("reading_date", reading_cols)
        self.assertIn("slot_label", card_cols)

    def test_daily_draw_is_unique_per_date(self):
        payload = {
            "readingDate": "2026-04-25",
            "card": {
                "slot": 1,
                "slotLabel": "今日牌 / Daily Card",
                "cardId": 0,
                "zh": "愚人",
                "en": "The Fool",
                "imageFile": "RWS_Tarot_00_Fool.jpg",
                "isReversed": True,
            },
        }

        first_status, _, first_body = self.request_json("POST", "/api/daily-draw", payload)
        second_status, _, second_body = self.request_json("POST", "/api/daily-draw", payload)

        first = json.loads(first_body)
        second = json.loads(second_body)

        self.assertEqual(first_status, 201)
        self.assertEqual(second_status, 200)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["cards"][0]["slotLabel"], "今日牌 / Daily Card")

        get_status, _, get_body = self.request_json("GET", "/api/daily-draw?date=2026-04-25")
        daily = json.loads(get_body)

        self.assertEqual(get_status, 200)
        self.assertEqual(daily["id"], first["id"])
        self.assertEqual(daily["kind"], "daily")
        self.assertEqual(daily["templateKey"], "daily_draw")


    def test_load_reading_for_interpret_preserves_card_id(self):
        """Regression guard: _load_reading_for_interpret used to drop the
        ``cardId`` field, which silently disabled RAG retrieval on the
        production path (eval runner builds cards independently, so eval
        results stayed clean while live traces showed retrieve.count=0).

        Surfaced via the agent-trace telemetry viewer; the fix is one
        line in server.py — this test pins it.
        """
        payload = {
            "spreadNumber": 3,
            "templateKey": "three_timeline",
            "templateName": "三张牌 / Past Present Future",
            "cards": [
                {"slot": 1, "slotLabel": "过去 / Past",
                 "cardId": 9, "zh": "隐士", "en": "The Hermit",
                 "imageFile": "RWS_Tarot_09_Hermit.jpg", "isReversed": False},
                {"slot": 2, "slotLabel": "现在 / Present",
                 "cardId": 21, "zh": "世界", "en": "The World",
                 "imageFile": "RWS_Tarot_21_The_World.jpg", "isReversed": True},
                {"slot": 3, "slotLabel": "未来 / Future",
                 "cardId": 13, "zh": "死神", "en": "Death",
                 "imageFile": "RWS_Tarot_13_Death.jpg", "isReversed": True},
            ],
        }
        self.request_json("POST", "/api/readings", payload)

        loaded = server._load_reading_for_interpret(1)
        self.assertIsNotNone(loaded)
        _template_name, cards = loaded
        self.assertEqual(len(cards), 3)
        # Every card MUST carry the card_id field that the RAG retriever
        # uses to look up canonical entries.
        for c, expected_id in zip(cards, [9, 21, 13]):
            self.assertIn("card_id", c, f"card_id missing on slot {c['slot']}")
            self.assertEqual(c["card_id"], expected_id)
        # Other fields the prompt builder needs survived the transform.
        self.assertEqual(cards[0]["zh"], "隐士")
        self.assertEqual(cards[1]["is_reversed"], True)

    def test_create_and_fetch_manual_consultation(self):
        status, _, body = self.request_json(
            "POST", "/api/consultations", self.manual_consultation_payload()
        )
        created = json.loads(body)
        self.assertEqual(status, 201)
        self.assertEqual(created["readingId"], 1)
        self.assertEqual(len(created["publicId"]), 32)

        get_status, _, get_body = self.request_json(
            "GET", f"/api/consultations/{created['id']}"
        )
        detail = json.loads(get_body)
        self.assertEqual(get_status, 200)
        self.assertEqual(
            detail["userQuery"], "我应该如何看待这次工作机会？"
        )
        self.assertEqual(
            [card["cardId"] for card in detail["reading"]["cards"]],
            [9, 10, 8],
        )

        list_status, _, list_body = self.request_json(
            "GET", "/api/consultations?limit=10"
        )
        items = json.loads(list_body)
        self.assertEqual(list_status, 200)
        self.assertEqual([item["id"] for item in items], [created["id"]])

    def test_invalid_consultation_rolls_back_reading(self):
        payload = self.manual_consultation_payload()
        payload["userQuery"] = "短"
        status, _, _ = self.request_json("POST", "/api/consultations", payload)
        self.assertEqual(status, 400)
        conn = sqlite3.connect(self.db_path)
        try:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0], 0
            )
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM consultations").fetchone()[0],
                0,
            )
        finally:
            conn.close()

    def test_put_interpretation_review(self):
        _, _, created_body = self.request_json(
            "POST", "/api/consultations", self.manual_consultation_payload()
        )
        created = json.loads(created_body)
        conn = server.get_connection()
        try:
            interpretation_id = interpret_service.save_interpretation(
                conn,
                reading_id=created["readingId"],
                model="ollama:qwen2.5:7b",
                style="traditional",
                language="zh",
                content="模型原始回答",
                prompt_hash="hash",
                duration_ms=10,
                created_at="2026-07-10T00:00:00+00:00",
            )
        finally:
            conn.close()

        status, _, body = self.request_json(
            "PUT",
            f"/api/interpretations/{interpretation_id}/review",
            {
                "verdict": "accepted",
                "rating": 5,
                "issueTags": [],
                "privacyConfirmed": True,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["verdict"], "accepted")

        _, _, detail_body = self.request_json(
            "GET", f"/api/consultations/{created['id']}"
        )
        detail = json.loads(detail_body)
        self.assertEqual(
            detail["interpretations"][0]["review"]["verdict"],
            "accepted",
        )


if __name__ == "__main__":
    unittest.main()
