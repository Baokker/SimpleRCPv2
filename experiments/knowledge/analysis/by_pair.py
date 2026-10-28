"""Group the exp4 transfer results by task pair (review item B12).

Each pair runs Alice's task three times, so the 18 episodes are not independent.
This script reports Bob's joint success per pair and condition, on all episodes
and on the episodes where Alice's Agent actually fell into the trap, plus a
pair-level sign test of reference confirmation (T3) against no knowledge (T0).
"""

import argparse
import json
from math import comb
from pathlib import Path

CONDITIONS = ("T0", "T2", "T3")


def load(paths: list[Path]) -> dict[str, dict]:
    episodes: dict[str, dict] = {}
    for path in paths:
        for line in path.read_text().splitlines():
            row = json.loads(line)
            episode = episodes.setdefault(row["episodeKey"], {
                "pair": row["pair"], "crossOwner": row["crossOwner"], "trapped": row["ta"]["actuallyTrapped"]})
            episode[row["condition"]] = {"joint": row["jointSuccess"], "delivered": row["targetInjected"]}
    return episodes


def sign_test(wins: int, losses: int) -> float:
    n = wins + losses
    if n == 0:
        return 1.0
    tail = sum(comb(n, k) for k in range(min(wins, losses) + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def summarize(episodes: dict[str, dict]) -> dict:
    pairs = {}
    for pair in sorted({episode["pair"] for episode in episodes.values()}):
        rows = [episode for episode in episodes.values() if episode["pair"] == pair]
        trapped = [episode for episode in rows if episode["trapped"]]
        count = lambda subset, condition, field="joint": sum(bool(e.get(condition, {}).get(field)) for e in subset)
        pairs[pair] = {
            "crossOwner": rows[0]["crossOwner"], "episodes": len(rows), "trapped": len(trapped),
            "all": {condition: count(rows, condition) for condition in CONDITIONS},
            "trappedOnly": {condition: count(trapped, condition) for condition in CONDITIONS},
            "delivered": {condition: count(rows, condition, "delivered") for condition in CONDITIONS},
        }
    tests = {}
    for subset in ("all", "trappedOnly"):
        diffs = [p[subset]["T3"] - p[subset]["T0"] for p in pairs.values() if subset == "all" or p["trapped"]]
        wins, losses = sum(d > 0 for d in diffs), sum(d < 0 for d in diffs)
        tests[subset] = {"pairs": len(diffs), "T3Better": wins, "T0Better": losses, "ties": len(diffs) - wins - losses,
                         "signTestTwoSided": sign_test(wins, losses)}
    return {"pairs": pairs, "pairLevelT3vsT0": tests}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("results", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    summary = summarize(load(args.results))
    args.out.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(summary["pairLevelT3vsT0"]))


if __name__ == "__main__":
    main()
