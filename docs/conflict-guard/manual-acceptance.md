# 冲突预防人工验收

## 阶段 2

在仓库目录执行以下命令。Node.js 使用 22.18 以上版本，`SIMPLERCP_IMPORT_ROOTS` 指向仓库中的 `demo/`。

```bash
pnpm install
pnpm --filter @simplercp/conflict-guard build
SIMPLERCP_IMPORT_ROOTS="$PWD/demo" CONFLICT_GUARD=observe pnpm dev
```

打开 `http://localhost:5173`，在首页点击 **Add directory**，项目名称填写 `conflict-shop`，服务器路径填写仓库中 `demo/conflict-shop` 的绝对路径，点击 **Create**。导入会创建独立项目副本。两个浏览器窗口打开同一项目地址，分别以 Alice、Bob 加入。在右侧协作面板选择 **冲突预防**，展开文件目录 `src`。

观察面板每秒读取一次 state，服务端在批次空闲 1.5 秒后处理符号变化，多次更新触发在 25 毫秒内合并。编辑后停留约 2 秒，必要时等待下一次面板刷新。活跃变更保留到已有追踪规则结束，因此更换编辑文件时，之前的修改仍然参与关系查询。

| 编号 | 操作与预期 |
|---|---|
| 1 | Alice、Bob 的窗口均显示“冲突预防”页签，打开后具有“正在修改”“相互关联的修改”“统计”。 |
| 2 | Alice 将 `src/pricing.ts` 第 4 行的 `price * (1 - rate)` 改为 `price - price * rate`。两边显示 Alice 的 `src/pricing.ts:3–5 applyDiscount`，状态为“修改”。 |
| 3 | Bob 将 `src/checkout.ts` 第 5 行的 `cart.total()` 改为 `cart.total() + 1`。两边显示双方的候选条目和 `checkout 调用 Cart.total；Cart.total 调用 applyDiscount`。点击条目展开，左右分别显示两位成员的修改前后文本。 |
| 4 | Bob 将 checkout 恢复原文，随后将 `src/report.ts` 第 8 行的 `"Shop report"` 改为 `"Daily report"`。双方候选条目消失，统计中的变更单元数增加 1、无关系数增加 1。 |
| 5 | Alice 修改 `Cart.total` 第 14 行的折扣参数 `0.1` 为 `0.2`，Bob 修改第 12 行的 `amount` 初始值 `0` 为 `1`。双方出现“两人在改同一个函数”。 |
| 6 | Alice 打开 report 文件，再点击“正在修改”中 `src/cart.ts:11–15 Cart.total()`，编辑器打开 cart 并定位第 11 行。 |
| 7 | 统计显示 6 个文件、22 个符号、21 条关系与最近更新耗时，同时显示变更单元数和无关系比例。 |

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
| 3 | Alice 在冲突卡片中选择撤回并确认 | Alice 本轮文件修改撤回，冻结解除，Bob 的修改可以写入磁盘。 |
| 4 | 重复第 1 步，双方都选择“双方确认后继续” | 冻结解除，当前 Y.Doc 内容写入磁盘。 |
| 5 | Alice 只增加 `console.log`，Bob 修改 `checkout` | 条目显示“白区 · 放行 · 只改日志”，不冻结并正常写盘。 |
| 6 | Alice 改变 `applyDiscount` 的计算方式但不改签名，Bob 修改 `checkout` | 双方收到灰区警告，不冻结并正常写盘。 |
| 7 | Alice 把 `formatMoney` 改为返回 `number`，Bob 对结果调用 `.toUpperCase()` | 条目显示“合并后才出现的类型错误”，出现冻结与冲突摘要。 |
| 8 | 两人同时修改 `Cart.total` | 条目显示“两人在改同一个函数”，出现冻结与冲突摘要。 |
| 9 | 判定后 Bob 在 `checkout` 中开始新批次 | 只有 Bob 收到 T0 提示，内容包含 Alice、`applyDiscount()` 和契约变化。 |
| 10 | 查看统计 | 显示白区、黑区、灰区数量、本地决定比例、冻结总时长、写盘阻挡次数和卡片操作次数。 |

阶段 3 自动验收证据保存在 [stage-3-manual/README.md](evidence/stage-3-manual/README.md)，包含规则模式的黑区卡片截图与验收结果。

自动验收命令：

```bash
CONFLICT_GUARD=rules pnpm test:e2e tests/e2e/conflict-guard-intervention.spec.ts
```

截图保存到 `docs/conflict-guard/evidence/stage-3-manual/`。

## 阶段 4

在仓库目录执行以下命令生成并标注十组开发数据：

```bash
pnpm --filter @simplercp/conflict-guard build
pnpm --filter @simplercp/conflict-guard bench:generate --seeds bench/seeds --out bench/datasets/d1-v1 --groups 10 --seed 7
pnpm --filter @simplercp/conflict-guard bench:label --dataset bench/datasets/d1-v1 --concurrency 2
```

检查 `manifest.json` 中的开发集和保留集列表，打开 `labels.json` 查看一个 `lock` 冲突组和同组 `allow` 安全孪生，确认四种状态各有三次探针结果。

运行开发集四种策略并查看摘要：

```bash
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v1 --split dev --policy P0,P1,P2,P3 --out ../../docs/conflict-guard/evidence/stage-4-dev-report
```

打开 `docs/conflict-guard/evidence/stage-4-dev-report/summary.md`，检查逃逸率、漏阻断率、误阻断率、本地决定比例和冻结人秒，并查看 `interruptions.svg`。P0 通常保持最高逃逸，P2 通常产生较多误阻断，P3 结果取决于可解析的关系与规则命中。

选取一份轨迹运行一致性检查：

```bash
pnpm --filter @simplercp/conflict-guard replay:check bench/datasets/d1-v1/traces/d1-1-conflict.jsonl
```

输出中的 `valid` 为 `true` 时，P3 回放判定与轨迹中的 `pair_judged` 序列一致；合成轨迹没有派生事件时，`checked` 为 `false` 并报告回放得到的序列。真实界面回放使用 server 包命令：

```bash
pnpm --filter @simplercp/server replay:ui -- --server http://127.0.0.1:3000 --project <id> --trace <file> --speed 2
```

在浏览器里以第三位成员加入项目，可以看到轨迹中的幽灵成员按节奏编辑，随后观察冻结与冲突卡片。
