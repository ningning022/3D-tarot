"""CLI: python -m evals [options]

Defaults:
    - Loads evals/golden_set.json
    - Runs all 30 items at zh + traditional style
    - Local critique always runs (part of agent loop)
    - LM-judge (OpenRouter) runs only when --judge passed AND
      openrouter_api_key is set in interpret_settings
    - Writes markdown report to docs/evals/
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import interpret_service  # noqa: E402
from evals.report import write_report  # noqa: E402
from evals.runner import (  # noqa: E402
    DEFAULT_GOLDEN_PATH, load_golden_set, run_all, summarize,
)


def _git_sha() -> str | None:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT, stderr=subprocess.DEVNULL,
        )
        return out.decode("utf-8").strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="evals", description=__doc__)
    p.add_argument("--golden", default=str(DEFAULT_GOLDEN_PATH),
                   help="Golden set JSON path")
    p.add_argument("--limit", type=int, default=None,
                   help="Stop after N items")
    p.add_argument("--language", default="zh", choices=("zh", "en"))
    p.add_argument("--style", default="traditional",
                   choices=("traditional", "intuitive", "psychological"))
    p.add_argument("--judge", action="store_true",
                   help="Enable LM-as-judge (needs OpenRouter key in settings)")
    p.add_argument("--judge-model", default=None,
                   help="Override the OpenRouter model used by the judge")
    p.add_argument("--out", default="docs/evals",
                   help="Directory to write the markdown report")
    p.add_argument("--json", default=None,
                   help="Also write raw results JSON to this path")
    args = p.parse_args(argv)

    golden_path = Path(args.golden)
    if not golden_path.exists():
        print(f"Golden set not found: {golden_path}", file=sys.stderr)
        return 2

    items = load_golden_set(golden_path)
    print(f"Loaded {len(items)} items from {golden_path}")

    def _progress(i: int, n: int, item_id: str) -> None:
        print(f"  [{i + 1}/{n}] {item_id}…", flush=True)

    from server import get_connection  # local import; server's path bootstrap
    with closing(get_connection()) as conn:
        interpret_service.migrate(conn)
        results = run_all(
            items, conn,
            language=args.language, style=args.style,
            limit=args.limit,
            judge_enabled=args.judge,
            judge_model=args.judge_model,
            progress=_progress,
        )

    summary = summarize(results)
    print()
    print(json.dumps({"summary": summary}, ensure_ascii=False, indent=2))

    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(
            json.dumps(
                {"summary": summary,
                 "results": [r.to_dict() for r in results]},
                ensure_ascii=False, indent=2,
            ),
            encoding="utf-8",
        )
        print(f"\nWrote raw results: {args.json}")

    out_path = write_report(
        results, summary,
        out_dir=ROOT / args.out,
        language=args.language, style=args.style,
        judge_enabled=args.judge, git_sha=_git_sha(),
    )
    print(f"Wrote report: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
