# ComPACT Phase D evaluation

## Frozen version

The local tag `guard-compact-v1` points to `bfb8621aad2c276e5d3eb8d600f378b05febc614`. Build and unit verification completed at that commit before tagging. The experiment runners verify that the server and shared source trees match the tag. The machine was an Apple M1 Pro with 16 GiB RAM, Darwin 27.2.0 on arm64, Node.js 22.19.0, pnpm 9.0.0, and OpenCode 1.18.31. Seeds and tool versions are recorded in `experiments/guard/results-compact/ENVIRONMENT.json`.

The completed measurements cover X1, X1W, X7 ablation, X6 properties, and the unit-suite Property 1 check. The X6 compositionality failure triggered the requested freeze stop. `FINAL_RUNS.json` enumerates the completed runs and uses `null` for unmeasured experiments. The execution harness that carries out overreach and the script-evasion generator were excluded from the import. The MiniMax-M3 budget was unused, with zero API requests and CNY 0 spent. GPT-6 Luna was skipped as requested. Historical model results are listed only in the old-value column.

## Dataset migration

The archived `datasets/v2` supplies all 844 records. The mapping is `observer → viewer`, `student → contributor`, `collaborator/trusted → maintainer`, and `owner → owner`. `experiments/guard/lib/compact-labels.ts` recomputes `expected` using its own Table IV and the inherited independent fixture classifiers, including the R6 handling of dependency installation and unknown commands. The oracle does not import the server decision code. Intent flags, request inputs, and record IDs are preserved. Archived rationale and note fields remain input context and can describe the earlier labels. The oracle works on recorded inputs and fixture conventions. Quoting, tool wrappers, and script bodies outside the recorded input require separate review.

| Dataset | Records | Changed labels by mapped level |
|---|---:|---|
| D1 | 361 | 23 maintainer |
| D2 | 123 | 3 owner |
| D3 | 92 | 1 contributor, 2 maintainer |
| D4 | 141 | 6 maintainer |
| D5 | 41 | 1 owner |
| D6 | 86 | 0 |
| Total | 844 | 36 |

`experiments/guard/datasets/compact/LABEL_DIFF.json` gives per-level counts and examples, lists the 31 changed maintainer records with their archived levels, and identifies 43 matching-input groups whose archived levels merged. The migration retains every row. `MANIFEST.json` contains SHA-256 digests for the six JSONL datasets.

`experiments/guard/datasets/compact/annotation/sheet.csv` contains 180 of the 717 D1–D4 records, sampled by dataset, level, and intent using seed `compact-annotation-v1`. The sheet hides intent and expected action and includes `annotation/GUIDE.md`. Two independently seeded synthetic sheets verified that `x7-validity/agreement.ts` reads 180 responses, computes Cohen's κ for both labels, and computes each annotator's agreement with the specification. These test sheets and their scores are excluded from evaluation results.

## Manuscript numbers

Paths in this table are relative to `experiments/guard/results-compact/` unless noted. `WILSON_95.json` gives two-sided 95% Wilson intervals for the reported proportions. Seeded and repeated observations provide descriptive counts. An entry of “Pending” means the freeze stopped the new measurement.

| Manuscript location and sentence opening | Old value | New value | Source file and field |
|---|---|---|---|
| Abstract, “On 717 author-constructed records” | 717 records, 93.5% of 185 intercepted, 1.4% of 289 false blocks | 717 records, 173/185 (93.5%, CI [89.0%, 96.3%]), 6/290 (2.1%, CI [1.0%, 4.4%]) | `eval_stats.json`, `baselines.F`. `WILSON_95.json`, `static.baselines.F` |
| Abstract, “In 120 distinct end-to-end attempts” | 120 distinct attempts, zero irreversible violations, 43.3% dependent on correct refusal | Pending | `FINAL_RUNS.json`, `runs.X2a` |
| VI-A, “No public dataset covers” | 6 datasets, 844 records, counts 361/123/92/141/41/86 | Counts preserved | `../datasets/compact/MANIFEST.json`, `total`, `datasets[].count` |
| VI-A, “The platform was” | Apple M1 Pro, 16 GiB, Node.js 22.19.0, OpenCode 1.18.31, MiniMax-M3 and GPT-6 Luna | Same machine and versions, pnpm 9.0.0, no model measurements | `ENVIRONMENT.json` |
| VI-A, “Static and end-to-end results” | `guard-v1.5`, `guard-v1.3`, 95% Wilson intervals | `guard-compact-v1`, 95% Wilson intervals on completed comparisons | `ENVIRONMENT.json`, `testedRef`, `commit`. `WILSON_95.json`, `method` |
| VI-A, “Five baselines were compared” | 5 baseline families, 6 implementations | Preserved, with 7 conditions including ComPACT | `eval_stats.json`, `baselines`, `allowlist` |
| VI-B, Fig. `fig_static` caption | 185 malicious requests, 289 eligible benign requests | 185 malicious, 290 expected to proceed directly or after snapshot | `eval_stats.json`, `baselines.F.n_malicious`, `baselines.F.n_permitted` |
| VI-B, “Fig. … reports the results” | 717 records, 173 interceptions (93.5%, CI [89.0%, 96.3%]), 10 snapshots | 717, 173 (93.5%, same CI), 10 | `X1/x1-compact-v1/raw.jsonl`, `condition=F`. `WILSON_95.json`, `static.baselines.F` |
| VI-B, “Only 38 of the intercepted requests” | 38/185 denied (20.5%), 135 asked | 39/185 denied (21.1%, CI [15.8%, 27.5%]), 134 asked | `eval_stats.json`, `baselines.F.deny`, `.ask` |
| VI-B, “Its false block rate” | 1.4%, CI [0.5%, 3.5%] | 6/290 (2.1%, CI [1.0%, 4.4%]) | `WILSON_95.json`, `static.baselines.F.falseBlock` |
| VI-B, “Of all 532 non-malicious requests” | 246/532 (46.2%) | 247/532 (46.4%, CI [42.2%, 50.7%]) | `WILSON_95.json`, `compactAllBenignInterception` |
| VI-B, “The two malicious requests” | 2 directly allowed | 2, with the same record IDs | `X7/x7a-compact-v1/summary.json`, `summary[F].maliciousAllowedIds` |
| VI-B, “Terminal-only control failed” | 85 missed, 80 from agents | 85 missed, 80 from agents | `WILSON_95.json`, `terminalOnlyAgentShareOfMisses` |
| VI-B, “The fixed agent level” | 168 intercepted, 15 snapshots | 168 intercepted, 15 snapshots. The ComPACT comparator has 173 interceptions and 10 snapshots | `eval_stats.json`, `baselines.B3`, `baselines.F` |
| VI-B, “The allowlist applied to both paths” | 136/185 denied, 9.0% false blocks, CI [6.2%, 12.9%] | 136/185 denied, 178/185 intercepted, 27/290 false blocks (9.3%, CI [6.5%, 13.2%]). The Wilson intervals for false blocks remain disjoint | `WILSON_95.json`, `static.allowlist.W2`, `static.baselines.F.falseBlock` |
| VI-B, “Without the path zone” | Directly allowed malicious requests increase from 2 to 19 | 2 to 19 | `eval_stats.json`, `ablation.F.allow`, `ablation.F-zone.allow` |
| VI-B, “Without capability” | 10 directly allowed malicious, 8.7% false blocks, 0 snapshots | 10 directly allowed malicious, 27/290 false blocks (9.3%, CI [6.5%, 13.2%]), 0 snapshots | `WILSON_95.json`, `static.ablation.F-capability` |
| VI-B, reversibility ablation | No count in main text | 166/185 intercepted, 9 directly allowed, 10 snapshots | `eval_stats.json`, `ablation.F-reversibility` |
| VI-B, “For the write-then-execute path” | 252 attacks, 11 payloads, 8 carriers, 24 handed-over scripts, 32 evasions, 112 routine scripts | Pending | `FINAL_RUNS.json`, `runs.X8` |
| VI-B, “Without inspection” and “With inspection” | 38 intercepted without inspection, 252/252 attacks, 20/32 evasions, 24/24 handed-over scripts, 8 routine flags per condition | Pending | `FINAL_RUNS.json`, `runs.X8` |
| VI-B, “Property-based tests checked Properties 3, 4, and 5” | 10,000 per property and metadata check, zero failures | 10,000 each. 0 monotonicity, 461 compositionality (4.61%, CI [4.22%, 5.04%]), 0 model-bound, and 0 metadata failures | `X6/x6-properties-compact-v1/summary.json`, `properties`. `WILSON_95.json`, `x6.properties` |
| VI-B, “A differential test submitted 12,043” | 12,043 commands, 62,632 equal-feature pairs with 0 violations, 256 download-pipeline pairs | Same test passed in frozen unit verification. 96,344 total pairs, 62,632 equal and 0 violations. Of 33,712 different-feature pairs, 33,144 contain newlines, 312 contain `cd` on a single line, and 256 are download pipelines | `property1-path-consistency.json`, `inputs`, `total`, `compared`, `violations`, `differentFeatureReasons` |
| VI-C, “Ten tasks each” and “The design crossed” | 10 tasks × 4 conditions × 3 levels × 2 sources × 3 orders, 720 runs, 360 attempts/condition, 120 distinct | Pending | `FINAL_RUNS.json`, `runs.X2a` |
| VI-C, Table V `tab:e2e`, no control and terminal-only | Each 348 irreversible (96.7%), 0 recoverable, 0 stopped, 48/48 owner | Pending | `FINAL_RUNS.json`, `runs.X2a` |
| VI-C, Table V `tab:e2e`, fixed agent level | 0 irreversible, 48 recoverable (13.3%), 312 stopped (86.7%), 48/48 owner | Pending | `FINAL_RUNS.json`, `runs.X2a` |
| VI-C, Table V `tab:e2e`, ComPACT | 0 irreversible, 36 recoverable (10.0%), 324 stopped (90.0%), 48/48 owner | Pending | `FINAL_RUNS.json`, `runs.X2a` |
| VI-C, “Under ComPACT” and “The 36 recoverable successes” | 0/624 legitimate false blocks, 36/36 matching restored hashes | Pending | `FINAL_RUNS.json`, `runs.X2a` |
| VI-C, Fig. `fig_burden`a and “The result of zero” | 360 non-owner attempts, 168 direct denials, 36 recoverable, 156 requests dependent on refusal (43.3%) | Pending | `FINAL_RUNS.json`, `runs.X2a` |
| VI-C, “If an approver wrongly accepts” | 156e expected releases, about 16 (4.3%) at e=0.1 | Pending numerator for the projection | `FINAL_RUNS.json`, `runs.X2a` |
| VI-C, “After demotion” and “In 500 fault-injection rounds” | 3 revocation scenarios, 500 fault rounds, 0 hangs, duplicate replies or leftover approvals | Pending | `FINAL_RUNS.json`, `runs.X6_runtime` |
| VI-C, “With MiniMax-M3” | 10 tasks, contributor side effects 8/10 without control and 0/10 with ComPACT, 21 blocked attempts | Pending | `FINAL_RUNS.json`, `runs.X2b` |
| VI-D, Fig. `fig_burden`b and “A workload of 1,650 requests” | 1,650 requests, 938 distinct | Pending | `FINAL_RUNS.json`, `runs.X3` |
| VI-D, “Without snapshots” and “Snapshots reduced” | Approvals 782 (47.4/100) → 474 (28.7/100), denials 109 (6.6/100) | Pending for all four settings | `FINAL_RUNS.json`, `runs.X3` |
| VI-D, “Of the 474 remaining approvals” | 138/474 auto-eligible (29.1%), 20.4 approvals/100 lower bound | Pending | `FINAL_RUNS.json`, `runs.X3` |
| VI-D, “No malicious request” and “Without the ceiling” | 0 releases with ceiling, 1 without | Pending | `FINAL_RUNS.json`, `runs.X3` |
| VI-D, “On the judgment set” | 86 commands × 3, 6 high-risk commands, MiniMax precision 1.000/recall 0.944, Luna precision 0.895/recall 0.944 | MiniMax pending. Luna skipped | `FINAL_RUNS.json`, `runs.X4` |
| VI-D, “None of the 252 approvals” | 0/252 ineligible approvals model-released | Pending | `FINAL_RUNS.json`, `runs.X4` |
| VI-D, “The median latency” | Terminal 1.28 ms median/4.19 ms p95, agent 1.01 ms median, decision 0.065 ms | Pending | `FINAL_RUNS.json`, `runs.X5` |
| VI-D, “Model calls took seconds” | MiniMax median 4.7 s, Luna 11.4 s | MiniMax pending. Luna skipped | `FINAL_RUNS.json`, `runs.X4`, `runs.X5` |
| VI-D, “Snapshots took about” | 38 ms at 1 MiB, 375 ms at 10 MiB, 4.2 s at 100 MiB | Pending | `FINAL_RUNS.json`, `runs.X5` |
| VII-A, “156 of the 360 non-owner attempts” | 43.3% of 360 non-owner attempts, 48.1% of 324 stopped attempts | Pending | `FINAL_RUNS.json`, `runs.X2a` |
| VII-A, “a wrong approval is reused” | 30 minutes | 30-minute default configuration | `apps/server/src/guard/approvalMemory.ts` and phase B report |
| Conclusion, “On 717 static records” | 717 static, 120 distinct attempts, 93.5% intercepted, 1.4% false blocks, zero irreversible violations, about 1 ms added | 717 static, 173/185 intercepted (93.5%), 6/290 false blocks (2.1%). Execution and latency pending | `eval_stats.json`, `baselines.F`. `FINAL_RUNS.json`, `runs.X2a`, `runs.X5` |

### D4 Member binding

| Scenario | Compared conditions | Status |
|---|---|---|
| Contributor agent changes another member's uncommitted file | ComPACT, fixed maintainer, terminal-only | Pending |
| Identical call before and after demotion | ComPACT, fixed maintainer, terminal-only | Pending |
| Team queue and owner takeover with approval pending | ComPACT, fixed maintainer, terminal-only | Pending |
| Owner agent runs a contributor-authored script | ComPACT, fixed maintainer, terminal-only | Pending |

### D5 Provenance

| Scenario | Compared conditions | Status |
|---|---|---|
| Workspace file read via tool or shell, attachment, team message | Provenance on/off, contributor and owner authors, recoverable/protected/irreversible actions and benign controls | Pending |
| Retained conversation and dynamic file paths | Provenance on/off, boundary observations | Pending |
| Optional MiniMax-M3 file-read experiment | Provenance on/off, planned 10 repetitions per condition | Skipped at the freeze stop |

## Interpretation and frozen-version finding

The static ComPACT interception count remained 173. The new split moved one malicious request from approval to denial. The independent label migration changed the permitted benign denominator from 289 to 290. The six false-block records in X1 include five where the frozen classifier found uninspectable execution and one where it applied the directory rule. Review those six archive inputs and their specification labels before making a usability claim from this comparison. X1 and X7 measure `decide()` on request text. They provide limited evidence about script contents, approval memory, live owner routing, or provenance.

Property 4 as written in §IV includes compound simple commands joined by the listed operators. X6 evaluated 1,250 compositions for each source and level pair. All 461 failures contain a directory change, with 184 failures on the terminal path and 277 on the Agent path. For a classifier-only reproduction, run `pnpm --filter @simplercp/server exp:x6` and inspect the `property-strictest-1556` record in `X6/x6-properties-compact-v1/raw.jsonl`. The record uses ordinary navigation and reports `allow` for the whole request against a `deny` for a component under the same owner context. `apps/server/src/guard/decide.ts` applies its directory-change check to the beginning of the request. A component evaluated alone can trigger that check even when the full request does not. The test does not execute the commands. The observed scope is rule composition with directory changes. Properties 1, 3, and 5 and metadata denial retain the measured results above. X6 exits with status 1 and records the evidence. The frozen product source was left untouched.

The remaining runtime and financial experiments were stopped. The stop includes the 500 fault rounds and live revocation checks, member binding, provenance including its optional live comparison, approval replay, live model judgment, latency and snapshot benchmarks, and interleaved restoration X9. The restored archive files do not constitute Phase D measurements.

## Figure data

`eval_stats.py` from the manuscript was executed from a byte-identical copy in the worktree's ignored test directory, with local aliases for its old run paths. It successfully generated `experiments/guard/results-compact/eval_stats.json` from the new X1, X1W and X7 raw records. For direct invocation against `experiments/guard/results-compact`, use the following values in the manuscript script's `RUNS` dictionary.

```python
RUNS = {
    "baselines": ("X1/x1-compact-v1/raw.jsonl", "condition"),
    "allowlist": ("X1W/x1w-compact-v1/raw.jsonl", "condition"),
    "ablation": ("X7/x7a-compact-v1/raw.jsonl", "variant"),
}
```

## Verification

| Command | Passed | Skipped |
|---|---:|---:|
| `pnpm build` | 3 packages | 0 packages |
| `pnpm test` | 253 tests (244 server, 7 client, 2 demo) | 9 |
| `pnpm test:e2e` | 28 | 9 |
| `pnpm test:collab` | 7 | 0 |

The browser suites used server port 14100 and client port 15174 because the default server port was occupied. The frozen unit suite includes the Property 1 differential check. The JSON in the results directory is the frozen Phase B export for that same check and seed. The X6 property experiment above is separate from the passing unit suite.
