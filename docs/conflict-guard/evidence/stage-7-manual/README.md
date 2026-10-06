# 阶段七浏览器证据

两个独立浏览器上下文，Alice 与 Bob，full、owner、intent injection on。四个流程使用真实 OpenCode Agent 和配置的 DeepSeek。检查使用 DOM、Monaco、API、Yjs 及文件；双方截图仅保存为证据。

| 文件前缀 | 执行内容 |
|---|---|
| 01-cross-accept | 双方意图与范围、卡片建议、双方采纳、后到 Agent 继续 |
| 01-cross-yield | Bob 让路、Agent 取消、先前写入的 marker 撤回、另一方继续 |
| 02-same-owner | 同属主等待与重查、没有处理卡片、自动处理计数 |
| 03-human-priority | 人的相关修改保持可编辑、没有冻结与卡片、属主轻提示 |

同名前缀的 JSON 保存项目状态，JSONL 保存轨迹，alice/bob PNG 保存双方页面。六项人工清单的全部内容由这四个流程覆盖。replay-same 记录同属主轨迹在三种模式下各三次的离线结果；跨属主采纳轨迹的对应结果位于相邻 stage-7-smoke/replay-manual。
