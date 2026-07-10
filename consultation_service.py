"""Persistence and validation for consultation inputs and human reviews."""

from __future__ import annotations

import json
import sqlite3
import uuid


SCHEMA_VERSION = "1.0"
SUPPORTED_LANGUAGES = {"zh"}
SUPPORTED_MODULE_TYPES = {"general_reading"}
SUPPORTED_INPUT_MODES = {"manual", "three_d", "eval", "synthetic"}
PRIVACY_STATUSES = {"unchecked", "clear", "redacted", "blocked"}
FIXED_SPREAD_COUNTS = {
    "three_timeline": 3,
    "five_cross": 5,
    "celtic_cross": 10,
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS consultations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    reading_id INTEGER NOT NULL UNIQUE
        REFERENCES readings(id) ON DELETE CASCADE,
    schema_version TEXT NOT NULL DEFAULT '1.0',
    language TEXT NOT NULL,
    module_type TEXT NOT NULL,
    input_mode TEXT NOT NULL,
    user_query TEXT NOT NULL,
    user_context TEXT,
    module_payload_json TEXT NOT NULL DEFAULT '{}',
    privacy_status TEXT NOT NULL DEFAULT 'unchecked',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consultations_created
    ON consultations(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_module
    ON consultations(module_type, created_at DESC);

CREATE TABLE IF NOT EXISTS interpretation_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interpretation_id INTEGER NOT NULL UNIQUE
        REFERENCES interpretations(id) ON DELETE CASCADE,
    verdict TEXT NOT NULL,
    rating INTEGER,
    issue_tags_json TEXT NOT NULL DEFAULT '[]',
    review_note TEXT,
    edited_content TEXT,
    privacy_confirmed INTEGER NOT NULL DEFAULT 0,
    reviewed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_verdict
    ON interpretation_reviews(verdict, reviewed_at DESC);
"""


def migrate(conn: sqlite3.Connection) -> None:
    with conn:
        conn.executescript(SCHEMA)


def insert_consultation(
    conn: sqlite3.Connection,
    *,
    reading_id: int,
    values: dict,
    created_at: str,
    public_id: str | None = None,
) -> int:
    public_id = public_id or uuid.uuid4().hex
    cursor = conn.execute(
        """
        INSERT INTO consultations (
            public_id, reading_id, schema_version, language, module_type,
            input_mode, user_query, user_context, module_payload_json,
            privacy_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            public_id,
            reading_id,
            SCHEMA_VERSION,
            values["language"],
            values["module_type"],
            values["input_mode"],
            values["user_query"],
            values.get("user_context") or "",
            json.dumps(values.get("module_payload") or {}, ensure_ascii=False),
            values.get("privacy_status", "unchecked"),
            created_at,
            created_at,
        ),
    )
    return int(cursor.lastrowid)


def normalize_consultation_input(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Body must be a JSON object")

    language = str(payload.get("language") or "zh")
    module_type = str(payload.get("moduleType") or "general_reading")
    input_mode = str(payload.get("inputMode") or "manual")
    user_query = str(payload.get("userQuery") or "").strip()
    user_context = str(payload.get("userContext") or "").strip()
    module_payload = payload.get("modulePayload") or {}
    privacy_status = str(payload.get("privacyStatus") or "unchecked")

    if language not in SUPPORTED_LANGUAGES:
        raise ValueError("language must be zh")
    if module_type not in SUPPORTED_MODULE_TYPES:
        raise ValueError("Unsupported moduleType")
    if input_mode not in SUPPORTED_INPUT_MODES:
        raise ValueError("Unsupported inputMode")
    if not 4 <= len(user_query) <= 500:
        raise ValueError("userQuery must be 4-500 characters")
    if len(user_context) > 1000:
        raise ValueError("userContext must be at most 1000 characters")
    if not isinstance(module_payload, dict):
        raise ValueError("modulePayload must be a JSON object")
    if privacy_status not in PRIVACY_STATUSES:
        raise ValueError("Unsupported privacyStatus")

    return {
        "language": language,
        "module_type": module_type,
        "input_mode": input_mode,
        "user_query": user_query,
        "user_context": user_context,
        "module_payload": module_payload,
        "privacy_status": privacy_status,
    }


def validate_manual_cards(cards: object, *, template_key: str) -> None:
    if not isinstance(cards, list) or not 1 <= len(cards) <= 10:
        raise ValueError("manual cards must contain 1-10 cards")

    required_count = FIXED_SPREAD_COUNTS.get(template_key)
    if required_count is not None and len(cards) != required_count:
        raise ValueError(f"{template_key} requires {required_count} cards")
    if required_count is None and template_key != "free":
        raise ValueError("Unsupported templateKey")

    card_ids = []
    slots = []
    for card in cards:
        if not isinstance(card, dict):
            raise ValueError("Each card must be a JSON object")
        card_id = int(card.get("cardId", -1))
        slot = int(card.get("slot", 0))
        if not 0 <= card_id <= 77:
            raise ValueError("cardId must be between 0 and 77")
        if slot < 1:
            raise ValueError("card slot must be positive")
        if not isinstance(card.get("isReversed"), bool):
            raise ValueError("isReversed must be boolean")
        card_ids.append(card_id)
        slots.append(slot)

    if len(card_ids) != len(set(card_ids)):
        raise ValueError("manual cards contain duplicate cardId")
    if len(slots) != len(set(slots)):
        raise ValueError("manual cards contain duplicate slot")


def _row_to_consultation(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "publicId": row["public_id"],
        "readingId": row["reading_id"],
        "schemaVersion": row["schema_version"],
        "language": row["language"],
        "moduleType": row["module_type"],
        "inputMode": row["input_mode"],
        "userQuery": row["user_query"],
        "userContext": row["user_context"] or "",
        "modulePayload": json.loads(row["module_payload_json"] or "{}"),
        "privacyStatus": row["privacy_status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def load_consultation(
    conn: sqlite3.Connection, consultation_id: int
) -> dict | None:
    row = conn.execute(
        "SELECT * FROM consultations WHERE id = ?", (consultation_id,)
    ).fetchone()
    return _row_to_consultation(row) if row else None


def load_by_reading_id(conn: sqlite3.Connection, reading_id: int) -> dict | None:
    row = conn.execute(
        "SELECT * FROM consultations WHERE reading_id = ?", (reading_id,)
    ).fetchone()
    return _row_to_consultation(row) if row else None


def list_consultations(
    conn: sqlite3.Connection,
    *,
    limit: int = 20,
    module_type: str | None = None,
) -> list[dict]:
    limit = max(1, min(int(limit), 100))
    if module_type:
        rows = conn.execute(
            """
            SELECT * FROM consultations
            WHERE module_type = ?
            ORDER BY created_at DESC, id DESC LIMIT ?
            """,
            (module_type, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM consultations "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_row_to_consultation(row) for row in rows]


def resolve_interpret_context(
    conn: sqlite3.Connection,
    *,
    reading_id: int,
    request_question: str | None,
    created_at: str,
) -> tuple[str | None, dict | None]:
    saved = load_by_reading_id(conn, reading_id)
    incoming = str(request_question or "").strip()
    if saved is not None:
        if incoming and incoming != saved["userQuery"]:
            raise ValueError("question does not match saved consultation")
        return saved["userQuery"] or None, saved
    if not incoming:
        return None, None
    values = normalize_consultation_input(
        {
            "language": "zh",
            "moduleType": "general_reading",
            "inputMode": "three_d",
            "userQuery": incoming,
            "modulePayload": {},
        }
    )
    consultation_id = insert_consultation(
        conn,
        reading_id=reading_id,
        values=values,
        created_at=created_at,
    )
    return incoming, load_consultation(conn, consultation_id)


def build_input_snapshot(
    *,
    consultation: dict | None,
    reading_id: int,
    template_name: str,
    cards: list[dict],
    style: str,
    language: str,
) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "consultationPublicId": (
            consultation["publicId"] if consultation else None
        ),
        "readingId": reading_id,
        "language": language,
        "moduleType": (
            consultation["moduleType"]
            if consultation
            else "general_reading"
        ),
        "userQuery": consultation["userQuery"] if consultation else "",
        "userContext": consultation["userContext"] if consultation else "",
        "modulePayload": consultation["modulePayload"] if consultation else {},
        "templateName": template_name,
        "style": style,
        "cards": cards,
    }
