# 阶段七：意图与属主仲裁

## 功能与位置

`packages/conflict-guard/src/coordination/` 提供 arbitrate、IntentBoard、意图注入和 OwnerCards，覆盖五种属主关系及 owner、all-human、all-auto 模式。意图通过认证的只读 Y.Map 同步；任务、范围和依据变化推进 taskRevision。

服务端 projectArbitration.ts 连接审批挂起、同属主等待与重查、跨属主卡片、深判建议、通知和打扰统计。取消、超时、服务关闭和异常清理保证回复 reject。一方正常完成时，涉及另一方活动任务的卡片继续保留。

agentRunManager.ts 接收 PLAN、注入相关上下文，并在 T3 双方采纳后使用原会话执行追加指令。projectAgentGuard.ts 保存审批修改和结束快照净修改；属主让路可以撤回活动任务或已经完成任务的修改，并保护他人继续修改的内容。

客户端显示意图板、超出计划的实际范围、意图差异卡片及统计。卡片支持双方采纳、一方让路和创建 @双方的聊天消息。同属主自动处理次数在页签显示。

replay/agents.ts 使用产品 tracker、索引、分类器、状态机和仲裁函数。T1/T2/T3 使用验证过的缓存，按触发时刻与记录延迟推进模拟时钟；活跃参与者变化会重新检查输入。TypeScript libraries 保留至四状态检查，输入轨迹保持只读。会话记录仲裁模式与注入开关。

## D3 与真实冒烟

D3-v0 包含十个跨属主任务对和三个同属主任务对，使用 commerce、calendar、cache、text、events、billing 六个项目。每对配最终源码验收测试；六个项目的原有测试通过，十三对任务的初始状态均未满足对应验收测试。

d3-01、d3-02、d3-03 在注入开启和关闭下各执行一次。每对启动两个真实 OpenCode Agent，使用配置的 DeepSeek。证据位于 evidence/stage-7-smoke/。

| 注入 | 任务对通过 | run 完成 | 跨属主卡片 | 采纳 | T3 追加执行 | 轻提示 |
|---|---:|---:|---:|---:|---:|---:|
| on | 3/3 | 6/6 | 2 | 2 | 2 | 1 |
| off | 3/3 | 6/6 | 0 | 0 | 0 | 2 |

十二个正式冒烟 run 的 T3 为 passed 七次、warned 五次。两次建议追加执行完成后，相关 T3 仍报告 warned；最终源码验收均通过。该样本验证流程，注入效果需要更多重复和独立任务才能评价。

冒烟和调试合计使用 39 次真实 Agent run。run-budget.json 保存计数和身份；脚本在创建任务之前检查四十次上限。保留集未执行策略评价。

六份冒烟轨迹分别在三种仲裁模式下重复三次，结果 JSON 逐字节一致，errors 为空。跨属主冲突下 owner 与 all-human 各向两位属主计数，all-auto 不增加处理卡片；含同属主冲突的包内测试得到三种模式的打扰次数 2、3、0。关闭注入的轨迹不生成注入结果。

## 浏览器验收

两个真实浏览器上下文以 Alice、Bob 加入项目，使用真实 Agent 执行跨属主双方采纳、Bob 让路、同属主等待与重查、人优先四个流程。意图板、实际范围、建议执行、修改撤回和统计通过 DOM、Monaco、接口、轨迹及文件断言核验。六项人工清单均有对应断言；双方截图和状态记录保存在 evidence/stage-7-manual/。截图未用于内容识别。

## 验证

| 检查 | 结果 |
|---|---|
| pnpm -r build | 通过 |
| conflict-guard 测试 | 214 项通过 |
| 服务端测试 | 273 项通过 |
| 生产时间参数的仲裁集成 | 9 项通过，idleMs=1500、文件写入延迟 300 ms |
| pnpm test:demo | 2 项通过 |
| test:collab，off/observe/rules/full | 每种模式 2 项通过 |
| 阶段二、三 Playwright 回归 | 15 项通过 |
| Agent Playwright 回归 | owner 下人优先与 T3；all-auto 下后到 Agent 拒绝 |
| observe Agent Playwright 回归 | shadow 提示和直接写入通过 |
| 基础界面 Playwright 回归 | 19 项通过 |
| 真实模型 Playwright 回归 | 正常端点 2 项、鉴权失败 1 项通过 |
| D3 初始项目与验收前提 | 六个项目、十三个任务对通过检查 |
| 录制缓存回放 | 六份轨迹 × 三种模式 × 三次，确定性与错误检查通过 |

两路最终复核未发现新的明确功能问题。密钥扫描比较根目录 .env 的精确值，只输出匹配计数；测试与回放验证记录见 evidence/stage-7-review/verification.json，真实冒烟记录见 evidence/stage-7-smoke/verification.json。

意图范围、多个卡片的活动状态与录制证据的复核验证见 [review-stage-7.md](review-stage-7.md)。

## 局限与阶段八

计划需要 Agent 按格式输出，注入文本可能被忽略。历史轨迹缺少开始时的文件上下文范围时，注入范围根据任务、计划和实际符号恢复；注入效果以真实任务执行评价。

卡片与活动意图属于服务会话，通知保存在项目元数据目录。bash 修改仅在 T3 检查；交叠修改保留供人工处理。建议追加执行最多两次，最终测试通过与 T3 判断分别报告。

阶段八建议增加独立任务与重复运行，固定模型配置、注入开关及仲裁模式，分别评价任务通过率、打扰次数和等待时长。正式保留集评价保持一次性执行，D3 的注入比较使用真实 Agent 运行。
