import json
import mimetypes
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT_DIR = Path(__file__).resolve().parent
DB_PATH = ROOT_DIR / "data" / "tarot.sqlite3"
DEFAULT_PORT = 8080


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with closing(get_connection()) as conn:
        with conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS readings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    spread_number INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS reading_cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    reading_id INTEGER NOT NULL,
                    slot INTEGER NOT NULL,
                    card_id INTEGER NOT NULL,
                    zh TEXT NOT NULL,
                    en TEXT NOT NULL,
                    image_file TEXT NOT NULL,
                    is_reversed INTEGER NOT NULL CHECK (is_reversed IN (0, 1)),
                    FOREIGN KEY (reading_id) REFERENCES readings(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_readings_created_at
                    ON readings(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_reading_cards_reading_id_slot
                    ON reading_cards(reading_id, slot);
                CREATE INDEX IF NOT EXISTS idx_reading_cards_card_id
                    ON reading_cards(card_id);
                """
            )


def json_response(status, data):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    return status, {"Content-Type": "application/json; charset=utf-8"}, body


def error_response(status, message):
    return json_response(status, {"error": message})


def parse_json_body(body):
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("Invalid JSON body")


def normalize_card(raw_card):
    required = ("slot", "cardId", "zh", "en", "imageFile", "isReversed")
    if not isinstance(raw_card, dict) or any(key not in raw_card for key in required):
        raise ValueError("Each card must include slot, cardId, zh, en, imageFile, and isReversed")
    return {
        "slot": int(raw_card["slot"]),
        "card_id": int(raw_card["cardId"]),
        "zh": str(raw_card["zh"]),
        "en": str(raw_card["en"]),
        "image_file": str(raw_card["imageFile"]),
        "is_reversed": 1 if bool(raw_card["isReversed"]) else 0,
    }


def create_reading(payload):
    cards = payload.get("cards")
    if not isinstance(cards, list) or not cards:
        raise ValueError("cards must be a non-empty list")
    spread_number = int(payload.get("spreadNumber", 0))
    if spread_number < 0:
        raise ValueError("spreadNumber must be zero or greater")

    normalized_cards = [normalize_card(card) for card in cards]
    created_at = utc_now_iso()

    with closing(get_connection()) as conn:
        with conn:
            cursor = conn.execute(
                "INSERT INTO readings (spread_number, created_at) VALUES (?, ?)",
                (spread_number, created_at),
            )
            reading_id = cursor.lastrowid
            conn.executemany(
                """
                INSERT INTO reading_cards
                    (reading_id, slot, card_id, zh, en, image_file, is_reversed)
                VALUES
                    (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        reading_id,
                        card["slot"],
                        card["card_id"],
                        card["zh"],
                        card["en"],
                        card["image_file"],
                        card["is_reversed"],
                    )
                    for card in normalized_cards
                ],
            )

    return {"id": reading_id, "createdAt": created_at}


def row_to_card(row):
    return {
        "slot": row["slot"],
        "cardId": row["card_id"],
        "zh": row["zh"],
        "en": row["en"],
        "imageFile": row["image_file"],
        "isReversed": bool(row["is_reversed"]),
    }


def fetch_readings(limit):
    limit = max(1, min(int(limit), 100))
    with closing(get_connection()) as conn:
        reading_rows = conn.execute(
            """
            SELECT id, spread_number, created_at
            FROM readings
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        readings = []
        for reading in reading_rows:
            card_rows = conn.execute(
                """
                SELECT slot, card_id, zh, en, image_file, is_reversed
                FROM reading_cards
                WHERE reading_id = ?
                ORDER BY slot ASC
                """,
                (reading["id"],),
            ).fetchall()
            readings.append(
                {
                    "id": reading["id"],
                    "spreadNumber": reading["spread_number"],
                    "createdAt": reading["created_at"],
                    "cards": [row_to_card(row) for row in card_rows],
                }
            )
    return readings


def fetch_reading(reading_id):
    with closing(get_connection()) as conn:
        reading = conn.execute(
            """
            SELECT id, spread_number, created_at
            FROM readings
            WHERE id = ?
            """,
            (reading_id,),
        ).fetchone()
        if reading is None:
            return None
        card_rows = conn.execute(
            """
            SELECT slot, card_id, zh, en, image_file, is_reversed
            FROM reading_cards
            WHERE reading_id = ?
            ORDER BY slot ASC
            """,
            (reading_id,),
        ).fetchall()
    return {
        "id": reading["id"],
        "spreadNumber": reading["spread_number"],
        "createdAt": reading["created_at"],
        "cards": [row_to_card(row) for row in card_rows],
    }


def clear_readings():
    with closing(get_connection()) as conn:
        with conn:
            conn.execute("DELETE FROM reading_cards")
            conn.execute("DELETE FROM readings")
            conn.execute(
                "DELETE FROM sqlite_sequence WHERE name IN ('readings', 'reading_cards')"
            )
    return {"ok": True, "deleted": True}


def handle_api_request(method, parsed_url, body=b""):
    init_db()
    path = parsed_url.path.rstrip("/") or "/"

    try:
        if method == "GET" and path == "/api/health":
            return json_response(200, {"ok": True, "database": "ready"})

        if method == "POST" and path == "/api/readings":
            created = create_reading(parse_json_body(body))
            return json_response(201, created)

        if method == "DELETE" and path == "/api/readings":
            return json_response(200, clear_readings())

        if method == "GET" and path == "/api/readings":
            query = parse_qs(parsed_url.query)
            limit = query.get("limit", ["20"])[0]
            return json_response(200, fetch_readings(limit))

        if method == "GET" and path.startswith("/api/readings/"):
            reading_id = int(path.rsplit("/", 1)[1])
            reading = fetch_reading(reading_id)
            if reading is None:
                return error_response(404, "Reading not found")
            return json_response(200, reading)

        return error_response(404, "API route not found")
    except ValueError as exc:
        return error_response(400, str(exc))
    except sqlite3.Error as exc:
        return error_response(500, f"Database error: {exc}")


class TarotRequestHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.send_api_response(*handle_api_request("GET", urlparse(self.path)))
            return
        super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/"):
            self.send_error(404, "Not found")
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self.send_api_response(*handle_api_request("POST", urlparse(self.path), body))

    def do_DELETE(self):
        if not self.path.startswith("/api/"):
            self.send_error(404, "Not found")
            return
        self.send_api_response(*handle_api_request("DELETE", urlparse(self.path)))

    def send_api_response(self, status, headers, body):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run(port=DEFAULT_PORT):
    init_db()
    mimetypes.add_type("application/javascript; charset=utf-8", ".js")
    server = ThreadingHTTPServer(("localhost", port), TarotRequestHandler)
    print(f"Akashic Tarot running at http://localhost:{port}/Three.html")
    print(f"SQLite database: {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    run()
