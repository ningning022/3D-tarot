# Unified Consultation Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the late question prompt and isolated manual-entry concept with one tested consultation flow that supports no-question/general consultations, 3D/manual card acquisition, optional AI interpretation, and human review.

**Architecture:** Add a server-owned consultation module registry and a browser `ConsultationFlow` state machine. Both 3D and manual acquisition produce the same normalized card payload, then route to either the reading API (no question) or consultation API (question present); interpretation is a post-save action and never changes persistence identity. Existing 3D, legacy interpretation, history, theme, daily draw, and admin flows remain compatible.

**Tech Stack:** Python 3.10+ standard library, SQLite, stdlib HTTP server, browser JavaScript IIFEs/CommonJS test exports, Three.js, CSS custom properties, Node `assert`, Python `unittest`.

---

## Scope and file map

This plan implements **Stage A only** from the approved design. `choice_compare`, `symbolic_message`, dataset export, and QLoRA remain separate follow-on plans. The module registry is built now so those modules can be added without rewriting the main flow.

**Create:**

- `consultation_modules.py` — authoritative enabled-module registry, public descriptors, and allowed-spread validation.
- `tests/test_consultation_modules.py` — registry and public descriptor tests.
- `js/consultation_flow.js` — serializable draft/state logic, card search, payloads, save/generate/review orchestration, and browser controller.
- `css/consultation_flow.css` — full-screen wizard, manual card editor, result/review, and responsive styling.
- `tests/test_consultation_flow.js` — pure logic, orchestration, and static integration tests.
- `tests/test_api.js` — strict consultation API client tests.

**Modify:**

- `consultation_service.py` — read supported modules and allowed spreads from the registry; validate both manual and 3D inputs.
- `server.py` — expose module descriptors and allow atomic `three_d` consultation creation.
- `tests/test_consultation_service.py` — registry-backed validation tests.
- `tests/test_server.py` — module endpoint, three-dimensional consultation, and record-graph integration tests.
- `js/api.js` — strict reading/consultation/review calls while preserving legacy offline fallbacks.
- `js/main_ui_state.js` and `tests/test_main_ui_state.js` — idle primary action becomes “new consultation”.
- `js/history.js` — route completed 3D cards through the active consultation draft when present.
- `js/main.js` — open the wizard from the primary action and expose the 3D start bridge.
- `js/spread.js` — open the wizard for the idle OPEN gesture and await post-spread persistence.
- `js/spread_templates.js` and `tests/test_spread_templates.js` — module-aware allowed-template filtering without adding future templates yet.
- `Three.html` — wizard dialog, current-consultation summary, CSS, and script references.
- `css/responsive.css` — narrow-screen rules that must load after the feature stylesheet.
- `README.md` and `ARCHITECTURE.md` — user flow and module/acquisition/persistence boundaries.

**Execution workspace:** `D:\taluo\.worktrees\unified-consultation-flow` on branch `feature/unified-consultation-flow`.

### Task 1: Add the authoritative consultation module registry

**Files:**

- Create: `consultation_modules.py`
- Create: `tests/test_consultation_modules.py`

- [ ] **Step 1: Write failing registry tests**

Create `tests/test_consultation_modules.py`:

```python
import unittest

import consultation_modules


class ConsultationModuleRegistryTest(unittest.TestCase):
    def test_public_modules_only_expose_enabled_safe_fields(self):
        modules = consultation_modules.list_public_modules()
        self.assertEqual([item["moduleType"] for item in modules], ["general_reading"])
        general = modules[0]
        self.assertEqual(general["defaultSpread"], "three_timeline")
        self.assertEqual(
            general["allowedSpreads"],
            ["three_timeline", "five_cross", "celtic_cross", "free"],
        )
        self.assertTrue(general["questionRequired"])
        self.assertNotIn("promptOverlay", general)
        self.assertNotIn("safetyRules", general)

    def test_require_enabled_module_rejects_unknown(self):
        with self.assertRaisesRegex(ValueError, "Unsupported moduleType"):
            consultation_modules.require_enabled_module("choice_compare")

    def test_validate_spread_rejects_module_mismatch(self):
        with self.assertRaisesRegex(ValueError, "Spread is not allowed"):
            consultation_modules.validate_spread("general_reading", "choice_six")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
python -m unittest tests.test_consultation_modules -v
```

Expected: import failure because `consultation_modules.py` does not exist.

- [ ] **Step 3: Implement the registry**

Create `consultation_modules.py` with this public contract:

```python
"""Authoritative registry for consultation modules and allowed spreads."""

from __future__ import annotations

from copy import deepcopy


MODULE_SPECS = {
    "general_reading": {
        "module_type": "general_reading",
        "display_name": "普通咨询",
        "description": "围绕一个明确问题进行非宿命、可行动的牌面反思。",
        "question_required": True,
        "input_fields": [
            {"key": "userQuery", "label": "你的问题", "required": True, "maxLength": 500},
            {"key": "userContext", "label": "补充背景", "required": False, "maxLength": 1000},
        ],
        "allowed_spreads": ["three_timeline", "five_cross", "celtic_cross", "free"],
        "default_spread": "three_timeline",
        "prompt_version": "general-v1",
        "prompt_overlay": "直接回应用户问题，综合牌位关系，给出非宿命且可行动的反思。",
        "output_contract": "回应问题、整合牌面、给出用户可控制的下一步。",
        "safety_rules": ["fatalism", "high_stakes_overreach", "dependency_language"],
        "enabled": True,
    }
}


def require_enabled_module(module_type: str) -> dict:
    spec = MODULE_SPECS.get(str(module_type or ""))
    if spec is None or not spec["enabled"]:
        raise ValueError("Unsupported moduleType")
    return spec


def validate_spread(module_type: str, template_key: str) -> dict:
    spec = require_enabled_module(module_type)
    if template_key not in spec["allowed_spreads"]:
        raise ValueError("Spread is not allowed for moduleType")
    return spec


def list_public_modules() -> list[dict]:
    result = []
    for spec in MODULE_SPECS.values():
        if not spec["enabled"]:
            continue
        result.append(
            {
                "moduleType": spec["module_type"],
                "displayName": spec["display_name"],
                "description": spec["description"],
                "questionRequired": spec["question_required"],
                "inputFields": deepcopy(spec["input_fields"]),
                "allowedSpreads": list(spec["allowed_spreads"]),
                "defaultSpread": spec["default_spread"],
            }
        )
    return result
```

- [ ] **Step 4: Run the registry tests and verify GREEN**

Run:

```powershell
python -m unittest tests.test_consultation_modules -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit the registry**

```powershell
git add consultation_modules.py tests/test_consultation_modules.py
git commit -m "feat: add consultation module registry"
```

### Task 2: Apply module rules to consultation creation and expose descriptors

**Files:**

- Modify: `consultation_service.py:10-183`
- Modify: `server.py:1-250,574-668`
- Modify: `tests/test_consultation_service.py`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Write failing service and API tests**

Add to `tests/test_consultation_service.py`:

```python
def test_rejects_spread_not_allowed_for_module(self):
    cards = [{"slot": 1, "cardId": 9, "isReversed": False}]
    with self.assertRaisesRegex(ValueError, "Spread is not allowed"):
        consultation_service.validate_consultation_cards(
            cards,
            template_key="choice_six",
            module_type="general_reading",
        )
```

Add to `TarotServerTest` in `tests/test_server.py`:

```python
def test_lists_enabled_consultation_modules(self):
    status, _, body = self.request_json("GET", "/api/consultation-modules")
    modules = json.loads(body)
    self.assertEqual(status, 200)
    self.assertEqual([item["moduleType"] for item in modules], ["general_reading"])
    self.assertNotIn("promptOverlay", modules[0])

def test_create_three_d_consultation(self):
    payload = self.manual_consultation_payload()
    payload["inputMode"] = "three_d"
    status, _, body = self.request_json("POST", "/api/consultations", payload)
    created = json.loads(body)
    self.assertEqual(status, 201)
    self.assertEqual(created["inputMode"], "three_d")
    self.assertEqual(created["readingId"], 1)

def test_no_question_reading_does_not_create_consultation(self):
    payload = self.manual_consultation_payload()
    reading_payload = {
        "spreadNumber": payload["spreadNumber"],
        "templateKey": payload["templateKey"],
        "templateName": payload["templateName"],
        "cards": payload["cards"],
    }
    status, _, _ = self.request_json("POST", "/api/readings", reading_payload)
    self.assertEqual(status, 201)
    conn = sqlite3.connect(self.db_path)
    try:
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM consultations").fetchone()[0], 0)
    finally:
        conn.close()
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
python -m unittest tests.test_consultation_service tests.test_server.TarotServerTest.test_lists_enabled_consultation_modules tests.test_server.TarotServerTest.test_create_three_d_consultation tests.test_server.TarotServerTest.test_no_question_reading_does_not_create_consultation -v
```

Expected: missing `validate_consultation_cards`, 404 module endpoint, and 400 rejection of `inputMode=three_d`.

- [ ] **Step 3: Make consultation validation registry-backed**

In `consultation_service.py`:

```python
import consultation_modules

# Remove SUPPORTED_MODULE_TYPES. Keep SUPPORTED_INPUT_MODES because eval and
# synthetic are non-HTTP producers that still use the common schema.

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


def validate_consultation_cards(cards: object, *, template_key: str, module_type: str) -> None:
    consultation_modules.validate_spread(module_type, template_key)
    validate_manual_cards(cards, template_key=template_key)
```

Keep `validate_manual_cards()` as the low-level card/count validator so legacy tests and non-module callers remain valid.

- [ ] **Step 4: Allow both acquisition modes and add the module route**

In `server.py` import `consultation_modules`, then change `create_consultation()` and routing:

```python
def create_consultation(payload: dict) -> dict:
    values = consultation_service.normalize_consultation_input(payload)
    if values["input_mode"] not in {"manual", "three_d"}:
        raise ValueError("POST /api/consultations requires manual or three_d inputMode")
    consultation_service.validate_consultation_cards(
        payload.get("cards"),
        template_key=str(payload.get("templateKey") or "free"),
        module_type=values["module_type"],
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
        return consultation_service.load_consultation(conn, consultation_id)
```

Add before the `/api/consultations` routes:

```python
if method == "GET" and path == "/api/consultation-modules":
    return json_response(200, consultation_modules.list_public_modules())
```

- [ ] **Step 5: Run focused backend tests**

Run:

```powershell
python -m unittest tests.test_consultation_modules tests.test_consultation_service tests.test_server -v
```

Expected: all module, consultation, and server tests pass.

- [ ] **Step 6: Commit the backend integration**

```powershell
git add consultation_service.py server.py tests/test_consultation_service.py tests/test_server.py
git commit -m "feat: validate consultation modules and acquisition modes"
```

### Task 3: Add strict browser API methods for the unified flow

**Files:**

- Create: `tests/test_api.js`
- Modify: `js/api.js`

- [ ] **Step 1: Write failing API client tests**

Create `tests/test_api.js`:

```javascript
'use strict';

const assert = require('assert');
const api = require('../js/api.js');

async function withFetch(impl, fn) {
  const previous = global.fetch;
  global.fetch = impl;
  try { await fn(); } finally { global.fetch = previous; }
}

async function main() {
  const calls = [];
  await withFetch(async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => [{ moduleType: 'general_reading' }] };
  }, async () => {
    const modules = await api.loadConsultationModules();
    assert.strictEqual(modules[0].moduleType, 'general_reading');
  });
  assert.strictEqual(calls[0].url, '/api/consultation-modules');

  await withFetch(async (url, options = {}) => ({
    ok: true,
    status: 201,
    json: async () => ({ id: 4, readingId: 9 })
  }), async () => {
    const saved = await api.createConsultation({ moduleType: 'general_reading' });
    assert.deepStrictEqual(saved, { id: 4, readingId: 9 });
  });

  await withFetch(async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'userQuery must be 4-500 characters' })
  }), async () => {
    await assert.rejects(
      () => api.createConsultation({}),
      error => error.status === 400 && error.message.includes('userQuery')
    );
  });

  let reviewCall = null;
  await withFetch(async (url, options = {}) => {
    reviewCall = { url, options };
    return { ok: true, status: 200, json: async () => ({ verdict: 'accepted' }) };
  }, async () => {
    const review = await api.reviewInterpretation(19, { verdict: 'accepted' });
    assert.strictEqual(review.verdict, 'accepted');
  });
  assert.strictEqual(reviewCall.url, '/api/interpretations/19/review');
  assert.strictEqual(reviewCall.options.method, 'PUT');

  console.log('api client tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node tests/test_api.js
```

Expected: failure because `js/api.js` is not CommonJS-safe and has no consultation methods.

- [ ] **Step 3: Make errors structured and add strict methods**

Update `requestJson()` in `js/api.js` and add these functions:

```javascript
async function readError(response) {
    let payload = null;
    try { payload = await response.json(); } catch (_) { /* non-JSON error */ }
    const message = payload && (payload.error || payload.message)
        ? String(payload.error || payload.message)
        : `API ${response.status}: ${response.statusText || 'Request failed'}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    return error;
}

async function requestJson(path, options = {}) {
    const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...(options.headers || {}) },
        ...options
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

function loadConsultationModules() {
    return requestJson('/api/consultation-modules', { cache: 'no-store' });
}

function createReading(payload) {
    return requestJson('/api/readings', { method: 'POST', body: JSON.stringify(payload) });
}

function createConsultation(payload) {
    return requestJson('/api/consultations', { method: 'POST', body: JSON.stringify(payload) });
}

function loadConsultation(id) {
    return requestJson(`/api/consultations/${encodeURIComponent(id)}`, { cache: 'no-store' });
}

function reviewInterpretation(id, payload) {
    return requestJson(`/api/interpretations/${encodeURIComponent(id)}/review`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
}
```

Return these functions from `TarotAPI`. Preserve the existing `saveReading`, `loadReadings`, daily-draw, and offline fallback methods. Replace the unconditional final assignment with:

```javascript
if (typeof module === 'object' && module.exports) module.exports = TarotAPI;
if (typeof window !== 'undefined') window.TarotAPI = TarotAPI;
```

- [ ] **Step 4: Run API and existing JavaScript tests**

Run:

```powershell
node tests/test_api.js
node tests/test_daily_draw.js
node tests/test_interpret.js
```

Expected: all three scripts pass.

- [ ] **Step 5: Commit the API client**

```powershell
git add js/api.js tests/test_api.js
git commit -m "feat: add strict consultation browser API"
```

### Task 4: Build the serializable consultation draft and payload logic

**Files:**

- Create: `js/consultation_flow.js`
- Create: `tests/test_consultation_flow.js`

- [ ] **Step 1: Write failing pure-logic tests**

Create `tests/test_consultation_flow.js` with these initial assertions:

```javascript
'use strict';

const assert = require('assert');
const flow = require('../js/consultation_flow.js');

const deck = [
  { zh: '愚者', en: 'The Fool', file: 'fool.jpg' },
  { zh: '隐士', en: 'The Hermit', file: 'hermit.jpg' },
  { zh: '力量', en: 'Strength', file: 'strength.jpg' }
];
const general = {
  moduleType: 'general_reading',
  questionRequired: true,
  allowedSpreads: ['three_timeline', 'free'],
  defaultSpread: 'three_timeline'
};

const first = flow.createInitialDraft();
const second = flow.createInitialDraft();
assert.notStrictEqual(first, second);
assert.strictEqual(first.questionMode, 'none');
assert.strictEqual(first.inputMode, 'three_d');
assert.strictEqual(first.interpretationAction, 'none');

assert.deepStrictEqual(flow.searchDeck(deck, '隐', 12).map(card => card.cardId), [1]);
assert.deepStrictEqual(flow.searchDeck(deck, 'hermit', 12).map(card => card.cardId), [1]);
assert.deepStrictEqual(flow.searchDeck(deck, '2', 12).map(card => card.cardId), [2]);

const fixed = flow.getSlotPlan({ key: 'three_timeline', fixedCount: 3, slots: [
  { slot: 1, label: '过去' }, { slot: 2, label: '现在' }, { slot: 3, label: '未来' }
] }, 7);
assert.strictEqual(fixed.length, 3);
assert.strictEqual(flow.getSlotPlan({ key: 'free', fixedCount: null, slots: [] }, 4).length, 4);

const draft = {
  ...flow.createInitialDraft(),
  questionMode: 'module',
  moduleType: 'general_reading',
  userQuery: '我应该如何看待这次工作机会？',
  userContext: '目前稳定，但成长有限。',
  inputMode: 'manual',
  interpretationAction: 'now',
  templateKey: 'three_timeline',
  templateName: '三张牌时间线',
  cards: [
    { slot: 1, slotLabel: '过去', cardId: 0, isReversed: false },
    { slot: 2, slotLabel: '现在', cardId: 1, isReversed: true },
    { slot: 3, slotLabel: '未来', cardId: 2, isReversed: false }
  ]
};
assert.deepStrictEqual(flow.validateDraft(draft, general, { requireCards: true }), {});
assert.strictEqual(flow.chooseSaveOperation(draft), 'consultation');
const payload = flow.buildConsultationPayload(draft, deck);
assert.strictEqual(payload.inputMode, 'manual');
assert.strictEqual(payload.cards[1].imageFile, 'hermit.jpg');
assert.strictEqual(payload.cards[1].isReversed, true);

const noQuestion = { ...draft, questionMode: 'none', moduleType: null, userQuery: '' };
assert.strictEqual(flow.chooseSaveOperation(noQuestion), 'reading');
assert.strictEqual(flow.buildReadingPayload(noQuestion, deck).userQuery, undefined);

const duplicate = { ...draft, cards: [draft.cards[0], { ...draft.cards[1], cardId: 0 }] };
assert.strictEqual(flow.validateDraft(duplicate, general, { requireCards: true }).cards, '牌阵中不能重复选择同一张牌');

console.log('consultation flow logic tests passed');
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node tests/test_consultation_flow.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the pure draft functions**

Create `js/consultation_flow.js` as an IIFE/CommonJS module. Implement these exact data defaults and contracts:

```javascript
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ConsultationFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (root) {
    const PHASES = [
        'choosing_type', 'editing_details', 'choosing_spread_source',
        'choosing_interpretation', 'acquiring_cards', 'confirming',
        'saving', 'saved', 'generating', 'review_ready', 'review_saved'
    ];

    function createInitialDraft() {
        return {
            questionMode: 'none',
            moduleType: null,
            userQuery: '',
            userContext: '',
            modulePayload: {},
            templateKey: 'three_timeline',
            templateName: '三张牌 / Past Present Future',
            freeCount: 3,
            inputMode: 'three_d',
            interpretationAction: 'none',
            style: 'psychological',
            language: 'zh',
            spreadNumber: 0,
            cards: []
        };
    }

    function searchDeck(deck, query, limit = 12) {
        const text = String(query || '').trim().toLowerCase();
        if (!text) return [];
        const numeric = /^\d+$/.test(text) ? Number(text) : null;
        return (deck || []).map((card, cardId) => ({ ...card, cardId }))
            .filter(card => numeric !== null
                ? card.cardId === numeric
                : card.zh.includes(text) || card.en.toLowerCase().includes(text))
            .slice(0, Math.max(1, limit));
    }

    function getSlotPlan(template, freeCount = 3) {
        const count = Number.isFinite(template.fixedCount)
            ? template.fixedCount
            : Math.max(1, Math.min(10, Number(freeCount) || 3));
        return Array.from({ length: count }, (_, index) => {
            const slot = index + 1;
            const spec = (template.slots || [])[index];
            return { slot, slotLabel: spec ? spec.label : `Slot ${slot}` };
        });
    }

    function validateDraft(draft, moduleSpec, options = {}) {
        const errors = {};
        if (!['none', 'module'].includes(draft.questionMode)) errors.questionMode = '请选择咨询类型';
        if (!['manual', 'three_d'].includes(draft.inputMode)) errors.inputMode = '请选择牌面来源';
        if (!['now', 'later', 'none'].includes(draft.interpretationAction)) errors.interpretationAction = '请选择解读方式';
        if (draft.questionMode === 'module') {
            const query = String(draft.userQuery || '').trim();
            if (!moduleSpec || moduleSpec.moduleType !== draft.moduleType) errors.moduleType = '咨询模块不可用';
            else if (!moduleSpec.allowedSpreads.includes(draft.templateKey)) errors.templateKey = '该模块不支持这个牌阵';
            if (query.length < 4 || query.length > 500) errors.userQuery = '问题长度应为 4–500 字';
            if (String(draft.userContext || '').trim().length > 1000) errors.userContext = '背景不能超过 1000 字';
        }
        if (options.requireCards) {
            const cards = Array.isArray(draft.cards) ? draft.cards : [];
            if (!cards.length) errors.cards = '请完成全部牌位';
            else if (new Set(cards.map(card => card.cardId)).size !== cards.length) errors.cards = '牌阵中不能重复选择同一张牌';
            else if (cards.some(card => !Number.isInteger(card.cardId) || card.cardId < 0 || card.cardId > 77 || typeof card.isReversed !== 'boolean')) errors.cards = '牌面编号或正逆位无效';
        }
        return errors;
    }

    function materializeCards(cards, deck) {
        return cards.map(card => {
            const source = deck[card.cardId];
            if (!source) throw new Error(`Unknown cardId ${card.cardId}`);
            return {
                slot: card.slot,
                slotLabel: card.slotLabel || `Slot ${card.slot}`,
                cardId: card.cardId,
                zh: source.zh,
                en: source.en,
                imageFile: source.file,
                isReversed: card.isReversed
            };
        });
    }

    function buildReadingPayload(draft, deck) {
        return {
            kind: 'spread',
            spreadNumber: Number(draft.spreadNumber) || 0,
            templateKey: draft.templateKey,
            templateName: draft.templateName,
            cards: materializeCards(draft.cards, deck)
        };
    }

    function buildConsultationPayload(draft, deck) {
        return {
            ...buildReadingPayload(draft, deck),
            language: 'zh',
            moduleType: draft.moduleType,
            inputMode: draft.inputMode,
            userQuery: String(draft.userQuery || '').trim(),
            userContext: String(draft.userContext || '').trim(),
            modulePayload: draft.modulePayload || {}
        };
    }

    function chooseSaveOperation(draft) {
        return draft.questionMode === 'module' ? 'consultation' : 'reading';
    }

    function nextPhase(current, requested) {
        if (!PHASES.includes(current) || !PHASES.includes(requested)) throw new Error('Unknown consultation phase');
        return requested;
    }
```

Return all named functions plus the orchestration/browser functions added in later tasks.

- [ ] **Step 4: Run the pure-logic test and verify GREEN**

Run:

```powershell
node tests/test_consultation_flow.js
```

Expected: `consultation flow logic tests passed`.

- [ ] **Step 5: Commit the draft core**

```powershell
git add js/consultation_flow.js tests/test_consultation_flow.js
git commit -m "feat: add unified consultation draft model"
```

### Task 5: Add save, interpretation, and review orchestration

**Files:**

- Modify: `js/consultation_flow.js`
- Modify: `tests/test_consultation_flow.js`

- [ ] **Step 1: Append failing orchestration tests**

Append async tests to `tests/test_consultation_flow.js` and change its runner to await them:

```javascript
async function* successfulStream() {
  yield { chunk: '第一段' };
  yield { chunk: '第二段' };
  yield { done: true };
}

async function testOrchestration() {
  let consultations = 0;
  let readings = 0;
  const deps = {
    deck,
    api: {
      createConsultation: async payload => { consultations += 1; return { id: 7, readingId: 11, ...payload }; },
      createReading: async payload => { readings += 1; return { id: 12, ...payload }; },
      loadConsultation: async id => ({ id, interpretations: [{ id: 19, generation_status: 'complete', content: '第一段第二段' }] }),
      reviewInterpretation: async (id, payload) => ({ interpretationId: id, ...payload })
    },
    streamInterpretation: successfulStream
  };
  const saved = await flow.persistDraftCards(draft, draft.cards, deps);
  assert.deepStrictEqual({ consultationId: saved.consultationId, readingId: saved.readingId }, { consultationId: 7, readingId: 11 });
  assert.strictEqual(consultations, 1);
  assert.strictEqual(readings, 0);

  const chunks = [];
  const generated = await flow.runSavedInterpretation(saved, draft, deps, event => {
    if (event.chunk) chunks.push(event.chunk);
  });
  assert.strictEqual(generated.content, '第一段第二段');
  assert.strictEqual(generated.interpretation.id, 19);

  await assert.rejects(
    () => flow.submitReview(19, { verdict: 'edited', editedContent: '' }, deps),
    /editedContent/
  );
  const review = await flow.submitReview(19, { verdict: 'accepted', rating: 5, privacyConfirmed: true }, deps);
  assert.strictEqual(review.verdict, 'accepted');

  const noQuestionSaved = await flow.persistDraftCards(
    { ...draft, questionMode: 'none', moduleType: null, userQuery: '' },
    draft.cards,
    deps
  );
  assert.strictEqual(noQuestionSaved.consultationId, null);
  assert.strictEqual(noQuestionSaved.readingId, 12);
  assert.strictEqual(readings, 1);
}
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node tests/test_consultation_flow.js
```

Expected: missing `persistDraftCards`.

- [ ] **Step 3: Implement orchestration with dependency injection**

Add to `js/consultation_flow.js`:

```javascript
async function persistDraftCards(draft, cards, deps) {
    const working = { ...draft, cards: cards.map(card => ({ ...card })) };
    const operation = chooseSaveOperation(working);
    if (operation === 'consultation') {
        const created = await deps.api.createConsultation(buildConsultationPayload(working, deps.deck));
        return { consultationId: created.id, readingId: created.readingId, created, operation };
    }
    const created = await deps.api.createReading(buildReadingPayload(working, deps.deck));
    return { consultationId: null, readingId: created.id, created, operation };
}

async function runSavedInterpretation(saved, draft, deps, onEvent = () => {}, signal) {
    let content = '';
    let done = false;
    for await (const event of deps.streamInterpretation(saved.readingId, {
        style: draft.style,
        language: 'zh',
        signal
    })) {
        onEvent(event);
        if (event.chunk) content += event.chunk;
        if (event.error) {
            const error = new Error(event.message || event.error);
            error.code = event.error;
            throw error;
        }
        if (event.done) done = true;
    }
    if (!done) throw new Error('Interpretation stream ended before done');
    let interpretation = null;
    if (saved.consultationId !== null) {
        const detail = await deps.api.loadConsultation(saved.consultationId);
        interpretation = (detail.interpretations || []).find(item => item.generation_status === 'complete') || null;
    }
    return { content, done, interpretation };
}

async function submitReview(interpretationId, review, deps) {
    const verdicts = new Set(['accepted', 'needs_work', 'rejected', 'edited']);
    if (!verdicts.has(review.verdict)) throw new Error('Unsupported review verdict');
    if (review.verdict === 'edited' && !String(review.editedContent || '').trim()) {
        throw new Error('editedContent is required for edited verdict');
    }
    return deps.api.reviewInterpretation(interpretationId, {
        verdict: review.verdict,
        rating: review.rating || null,
        issueTags: Array.isArray(review.issueTags) ? review.issueTags : [],
        reviewNote: String(review.reviewNote || '').trim(),
        editedContent: String(review.editedContent || '').trim(),
        privacyConfirmed: review.privacyConfirmed === true
    });
}
```

- [ ] **Step 4: Run the orchestration tests**

Run:

```powershell
node tests/test_consultation_flow.js
```

Expected: pure and async orchestration assertions pass.

- [ ] **Step 5: Commit orchestration**

```powershell
git add js/consultation_flow.js tests/test_consultation_flow.js
git commit -m "feat: orchestrate consultation save and review"
```

### Task 6: Build the full-screen wizard and manual card editor

**Files:**

- Create: `css/consultation_flow.css`
- Modify: `Three.html`
- Modify: `js/consultation_flow.js`
- Modify: `tests/test_consultation_flow.js`

- [ ] **Step 1: Add failing static integration assertions**

Append to `tests/test_consultation_flow.js`:

```javascript
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'Three.html'), 'utf8');
assert(html.includes('id="consultation-flow"'));
assert(html.includes('role="dialog"'));
assert(html.includes('id="consultation-flow-mount"'));
assert(html.includes('css/consultation_flow.css'));
assert(html.includes('js/consultation_flow.js'));
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node tests/test_consultation_flow.js
```

Expected: the first missing-markup assertion fails.

- [ ] **Step 3: Add the dialog shell and feature references**

In `Three.html`, load `css/consultation_flow.css` before `css/responsive.css`, and add this dialog before `#interpret-overlay`:

```html
<section id="consultation-flow" class="consultation-flow" role="dialog"
         aria-modal="true" aria-labelledby="consultation-flow-title" hidden>
    <header class="consultation-flow-head">
        <div>
            <span class="status-kicker">New Consultation</span>
            <h2 id="consultation-flow-title" tabindex="-1">新咨询</h2>
        </div>
        <button id="consultation-flow-close" class="consultation-flow-close" type="button">关闭 / Close</button>
    </header>
    <nav id="consultation-flow-steps" class="consultation-flow-steps" aria-label="咨询步骤"></nav>
    <div id="consultation-flow-status" class="consultation-flow-status" role="status" aria-live="polite"></div>
    <main id="consultation-flow-mount" class="consultation-flow-mount"></main>
    <footer id="consultation-flow-actions" class="consultation-flow-actions"></footer>
</section>
```

Add a hidden summary inside `.current-spread-panel`:

```html
<div id="active-consultation-summary" class="active-consultation-summary" hidden></div>
```

Load `js/consultation_flow.js` after `js/spread_templates.js` and before `js/main.js`.

- [ ] **Step 4: Implement the browser controller**

Extend the module with controller-local state and the public browser surface:

```javascript
let draft = createInitialDraft();
let phase = 'choosing_type';
let modules = [];
let saved = null;
let generated = null;
let streamContent = '';
let mounted = false;
let returnFocus = null;
let abortController = null;

function isOpen() {
    const dialog = root.document && root.document.getElementById('consultation-flow');
    return Boolean(dialog && !dialog.hidden);
}

function hasActiveDraft() {
    return Boolean(draft && phase === 'acquiring_cards' && draft.inputMode === 'three_d');
}

function reset() {
    draft = createInitialDraft();
    phase = 'choosing_type';
    saved = null;
    generated = null;
    streamContent = '';
    render();
}

async function open() {
    const dialog = root.document.getElementById('consultation-flow');
    if (!dialog.hidden) return;
    returnFocus = root.document.activeElement;
    dialog.hidden = false;
    root.document.body.classList.add('consultation-flow-open');
    dialog.querySelector('#consultation-flow-title').focus?.();
    if (!modules.length && root.TarotAPI) {
        try { modules = await root.TarotAPI.loadConsultationModules(); }
        catch (error) { setStatus(error.message, true); }
    }
    render();
}

function close(force = false) {
    if (!force && ['saving', 'generating'].includes(phase) && !root.confirm('当前操作尚未完成，确定关闭吗？')) return false;
    if (abortController) abortController.abort();
    const dialog = root.document.getElementById('consultation-flow');
    dialog.hidden = true;
    root.document.body.classList.remove('consultation-flow-open');
    returnFocus?.focus?.();
    return true;
}

function mount() {
    if (mounted || !root.document) return;
    mounted = true;
    root.document.getElementById('consultation-flow-close').addEventListener('click', () => close());
    root.document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen()) close();
    });
    render();
}

function setStatus(message, isError = false) {
    const node = root.document.getElementById('consultation-flow-status');
    node.textContent = String(message || '');
    node.classList.toggle('is-error', isError);
}

function getBrowserDeck() {
    if (root.FULL_DECK) return root.FULL_DECK;
    if (typeof FULL_DECK !== 'undefined') return FULL_DECK;
    throw new Error('Tarot deck is unavailable');
}

function browserDeps() {
    return {
        deck: getBrowserDeck(),
        api: root.TarotAPI,
        streamInterpretation: root.AkashicInterpret.streamInterpretation
    };
}

async function afterSave() {
    if (draft.interpretationAction !== 'now') {
        phase = 'saved';
        render();
        return;
    }
    phase = 'generating';
    streamContent = '';
    abortController = new AbortController();
    render();
    try {
        generated = await runSavedInterpretation(
            saved,
            draft,
            browserDeps(),
            event => {
                if (event.chunk) streamContent += event.chunk;
                render();
            },
            abortController.signal
        );
        phase = saved.consultationId !== null && generated.interpretation
            ? 'review_ready'
            : 'saved';
        setStatus('解读完成', false);
    } catch (error) {
        phase = 'saved';
        setStatus(error.message, true);
    } finally {
        abortController = null;
        render();
    }
}

async function saveCurrentCards() {
    const moduleSpec = modules.find(item => item.moduleType === draft.moduleType) || null;
    const errors = validateDraft(draft, moduleSpec, { requireCards: true });
    if (Object.keys(errors).length) {
        setStatus(Object.values(errors)[0], true);
        return;
    }
    phase = 'saving';
    render();
    try {
        saved = await persistDraftCards(draft, draft.cards, browserDeps());
        root.lastSavedReadingId = saved.readingId;
        await afterSave();
    } catch (error) {
        phase = 'confirming';
        setStatus(error.message, true);
        render();
    }
}

function updateActiveSummary() {
    const node = root.document.getElementById('active-consultation-summary');
    if (!node) return;
    node.hidden = false;
    node.textContent = draft.questionMode === 'module'
        ? `普通咨询 · ${draft.templateName}`
        : `无特定问题 · ${draft.templateName}`;
}

function beginThreeD() {
    if (typeof root.startConsultationSpread !== 'function') {
        setStatus('3D 抽牌尚未就绪', true);
        return;
    }
    phase = 'acquiring_cards';
    root.SpreadTemplates.setActiveTemplate(draft.templateKey);
    updateActiveSummary();
    close(true);
    root.startConsultationSpread();
}
```

Implement `render()` as a phase switch. Each renderer must create DOM through an `el(tag, attrs, children)` helper and assign user data through `textContent`, not string interpolation into `innerHTML`:

```javascript
const renderers = {
    choosing_type: renderTypeStep,
    editing_details: renderDetailsStep,
    choosing_spread_source: renderSpreadSourceStep,
    choosing_interpretation: renderInterpretationStep,
    acquiring_cards: renderManualCardsStep,
    confirming: renderConfirmationStep,
    saving: renderBusyStep,
    saved: renderSavedStep,
    generating: renderGenerationStep,
    review_ready: renderReviewStep,
    review_saved: renderReviewSavedStep
};
```

Required controls and exact state effects:

- `renderTypeStep`: “无特定问题” sets `questionMode='none'`, `moduleType=null`; each fetched module sets `questionMode='module'`, `moduleType=module.moduleType`, and its default spread.
- `renderDetailsStep`: controlled `textarea` for query and context plus style select. No query controls for `none`.
- `renderSpreadSourceStep`: only buttons whose template keys are in the selected module's `allowedSpreads`; no-question uses all existing templates. It also selects `inputMode` and free count.
- `renderInterpretationStep`: selects `now`, `later`, or `none`. For manual input, next phase is `acquiring_cards`; for 3D, call `beginThreeD()`.
- `renderManualCardsStep`: create one editor per slot from `getSlotPlan()`, use `searchDeck(FULL_DECK, query)`, prevent choosing an already-used `cardId`, and show explicit upright/reversed buttons.
- `renderConfirmationStep`: show text nodes and card images; “保存并继续” invokes `saveCurrentCards()` once.
- `renderGenerationStep`: append SSE chunks to one `<article>` and expose an abort button.
- `renderReviewStep`: verdict, optional rating, issue tags, note, edited content, and conditional privacy checkbox; submit through `submitReview()`.

Add public exports: `mount`, `open`, `close`, `reset`, `isOpen`, `hasActiveDraft`, `getDraft: () => ({ ...draft })`, and `setDraftForTest(value)` only if `module.exports` is present. Do not expose DOM-only test hooks in the browser API.

- [ ] **Step 5: Add base feature CSS**

Create `css/consultation_flow.css` with a fixed overlay at `z-index: 320`, theme variables, grid layout, visible focus, 44px controls, manual-card grid, result/review panels, and `[hidden]` handling. Use these layout anchors:

```css
.consultation-flow {
    position: fixed;
    inset: 3% 4%;
    z-index: 320;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    overflow: hidden;
    padding: 22px;
    color: var(--ink-text);
    background: var(--panel-bg);
    border: 1px solid var(--panel-line);
    border-radius: 12px;
    box-shadow: 0 0 0 9999px color-mix(in oklch, var(--surface) 82%, transparent), 0 30px 90px rgba(0, 0, 0, 0.48);
    backdrop-filter: blur(28px) saturate(1.05);
}
.consultation-flow[hidden] { display: none !important; }
body.consultation-flow-open { overflow: hidden; }
.consultation-flow-mount { overflow: auto; min-height: 0; }
.consultation-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
.consultation-flow button, .consultation-flow input, .consultation-flow textarea, .consultation-flow select { min-height: 44px; font: inherit; }
.consultation-flow :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 6: Run the consultation and existing interpretation tests**

Run:

```powershell
node tests/test_consultation_flow.js
node tests/test_interpret.js
```

Expected: both scripts pass.

- [ ] **Step 7: Commit the manual wizard**

```powershell
git add Three.html js/consultation_flow.js css/consultation_flow.css tests/test_consultation_flow.js
git commit -m "feat: add unified consultation wizard"
```

### Task 7: Connect the wizard to the existing 3D reading lifecycle

**Files:**

- Modify: `js/main_ui_state.js`
- Modify: `tests/test_main_ui_state.js`
- Modify: `js/history.js`
- Modify: `js/main.js`
- Modify: `js/spread.js`
- Modify: `js/spread_templates.js`
- Modify: `tests/test_spread_templates.js`
- Modify: `tests/test_consultation_flow.js`

- [ ] **Step 1: Write failing primary-action and template-filter tests**

Change the IDLE assertion in `tests/test_main_ui_state.js` to:

```javascript
assert.deepStrictEqual(getPrimaryActionState('IDLE'), {
  label: '新咨询 / Consult',
  disabled: false,
  intent: 'OPEN_CONSULTATION'
});
```

Add to `tests/test_spread_templates.js`:

```javascript
assert.deepStrictEqual(
  require('../js/spread_templates.js').filterTemplates(['three_timeline', 'free']).map(item => item.key),
  ['three_timeline', 'free']
);
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node tests/test_main_ui_state.js
node tests/test_spread_templates.js
```

Expected: old intent/label mismatch and missing `filterTemplates`.

- [ ] **Step 3: Update primary state and template helper**

In `js/main_ui_state.js` return the new IDLE state exactly as asserted. In `js/spread_templates.js` add and export:

```javascript
function filterTemplates(allowedKeys) {
    const allowed = new Set(Array.isArray(allowedKeys) ? allowedKeys : []);
    return TEMPLATES.filter(template => allowed.has(template.key));
}
```

- [ ] **Step 4: Add a testable 3D persistence hook**

In `js/history.js`, extract and export this function:

```javascript
async function persistCapturedReading(spreadNumber, cards, meta, runtime = window) {
    if (runtime.ConsultationFlow && runtime.ConsultationFlow.hasActiveDraft()) {
        return runtime.ConsultationFlow.saveAcquiredCards(cards, { spreadNumber, ...meta });
    }
    if (!runtime.TarotAPI || cards.length === 0) return null;
    const created = await runtime.TarotAPI.saveReading(spreadNumber, { ...meta, spreadNumber, cards });
    return created ? { readingId: created.id, consultationId: null, created } : null;
}
```

Change `completeReadingHistory()` to call `persistCapturedReading()`, set `lastSavedReadingId` from `result.readingId`, and return the result. At the bottom add:

```javascript
if (typeof module === 'object' && module.exports) {
    module.exports = { persistCapturedReading };
}
```

Append a Node assertion to `tests/test_consultation_flow.js` that imports `persistCapturedReading`, supplies a fake active `ConsultationFlow`, and verifies legacy `TarotAPI.saveReading` is not called.

- [ ] **Step 5: Add the 3D bridge to ConsultationFlow**

Keep the `beginThreeD()` controller method from Task 6 and add this browser-facing completion method:

```javascript
async function saveAcquiredCards(cards, meta) {
    draft = { ...draft, cards: cards.map(card => ({ ...card })), spreadNumber: meta.spreadNumber || 0 };
    phase = 'saving';
    await open();
    render();
    try {
        saved = await persistDraftCards(draft, draft.cards, browserDeps());
        root.lastSavedReadingId = saved.readingId;
        await afterSave();
        return saved;
    } catch (error) {
        phase = 'confirming';
        setStatus(error.message, true);
        render();
        throw error;
    }
}
```

Export `saveAcquiredCards` in the browser API. The already-defined `browserDeps()` supplies the deck, `root.TarotAPI`, and `root.AkashicInterpret.streamInterpretation`.

- [ ] **Step 6: Wire main and gesture entry without breaking active-state actions**

In `js/main.js`:

```javascript
window.startConsultationSpread = function startConsultationSpread() {
    startSpread(idlePinchedCards.slice());
};
```

Change only the primary-button IDLE branch:

```javascript
if (action === 'OPEN_CONSULTATION') {
    if (window.ConsultationFlow) ConsultationFlow.open();
}
```

Call `ConsultationFlow.mount()` in `init()` after `SpreadTemplates.bindTemplateSelector()`.

In `js/spread.js`, change idle OPEN handling so it opens the consultation flow instead of immediately calling `startSpread()` when the flow is available:

```javascript
if (SpreadFlow.shouldBeginEntering(spreadState, currentGesture, now, gestureDebounce)) {
    gestureDebounce = now + 1800;
    if (window.ConsultationFlow) {
        ConsultationFlow.open();
        return;
    }
    startSpread(SpreadFlow.createEnteringSnapshot(idlePinchedCards));
    return;
}
```

When the final card is confirmed, keep the legacy spread prompt but delay it until `completeReadingHistory()` settles:

```javascript
const savePromise = completeReadingHistory(spreadCount);
Promise.resolve(savePromise).finally(() => setTimeout(() => showSpreadPrompt(), 800));
```

- [ ] **Step 7: Run focused 3D integration tests**

Run:

```powershell
node tests/test_main_ui_state.js
node tests/test_spread_templates.js
node tests/test_consultation_flow.js
node tests/test_reading_orientation.js
node tests/test_mouse_interaction.js
```

Expected: all scripts pass.

- [ ] **Step 8: Commit the 3D lifecycle integration**

```powershell
git add js/main_ui_state.js tests/test_main_ui_state.js js/history.js js/main.js js/spread.js js/spread_templates.js tests/test_spread_templates.js js/consultation_flow.js tests/test_consultation_flow.js
git commit -m "feat: route 3d readings through consultation flow"
```

### Task 8: Finish review UX, accessibility, responsive layout, and documentation

**Files:**

- Modify: `js/consultation_flow.js`
- Modify: `css/consultation_flow.css`
- Modify: `css/responsive.css`
- Modify: `tests/test_consultation_flow.js`
- Modify: `tests/test_server.py`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Add failing review and record-graph assertions**

In `tests/test_consultation_flow.js`, add assertions for exported `validateReview()`:

```javascript
assert.strictEqual(flow.validateReview({ verdict: 'edited', editedContent: '' }).editedContent, '编辑后的理想答案不能为空');
assert.deepStrictEqual(flow.validateReview({ verdict: 'accepted', editedContent: '' }), {});
```

Extend `test_put_interpretation_review` in `tests/test_server.py` to assert the consultation detail also preserves `reading.cards`, `input_snapshot`, and `review.privacyConfirmed`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node tests/test_consultation_flow.js
python -m unittest tests.test_server.TarotServerTest.test_put_interpretation_review -v
```

Expected: missing `validateReview` and/or missing snapshot fixture assertions until the fixture is completed.

- [ ] **Step 3: Centralize review validation and finish accessible rendering**

Add and export:

```javascript
function validateReview(review) {
    const errors = {};
    if (!['accepted', 'needs_work', 'rejected', 'edited'].includes(review.verdict)) errors.verdict = '请选择审核结论';
    if (review.verdict === 'edited' && !String(review.editedContent || '').trim()) errors.editedContent = '编辑后的理想答案不能为空';
    if (review.rating !== null && review.rating !== undefined && (Number(review.rating) < 1 || Number(review.rating) > 5)) errors.rating = '评分应为 1–5';
    return errors;
}
```

Make `submitReview()` use `validateReview()`. In the DOM controller:

- Each field gets a persistent `<label for>`.
- Error text gets an ID and the control receives `aria-describedby`.
- Privacy confirmation only renders for `accepted` and `edited` when `saved.consultationId !== null`.
- No-question generation renders the answer but no training-candidate review controls.
- Focus moves to the result heading on generation completion and to the saved-status message on review completion.
- The step navigation marks current step with `aria-current="step"`.
- Add a focus trap for Tab/Shift+Tab while the dialog is open.

- [ ] **Step 4: Add responsive rules**

In `css/consultation_flow.css`, use a three-column desktop content grid and semantic status colors. In `css/responsive.css` add:

```css
@media (max-width: 820px) {
    .consultation-flow { inset: 0; border-radius: 0; padding: 14px; }
    .consultation-flow-layout { grid-template-columns: 1fr; }
    .consultation-flow-actions { position: sticky; bottom: 0; background: var(--panel-bg); }
}

@media (max-width: 420px) {
    .consultation-flow { padding: 10px; }
    .consultation-card-grid { grid-template-columns: 1fr; }
    .consultation-flow-steps { overflow-x: auto; }
    .consultation-choice-grid { grid-template-columns: 1fr; }
}
```

Verify no feature rule overrides the existing topbar, 3D canvas, or interpret overlay outside `body.consultation-flow-open`.

- [ ] **Step 5: Update user and architecture documentation**

In `README.md`, document:

- New consultation-first flow.
- No-question versus general consultation behavior.
- 3D/manual acquisition.
- Now/later/save-only actions.
- Review eligibility and the fact that future modules are not enabled yet.

In `ARCHITECTURE.md`, add this boundary:

```text
Consultation module (intent + allowed spreads)
        ×
Acquisition mode (three_d | manual)
        ↓
reading + cards [+ consultation]
        ↓
optional interpretation → optional review
```

Document `GET /api/consultation-modules` and why no-question readings have no consultation row.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node tests/test_consultation_flow.js
python -m unittest tests.test_consultation_modules tests.test_consultation_service tests.test_server -v
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit UX and docs**

```powershell
git add js/consultation_flow.js css/consultation_flow.css css/responsive.css tests/test_consultation_flow.js tests/test_server.py README.md ARCHITECTURE.md
git commit -m "feat: complete consultation review experience"
```

### Task 9: Run full automated and real-browser verification

**Files:**

- Modify only files required by defects found during verification.

- [ ] **Step 1: Run syntax checks**

```powershell
python -m py_compile server.py consultation_service.py consultation_modules.py interpret_service.py
```

Expected: exit code 0.

- [ ] **Step 2: Run the full Python suite**

```powershell
python -m unittest discover -s tests -v
```

Expected: all tests pass with zero failures; the model transports remain mocked.

- [ ] **Step 3: Run every JavaScript test**

```powershell
Get-ChildItem tests -Filter 'test_*.js' | Sort-Object Name | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "JavaScript test failed: $($_.Name)" } }
```

Expected: every script passes, including `test_api.js` and `test_consultation_flow.js`.

- [ ] **Step 4: Start a hidden local server for browser checks**

Run from the feature worktree:

```powershell
Start-Process python -ArgumentList 'server.py' -WorkingDirectory 'D:\taluo\.worktrees\unified-consultation-flow' -WindowStyle Hidden
```

Verify `http://localhost:8080/api/health` returns `{"ok":true,"database":"ready"}` before opening the UI.

- [ ] **Step 5: Perform desktop browser acceptance**

Use the computer-control/browser tooling with `http://localhost:8080/Three.html?control=mouse` and verify, in order:

1. “新咨询” opens the full-screen dialog.
2. General consultation accepts question/background, manual source, three-card spread, and now action.
3. Search finds cards by Chinese, English, and number; duplicate selection is blocked; reversed card is explicit.
4. Confirmation shows all fields; save creates a consultation.
5. If Ollama is available, SSE streams and review saves; if unavailable, the saved state, clear error, and retry path are visible.
6. A no-question 3D flow saves a reading without a consultation.
7. A general 3D flow keeps the draft summary visible and saves through `/api/consultations`.
8. Theme toggle, recent history, old interpret button, mouse controls, and return-to-idle still work after closing the dialog.

- [ ] **Step 6: Perform narrow-screen acceptance**

Resize/emulate approximately 390 × 844 and verify:

- No horizontal page overflow.
- Wizard is single-column.
- Main action remains visible and tappable.
- Manual card search results and orientation buttons remain usable.
- Dialog can close and returns focus to the trigger.

- [ ] **Step 7: Fix any browser defects with a failing automated regression first**

For each functional defect, add a focused Python/Node test that fails for the observed reason, implement the smallest fix, and rerun that test. For a CSS-only visual defect, record the exact selector/property change and repeat both desktop and narrow checks.

- [ ] **Step 8: Stop the verification server and inspect the final diff**

Stop only the server process started in Step 4. Then run:

```powershell
git status --short
git diff --check
git diff --stat main...HEAD
```

Expected: only files listed in this plan plus regression files required by browser defects are changed; worktree is otherwise clean after commits.

- [ ] **Step 9: Commit verification fixes if any**

If Step 7 changed files:

```powershell
git add consultation_modules.py consultation_service.py server.py Three.html js/api.js js/consultation_flow.js js/history.js js/main.js js/main_ui_state.js js/spread.js js/spread_templates.js css/consultation_flow.css css/responsive.css tests/test_api.js tests/test_consultation_flow.js tests/test_consultation_modules.py tests/test_consultation_service.py tests/test_main_ui_state.js tests/test_server.py tests/test_spread_templates.js README.md ARCHITECTURE.md
git commit -m "fix: address consultation flow acceptance findings"
```

If no files changed, do not create an empty commit.

## Completion checkpoint

Stage A is complete when a user chooses intent before cards, uses either 3D or manual acquisition, saves either a reading or consultation without duplicated identities, optionally generates an interpretation, reviews eligible question-based answers, and can complete the same flow on desktop and narrow screens without regressing existing tarot features. `choice_compare` and `symbolic_message` must be addable through the registry in their own plans without changing this state machine.
