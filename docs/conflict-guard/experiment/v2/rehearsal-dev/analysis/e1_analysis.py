"""E1 human-to-human replay analysis.

Per policy: escape, missed lock, false block, safe warning, local decisions, frozen person-seconds,
balanced accuracy. A relation group is correct when every variant is correct (truth lock -> lock,
truth allow -> not lock). P4 is compared with P1, P2 and P3 by exact two-sided McNemar tests in one Holm
family. Frozen person-seconds are bootstrapped by relation group (2000 resamples, seed 20261007)
and split by verdict source (local rule or model) for the zoned policies.
Usage: python3 e1_analysis.py <results.json.gz> [more results files ...] [--json out.json]
"""
import gzip
import json
import random
import sys
from math import comb
from pathlib import Path

SEED = 20261007
REPETITIONS = 2000


def load(path: str) -> dict:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf8") as handle:
        return json.load(handle)


def correct(outcome: dict) -> bool:
    return outcome["decision"] == "lock" if outcome["truth"] == "lock" else outcome["decision"] != "lock"


def mcnemar(b: int, c: int) -> float:
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(comb(n, k) for k in range(0, min(b, c) + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def holm(pvalues: list[float]) -> list[float]:
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted = [0.0] * len(pvalues)
    running = 0.0
    for rank, index in enumerate(order):
        running = max(running, min(1.0, (len(pvalues) - rank) * pvalues[index]))
        adjusted[index] = running
    return adjusted


CUTOFFS = json.loads((Path(__file__).parent / "freeze-cutoffs-dev.json").read_text(encoding="utf8"))


def freeze_sources(group: dict) -> dict:
    """Split frozen seconds by the source of the verdict that started each freeze interval."""
    result = group["result"]
    events = sorted(result.get("coordinationEvents") or [], key=lambda e: e.get("at") or 0)
    ended = result.get("endedAt")
    cutoff = CUTOFFS.get(group["id"])
    cutoff = ended if cutoff is None else cutoff
    per_actor: dict[str, list[tuple[float, float, str]]] = {}
    for interval in result.get("freezeIntervals") or []:
        verdict = None
        for event in reversed(events):
            if event.get("type") == "pair_judged" and event.get("pairId") == interval["pairId"] and (event.get("at") or 0) <= interval["start"]:
                verdict = event.get("verdict")
                break
        source = "model" if (verdict or {}).get("adjudication", {}).get("source") in ("fast", "deep") else "local"
        end = interval.get("end") if interval.get("end") is not None else ended
        per_actor.setdefault(json.dumps(interval["actor"], sort_keys=True), []).append((interval["start"], min(end, cutoff), source))
    totals = {"local": 0.0, "model": 0.0, "mixed": 0.0}
    for entries in per_actor.values():
        bounds = sorted({point for start, end, _ in entries for point in (start, end)})
        for low, high in zip(bounds, bounds[1:]):
            if high <= low:
                continue
            sources = {source for start, end, source in entries if start <= low and end >= high}
            if sources:
                totals["mixed" if len(sources) > 1 else sources.pop()] += (high - low) / 1000
    return totals


def summarize(policy: str, body: dict) -> dict:
    groups = body["groups"]
    outcomes = [g["outcome"] for g in groups]
    # 以真值划分：lock 为应阻断的冲突，allow 为应放行的修改（部分冲突变体经标注为 allow）。
    conflicts = [o for o in outcomes if o["truth"] == "lock"]
    safe = [o for o in outcomes if o["truth"] == "allow"]
    locked = sum(o["decision"] == "lock" for o in conflicts)
    false_block = sum(o["decision"] == "lock" for o in safe)
    by_relation: dict[str, list[dict]] = {}
    seconds: dict[str, float] = {}
    for g in groups:
        by_relation.setdefault(g["relationGroupId"], []).append(g["outcome"])
        seconds[g["relationGroupId"]] = seconds.get(g["relationGroupId"], 0.0) + g["outcome"]["frozenPersonSeconds"]
    rng = random.Random(SEED)
    keys = sorted(seconds)
    samples = sorted(sum(seconds[rng.choice(keys)] for _ in keys) for _ in range(REPETITIONS))
    sources = {"local": 0.0, "model": 0.0, "mixed": 0.0}
    if policy in ("P3", "P4", "P4-no-four-state-typecheck"):
        for g in groups:
            for key, value in freeze_sources(g).items():
                sources[key] += value
    metrics = body["metrics"]
    return {
        "policy": policy, "samples": len(groups), "conflicts": len(conflicts), "safe": len(safe),
        "escaped": sum(o["escaped"] for o in conflicts), "locked": locked, "falseBlock": false_block,
        "safeWarn": sum(o["decision"] == "warn" for o in safe),
        "balancedAccuracy": (locked / len(conflicts) + 1 - false_block / len(safe)) / 2,
        "localDecisionRatio": (metrics.get("localDecisionRatio") or {}).get("value"),
        "frozenPersonSeconds": sum(seconds.values()),
        "frozenCi": [samples[int(0.025 * REPETITIONS)], samples[int(0.975 * REPETITIONS) - 1]],
        "freezeSources": sources if policy in ("P3", "P4", "P4-no-four-state-typecheck") else None,
        "relationCorrect": {key: all(correct(o) for o in items) for key, items in by_relation.items()},
        "cacheMisses": body.get("model", {}).get("cacheMisses", 0),
    }


def main() -> None:
    args = sys.argv[1:]
    out = None
    if "--json" in args:
        out = args[args.index("--json") + 1]
        args = args[: args.index("--json")]
    rows = {}
    for path in args:
        for policy, body in load(path)["policies"].items():
            rows[policy] = summarize(policy, body)
    print("| 策略 | 逃逸 | 锁住冲突 | 误阻断 | 安全提醒 | 平衡准确率 | 本地决定比例 | 冻结人秒 [95% CI] | 来源 本地/模型/重叠 |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---|")
    for row in rows.values():
        src = row["freezeSources"]
        local_text = "N/A" if row["localDecisionRatio"] is None else f"{row['localDecisionRatio'] * 100:.1f}%"
        src_text = f"{src['local']:.1f}/{src['model']:.1f}/{src['mixed']:.1f}" if src else "N/A"
        print(f"| {row['policy']} | {row['escaped']}/{row['conflicts']} | {row['locked']}/{row['conflicts']} | {row['falseBlock']}/{row['safe']} | {row['safeWarn']}/{row['safe']} | "
              f"{row['balancedAccuracy']*100:.1f}% | {local_text} | {row['frozenPersonSeconds']:.1f} [{row['frozenCi'][0]:.1f}, {row['frozenCi'][1]:.1f}] | {src_text} |")
    comparisons = []
    if "P4" in rows:
        for other in ("P1", "P2", "P3"):
            if other not in rows:
                continue
            left, right = rows["P4"]["relationCorrect"], rows[other]["relationCorrect"]
            b = sum(left[k] and not right[k] for k in left)
            c = sum(right[k] and not left[k] for k in left)
            comparisons.append({"left": "P4", "right": other, "groups": len(left), "p4Only": b, "otherOnly": c, "p": mcnemar(b, c)})
        for item, adjusted in zip(comparisons, holm([item["p"] for item in comparisons])):
            item["holmP"] = adjusted
        print("\n| 比较 | 关系组 | 仅 P4 正确 | 仅对方正确 | exact McNemar p | Holm p |\n|---|---:|---:|---:|---:|---:|")
        for item in comparisons:
            print(f"| P4 / {item['right']} | {item['groups']} | {item['p4Only']} | {item['otherOnly']} | {item['p']:.4g} | {item['holmP']:.4g} |")
    if out:
        Path(out).write_text(json.dumps({"policies": rows, "comparisons": comparisons}, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
