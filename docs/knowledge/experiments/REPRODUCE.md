# 实验复现

## 环境

- 平台目录：`/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2`
- 冻结数据目录：`/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench`
- 标签：`knowledge-exp-freeze-v2`
- Node.js `v24.7.0`、pnpm `9.0.0`、OpenCode `1.18.31`
- provider `minimax`、model `MiniMax-M2`

## 凭据

在平台根目录创建本地 `.env`，填写 `MINIMAX_API_KEY`；需要比较 DeepSeek 时再填写 `DEEPSEEK_API_KEY`。服务端启动时读取这些变量，结果目录只记录 provider、model 和 token，不记录密钥。不要把 `.env` 加入 Git，也不要把密钥传给实验命令的参数或工作区任务。

## 从零检查

```sh
cd /Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench
node tools/validate.mjs

cd /Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2
pnpm install
pnpm build
pnpm test
pnpm --filter @simplercp/experiments build
pnpm --filter @simplercp/experiments test
```

服务端启动：

```sh
PORT=4279 SIMPLERCP_OPENCODE_PORT=4281 \
  AGENT_MINIMAX_MODEL=MiniMax-M2 \
  SIMPLERCP_KNOWLEDGE_EXPERIMENTS=true EXPERIMENT_SPEED=1 \
  pnpm --filter @simplercp/experiments run server
```

## 实验命令

```sh
pnpm --filter @simplercp/experiments experiment k1 \
  --config experiments/knowledge/.work/e4-config.json \
  --out experiments/knowledge/runs/E1-k1-final
pnpm --filter @simplercp/experiments experiment k7 \
  --config experiments/knowledge/.work/e4-config.json \
  --out experiments/knowledge/runs/E2-k7-final
pnpm --filter @simplercp/experiments experiment k5 \
  --config experiments/knowledge/.work/e4-config.json \
  --source experiments/knowledge/runs/E4-C2-pilot \
  --out experiments/knowledge/runs/E3-k5-final-v2
pnpm --filter @simplercp/experiments experiment k4 \
  --config experiments/knowledge/.work/e4-config.json \
  --pilot --variants delayed \
  --out experiments/knowledge/runs/E5-k4-pilot-v2
```

每个运行目录可以续跑。`configuration.json` 会检查 Git 提交、配置哈希、manifest 哈希、provider 和 model；输出中断时不要删除 `failure.json`，修复服务端后使用同一目录继续。

## 统计

```sh
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze.py \
  experiments/knowledge/runs/E2-k7-final/results.jsonl \
  --out experiments/knowledge/runs/E2-k7-final/analysis/statistics
```

K3 主实验、K4 迁移、K2 复盘质量需要服务端和模型请求。费用应从 `AgentRun.usage` 的 token 与估算字段读取；DeepSeek 的 cost 为零时只比较 token 数。

## 可复现范围

当前快照有 10 个陷阱任务、4 个对照任务和 6 对迁移任务。报告中的样本量以结果文件为准，扩充到方案目标后需要创建新的冻结标签。模型输出、墙钟时间和服务限速带来随机差异，结论应使用重复结果与置信区间描述。
