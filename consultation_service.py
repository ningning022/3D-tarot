"""Persistence and validation for consultation inputs and human reviews."""

from __future__ import annotations

import json
import math
import sqlite3
import uuid

import consultation_modules


SCHEMA_VERSION = "1.0"
SUPPORTED_LANGUAGES = {"zh"}
SUPPORTED_INPUT_MODES = {"manual", "three_d", "eval", "synthetic"}
PRIVACY_STATUSES = {"unchecked", "clear", "redacted", "blocked"}
REVIEW_VERDICTS = {"accepted", "needs_work", "rejected", "edited"}
REVIEW_ISSUE_TAGS = {
    "不回应问题",
    "牌义错误",
    "机械罗列",
    "空泛套话",
    "过度宿命",
    "擅测他人想法",
    "建议不可执行",
    "语气不合适",
    "事实或安全风险",
    "其他",
}
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

    spec = consultation_modules.require_enabled_module(module_type)
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError("language must be zh")
    if input_mode not in SUPPORTED_INPUT_MODES:
        raise ValueError("Unsupported inputMode")
    if spec["question_required"] and not 4 <= len(user_query) <= 500:
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


def validate_consultation_cards(
    cards: object,
    *,
    template_key: str,
    module_type: str,
) -> None:
    consultation_modules.validate_spread(module_type, template_key)
    validate_manual_cards(cards, template_key=template_key)


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


def upsert_review(
    conn: sqlite3.Connection,
    *,
    interpretation_id: int,
    payload: dict,
    reviewed_at: str,
) -> dict:
    if conn.execute(
        "SELECT 1 FROM interpretations WHERE id = ?", (interpretation_id,)
    ).fetchone() is None:
        raise ValueError("Interpretation not found")

    verdict = str(payload.get("verdict") or "")
    if verdict not in REVIEW_VERDICTS:
        raise ValueError("Unsupported review verdict")
    rating = payload.get("rating")
    normalized_rating = None
    if rating is not None:
        try:
            numeric_rating = float(rating)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "rating must be an integer between 1 and 5"
            ) from exc
        if (
            isinstance(rating, bool)
            or not math.isfinite(numeric_rating)
            or not numeric_rating.is_integer()
            or not 1 <= numeric_rating <= 5
        ):
            raise ValueError("rating must be an integer between 1 and 5")
        normalized_rating = int(numeric_rating)
    tags = payload.get("issueTags") or []
    if not isinstance(tags, list) or any(
        tag not in REVIEW_ISSUE_TAGS for tag in tags
    ):
        raise ValueError("Unsupported review issue tag")
    edited = str(payload.get("editedContent") or "").strip()
    if verdict == "edited" and not edited:
        raise ValueError("editedContent is required for edited verdict")
    note = str(payload.get("reviewNote") or "").strip()
    privacy = 1 if payload.get("privacyConfirmed") is True else 0

    with conn:
        conn.execute(
            """
            INSERT INTO interpretation_reviews (
                interpretation_id, verdict, rating, issue_tags_json,
                review_note, edited_content, privacy_confirmed,
                reviewed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(interpretation_id) DO UPDATE SET
                verdict=excluded.verdict,
                rating=excluded.rating,
                issue_tags_json=excluded.issue_tags_json,
                review_note=excluded.review_note,
                edited_content=excluded.edited_content,
                privacy_confirmed=excluded.privacy_confirmed,
                updated_at=excluded.updated_at
            """,
            (
                interpretation_id,
                verdict,
                normalized_rating,
                json.dumps(tags, ensure_ascii=False),
                note,
                edited or None,
                privacy,
                reviewed_at,
                reviewed_at,
            ),
        )
    review = load_review(conn, interpretation_id)
    if review is None:
        raise RuntimeError("Review was not persisted")
    return review


def load_review(
    conn: sqlite3.Connection, interpretation_id: int
) -> dict | None:
    row = conn.execute(
        "SELECT * FROM interpretation_reviews WHERE interpretation_id = ?",
        (interpretation_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "interpretationId": row["interpretation_id"],
        "verdict": row["verdict"],
        "rating": row["rating"],
        "issueTags": json.loads(row["issue_tags_json"] or "[]"),
        "reviewNote": row["review_note"] or "",
        "editedContent": row["edited_content"] or "",
        "privacyConfirmed": bool(row["privacy_confirmed"]),
        "reviewedAt": row["reviewed_at"],
        "updatedAt": row["updated_at"],
    }
