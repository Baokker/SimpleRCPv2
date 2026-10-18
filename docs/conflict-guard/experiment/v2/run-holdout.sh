#!/bin/sh
# 阶段 C 正式运行入口。用法：在 packages/conflict-guard 下执行 sh ../../docs/conflict-guard/experiment/v2/run-holdout.sh <步骤> [参数]
# 步骤：e2 <轮次> <G1|G2-v5|G3a>；e1-main；e1-ablation；e4；e3 <A0|A1>。E2 每轮先跑 G2-v5 再跑 G3a，G1 可并行。
V=../../docs/conflict-guard/experiment/v2; S=$V/stage-A3; D=bench/datasets/d1-v4
case $1 in
  e2) R=$2; POL=$3
    case $POL in G1) CFG=$V/configs/config-G1.json; EXTRA="";; G2-v5) CFG=$V/configs/config-G2-v5.json; EXTRA="";; G3a) CFG=$V/configs/config-G3a.json; EXTRA="--paired-fast";; *) echo "unknown policy"; exit 2;; esac
    mkdir -p $V/E2-grey/round-$R
    TYPESAFE_PROXY_URL=http://127.0.0.1:7897 ADJUDICATION_BUDGET_SCOPE=stage-c-$(echo $POL | tr A-Z a-z) node --experimental-strip-types scripts/adjudication-run.ts --experiment E2 --dataset $D --split holdout --grey-only --policy $POL --provider-mode record --repeat 1 $EXTRA --config $CFG --models $S/models.json --providers $S/providers.json --cache $V/E2-grey/round-$R/model-cache --out $V/E2-grey/round-$R/$POL > $V/E2-grey/round-$R/$POL.log 2>&1
    echo "exit $? e2 round $R $POL";;
  e1-main) mkdir -p $V/E1-human
    ADJUDICATION_BUDGET_SCOPE=stage-c-e1 node --experimental-strip-types scripts/adjudication-run.ts --experiment E1 --dataset $D --split holdout --policy "P0,P1,P2,P3,P4,P*" --provider-mode replay --repeat 1 --config $V/configs/config-G3a.json --models $S/models.json --providers $S/providers.json --cache $V/E2-grey/round-1/model-cache --out $V/E1-human/main > $V/E1-human/main.log 2>&1
    echo "exit $? e1-main";;
  e1-ablation) mkdir -p $V/E1-human
    TYPESAFE_PROXY_URL=http://127.0.0.1:7897 ADJUDICATION_BUDGET_SCOPE=stage-c-e1-ablation node --experimental-strip-types scripts/adjudication-run.ts --experiment E1 --dataset $D --split holdout --policy P4-no-four-state-typecheck --ablation no-four-state-typecheck --provider-mode record --repeat 1 --config $V/configs/config-G3a.json --models $S/models.json --providers $S/providers.json --cache $V/E1-human/ablation-cache --out $V/E1-human/ablation > $V/E1-human/ablation.log 2>&1
    echo "exit $? e1-ablation";;
  e4) mkdir -p $V/E4-perf
    node --experimental-strip-types scripts/index-run.ts --experiment E4 --dataset $D --split all --k 2 --out $V/E4-perf/index > $V/E4-perf/index.log 2>&1; echo "exit $? e4 index"
    node --experimental-strip-types scripts/replay-counts.ts --trace ../../docs/conflict-guard/evidence/round2-dual-agent/original-source/project-trace.jsonl.gz --run ../../docs/conflict-guard/evidence/round2-dual-agent/original-source/run.json.gz --out $V/E4-perf/candidate-counts > $V/E4-perf/candidate-counts.log 2>&1; echo "exit $? e4 counts";;
  e3) C=$2; case $C in A0) P=P0; INJ=off; REP=1;; A1) P=P5; INJ=on; REP=3;; *) echo "unknown condition"; exit 2;; esac
    cd ../../apps/server; W=../../docs/conflict-guard/experiment/v2
    TYPESAFE_PROXY_URL=http://127.0.0.1:7897 node --import tsx scripts/bench-agents.ts --experiment E3 --policy $P --injection $INJ --repeat $REP --config $W/E3-agent/runtime-config.json --scenarios $W/E3-agent/scenarios.json --out $W/E3-agent/$C > $W/E3-agent/$C.log 2>&1
    echo "exit $? e3 $C";;
  *) echo "unknown step"; exit 2;;
esac
