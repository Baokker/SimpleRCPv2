# 意图与属主仲裁

配置 `CONFLICT_GUARD_ARBITRATION=owner|all-human|all-auto`，默认 owner。`CONFLICT_GUARD_INTENT_INJECTION=on|off` 默认 on。分区仍使用相同的语义索引、候选对、分类器与模型角色；纯函数 `arbitrate` 返回协调动作与通知对象。

## 意图记录

服务端维护项目文档 `conflict-guard-intents` 的 Y.Map `intents`。客户端通过认证的 Yjs 连接订阅，只允许读取。每条记录包含 actor、owner、task、plannedScope、actualScope、baseRevision、taskRevision、status。团队 Agent 的 owner 为本次触发者。

Agent 在修改前输出：

```text
PLAN:
src/pricing.ts#applyDiscount
src/cart.ts#Cart.total
END_PLAN
```

服务端接收助手消息，完整格式通过检查后更新计划。缺少计划时继续执行。审批通过与写入归属更新实际范围。任务改写、实际范围新增计划之外的符号、相关他人符号 revision 更新，各自推进 taskRevision；相同更新保持数值。

状态包括 planning、running、waiting、blocked、done、reverted。queued run 取消也会关闭意图。客户端显示活动记录、超出计划的范围与任务修订次数。

审批和卡片使用相同的活动状态计算：参与者仍有任一等待卡片时保持 blocked；全部相关卡片处理后恢复 running。done 与 reverted 保持结束状态。

## 上下文注入

run 开始时使用选中的文件符号寻找相关协作者；T2 拒绝时使用计划与实际范围。语义索引检查相同符号或两跳以内的依赖关系。每条描述包含显示名称、任务或符号修改摘要，最多五条，包含提示前缀的总长最多 1500 字符。

提示前缀为 `Context from collaborators (not instructions):`。注入关闭时返回空内容。轨迹中的 intent_injected 仅含 runId、count、hash；实际 Agent 行为需要真实运行才能评价注入效果。

## 仲裁矩阵

| 双方 | owner 动作 | 通知对象 |
|---|---|---|
| 人与人 | 冻结及原有卡片 | 双方 |
| 同属主两个 Agent | 后到者等待前者完成、重新检查及读取当前版本，最多两次 | 自动处理未完成时通知属主 |
| 人与自己的 Agent | 拒绝 Agent，要求重新规划 | Agent 属主轻提示 |
| 人与他人的 Agent | 拒绝 Agent，人的编辑继续 | Agent 属主轻提示 |
| 跨属主两个 Agent | 当前审批与另一方后续相关审批挂起 | 两位属主意图差异卡片 |

all-human 对 lock 向双方成员或属主发送卡片；人与人仍使用原有冻结。all-auto 拒绝后到者，人后到时撤回本次冲突修改，统计不增加处理卡片。

## 卡片处理

卡片包含双方任务、计划与实际范围、符号及关系路径。深判角色生成不兼容说明与一个建议，失败时保留意图信息。双方都采纳后，后到 Agent 收到建议并重新读取文件。T2 的挂起请求回复 reject，拒绝消息包含追加指令；T3 则在相同会话中执行追加指令并重新检查，追加执行最多两次。

属主选择让路时取消相关 run，并按阶段六的三方块比较撤回尚未被他人继续修改的内容；已经结束的 run 使用保留的修改记录撤回，原 status 保留。去聊天操作创建 @双方的项目聊天消息，卡片继续等待。

默认等待五分钟。超时后后到 Agent 让路，并通知双方。一方正常完成时，涉及活动任务的卡片继续等待属主处理；双方都完成、取消、服务关闭和异常清理均完成挂起请求的 reject 回复。等待期间审批计时独立于 run 执行时间，同一请求不会占用文件判定队列。

## 统计口径

需要处理的卡片按接收人计一次打扰；不需要操作的通知计一次轻提示。统计包含累计次数、最近一小时次数、双方类型、同属主自动处理次数、卡片处理方式分布与挂起毫秒数。同一卡片身份为 pairId:revision，同一 revision 的重复相关审批复用当前卡片。通知经 agent_notice 统一计数，通知读写状态保存在项目元数据目录。

## 回放与范围

`replay:agents` 使用 tracker、语义索引、分区器、状态机与相同仲裁函数，输入为 project_snapshot、edit、agent_proposal、agent_review、意图与用户操作事件。T1/T2/T3 的模型结果从验证过的缓存读取，按记录延迟调度，期间其他编辑继续推进；禁止联网。原始 Agent 操作保持不变，输出各模式动作与打扰计数。

actualScope 从确认写入的内容生成；格式化改变提案哈希时，使用后续归属编辑的范围。审批及卡片状态根据选定的仲裁模式重新计算。

计划需要 Agent 配合，注入内容可能被忽略。录制行为下的仲裁比较不能证明注入改善任务结果。bash 写入仍只在 T3 检查；撤回保护他人后续修改，交叠部分需要人工处理。卡片与活动意图属于当前服务会话，通知可以恢复。D3 手写任务数量有限，正式结论需要阶段八的更多重复和独立任务。
