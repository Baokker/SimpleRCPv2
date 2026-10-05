# 阶段 4 报告：可量化回放

`packages/conflict-guard/src/replay/` 使用虚拟时钟和内存文件提供者，直接组合产品的 tracker、语义索引、SemanticChangeTracker、classify 与 PairCoordinator。输入按 seq 推进，批次关闭、候选关系和状态转换自然生成；录制的派生事件用于核验。P1 为同文件无语义关系的并发修改建立文件候选。P3 的规则保持阶段 3 行为。

回放记录冻结区域、闸门区间、300 毫秒写盘防抖后的持久文本和最终动作。冻结后相交的编辑继续更新文本坐标，同时标为反事实；包含这种编辑的持久记录不会计为真实逃逸。mirror_resync 与服务端共用 fast-diff 转换。实际运行耗时放在 timing，评价时间来自虚拟时钟。

`src/bench/` 包含 18 个算子、四状态 probe runner、标签器和确定性生成器。七个项目各有五个 TS 文件和 Node 内置测试。探针在 os.tmpdir() 的独立目录运行；编译、类型诊断和四类 probe 均在子进程中完成，状态超时为 20 秒，目录随后清理。每种状态执行三次，输出保留全部原始结果。

交付 D1 使用种子 7，生成代码提交为 `06382b9`，60 个关系组包含 120 个变体。开发集 26 组、保留集 34 组；同项目不跨集合，EB-1 与 SS-3 仅属于保留项目。三类依赖修改数量为 54、54、12。1440 次状态运行完成，剔除率为 0%；真值为 lock 40 项、warn 3 项、allow 77 项，其中 13 项 lock 可由类型检查发现。保留集只完成生成与真值标注，策略评价仅运行开发集。

生成命令支持将 groups 改为 200 扩大数据集：

```bash
pnpm --filter @simplercp/conflict-guard bench:prepare --seeds bench/seeds --out bench/datasets/d1-v1 --groups 60 --seed 7 --concurrency 4
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v1 --split dev --policy P0,P1,P2,P3 --repeat 2 --out ../../docs/conflict-guard/evidence/stage-4-dev-report
```

开发集结果如下，分母均为 26 个关系组。完整三分类一致要求组内两个变体均一致，误阻断检查安全孪生，冻结时间按成员合并重叠区间。各比例及分组的 Wilson 95% 区间保存在结果 JSON 与摘要中。

| 策略 | 逃逸率 | 漏阻断率 | 误阻断率 | 本地决定比例 | 冻结人秒 |
|---|---:|---:|---:|---:|---:|
| P0 | 69.2% | 69.2% | 0.0% | 100.0% | 0.00 |
| P1 | 69.2% | 69.2% | 15.4% | 100.0% | 89.98 |
| P2 | 46.2% | 7.7% | 92.3% | 100.0% | 556.12 |
| P3 | 53.8% | 42.3% | 15.4% | 26.9% | 148.30 |

P1 对跨文件依赖没有干预，因此其逃逸率与 P0 相同。P2 能将关联对判为 lock，但批次判定之前的文件可能已写入；漏阻断率为 7.7%，同时仍存在逃逸。P3 将运行时语义变化留在灰区，并将同一函数中的独立分支修改判黑，所以仍有漏阻断和误阻断。报告保存这些实际行为。主表、分组、判定序列和散点图位于 `evidence/stage-4-dev-report/`。

P3 虚拟判定延迟 p50 为 1826 毫秒、p95 为 2865 毫秒。该延迟包含录制的输入持续时间与批次等待；实际运行耗时单独记录在结果 JSON 的 timing 字段。每个开发变体重复两次得到相同 JSON；两次完整报告除 timing 外逐字节相同。冻结人秒分别记录双方，并按成员合并重叠区间。数据哈希、标签一致性、确定性结果与验收计数保存在 `evidence/stage-4-dev-report/verification.json`。

D2 转换生成 51 个规则案例与六个交付场景的 schema 3 轨迹。规则案例的当前本地动作有 41 项与 GreyLock 一致；十项旧 equivalent-refactor 白区案例当前返回 grey/warn，完整列表见 `bench/datasets/d2-greylock/replay-results.json`。六个交付场景中四项一方 before/after 相同，两项没有静态关系，因此当前 tracker 没有双边候选。清单保存 unavailable 原因，保留来源内容。它们不能作为真实分区一致性的证据。

两份服务端录制分别覆盖同符号与调用签名冲突。`replay:check` 对 pairId、revision、ruleId、decision 和批次容差时间均无差异，证据在 `evidence/stage-4-live-traces/`。Playwright 使用 D1 的 `d1-1-conflict` 轨迹与独立空项目，通过包命令创建真实幽灵成员。第三名成员看到了输入、光标、红色冻结装饰与卡片，浏览器错误列表为空。记录在 `evidence/stage-4-ui/`。

验收命令与结果：

| 命令 | 结果 |
|---|---|
| `pnpm -r build` | 全部工作包构建通过 |
| `pnpm --filter @simplercp/conflict-guard test` | 89 项通过 |
| `pnpm --filter @simplercp/server test` | 142 项通过 |
| `pnpm test:demo` | 2 项通过 |
| `node --experimental-strip-types --test packages/conflict-guard/bench/seeds/*/test/*.test.mjs` | 7 项通过 |
| `CONFLICT_GUARD=off pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=observe pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=rules pnpm test:collab` | 2 项通过 |
| `SIMPLERCP_SKIP_MODEL_REQUESTS=true CONFLICT_GUARD=rules pnpm test:e2e` | 23 项通过，4 项按条件跳过 |
| `CONFLICT_GUARD=rules pnpm test:e2e tests/e2e/conflict-guard-replay.spec.ts` | D1 真实界面回放通过 |
| `replay:check` 两份服务端录制 | checked=true，valid=true，无差异 |
| `bench:prepare --groups 10 --seed 7` | 20 个变体完成标注，零项剔除 |
| `replay:run --split dev --policy P0,P1,P2,P3 --repeat 2` | 26 组开发数据，确定性检查通过 |

完整浏览器回归的条件跳过项为两项真实 Agent 模型请求、视频录制和终端禁用模式；协作与阶段 2、3、4 用例均执行。较早的一次完整浏览器回归误触发了两项旧 Agent 模型用例，随后终止该运行；最终验收使用 SIMPLERCP_SKIP_MODEL_REQUESTS=true。界面回放和基准模块没有模型调用。人工清单的四项均由命令与 Playwright 自动执行，文档提供对应手工操作步骤。

已知局限包括复用的合成模板、probe 的有限覆盖、D2 十项本地规则差异和六个旧场景的输入限制。冻结后的反事实文本仍参与后续语义计算，长期反事实推演会受到影响；持久化统计对包含反事实编辑的文件采用排除方式。服务重启、多次撤回及频繁外部回灌还需要增加一致性样本。本工作区没有找到用户指定的《实验与评价.md》与《方案设计.md》，评价定义按本阶段请求与可读取的 GreyLock 设计文档执行。

阶段 5 可通过 ZoningPolicy 接入模型策略，使用同一四状态真值与指标。建议保留 P3 的确定性基准，增加模型响应记录与异常记录，在开发集比较策略；正式评价之前冻结配置，再运行保留集。
