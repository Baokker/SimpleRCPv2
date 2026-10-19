import hashlib
import json
from datetime import datetime
from pathlib import Path


root = Path(__file__).resolve().parents[4]
output = Path(__file__).resolve().parent
source = root / "experiments/knowledge/runs/exp3-freeze-v3"
server = root / "experiments/knowledge/.work/server-v3/data/projects"
result_file = source / "results.jsonl"
rows = [json.loads(line) for line in result_file.read_text().splitlines() if line]
assert hashlib.sha256(result_file.read_bytes()).hexdigest() == "5bc45cd3cfc97a233a4fcbf8f55ac113fc0335cbf364aa15ce3fb93cee7a3ba7"
assert len(rows) == len({row["key"] for row in rows}) == 43
assert all(row["completed"] and row["commit"] == "76ed3f8757a999c7c58c9a65596552fcee5e0148" for row in rows)
assert all(row["provider"] == "minimax" and row["model"] == "MiniMax-M3" for row in rows)
finished_keys = {row["key"] for row in rows}
pending = []
runs = []
for project_file in sorted((source / "raw").glob("*/project.json")):
    key = project_file.parent.name
    created = json.loads(project_file.read_text())
    initial = json.loads((project_file.parent / "started-run.json").read_text())
    project_id = created["project"]["id"]
    persisted = server / project_id / "agent-runs" / initial["id"] / "run.json"
    current = json.loads(persisted.read_text())["run"]
    runs.append(current)
    if key not in finished_keys:
        pending.append({
            "key": key, "projectId": project_id, "runId": current["id"],
            "status": current["status"], "startedAt": current.get("startedAt"),
            "finishedAt": current.get("finishedAt"), "usage": current.get("usage"),
            "source": str(persisted.relative_to(root)), "resultCollected": False,
        })
assert len(runs) == 45 and len(pending) == 2
conditions = []
for condition in ["C0", "C2", "C5"]:
    group = [row for row in rows if row["condition"] == condition]
    traps = [row for row in group if row["taskKind"] == "trap"]
    controls = [row for row in group if row["taskKind"] == "control"]
    delivered = [row for row in traps if row["targetInjected"] or row["targetRetrieved"]]
    conditions.append({
        "condition": condition, "collectedRuns": len(group), "plannedRuns": 66,
        "controlRuns": len(controls), "controlFunctional": sum(row["functional"] for row in controls),
        "trapRuns": len(traps), "trapFunctional": sum(row["functional"] for row in traps),
        "trapJointSuccess": sum(row["jointSuccess"] for row in traps),
        "trapAvoided": sum(row["trapAvoided"] for row in traps), "targetDelivered": len(delivered),
        "deliveredRecurrence": sum(not row["trapAvoided"] for row in delivered),
        "targetSources": {field: sum(row["targetDelivery"][field] > 0 for row in traps)
                          for field in ["lexical", "fileRelated", "projectFallback"]},
        "rankingSource": {field: sum(row["rankingSource"] == field for row in group)
                          for field in ["m3", "bm25-fallback"]},
        "totalTokens": sum(row["usage"]["totalTokens"] for row in group),
        "estimatedCostCny": sum(row["usage"]["estimatedCost"] for row in group),
        "summedAgentWallMs": sum(row["wallMs"] for row in group),
    })
started = min(datetime.fromisoformat(run["startedAt"]) for run in runs)
finished = max(datetime.fromisoformat(run["finishedAt"]) for run in runs)
artifact = {
    "state": "paused", "plannedCombinations": 198, "collectedResults": len(rows),
    "createdCombinations": len(runs), "notCreated": 198 - len(runs),
    "sourceResults": str(result_file.relative_to(root)),
    "sourceSha256": hashlib.sha256(result_file.read_bytes()).hexdigest(),
    "conditions": conditions, "uncollected": pending,
    "runtimeFailures": [row["key"] for row in rows if row["error"] or row["runStatus"] != "completed"],
    "functionalFailures": [{"key": row["key"], "runStatus": row["runStatus"],
                             "trapAvoided": row["trapAvoided"], "artifacts": row["artifacts"]}
                            for row in rows if not row["functional"]],
    "observedElapsedMs": round((finished - started).total_seconds() * 1000),
    "collectedTotalTokens": sum(row["usage"]["totalTokens"] for row in rows),
    "collectedEstimatedCostCny": sum(row["usage"]["estimatedCost"] for row in rows),
    "knownAgentEstimatedCostCny": sum(run["usage"]["estimatedCost"] for run in runs if run.get("usage")),
    "unknownAgentUsageRuns": [run["id"] for run in runs if not run.get("usage")],
    "rerankCostCny": None, "supplierBilledCostCny": None,
    "inference": "计划矩阵尚未完成，不进行条件间比较。",
}
(output / "partial-status.json").write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(artifact, ensure_ascii=False, indent=2))
