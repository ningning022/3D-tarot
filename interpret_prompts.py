"""
Prompts and few-shot examples for the tarot interpretation agent.

Kept as a separate module so the prompt content (the part that gets iterated
on most often) lives apart from the transport / persistence logic.

Each style is a fragment appended to the base system prompt. The base
prompt establishes the role, the format contract, and the ban list. The
style fragment shapes voice and depth.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StyleSpec:
    key: str
    label_zh: str
    label_en: str
    overlay_zh: str
    overlay_en: str


# ── Base system prompts ────────────────────────────────────────
# Establishes role + format + ban list. Style overlays append voice/depth.

BASE_SYSTEM_ZH = """你是一位精通 Rider-Waite 塔罗体系的解读师，文笔克制，不说套话。

【任务】根据用户给出的『牌阵 / 位置 / 牌 / 正逆位』组合，写一段 120-220 字的中文解读。每张牌的位置含义都要落到具体，避免空泛。

【禁止】
- 不要说『重要的是』『让我们一起探索』『作为 AI』『需要注意的是』
- 不要分点列表
- 不要在结尾加号召或祝福
- 不要重复牌名作为段落开头

【格式】只输出解读正文，无标题、无前缀、无引号。"""

BASE_SYSTEM_EN = """You are a tarot reader fluent in the Rider-Waite system, with a sparse, deliberate prose style.

[Task] Given a structured input of `spread / slot / card / orientation`, write a 120-220 word English interpretation. Anchor each card to its slot meaning; avoid generic statements.

[Forbidden]
- No "It is important to remember", "Let us explore together", "As an AI", "Note that"
- No bullet lists
- No closing call-to-action or blessing
- Do not open a paragraph by repeating the card name

[Format] Output the interpretation prose only — no title, no prefix, no quote marks."""


# ── Style overlays ────────────────────────────────────────────

STYLES: dict[str, StyleSpec] = {
    "traditional": StyleSpec(
        key="traditional",
        label_zh="经典 / Traditional",
        label_en="Traditional",
        overlay_zh="""

【风格】Rider-Waite 经典教科书风格。引用牌面元素（如月亮、河流、阴影、塔楼）来支撑判断。语气稳重、不口语化。""",
        overlay_en="""

[Style] Traditional Rider-Waite textbook voice. Reference card imagery (the moon, the river, the shadows, the tower) to ground claims. Steady, formal tone.""",
    ),
    "intuitive": StyleSpec(
        key="intuitive",
        label_zh="直觉 / Intuitive",
        label_en="Intuitive",
        overlay_zh="""

【风格】直觉派，短句多，节奏感强。把牌当作内心当下状态的镜子，不教学也不解释牌面。读起来更像一首小诗。""",
        overlay_en="""

[Style] Intuitive voice — short sentences, rhythmic. Treat each card as a mirror to the querent's current inner state. Don't teach or explain imagery. Read like a small poem.""",
    ),
    "psychological": StyleSpec(
        key="psychological",
        label_zh="心理 / Psychological",
        label_en="Psychological",
        overlay_zh="""

【风格】荣格心理学视角。把牌读作原型（archetype）与潜意识的映射。可以提『阴影』『阿尼玛』『个体化』这类术语，但每用一个都要落地到具体情境。""",
        overlay_en="""

[Style] Jungian psychological lens. Read each card as an archetype and an unconscious mirror. You may use terms like *shadow*, *anima*, *individuation*, but ground each in a concrete situation.""",
    ),
}

DEFAULT_STYLE = "traditional"


# ── Few-shot anchors ──────────────────────────────────────────
# A single hand-curated example per language. Goal: lock the model into
# the voice and length. More than one example bloats prompt tokens and
# leads to copy-paste outputs on 7B-class models.

FEW_SHOT_ZH = [
    {
        "role": "user",
        "content": "牌阵：三张牌时间线\n位置：过去\n牌：隐士 (The Hermit)\n正逆位：正位",
    },
    {
        "role": "assistant",
        "content": (
            "过去你曾选择独处，像隐士那样把灯笼朝向内心。那不是逃避，"
            "而是必须的暂停——在喧嚣里你听不见自己的声音。这段沉默期"
            "为现在的清醒打下了底，让你后来面对选择时不再向外求助，"
            "也不再害怕一个人坐着。隐士的山顶不是终点，是观望，是确认"
            "你愿意往哪条路走，再下来。"
        ),
    },
]

FEW_SHOT_EN = [
    {
        "role": "user",
        "content": (
            "Spread: Three-card timeline\n"
            "Slot: Past\n"
            "Card: The Hermit\n"
            "Orientation: Upright"
        ),
    },
    {
        "role": "assistant",
        "content": (
            "In the past you chose to withdraw — like the Hermit, you held "
            "the lantern inward. That was not avoidance; it was the pause "
            "you needed. The noise around you had drowned out your own "
            "voice, and only by stepping back did you hear it again. That "
            "silence is the foundation on which your present clarity now "
            "stands. The mountain you climbed wasn't an end. It was a "
            "vantage, a place from which you decided which road to walk back down."
        ),
    },
]


# ── Prompt builder ────────────────────────────────────────────


def build_messages(
    cards: list[dict],
    template_name: str,
    *,
    language: str = "zh",
    style: str = DEFAULT_STYLE,
    question: str | None = None,
    user_context: str | None = None,
    retrieved_chunks: list[dict] | None = None,
) -> list[dict]:
    """Compose the full message array sent to the LLM.

    Parameters
    ----------
    cards : list of {slot, slot_label, zh, en, is_reversed}
        The cards in the spread, in slot order.
    template_name : str
        Display name of the spread template (used in the user prompt).
    language : "zh" | "en"
        Output language; selects system prompt + few-shot anchor.
    style : key into STYLES
        Voice / depth overlay.
    question : optional str
        The user's spoken question. When supplied, the model is asked
        to answer it specifically through the cards.
    retrieved_chunks : optional list of {zh, en, orientation, imagery,
        situations: {career, relationship, health, growth}, keywords}
        RAG-retrieved corpus entries. Injected as a "参考资料" block so
        the model has authoritative meanings for each card without
        having to recall them from training data.

    Returns
    -------
    list of {role, content} dicts ready for Ollama / OpenRouter chat API.
    """
    if language not in ("zh", "en"):
        raise ValueError(f"language must be 'zh' or 'en', got {language!r}")
    if style not in STYLES:
        raise ValueError(f"unknown style {style!r}; known: {list(STYLES)}")

    base = BASE_SYSTEM_ZH if language == "zh" else BASE_SYSTEM_EN
    overlay = STYLES[style].overlay_zh if language == "zh" else STYLES[style].overlay_en
    system_content = base + overlay

    few_shot = FEW_SHOT_ZH if language == "zh" else FEW_SHOT_EN

    user_content = _format_user_prompt(
        cards, template_name,
        language=language,
        question=question,
        user_context=user_context,
        retrieved_chunks=retrieved_chunks,
    )

    return [
        {"role": "system", "content": system_content},
        *few_shot,
        {"role": "user", "content": user_content},
    ]


def _format_retrieved_block(retrieved_chunks: list[dict], *, language: str) -> str:
    """Render the RAG-retrieved corpus entries as a reference block."""
    if not retrieved_chunks:
        return ""
    if language == "zh":
        lines = ["【参考资料 — 与本次牌阵对应的牌义】"]
        for chunk in retrieved_chunks:
            zh = chunk.get("zh", "?")
            en = chunk.get("en", "")
            orient = "逆位" if chunk.get("orientation") == "reversed" else "正位"
            imagery = chunk.get("imagery", "")
            sits = chunk.get("situations") or {}
            line = f"\n- {zh} ({en}) · {orient}"
            if imagery:
                line += f"\n  画面：{imagery}"
            for slot, txt in sits.items():
                if txt:
                    line += f"\n  {slot}: {txt}"
            lines.append(line)
        lines.append("\n【参考资料结束】请把上述要点融入你的解读，不要逐项罗列。")
        return "\n".join(lines)
    # English
    lines = ["[Reference — canonical meanings for the cards in this spread]"]
    for chunk in retrieved_chunks:
        en = chunk.get("en", "?")
        orient = "Reversed" if chunk.get("orientation") == "reversed" else "Upright"
        imagery = chunk.get("imagery", "")
        sits = chunk.get("situations") or {}
        line = f"\n- {en} · {orient}"
        if imagery:
            line += f"\n  Imagery: {imagery}"
        for slot, txt in sits.items():
            if txt:
                line += f"\n  {slot}: {txt}"
        lines.append(line)
    lines.append("\n[End reference] Weave these points into the reading; do not list them.")
    return "\n".join(lines)


def _format_user_prompt(
    cards: list[dict],
    template_name: str,
    *,
    language: str,
    question: str | None = None,
    user_context: str | None = None,
    retrieved_chunks: list[dict] | None = None,
) -> str:
    """Format the structured spread input as a single user message."""
    rag_block = _format_retrieved_block(retrieved_chunks or [], language=language)

    if language == "zh":
        header = f"牌阵：{template_name}\n"
        rows = []
        for card in cards:
            orient = "逆位" if card.get("is_reversed") else "正位"
            slot_label = card.get("slot_label") or f"位置{card.get('slot', '?')}"
            zh_name = card.get("zh") or card.get("en") or "?"
            en_name = card.get("en") or ""
            rows.append(f"位置：{slot_label}\n牌：{zh_name} ({en_name})\n正逆位：{orient}")
        body = "\n---\n".join(rows)
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

    # English
    header = f"Spread: {template_name}\n"
    rows = []
    for card in cards:
        orient = "Reversed" if card.get("is_reversed") else "Upright"
        slot_label = card.get("slot_label") or f"Slot {card.get('slot', '?')}"
        en_name = card.get("en") or card.get("zh") or "?"
        rows.append(f"Slot: {slot_label}\nCard: {en_name}\nOrientation: {orient}")
    body = "\n---\n".join(rows)
    question_block = ""
    context_block = ""
    instruction = (
        "Write the interpretation as one cohesive paragraph relating the slots "
        "to each other; do not break it into a per-card list."
    )
    if question and question.strip():
        question_block = f"\n[User question] {question.strip()}\n"
        instruction = (
            "Answer the user's question through the combined reading of these cards. "
            "Address the question directly and ground your response in the imagery; "
            "do not list each card separately."
        )
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


# ── Output sanitization ──────────────────────────────────────
# Regex-based catch for AI slop phrases. Used by tests and runtime to
# refuse / regenerate output that smells generic.

import re

_SLOP_PATTERNS_ZH = [
    r"(?i)作为 ?AI",
    r"(?i)作为一个? ?(语言|AI) ?模型",
    r"重要的是",
    r"让我们一起",
    r"需要注意的是",
    r"^\d+[\.、]\s",  # numbered lists at line start
    r"^[\-•]\s",  # bullet markers
]
_SLOP_PATTERNS_EN = [
    r"(?i)as an AI",
    r"(?i)as a language model",
    r"(?i)it is important to (note|remember)",
    r"(?i)let us (explore|discover)",
    r"^\d+[\.\)]\s",
    r"^[\-•*]\s",
]


def detect_slop(text: str, language: str = "zh") -> list[str]:
    """Return a list of matched slop patterns. Empty list = clean."""
    patterns = _SLOP_PATTERNS_ZH if language == "zh" else _SLOP_PATTERNS_EN
    hits = []
    for pat in patterns:
        m = re.search(pat, text, re.MULTILINE)
        if m:
            hits.append(pat)
    return hits
