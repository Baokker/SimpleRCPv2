import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
from scipy import stats
from statsmodels.stats.multitest import multipletests


root = Path(__file__).resolve().parents[4]
output = Path(__file__).resolve().parent
source = root / "experiments/knowledge/runs/E3-delivery-v241-m3"


def read_jsonl(file):
    return [json.loads(line) for line in file.read_text().splitlines() if line]


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def target_sources(row):
    if "targetDeliverySources" in row:
        return row["targetDeliverySources"]
    relevant = set(row["relevantIds"])
    return [item["reason"] for item in row["deliverySources"] if item["id"] in relevant]


def paired(left, right):
    difference = np.asarray(right, dtype=int) - np.asarray(left, dtype=int)
    gain = int((difference == 1).sum())
    loss = int((difference == -1).sum())
    generator = np.random.default_rng(20261010)
    intervals = np.quantile(generator.choice(difference, (10000, len(difference))).mean(axis=1), [.025, .975])
    return {
        "n": len(difference), "gain": gain, "loss": loss,
        "difference": float(difference.mean()), "ci95": intervals.tolist(),
        "mcnemarP": float(stats.binomtest(gain, gain + loss, .5).pvalue) if gain + loss else 1.0,
    }


rows = read_jsonl(source / "results.jsonl")
assert len(rows) == 220 and len({row["key"] for row in rows}) == 220
assert digest(source / "results.jsonl") == "a03bfdcfd20a3722273ca69093b0e76f6c344e796708f79fa49750eff5249ae8"
assert all(row["completed"] and row["model"] == "MiniMax-M3" for row in rows)
protocol = json.loads((source / "protocol.json").read_text())
bm25 = {(row["task"], row["variant"]): row for row in rows if row["condition"] == "B"}
resolved = []
for row in rows:
    if row["condition"] != "C":
        continue
    selected = bm25[row["task"], row["variant"]] if row["failed"] else row
    assert not selected["failed"]
    assert len(selected["resultIds"]) <= 5 and selected["totalChars"] <= 4000
    relevant = set(row["relevantIds"])
    if row["taskKind"] == "control":
        assert relevant == set(protocol["controlRelevantCards"][row["task"]])
    resolved.append({
        "key": row["key"], "task": row["task"], "taskKind": row["taskKind"],
        "variant": row["variant"], "repetition": row["repetition"],
        "rankingSource": "bm25-fallback" if row["failed"] else "m3",
        "fallbackReason": row.get("failureReason") if row["failed"] else None,
        "sourceKey": selected["key"], "resultIds": selected["resultIds"],
        "targetDelivered": selected["targetDelivered"],
        "irrelevantDelivered": any(card not in relevant for card in selected["resultIds"]) if row["taskKind"] == "control" else None,
        "anyDelivered": bool(selected["resultIds"]),
        "activeFiles": selected["activeFiles"], "activeFileSources": selected["activeFileSources"],
        "deliverySources": selected["deliverySources"],
        "targetDeliverySources": [item["reason"] for item in selected["deliverySources"]
                                  if row["taskKind"] == "trap" and item["id"] in relevant],
    })
assert len(resolved) == 132
summary = []
comparisons = []
for variant in ["original", "paraphrase"]:
    tasks_by_condition = {}
    for condition in ["A", "B", "C-fallback"]:
        group = [row for row in (resolved if condition == "C-fallback" else rows)
                 if row["variant"] == variant and (condition == "C-fallback" or row["condition"] == condition)]
        traps = [row for row in group if row["taskKind"] == "trap"]
        controls = [row for row in group if row["taskKind"] == "control"]
        assert len(traps) == (48 if condition == "C-fallback" else 16)
        by_activity = []
        for has_files in [False, True]:
            subset = [row for row in traps if bool(row["activeFiles"]) == has_files]
            by_activity.append({"activeFilesPresent": has_files, "requests": len(subset),
                                "delivered": sum(row["targetDelivered"] for row in subset)})
        by_delivery = {}
        for reason in ["lexical", "fileRelated", "project-fallback"]:
            by_delivery[reason] = sum(reason in target_sources(row) for row in traps)
        assert sum(by_delivery.values()) == sum(row["targetDelivered"] for row in traps)
        task_majority = {}
        for task in sorted({row["task"] for row in traps}):
            attempts = [row["targetDelivered"] for row in traps if row["task"] == task]
            assert all(isinstance(value, bool) for value in attempts)
            task_majority[task] = sum(attempts) > len(attempts) / 2
        tasks_by_condition[condition] = task_majority
        control_majority = [sum(row["irrelevantDelivered"] for row in controls if row["task"] == task)
                            > len([row for row in controls if row["task"] == task]) / 2
                            for task in sorted({row["task"] for row in controls})]
        summary.append({
            "variant": variant, "condition": condition,
            "trapRequests": len(traps), "deliveredRequests": sum(row["targetDelivered"] for row in traps),
            "trapTasks": len(task_majority), "deliveredTasks": sum(task_majority.values()),
            "controlRequests": len(controls), "irrelevantRequests": sum(row["irrelevantDelivered"] for row in controls),
            "controlTasks": len(control_majority), "irrelevantTasks": sum(control_majority),
            "fallbackRequests": sum(row.get("rankingSource") == "bm25-fallback" for row in group),
            "fallbackTrapRequests": sum(row.get("rankingSource") == "bm25-fallback" for row in traps),
            "deliverySourceRequests": by_delivery, "activeFileGroups": by_activity,
            "taskOutcomes": task_majority,
        })
    variant_tests = []
    for left, right in [("A", "B"), ("B", "C-fallback")]:
        tasks = sorted(tasks_by_condition[left])
        variant_tests.append({"variant": variant, "left": left, "right": right,
                              **paired([tasks_by_condition[left][task] for task in tasks],
                                       [tasks_by_condition[right][task] for task in tasks])})
    for row, adjusted in zip(variant_tests, multipletests([row["mcnemarP"] for row in variant_tests], method="holm")[1]):
        row["holmP"] = float(adjusted)
    comparisons.extend(variant_tests)

artifact = {
    "method": "每个失败C请求使用相同任务与查询变体的已保存B结果；成功C请求保持已保存选择。",
    "sourceResults": str(source.relative_to(root) / "results.jsonl"),
    "sourceSha256": digest(source / "results.jsonl"),
    "protocolSha256": digest(source / "protocol.json"),
    "queriesSha256": digest(source / "queries.json"),
    "newModelRequests": 0, "summary": summary, "comparisons": comparisons,
    "failures": [row for row in resolved if row["rankingSource"] == "bm25-fallback"],
    "resolvedRequests": resolved,
}
(output / "delivery-with-fallback.json").write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n")
font_manager.findfont("Arial Unicode MS", fallback_to_default=False)
plt.rcParams["font.family"] = "Arial Unicode MS"
figure, axes = plt.subplots(1, 2, figsize=(10, 4), constrained_layout=True)
for axis, variant in zip(axes, ["original", "paraphrase"]):
    group = [row for row in summary if row["variant"] == variant]
    positions = np.arange(3)
    axis.bar(positions - .18, [row["deliveredTasks"] / row["trapTasks"] for row in group], .36, label="目标送达（16个任务）", color="#4477aa")
    axis.bar(positions + .18, [row["irrelevantTasks"] / row["controlTasks"] for row in group], .36, label="误提供（6个对照）", color="#cc6677")
    axis.set_xticks(positions, ["词法与 bounded", "BM25", "BM25 + M3\n失败采用 BM25"])
    axis.set(ylim=(0, 1.08), ylabel="任务比例", title="原查询" if variant == "original" else "自然语言改写")
axes[0].legend(fontsize=8)
figure.savefig(output / "delivery.png", dpi=180)
plt.close(figure)
print(json.dumps({"summary": summary, "comparisons": comparisons, "newModelRequests": 0}, ensure_ascii=False, indent=2))
