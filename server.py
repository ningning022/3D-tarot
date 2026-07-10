import json
import mimetypes
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import consultation_service
import interpret_service


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
                    created_at TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'spread',
                    template_key TEXT NOT NULL DEFAULT 'free',
                    template_name TEXT NOT NULL DEFAULT '自由牌阵 / Free Spread',
                    reading_date TEXT
                );

                CREATE TABLE IF NOT EXISTS reading_cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    reading_id INTEGER NOT NULL,
                    slot INTEGER NOT NULL,
                    slot_label TEXT NOT NULL DEFAULT '',
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
            ensure_column(
                conn,
                "readings",
                "kind",
                "TEXT NOT NULL DEFAULT 'spread'",
            )
            ensure_column(
                conn,
                "readings",
                "template_key",
                "TEXT NOT NULL DEFAULT 'free'",
            )
            ensure_column(
                conn,
                "readings",
                "template_name",
                "TEXT NOT NULL DEFAULT '自由牌阵 / Free Spread'",
            )
            ensure_column(conn, "readings", "reading_date", "TEXT")
            ensure_column(
                conn,
                "reading_cards",
                "slot_label",
                "TEXT NOT NULL DEFAULT ''",
            )
            conn.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_draw_reading_date
                    ON readings(reading_date)
                    WHERE kind = 'daily' AND template_key = 'daily_draw'
                """
            )
        interpret_service.migrate(conn)
        consultation_service.migrate(conn)


def ensure_column(conn, table, column, definition):
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


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
    slot = int(raw_card["slot"])
    return {
        "slot": slot,
        "slot_label": str(raw_card.get("slotLabel") or f"Slot {slot}"),
        "card_id": int(raw_card["cardId"]),
        "zh": str(raw_card["zh"]),
        "en": str(raw_card["en"]),
        "image_file": str(raw_card["imageFile"]),
        "is_reversed": 1 if bool(raw_card["isReversed"]) else 0,
    }


def normalize_reading_payload(payload: dict) -> dict:
    cards = payload.get("cards")
    if not isinstance(cards, list) or not cards:
        raise ValueError("cards must be a non-empty list")
    spread_number = int(payload.get("spreadNumber", 0))
    if spread_number < 0:
        raise ValueError("spreadNumber must be zero or greater")
    kind = str(payload.get("kind") or "spread")
    if kind not in {"spread", "daily"}:
        raise ValueError("kind must be spread or daily")
    template_key = str(
        payload.get("templateKey")
        or ("daily_draw" if kind == "daily" else "free")
    )
    template_name = str(
        payload.get("templateName")
        or ("每日一牌 / Daily Draw" if kind == "daily" else "自由牌阵 / Free Spread")
    )
    reading_date = payload.get("readingDate")
    return {
        "spread_number": spread_number,
        "kind": kind,
        "template_key": template_key,
        "template_name": template_name,
        "reading_date": str(reading_date) if reading_date else None,
        "cards": [normalize_card(card) for card in cards],
    }


def insert_reading(conn, normalized: dict, created_at: str) -> int:
    cursor = conn.execute(
        """
        INSERT INTO readings
            (spread_number, created_at, kind, template_key, template_name, reading_date)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            normalized["spread_number"],
            created_at,
            normalized["kind"],
            normalized["template_key"],
            normalized["template_name"],
            normalized["reading_date"],
        ),
    )
    reading_id = int(cursor.lastrowid)
    conn.executemany(
        """
        INSERT INTO reading_cards
            (reading_id, slot, slot_label, card_id, zh, en, image_file, is_reversed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                reading_id,
                card["slot"],
                card["slot_label"],
                card["card_id"],
                card["zh"],
                card["en"],
                card["image_file"],
                card["is_reversed"],
            )
            for card in normalized["cards"]
        ],
    )
    return reading_id


def create_reading(payload: dict) -> dict:
    normalized = normalize_reading_payload(payload)
    created_at = utc_now_iso()
    with closing(get_connection()) as conn:
        with conn:
            reading_id = insert_reading(conn, normalized, created_at)

    return {"id": reading_id, "createdAt": created_at}


def create_consultation(payload: dict) -> dict:
    values = consultation_service.normalize_consultation_input(payload)
    if values["input_mode"] != "manual":
        raise ValueError("POST /api/consultations requires inputMode=manual")
    consultation_service.validate_manual_cards(
        payload.get("cards"),
        template_key=str(payload.get("templateKey") or "free"),
    )
    reading = normalize_reading_payload(payload)
    created_at = utc_now_iso()
    with closing(get_connection()) as conn:
        with conn:
            reading_id = insert_reading(conn, reading, created_at)
            consultation_id = consultation_service.insert_consultation(
                conn,
                reading_id=reading_id,
                values=values,
                created_at=created_at,
            )
        result = consultation_service.load_consultation(conn, consultation_id)
    return result


def row_to_card(row):
    return {
        "slot": row["slot"],
        "slotLabel": row["slot_label"] or f"Slot {row['slot']}",
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
            SELECT id, spread_number, created_at, kind, template_key, template_name, reading_date
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
                SELECT slot, slot_label, card_id, zh, en, image_file, is_reversed
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
                    "kind": reading["kind"],
                    "templateKey": reading["template_key"],
                    "templateName": reading["template_name"],
                    "readingDate": reading["reading_date"],
                    "cards": [row_to_card(row) for row in card_rows],
                }
            )
    return readings


def fetch_reading(reading_id):
    with closing(get_connection()) as conn:
        reading = conn.execute(
            """
            SELECT id, spread_number, created_at, kind, template_key, template_name, reading_date
            FROM readings
            WHERE id = ?
            """,
            (reading_id,),
        ).fetchone()
        if reading is None:
            return None
        card_rows = conn.execute(
            """
            SELECT slot, slot_label, card_id, zh, en, image_file, is_reversed
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
        "kind": reading["kind"],
        "templateKey": reading["template_key"],
        "templateName": reading["template_name"],
        "readingDate": reading["reading_date"],
        "cards": [row_to_card(row) for row in card_rows],
    }


def fetch_consultation(consultation_id: int) -> dict | None:
    with closing(get_connection()) as conn:
        consultation = consultation_service.load_consultation(
            conn, consultation_id
        )
    if consultation is None:
        return None
    consultation["reading"] = fetch_reading(consultation["readingId"])
    return consultation


def fetch_consultations(
    limit: int, module_type: str | None = None
) -> list[dict]:
    with closing(get_connection()) as conn:
        return consultation_service.list_consultations(
            conn, limit=limit, module_type=module_type
        )


def fetch_daily_draw(reading_date):
    if not reading_date:
        raise ValueError("date is required")
    with closing(get_connection()) as conn:
        row = conn.execute(
            """
            SELECT id
            FROM readings
            WHERE kind = 'daily'
              AND template_key = 'daily_draw'
              AND reading_date = ?
            LIMIT 1
            """,
            (reading_date,),
        ).fetchone()
    if row is None:
        return None
    return fetch_reading(row["id"])


def create_daily_draw(payload):
    reading_date = str(payload.get("readingDate") or payload.get("date") or "")
    if not reading_date:
        raise ValueError("readingDate is required")
    existing = fetch_daily_draw(reading_date)
    if existing is not None:
        return 200, existing

    raw_card = payload.get("card")
    if not isinstance(raw_card, dict):
        raise ValueError("card is required")
    card = {
        **raw_card,
        "slot": raw_card.get("slot", 1),
        "slotLabel": raw_card.get("slotLabel") or "今日牌 / Daily Card",
    }
    created = create_reading(
        {
            "kind": "daily",
            "templateKey": "daily_draw",
            "templateName": "每日一牌 / Daily Draw",
            "readingDate": reading_date,
            "spreadNumber": 0,
            "cards": [card],
        }
    )
    return 201, fetch_reading(created["id"])


def clear_readings():
    with closing(get_connection()) as conn:
        with conn:
            conn.execute("DELETE FROM reading_cards")
            conn.execute("DELETE FROM readings")
            conn.execute(
                "DELETE FROM sqlite_sequence WHERE name IN ('readings', 'reading_cards')"
            )
    return {"ok": True, "deleted": True}


# ── Interpretation helpers ──────────────────────────────────
# A small subset of interpret_service wiring that other request paths
# (non-streaming) consume. The streaming path lives on TarotRequestHandler
# because it needs raw access to self.wfile.

# One in-flight interpretation per reading_id to avoid race-induced
# duplicate persistence + thrash on the model.
_INTERPRET_LOCKS: dict[int, threading.Lock] = {}
_INTERPRET_LOCKS_GUARD = threading.Lock()


def _lock_for_reading(reading_id: int) -> threading.Lock:
    with _INTERPRET_LOCKS_GUARD:
        lock = _INTERPRET_LOCKS.get(reading_id)
        if lock is None:
            lock = threading.Lock()
            _INTERPRET_LOCKS[reading_id] = lock
        return lock


def interpret_health() -> dict:
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        settings = interpret_service.get_settings(conn)
    url = settings.get("ollama_url", interpret_service.DEFAULT_OLLAMA_URL)
    model = settings.get("ollama_model", interpret_service.DEFAULT_OLLAMA_MODEL)
    api_key = settings.get("openrouter_api_key", "")
    health = interpret_service.check_ollama_health(url, model)
    return {
        "ollama": health["status"],
        "ollama_message": health.get("message"),
        "model": model,
        "backend": settings.get("backend", "ollama"),
        "fallback_available": bool(api_key.strip()),
    }


def interpret_rag_status() -> dict:
    """Snapshot of the RAG embedding index for the admin telemetry tab."""
    import interpret_rag  # local import keeps the cold-start path lean
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        settings = interpret_service.get_settings(conn)
    ollama_url = settings.get("ollama_url", interpret_service.DEFAULT_OLLAMA_URL)
    embed_model = settings.get("embed_model", interpret_rag.DEFAULT_EMBED_MODEL)
    with closing(get_connection()) as conn:
        return interpret_rag.rag_status(conn, model=embed_model, ollama_url=ollama_url)


def interpret_rag_build() -> dict:
    """Trigger (or refresh) the embedding index. Idempotent — skips
    entries already embedded under the current corpus signature.
    Returns the build statistics dict from interpret_rag.build_index.
    """
    import interpret_rag
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        settings = interpret_service.get_settings(conn)
        ollama_url = settings.get("ollama_url", interpret_service.DEFAULT_OLLAMA_URL)
        embed_model = settings.get("embed_model", interpret_rag.DEFAULT_EMBED_MODEL)
        try:
            return interpret_rag.build_index(
                conn, model=embed_model, ollama_url=ollama_url
            )
        except interpret_rag.RagError as exc:
            return {"error": exc.code, "message": str(exc)}


def interpret_agent_trace(reading_id: int) -> dict:
    """Return the most recent agent trace for a reading. Empty steps
    list when no trace has been recorded yet (e.g. interpretation was
    run without a question)."""
    import interpret_agent
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        steps = interpret_agent.load_trace(conn, reading_id)
    return {"reading_id": reading_id, "steps": steps}


def interpret_get_settings() -> dict:
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        raw = interpret_service.get_settings(conn)
    # Mask API key — never return it to clients.
    api_key = raw.get("openrouter_api_key", "")
    return {
        "backend": raw.get("backend", "ollama"),
        "ollama_url": raw.get("ollama_url", interpret_service.DEFAULT_OLLAMA_URL),
        "ollama_model": raw.get("ollama_model", interpret_service.DEFAULT_OLLAMA_MODEL),
        "openrouter_model": raw.get(
            "openrouter_model", interpret_service.DEFAULT_OPENROUTER_MODEL
        ),
        "default_style": raw.get("default_style", "traditional"),
        "default_language": raw.get("default_language", "zh"),
        "openrouter_api_key_set": bool(api_key.strip()),
    }


_ALLOWED_SETTING_KEYS = {
    "backend",
    "ollama_url",
    "ollama_model",
    "openrouter_url",
    "openrouter_model",
    "openrouter_api_key",
    "default_style",
    "default_language",
}


def interpret_update_settings(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Body must be a JSON object")
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        for key, value in payload.items():
            if key not in _ALLOWED_SETTING_KEYS:
                continue
            interpret_service.set_setting(conn, key, "" if value is None else str(value))
    return interpret_get_settings()


def interpret_fetch(reading_id: int, *, all_rows: bool = False):
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        data = interpret_service.load_interpretation(conn, reading_id, all_rows=all_rows)
    return data


def _load_reading_for_interpret(reading_id: int) -> tuple[str, list[dict]] | None:
    """Pull the reading row + its cards in slot order. Returns
    (template_name, cards) where cards have the shape interpret_prompts
    expects. None if no such reading.
    """
    reading = fetch_reading(reading_id)
    if reading is None:
        return None
    cards = []
    for c in reading.get("cards", []):
        cards.append(
            {
                "slot": c["slot"],
                "slot_label": c.get("slotLabel") or f"Slot {c['slot']}",
                # card_id MUST be threaded through: interpret_rag.retrieve_for_cards
                # skips any card without one, which silently disables RAG injection
                # for the production path while traces still show classify+generate
                # as ok. The eval runner builds cards the same way and must too.
                "card_id": c.get("cardId"),
                "zh": c.get("zh", ""),
                "en": c.get("en", ""),
                "is_reversed": bool(c.get("isReversed")),
            }
        )
    template_name = reading.get("templateName") or "自由牌阵 / Free Spread"
    return template_name, cards


def handle_api_request(method, parsed_url, body=b""):
    init_db()
    path = parsed_url.path.rstrip("/") or "/"

    try:
        if method == "GET" and path == "/api/health":
            return json_response(200, {"ok": True, "database": "ready"})

        # ── Interpretation: non-streaming endpoints ─────────────
        if method == "GET" and path == "/api/interpret/health":
            return json_response(200, interpret_health())

        if method == "GET" and path == "/api/interpret/rag-status":
            return json_response(200, interpret_rag_status())

        if method == "POST" and path == "/api/interpret/rag-build":
            return json_response(200, interpret_rag_build())

        if method == "GET" and path == "/api/interpret/settings":
            return json_response(200, interpret_get_settings())

        if method == "POST" and path == "/api/interpret/settings":
            return json_response(200, interpret_update_settings(parse_json_body(body)))

        # /api/interpret/<id>/agent-trace — must come before the
        # catch-all below or "<id>" would swallow "agent-trace".
        if method == "GET" and path.startswith("/api/interpret/") and path.endswith("/agent-trace"):
            try:
                reading_id = int(path.split("/")[3])
            except (ValueError, IndexError):
                return error_response(400, "Invalid reading id")
            return json_response(200, interpret_agent_trace(reading_id))

        if method == "GET" and path.startswith("/api/interpret/"):
            reading_id = int(path.rsplit("/", 1)[1])
            all_rows = parse_qs(parsed_url.query).get("all", ["0"])[0] in ("1", "true")
            data = interpret_fetch(reading_id, all_rows=all_rows)
            if data is None:
                return error_response(404, "No interpretation for this reading")
            return json_response(200, data)
        # POST /api/interpret/<id> is handled separately (streaming);
        # it does NOT route through this function.

        if method == "POST" and path == "/api/consultations":
            created = create_consultation(parse_json_body(body))
            return json_response(201, created)

        if method == "GET" and path == "/api/consultations":
            query = parse_qs(parsed_url.query)
            limit = int(query.get("limit", ["20"])[0])
            module_type = query.get("module_type", [None])[0]
            return json_response(
                200, fetch_consultations(limit, module_type)
            )

        if method == "GET" and path.startswith("/api/consultations/"):
            consultation_id = int(path.rsplit("/", 1)[1])
            consultation = fetch_consultation(consultation_id)
            if consultation is None:
                return error_response(404, "Consultation not found")
            return json_response(200, consultation)

        if method == "POST" and path == "/api/readings":
            created = create_reading(parse_json_body(body))
            return json_response(201, created)

        if method == "DELETE" and path == "/api/readings":
            return json_response(200, clear_readings())

        if method == "GET" and path == "/api/daily-draw":
            query = parse_qs(parsed_url.query)
            reading_date = query.get("date", [""])[0]
            reading = fetch_daily_draw(reading_date)
            if reading is None:
                return error_response(404, "Daily draw not found")
            return json_response(200, reading)

        if method == "POST" and path == "/api/daily-draw":
            status, reading = create_daily_draw(parse_json_body(body))
            return json_response(status, reading)

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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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
        # Streaming interpret endpoint bypasses the buffered handler so we
        # can flush chunks to the client as the model emits them.
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/interpret/") and parsed.path != "/api/interpret/settings":
            self._handle_interpret_stream(parsed)
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self.send_api_response(*handle_api_request("POST", urlparse(self.path), body))

    def _handle_interpret_stream(self, parsed):
        """SSE stream `/api/interpret/<reading_id>` → forward model chunks
        to the client. Body may carry {style, language} overrides; missing
        keys fall back to interpret_settings defaults."""
        try:
            reading_id = int(parsed.path.rsplit("/", 1)[1])
        except (ValueError, IndexError):
            self.send_api_response(*error_response(400, "Invalid reading id"))
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        try:
            overrides = parse_json_body(body) if body else {}
        except ValueError as exc:
            self.send_api_response(*error_response(400, str(exc)))
            return

        loaded = _load_reading_for_interpret(reading_id)
        if loaded is None:
            self.send_api_response(*error_response(404, "Reading not found"))
            return
        template_name, cards = loaded

        # Concurrency guard: refuse if another interpret call is in
        # flight for this same reading_id.
        lock = _lock_for_reading(reading_id)
        if not lock.acquire(blocking=False):
            self.send_api_response(*error_response(409, "Interpretation already in progress"))
            return

        try:
            with closing(get_connection()) as conn:
                interpret_service.migrate(conn)
                settings = interpret_service.get_settings(conn)
                style = overrides.get("style") or settings.get("default_style", "traditional")
                language = overrides.get("language") or settings.get("default_language", "zh")
                # User question is optional — when supplied, the prompt
                # builder folds it in and the RAG retriever uses it to
                # rank corpus chunks by relevance.
                raw_q = overrides.get("question")
                question = str(raw_q).strip() if raw_q else None
                # Agent mode is on by default when a question is
                # present; clients can opt out with enable_agent=false.
                enable_agent = bool(overrides.get("enable_agent", True))

                # Open the SSE response now (any error past this point
                # streams as a data:error frame, not an HTTP error code).
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache, no-transform")
                self.send_header("X-Accel-Buffering", "no")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                try:
                    for chunk in interpret_service.interpret_reading_stream(
                        conn,
                        reading_id=reading_id,
                        cards=cards,
                        template_name=template_name,
                        style=style,
                        language=language,
                        question=question,
                        enable_agent=enable_agent,
                    ):
                        frame = "data: " + json.dumps(
                            {"chunk": chunk}, ensure_ascii=False
                        ) + "\n\n"
                        self.wfile.write(frame.encode("utf-8"))
                        self.wfile.flush()
                    self.wfile.write(b"data: {\"done\": true}\n\n")
                    self.wfile.flush()
                except interpret_service.InterpretError as exc:
                    err = {"error": exc.code, "message": str(exc)}
                    self.wfile.write(("data: " + json.dumps(err) + "\n\n").encode("utf-8"))
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass  # client aborted; nothing to clean up
        finally:
            lock.release()

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
    # Set up the interpretations + interpret_settings tables.
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
    mimetypes.add_type("application/javascript; charset=utf-8", ".js")
    server = ThreadingHTTPServer(("localhost", port), TarotRequestHandler)
    print(f"Akashic Tarot running at http://localhost:{port}/Three.html")
    print(f"SQLite database: {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    run()
