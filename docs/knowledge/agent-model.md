# Agent 模型配置与验证

## 配置

`AGENT_LLM_PROVIDER` 支持 minimax/deepseek，默认 minimax。缺少所选 provider 的 Key 时，实际 Agent 服务启动报错。MiniMax 使用 MINIMAX_BASE_URL 与 MINIMAX_MODEL，AGENT_MINIMAX_MODEL 可以单独指定 Agent 模型；DeepSeek 使用 DEEPSEEK_BASE_URL 与 DEEPSEEK_MODEL。设置界面展示当前 provider 并支持修改模型名称，切换 provider 需要修改服务环境并重启。

个人任务、团队任务与同一 session 的自我复盘均使用服务配置的 provider。OpenCode 子进程只接收所选 provider 的 Key；终端环境不接收模型 Key。知识模块使用独立的 KNOWLEDGE_LLM_PROVIDER。

本次最小请求验证 `https://api.minimaxi.com/v1`、`MiniMax-M2` 返回 HTTP 200，内容 OK，`reasoning_split: true` 返回单独的 reasoning_content。记录见 `evidence/stage-6/minimax-endpoint.json`。当前国内官方文档也列出 `https://api.minimax.cn/v1`；项目使用本次通过认证的地址。

## 思考内容与工具历史

MiniMax-M2 的思考功能持续启用。配置 `reasoning_split: true` 将思考内容放入 reasoning_content，OpenCode 模型声明 `reasoning: true` 和 `interleaved: { field: "reasoning_content" }`。OpenCode 在下一轮 assistant 消息中把思考字段重新传回，保留 tool_calls 与工具结果。服务端知识请求也使用分离参数；JSON 解析器同时支持清理 `<think>...</think>`。

核查依据包括 MiniMax OpenAI 兼容文档、OpenCode v1.18.31 的 provider/transform 实现和 OpenAI-compatible provider 的消息转换实现。真实任务均完成多轮工具调用，最终文件与回复的 `<think>` 标签检查均为零。

## 用量与费用

OpenCode assistant 消息的 tokens 按消息编号去重汇总。inputTokens 为非缓存输入，outputTokens 与 reasoningTokens 分别保存，缓存读写独立保存，totalTokens 优先采用运行时值。cost 保留运行时报告值。

本次自定义 provider 的 cost 均为 0。MiniMax-M2 另外记录 `estimatedCost`、`estimatedCostCurrency: CNY` 与 `estimatedCostSource`，不把运行时的零当作实际账单。估算按每百万 tokens 的人民币价格：非缓存输入 2.1，输出与思考 8.4，缓存读取 0.21，缓存写入 2.625。其他模型名称需要对应价格才能估算。自我复盘费用与用户任务分别记录。

## 十六次真实任务

使用 `demo/stage6-model-tasks` 的四个任务，每种 provider 各运行两次。每次使用独立工作区和 session，关闭知识。任务分别要求修复 money/cart、sort/catalog、html/view、cache/service 两个源文件并执行测试。判定器重新执行原始 rules.test.js，并检查测试文件保持原内容。

| 任务 | MiniMax 次数 1/2：秒、tokens、估算人民币 | DeepSeek 次数 1/2：秒、tokens |
| --- | --- | --- |
| money | 24.557 / 182525 / 0.393962；22.183 / 162836 / 0.352855 | 10.783 / 102974；9.509 / 103128 |
| immutable | 13.824 / 98775 / 0.213387；16.274 / 138635 / 0.297969 | 7.339 / 102242；7.870 / 103086 |
| escape | 20.454 / 179748 / 0.385932；14.991 / 118873 / 0.256229 | 8.097 / 103054；8.244 / 102659 |
| cache | 22.290 / 163522 / 0.354446；16.398 / 99476 / 0.216825 | 8.062 / 102955；8.153 / 103056 |

| 指标 | minimax / MiniMax-M2 | deepseek / deepseek-flash |
| --- | --- | --- |
| completed 与功能测试通过 | 8/8 | 8/8 |
| Agent 执行测试 | 8/8 | 8/8 |
| 工具错误 | 0 | 0 |
| 文件或最终回复出现 think 标签 | 0 | 0 |
| 原测试文件保持原内容 | 8/8 | 8/8 |
| 墙钟时间合计 / 平均 | 150.971 秒 / 18.871 秒 | 68.057 秒 / 8.507 秒 |
| 总 tokens | 1144390 | 823154 |
| 费用 | 估算人民币 2.471606 元 | SDK cost=0，账单费用未取得 |

工具错误按终态 tool error 计数，功能判定来自测试执行；思考泄漏检查搜索源文件和最终回复中的 think 标签。DeepSeek 使用本机配置的 deepseek-flash。原始记录位于 `evidence/stage-6/<provider>-<task>-<attempt>.json`。

本次 MiniMax 的工具错误和功能完成结果符合阶段要求，保留为点三默认 Agent 模型。它的平均耗时约为 DeepSeek 的 2.22 倍，token 数约为 1.39 倍。四个任务的冒烟结果用于确认运行兼容性，论文实验还需使用正式任务与判定器。旧原型的 60 次草稿实验使用 DeepSeek，模型差异需要单独记录。

## 资料

- MiniMax OpenAI 兼容接口：https://platform.minimaxi.com/docs/api-reference/text-openai-api.md
- MiniMax 价格：https://platform.minimaxi.com/docs/pricing/overview.md
- OpenCode v1.18.31 provider：https://raw.githubusercontent.com/anomalyco/opencode/v1.18.31/packages/opencode/src/provider/provider.ts
- OpenCode v1.18.31 transform：https://raw.githubusercontent.com/anomalyco/opencode/v1.18.31/packages/opencode/src/provider/transform.ts
