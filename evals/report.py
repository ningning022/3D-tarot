"""Markdown report writer for eval runs."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from evals.runner import EvalResult


def render_markdown(
    results: list[EvalResult],
    summary: dict,
    *,
    language: str,
    style: str,
    judge_enabled: bool,
    git_sha: str | None = None,
) -> str:
    """Build a self-contained markdown report from results + summary."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    lines: list[str] = []
    lines.append(f"# Eval Report — {ts}")
    lines.append("")
    lines.append(f"- **Items**: {summary['n']}")
    lines.append(f"- **Language**: `{language}`")
    lines.append(f"- **Style**: `{style}`")
    lines.append(f"- **LM judge enabled**: {judge_enabled}"
                 f" (scored {summary.get('judge_n', 0)} / {summary['n']})")
    if git_sha:
        lines.append(f"- **Git**: `{git_sha}`")
    lines.append(f"- **Errors**: {summary.get('errors', 0)}")
    lines.append("")

    lines.append("## Headline metrics")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|---|---|")
    lines.append(f"| Classifier topic accuracy | "
                 f"**{summary['topic_accuracy']:.1%}** "
                 f"({summary['topic_correct']}/{summary['n']}) |")
    if summary.get("avg_critique_score") is not None:
        lines.append(f"| Avg local critique score (/10) | "
                     f"**{summary['avg_critique_score']:.2f}** |")
    if summary.get("avg_judge_score") is not None:
        lines.append(f"| Avg LM-judge score (/10) | "
                     f"**{summary['avg_judge_score']:.2f}** "
                     f"(n={summary['judge_n']}) |")
    lines.append(f"| Avg total time per item (ms) | "
                 f"{summary['avg_total_ms']} |")
    lines.append(f"| Avg generate time (ms) | "
                 f"{summary['avg_generate_ms']} |")
    lines.append(f"| Avg classify time (ms) | "
                 f"{summary['avg_classify_ms']} |")
    lines.append(f"| Avg critique time (ms) | "
                 f"{summary['avg_critique_ms']} |")
    lines.append(f"| Avg answer length (chars) | "
                 f"{summary['avg_answer_length']} |")
    lines.append("")

    lines.append("## Per-topic breakdown")
    lines.append("")
    lines.append("| Topic | N | Topic accuracy | Avg judge score |")
    lines.append("|---|---:|---:|---:|")
    for topic, b in summary["by_topic"].items():
        judge_cell = (f"{b['avg_judge_score']:.2f}"
                      if b["avg_judge_score"] is not None else "—")
        lines.append(f"| {topic} | {b['n']} | "
                     f"{b['topic_accuracy']:.1%} | {judge_cell} |")
    lines.append("")

    lines.append("## Per-item results")
    lines.append("")
    header = ("| ID | Expected | Predicted | ✓ | Len | "
              "Critique | Judge | Total ms | Notes |")
    sep = "|---|---|---|:---:|---:|---:|---:|---:|---|"
    lines.append(header)
    lines.append(sep)
    for r in results:
        tick = "✓" if r.topic_match else "✗"
        crit = (f"{r.critique_score}" if r.critique_score is not None else "—")
        judge_cell = (f"{r.judge_score['normalized']:.1f}"
                      if r.judge_score else "—")
        notes_parts: list[str] = []
        if r.error:
            notes_parts.append(f"error: {r.error}")
        if r.critique_issues:
            notes_parts.append("issues: " + ", ".join(r.critique_issues))
        if r.judge_score and r.judge_score.get("notes"):
            notes_parts.append("judge: " + r.judge_score["notes"])
        notes = "; ".join(notes_parts) or ""
        # escape pipe characters in free text so markdown table stays valid
        notes = notes.replace("|", "\\|")
        lines.append(
            f"| {r.item_id} | {r.topic_expected} | "
            f"{r.topic_predicted or '—'} | {tick} | {r.answer_length} | "
            f"{crit} | {judge_cell} | {r.total_ms} | {notes} |"
        )
    lines.append("")

    lines.append("## Sample answers")
    lines.append("")
    for r in results[:5]:
        lines.append(f"### `{r.item_id}` — {r.topic_expected}")
        lines.append("")
        if r.error:
            lines.append(f"> _Error: {r.error}_")
        else:
            preview = r.answer.strip()
            lines.append("```")
            lines.append(preview)
            lines.append("```")
        lines.append("")
    return "\n".join(lines)


def write_report(
    results: list[EvalResult],
    summary: dict,
    out_dir: Path,
    *,
    language: str,
    style: str,
    judge_enabled: bool,
    git_sha: str | None = None,
) -> Path:
    """Write markdown report to ``out_dir/eval-<timestamp>.md`` and
    return the path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"eval-{stamp}.md"
    content = render_markdown(
        results, summary,
        language=language, style=style,
        judge_enabled=judge_enabled, git_sha=git_sha,
    )
    path.write_text(content, encoding="utf-8")
    return path
