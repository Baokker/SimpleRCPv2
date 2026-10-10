# E3 检索比较冻结记录

- 标签：`knowledge-e3-freeze-v2.3.1`。
- 代码：`52193f1cf5e0c25ae9c21f5ccb77332232d68d77`。
- 数据：`ea11a85ed344c522fe3b63288cd8577c94fa6498`。
- manifest SHA-256：`3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`。
- 协议对象哈希：`3a45882f5cf702858796f79877428883babd83f4775b334271c44a15ed09d407`。
- 查询对象哈希：`84c2e32a10f1b378f860676bc20816b3242339861f7279a1d2e88f233d1d8c06`。
- 通用实验配置哈希：`ed17dd1be028bcb8d50bbca6dc21097da30b237684303512847bb723c2b5b1b3`。
- Node：`v24.7.0`。
- 模型：`minimax / MiniMax-M3`，`reasoning_split: true`，temperature=0.2，单次超时120秒，无自动重试。
- 运行入口：真实本机 HTTP，使用产品 `buildContext` 与 `selectKnowledgeInjection`；本次没有启动 OpenCode 编程任务。
- 候选：现有排序及项目级补充之后取前20张；模型选择零至五张；最终正文每张800字符、完整知识段4000字符。
- 协议：`experiments/knowledge/e3-retest-protocol.json`。
- 输出：`experiments/knowledge/runs/E3-delivery-v231-m3/`。
- 源文件独立哈希：上述目录中的 `freeze.json`。

## 状态

88次本地比较全部完成，预览、HTTP 查询与直接重放结果一致。M3 已完成4次请求，均因响应包含 Markdown 代码围栏被严格 JSON 入口拒绝；4次费用估算合计0.05739384元。

2026-10-10 17:50（Asia/Shanghai），运行器已终止。下一项 `R1-C01-paraphrase-C-2` 在暂停时可能已发出请求，未取得可保存的响应和用量，费用未知；该组合不计为模型能力失败。其余预定组合尚未执行。

复用现有 `extractFirstJsonObject` 的格式适配与新冻结版本正在等待用户确认。模型提示、检索参数、数据与相关集保持此版本的原值。

## 历史 BM25 复现

`E3-bm25-retest-v23` 的176条查询完成，所有候选排名与 v2.2 逐条相同。该确定性复现使用 `cd3c8eb3`，不含模型请求。结果文件 SHA-256 为 `211d77ffe1939b17b50e586c631964e3f900fc6268659bc2a6b76ae9ad2fb42b`。

`E3-delivery-v23-m3` 保存88次本地通道检查；此目录没有模型请求。正式比较目录为 `E3-delivery-v231-m3`，两个目录不合并样本。

## 测试

- `pnpm build` 通过。
- `TMPDIR=.test-artifacts/t pnpm test` 通过：server160项、knowledge162项、Demo2项；server另有9项既有跳过。
- 实验工具22项通过；成员恢复后的新增接口测试3项再次通过。
- Python统计工具5项通过。
- 临时目录均位于仓库忽略目录。Demo启动测试使用短相对临时路径，以满足 macOS socket 路径长度限制。
