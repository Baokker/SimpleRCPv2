import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats
from statsmodels.stats.multitest import multipletests

root = Path(__file__).resolve().parents[1]
source = root / "runs/exp4-freeze-v31/results.jsonl"
t2 = root / "runs/exp4-t2-freeze-v31/results.jsonl"
output = t2.parent / "analysis/statistics"
output.mkdir(parents=True, exist_ok=True)

def read_jsonl(file):
    return [json.loads(line) for line in file.read_text().splitlines() if line]

rows = read_jsonl(source) + read_jsonl(t2)
by_episode = {}
for row in rows:
    by_episode.setdefault(row["episodeKey"], {})[row["condition"]] = row

def selected(sample):
    return [episode for episode, values in by_episode.items() if sample == "all" or values["T0"]["ta"]["actuallyTrapped"]]

def bootstrap(values, seed=20261007, iterations=10000):
    values = np.asarray(values, dtype=float)
    generator = np.random.default_rng(seed)
    draws = generator.choice(values, (iterations, len(values)), replace=True).mean(axis=1)
    return [float(value) for value in np.quantile(draws, [0.025, 0.975])]

def pair_test(episodes, left, right):
    differences = np.asarray([
        int(by_episode[episode][right]["jointSuccess"]) - int(by_episode[episode][left]["jointSuccess"])
        for episode in episodes
    ], dtype=float)
    left_only = int((differences == -1).sum())
    right_only = int((differences == 1).sum())
    p = float(stats.binomtest(min(left_only, right_only), left_only + right_only, 0.5).pvalue) if left_only + right_only else 1.0
    return {"episodes": len(episodes), "left": left, "right": right, "leftOnly": left_only, "rightOnly": right_only,
            "difference": float(differences.mean()), "differenceCi95": bootstrap(differences), "mcnemarP": p}

tests = []
for sample in ["all", "ta-trapped"]:
    episodes = selected(sample)
    for left, right in [("T0", "T2"), ("T2", "T3")]:
        tests.append({"sample": sample, **pair_test(episodes, left, right)})
adjusted = multipletests([item["mcnemarP"] for item in tests], method="holm")[1]
for item, value in zip(tests, adjusted):
    item["holmP"] = float(value)

summary = []
for sample in ["all", "ta-trapped"]:
    episodes = selected(sample)
    for condition in ["T0", "T2", "T3"]:
        values = [by_episode[episode][condition] for episode in episodes]
        delivered = [bool(item.get("targetInjected") or item.get("targetRetrieved")) for item in values]
        summary.append({"sample": sample, "condition": condition, "episodes": len(values),
                        "functional": int(sum(item["functional"] for item in values)),
                        "jointSuccess": int(sum(item["jointSuccess"] for item in values)),
                        "jointRate": float(np.mean([item["jointSuccess"] for item in values])),
                        "recurrence": int(sum(not item["trapAvoided"] for item in values)),
                        "recurrenceRate": float(np.mean([not item["trapAvoided"] for item in values])),
                        "delivered": int(sum(delivered)), "deliveryRate": float(np.mean(delivered))})

t2_rows = read_jsonl(t2)
groups = []
for has_tokens in [True, False]:
    values = [row for row in t2_rows if row["draftHasRequiredTokens"] is has_tokens]
    trapped = [row for row in values if row["ta"]["actuallyTrapped"]]
    groups.append({"draftHasRequiredTokens": has_tokens, "episodes": len(values), "taTrapped": len(trapped),
                   "jointSuccess": int(sum(row["jointSuccess"] for row in values)),
                   "jointRate": float(np.mean([row["jointSuccess"] for row in values])),
                   "trappedJointSuccess": int(sum(row["jointSuccess"] for row in trapped)),
                   "trappedJointRate": float(np.mean([row["jointSuccess"] for row in trapped])) if trapped else None,
                   "delivered": int(sum(bool(row["targetInjected"] or row["targetRetrieved"]) for row in values))})

agent_cost = sum((row.get("usage") or {}).get("estimatedCost", 0) or 0 for row in t2_rows)
rerank_cost = sum(call.get("estimatedCost", 0) or 0 for row in t2_rows for call in row.get("rerankCalls", []))
wall = sum(row.get("wallMs", 0) or 0 for row in t2_rows)
result = {"summary": summary, "pairedJointSuccess": tests, "draftTokenGroups": groups,
          "quality": {"episodes": len(t2_rows), "validStructure": sum(row["recapQuality"]["validStructure"] for row in t2_rows),
                      "validCitations": sum(row["recapQuality"]["validCitations"] for row in t2_rows),
                      "changedFieldsEmpty": sum(not row["review"]["changedFields"] for row in t2_rows)},
          "agentCostEstimatedCny": agent_cost, "rerankCostEstimatedCny": rerank_cost,
          "costEstimatedCny": agent_cost + rerank_cost, "wallMsSum": wall}
(output / "t2-statistics.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")

conditions = ["T0", "T2", "T3"]
rates = [next(item["jointRate"] for item in summary if item["sample"] == "ta-trapped" and item["condition"] == condition) for condition in conditions]
fig, axis = plt.subplots(figsize=(6, 4))
axis.bar(conditions, rates, color=["#8c8c8c", "#d6a84f", "#4477aa"])
axis.set_ylim(0, 1)
axis.set_ylabel("Joint success rate")
axis.set_xlabel("Condition")
axis.set_title("Transfer on Ta-trapped episodes")
fig.tight_layout()
fig.savefig(output / "transfer-t0-t2-t3.png", dpi=180)
plt.close(fig)
