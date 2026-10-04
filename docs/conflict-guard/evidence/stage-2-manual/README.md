# 阶段 2 浏览器验收证据

执行环境为 macOS、真实 Chromium、两个独立浏览器上下文，成员名称 Alice、Bob。服务器配置 `CONFLICT_GUARD=observe`、`SIMPLERCP_FAKE_AGENT_RUNTIME=false`。项目由首页 **Add directory** 导入 `demo/conflict-shop` 的副本。执行方法为 Playwright 操作真实界面与 Monaco，修改经真实 Yjs WebSocket 同步；验收依据为 DOM 和接口结果。

对应命令与原始输出见 [检查记录](../stage-2-checks/README.md) 和 [panel-observe.log](../stage-2-checks/panel-observe.log)。

| 清单 | 截图 |
|---|---|
| 1：双方页签 | [Alice](01-alice-panel.png)、[Bob](01-bob-panel.png) |
| 2：成员符号修改 | [正在修改](02-active-symbol.png) |
| 3：关系路径与双方文本 | [Alice](03-related-before-after.png)、[Bob](03-bob-related-before-after.png) |
| 4：独立工具函数与无关统计 | [无关修改](04-unrelated-change.png) |
| 5：同符号候选 | [Cart.total](05-same-symbol.png) |
| 6、7：点击跳转与统计 | [跳转位置](06-navigation-statistics.png) |

[acceptance.json](acceptance.json) 保存七项结果及项目编号。[states.json](states.json) 保存两跳候选、无关修改、同符号候选与跳转后的 state。[trace.jsonl](trace.jsonl) 保存 edit、批次、变更单元与候选生命周期事件。截图及接口证据均由通过全部断言的验收运行产生。
