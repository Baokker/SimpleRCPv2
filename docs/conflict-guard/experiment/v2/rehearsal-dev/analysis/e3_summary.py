"""E3 agent scenario summary.

For each run: acceptance, T2 decisions with rule ids, T3 outcome, guard model calls, approval wait,
costs. For human-agent runs a T2 lock counts as correct when the blocked proposal still reads the
field the human renamed (taken from the scenario's human edit); other locks are listed for review.
Usage: python3 e3_summary.py <scenarios.json> <run dir> [<run dir> ...] [--json out.json]
"""
import difflib
import json
import re
import sys
from pathlib import Path


def stale_fields(scenario: dict) -> set[str]:
    fields = set()
    for edit in scenario.get("humanEdits", []):
        before = set(re.findall(r"[A-Za-z_]\w*", edit["find"]))
        after = set(re.findall(r"[A-Za-z_]\w*", edit["replace"]))
        fields |= before - after
    return fields


def added_lines(proposal: dict) -> str:
    diff = difflib.unified_diff(proposal["before"].splitlines(), proposal["after"].splitlines(), lineterm="")
    return "\n".join(line[1:] for line in diff if line.startswith("+") and not line.startswith("+++"))


def summarize_run(path: Path, scenario: dict) -> dict:
    result = json.loads(path.read_text(encoding="utf8"))
    events = [json.loads(line) for line in path.with_suffix(".jsonl").read_text(encoding="utf8").splitlines() if line.strip()]
    stale = stale_fields(scenario)
    t2, pending = [], None
    for event in events:
        if event["type"] == "agent_proposal":
            pending = "\n".join(added_lines(p) for p in event["proposals"])
        if event["type"] == "pair_judged" and event["pairId"].startswith("T2"):
            last_rule = event["verdict"].get("ruleId")
        if event["type"] == "t2_judged":
            reads_stale = bool(stale) and any(re.search(rf"[.{{,\s]{re.escape(f)}\b", pending or "") for f in stale)
            t2.append({"decision": event["decision"], "rule": locals().get("last_rule"), "readsStale": reads_stale})
    calls = [e for e in events if e["type"] == "provider_call" and e.get("status")]
    runs = result.get("traces", [])
    return {
        "name": path.stem, "scenario": result["taskId"], "category": scenario["category"], "round": result["round"],
        "success": result["acceptance"]["exitCode"] == 0, "t2": t2,
        "t3": [r["run"].get("conflictGuard", {}).get("t3") for r in runs],
        "cards": len(result.get("cards", [])),
        "approvalWaitMs": sum((r["run"].get("conflictGuard") or {}).get("approvalWaitMs", 0) or 0 for r in runs),
        "guardCalls": len(calls), "guardCallStatuses": sorted({c["status"] for c in calls}),
        "guardLatencyMs": [c.get("latencyMs") for c in calls],
        "agentCostUsd": result["agentCostUsd"], "guardCostUsd": result["guardCostUsd"],
        "trigger": (result.get("humanInjection") or {}).get("trigger"),
    }


def main() -> None:
    args = sys.argv[1:]
    out = None
    if "--json" in args:
        out = args[args.index("--json") + 1]
        args = args[: args.index("--json")]
    scenarios = {s["id"]: s for s in json.loads(Path(args[0]).read_text(encoding="utf8"))["scenarios"]}
    rows = []
    for directory in args[1:]:
        for path in sorted(Path(directory).glob("*-[0-9].json")):
            data = json.loads(path.read_text(encoding="utf8"))
            rows.append({"condition": Path(directory).name, **summarize_run(path, scenarios[data["taskId"]])})
    for row in rows:
        t2 = " ".join(f"{x['decision']}({x['rule']}{',stale' if x['readsStale'] else ''})" for x in row["t2"])
        print(f"{row['condition']:3} {row['name'][:44]:44} {'ok  ' if row['success'] else 'FAIL'} T2[{t2}] T3{row['t3']} wait {row['approvalWaitMs']/1000:.1f}s guard {row['guardCalls']} ${row['guardCostUsd']:.4f} agent ${row['agentCostUsd']:.4f}")
    if out:
        Path(out).write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
