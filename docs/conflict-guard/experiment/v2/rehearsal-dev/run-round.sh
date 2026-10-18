#!/bin/sh
# Usage: run-round.sh <round> <policy> ; run from packages/conflict-guard
B=../../docs/conflict-guard/experiment/v2/rehearsal-dev; S=../../docs/conflict-guard/experiment/v2/stage-A3
R=$1; POL=$2
case $POL in G1) CFG=$B/configs/config-G1.json; EXTRA="";; G2-v5) CFG=$B/configs/config-G2-v5.json; EXTRA="";; G3a) CFG=$B/configs/config-G3a.json; EXTRA="--paired-fast";; esac
TYPESAFE_PROXY_URL=http://127.0.0.1:7897 ADJUDICATION_BUDGET_SCOPE=stage-b3-$(echo $POL | tr A-Z a-z) node --experimental-strip-types scripts/adjudication-run.ts --dataset bench/datasets/d1-v4 --split dev --grey-only --policy $POL --provider-mode record --repeat 1 $EXTRA --config $CFG --models $S/models.json --providers $S/providers.json --cache $B/E2-grey/round-$R/model-cache --out $B/E2-grey/round-$R/$POL > $B/E2-grey/round-$R/$POL.log 2>&1
echo "exit $? round $R $POL"
