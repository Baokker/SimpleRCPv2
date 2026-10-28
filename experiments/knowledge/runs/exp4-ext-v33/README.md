# exp4-ext-v33 (review item B12, extension to 12 pairs)

Formal experiment 4 on six added transfer pairs (P07, P12, P13, P15, P16, P18) from
`knowledge-bench-ext` commit `2a50a3d`, platform branch `experiment/exp4-ext-pairs` commit `d2e15217`
(the frozen code of `exp4-freeze-v31` plus review rules for the new pairs and one runner change:
when the corrector revises Ta it also reverts test files the Ta agent added or changed).
T0/T3 here (36 rows) and T2 in `exp4-t2-ext-v33` (18 rows), MiniMax-M3, three repetitions.
`exp4-ext-v32` is the stopped first attempt (8 rows) before the runner change.

Twelve candidate pairs were screened; six failed and are archived in the bench repository with reasons.
New pairs: Ta trapped in 18/18 episodes; Bob joint success T0 0/18, T2 2/18, T3 9/18. T3 delivered the
card in 9/18 episodes and all 9 succeeded; in the other 9 the card was the only recalled candidate but the
reranker excluded it. Combined with the original six pairs (`analysis/by-pair-12.json`): T3 better than
T0 in 8 pairs, worse in 0, tied in 4 (two-sided sign test p=0.0078).
