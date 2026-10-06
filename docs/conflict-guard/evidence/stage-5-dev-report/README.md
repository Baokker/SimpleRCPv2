# 开发集模型评价证据

`results.json.gz` 为最终 record 主报告，`summary.md` 为主表，`families-and-t03.md` 为算子族与门槛结果。每组保存策略输出、判定时点、修订号、文件写入时间线、冻结与闸门区间以及实际应用的模型结果。输入哈希和调用元数据供核验缓存。

`calibration.json` 与 `threshold.svg` 使用 G1/G2 录制结果中的相同输入；十八项最终灰区修订参与校准。`replay-1/`、`replay-2/`、`replay-3/` 为独立进程离线重放，`repeatability.json` 保存逐字节比较及与 record 的结果比较。replay 的调用元数据标记 cache-hit，新增费用为零；判定、质量指标和录制延迟保持一致。

`adjudication-config.json` 保存完整录制配置，`adjudication-models.json` 保存调用元数据中的适配器及模型版本。`adjudication:verify` 使用这两个文件执行重放。

`provenance.json` 保存冒烟数据归档哈希、开发项目、模型版本、CLI 调用预算和关闭 thinking 的响应检查结果。价格及提示词见 adjudication.md，数据与评价范围见 stage-5.md。该目录只包含开发集结果。
