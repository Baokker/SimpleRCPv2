# exp3-c1-v31 (review item B5)

Full-injection baseline for chapter 5 experiment 3: condition C1 exports all 40 reviewed cards of the
repository to AGENTS.md, which the agent reads automatically; retrieval injection is off. Same 22 tasks,
three repetitions, MiniMax-M3, 66 rows. Run from a worktree pinned at `7f91f7cc` with
`experiments/knowledge/b5-m3.json`; packages and apps match `exp3-freeze-v31` (`f0c20bd4`).
The export is 8.6k to 9.0k characters. Raw workspaces are not committed.

Trap tasks: 14/16 tasks and 42/48 runs jointly successful (C2 in exp3-freeze-v31: 12/16, 34/48).
Paired by task majority, C1 vs C2 is 2 better and 0 worse (sign test p=0.50). R1-T07 and R2-T07 fail
in every condition. Control tasks: 18/18 functional. Median input tokens on trap tasks are about 13%
above C2. This run took place after exp3-freeze-v31, so service drift cannot be ruled out.
