# Consultation Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested backend foundation that persists Chinese consultation inputs, versioned interpretation snapshots, and human reviews without breaking the existing 3D reading flow.

**Architecture:** Add a focused `consultation_service.py` beside the existing interpretation modules. `server.py` remains the HTTP/SQLite composition root, while `interpret_service.py` owns only model-run persistence. Existing readings remain the parent identity; consultations are one-to-one with readings, interpretations are versioned children, and reviews are one-to-one with interpretations.

**Tech Stack:** Python 3.10+ standard library, SQLite, `unittest`, existing stdlib HTTP server, existing Ollama/RAG Agent pipeline.

---

## Scope and file map

This is plan 1 of 5 derived from the approved design. It delivers a working and testable backend vertical foundation. Separate plans will cover the manual-entry UI, dataset export, functional modules, and evaluation/training preparation.

The remaining approved scope is intentionally assigned to these follow-on plans:

1. `2026-07-10-manual-reading-workbench.md` — card search, orientation controls, confirmation, SSE output, and review UI.
2. `2026-07-10-chinese-dataset-export.md` — Canonical JSONL, SFT `messages`, privacy gates, stable IDs/splits, and manifests.
3. `2026-07-10-functional-consultation-modules.md` — module registry, six-card choice comparison, symbolic-message safety, and module prompts.
4. `2026-07-10-evaluation-and-training-readiness.md` — production HTTP eval path, module/safety golden sets, acceptance metrics, and QLoRA readiness gate.

**Create:**

- `consultation_service.py` — consultation validation, schema migration, persistence, input snapshots, and human-review persistence.
- `tests/test_consultation_service.py` — isolated in-memory unit tests for that service.

**Modify:**

- `server.py` — atomic consultation API, compatibility bridge for existing 3D readings, PUT routing, and full deletion cleanup.
- `interpret_service.py` — interpretation public IDs, snapshots, trace metadata, completion status, and safety flags.
- `tests/test_server.py` — API, transaction, compatibility, and cascade tests.
- `tests/test_interpret_service.py` — migration and versioned-persistence tests.
- `README.md` — backend API and persistence behavior.
- `ARCHITECTURE.md` — consultation/interpretation/review relationships.

**Execution precondition:** Run implementation in a dedicated Git worktree. Preserve the unrelated root files `akashic-tour.7z`, `akashic-tour.mp4`, and `.claude/worktrees/peaceful-wescoff-096ad9`.

### Task 1: Make backend tests use the system temporary directory

**Files:**

- Modify: `tests/test_server.py:1-24`

- [ ] **Step 1: Reproduce the current fixture failure**

Run:

```powershell
python -m unittest tests.test_server -v
```

Expected in the current managed Windows environment: tests fail during `setUp` or cleanup with an access error under `tests/.tmp`.

- [ ] **Step 2: Remove the repository-local scratch root**

Delete the `TEST_TMP_ROOT` constant and replace `setUp` with:

```python
def setUp(self):
    self.tmpdir = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmpdir.cleanup)
    self.db_path = Path(self.tmpdir.name) / "tarot.sqlite3"
    server.DB_PATH = self.db_path
    server.init_db()
```

Do not change the production `server.DB_PATH` behavior.

- [ ] **Step 3: Verify the server tests pass**

Run:

```powershell
python -m unittest tests.test_server -v
```

Expected: all existing `TarotServerTest` tests pass with no cleanup error.

- [ ] **Step 4: Commit the fixture repair**

```powershell
git add tests/test_server.py
git commit -m "test: use system temp for server database fixtures"
```

### Task 2: Create consultation and review schemas

**Files:**

- Create: `consultation_service.py`
- Create: `tests/test_consultation_service.py`

- [ ] **Step 1: Write failing schema tests**

Create `tests/test_consultation_service.py` with:

```python
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
                "INSERT INTO readings(spread_number, created_at) VALUES (1, '2026-07-10T00:00:00+00:00')"
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
```

- [ ] **Step 2: Run the new tests and verify failure**

Run:

```powershell
python -m unittest tests.test_consultation_service -v
```

Expected: import failure because `consultation_service.py` does not exist.

- [ ] **Step 3: Implement the schema and migration**

Create `consultation_service.py` with the following initial content:

```python
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
```

- [ ] **Step 4: Run schema tests**

Run:

```powershell
python -m unittest tests.test_consultation_service.TestConsultationSchema -v
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit schema foundation**

```powershell
git add consultation_service.py tests/test_consultation_service.py
git commit -m "feat: add consultation persistence schema"
```

### Task 3: Add consultation validation and query helpers

**Files:**

- Modify: `consultation_service.py`
- Modify: `tests/test_consultation_service.py`

- [ ] **Step 1: Write failing validation and round-trip tests**

Append these classes to `tests/test_consultation_service.py`:

```python
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
                "INSERT INTO readings(spread_number, created_at) VALUES (1, '2026-07-10T00:00:00+00:00')"
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
            self.assertEqual(loaded["modulePayload"], {"source": "physical_deck"})
        finally:
            conn.close()
```

- [ ] **Step 2: Run the tests and verify missing helpers**

Run:

```powershell
python -m unittest tests.test_consultation_service.TestConsultationValidation tests.test_consultation_service.TestConsultationPersistence -v
```

Expected: failures for undefined validation and loading functions.

- [ ] **Step 3: Implement validation and row conversion**

Add to `consultation_service.py`:

```python
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


FIXED_SPREAD_COUNTS = {
    "three_timeline": 3,
    "five_cross": 5,
    "celtic_cross": 10,
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


def load_consultation(conn: sqlite3.Connection, consultation_id: int) -> dict | None:
    row = conn.execute(
        "SELECT * FROM consultations WHERE id = ?", (consultation_id,)
    ).fetchone()
    return _row_to_consultation(row) if row else None


def load_by_reading_id(conn: sqlite3.Connection, reading_id: int) -> dict | None:
    row = conn.execute(
        "SELECT * FROM consultations WHERE reading_id = ?", (reading_id,)
    ).fetchone()
    return _row_to_consultation(row) if row else None
```

- [ ] **Step 4: Run all consultation-service tests**

Run:

```powershell
python -m unittest tests.test_consultation_service -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit validation and persistence**

```powershell
git add consultation_service.py tests/test_consultation_service.py
git commit -m "feat: validate and load consultation inputs"
```

### Task 4: Add atomic consultation HTTP APIs

**Files:**

- Modify: `server.py:1-190`
- Modify: `server.py:500-590`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Write failing API and rollback tests**

Add a `manual_consultation_payload` helper method to `TarotServerTest` and these tests:

```python
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
    self.assertEqual(detail["userQuery"], "我应该如何看待这次工作机会？")
    self.assertEqual(
        [card["cardId"] for card in detail["reading"]["cards"]],
        [9, 10, 8],
    )

def test_invalid_consultation_rolls_back_reading(self):
    payload = self.manual_consultation_payload()
    payload["userQuery"] = "短"
    status, _, _ = self.request_json("POST", "/api/consultations", payload)
    self.assertEqual(status, 400)
    conn = sqlite3.connect(self.db_path)
    try:
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM consultations").fetchone()[0], 0)
    finally:
        conn.close()
```

- [ ] **Step 2: Run the two tests and verify 404 failures**

Run:

```powershell
python -m unittest tests.test_server.TarotServerTest.test_create_and_fetch_manual_consultation tests.test_server.TarotServerTest.test_invalid_consultation_rolls_back_reading -v
```

Expected: the create request returns 404 because consultation routes do not exist.

- [ ] **Step 3: Refactor reading normalization and insertion for transaction reuse**

Import `consultation_service` in `server.py`. Replace the body of the current `create_reading` implementation with these three functions:

```python
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


def create_reading(payload: dict) -> dict:
    normalized = normalize_reading_payload(payload)
    created_at = utc_now_iso()
    with closing(get_connection()) as conn:
        with conn:
            reading_id = insert_reading(conn, normalized, created_at)
    return {"id": reading_id, "createdAt": created_at}
```

Place this `insert_reading` function between them, or immediately after them:

```python
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
```

Run `python -m unittest tests.test_server.TarotServerTest.test_reading_insert_list_and_detail_roundtrip -v` immediately after this refactor. Expected: PASS with the original response shape.

- [ ] **Step 4: Implement atomic create and detail helpers**

Add to `server.py`:

```python
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


def fetch_consultation(consultation_id: int) -> dict | None:
    with closing(get_connection()) as conn:
        consultation = consultation_service.load_consultation(conn, consultation_id)
    if consultation is None:
        return None
    consultation["reading"] = fetch_reading(consultation["readingId"])
    return consultation
```

Add this query helper to `consultation_service.py`:

```python
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
            "SELECT * FROM consultations ORDER BY created_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_row_to_consultation(row) for row in rows]
```

Add this server wrapper:

```python
def fetch_consultations(limit: int, module_type: str | None = None) -> list[dict]:
    with closing(get_connection()) as conn:
        return consultation_service.list_consultations(
            conn, limit=limit, module_type=module_type
        )
```

Ensure `init_db()` calls migrations in this order after creating base reading tables:

```python
interpret_service.migrate(conn)
consultation_service.migrate(conn)
```

- [ ] **Step 5: Add the HTTP routes**

Insert before `/api/readings` routes in `handle_api_request`:

```python
if method == "POST" and path == "/api/consultations":
    return json_response(201, create_consultation(parse_json_body(body)))

if method == "GET" and path == "/api/consultations":
    query = parse_qs(parsed_url.query)
    limit = int(query.get("limit", ["20"])[0])
    module_type = query.get("module_type", [None])[0]
    return json_response(200, fetch_consultations(limit, module_type))

if method == "GET" and path.startswith("/api/consultations/"):
    consultation_id = int(path.rsplit("/", 1)[1])
    consultation = fetch_consultation(consultation_id)
    if consultation is None:
        return error_response(404, "Consultation not found")
    return json_response(200, consultation)
```

Extend `test_create_and_fetch_manual_consultation` with:

```python
list_status, _, list_body = self.request_json("GET", "/api/consultations?limit=10")
items = json.loads(list_body)
self.assertEqual(list_status, 200)
self.assertEqual([item["id"] for item in items], [created["id"]])
```

- [ ] **Step 6: Run API and regression tests**

Run:

```powershell
python -m unittest tests.test_server -v
```

Expected: all tests pass, including old `/api/readings` behavior and the two new consultation tests.

- [ ] **Step 7: Commit the atomic API**

```powershell
git add server.py tests/test_server.py
git commit -m "feat: create consultations atomically with readings"
```

### Task 5: Version interpretation persistence with snapshots

**Files:**

- Modify: `interpret_service.py:15-30`
- Modify: `interpret_service.py:300-390`
- Modify: `interpret_service.py:446-575`
- Modify: `tests/test_interpret_service.py`

- [ ] **Step 1: Write failing migration and snapshot tests**

Add to `TestPersistence` in `tests/test_interpret_service.py`:

```python
def test_save_loads_versioned_snapshots(self):
    interpretation_id = interpret_service.save_interpretation(
        self.conn,
        reading_id=self.reading_id,
        model="ollama:qwen2.5:7b",
        style="traditional",
        language="zh",
        content="完整回答",
        prompt_hash="abc123",
        duration_ms=1200,
        created_at="2026-07-10T00:00:00+00:00",
        input_snapshot={"userQuery": "我应该换工作吗？", "cards": SAMPLE_CARDS},
        rag_snapshot={"status": "ready", "entries": [{"card_id": 9}]},
        trace_id="a" * 32,
        prompt_version="manual-general-v1",
        generation_status="complete",
        safety_flags=[],
    )
    row = interpret_service.load_interpretation(self.conn, self.reading_id)
    self.assertEqual(row["id"], interpretation_id)
    self.assertEqual(len(row["public_id"]), 32)
    self.assertEqual(row["input_snapshot"]["userQuery"], "我应该换工作吗？")
    self.assertEqual(row["generation_status"], "complete")

def test_migrate_backfills_public_id_on_legacy_row(self):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spread_number INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        INSERT INTO readings(spread_number, created_at) VALUES (1, '2026-01-01');
        CREATE TABLE interpretations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reading_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            style TEXT NOT NULL,
            language TEXT NOT NULL,
            content TEXT NOT NULL,
            prompt_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            duration_ms INTEGER
        );
        INSERT INTO interpretations
            (reading_id, model, style, language, content, prompt_hash, created_at)
        VALUES (1, 'legacy', 'traditional', 'zh', '旧回答', 'hash', '2026-01-01');
        """
    )
    try:
        interpret_service.migrate(conn)
        row = conn.execute(
            "SELECT public_id, input_snapshot_json FROM interpretations"
        ).fetchone()
        self.assertEqual(len(row["public_id"]), 32)
        self.assertIsNone(row["input_snapshot_json"])
    finally:
        conn.close()
```

Add to `TestInterpretReadingStream`:

```python
def test_partial_stream_is_persisted_but_marked_partial(self):
    def broken_stream():
        yield "部分回答"
        raise interpret_service.InterpretBackendError("stream interrupted")

    strategy = interpret_service.StrategyResult(
        backend="ollama",
        model="qwen2.5:7b",
        url="http://localhost:11434",
    )
    with mock.patch.object(
        interpret_service, "resolve_strategy", return_value=strategy
    ), mock.patch.object(
        interpret_service, "stream_from_strategy", return_value=broken_stream()
    ):
        with self.assertRaises(interpret_service.InterpretBackendError):
            list(
                interpret_service.interpret_reading_stream(
                    self.conn,
                    reading_id=self.reading_id,
                    cards=SAMPLE_CARDS,
                    template_name="三张牌时间线",
                    language="zh",
                    enable_rag=False,
                )
            )
    row = interpret_service.load_interpretation(self.conn, self.reading_id)
    self.assertEqual(row["content"], "部分回答")
    self.assertEqual(row["generation_status"], "partial")
```

- [ ] **Step 2: Run tests and verify signature/schema failures**

Run:

```powershell
python -m unittest tests.test_interpret_service.TestPersistence -v
```

Expected: new keyword arguments or new columns are unsupported.

- [ ] **Step 3: Add idempotent interpretation columns and backfill**

Import `uuid`. Replace `MIGRATION_SQL` with:

```python
MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS interpretations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    reading_id INTEGER NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    style TEXT NOT NULL DEFAULT 'traditional',
    language TEXT NOT NULL,
    content TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    duration_ms INTEGER,
    input_snapshot_json TEXT,
    rag_snapshot_json TEXT,
    trace_id TEXT,
    prompt_version TEXT NOT NULL DEFAULT 'legacy-v1',
    generation_status TEXT NOT NULL DEFAULT 'complete',
    safety_flags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_interpretations_reading
    ON interpretations(reading_id);

CREATE TABLE IF NOT EXISTS interpret_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""
```

Add these helpers:

```python
def _ensure_column(conn, table: str, column: str, definition: str) -> None:
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _migrate_interpretation_columns(conn: sqlite3.Connection) -> None:
    definitions = {
        "public_id": "TEXT",
        "input_snapshot_json": "TEXT",
        "rag_snapshot_json": "TEXT",
        "trace_id": "TEXT",
        "prompt_version": "TEXT NOT NULL DEFAULT 'legacy-v1'",
        "generation_status": "TEXT NOT NULL DEFAULT 'complete'",
        "safety_flags_json": "TEXT NOT NULL DEFAULT '[]'",
    }
    for column, definition in definitions.items():
        _ensure_column(conn, "interpretations", column, definition)
    rows = conn.execute(
        "SELECT id FROM interpretations WHERE public_id IS NULL OR public_id = ''"
    ).fetchall()
    for row in rows:
        conn.execute(
            "UPDATE interpretations SET public_id = ? WHERE id = ?",
            (uuid.uuid4().hex, row[0]),
        )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_interpretations_public_id "
        "ON interpretations(public_id)"
    )
```

Replace `migrate` with:

```python
def migrate(conn: sqlite3.Connection) -> None:
    """Idempotent schema setup for generation, RAG, and Agent traces."""
    with conn:
        conn.executescript(MIGRATION_SQL)
        _migrate_interpretation_columns(conn)
    interpret_rag.migrate(conn)
    interpret_agent.migrate(conn)
```

- [ ] **Step 4: Extend save/load without breaking current callers**

Add optional keyword parameters to `save_interpretation`:

```python
input_snapshot: dict | None = None,
rag_snapshot: dict | None = None,
trace_id: str | None = None,
prompt_version: str = "legacy-v1",
generation_status: str = "complete",
safety_flags: list[str] | None = None,
public_id: str | None = None,
```

Replace the SQL/body of `save_interpretation` with:

```python
if generation_status not in {"complete", "partial", "failed"}:
    raise ValueError("Unsupported generation_status")
public_id = public_id or uuid.uuid4().hex
with conn:
    cur = conn.execute(
        """
        INSERT INTO interpretations (
            public_id, reading_id, model, style, language, content,
            prompt_hash, created_at, duration_ms, input_snapshot_json,
            rag_snapshot_json, trace_id, prompt_version,
            generation_status, safety_flags_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            public_id,
            reading_id,
            model,
            style,
            language,
            content,
            prompt_hash,
            created_at,
            duration_ms,
            json.dumps(input_snapshot, ensure_ascii=False) if input_snapshot is not None else None,
            json.dumps(rag_snapshot, ensure_ascii=False) if rag_snapshot is not None else None,
            trace_id,
            prompt_version,
            generation_status,
            json.dumps(safety_flags or [], ensure_ascii=False),
        ),
    )
    return int(cur.lastrowid or 0)
```

Replace the query and conversion in `load_interpretation` with:

```python
rows = conn.execute(
    """
    SELECT id, public_id, reading_id, model, style, language, content,
           prompt_hash, created_at, duration_ms, input_snapshot_json,
           rag_snapshot_json, trace_id, prompt_version,
           generation_status, safety_flags_json
    FROM interpretations
    WHERE reading_id = ?
    ORDER BY created_at DESC, id DESC
    """,
    (reading_id,),
).fetchall()
if not rows:
    return [] if all_rows else None
records = []
for row in rows:
    record = dict(row)
    record["input_snapshot"] = json.loads(record.pop("input_snapshot_json") or "null")
    record["rag_snapshot"] = json.loads(record.pop("rag_snapshot_json") or "null")
    record["safety_flags"] = json.loads(record.pop("safety_flags_json") or "[]")
    records.append(record)
return records if all_rows else records[0]
```

Add a focused post-critic update helper:

```python
def update_interpretation_safety(
    conn: sqlite3.Connection,
    interpretation_id: int,
    issues: list[str],
) -> None:
    with conn:
        conn.execute(
            "UPDATE interpretations SET safety_flags_json = ? WHERE id = ?",
            (json.dumps(issues, ensure_ascii=False), interpretation_id),
        )
```

- [ ] **Step 5: Persist complete versus partial runs**

In `interpret_reading_stream`, add optional parameters:

```python
input_snapshot: dict | None = None,
prompt_version: str = "legacy-v1",
```

Track completion explicitly:

```python
buffer = []
completed = False
interpretation_id = None
try:
    for piece in stream_from_strategy(strategy, messages):
        buffer.append(piece)
        yield piece
    completed = True
finally:
    full = "".join(buffer).strip()
    generation_status = "complete" if completed else "partial"
```

Replace `_retrieve_chunks` with this three-value implementation:

```python
def _retrieve_chunks(
    conn: sqlite3.Connection,
    cards: list[dict],
    question: str | None,
    settings: dict[str, str],
) -> tuple[list[dict], int, str]:
    embed_model = settings.get("embed_model", interpret_rag.DEFAULT_EMBED_MODEL)
    ollama_url = settings.get("ollama_url", DEFAULT_OLLAMA_URL)
    started = time.monotonic()
    rag_status = "ready"
    try:
        results = interpret_rag.retrieve_for_cards(
            conn,
            cards=cards,
            question=question,
            model=embed_model,
            ollama_url=ollama_url,
        )
    except interpret_rag.RagError:
        rag_status = "degraded"
        try:
            results = interpret_rag.retrieve_for_cards(
                conn,
                cards=cards,
                question=None,
                model=embed_model,
                ollama_url=ollama_url,
            )
        except interpret_rag.RagError:
            duration_ms = int((time.monotonic() - started) * 1000)
            return [], duration_ms, "unavailable"
    duration_ms = int((time.monotonic() - started) * 1000)
    out = []
    for chunk in results:
        entry = chunk.entry
        out.append(
            {
                "card_id": entry.card_id,
                "zh": entry.zh,
                "en": entry.en,
                "orientation": entry.orientation,
                "imagery": entry.imagery,
                "situations": entry.situations,
                "keywords": entry.keywords,
                "score": chunk.score,
            }
        )
    return out, duration_ms, rag_status
```

Change the caller to:

```python
retrieved = []
retrieve_ms = 0
rag_status = "disabled"
if enable_rag:
    retrieved, retrieve_ms, rag_status = _retrieve_chunks(
        conn, cards, question, settings
    )
```

In the `finally` block, save with:

```python
if persist and full:
    from datetime import datetime, timezone
    interpretation_id = save_interpretation(
        conn,
        reading_id=reading_id,
        model=f"{strategy.backend}:{strategy.model}",
        style=style,
        language=language,
        content=full,
        prompt_hash=prompt_hash,
        duration_ms=duration_ms,
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        input_snapshot=input_snapshot,
        rag_snapshot={"status": rag_status, "entries": retrieved},
        trace_id=trace_id,
        prompt_version=prompt_version,
        generation_status=generation_status,
        safety_flags=[],
    )
```

After the local critic returns `_crit`, persist its closed-vocabulary issues:

```python
if interpretation_id is not None:
    update_interpretation_safety(
        conn, interpretation_id, list(_crit.get("issues") or [])
    )
```

This preserves partial text for diagnostics, distinguishes RAG degradation, and records critic findings without allowing the critic to approve a training sample.

- [ ] **Step 6: Run interpretation tests**

Run:

```powershell
python -m unittest tests.test_interpret_service -v
```

Expected: all interpretation-service tests pass and legacy callers still work.

- [ ] **Step 7: Commit versioned persistence**

```powershell
git add interpret_service.py tests/test_interpret_service.py
git commit -m "feat: persist versioned interpretation snapshots"
```

### Task 6: Bridge saved consultations into the existing SSE Agent path

**Files:**

- Modify: `consultation_service.py`
- Modify: `interpret_prompts.py`
- Modify: `interpret_service.py`
- Modify: `server.py:600-705`
- Modify: `tests/test_consultation_service.py`
- Modify: `tests/test_interpret_service.py`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Write failing compatibility tests**

Add to `tests/test_consultation_service.py`:

```python
class TestInterpretContext(unittest.TestCase):
    def test_creates_three_d_consultation_from_legacy_question(self):
        conn = make_conn()
        try:
            reading_id = conn.execute(
                "INSERT INTO readings(spread_number, created_at) VALUES (1, '2026-07-10')"
            ).lastrowid
            question, consultation = consultation_service.resolve_interpret_context(
                conn,
                reading_id=reading_id,
                request_question="我应该换工作吗？",
                created_at="2026-07-10T00:00:00+00:00",
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
                "INSERT INTO readings(spread_number, created_at) VALUES (1, '2026-07-10')"
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
            with self.assertRaisesRegex(ValueError, "does not match saved consultation"):
                consultation_service.resolve_interpret_context(
                    conn,
                    reading_id=reading_id,
                    request_question="另一个不同问题",
                    created_at="2026-07-10T00:00:00+00:00",
                )
        finally:
            conn.close()
```

- [ ] **Step 2: Run the tests and verify missing helper**

Run:

```powershell
python -m unittest tests.test_consultation_service.TestInterpretContext -v
```

Expected: `resolve_interpret_context` is undefined.

- [ ] **Step 3: Implement the compatibility resolver**

Add to `consultation_service.py`:

```python
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
        "consultationPublicId": consultation["publicId"] if consultation else None,
        "readingId": reading_id,
        "language": language,
        "moduleType": consultation["moduleType"] if consultation else "general_reading",
        "userQuery": consultation["userQuery"] if consultation else "",
        "userContext": consultation["userContext"] if consultation else "",
        "modulePayload": consultation["modulePayload"] if consultation else {},
        "templateName": template_name,
        "style": style,
        "cards": cards,
    }
```

- [ ] **Step 4: Resolve context before opening SSE headers**

First add this failing prompt test to `TestBuildMessages` in `tests/test_interpret_service.py`:

```python
def test_includes_saved_user_context(self):
    messages = interpret_prompts.build_messages(
        SAMPLE_CARDS,
        "三张牌时间线",
        language="zh",
        question="我应该换工作吗？",
        user_context="现在的工作稳定，但没有成长空间。",
    )
    self.assertIn("【背景】现在的工作稳定，但没有成长空间。", messages[-1]["content"])
```

Run:

```powershell
python -m unittest tests.test_interpret_service.TestBuildMessages.test_includes_saved_user_context -v
```

Expected: `build_messages` rejects the unknown `user_context` keyword.

Add `user_context: str | None = None` to both `build_messages` and `_format_user_prompt` in `interpret_prompts.py`. Pass it into `_format_user_prompt` alongside `question` and `retrieved_chunks`:

```python
user_content = _format_user_prompt(
    cards,
    template_name,
    language=language,
    question=question,
    user_context=user_context,
    retrieved_chunks=retrieved_chunks,
)
```

In the Chinese branch of `_format_user_prompt`, use:

```python
question_block = ""
context_block = ""
instruction = "请给出整体解读（综合所有位置的关系，不要逐张分点）。"
if question and question.strip():
    question_block = f"\n【用户问题】{question.strip()}\n"
    instruction = (
        "请通过这些牌的组合，针对用户的问题给出整体回应。"
        "解读要直接回应问题、与牌面对应，不要逐张罗列。"
    )
if user_context and user_context.strip():
    context_block = f"\n【背景】{user_context.strip()}\n"

sections = [header, body]
if rag_block:
    sections.append("\n" + rag_block)
if question_block:
    sections.append(question_block)
if context_block:
    sections.append(context_block)
sections.append("\n" + instruction)
return "\n".join(sections)
```

In the English branch, initialize and append context with:

```python
context_block = ""
if user_context and user_context.strip():
    context_block = f"\n[Context] {user_context.strip()}\n"

sections = [header, body]
if rag_block:
    sections.append("\n" + rag_block)
if question_block:
    sections.append(question_block)
if context_block:
    sections.append(context_block)
sections.append("\n" + instruction)
return "\n".join(sections)
```

Add `user_context: str | None = None` to `interpret_reading_stream` and pass it to `build_messages`:

```python
messages = build_messages(
    cards,
    template_name,
    language=language,
    style=style,
    question=question,
    user_context=user_context,
    retrieved_chunks=retrieved,
)
```

In `TarotRequestHandler._handle_interpret_stream`, after loading settings and overrides but before sending the 200 response:

```python
raw_q = overrides.get("question")
request_question = str(raw_q).strip() if raw_q else None
question, consultation = consultation_service.resolve_interpret_context(
    conn,
    reading_id=reading_id,
    request_question=request_question,
    created_at=utc_now_iso(),
)
conn.commit()
input_snapshot = consultation_service.build_input_snapshot(
    consultation=consultation,
    reading_id=reading_id,
    template_name=template_name,
    cards=cards,
    style=style,
    language=language,
)
```

Pass `input_snapshot=input_snapshot` and `prompt_version="general-v1"` to `interpret_reading_stream`. For saved manual consultations, the database question is authoritative. For existing 3D readings, the first non-empty question creates a `three_d` consultation. A questionless legacy interpretation still runs without creating a consultation.

Also pass:

```python
user_context=consultation["userContext"] if consultation else None,
```

- [ ] **Step 5: Test service and server regressions**

Run:

```powershell
python -m unittest tests.test_consultation_service tests.test_server tests.test_interpret_service -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit the SSE compatibility bridge**

```powershell
git add consultation_service.py interpret_prompts.py interpret_service.py server.py tests/test_consultation_service.py tests/test_interpret_service.py tests/test_server.py
git commit -m "feat: bind saved consultations to interpretation runs"
```

### Task 7: Add human review persistence and PUT API

**Files:**

- Modify: `consultation_service.py`
- Modify: `server.py`
- Modify: `tests/test_consultation_service.py`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Write failing review-service tests**

Add to `tests/test_consultation_service.py`:

```python
class TestReviews(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()
        self.reading_id = self.conn.execute(
            "INSERT INTO readings(spread_number, created_at) VALUES (1, '2026-07-10')"
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
```

- [ ] **Step 2: Run the tests and verify missing function**

Run:

```powershell
python -m unittest tests.test_consultation_service.TestReviews -v
```

Expected: `upsert_review` is undefined.

- [ ] **Step 3: Implement review validation and upsert**

Add constants and functions to `consultation_service.py`:

```python
REVIEW_VERDICTS = {"accepted", "needs_work", "rejected", "edited"}
REVIEW_ISSUE_TAGS = {
    "不回应问题", "牌义错误", "机械罗列", "空泛套话", "过度宿命",
    "擅测他人想法", "建议不可执行", "语气不合适", "事实或安全风险", "其他",
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
    if rating is not None and not 1 <= int(rating) <= 5:
        raise ValueError("rating must be between 1 and 5")
    tags = payload.get("issueTags") or []
    if not isinstance(tags, list) or any(tag not in REVIEW_ISSUE_TAGS for tag in tags):
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
                int(rating) if rating is not None else None,
                json.dumps(tags, ensure_ascii=False),
                note,
                edited or None,
                privacy,
                reviewed_at,
                reviewed_at,
            ),
        )
    return load_review(conn, interpretation_id)


def load_review(conn: sqlite3.Connection, interpretation_id: int) -> dict | None:
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
```

- [ ] **Step 4: Write and run a failing PUT route test**

Add `import interpret_service` to `tests/test_server.py`. Add this test to `TarotServerTest`:

```python
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
```

Run that test and expect 404 before adding the route.

- [ ] **Step 5: Add PUT routing and handler support**

Add this route in `handle_api_request`:

```python
if method == "PUT" and path.startswith("/api/interpretations/") and path.endswith("/review"):
    try:
        interpretation_id = int(path.split("/")[3])
    except (ValueError, IndexError):
        return error_response(400, "Invalid interpretation id")
    with closing(get_connection()) as conn:
        review = consultation_service.upsert_review(
            conn,
            interpretation_id=interpretation_id,
            payload=parse_json_body(body),
            reviewed_at=utc_now_iso(),
        )
    return json_response(200, review)
```

Update CORS methods to `GET, POST, PUT, DELETE, OPTIONS` and add:

```python
def do_PUT(self):
    if not self.path.startswith("/api/"):
        self.send_error(404, "Not found")
        return
    length = int(self.headers.get("Content-Length", "0"))
    body = self.rfile.read(length)
    self.send_api_response(*handle_api_request("PUT", urlparse(self.path), body))
```

- [ ] **Step 6: Attach reviews to consultation detail**

Replace `fetch_consultation` with:

```python
def fetch_consultation(consultation_id: int) -> dict | None:
    with closing(get_connection()) as conn:
        consultation = consultation_service.load_consultation(conn, consultation_id)
        if consultation is None:
            return None
        interpretations = interpret_service.load_interpretation(
            conn, consultation["readingId"], all_rows=True
        )
        for interpretation in interpretations:
            interpretation["review"] = consultation_service.load_review(
                conn, interpretation["id"]
            )
    consultation["reading"] = fetch_reading(consultation["readingId"])
    consultation["interpretations"] = interpretations
    return consultation
```

Extend `test_put_interpretation_review` by fetching the consultation detail and asserting:

```python
_, _, detail_body = self.request_json(
    "GET", f"/api/consultations/{created['id']}"
)
detail = json.loads(detail_body)
self.assertEqual(detail["interpretations"][0]["review"]["verdict"], "accepted")
```

- [ ] **Step 7: Run service and route tests**

Run:

```powershell
python -m unittest tests.test_consultation_service.TestReviews tests.test_server -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit review persistence**

```powershell
git add consultation_service.py server.py tests/test_consultation_service.py tests/test_server.py
git commit -m "feat: persist human reviews for interpretations"
```

### Task 8: Verify cascade cleanup, document APIs, and run the full suite

**Files:**

- Modify: `server.py:331-339`
- Modify: `tests/test_server.py:140-183`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Extend the deletion test with child records**

At the start of `test_delete_readings_clears_records_and_resets_ids`, create the record graph with:

```python
status, _, created_body = self.request_json(
    "POST", "/api/consultations", self.manual_consultation_payload()
)
self.assertEqual(status, 201)
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
    consultation_service.upsert_review(
        conn,
        interpretation_id=interpretation_id,
        payload={
            "verdict": "accepted",
            "rating": 5,
            "issueTags": [],
            "privacyConfirmed": True,
        },
        reviewed_at="2026-07-10T00:05:00+00:00",
    )
    conn.execute(
        """
        INSERT INTO agent_steps (
            reading_id, trace_id, step_index, step, model, duration_ms,
            input_summary, output_json, ok, error, created_at
        ) VALUES (?, ?, 0, 'generate', 'test', 1, '', '{}', 1, NULL, ?)
        """,
        (created["readingId"], "a" * 32, "2026-07-10T00:00:00+00:00"),
    )
    conn.commit()
finally:
    conn.close()
```

Add `import consultation_service` and retain the `interpret_service` import introduced in Task 7. Remove the old `/api/readings` setup from this test because the consultation POST now creates the parent reading. After `DELETE /api/readings`, assert zero rows with:

```python
conn = sqlite3.connect(self.db_path)
try:
    for table in (
        "readings",
        "reading_cards",
        "consultations",
        "interpretations",
        "interpretation_reviews",
        "agent_steps",
    ):
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        self.assertEqual(count, 0, table)
finally:
    conn.close()
```

Replace the old post-delete `/api/readings` recreation with:

```python
second_status, _, second_body = self.request_json(
    "POST", "/api/consultations", self.manual_consultation_payload()
)
second = json.loads(second_body)
self.assertEqual(second_status, 201)
self.assertEqual(second["readingId"], 1)
self.assertEqual(second["id"], 1)
```

- [ ] **Step 2: Run the deletion test and verify agent-step failure**

Run:

```powershell
python -m unittest tests.test_server.TarotServerTest.test_delete_readings_clears_records_and_resets_ids -v
```

Expected: `agent_steps` remains non-empty because it has no foreign-key cascade.

- [ ] **Step 3: Make deletion explicit and deterministic**

Change `clear_readings` to delete non-FK traces first, then the parent readings, and reset all relevant sequences:

```python
def clear_readings():
    with closing(get_connection()) as conn:
        with conn:
            conn.execute("DELETE FROM agent_steps")
            conn.execute("DELETE FROM readings")
            conn.execute(
                """
                DELETE FROM sqlite_sequence
                WHERE name IN (
                    'readings', 'reading_cards', 'consultations',
                    'interpretations', 'interpretation_reviews', 'agent_steps'
                )
                """
            )
    return {"ok": True, "deleted": True}
```

The foreign keys remove cards, consultations, interpretations, and reviews when readings are deleted.

- [ ] **Step 4: Document the foundation**

Add this section to `README.md` after the interpretation API section:

````markdown
### 中文咨询数据接口

手动录牌使用独立的咨询记录保存问题、背景和输入来源。创建操作会在一个 SQLite 事务中同时写入 reading、cards 和 consultation：

```json
POST /api/consultations
{
  "language": "zh",
  "moduleType": "general_reading",
  "inputMode": "manual",
  "userQuery": "我应该如何看待这次工作机会？",
  "userContext": "目前稳定，但成长空间有限。",
  "modulePayload": {},
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
      "isReversed": false
    }
  ]
}
```

- `GET /api/consultations?limit=20`：列出最近咨询。
- `GET /api/consultations/<id>`：返回问题、牌阵、全部解读版本及人工审核。
- `PUT /api/interpretations/<id>/review`：保存 `accepted`、`needs_work`、`rejected` 或 `edited` 审核。

模型生成文本默认不是训练数据。只有人工结论为 `accepted` 或 `edited`、确认本地隐私状态且通过后续安全过滤的版本，才具备导出候选资格。
````

Add this section to `ARCHITECTURE.md` after the persistence section:

````markdown
### Consultation data graph

```text
readings 1 ── 0..1 consultations
readings 1 ── 0..N interpretations
interpretations 1 ── 0..1 interpretation_reviews
interpretations trace_id ── 0..N agent_steps
```

The first interpretation request for a legacy 3D reading creates an `input_mode=three_d` consultation when the request contains a question. Questionless fast-path readings remain valid, but their interpretations lack a confirmed consultation question and are not eligible for SFT export.
````

- [ ] **Step 5: Run syntax and focused tests**

Run:

```powershell
python -m py_compile server.py consultation_service.py interpret_service.py
python -m unittest tests.test_consultation_service tests.test_interpret_service tests.test_server -v
```

Expected: compilation succeeds and every focused Python test passes.

- [ ] **Step 6: Run the complete Python and JavaScript suite**

Run:

```powershell
python -m unittest discover -s tests -v
Get-ChildItem tests -Filter 'test_*.js' | Sort-Object Name | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "JavaScript test failed: $($_.Name)" } }
```

Expected: all Python and JavaScript tests pass; no network or Ollama call is made because model transports are mocked.

- [ ] **Step 7: Inspect the final diff and commit**

Run:

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: only files named in this plan are changed. Then commit:

```powershell
git add server.py consultation_service.py interpret_service.py tests/test_server.py tests/test_consultation_service.py tests/test_interpret_service.py README.md ARCHITECTURE.md
git commit -m "feat: complete consultation data foundation"
```

## Completion checkpoint

This plan is complete when a caller can atomically create a Chinese manual consultation, run or retrieve versioned interpretations with reproducible snapshots, save an accepted or edited human review, and delete all linked local records without orphan traces. The next plan starts from this API foundation and builds the browser-based manual-entry workbench.
