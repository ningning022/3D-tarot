"""Eval pipeline for the interpretation agent.

Three modules:
    golden_set.json   30-question fixed evaluation set
    runner.py         orchestrates: pick item → run agent → collect outputs
    judge.py          LM-as-judge (OpenRouter) for quality scoring
    report.py         markdown report writer

CLI:
    python -m evals --limit 5 --no-judge       # dev iteration
    python -m evals                            # full run (needs OpenRouter key)
"""
