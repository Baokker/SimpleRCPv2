# 阶段 4 基准说明

D1 使用 `packages/conflict-guard/bench/seeds/` 中的七个无外部依赖 TypeScript 种子项目。每个关系组包含 producer 与 consumer 两个相关文件，并保留种子项目的其他文件。原始项目使用 Node.js 22 以上的 `--experimental-strip-types` 执行测试；回放本身在内存文件提供者上运行。

变异目录覆盖四族算子：IC 接口变化、CP 控制策略变化、SS 共享状态变化、EB 错误行为变化。SF-1 到 SF-5 产生日志、注释、等价重构、无关函数和兼容配套修改。每组同时写出冲突变体与安全孪生，两个版本共享 origin 变化和轨迹节奏。

标签器把每个状态物化到 `os.tmpdir()` 下的临时工作目录，用 TypeScript `transpileModule` 生成可执行 JavaScript，并在子进程中运行 `checkout` 探针；合并状态另外执行 TypeScript 诊断。四种状态各运行三次，合并后意图或共享回归失败标记为 `lock`，全部通过且观测值产生新差异标记为 `warn`，其余标记为 `allow`；异常组写入 `excluded.json`。切分以项目与算子共同决定，`manifest.json` 保存种子、生成命令、组编号、算子和切分列表。

指标以关系组为分母，包含无关系比例、本地决定比例、三分类一致率、漏阻断率、误阻断率、冲突逃逸率、冻结人秒、每小时卡片数和虚拟判定延迟。比例同时保存 Wilson 95% 区间，并按算子族与 `detectability` 分组。合成数据的代码形态较规整，探针只覆盖明确写出的意图，结果用于比较策略行为。

D2 位于 `packages/conflict-guard/bench/datasets/d2-greylock/`，`manifest.json` 记录六个场景、51 条规则案例和 schema 3 转换说明，`source-report.json` 保留 GreyLock 的案例标签供回归审计。
