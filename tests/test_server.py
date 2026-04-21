import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse

import server


TEST_TMP_ROOT = Path(__file__).resolve().parent / ".tmp"


class TarotServerTest(unittest.TestCase):
    def setUp(self):
        TEST_TMP_ROOT.mkdir(exist_ok=True)
        self.tmpdir = tempfile.TemporaryDirectory(dir=TEST_TMP_ROOT)
        self.addCleanup(self.tmpdir.cleanup)
        self.db_path = Path(self.tmpdir.name) / "tarot.sqlite3"
        server.DB_PATH = self.db_path
        server.init_db()

    def request_json(self, method, path, payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else b""
        return server.handle_api_request(method, urlparse(path), body)

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


if __name__ == "__main__":
    unittest.main()
