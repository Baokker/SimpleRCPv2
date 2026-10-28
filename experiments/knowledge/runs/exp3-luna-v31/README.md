# exp3-luna-v31

Chapter 5 experiment 3 (C0, C2, C5) rerun with gpt-6-luna as both the agent and the reranking model,
one repetition per task (16 trap and 6 control tasks, 66 rows). Run from a worktree pinned at
`7f91f7cc` with `experiments/knowledge/luna-v3.json`; packages and apps are identical to the
`exp3-freeze-v31` commit `f0c20bd4`. Raw workspaces are not committed.

Trap tasks, joint success: C0 2/16, C2 9/16 (target delivered 12/16, 9 of those succeeded), C5 13/16.
Control tasks: 6/6 in every condition. Paired by task, C2 vs C0 is 7 better and 0 worse (sign test p=0.016),
C5 vs C0 is 11 better and 0 worse (p=0.001). Two C2 reranks failed and fell back to BM25.
