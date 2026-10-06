import argparse
import itertools
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.inter_rater import cohens_kappa
from statsmodels.genmod.bayes_mixed_glm import BinomialBayesMixedGLM


def bootstrap_tasks(values, seed=20261007, iterations=10000):
    values = np.asarray(values, dtype=float)
    if len(values) == 0:
        raise ValueError("Bootstrap requires tasks")
    generator = np.random.default_rng(seed)
    means = generator.choice(values, (iterations, len(values)), replace=True).mean(axis=1)
    return np.quantile(means, [0.025, 0.975]).tolist()


def paired_tests(left, right, bound=0.05):
    left, right = np.asarray(left, dtype=float), np.asarray(right, dtype=float)
    if len(left) != len(right) or not len(left):
        raise ValueError("Paired observations are required")
    b = int(((left == 1) & (right == 0)).sum())
    c = int(((left == 0) & (right == 1)).sum())
    difference = right - left
    mcnemar = stats.binomtest(min(b, c), b + c, 0.5).pvalue if b + c else 1.0
    standard_error = difference.std(ddof=1) / np.sqrt(len(difference)) if len(difference) > 1 else np.nan
    tost = None
    if np.isfinite(standard_error):
        if standard_error > 0:
            lower = stats.t.sf((difference.mean() + bound) / standard_error, len(difference) - 1)
            upper = stats.t.cdf((difference.mean() - bound) / standard_error, len(difference) - 1)
            tost = float(max(lower, upper))
    return {"tasks": len(left), "left_only": b, "right_only": c, "mcnemar_p": float(mcnemar), "difference": float(difference.mean()),
            "difference_ci": bootstrap_tasks(difference), "tost_bound": bound, "tost_p": tost,
            "tost_reason": None if tost is not None else "样本数量或差值方差不足"}


def majority_table(frame):
    rows = []
    for (task, condition), group in frame.groupby(["task", "condition"]):
        record = {"task": task, "condition": condition, "runs": len(group)}
        for field in ["trapAvoided", "jointSuccess", "functional"]:
            count = int(group[field].sum())
            record[field] = None if count * 2 == len(group) else int(count * 2 > len(group))
        rows.append(record)
    return pd.DataFrame(rows)


def analyze_agent(frame, directory):
    if "variant" in frame:
        if frame.variant.isna().any() or not frame.variant.isin(["delayed", "same-session"]).all():
            raise ValueError("Transfer timing variants are required")
        rows = []
        for variant, group in frame.groupby("variant"):
            location = directory / variant
            location.mkdir(exist_ok=True)
            rows.extend({"variant": variant, **row} for row in analyze_agent_stratum(group, location))
        (directory / "agent.md").write_text(pd.DataFrame(rows).to_markdown(index=False))
        return rows
    return analyze_agent_stratum(frame, directory)


def analyze_agent_stratum(frame, directory):
    if "taskKind" in frame:
        controls = frame[frame.taskKind.eq("control")]
        if not controls.empty:
            control_majority = majority_table(controls)
            control_majority.to_csv(directory / "control-majority.csv", index=False)
            wide = control_majority.pivot(index="task", columns="condition", values="functional")
            control_tests = []
            for a, b in itertools.combinations(wide.columns, 2):
                pairs = wide[[a, b]].dropna()
                if not pairs.empty:
                    control_tests.append({"condition_a": a, "condition_b": b, **paired_tests(pairs[a], pairs[b])})
            available = [item for item in control_tests if item["tost_p"] is not None]
            if available:
                for item, value in zip(available, multipletests([item["tost_p"] for item in available], method="holm")[1]):
                    item["tost_holm_p"] = float(value)
            (directory / "controls.json").write_text(json.dumps(control_tests, ensure_ascii=False, indent=2))
    frame = frame[frame.taskKind.eq("trap")] if "taskKind" in frame else frame
    if frame.empty:
        return []
    majority = majority_table(frame)
    majority.to_csv(directory / "majority.csv", index=False)
    summary = []
    for condition, group in majority.groupby("condition"):
        for field in ["trapAvoided", "jointSuccess", "functional"]:
            values = group[field].dropna().astype(float).to_numpy()
            if not len(values):
                continue
            summary.append({"condition": condition, "metric": "recurrence" if field == "trapAvoided" else field,
                            "mean": float(1 - values.mean() if field == "trapAvoided" else values.mean()),
                            "ci": bootstrap_tasks(1 - values if field == "trapAvoided" else values), "tasks": len(values)})
    comparisons = []
    for field in ["trapAvoided", "jointSuccess"]:
        wide = majority.pivot(index="task", columns="condition", values=field)
        for a, b in itertools.combinations(wide.columns, 2):
            pairs = wide[[a, b]].dropna()
            if pairs.empty:
                continue
            comparisons.append({"metric": field, "condition_a": a, "condition_b": b, **paired_tests(pairs[a], pairs[b])})
    if comparisons:
        adjusted = multipletests([item["mcnemar_p"] for item in comparisons], method="holm")[1]
        for item, value in zip(comparisons, adjusted):
            item["holm_p"] = float(value)
        tost_items = [item for item in comparisons if item["tost_p"] is not None]
        if tost_items:
            for item, value in zip(tost_items, multipletests([item["tost_p"] for item in tost_items], method="holm")[1]):
                item["tost_holm_p"] = float(value)
    model = {"available": False, "reason": "至少需要两个条件以及同时存在成功和失败"}
    if frame.condition.nunique() > 1 and frame.jointSuccess.nunique() > 1:
        np.random.seed(20261007)
        observations = frame.copy()
        observations["jointSuccess"] = observations.jointSuccess.astype(int)
        fitted = BinomialBayesMixedGLM.from_formula("jointSuccess ~ C(condition)", {"task": "0 + C(task)"}, observations).fit_vb()
        model = {"available": True, "method": "BinomialBayesMixedGLM.fit_vb", "fixed_names": fitted.model.exog_names,
                 "fixed_mean": fitted.fe_mean.tolist(), "fixed_sd": fitted.fe_sd.tolist(), "task_log_sd": fitted.vcp_mean.tolist()}
    (directory / "statistics.json").write_text(json.dumps({"summary": summary, "comparisons": comparisons, "mixed_logistic": model}, ensure_ascii=False, indent=2))
    table = pd.DataFrame(summary)
    (directory / "agent.md").write_text(table.to_markdown(index=False) + "\n\n" + pd.DataFrame(comparisons).to_markdown(index=False))
    plot = table[table.metric.eq("jointSuccess")] if not table.empty else pd.DataFrame()
    fig, axis = plt.subplots(figsize=(7, 4))
    if not plot.empty:
        intervals = np.array(plot.ci.tolist())
        axis.bar(plot.condition, plot["mean"], yerr=np.array([plot["mean"].to_numpy() - intervals[:, 0], intervals[:, 1] - plot["mean"].to_numpy()]), capsize=4, color=plt.get_cmap("tab10").colors[:len(plot)])
    axis.set(ylim=(0, 1), ylabel="Joint success", xlabel="Condition")
    fig.tight_layout(); fig.savefig(directory / "conditions.png", dpi=180); plt.close(fig)
    frame = frame.copy()
    frame["totalTokens"] = frame.usage.map(lambda value: (value or {}).get("totalTokens", np.nan))
    task_rates = frame.groupby(["task", "condition"])[["jointSuccess", "trapAvoided", "totalTokens"]].mean().reset_index()
    baseline_name = "C0" if "C0" in frame.condition.values else "T0"
    baseline = task_rates[task_rates.condition.eq(baseline_name)].set_index("task")
    fig, axis = plt.subplots(figsize=(7, 4))
    plotted = False
    for condition, group in task_rates.groupby("condition"):
        if condition == baseline_name:
            continue
        paired = group.set_index("task").join(baseline[["trapAvoided", "totalTokens"]], rsuffix="_baseline", how="inner").dropna()
        if not paired.empty:
            axis.scatter(paired.totalTokens - paired.totalTokens_baseline, paired.trapAvoided - paired.trapAvoided_baseline, label=condition, alpha=0.65)
            plotted = True
    axis.set(xlabel="Additional mean tokens per task", ylabel="Recurrence reduction")
    if plotted:
        axis.legend()
    fig.tight_layout(); fig.savefig(directory / "tokens.png", dpi=180); plt.close(fig)
    return summary


def analyze_anchors(frame, directory):
    rows = []
    for row in frame.to_dict("records"):
        for result in row["results"]:
            rows.append({"kind": row["condition"], "strategy": result["strategy"], "correct": result["outcome"] == "correct",
                         "wrong": result["outcome"] == "wrong", "review": result["outcome"] == "review", "locatable": row["truth"] is not None})
    outcomes = pd.DataFrame(rows)
    summary = outcomes.groupby(["kind", "strategy"])[["correct", "wrong", "review"]].mean().reset_index()
    summary.to_csv(directory / "anchors.csv", index=False)
    (directory / "anchors.md").write_text(summary.to_markdown(index=False))
    locatable = outcomes[outcomes.locatable].groupby("strategy")[["correct", "wrong", "review"]].mean()
    fig, axis = plt.subplots(figsize=(8, 4)); locatable.plot.bar(ax=axis, color=["#4477aa", "#cc6677", "#228833"])
    axis.set(ylabel="Rate", ylim=(0, 1)); axis.tick_params(axis="x", rotation=20)
    fig.tight_layout(); fig.savefig(directory / "anchors.png", dpi=180); plt.close(fig)


def analyze_ratings(a, b, directory):
    first, second = pd.read_csv(a), pd.read_csv(b)
    if first.id.isna().any() or second.id.isna().any() or set(first.id) != set(second.id):
        raise ValueError("Both rating sheets must contain the same draft ids")
    merged = first.merge(second, on="id", suffixes=("_a", "_b"), validate="one_to_one")
    if not merged.draft_a.equals(merged.draft_b):
        raise ValueError("Raters must evaluate identical draft text")
    rows = []
    for field in ["ruleCorrect", "checkable", "scopeSuitable", "boundariesReasonable"]:
        pairs = merged[[field + "_a", field + "_b"]].dropna()
        if pairs.empty:
            rows.append({"metric": field, "rated": 0, "kappa": None, "mean": None}); continue
        values = pairs.to_numpy(dtype=float)
        if ((values < 1) | (values > 5) | (values % 1 != 0)).any():
            raise ValueError("Ratings must be integers from 1 through 5")
        counts = pd.crosstab(pairs.iloc[:, 0], pairs.iloc[:, 1]).reindex(index=range(1, 6), columns=range(1, 6), fill_value=0).to_numpy()
        kappa = cohens_kappa(counts).kappa
        rows.append({"metric": field, "rated": len(pairs), "kappa": float(kappa) if np.isfinite(kappa) else None, "mean": float(values.mean())})
    (directory / "ratings.md").write_text(pd.DataFrame(rows).to_markdown(index=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("results", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--ratings-a", type=Path)
    parser.add_argument("--ratings-b", type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    frame = pd.read_json(args.results, lines=True)
    if "completed" not in frame or not frame.completed.eq(True).all():
        raise ValueError("Analysis requires completed results")
    if frame.key.duplicated().any():
        raise ValueError("Analysis contains duplicate result keys")
    if "results" in frame:
        analyze_anchors(frame, args.out)
    elif "jointSuccess" in frame:
        analyze_agent(frame, args.out)
        if "ta" in frame:
            eligible = frame.ta.map(lambda value: value["actuallyTrapped"])
            frame[["key", "pair", "condition"]].assign(taActuallyTrapped=eligible).to_csv(args.out / "transfer-eligibility.csv", index=False)
            if eligible.any():
                eligible_directory = args.out / "ta-trapped"
                eligible_directory.mkdir(exist_ok=True)
                analyze_agent(frame[eligible], eligible_directory)
    elif "recall1" in frame:
        metrics = ["recall1", "recall3", "recall5", "mrr", "ndcg5"]
        per_task = frame.groupby(["task", "condition"])[metrics].mean()
        table = per_task.groupby("condition").mean()
        table["falseInjections"] = frame.groupby("condition").falseInjections.sum(min_count=1)
        table["queries"] = frame.groupby("condition").size()
        (args.out / "retrieval.md").write_text(table.to_markdown())
    elif "groundedPass" in frame:
        table = frame.groupby("condition")[["validStructure", "validCitations", "mustMentionCovered", "groundedPass"]].mean()
        (args.out / "recap.md").write_text(table.to_markdown())
    if args.ratings_a and args.ratings_b:
        analyze_ratings(args.ratings_a, args.ratings_b, args.out)


if __name__ == "__main__":
    main()
