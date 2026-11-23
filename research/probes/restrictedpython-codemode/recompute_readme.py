"""Recompute the README headline numbers from the result JSON files that git history still holds.

The repo .gitignore excludes results/*.json, and commit 9053b68 deleted the root-level
benchmark_results_*.json files. Commits 0c8e3c4 and 917128b still contain them.
Usage: python3 -I recompute_readme.py <dir with <commit>_claude.json files>
"""
import json
import sys
from pathlib import Path

src = Path(sys.argv[1])
for f in sorted(src.glob("*_claude.json")) + sorted(src.glob("*_gemini.json")):
    d = json.loads(f.read_text())
    print(f"=== {f.name}")
    print("summary key:", json.dumps(d.get("summary"), indent=1)[:1500])
    for agent, rows in d["results"].items():
        ok = [r for r in rows if r.get("success")]
        def tok(r):
            return (r.get("input_tokens") or 0) + (r.get("output_tokens") or 0)
        print(f"{agent}: scenarios={len(rows)} success={len(ok)}/{len(rows)}")
        print("  per scenario (id, success, in, out, iterations, time):")
        for r in rows:
            print("   ", r.get("test_id"), r.get("success"), r.get("input_tokens"), r.get("output_tokens"),
                  r.get("iterations"), round(r.get("time") or r.get("duration") or r.get("execution_time") or 0, 2),
                  (r.get("error") or "")[:80])
        print(f"  tokens over successful scenarios: {sum(tok(r) for r in ok)}")
        print(f"  tokens over all scenarios: {sum(tok(r) for r in rows)}")
