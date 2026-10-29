"""Compare the DeepSeek grey-zone rerun with the main M3 run using the table 4-7 definitions."""
import gzip, json, sys
from collections import Counter

def load(base, r, p):
    d = json.load(gzip.open(f"{base}/round-{r}/{p}/results.json.gz"))
    return {s["id"]: (s["outcome"]["variantKind"], s["outcome"]["decision"]) for s in d["policies"][p]["groups"]}

def summarize(rounds):
    ba, blocked, false_blocks = [], [], []
    for rd in rounds:
        c = [d == "lock" for k, d in rd.values() if k == "conflict"]
        s = [d == "lock" for k, d in rd.values() if k == "safe"]
        ba.append(round(100 * (sum(c) / len(c) + 1 - sum(s) / len(s)) / 2, 1)); blocked.append(sum(c)); false_blocks.append(sum(s))
    unstable = sum(len({rd[i][1] for rd in rounds}) > 1 for i in rounds[0])
    return {"balancedAccuracy": ba, "mean": round(sum(ba) / 3, 1), "conflictBlocked": blocked, "falseBlocks": false_blocks, "unstable": unstable}

main, rerun = sys.argv[1:3]
out, data = {}, {}
for name, base in (("M3", main), ("DeepSeek", rerun)):
    for p in ("G1", "G3a"):
        data[(name, p)] = [load(base, r, p) for r in (1, 2, 3)]
        out[f"{name}-{p}"] = summarize(data[(name, p)])
for p in ("G1", "G3a"):
    a, b = data[("M3", p)], data[("DeepSeek", p)]
    out[f"sameDecision-{p}"] = [round(100 * sum(a[r][i][1] == b[r][i][1] for i in a[r]) / len(a[r]), 1) for r in range(3)]
    out[f"decisionMix-DeepSeek-{p}"] = [dict(Counter(d for _, d in rd.values())) for rd in b]
print(json.dumps(out, ensure_ascii=False, indent=1))
