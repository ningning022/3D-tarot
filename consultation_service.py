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
