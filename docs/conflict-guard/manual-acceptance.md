# 冲突预防人工验收

## 阶段 2

在仓库目录执行以下命令。Node.js 使用 22.18 以上版本，`SIMPLERCP_IMPORT_ROOTS` 指向仓库中的 `demo/`。

```bash
pnpm install
pnpm --filter @simplercp/conflict-guard build
SIMPLERCP_IMPORT_ROOTS="$PWD/demo" CONFLICT_GUARD=observe pnpm dev
```

打开 `http://localhost:5173`，在首页点击 **Add directory**，项目名称填写 `conflict-shop`，服务器路径填写仓库中 `demo/conflict-shop` 的绝对路径，点击 **Create**。导入会创建独立项目副本。两个浏览器窗口打开同一项目地址，分别以 Alice、Bob 加入。在右侧协作面板选择 **冲突预防**，展开文件目录 `src`。

服务端通过 `/ws` 通知变化，客户端立即读取 state，同时每秒补充读取统计。批次空闲 1.5 秒后执行判定，语义更新触发在 25 毫秒内合并。编辑后停留约 2 秒。活跃变更保留到已有追踪规则结束，更换文件时之前的修改继续参与关系查询。

| 编号 | 操作与预期 |
|---|---|
| 1 | Alice、Bob 的窗口均显示“冲突预防”页签，打开后具有“正在修改”“相互关联的修改”“统计”。 |
| 2 | Alice 将 `src/pricing.ts` 第 4 行的 `price * (1 - rate)` 改为 `price - price * rate`。两边显示 Alice 的 `src/pricing.ts:3–5 applyDiscount`，状态为“修改”。 |
| 3 | Bob 将 `src/checkout.ts` 第 5 行的 `cart.total()` 改为 `cart.total() + 1`。两边显示双方的候选条目和 `checkout 调用 Cart.total；Cart.total 调用 applyDiscount`。点击条目展开，左右分别显示两位成员的修改前后文本。 |
| 4 | Bob 将 checkout 恢复原文，随后将 `src/report.ts` 第 8 行的 `"Shop report"` 改为 `"Daily report"`。双方候选条目消失，统计中的变更单元数增加 1、无关系数增加 1。 |
| 5 | Alice 修改 `Cart.total` 第 14 行的折扣参数 `0.1` 为 `0.2`，Bob 修改第 12 行的 `amount` 初始值 `0` 为 `1`。双方出现“两人在改同一个函数”。 |
| 6 | Alice 打开 report 文件，再点击“正在修改”中 `src/cart.ts:11–15 Cart.total()`，编辑器打开 cart 并定位第 11 行。 |
| 7 | 统计显示当前索引的文件数、符号数、关系数与最近更新耗时，同时显示变更单元数和无关系比例。 |

将服务器配置改为 `CONFLICT_GUARD=off` 并重新启动后，两个窗口均没有“冲突预防”页签。

执行结果保存在 [stage-2-manual/README.md](evidence/stage-2-manual/README.md)。七项均由 Playwright 操作真实浏览器、Monaco 与 Yjs 执行，并使用 DOM 和接口断言核验。截图作为界面记录保存。

可以通过以下命令复验清单与开关行为：

```bash
CONFLICT_GUARD=observe SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_STAGE2_EVIDENCE=true pnpm test:e2e tests/e2e/conflict-guard-panel.spec.ts
CONFLICT_GUARD=off SIMPLERCP_FAKE_AGENT_RUNTIME=false pnpm test:e2e tests/e2e/conflict-guard-panel.spec.ts
```

E2E 使用首页的真实导入流程。清单第 4 项结束后，自动验收通过既有 `/conflict-guard/done` 接口结束本轮活跃变更，再执行同符号修改；手工操作可以按表中顺序继续编辑，候选中的符号组合仍然可见。

## 阶段 3

使用 `CONFLICT_GUARD=rules` 启动服务，并按阶段 2 的方式导入 `demo/conflict-shop`。另开共享终端执行 `cat` 查看磁盘文件。每次编辑后停留约 2 秒，等待批次关闭与 state 刷新。

| 编号 | 操作 | 预期 |
|---|---|---|
| 1 | Alice 给 `applyDiscount(price, rate)` 增加必填参数，Bob 在 `Cart.total` 中修改调用参数 | 双方相关行出现红色冻结装饰和冲突摘要；页签出现“黑区 · 冻结 · 调用签名不兼容”；磁盘仍是冲突前文件。 |
| 2 | Bob 在冻结的 `Cart.total` 中输入 | 输入被拦截并提示“该区域已冻结”，冻结区外可以继续编辑。 |
| 3 | Alice 在冲突卡片中选择“我来改”，阅读撤回整个文件本轮修改的提示并确认 | Alice 本轮文件修改撤回，冻结解除，Bob 的修改写入磁盘。 |
| 4 | 重复第 1 步，双方都选择“双方确认后继续” | 冻结解除，当前 Y.Doc 内容写入磁盘。 |
| 5 | Alice 只增加 `console.log`，Bob 修改 `checkout` | 条目显示“白区 · 放行 · 只改日志”，不冻结并正常写盘。 |
| 6 | Alice 改变 `applyDiscount` 的计算方式但不改签名，Bob 修改 `checkout` | 双方收到灰区警告，不冻结并正常写盘。 |
| 7 | Alice 把 `formatMoney` 改为返回 `number`，Bob 对结果调用 `.toUpperCase()` | 条目显示“合并后才出现的类型错误”，出现冻结与冲突摘要。 |
| 8 | 两人同时修改 `Cart.total` | 条目显示“两人在改同一个函数”，出现冻结与冲突摘要。 |
| 9 | 判定后 Bob 在 `checkout` 中开始新批次 | 只有 Bob 收到 T0 提示，内容包含 Alice、`applyDiscount()` 和接口变化。 |
| 10 | 查看统计 | 显示白区、黑区、灰区数量、本地决定比例、冻结总时长、写盘阻挡次数和卡片操作次数。 |

阶段 3 自动验收证据保存在 [stage-3-manual/README.md](evidence/stage-3-manual/README.md)，包含规则模式的黑区卡片截图与验收结果。

自动验收命令：

```bash
CONFLICT_GUARD=rules pnpm test:e2e tests/e2e/conflict-guard-intervention.spec.ts
```

截图保存到 `docs/conflict-guard/evidence/stage-3-manual/`。

### 检查点 A 补充验收

每个场景使用新导入的项目，两个窗口以 Alice、Bob 加入，参数保持批次空闲 1500 ms、文件写入等待 300 ms。

| 编号 | 操作 | 预期 |
|---|---|---|
| A1 | Alice 在 pricing 的 applyDiscount 增加 `currency: string`，等待 3 秒；Bob 修改 cart 的折扣参数，在 500 ms 和 2 秒后分别执行 `cat src/cart.ts` | 判定前与黑区判定后，磁盘均保持 Bob 修改前的内容。 |
| A2 | Bob 在锁定期间关闭 cart 的编辑器，再重新打开 | 尚未写入的修改仍然存在，冻结仍然可见。 |
| A3 | Alice 修改 pricing 后切换到 cart，再选择“我来改”并确认；执行 `cat src/pricing.ts` | pricing 恢复原签名，Bob 的修改写入 cart，冻结解除。 |

执行阶段 3 十项与补充三项的命令：

```bash
CONFLICT_GUARD=rules SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/conflict-guard-checkpoint.spec.ts
```

用例操作两个真实浏览器上下文，调用宿主的 `cat` 核验文件；DOM、Monaco 与接口断言记录操作结果。截图与 `acceptance.json` 保存到 `docs/conflict-guard/evidence/checkpoint-a-manual/`。

## 阶段 4

在仓库目录完成构建后，用一条命令生成并标注十组数据。输出目录与交付的 60 组数据分开：

```bash
pnpm --filter @simplercp/conflict-guard build
pnpm --filter @simplercp/conflict-guard bench:prepare --seeds bench/seeds --out ../../.test-workspaces/stage-4-small --groups 10 --seed 7 --concurrency 2
```

打开 `.test-workspaces/stage-4-small/manifest.json` 与 `labels.json`。选择一个标签为 lock 的冲突样本及它的安全孪生，检查两者的业务符号与修改位置。展开 states，四种状态各有三次真实运行结果。检查项目划分、三类依赖修改、程序去重数量及跨集合重叠数。

运行开发集四种策略并查看摘要：

```bash
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v1 --split dev --policy 'P0,P1,P2,P3,P*' --repeat 2 --out ../../docs/conflict-guard/evidence/checkpoint-a-dev-report
```

打开 `docs/conflict-guard/evidence/checkpoint-a-dev-report/summary.md`，检查主表和 Wilson 区间，并查看 `interruptions.svg`。比较各策略与 P* 的逃逸率、提示次数和判定前暴露窗口，数值以本轮结果为准。保留集只用于后续正式评价。

使用独立演示项目启动界面回放。服务器使用 `CONFLICT_GUARD=rules`，通过首页创建一个空项目，记录 URL 中的 project id。执行以下命令，trace 参数使用文件的绝对路径：

```bash
pnpm --filter @simplercp/conflict-guard replay:ui --server http://127.0.0.1:3000 --project <id> --trace <仓库绝对路径>/packages/conflict-guard/bench/datasets/d1-v1/traces/d1-0001-conflict.jsonl --speed 2 --hold 15000
```

浏览器中以 Observer 加入该项目，按 manifest 的 `entryPoints` 打开调用方文件和“冲突预防”页签。可以看到 `Replay origin`、`Replay candidate` 的输入和光标；停顿后显示相应判定。命令会重置 trace 中的初始文件，结束后断开幽灵成员。

对服务端录制轨迹运行一致性检查：

```bash
pnpm --filter @simplercp/conflict-guard replay:check ../../docs/conflict-guard/evidence/stage-4-live-traces/same-symbol.jsonl
pnpm --filter @simplercp/conflict-guard replay:check ../../docs/conflict-guard/evidence/stage-4-live-traces/call-signature.jsonl
```

两份轨迹均返回 `checked:true`、`valid:true`、`differences:[]`。合成轨迹只有输入事件，不能用于这种产品一致性校验。

检查点 A 的数据集、五种策略与一致性检查结果见 `review-fix-checkpoint-a.md`。界面回放证据保存在 `evidence/stage-4-ui/`；本轮浏览器十三项证据保存在 `evidence/checkpoint-a-manual/`。

## 阶段 5

根目录环境已经配置两个角色的凭据时，运行 `CONFLICT_GUARD=full CONFLICT_GUARD_STRATEGY=G3 pnpm dev`。导入 conflict-shop，两个独立窗口以 Alice、Bob 加入，打开“冲突预防”页签。

| 编号 | 操作 | 预期 |
|---|---|---|
| 1 | Alice 将 applyDiscount 的计算改为 `price - rate`，Bob 修改 checkout 的计算；停顿两秒 | 双方相关区域标黄，研判完成后显示结果。通知或卡片包含中文解释、建议、模型角色与耗时。 |
| 2 | 查看页签统计 | 出现模型调用、升级比例、p50/p95、失败次数及费用估算。 |
| 3 | 用无效快判凭据启动 G2，重复第 1 项 | 显示“研判失败，已降级为警告”，编辑继续，区域没有冻结。G3 遇到快判鉴权错误会调用深判；两个角色均失败时才整体降级。 |
| 4 | 第 1 项显示黄色期间，Alice 继续修改同一符号 | 旧请求被取消，新批次结束后重新分析，最终结果对应新的 revision。 |

无需改写 `.env`，用进程环境覆盖凭据进行失败验收。真实浏览器自动执行命令：

```bash
CONFLICT_GUARD=full SIMPLERCP_STAGE5_LIVE=1 pnpm test:e2e tests/e2e/conflict-guard-adjudication.spec.ts
TYPESAFE_API_KEY=stage5-invalid-credential DEEPSEEK_API_KEY=stage5-invalid-credential CONFLICT_GUARD=full SIMPLERCP_STAGE5_LIVE=1 SIMPLERCP_STAGE5_FAILURE=1 pnpm test:e2e tests/e2e/conflict-guard-adjudication.spec.ts
```

上述失败命令检查 G3 的两个角色均失败路径。截图与状态断言存入 `evidence/stage-5-manual/`。普通 CI 跳过实际模型调用，服务端集成测试使用指定的注入适配器，批次空闲为 1500 ms、写入延迟为 300 ms。
