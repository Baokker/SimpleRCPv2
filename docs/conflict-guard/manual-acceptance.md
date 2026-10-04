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
| 4 | Bob 将 checkout 恢复原文，随后将 `src/report.ts` 第 8 行的 `"Shop report"` 改为 `"Daily report"`。双方候选条目消失，统计显示累计 3 个单元、1 个无关系单元，比例 33.3%。 |
| 5 | Alice 修改 `Cart.total` 第 14 行的折扣参数 `0.1` 为 `0.2`，Bob 修改第 12 行的 `amount` 初始值 `0` 为 `1`。双方出现“两人在改同一个函数”。 |
| 6 | Alice 打开 report 文件，再点击“正在修改”中 `src/cart.ts:11–15 total`，编辑器打开 cart 并定位第 11 行。 |
| 7 | 统计显示 6 个文件、22 个符号、21 条关系与最近更新耗时，同时显示变更单元数和无关系比例。 |

将服务器配置改为 `CONFLICT_GUARD=off` 并重新启动后，两个窗口均没有“冲突预防”页签。

执行结果保存在 [stage-2-manual/README.md](evidence/stage-2-manual/README.md)。七项均由 Playwright 操作真实浏览器、Monaco 与 Yjs 执行，并使用 DOM 和接口断言核验。截图作为界面记录保存。

可以通过以下命令复验清单与开关行为：

```bash
CONFLICT_GUARD=observe SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_STAGE2_EVIDENCE=true pnpm test:e2e tests/e2e/conflict-guard-panel.spec.ts
CONFLICT_GUARD=off SIMPLERCP_FAKE_AGENT_RUNTIME=false pnpm test:e2e tests/e2e/conflict-guard-panel.spec.ts
```

E2E 使用首页的真实导入流程。清单第 4 项结束后，自动验收通过既有 `/conflict-guard/done` 接口结束本轮活跃变更，再执行同符号修改；手工操作可以按表中顺序继续编辑，候选中的符号组合仍然可见。
