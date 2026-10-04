import json
import pathlib
import sys
import numpy as np
import matplotlib.pyplot as plt

root = pathlib.Path(__file__).resolve().parents[3]
output = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "experiments/guard/figures"
output.mkdir(parents=True, exist_ok=True)

def latest(experiment):
    folders = sorted((root / "experiments/guard/results" / experiment).glob("*/"))
    return folders[-1] if folders else None

def read_rows(experiment):
    folder = latest(experiment)
    if folder is None:
        return []
    file = folder / "raw.jsonl"
    if not file.exists():
        return []
    return [json.loads(line) for line in file.read_text().splitlines() if line]

def save_na(name, title, xlabel, ylabel):
    fig, ax = plt.subplots(figsize=(7, 4.2))
    ax.text(0.5, 0.5, "Not run", ha="center", va="center", fontsize=22)
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_ylim(0, 1)
    fig.tight_layout()
    fig.savefig(output / name, dpi=180)
    plt.close(fig)

rows = read_rows("X1")
conditions = ["B0", "B1", "B2", "B3", "F"]
intercept = []
false_reject = []
for condition in conditions:
    group = [row for row in rows if row.get("condition") == condition]
    attacks = [row for row in group if row.get("malicious")]
    benign = [row for row in group if not row.get("malicious")]
    intercept.append(sum(row.get("actual") in ("ask", "deny") for row in attacks) / len(attacks) if attacks else np.nan)
    false_reject.append(sum(row.get("actual") in ("ask", "deny") for row in benign) / len(benign) if benign else np.nan)
fig, ax = plt.subplots(figsize=(7, 4.2))
x = np.arange(len(conditions))
ax.bar(x - 0.18, intercept, 0.36, label="Attack interception")
ax.bar(x + 0.18, false_reject, 0.36, label="False rejection")
ax.set_xticks(x, conditions)
ax.set_ylim(0, 1.05)
ax.set_ylabel("Rate")
ax.set_title("X1 Guard conditions")
ax.legend()
fig.tight_layout()
fig.savefig(output / "x1-conditions.png", dpi=180)
plt.close(fig)

rows = read_rows("X3")
keys = []
values = []
for row in rows:
    key = row.get("condition", "")
    if key not in keys:
        keys.append(key)
for key in keys:
    group = [row for row in rows if row.get("condition") == key]
    values.append(sum(row.get("actual") == "ask" for row in group) / len(group) * 100 if group else 0)
fig, ax = plt.subplots(figsize=(11, 4.8))
ax.bar(np.arange(len(keys)), values, color="#4c78a8")
ax.set_xticks(np.arange(len(keys)), [key.replace("|", "\n") for key in keys], rotation=90, fontsize=7)
ax.set_ylabel("Approvals per 100 requests")
ax.set_title("X3 Approval ablation")
fig.tight_layout()
fig.savefig(output / "x3-approval-ablation.png", dpi=180)
plt.close(fig)

save_na("x2-utility-attack.png", "X2 Utility and attack success", "Condition", "Rate")
save_na("x4-calibration.png", "X4 Judge calibration", "Confidence", "Observed risk")

folder = latest("X5")
if folder:
    summary = json.loads((folder / "summary.json").read_text())
    points = summary.get("snapshots", [])
    fig, ax = plt.subplots(figsize=(7, 4.2))
    ax.plot([point["sizeMB"] for point in points], [point["p50Ms"] for point in points], marker="o", label="Snapshot p50")
    ax.plot([point["sizeMB"] for point in points], [point["p95Ms"] for point in points], marker="o", label="Snapshot p95")
    ax.set_xscale("log")
    ax.set_xlabel("Workspace size (MB)")
    ax.set_ylabel("Copy time (ms)")
    ax.set_title("X5 Snapshot overhead")
    ax.legend()
    fig.tight_layout()
    fig.savefig(output / "x5-snapshot-overhead.png", dpi=180)
    plt.close(fig)
else:
    save_na("x5-snapshot-overhead.png", "X5 Snapshot overhead", "Workspace size", "Time")
save_na("x5-concurrency-latency.png", "X5 Concurrent WebSocket latency", "Members", "p95 latency (ms)")
