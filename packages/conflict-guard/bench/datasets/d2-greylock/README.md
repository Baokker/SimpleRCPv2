# D2 GreyLock 规则回归

本目录包含 GreyLock 六个交付场景与 51 个规则案例，共 57 条 schema 3 轨迹。`labels.json` 保存原始真值和本地分区，`source-report.json` 保存来源覆盖报告，`manifest.json` 保存各案例轨迹路径、SHA-256、已校验的来源及当前 P3 判定序列，`replay-results.json` 保存比较结果，`verification.json` 保存校验计数与不一致案例。

运行 `pnpm --filter @simplercp/conflict-guard bench:import-greylock --source ../../../collaboration-tools` 可以重新生成。`source-hashes.json` 固定全部 37 个来源文件的 SHA-256，包括 selection、覆盖报告、五份数据集以及六个场景的 case.json 与 before/after 文件。转换器读取时逐份校验，缺少哈希或内容变化都会终止导入。本地规则动作来自 GreyLock 的覆盖报告。源码仓库只用于读取。

51 个案例均进入产品 tracker、索引、分区器和状态机，47 个最终动作与来源的本地分区动作一致，当前结果为 45 个 warn、6 个 allow；每个案例重复回放得到相同 JSON。真值标签与本地动作分别记录为 sourceTruth 和 sourceDecision。

`ky-retry-method-normalization-safe`、`ky-json-schema-validation-order-safe`、`defu-config-layer-order-safe`、`cookie-max-age-validation-safe` 的来源动作为 allow，当前动作为 warn，规则均为 `semantic-interaction-uncertain`。等价重构中的临时变量消除要求下一条语句直接返回该变量，以保持求值条件与调用顺序；这四份输入没有满足该条件。`verification.json` 逐项记录差异。

黑区规则的移植对照使用 `docs/conflict-guard/evidence/checkpoint-a-greylock-parity.json` 中来自原始 `pair-zone-classifier.test.ts` 的 47 个分类调用；该文件保存全部输入、来源 SHA-256、原 classifier 结果和当前 classifier 结果。分区和规则的逐条比较见 `docs/conflict-guard/stage-3.md`。

六个交付场景保持原始 before/after：control-policy-grey、log-only-white、provider-failure-fallback、return-contract-black 只有一方发生文本变化；crossed-session-race、stale-reanalysis 没有静态跨文件关系。清单以 unavailable 记录这些来源限制，它们不会自然形成当前系统的双边候选对。服务端一致性证据使用 `docs/conflict-guard/evidence/stage-4-live-traces/` 中的真实录制。
