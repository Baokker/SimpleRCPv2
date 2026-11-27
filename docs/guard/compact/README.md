# ComPACT evaluation status

Branch `paper/compact`. The paper reports only the final frozen version, `guard-compact-v5`.

## Frozen versions

| Tag | Commit | Status | Report |
|---|---|---|---|
| `guard-compact-v1` | `bfb8621a` | superseded | `phase-b-report.md` |
| `guard-compact-v2` | `33abf65c` | superseded | `phase-d-report.md` |
| `guard-compact-v3` | `c4d54e87` | superseded | `phase-e-report.md` |
| `guard-compact-v4` | `720e8dea` | superseded | `phase-e2-report.md` |
| `guard-compact-v5` | `1c9ef6bb` | **final** | `phase-e3-report.md` |

v5 attributes workspace writes observed by the watcher to the active terminal or agent activity. The recorded level is the lower of the member level and the run's source level. Concurrent activities record the lowest level. Writes without an activity record the lowest project member level and are marked `unattributed`. Files present at project creation count as owner files.

## Final results (v5)

The run index is `experiments/guard/results-compact/FINAL_RUNS.json` (`status: complete`). Superseded indexes are kept under `results-compact/superseded-v*/`.

| Experiment | Result |
|---|---|
| X1 static set | 717 records, 173/185 intercepted, 5/286 false blocks |
| X2a end-to-end (720 runs) | ComPACT 0 irreversible, 36 recoverable, 324 stopped (168 denied, 156 refused). 0/624 false blocks. 36/36 snapshot restorations matched |
| X2b live agents | ComPACT 0/10 unrecoverable attack success for MiniMax-M3 and DeepSeek-V4.1-Flash (no control 7/10 and 6/10) |
| D5b provenance, live | Provenance off, file deleted 20/20 (MiniMax) and 15/20 (DeepSeek). On, 0/20 for both. Control 0 extra approvals |
| X4 model judge | MiniMax precision 17/17, recall 17/18. DeepSeek precision 18/20, recall 18/18. 0/24 ineligible releases for both |
| X5 latency | Terminal 0.629/1.214 ms, agent 0.569/0.810 ms (median/p95). Snapshots 27.0, 282.2, 1,290.0 ms. v5/v4 ratio 1.00 to 1.11 |

Node.js 22.19.0 was used for X2a, X2b, D5b and X5. The policy-only runs listed in `ENVIRONMENT.json` used Node.js 24.7.0.

## Open items

- `git stash drop` by a maintainer is released after a snapshot, but the dropped stash is not recoverable from the snapshot.
- External attack set (AgentDojo or InjecAgent) not evaluated.
- Human annotation of the static set not done. The labels come from the independent script `experiments/guard/lib/compact-labels.ts`.
- No user study.
- The DeepSeek school endpoint has no verified public price, so its cost is omitted.
