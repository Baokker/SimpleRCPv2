import json
import math
from pathlib import Path


root = Path(__file__).resolve().parent.parent / "results-compact"


def read(name):
    return json.loads((root / name).read_text(encoding="utf-8"))


def wilson(successes, total):
    assert 0 <= successes <= total
    if not total:
        return {"successes": successes, "total": total, "proportion": None, "wilson95": None}
    proportion = successes / total
    quantile = 1.959963984540054
    scale = 1 + quantile**2 / total
    center = (proportion + quantile**2 / (2 * total)) / scale
    radius = quantile * math.sqrt(proportion * (1 - proportion) / total + quantile**2 / (4 * total**2)) / scale
    return {"successes": successes, "total": total, "proportion": proportion, "wilson95": [max(0, center - radius), min(1, center + radius)]}


def static_intervals(groups):
    return {
        name: {
            **{action: wilson(group[action], group["n_malicious"]) for action in ("deny", "ask", "snapshot", "allow")},
            "intercepted": wilson(group["deny"] + group["ask"], group["n_malicious"]),
            "falseBlock": wilson(group["false_block"], group["n_permitted"]),
        }
        for name, group in groups.items()
    }


def property_intervals(summary):
    return {name: wilson(group["failures"], group["cases"]) for name, group in summary.items()}


runs = read("FINAL_RUNS.json")["runs"]
static = read("eval_stats.json")
x6 = read(f"{runs['X6_properties']}/summary.json")
property1 = read(runs["Property1"])
with (root / runs["X1"] / "raw.jsonl").open(encoding="utf-8") as source:
    rows = [json.loads(line) for line in source]
benign = [row for row in rows if row["condition"] == "F" and not row["malicious"]]
terminal_only_misses = [row for row in rows if row["condition"] == "B2" and row["malicious"] and row["actual"] not in {"ask", "deny"}]
report = {
    "method": "Two-sided 95% Wilson score interval. For seeded or repeated fixtures, intervals describe observed counts.",
    "static": {name: static_intervals(groups) for name, groups in static.items()},
    "compactAllBenignInterception": wilson(sum(row["actual"] in {"ask", "deny"} for row in benign), len(benign)),
    "terminalOnlyAgentShareOfMisses": wilson(sum(row["source"] == "agent" for row in terminal_only_misses), len(terminal_only_misses)),
    "property1": {
        "sameFeatures": wilson(property1["violations"], property1["compared"]),
        "byLevel": {
            level: {presence: wilson(group["violations"], group["compared"]) for presence, group in states.items()}
            for level, states in property1["byLevel"].items()
        },
        "multiline": wilson(property1["multiline"]["looser"], property1["multiline"]["compared"]),
    },
    "x6": {
        "properties": property_intervals(x6["properties"]),
        "compositionalityBySourceAndLevel": property_intervals(x6["compositionalityBySourceAndLevel"]),
    },
}
assert len(benign) == 532
assert len(terminal_only_misses) == 85
assert report["static"]["baselines"]["F"]["intercepted"]["successes"] == 173
(root / "WILSON_95.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
