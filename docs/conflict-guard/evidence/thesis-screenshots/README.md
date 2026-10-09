# 论文截图说明

截图由 `scripts/capture-thesis-screenshots.mjs` 生成。每个双人场景使用两个独立浏览器会话：Alice 使用深色主题，Bob 使用浅色主题。`*-dual.png` 将两位协作者的页面并排保存；`*-alice-dark.png` 与 `*-bob-light.png` 保留单独页面。对应的 `.json` 保存状态快照，`.jsonl` 保存冲突预防轨迹，`.txt` 保存截图页面文字，便于论文写作时查找界面内容。

## 已保存场景

| 文件前缀 | 场景 | 可用于说明的内容 |
|---|---|---|
| `01-black` | 人与人黑区 | Alice 给 `applyDiscount` 增加必填参数，Bob 仍使用旧调用方式。系统识别函数签名冲突，显示黑区、冻结和“需要你处理”。 |
| `02-white` | 人与人白区 | 一方在 `applyDiscount` 中增加日志，另一方修改结账调用。系统识别为只改日志，直接放行，冻结文件数量为零。 |
| `03-grey` | 人与人灰区 | Alice 在 `applyDiscount` 中将折后价格四舍五入至两位小数，Bob 在 `checkout` 中清理输出两端空白。两个不同函数存在调用关系，模型判断修改之间的影响，返回中文原因和建议。页面显示灰区与研判结果，双方继续编辑。 |
| `04-human-agent` | 人与 Agent | Bob 修改 `applyDiscount` 签名期间，Alice 的 Agent 先提交旧调用并被拒绝，随后重新读取文件，按新签名重新提交并获准。工作详情中保留拒绝、读取、再次编辑和任务完成后复检。 |
| `05-agent-agent-paused` | 跨属主 Agent 意图冲突 | Alice 与 Bob 的 Agent 都计划修改 618 折扣，分别要求五折和八折。意图检查生成跨属主意图差异卡片，双方任务进入等待属主处理状态，卡片包含折中建议。 |
| `05-agent-agent-completed` | 协商后的 Agent 任务 | 双方采纳折中建议后，两个 Agent 继续执行，页面保留协商结果与各自工作详情。 |

本次跨属主 Agent 运行在实际写入前就被意图检查暂停，因此没有生成单独的代码修改冲突截图。它与 `04-human-agent` 的写入前拒绝截图一起说明：任务目标检查可以先于文件修改检查触发；后续需要补充 Agent 已经写入后再发生代码冲突的专门场景。

## 查看与复现

查看截图时优先使用 `01-black-dual.png`、`02-white-dual.png`、`03-grey-dual.png`、`04-human-agent-dual.png` 和 `05-agent-agent-paused-dual.png`。需要展示单个界面或放大冲突卡片时使用对应的深色或浅色单页截图。

需要重新生成时，在仓库根目录执行：

```bash
node scripts/capture-thesis-screenshots.mjs serve
node scripts/capture-thesis-screenshots.mjs black
node scripts/capture-thesis-screenshots.mjs white
node scripts/capture-thesis-screenshots.mjs grey
node scripts/capture-thesis-screenshots.mjs human-agent
node scripts/capture-thesis-screenshots.mjs agent-agent
node scripts/capture-thesis-screenshots.mjs compose
node scripts/capture-thesis-screenshots.mjs check-secrets
```

`serve` 需要保持运行，其他命令使用本地浏览器访问 `http://127.0.0.1:5187`。`human-agent` 与 `agent-agent` 会调用 `.env` 中配置的 DeepSeek Agent，脚本把真实运行次数写入 `.test-workspaces/thesis-screenshots/agent-budget.json`，当前截图任务的上限为 4 次。服务端进程可以使用 `Ctrl-C` 终止。

## 后续研究事项

截图已经展示了当前实现可以观察到的意图检查、写入前检查、属主协商和任务完成后复检。Agent 之间的协作仍有研究空间，具体事项见 [Agent 协作后续事项](../../todo.md)：继续扩充任务目标与计划的冲突检测，增加基于语法符号范围的修改预约和等待机制，并用接口依赖、任务成功率、等待时间、打扰次数和冲突遗漏进行评价。当前截图没有证明这些后续机制已经完成。
