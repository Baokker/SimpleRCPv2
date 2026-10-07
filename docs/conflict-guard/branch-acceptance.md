# `feature/conflict-guard` 分支人工验收指南

本文用于验收 `/Users/baokker/Work/Master/CSCW/智能语义冲突预防-update/SimpleRCPv2` 的 `feature/conflict-guard` 分支。分支包含阶段 0 至阶段 8 检查点 C 的实现与证据。

当前阶段八状态是“等待人工确认”。冻结清单已经生成，正式 X1 至 X7 实验尚未执行，保留集策略评价尚未执行。人工确认冻结清单前，不要运行会改变实验材料的正式实验命令。

## 1. 分支完成的主要内容

### 阶段 0：协作基础与 Agent 轨迹

- 保存成员身份、编辑来源、光标、批次和文件变更记录。
- 记录个人 Agent、团队 Agent、OpenCode session、run、工具调用和文件归属。
- 对 Agent 并行任务提供队列、超时、取消、运行记录和错误隔离。
- 通过 `trace.jsonl`、项目元数据和 Agent run 目录保存可追溯证据。

### 阶段 1：编辑归属与协作轨迹

- 维护 human、agent、filesystem、unknown 等编辑来源。
- 将连续输入合并为批次，维护活跃变更集和字符范围。
- 记录编辑前后文本、文件、成员、时间、光标和来源。
- 对未知来源只记录一次提示，避免单次异常影响服务运行。

### 阶段 2：语义索引与候选对

- 使用 TypeScript LanguageService 建立符号和关系索引。
- 支持函数、类、方法、属性、接口、类型别名、枚举和模块变量。
- 支持调用、值引用、类型引用、继承、实现、状态读写、重导出和悬空引用。
- 通过 `symbolsInRange` 将文本编辑映射到符号变更。
- 在两跳关系范围内生成稳定的候选变更对。
- 支持增量更新、别名、重导出、改名、删除和跨文件引用。

### 阶段 3：本地分区、闸门、冻结和冲突卡片

- 按规则把候选对分为白区 `allow`、灰区 `warn`、黑区 `lock`。
- 黑区暂停相关文件写入，维护随文本编辑移动的冻结范围。
- 支持 T0 提示、灰区通知、冲突卡片、双方确认和“我来改”撤回。
- Y.Doc 在闸门关闭、未写入修改、活跃变更或未关闭变更对存在时保持固定。
- 成员 Undo 范围按成员 ID 维护，成员关闭全部连接后仍可以撤回。
- 外部文件修改通过 Yjs 快照副本合并，避免覆盖未写入的协作内容。
- 闸门、判定、冻结、写入、撤回、重同步和 `persist_conflict` 事件进入轨迹。

### 阶段 4：无头回放与 D1/D2 基准

- `src/replay/` 使用虚拟时钟、内存文件提供者和产品代码驱动真实 tracker、语义索引、分区器与状态机。
- 支持 P0 无协调、P1 文件锁、P2 静态符号锁、P3 本地规则和 P* 预言机策略。
- 回放结果包含判定、候选对、闸门、冻结、写入、反事实编辑、冻结人秒和指标。
- `replay:check` 可以比较服务端轨迹与离线回放，full 模式可以从缓存恢复模型判定。
- D1 使用八个结构不同的种子项目，包含 200 个关系组，按项目划分开发集和保留集。
- 四状态探针在子进程中执行，状态为 baseline、leftOnly、rightOnly、merged。
- D2 导入 GreyLock 规则案例和轨迹，保留原始来源、哈希和当前实现的差异。

### 阶段 5：灰区模型研判

- 提供 `FastJudge` 与 `DeepJudge` 角色接口，适配器通过配置注册。
- 提供 Jev 快判、DeepSeek 深判和 OpenAI-compatible 适配器。
- G0 一律 warn，G1 只调用深判，G2 只调用快判，G3 按置信度升级，G4 按时点配置策略。
- 灰区研判期间文本继续同步，相关区域标黄，文件写入闸门关闭。
- 支持 2 秒软提示、8 秒 T1 截止、取消、revision 变化丢弃旧结果和并发请求合并。
- 共享不变量包含调用点、测试断言、修改前注释和返回值使用方式。
- 缓存键包含输入、角色、适配器、模型、完整提示词和请求参数。
- `live`、`record`、`replay` 三种模式分别对应联网调用、脱敏录制和离线回放。
- 轨迹只记录 `provider_call` 元数据，密钥与原始认证内容不写入轨迹、报告和缓存。

### 阶段 6：Agent T2/T3 闸门

- OpenCode 的 edit、write、apply_patch 权限在 `rules`、`full` 模式下使用 `ask`。
- T2 在 Agent 写入前解析提案、恢复 before/after、复用语义分区管线并给出 `once` 或 `reject`。
- 本地黑区、冻结文件、冻结范围、模型失败和格式无效会拒绝 Agent edit。
- Agent 放行后的文件回灌归属到对应 run，进入活跃变更集和候选对。
- T3 在 run 完成、失败、取消或超时后检查依据变化，并按块三方比较撤回 Agent 修改。
- 人与 Agent 冲突时保持人的编辑可用；Agent 与 Agent 冲突时后到者受到限制。
- 通过权限分发器处理多个审批处理函数、子 session、挂起、超时和异常隔离。
- Agent 面板显示拒绝次数、最近原因、T2/T3 来源、撤回结果和属主通知。

### 阶段 7：意图板与属主仲裁

- run 开始时解析 `PLAN:` 计划，维护计划范围、实际范围、任务修订和状态。
- 项目级 Y.Map 同步活动 Agent 的属主、任务、计划范围、实际范围和状态。
- 意图注入可以使用 `CONFLICT_GUARD_INTENT_INJECTION=on|off` 单独控制。
- `owner`、`all-human`、`all-auto` 三种模式由纯函数仲裁。
- 同一属主的 Agent 自动等待和重试；人与 Agent 冲突时人保持可用；跨属主 Agent 冲突时显示意图差异卡片。
- 卡片支持双方采纳建议、某一方让 Agent 让路、聊天协商和超时处理。
- 统计记录卡片打扰、轻提示、按冲突双方类型的次数、处理方式和挂起时长。
- D3 包含十个跨属主任务对和三个同属主任务对，提供任务验收脚本和真实 Agent 冒烟材料。

### 阶段 8 检查点 C：实验冻结材料

- 冻结代码提交、D1/D2/D3 数据、规则、指标、模型、提示词、阈值、价格和实验预算。
- D1 抽取 40/200 个关系组，生成双方修改、探针结果和自动标签材料。
- 提供两份独立标注模板，重复导出会保留已经填写的 reviewer 文件。
- 核验 D1 压缩归档、开发集录放缓存、校准缓存、输入哈希和模型调用引用。
- 冻结导出前重新构建 `@simplercp/conflict-guard`，保证提示词和分类逻辑来自当前源码。
- 输出目录和所有生成文件都检查真实路径，仓库外部符号链接会终止导出。
- 当前材料状态由 `readyForExperiments=false` 明确表示。

## 2. 主要零件与功能点

| 零件 | 位置 | 功能 |
|---|---|---|
| 编辑追踪器 | `packages/conflict-guard/src/tracking/` | 维护成员、批次、光标、来源、活跃变更集和时间。 |
| 语义索引 | `packages/conflict-guard/src/semantic/` | 建立符号、调用关系、重导出、类型关系和增量索引。 |
| 分区分类器 | `packages/conflict-guard/src/routing/` | 按规则和四状态检查返回白区、灰区或黑区。 |
| 变更对状态机 | `packages/conflict-guard/src/coordination/pairState.ts` | 维护 revision、pending、judged、stale、确认、冻结和关闭。 |
| 会话编排器 | `packages/conflict-guard/src/coordination/session.ts` | 统一批次关闭、闸门、冻结、异常处理、T0 和轨迹事件。 |
| Agent 检查 | `packages/conflict-guard/src/coordination/agentGuard.ts` | 计算 Agent 提案、共享文本合并、T3 按块撤回和跳过交叠块。 |
| 回放引擎 | `packages/conflict-guard/src/replay/` | 使用虚拟时间执行轨迹，复现产品判定和指标。 |
| 基准生成器 | `packages/conflict-guard/src/bench/` | 选择真实符号调用关系，生成轨迹、探针、标签和数据集清单。 |
| 模型角色 | `packages/conflict-guard/src/adjudication/` | 提供 FastJudge、DeepJudge、提示词、不变量、缓存和录放。 |
| 权限分发器 | `apps/server/src/agent/permissionDispatcher.ts` | 接收 OpenCode 权限事件，按注册顺序处理 once、reject、defer。 |
| Agent 提案处理 | `apps/server/src/agent/conflictGuardEditHandler.ts` | 解析 edit/write/apply_patch 提案，执行 T2 并生成拒绝消息。 |
| Agent 项目保护 | `apps/server/src/conflictGuard/projectAgentGuard.ts` | 保存 run 快照、预约、归属、T2/T3 结果和通知。 |
| 意图与仲裁 | `packages/conflict-guard/src/coordination/intents.ts`、`arbitration.ts`、`ownerCards.ts` | 维护意图、属主关系、卡片、建议和打扰统计。 |
| 服务端状态接口 | `apps/server/src/routes/conflictGuardRoutes.ts` | 提供冲突状态、轨迹、卡片操作、确认、撤回和聊天入口。 |
| 客户端面板 | `apps/client/src/components/ConflictGuardPanel.tsx`、`AgentPanel.tsx` | 展示正在修改、意图板、模型研判、冻结、卡片和 Agent 结果。 |
| 冻结导出工具 | `packages/conflict-guard/scripts/experiment-freeze.ts` | 生成检查点 C 清单、哈希、抽检材料、缓存索引和预算。 |
| 冻结验证工具 | `packages/conflict-guard/scripts/experiment-freeze-check.ts` | 验证确定性、人工表格保留、归档缓存、符号链接路径和密钥扫描结果。 |

## 3. 环境准备

### 3.1 安装依赖和构建

在仓库根目录执行：

```bash
pnpm install
pnpm -r build
```

建议使用 Node.js 24.7.0 与 pnpm 9。测试会把临时数据放入仓库内的 `.test-workspaces/`，该目录已加入 `.gitignore`。

### 3.2 配置 API Key

在仓库根目录建立 `.env`。这个文件已经被 Git 忽略，凭据只允许放在这里或运行环境变量中：

```dotenv
DEEPSEEK_API_KEY=<DeepSeek key>
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
TYPESAFE_API_KEY=<TypeSafe key>
# 可选：TYPESAFE_BASE_URL=https://api.typesafe.ai

# 可选的 OpenAI-compatible 深判或快判端点
# ADJUDICATION_COMPATIBLE_API_KEY=<compatible key>
# ADJUDICATION_COMPATIBLE_BASE_URL=https://example.invalid/v1
# ADJUDICATION_COMPATIBLE_MODEL=<model name>
```

服务端从根目录 `.env` 读取 `DEEPSEEK_*` 和 `TYPESAFE_*`。客户端不需要 API Key。不要把 Key 写进 `VITE_*` 变量、浏览器请求、日志、轨迹、缓存、报告或截图。

验收结束后执行密钥扫描：

```bash
node scripts/verify-evidence-secrets.mjs
```

成功输出应为：

```json
{"configuredValuesFound":0}
```

### 3.3 服务端和客户端启动

为了隔离人工验收数据，使用仓库内临时目录：

```bash
mkdir -p .test-workspaces/manual-data
```

终端一启动服务端：

```bash
PORT=4000 \
SIMPLERCP_DATA_DIR="$PWD/.test-workspaces/manual-data" \
SIMPLERCP_IMPORT_ROOTS="$PWD/demo" \
SIMPLERCP_TERMINAL_ENABLED=true \
SIMPLERCP_FAKE_AGENT_RUNTIME=false \
CONFLICT_GUARD=rules \
pnpm --filter @simplercp/server dev
```

终端二启动客户端：

```bash
VITE_SIMPLERCP_API_ORIGIN=http://127.0.0.1:4000 \
pnpm --filter @simplercp/client exec vite --host 127.0.0.1 --port 5173
```

打开 <http://127.0.0.1:5173>。服务端健康检查地址为 <http://127.0.0.1:4000/api/health>。

创建项目时导入：

```text
<仓库根目录>/demo/conflict-shop
```

`demo/conflict-shop` 包含 `src/pricing.ts`、`src/cart.ts`、`src/checkout.ts`、`src/report.ts`、`src/types.ts` 和测试文件，适合阶段三到阶段七的人工流程。

## 4. 模式和关键配置

服务端启动时通过环境变量读取配置：

| 变量 | 取值 | 作用 |
|---|---|---|
| `CONFLICT_GUARD` | `off` / `observe` / `rules` / `full` | 关闭、只观察、本地规则、规则加模型和 Agent 防护。 |
| `CONFLICT_GUARD_STRATEGY` | `G0` 到 `G4` | full 模式的人与人灰区策略，默认 `G3`。 |
| `CONFLICT_GUARD_THRESHOLD` | 数字 | G3 快判升级阈值，冻结配置使用开发集校准值。 |
| `CONFLICT_GUARD_PROVIDER_MODE` | `live` / `record` / `replay` | 模型联网、录制或离线缓存。 |
| `CONFLICT_GUARD_INVARIANTS` | `true` / `false` | 开启或关闭共享不变量上下文。 |
| `CONFLICT_GUARD_ARBITRATION` | `owner` / `all-human` / `all-auto` | Agent 冲突的属主仲裁模式。 |
| `CONFLICT_GUARD_INTENT_INJECTION` | `on` / `off` | 开启或关闭意图注入。 |
| `CONFLICT_GUARD_T2_STRATEGY` | `G1` / `G2` / `G3` | Agent 写前闸门策略。 |
| `CONFLICT_GUARD_T3_STRATEGY` | `G1` / `G2` / `G3` | Agent run 结束复检策略。 |
| `CONFLICT_GUARD_T2_REASONING` | `true` / `false` | T2 深判是否开启 reasoning。 |
| `CONFLICT_GUARD_T3_REASONING` | `true` / `false` | T3 深判是否开启 reasoning。 |
| `SIMPLERCP_FAKE_AGENT_RUNTIME` | `true` / `false` | 自动化测试使用 fake runtime；真实 Agent 验收使用 `false`。 |
| `SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS` | 正整数 | 同一项目允许的并发 Agent run 数，默认 3。 |
| `SIMPLERCP_DATA_DIR` | 绝对路径 | 项目、轨迹、通知和 Agent run 的保存目录。 |
| `SIMPLERCP_IMPORT_ROOTS` | 逗号分隔的绝对路径 | 允许导入的项目目录。 |

没有模型 Key 时使用 `off`、`observe`、`rules` 或 `replay`。`replay` 只读取已有缓存，模型请求不会联网。

## 5. 自动化验收命令

### 5.1 构建、单元测试和 Demo

```bash
pnpm -r build
pnpm --filter @simplercp/conflict-guard test
pnpm --filter @simplercp/server test
pnpm test:demo
```

分支现有阶段报告记录了 conflict-guard 包 214 项测试、服务端 273 项测试和 Demo 2 项测试。命令输出中的失败测试需要保留完整日志，人工验收时一并记录。

### 5.2 四种协作模式

```bash
CONFLICT_GUARD=off pnpm test:collab
CONFLICT_GUARD=observe pnpm test:collab
CONFLICT_GUARD=rules pnpm test:collab
CONFLICT_GUARD=full SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:collab
```

`off` 不建立冲突保护；`observe` 记录潜在结果并继续写入；`rules` 执行本地规则；`full` 对灰区调用模型，并启用 Agent T2/T3、意图和属主仲裁。

### 5.3 阶段三到阶段七 Playwright

本地规则与 UI 回归：

```bash
CONFLICT_GUARD=rules \
SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=3 \
SIMPLERCP_SKIP_MODEL_REQUESTS=true \
pnpm test:e2e
```

Agent T2/T3：

```bash
CONFLICT_GUARD=full \
SIMPLERCP_STAGE6_EVIDENCE=true \
pnpm test:e2e tests/e2e/conflict-guard-agent.spec.ts
```

阶段七意图和属主仲裁：

```bash
pnpm exec playwright test \
  --config tests/playwright.stage7.config.ts \
  tests/e2e/conflict-guard-arbitration.spec.ts
```

阶段七的真实用例会使用 OpenCode 与模型，请确认 `.env` 已配置，并遵守阶段七最多 40 次 Agent run 的预算。只检查页面流程时，可以先执行包测试和已有证据查看。

终端关闭回归：

```bash
CONFLICT_GUARD=off pnpm test:e2e:terminal-disabled
```

### 5.4 回放和基准

恢复 D1 和模型缓存：

```bash
pnpm --filter @simplercp/conflict-guard data:artifacts \
  --dataset bench/datasets/d1-v2 --restore
pnpm --filter @simplercp/conflict-guard data:artifacts \
  --cache bench/model-cache/checkpoint-b-round1 --restore
pnpm --filter @simplercp/conflict-guard data:artifacts \
  --cache bench/model-cache/checkpoint-b-calibrated --restore
```

生成小型基准并执行 P0 到 P*：

```bash
pnpm --filter @simplercp/conflict-guard bench:prepare \
  --seeds bench/seeds/native \
  --out ../../.test-workspaces/stage4-small \
  --groups 10 \
  --seed 7 \
  --concurrency 2

pnpm --filter @simplercp/conflict-guard replay:run \
  --dataset ../../.test-workspaces/stage4-small \
  --split dev \
  --policy 'P0,P1,P2,P3,P*' \
  --repeat 2 \
  --out ../../.test-workspaces/stage4-replay
```

检查现有服务端轨迹：

```bash
pnpm --filter @simplercp/conflict-guard replay:check \
  ../../docs/conflict-guard/evidence/stage-4-live-traces/call-signature.jsonl
```

检查 full 模式轨迹时附加缓存目录：

```bash
pnpm --filter @simplercp/conflict-guard replay:check \
  ../../docs/conflict-guard/evidence/checkpoint-b-manual/05-full.jsonl \
  --cache bench/model-cache/checkpoint-b-product
```

回放验收重点：相同轨迹、配置和种子重复运行，去掉 `timing` 后结果逐字节相同；`verification.json` 中没有错误；`replay:check` 的 `valid` 为 `true`。

### 5.5 阶段五模型研判

先执行离线配置校准或读取冻结配置：

```bash
pnpm --filter @simplercp/conflict-guard adjudication:calibrate \
  --dataset bench/datasets/d1-v2 \
  --record ../../docs/conflict-guard/evidence/checkpoint-b-dev-report/real-round1/results.json.gz \
  --out ../../.test-workspaces/calibration
```

联网冒烟只在确认预算后执行：

```bash
CONFLICT_GUARD=full \
SIMPLERCP_STAGE5_LIVE=1 \
pnpm --filter @simplercp/conflict-guard adjudication:smoke \
  --dataset bench/datasets/d1-v2 \
  --count 20 \
  --out ../../.test-workspaces/stage5-smoke
```

检查模型结果时查看：

- 灰区是否先显示 `analyzing` 和黄色区域。
- 结果是否包含 `allow`、`warn`、`lock`、来源、置信度、耗时、中文解释和建议。
- `provider_call` 是否只有适配器名、模型版本、提示词版本、输入哈希、决策、延迟和状态。
- 失败、超时、格式无效是否降为 warn，并保持文件可继续编辑。
- `CONFLICT_GUARD_PROVIDER_MODE=replay` 是否在无 API Key 时完成相同结果。

### 5.6 阶段六 Agent 验收

先验证 D3 种子和任务：

```bash
pnpm --filter @simplercp/conflict-guard bench:validate-d3
```

真实 Agent 批量运行需要模型 Key，并受 40 次 run 限制：

```bash
CONFLICT_GUARD=full \
SIMPLERCP_FAKE_AGENT_RUNTIME=false \
pnpm --filter @simplercp/conflict-guard bench:agents \
  --dataset d3 \
  --injection on \
  --repeat 1
```

检查 T2：Agent edit 被拒绝时，拒绝原因应包含冲突符号、对方显示名、签名或关键行和修改建议；Agent 可以重新读取文件并调整提案。服务端只能回复 `once` 或 `reject`。

检查 T3：Agent run 期间修改其依赖符号，run 结束后应撤回仍保持 Agent 内容的块；已经被其他成员修改的块应保留并通知属主需要人工处理。

自动化 fake runtime 用例：

```bash
CONFLICT_GUARD=full \
SIMPLERCP_FAKE_AGENT_RUNTIME=true \
pnpm test:e2e tests/e2e/conflict-guard-agent.spec.ts
```

### 5.7 阶段七意图与仲裁

启动服务端时加入：

```bash
CONFLICT_GUARD=full \
CONFLICT_GUARD_ARBITRATION=owner \
CONFLICT_GUARD_INTENT_INJECTION=on \
CONFLICT_GUARD_PROVIDER_MODE=live \
SIMPLERCP_FAKE_AGENT_RUNTIME=true \
pnpm --filter @simplercp/server dev
```

使用 `replay` 时，先恢复与轨迹对应的模型缓存；没有缓存的输入会按研判失败处理。

页面验收项目：

1. 两个属主各启动一个 Agent，意图板显示任务、计划范围和实际范围。
2. 两个 Agent 修改有接口关系的符号，双方出现意图差异卡片。
3. 两位属主都选择“采纳建议”，挂起的 edit 得到拒绝消息并附带建议，后到 Agent 继续执行。
4. 重复冲突，让一位属主选择“让我的 Agent 让路”，其冲突块被撤回。
5. 同一属主启动两个 Agent，后到 Agent 等待前者结束并自动重试，页面不出现属主卡片。
6. 人修改符号时让他人的 Agent 访问该符号，人保持可编辑，Agent 属主收到轻提示。
7. 切换 `CONFLICT_GUARD_ARBITRATION=all-human` 和 `all-auto`，比较卡片数量、轻提示数量和挂起时间。

## 6. 浏览器人工验收流程

以下步骤使用 `demo/conflict-shop`，每次验收使用新的项目目录或新的 `SIMPLERCP_DATA_DIR`，避免前一个场景的文件修改影响后续结果。

### 6.1 黑区：签名不兼容和撤回

1. 以 Alice、Bob 两个浏览器上下文加入同一项目。
2. Alice 打开 `src/pricing.ts`，将 `applyDiscount(price, rate)` 改为带必填 `currency` 的签名并等待批次结束。
3. Bob 打开 `src/cart.ts`，保留旧的 `applyDiscount` 调用并输入一次。
4. 在“冲突预防”页签查看 `call-signature-incompatible`、黑区、冻结范围和冲突卡片。
5. 确认终端读取的 `src/cart.ts` 仍是冲突前版本，编辑器仍可以显示协作文本。
6. 选择“我来改”，确认后检查 `pricing.ts` 是否恢复，变更对是否关闭，文件是否重新写入。
7. 重复场景并选择双方确认，确认冻结结束且文件文本保持双方确认后的结果。

### 6.2 顺序编辑、关闭文件和外部写入

1. Alice 先修改 `applyDiscount` 签名并停留 3 秒。
2. Bob 再修改依赖调用，在判定完成前检查磁盘文件保持冲突前内容。
3. Bob 在锁定期间关闭 `cart.ts`，重新打开后检查修改仍然存在。
4. 锁定期间从终端在文件开头、中间、末尾插入内容，确认共享文本按字符锚点合并。
5. 查看轨迹中是否有 `persist_conflict`、`mirror_resync`、闸门和冻结事件。
6. 在冻结区外插入内容，确认冻结范围随编辑移动，页签通过实时推送更新。

### 6.3 灰区：模型研判

将 `CONFLICT_GUARD=full`、`CONFLICT_GUARD_STRATEGY=G3`、`CONFLICT_GUARD_PROVIDER_MODE=live` 重启服务端。

1. Alice 修改 `applyDiscount` 的计算逻辑，保留函数签名。
2. Bob 修改 `checkout` 的相关计算。
3. 两边相关区域先显示黄色“分析中”，文件写入暂时暂停。
4. 结果返回后查看模型来源、置信度、耗时、中文解释和建议。
5. 返回 `allow` 时闸门打开；返回 `warn` 时双方看到通知；返回 `lock` 时显示冻结和卡片。
6. 停止服务端后使用错误的 `TYPESAFE_API_KEY` 重启，重复灰区场景，确认显示“研判失败，已降级为警告”，文件不被冻结。
7. 在分析中继续修改，确认旧请求取消，新 revision 重新研判。

### 6.4 Agent T2/T3

1. 启用 `CONFLICT_GUARD=full`、`SIMPLERCP_FAKE_AGENT_RUNTIME=false`。
2. Alice 将 `applyDiscount` 增加必填参数并等待。
3. Bob 在 Agent 面板提交“在 Cart 中增加 discountedTotal 方法”，让 Agent 先使用旧签名。
4. 查看 Agent 面板的拒绝次数、对方显示名、`signature` 原因和建议。
5. Agent 重新读取签名后使用兼容调用，检查 Alice 没有冻结和处理卡片。
6. 让 Agent 执行较长任务期间修改其依赖函数，run 结束后检查 T3 撤回通知、文件内容和未交叠块。
7. 将模式改为 `observe` 重启，重复步骤 2 到 5，确认 edit 直接写入，页签显示 `t2_shadow`。

### 6.5 意图板和仲裁卡片

1. 启用 `CONFLICT_GUARD_ARBITRATION=owner`、`CONFLICT_GUARD_INTENT_INJECTION=on`。
2. Alice 和 Bob 分别启动 Agent，查看意图板中的属主、任务、计划范围和实际范围。
3. 制造跨属主冲突，确认两人都收到意图差异卡片。
4. 两人选择“采纳建议”，确认后到 Agent 按追加指令继续。
5. 再次制造冲突，让 Bob 选择“让我的 Agent 让路”，检查 Bob 的冲突修改被撤回。
6. 让 Alice 启动两个有依赖关系的 Agent，确认后到 Agent 自动等待和重试，Alice 不收到处理卡片。
7. 人与他人的 Agent 冲突时，确认人保持可编辑，Agent 属主收到轻提示。
8. 查看“冲突预防”页签中的打扰次数、轻提示次数、挂起时长和处理方式。

## 7. 结果和证据检查

### 7.1 服务端接口

在页面打开项目后，可以使用浏览器开发者工具查看以下接口：

```text
GET /api/health
GET /api/projects/<projectId>/conflict-guard/state
GET /api/projects/<projectId>/conflict-guard/trace
GET /api/projects/<projectId>/agent/runs
GET /api/projects/<projectId>/agent/runs/<runId>/trace
```

请求冲突状态和轨迹时带当前成员的 `X-SimpleRCP-Member` 请求头。重点检查：

- `pairId`、`revision`、双方 before/after 哈希和状态变化。
- `persist_gate`、`persist`、`freeze`、`freeze_violation`、`provider_call`、`provider_subscription`。
- `t2_shadow`、`t3_revert`、`intent_created`、`intent_updated`、`intent_closed`、`intent_injected`。
- `ui_action` 是否包含实际成功的确认、撤回和卡片操作。
- Agent run 的拒绝次数、最近拒绝原因、T2/T3 状态和属主通知。

### 7.2 证据目录

| 目录 | 内容 |
|---|---|
| `docs/conflict-guard/evidence/checkpoint-a-manual/` | 阶段三浏览器黑区、灰区、撤回、确认、T0 和重开文件截图。 |
| `docs/conflict-guard/evidence/checkpoint-a-dev-report/` | 阶段四 P0 到 P3、P* 开发集结果和确定性报告。 |
| `docs/conflict-guard/evidence/stage-5-smoke/` | Jev、DeepSeek 开发集灰区冒烟结果。 |
| `docs/conflict-guard/evidence/checkpoint-b-manual/` | 阶段五真实模型和 Agent 修复后的浏览器验收证据。 |
| `docs/conflict-guard/evidence/checkpoint-b-dev-report/` | 阶段五录制、校准、回放、重复性和模型调用结果。 |
| `docs/conflict-guard/evidence/stage-6-smoke/` | OpenCode `permission.asked`、Agent 轨迹和项目测试结果。 |
| `docs/conflict-guard/evidence/stage-6-manual/` | Agent T2、T3 和 observe 浏览器证据。 |
| `docs/conflict-guard/evidence/stage-7-smoke/` | 意图注入 on/off 的 D3 真实 Agent 冒烟。 |
| `docs/conflict-guard/evidence/stage-7-manual/` | 意图板、属主卡片、让路、同属主和人优先浏览器证据。 |
| `docs/conflict-guard/experiment/` | 检查点 C 冻结清单、哈希、抽检模板、缓存索引和验证结果。 |

### 7.3 检查点 C 冻结材料

查看：

```bash
cat docs/conflict-guard/experiment/freeze.md
cat docs/conflict-guard/experiment/recording-integrity.md
cat .test-workspaces/checkpoint-c-verification.json
```

重新验证冻结材料：

```bash
pnpm --filter @simplercp/conflict-guard experiment:freeze --verify
node scripts/verify-evidence-secrets.mjs
```

验证应确认：

- D1 为 200 个关系组，抽检为 40 个关系组。
- 197 份开发集模型缓存与调用引用完成校验。
- 生成结果具有确定性，提示词文件被修改时验证失败。
- 已填写 reviewer 表格不会被重复导出覆盖。
- 仓库外部的输出符号链接和失效符号链接会在写文件前被拒绝。
- `readyForExperiments=false`，当前没有保留集策略评价结果。

## 8. 常见验收结果解释

| 现象 | 检查方向 |
|---|---|
| 页面无法连接 | 检查服务端 `PORT`、客户端 `VITE_SIMPLERCP_API_ORIGIN` 和 `/api/health`。 |
| 项目无法导入 | 检查 `SIMPLERCP_IMPORT_ROOTS` 是否包含项目的绝对路径。 |
| full 模式灰区没有结果 | 检查 `DEEPSEEK_API_KEY`、`TYPESAFE_API_KEY`、模型端点和 `CONFLICT_GUARD_PROVIDER_MODE`。 |
| 模型失败后页面冻结 | 检查是否误用了本地旧构建；重新执行 `pnpm -r build`，查看服务端 trace 的 `provider_call` 状态。T1 失败应降为 warn。 |
| Agent edit 一直拒绝 | 查看 Agent 面板最近拒绝原因和 `permission.asked` trace，确认工作区路径、提案 before/after 与 OpenCode 版本。 |
| 回放缓存未命中 | 使用 `data:artifacts --restore` 恢复对应缓存，并检查轨迹中的 `cacheKey`。 |
| 验证材料内容不一致 | 先查看 `git status` 和 reviewer 文件；人工填写内容需要保留样本 ID、标签字段、reason 和 notes。 |
| 真实 Agent run 超出预算 | 停止运行，保留现有证据，并记录预算文件中的已用次数。 |

## 9. 相关文档

- [阶段三人工验收清单](./manual-acceptance.md)
- [可执行基准和数据集说明](./benchmark.md)
- [灰区模型研判](./adjudication.md)
- [Agent T2/T3 闸门](./agent-guard.md)
- [意图板与属主仲裁](./arbitration.md)
- [阶段五报告](./stage-5.md)
- [阶段六报告](./stage-6.md)
- [阶段七报告](./stage-7.md)
- [阶段八冻结清单](./experiment/freeze.md)
