# D2 GreyLock 规则回归

本目录包含 GreyLock 六个交付场景与 51 个规则案例的 schema 3 轨迹。`labels.json` 保存原始真值和本地分区，`source-report.json` 保存来源覆盖报告，`manifest.json` 保存各案例轨迹路径、SHA-256 与当前 P3 判定序列，`replay-results.json` 保存比较结果。

运行 `pnpm --filter @simplercp/conflict-guard bench:import-greylock --source ../../../collaboration-tools` 可以重新生成。转换器读取固定 selection 引用的数据并校验来源哈希，本地规则动作来自 GreyLock 的覆盖报告。源码仓库只用于读取。

51 个案例均进入真实 tracker、索引、分区器和状态机，41 个本地动作一致，10 个原 equivalent-refactor 白区案例当前返回灰区。真值标签与本地动作分别记录为 sourceTruth 和 sourceDecision。

六个交付场景保持原始 before/after：control-policy-grey、log-only-white、provider-failure-fallback、return-contract-black 只有一方发生文本变化；crossed-session-race、stale-reanalysis 没有静态跨文件关系。清单以 unavailable 记录这些来源限制，它们不会自然形成当前系统的双边候选对。服务端一致性证据使用 `docs/conflict-guard/evidence/stage-4-live-traces/` 中的真实录制。
