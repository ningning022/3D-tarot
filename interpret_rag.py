"""
Vector RAG over the tarot meaning corpus.

What this module owns
---------------------
1. Loading the canonical corpus from ``data/tarot_corpus.json``.
2. Embedding each corpus entry through Ollama's ``nomic-embed-text`` and
   persisting the 768-dim float vectors as SQLite BLOBs in the
   ``corpus_embeddings`` table.
3. Retrieving the top-k most relevant entries for a given (card_id,
   orientation, optional question text) combination using cosine
   similarity over the on-disk vectors.

Design choices
--------------
- **No new pip deps.** The transport is stdlib ``urllib``. Vector math
  uses ``numpy`` when present (the conda env we already rely on ships
  with it) and falls back to a pure-Python dot product otherwise so the
  module stays importable in any minimal Python install.
- **Two-stage filter.** Retrieval first restricts to the exact
  ``(card_id, orientation)`` slice of the corpus, then ranks within
  those entries by cosine similarity with the user's question. This
  guarantees the model receives meanings for the *actual* cards in the
  spread, while letting the question steer the angle (career vs
  relationship vs growth, etc).
- **Embedding cache keyed by corpus_hash + entry_hash.** If the corpus
  file changes, the cache key changes and we re-embed. Otherwise
  startup is instant (SQLite read only).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import sqlite3
import struct
import urllib.error
import urllib.request
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:  # numpy is optional but speeds retrieval ~30× for 156 entries
    import numpy as np  # type: ignore
    _HAS_NUMPY = True
except ImportError:  # pragma: no cover - exercised in stdlib-only envs
    _HAS_NUMPY = False


log = logging.getLogger("interpret_rag")


# ── Defaults & constants ──────────────────────────────────────────

DEFAULT_EMBED_MODEL = "nomic-embed-text"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
EMBED_DIM = 768  # nomic-embed-text outputs 768 floats
EMBED_REQUEST_TIMEOUT_S = 30
DEFAULT_CORPUS_PATH = Path(__file__).resolve().parent / "data" / "tarot_corpus.json"


# ── Errors ────────────────────────────────────────────────────────


class RagError(Exception):
    """Base class for the RAG subsystem."""

    code = "rag_error"


class EmbedBackendDown(RagError):
    code = "embed_backend_down"


class EmbedModelMissing(RagError):
    code = "embed_model_missing"


# ── Data types ────────────────────────────────────────────────────


@dataclass(frozen=True)
class CorpusEntry:
    card_id: int
    zh: str
    en: str
    orientation: str  # 'upright' | 'reversed'
    themes: list[str]
    imagery: str
    situations: dict[str, str]
    keywords: list[str]

    @property
    def entry_key(self) -> str:
        """Stable identifier — survives reordering of the JSON."""
        return f"{self.card_id}:{self.orientation}"

    def embeddable_text(self) -> str:
        """Concatenated text fed to the embedder. Designed so the same
        entry produces a deterministic embedding regardless of insertion
        order in the source JSON.
        """
        parts = [
            f"{self.zh} ({self.en}) {self.orientation}",
            "themes: " + ", ".join(self.themes),
            "imagery: " + self.imagery,
        ]
        for slot, text in self.situations.items():
            parts.append(f"{slot}: {text}")
        parts.append("keywords: " + ", ".join(self.keywords))
        return "\n".join(parts)


@dataclass(frozen=True)
class RetrievedChunk:
    entry: CorpusEntry
    score: float


# ── Corpus loader ─────────────────────────────────────────────────


def load_corpus(path: Path = DEFAULT_CORPUS_PATH) -> list[CorpusEntry]:
    """Load and validate the canonical corpus JSON."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise RagError("corpus JSON must be a list")
    entries: list[CorpusEntry] = []
    for row in raw:
        try:
            entries.append(
                CorpusEntry(
                    card_id=int(row["card_id"]),
                    zh=str(row["zh"]),
                    en=str(row["en"]),
                    orientation=str(row["orientation"]),
                    themes=list(row.get("themes") or []),
                    imagery=str(row.get("imagery") or ""),
                    situations=dict(row.get("situations") or {}),
                    keywords=list(row.get("keywords") or []),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise RagError(f"invalid corpus row: {row!r}") from exc
    return entries


def corpus_signature(entries: Iterable[CorpusEntry]) -> str:
    """Stable hash of the corpus content. Used to invalidate the
    embeddings cache if the corpus is regenerated.
    """
    blob = json.dumps(
        [
            [
                e.card_id, e.orientation, e.zh, e.en,
                e.imagery, e.themes, e.situations, e.keywords,
            ]
            for e in entries
        ],
        ensure_ascii=False, sort_keys=False,
    ).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


# ── Persistence schema ────────────────────────────────────────────


MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS corpus_embeddings (
    entry_key   TEXT NOT NULL,
    model       TEXT NOT NULL,
    corpus_sig  TEXT NOT NULL,
    dim         INTEGER NOT NULL,
    vector      BLOB NOT NULL,
    text_hash   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (entry_key, model)
);
CREATE INDEX IF NOT EXISTS idx_corpus_embeddings_sig
    ON corpus_embeddings(corpus_sig);
"""


def migrate(conn: sqlite3.Connection) -> None:
    """Idempotent schema setup. Called from server.py boot."""
    with conn:
        conn.executescript(MIGRATION_SQL)


# ── Embedding transport ───────────────────────────────────────────


def _post_embed(text: str, *, model: str, url: str) -> list[float]:
    """POST to Ollama's /api/embed. Returns the 768-dim vector."""
    body = json.dumps({"model": model, "input": text}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{url.rstrip('/')}/api/embed", data=body, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=EMBED_REQUEST_TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, ConnectionError, OSError) as exc:
        raise EmbedBackendDown(f"embed request failed: {exc}") from exc

    embeddings = payload.get("embeddings")
    if embeddings and isinstance(embeddings, list):
        vec = embeddings[0]
    else:
        vec = payload.get("embedding") or []

    if not vec:
        msg = payload.get("error") or "no embedding in response"
        if "model" in str(msg).lower() and "not found" in str(msg).lower():
            raise EmbedModelMissing(str(msg))
        raise RagError(f"empty embedding response: {payload}")

    if len(vec) != EMBED_DIM:
        log.warning("Embedding has dim=%d, expected %d", len(vec), EMBED_DIM)
    return [float(x) for x in vec]


def _pack_vector(vec: list[float]) -> bytes:
    """float32 little-endian, fixed-length — matches NumPy's default
    so unpack works whether or not NumPy is installed."""
    return struct.pack(f"<{len(vec)}f", *vec)


def _unpack_vector(blob: bytes, dim: int) -> list[float]:
    return list(struct.unpack(f"<{dim}f", blob))


# ── Build / refresh the embedding index ──────────────────────────


def build_index(
    conn: sqlite3.Connection,
    entries: list[CorpusEntry] | None = None,
    *,
    model: str = DEFAULT_EMBED_MODEL,
    ollama_url: str = DEFAULT_OLLAMA_URL,
    force: bool = False,
) -> dict:
    """Ensure every corpus entry has an embedding row.

    Returns
    -------
    dict with keys ``corpus_sig``, ``model``, ``total``, ``embedded``,
    ``skipped`` — useful for /api/interpret/rag-status.
    """
    from datetime import datetime, timezone

    if entries is None:
        entries = load_corpus()
    sig = corpus_signature(entries)

    if not force:
        # Check whether the current sig already has all entries embedded
        cur = conn.execute(
            "SELECT COUNT(*) FROM corpus_embeddings WHERE model = ? AND corpus_sig = ?",
            (model, sig),
        )
        already = cur.fetchone()[0]
        if already == len(entries):
            return {"corpus_sig": sig, "model": model, "total": len(entries),
                    "embedded": 0, "skipped": already}

    embedded = 0
    skipped = 0
    for entry in entries:
        text = entry.embeddable_text()
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        if not force:
            cur = conn.execute(
                """SELECT 1 FROM corpus_embeddings
                   WHERE entry_key = ? AND model = ? AND corpus_sig = ? AND text_hash = ?""",
                (entry.entry_key, model, sig, text_hash),
            )
            if cur.fetchone():
                skipped += 1
                continue

        vec = _post_embed(text, model=model, url=ollama_url)
        with conn:
            conn.execute(
                """INSERT OR REPLACE INTO corpus_embeddings
                       (entry_key, model, corpus_sig, dim, vector, text_hash, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    entry.entry_key, model, sig, len(vec),
                    _pack_vector(vec), text_hash,
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                ),
            )
        embedded += 1

    return {"corpus_sig": sig, "model": model, "total": len(entries),
            "embedded": embedded, "skipped": skipped}


# ── Retrieval ─────────────────────────────────────────────────────


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity. Uses NumPy if available, otherwise stdlib.
    Returns a scalar in roughly [-1, 1]; 1.0 = identical direction.
    """
    if _HAS_NUMPY:
        va = np.asarray(a, dtype=np.float32)
        vb = np.asarray(b, dtype=np.float32)
        denom = float(np.linalg.norm(va) * np.linalg.norm(vb)) or 1e-12
        return float(np.dot(va, vb)) / denom
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-12
    nb = math.sqrt(sum(y * y for y in b)) or 1e-12
    return dot / (na * nb)


def fetch_entry_vectors(
    conn: sqlite3.Connection,
    entry_keys: list[str],
    *,
    model: str = DEFAULT_EMBED_MODEL,
) -> dict[str, list[float]]:
    """Return {entry_key: vector} for the requested keys. Missing keys
    are silently omitted — caller decides how to handle (degraded mode
    or build_index first)."""
    if not entry_keys:
        return {}
    placeholders = ",".join("?" * len(entry_keys))
    rows = conn.execute(
        f"""SELECT entry_key, dim, vector
            FROM corpus_embeddings
            WHERE model = ? AND entry_key IN ({placeholders})""",
        (model, *entry_keys),
    ).fetchall()
    return {row[0]: _unpack_vector(row[2], row[1]) for row in rows}


def retrieve_for_cards(
    conn: sqlite3.Connection,
    *,
    cards: list[dict],
    question: str | None = None,
    model: str = DEFAULT_EMBED_MODEL,
    ollama_url: str = DEFAULT_OLLAMA_URL,
    top_k_per_card: int = 1,
) -> list[RetrievedChunk]:
    """Return the most relevant corpus entries for the given spread.

    Logic:
      1. Filter the corpus to the exact (card_id, orientation) entries
         present in the spread. Each card is guaranteed at least one
         matching corpus entry (since we ship 78 × 2 = 156).
      2. If the user supplied a ``question``, embed it once and rank
         per-card matches by cosine similarity against the question
         vector. Otherwise we return the single canonical entry for
         each card (top_k_per_card=1) without any embedder call.

    The two-stage filter (deterministic card-match first, then
    embedding-driven re-rank) keeps retrieval cheap even when the
    corpus grows — we never embed-search across the whole 156, only
    the 3-10 entries that match the spread.
    """
    if not cards:
        return []
    corpus = load_corpus()
    by_key: dict[str, CorpusEntry] = {e.entry_key: e for e in corpus}

    # Build the per-card candidate set. For 3-card spreads this is just
    # 3 entries — no embedder call needed in the no-question case.
    candidates: list[CorpusEntry] = []
    for card in cards:
        raw_cid = card.get("card_id", card.get("cardId"))
        if raw_cid is None:
            continue
        try:
            cid = int(raw_cid)
        except (TypeError, ValueError):
            continue
        is_reversed = bool(card.get("is_reversed", card.get("isReversed", False)))
        orient = "reversed" if is_reversed else "upright"
        entry = by_key.get(f"{cid}:{orient}")
        if entry is not None:
            candidates.append(entry)

    if not candidates:
        return []

    # No question → return canonical entries in spread order.
    if not (question and question.strip()):
        return [RetrievedChunk(entry=e, score=1.0) for e in candidates]

    # Question supplied → rank within candidates.
    vectors = fetch_entry_vectors(conn, [c.entry_key for c in candidates], model=model)
    if not vectors:
        log.info("retrieve_for_cards: no embeddings yet, returning canonical order")
        return [RetrievedChunk(entry=e, score=1.0) for e in candidates]

    q_vec = _post_embed(question, model=model, url=ollama_url)
    scored: list[RetrievedChunk] = []
    for entry in candidates:
        vec = vectors.get(entry.entry_key)
        if vec is None:
            scored.append(RetrievedChunk(entry=entry, score=0.0))
            continue
        scored.append(RetrievedChunk(entry=entry, score=_cosine(q_vec, vec)))

    # IMPORTANT: do NOT sort by relevance. Spread order carries narrative
    # meaning (past/present/future, Celtic cross slot positions) that the
    # LLM uses as implicit context. Reordering the reference block by
    # cosine score would put the chunks in a different sequence from the
    # card list elsewhere in the prompt, biasing attention toward the
    # "most relevant" card and dissolving the spread's temporal/structural
    # semantics.
    #
    # Score is still recorded per-chunk so traces, telemetry, and any
    # future top-k filter can read relevance — the prompt just shows the
    # chunks in slot order. See evaluation note in ARCHITECTURE §10.
    if top_k_per_card != 1:
        # Future-proofing — for now we never collect more than 1 per
        # card since we only have 1 entry per (card, orientation).
        log.debug("top_k_per_card=%d requested; only 1 entry per key exists", top_k_per_card)
    return scored


# ── Status helper for the /api/interpret/rag-status endpoint ───────


def rag_status(
    conn: sqlite3.Connection,
    *,
    model: str = DEFAULT_EMBED_MODEL,
    ollama_url: str = DEFAULT_OLLAMA_URL,
) -> dict:
    """Snapshot for the admin UI: is the index built? Is the embed
    model installed? How fresh is the cache vs the on-disk corpus?
    """
    entries = load_corpus()
    sig = corpus_signature(entries)
    cur = conn.execute(
        "SELECT COUNT(*) FROM corpus_embeddings WHERE model = ? AND corpus_sig = ?",
        (model, sig),
    )
    indexed = cur.fetchone()[0]

    # Probe whether the embed model is installed in Ollama
    model_installed = False
    embed_backend = "down"
    try:
        with urllib.request.urlopen(
            f"{ollama_url.rstrip('/')}/api/tags", timeout=2
        ) as r:
            tags = json.loads(r.read().decode("utf-8"))
        embed_backend = "ready"
        model_installed = any(m.get("name", "").startswith(model) for m in tags.get("models", []))
    except (urllib.error.URLError, ConnectionError, OSError):
        pass

    return {
        "corpus_total": len(entries),
        "corpus_sig": sig,
        "indexed": indexed,
        "model": model,
        "model_installed": model_installed,
        "embed_backend": embed_backend,
        "ready": indexed == len(entries) and model_installed and embed_backend == "ready",
    }
