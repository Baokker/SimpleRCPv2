"""E2 grey-zone metrics for one or more adjudication results files.

Balanced accuracy = (conflicts locked / conflicts + safe not locked / safe) / 2.
Usage: python3 e2_metrics.py <results.json.gz> [...] [--json out.json]
"""
import gzip
import json
import statistics
import sys
from pathlib import Path


def load(path: str) -> dict:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf8") as handle:
        return json.load(handle)


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = q * (len(ordered) - 1)
    low = int(index)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def summarize(path: str) -> dict:
    report = load(path)
    (policy, body), = report["policies"].items()
    groups = body["groups"]
    decisions = {g["id"]: g["outcome"]["decision"] for g in groups}
    conflicts = [g for g in groups if g["outcome"]["variantKind"] == "conflict"]
    safe = [g for g in groups if g["outcome"]["variantKind"] == "safe"]
    locked = sum(g["outcome"]["decision"] == "lock" for g in conflicts)
    notified = sum(g["outcome"]["decision"] != "allow" for g in conflicts)
    false_block = sum(g["outcome"]["decision"] == "lock" for g in safe)
    safe_warn = sum(g["outcome"]["decision"] == "warn" for g in safe)
    model = body["model"]
    calls = model["calls"]
    roles = {}
    for role in ("fast", "deep"):
        entries = [c for c in calls if c["role"] == role]
        if not entries:
            continue
        valid = [c for c in entries if c["status"] in ("success", "cache-hit")]
        roles[role] = {
            "calls": len(entries),
            "valid": len(valid),
            "statuses": {s: sum(c["status"] == s for c in entries) for s in sorted({c["status"] for c in entries})},
            "p50Ms": percentile([c["latencyMs"] for c in entries], 0.5),
            "p95Ms": percentile([c["latencyMs"] for c in entries], 0.95),
        }
    return {
        "file": path, "policy": policy, "samples": len(groups), "conflicts": len(conflicts), "safe": len(safe),
        "locked": locked, "notified": notified, "falseBlock": false_block, "safeWarn": safe_warn,
        "balancedAccuracy": (locked / len(conflicts) + 1 - false_block / len(safe)) / 2,
        "agreement": body["metrics"]["agreement"]["value"], "roles": roles, "costUsd": model["costUsd"],
        "missedConflicts": sorted(g["id"] for g in conflicts if g["outcome"]["decision"] != "lock"),
        "falseBlocks": sorted(g["id"] for g in safe if g["outcome"]["decision"] == "lock"),
        "decisions": decisions,
    }


def main() -> None:
    args = sys.argv[1:]
    out = None
    if "--json" in args:
        out = args[args.index("--json") + 1]
        args = args[: args.index("--json")]
    rows = [summarize(path) for path in args]
    for row in rows:
        roles = "; ".join(f"{role} {v['valid']}/{v['calls']} p50 {v['p50Ms']/1000:.2f}s p95 {v['p95Ms']/1000:.2f}s" for role, v in row["roles"].items())
        print(f"{row['policy']:6} BA {row['balancedAccuracy']*100:5.1f}%  locked {row['locked']}/{row['conflicts']}  notified {row['notified']}/{row['conflicts']}  "
              f"falseBlock {row['falseBlock']}/{row['safe']}  safeWarn {row['safeWarn']}/{row['safe']}  ${row['costUsd']:.4f}  {roles}  <- {Path(row['file']).parent.parent.name}")
    if out:
        Path(out).write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
