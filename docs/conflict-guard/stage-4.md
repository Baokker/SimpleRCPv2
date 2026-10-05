# 阶段 4 报告：可量化回放

阶段 4 在 `packages/conflict-guard/src/replay/` 组合虚拟时钟、内存文件提供者、阶段 1 的 tracker、阶段 2 的语义索引与候选跟踪、阶段 3 的分区器和变更对状态机。回放按轨迹的 `seq` 和虚拟时间推进，只读取 `doc_open`、`edit`、`cursor`；派生事件用于一致性检查。P0、P1、P2、P3 共享同一输入接口，替换策略即可重复运行。

`src/bench/` 提供 17 个算子规格、确定性关系组生成器和四状态标签记录。生成器写出冲突变体、安全孪生、schema 3 轨迹和项目切分。探针结果按四状态各三次保存，标签文件保留原始结果和剔除记录。

当前 D1 生成了 60 个关系组、120 个变体，开发集 22 组、保留集 38 组，剔除 0 组。D2 保存了六个 GreyLock 场景和 51 条规则案例的迁移来源与标签审计文件。

开发集示例命令：

```bash
pnpm --filter @simplercp/conflict-guard build
pnpm --filter @simplercp/conflict-guard bench:generate --seeds bench/seeds --out bench/datasets/d1-v1 --groups 10 --seed 7
pnpm --filter @simplercp/conflict-guard bench:label --dataset bench/datasets/d1-v1 --concurrency 2
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v1 --split dev --policy P0,P1,P2,P3 --out docs/conflict-guard/evidence/stage-4-dev-report
```

当前包内测试覆盖虚拟时钟顺序、策略判定、回放确定性、基准生成确定性、四状态标签结构和 Wilson 区间。`replay:check` 比较 P3 回放的 `pair_judged` 规则编号与动作；没有派生事件的合成轨迹会报告回放得到的判定序列。

开发集示例结果为：P0 逃逸率 25.0%、P1 25.0%、P2 0.0%、P3 20.5%；P2 误阻断率 70.5%，P3 误阻断率 0.0%。P2 使用依赖关系直接锁定，误阻断较高；P3 只在当前可解析规则命中时锁定，部分深层算子进入灰区。

示例报告目录包含 `results.json`、`summary.md` 和 `interruptions.svg`，只针对开发集。已知限制包括合成项目规模较小、探针表达的行为有限、当前 `replay:ui` 输出重放摘要，真实 WebSocket 幽灵成员连接需要服务端命令接入。

阶段 5 可以复用 `ZoningPolicy` 接口接入模型策略，复用 `BenchLabel` 的四状态结果和 `ReplayMetrics` 的分组统计；P3 的规则判定与轨迹一致性检查保持不变。
