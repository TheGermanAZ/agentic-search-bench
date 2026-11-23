"""Builds research/probes/results/<impl>.json from out/*.json plus the hand-written facts in meta.py."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import meta  # noqa: E402

REL = HERE.relative_to(HERE.parents[2])
KEEP = ("outcome", "detail", "display")


def load(prefix):
    probes = {}
    for i in range(1, 13):
        f = HERE / "out" / f"{prefix}P{i}.json"
        if not f.exists():
            continue
        d = json.loads(f.read_text())
        p = {k: d[k] for k in KEEP if k in d}
        p["evidence"] = str(REL / "out" / f"{prefix}P{i}.txt")
        probes[f"P{i}"] = p
    return probes


def apply(probes, overrides):
    for pid, o in overrides.items():
        probes.setdefault(pid, {}).update(o)
        assert len(probes[pid].get("display", "")) <= 40, (pid, probes[pid]["display"])
    return probes


default = apply(load(""), getattr(meta, "OVERRIDES", {}))
out = {k: getattr(meta, k.upper()) for k in ("impl", "name", "source", "pinned", "language", "engine", "how_run")}
out["probes"] = {f"P{i}": default[f"P{i}"] for i in range(1, 13)}
hc = getattr(meta, "HARDENED_CONFIG", None)
out["hardened"] = None if hc is None else {"config": hc, "probes": apply(load("hardened-"), getattr(meta, "HARDENED_OVERRIDES", {}))}
out["defaults"] = meta.DEFAULTS
out["source_notes"] = meta.SOURCE_NOTES
out["surprises"] = meta.SURPRISES
if hasattr(meta, "EXTRA"):
    out.update(meta.EXTRA)
dest = HERE.parents[0] / "results" / f"{meta.IMPL}.json"
dest.write_text(json.dumps(out, indent=2) + "\n")
print(f"wrote {dest}")
for pid, p in out["probes"].items():
    print(f"  {pid:4} {p['display']}")
if out["hardened"]:
    for pid, p in out["hardened"]["probes"].items():
        print(f"  H-{pid:4} {p['display']}")
