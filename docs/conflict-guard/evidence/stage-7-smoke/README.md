# 阶段七真实任务证据

OpenCode 1.18.31，配置的 DeepSeek，full、owner、record。每个任务对使用独立项目及两个属主，最终运行 D3 源码验收测试。原始审批、模型调用、仲裁和意图事件保存在同名 JSONL；JSON 保存 run、工具记录、卡片和测试输出。

| 任务对 | 注入 on | 注入 off | on 卡片与追加执行 |
|---|---|---|---|
| d3-01：quote 返回字段与 invoiceLabel | 通过 | 通过 | 双方采纳，一次 T3 追加执行 |
| d3-02：capacity 返回字段与 roomSummary | 通过 | 通过 | 双方采纳，一次 T3 追加执行 |
| d3-03：weightDetails 与 admittedLabel | 通过 | 通过 | 没有处理卡片 |

十二个正式 run 全部 completed，T3 passed 七次、warned 五次。采纳建议后的 T3 可以继续返回 warned；最终源码验收均通过。on 的三对任务产生两张卡片和一条轻提示，off 产生两条轻提示。该记录支持端到端执行核验；注入效果需要阶段八的更多重复。

dataset-validation.json 保存六个原始项目的测试输出和十三个任务的验收前提。verification.json 保存六份轨迹在 owner、all-human、all-auto 下的统计、错误检查及三次确定性验证。replay/ 保存完整离线结果，禁止联网。

run-budget.json 包括冒烟和调试的全部 39 次真实 Agent run。浏览器验收证据保存在相邻 stage-7-manual 目录。保留集未运行。
