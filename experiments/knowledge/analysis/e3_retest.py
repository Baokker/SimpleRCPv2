import argparse
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats
from statsmodels.stats.multitest import multipletests


def read_rows(directory):
    return [json.loads(line) for line in (directory / "results.jsonl").read_text().splitlines() if line]


def majority(rows, field):
    values = [row[field] for row in rows if row.get(field) is not None]
    if len(values) != len(rows):
        return None
    return sum(values) > len(values) / 2


def summarize(rows):
    output = []
    for variant in ["original", "paraphrase"]:
        for condition in ["A", "B", "C"]:
            selected = [row for row in rows if row["variant"] == variant and row["condition"] == condition]
            tasks = sorted({row["task"] for row in selected})
            task_rows = {task: [row for row in selected if row["task"] == task] for task in tasks}
            traps = {task: majority(group, "targetDelivered") for task, group in task_rows.items() if group[0]["taskKind"] == "trap"}
            controls = {task: majority(group, "irrelevantDelivered") for task, group in task_rows.items() if group[0]["taskKind"] == "control"}
            consistent = sum(len({row["targetDelivered"] if row["taskKind"] == "trap" else row["irrelevantDelivered"] for row in group}) == 1 for group in task_rows.values())
            times = [row["latencyMs"] for row in selected]
            model_times = [row["modelLatencyMs"] for row in selected if row.get("modelLatencyMs") is not None]
            costs = [row["estimatedCostCny"] for row in selected if row.get("estimatedCostCny") is not None]
            output.append({"variant": variant, "condition": condition, "requests": len(selected),
                           "traps": traps, "controls": controls, "delivered": sum(value is True for value in traps.values()),
                           "irrelevant": sum(value is True for value in controls.values()), "unknownControls": sum(value is None for value in controls.values()),
                           "anyControlDelivery": sum(majority(group, "anyDelivered") is True for group in task_rows.values() if group[0]["taskKind"] == "control"),
                           "failed": sum(row["failed"] for row in selected), "consistentTasks": consistent,
                           "meanCostCny": float(np.mean(costs)) if costs else None, "costCny": sum(costs), "unknownCost": len(selected) - len(costs),
                           "medianMs": float(np.median(times)), "p95Ms": float(np.percentile(times, 95)),
                           "modelP95Ms": float(np.percentile(model_times, 95)) if model_times else None,
                           "individualDelivered": sum(row["targetDelivered"] is True for row in selected),
                           "individualTrapRequests": sum(row["taskKind"] == "trap" for row in selected),
                           "individualIrrelevant": sum(row["irrelevantDelivered"] is True for row in selected),
                           "individualControlRequests": sum(row["taskKind"] == "control" for row in selected)})
    return output


def comparisons(summary):
    output = []
    for variant in ["original", "paraphrase"]:
        entries = {row["condition"]: row for row in summary if row["variant"] == variant}
        group = []
        for candidate, baseline in [("B", "A"), ("C", "B")]:
            tasks = sorted(entries[candidate]["traps"])
            left = np.array([entries[candidate]["traps"][task] for task in tasks], dtype=int)
            right = np.array([entries[baseline]["traps"][task] for task in tasks], dtype=int)
            gains = int(sum((left == 1) & (right == 0)))
            losses = int(sum((left == 0) & (right == 1)))
            difference = left - right
            rng = np.random.default_rng(20261010)
            intervals = np.quantile(rng.choice(difference, (10000, len(tasks))).mean(axis=1), [.025, .975])
            group.append({"variant": variant, "comparison": f"{candidate}-{baseline}", "n": len(tasks), "effect": float(difference.mean()),
                          "ci95": intervals.tolist(), "gains": gains, "losses": losses,
                          "p": float(stats.binomtest(gains, gains + losses, .5).pvalue) if gains + losses else 1.0})
        adjusted = multipletests([row["p"] for row in group], method="holm")[1]
        for row, p in zip(group, adjusted):
            row["holmP"] = float(p)
        output.extend(group)
    return output


def verify_historical(current, previous):
    a = {row["key"]: row for row in read_rows(current)}
    b = {row["key"]: row for row in read_rows(previous)}
    assert set(a) == set(b) and len(a) == 176
    for key in a:
        for field in ["recall1", "recall3", "recall5", "mrr", "ndcg5", "targetRank", "activeFiles"]:
            assert a[key][field] == b[key][field], (key, field)
        ranking_a = json.loads((current / a[key]["artifacts"] / "ranking.json").read_text())
        ranking_b = json.loads((previous / b[key]["artifacts"] / "ranking.json").read_text())
        assert ranking_a == ranking_b, key
    return {"queries": len(a), "allRankingsIdentical": True,
            "resultsSha256": hashlib.sha256((current / "results.jsonl").read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--historical", type=Path)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    rows = read_rows(args.directory)
    assert len(rows) == 220 and len({row["key"] for row in rows}) == 220
    for variant in ["original", "paraphrase"]:
        for condition in ["A", "B", "C"]:
            selected = [row for row in rows if row["variant"] == variant and row["condition"] == condition]
            assert len(selected) == (66 if condition == "C" else 22)
            assert len({row["task"] for row in selected}) == 22
    summary = summarize(rows)
    tests = comparisons(summary)
    failures = [row for row in rows if row["failed"]]
    misses = [row for row in rows if row["taskKind"] == "trap" and not row["targetDelivered"]]
    adoption = []
    for variant in ["original", "paraphrase"]:
        selected = {row["condition"]: row for row in summary if row["variant"] == variant}
        b, c = selected["B"], selected["C"]
        adoption.append(c["delivered"] >= b["delivered"] and c["irrelevant"] <= b["irrelevant"] and
                        (c["delivered"] > b["delivered"] or c["irrelevant"] < b["irrelevant"]) and c["failed"] == 0)
    result = {"summary": summary, "comparisons": tests, "qualityCriterionMet": all(adoption), "failures": failures,
              "estimatedCostCny": sum(row.get("estimatedCostCny", 0) for row in rows),
              "resultsSha256": hashlib.sha256((args.directory / "results.jsonl").read_bytes()).hexdigest()}
    if args.historical and args.previous:
        result["historical"] = verify_historical(args.historical, args.previous)
    output = args.directory / "analysis"
    output.mkdir(exist_ok=True)
    (output / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    (output / "misses.json").write_text(json.dumps(misses, ensure_ascii=False, indent=2) + "\n")
    figure, axes = plt.subplots(1, 2, figsize=(10, 4), constrained_layout=True)
    for axis, variant in zip(axes, ["original", "paraphrase"]):
        selected = [row for row in summary if row["variant"] == variant]
        positions = np.arange(3)
        axis.bar(positions - .18, [row["delivered"] / 16 for row in selected], .36, label="Target delivery (n=16)")
        axis.bar(positions + .18, [row["irrelevant"] / 6 for row in selected], .36, label="Irrelevant delivery (n=6)")
        axis.set_xticks(positions, ["bounded", "BM25", "BM25 + M3"])
        axis.set_ylim(0, 1.08)
        axis.set_title(variant)
        axis.set_ylabel("Task proportion")
    axes[0].legend(fontsize=8)
    figure.savefig(output / "delivery.png", dpi=180)
    plt.close(figure)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
