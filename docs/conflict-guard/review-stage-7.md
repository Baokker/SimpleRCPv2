# 阶段七复核验证

检查基线为 `e983871`，范围包含属主仲裁、意图记录、审批等待和 Agent 回放。代码标准与阶段七需求分别复核，修补后的最终复核未发现新的明确问题。

## 范围与状态

| 检查项 | 当前行为 | 实现位置 |
|---|---|---|
| 实际修改范围 | 使用归属事件的内容哈希选择已写入的提案；格式化改变内容时，使用随后归属到该 Agent 的 edit 范围 | `packages/conflict-guard/src/replay/agents.ts` |
| 审批状态 | T2 请求进入 waiting；拒绝或放行后根据等待卡片计算 running 或 blocked | `replay/agents.ts`、`projectArbitration.ts` |
| 卡片状态 | 根据全部等待卡片计算双方意图状态；同一参与者的其他卡片仍在等待时保留 blocked | `coordination/ownerCards.ts`、`coordination/intents.ts` |
| 结束状态 | done 与 reverted 不受活动卡片的状态更新影响 | `coordination/intents.ts` |
| 归属完整性 | 内容哈希无法匹配、也没有后续实际编辑的归属记录计入 errors | `replay/agents.ts` |

## 回归断言

`src/replay/agents.test.ts` 验证先拒绝 total 的提案、随后只批准 unrelated 的修改时，actualScope 只包含 unrelated，taskRevision 保持零；另验证格式化后的归属、双方采纳后的状态恢复、重复提案复用卡片，以及两张卡片依次处理。

服务端 `projectArbitration.integration.test.ts` 使用真实 createApp、WebsocketProvider、permissionDispatcher 和文件写入，时间参数为 idleMs=1500、文件写入延迟 300 ms。断言一方让路后另一方恢复 running；三个 Agent 参与两张卡片时，处理首张卡片后共享参与者仍为 blocked，处理第二张后恢复 running，两个等待审批均收到 reject。

## 录制证据

六份 D3 冒烟轨迹及跨属主采纳、同属主处理的两份浏览器轨迹，分别在 owner、all-human、all-auto 下重复三次。使用已有研判缓存，八份轨迹均通过逐字节一致性检查，errors 为空；注入关闭的轨迹保持空注入结果。

结果索引为 `evidence/stage-7-review/replays.json`，各 arbitration.json 保存在对应录制证据目录。真实 Agent 运行新增次数为零，阶段七预算仍为 39/40，保留集未执行评价。

## 验证结果

| 检查 | 结果 |
|---|---|
| pnpm -r build | 通过 |
| conflict-guard 全量测试 | 214 项通过 |
| 服务端全量测试 | 273 项通过 |
| Agent 回放与仲裁用例 | 14 项通过 |
| 生产时间参数仲裁集成 | 9 项通过 |
| pnpm test:demo | 2 项通过 |
| test:collab，off/observe/rules/full | 每种模式 2 项通过 |
| 录制证据回放 | 八份轨迹 × 三种模式 × 三次通过 |
| 根目录 .env 精确值扫描 | 匹配计数为 0 |

验证结果保存在 `evidence/stage-7-review/verification.json`。
