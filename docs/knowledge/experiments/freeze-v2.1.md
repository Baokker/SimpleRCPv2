# knowledge-exp-freeze-v2.1

## 冻结记录

- 标签：`knowledge-exp-freeze-v2.1`
- 平台提交：`418a4ccc758de803efc5427bea0b0cd09cc26dc5`
- 数据提交：`ea11a85ed344c522fe3b63288cd8577c94fa6498`
- manifest SHA-256：`3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`
- manifest 文件数：2207
- 数据规模：16个陷阱、6个对照、6对迁移任务、2段脚本
- Agent、知识模块和数据校准模型：`minimax / MiniMax-M3`
- Node.js：`v24.7.0`；pnpm：`9.0.0`
- 实际 OpenCode runtime：`1.18.31`，由 `/api/agent/status` 核验
- 记录时间：`2026-10-10T04:44:28.948Z`

旧 `knowledge-exp-freeze-v2` 标签与记录保留。界面、适用范围、复核、注入与实验工具均由上述平台提交冻结。自动测试生成的未提交截图不参与实验输入。

## 配置与文件哈希

| 文件或配置 | SHA-256 |
|---|---|
| `formal-v21.json` 文件 | `a5b41fa275d6380c964038cb3c1e2337f225aa61e304f9aa8c91f78077659d0a` |
| 解析后的正式配置（结果 `configHash`） | `1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef` |
| `review-rules.json` | `eb411586b6b646ac13db2766ee6e054fcf3ca0781361ee8fde087358518b781b` |
| `k3.ts` 条件定义 | `fb6993b84bdbb22dc0dd05972eb435547760e1ff2653206633b7eba413a0e2f8` |
| `k4.ts` 条件定义 | `3b612e71698bbd6c5da89a25ecbaef94038458cccc742f7ee4d75e5c5a5e8ae9` |
| `apps/server/src/knowledge/injection.ts` | `f81c36b3c1c8b915b8c4ac38ba1f1207464c71f246b0015f6e7d228d81585d6d` |
| `packages/knowledge/src/extract/recapPrompt.ts` | `00cf85cf820782d1d8db38ea52231b8a8a0325d7e7cf4e0a75ee6e9828c86b36` |
| 服务端实验状态（包含全部捕获时间配置） | `106fe30d91c2befc8d170bb6cbd5f18d37ad6e2525b86078b427e8bea42238c7` |

正式配置为 HTTP 4203、OpenCode 4205、并发2、三次重复、种子20261007、run等待600000毫秒、延时变体60000毫秒。`speed=1` 使用产品原始捕获时间配置。复盘单次请求120000毫秒，首次失败后最多重试两次，间隔5000毫秒。服务端配置在在线结果目录的 `server-configuration.json` 保存；各组合的知识设置和卡片快照位于其 `raw/` 目录。

## 冻结前检查

- `pnpm build`：通过。
- `pnpm test`：server 160项、knowledge 162项、demo 2项通过；server 9项按配置跳过。
- 实验工具：16项测试与 TypeScript 检查通过。
- 统计工具：5项测试通过。
- 数据工具：19项测试与 TypeScript 检查通过。
- `node tools/validate.mjs`：34个任务、124份参考补丁的预期行为全部通过。
- `pnpm test:e2e`：24项通过、33项按项目配置跳过。
- `pnpm test:e2e:knowledge`：25项通过。

最终基线日志位于平台 `experiments/knowledge/.work/test-freeze-v21-m3.log` 和数据 `.check/validate-freeze-v21-m3.log`。

## 执行命令

在平台目录启动实验服务：

```sh
MINIMAX_MODEL=MiniMax-M3 AGENT_MINIMAX_MODEL=MiniMax-M3 \
SIMPLERCP_KNOWLEDGE_EXPERIMENTS=true EXPERIMENT_SPEED=1 \
SIMPLERCP_DATA_DIR="$PWD/experiments/knowledge/.work/server-v21-m3/data" \
PORT=4203 SIMPLERCP_OPENCODE_PORT=4205 \
pnpm --filter @simplercp/experiments run server
```

凭据由服务端读取平台 `.env`。正式工具核验 Agent 和知识模块两者均为 M3。分步执行并检查汇总：

```sh
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E2 E1
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E4-first E4-first
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E5-core E5-core
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E4-second E4-second
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E6 E6
```

每个阶段记录运行命令、结果、统计和完成检查。相同命令可续跑已保存的组合。冻结后不修改提示词、阈值、判定器、卡片或条件；需要修改实验代码时停止运行并记录影响范围，由人工决定是否重新冻结。
