# 四组实验的复现说明

## 固定环境

平台冻结标签为 `knowledge-exp-freeze-v3.1`，冻结提交 `f0c20bd431024cd900243f73c27b9bbdcccaf947`，实现提交 `95bf21a3379487f647edb2b3ebb2f79b200f9383`。数据提交为 `ea11a85ed344c522fe3b63288cd8577c94fa6498`，包含16个陷阱、6个对照、6对迁移任务。

manifest SHA-256 为 `3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`，配置解析后 SHA-256 为 `1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef`。Node.js 24.7.0、pnpm 9.0.0、OpenCode 1.18.31；Agent 与知识模型均为 `minimax / MiniMax-M3`。文件哈希、真实服务状态与验证记录见 [freeze-v3.1.md](freeze-v3.1.md)。

模型实验必须在该标签对应的独立检出目录运行。可在平台仓库执行以下命令创建同级 worktree，随后进入新目录：

```sh
git worktree add ../SimpleRCPv2-knowledge-exp-v31 knowledge-exp-freeze-v3.1
cd ../SimpleRCPv2-knowledge-exp-v31
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm --filter @simplercp/experiments build
pnpm --filter @simplercp/experiments test
uv sync --project experiments/knowledge/analysis --frozen
```

数据仓库应位于平台同级的 `knowledge-bench`，也可以用 `KNOWLEDGE_BENCH_ROOT` 指定路径。在数据目录执行 `node tools/validate.mjs`，验证全部文件哈希与124份参考补丁的行为判定。数据与判定器保持只读。

## 配置凭据与启动

在本地 `.env` 中填写 `MINIMAX_API_KEY`，`MINIMAX_BASE_URL` 使用 `https://api.minimaxi.com/v1`，`MINIMAX_MODEL`、`AGENT_MINIMAX_MODEL` 均为 `MiniMax-M3`，`KNOWLEDGE_LLM_PROVIDER` 为 `minimax`。API key 仅由服务端读取，OpenCode 使用本机代理。命令、配置、提示词、trace、结果中均不填写 API key。

在平台根目录启动服务，保持该终端运行：

```sh
MINIMAX_MODEL=MiniMax-M3 AGENT_MINIMAX_MODEL=MiniMax-M3 \
KNOWLEDGE_LLM_PROVIDER=minimax \
SIMPLERCP_KNOWLEDGE_EXPERIMENTS=true EXPERIMENT_SPEED=1 \
SIMPLERCP_DATA_DIR="$PWD/experiments/knowledge/.work/server-v31-formal-exp4-speed1/data" \
PORT=4203 SIMPLERCP_OPENCODE_PORT=4215 \
pnpm --filter @simplercp/experiments run server
```

正式运行前使用该实验专用的新数据目录。旧目录累计的工作区文件可能让 Node 服务进程超过系统文件描述符上限，后续 OpenCode 子进程会出现 `spawn EBADF`。服务的 `EXPERIMENT_SPEED` 必须与冻结配置的 `speed=1` 一致。

使用另一个终端读取 `/api/agent/status`，确认 provider 为 minimax、model 为 MiniMax-M3、version 为1.18.31、state 为 ready。runner 还会核验 Agent、知识模块和实验配置三者一致。

## 实验一：并发锚定

本轮使用已有1440条轨迹，不调用模型。来源为 `runs/E2-k7-formal-v21-m3/`，对应标签 `knowledge-exp-freeze-v2.1`、平台提交 `418a4ccc758de803efc5427bea0b0cd09cc26dc5`。来源哈希与每类操作结果见 [实验一报告](exp1/report.md)。

重算操作分组与图：

```sh
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze.py \
  experiments/knowledge/runs/E2-k7-formal-v21-m3/results.jsonl \
  --out experiments/knowledge/.work/exp1-statistics
```

48个锚点为 bootstrap 重采样单位。报告附件 `exp1/cluster-bootstrap.json` 保存10000次重采样的差值区间，`anchors.csv` 保存六类操作的全部指标。

## 实验二：检索与送达

来源为 `knowledge-e3-freeze-v2.4.1` 的220条历史记录，其中132条为 M3 重排。对失败的 C 请求使用同一任务、同一查询变体的 B 最终预算结果。补算不请求模型，相关清单与查询保持固定。

```sh
experiments/knowledge/analysis/.venv/bin/python \
  docs/knowledge/experiments/exp2/summarize.py
```

生成 `exp2/delivery-with-fallback.json` 和 `exp2/delivery.png`。脚本检查来源 SHA-256、唯一 key、132次 M3 请求和5次失败。原查询与改写分别计算；对照误提供依照事前相关清单。完整数字见 [实验二报告](exp2/report.md)。

## 实验三：Agent 复犯

```sh
pnpm --filter @simplercp/experiments exec tsx formal-run.ts EXP3 EXP3
```

执行22任务 × C0/C2/C5 × 3次，共198次。输出为 `runs/exp3-freeze-v31/`。并发上限2；C2 的 top-5、单卡800字符、总4000字符保持固定。每次保存 run、trace、注入、重排用量、工作区快照与冻结行为判定。

运行完成：198/198 条，C0、C2、C5 各66条，运行状态全部为 `completed`。陷阱任务的多数联合成功为 C0 2/16、C2 12/16、C5 12/16；C2 目标卡片送达46/48次，漏送两次均由 `selection-excluded` 过滤。C2 对 C0、C5 对 C0 的多数联合成功差值均为62.50个百分点，95% bootstrap CI [37.50, 87.50]，精确 McNemar p=0.00195，Holm p=0.00781。详情见 [实验三报告](exp3/report.md)。

## 实验四：跨成员纠正迁移

检查实验三汇总后执行：

```sh
pnpm --filter @simplercp/experiments exec tsx formal-run.ts EXP4 EXP4
```

输出为 `runs/exp4-freeze-v31/`。18个共享片段各执行一次 Ta、Yjs 纠正与服务端复盘，再派生独立项目中的T0、T3，共36次Tb。数据仓库 `tools/run-transfer.ts` 用于校准；本实验使用平台 `k4 --shared-episode --conditions T0,T3`。本次运行已完成36/36条，18个 episode 均有共享 Ta `runId` 的 T0/T3 配对。Ta 实际踩坑子集为13个：T0 联合成功0/13，T3 7/13，精确 McNemar p=0.015625。全部episode中 T0 为3/18，T3 为12/18，p=0.00390625。复盘草稿结构合法18/18，引用可解析17/18。详情见 [实验四报告](exp4/report.md)。

甲生成草稿并按冻结规则确认，纠正成员依照 correction.json；乙执行Tb。源属主、作者、确认人与确认时间通过显式成员映射保留。每个 episodeKey 对应同一个 Ta runId 和两个条件，主统计以 Ta 实际踩坑片段为单位配对，另报告全部18个片段、跨属主和自我纠正分组。草稿结构与全部原始引用采用产品解析器和引用检查，确认修改量按增加、删除字符数计算。

T2 使用单独冻结标签 `knowledge-exp-freeze-v3.2`，复用 `runs/exp4-freeze-v31/raw/` 中的18个 episode，不重新执行 Ta 或复盘。命令如下：

```sh
pnpm --filter @simplercp/experiments experiment k4 \
  --config experiments/knowledge/formal-v3.json \
  --source experiments/knowledge/runs/exp4-freeze-v31 \
  --conditions T2 --shared-episode \
  --out experiments/knowledge/runs/exp4-t2-freeze-v31
```

T2 的模型原稿通过实验专用原样确认入口确认，`changedFields` 为空；确认后仍使用与 T3 相同的 BM25、MiniMax-M3 重排、top-5 和字符预算。结果统计与图位于 `runs/exp4-t2-freeze-v31/analysis/statistics/`。

复算 T2 的送达、配对 McNemar、Holm 校正、bootstrap 区间与图：

```sh
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze-t2.py
```

## 恢复与核验

同一冻结提交、数据、配置和输出目录下再次执行正式命令，会按 key 跳过完成组合。额度或请求速率限制会停止安排新任务并取消当前Agent，保留中断原因和最终状态。恢复前确认额度并重启实验服务；中断任务使用新的项目，原始尝试目录保留。已经完成的Ta继续用于同一片段，不重复执行。

单独重算正式统计：

```sh
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze.py \
  experiments/knowledge/runs/exp3-freeze-v31/results.jsonl \
  --out experiments/knowledge/runs/exp3-freeze-v31/analysis/statistics
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze.py \
  experiments/knowledge/runs/exp4-freeze-v31/results.jsonl \
  --out experiments/knowledge/runs/exp4-freeze-v31/analysis/statistics
node docs/knowledge/experiments/verify-artifacts.mjs
```

原43条部分记录保存在 `runs/exp3-freeze-v3/`，不进入正式样本。一次未通过纠正后项目测试的早期 Ta 尝试保存在 `runs/exp4-freeze-v31/raw/P01-episode-3-failure-20261017/`，不计入正式36条结果；同一 episode 后续重跑并通过判定。原E1到E6目录保留，编号对应见 [README](README.md)。冻结前两个真实片段的验收与取消检查位于 `freeze-v31-checks/`，也不进入正式样本。

## 费用与复现范围

实验一整理和实验二补算新增模型费用均为0元。实验三模型费用估算约124.62元；实验四正式结果费用估算约20.05元，另有未纳入正式样本的早期 Ta 尝试估算0.36元。费用按 MiniMax-M3 标准 token 价格估算，供应商实际账单另计。样本数、费用和运行时间见各实验报告。

每百万非缓存输入2.10元、输出8.40元、缓存读取0.42元；单次输入超过512k的请求依照价格规则乘二。Agent inputTokens 为非缓存输入，知识 promptTokens 包含缓存，分别计算。保留原始 cost 字段与估算字段。

并发轨迹与确定性检索可以逐条核验。M3 选择、Agent输出、token和时间会随模型服务变化；完整复现指固定数据、重复次数、协议和统计方法，比较统计结果。构造任务、规定的卡片确认规则与真人协作的适用范围分别说明。
