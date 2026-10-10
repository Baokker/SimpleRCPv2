# v2.1 实验准备记录

## 模型与数据

新的数据校准、Agent 任务、草稿、服务端复盘和 Agent 自我复盘统一使用 `minimax / MiniMax-M3`。历史模型结果分别统计。正式配置为 `experiments/knowledge/formal-v21.json`，Agent 与知识模块的实际配置均由运行工具核验。

数据提交为 `ea11a85ed344c522fe3b63288cd8577c94fa6498`，manifest SHA-256 为 `3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`。数据包含 16 个陷阱、6 个对照、6 对迁移任务和2段脚本。34个任务的124份参考补丁均通过预期行为判定。

新增陷阱各执行三次真实 M3 无知识运行。五个任务三次功能通过且踩坑；R2-T06 两次功能通过且踩坑，一次功能失败。两个新增对照各三次联合成功。`natural` 补丁与 C0 校准使用同一组运行，样本量只计算一次。R2-T08 使用 CSV 任务，记录位于数据仓库 `calibration/expansion-v21-m3-csv/`。

## 六对迁移任务校准

| 任务 | 功能通过 | 功能通过且踩坑 |
|---|---:|---:|
| P01-Ta | 3/3 | 3/3 |
| P01-Tb | 3/3 | 1/3 |
| P02-Ta | 3/3 | 3/3 |
| P02-Tb | 3/3 | 3/3 |
| P03-Ta | 3/3 | 2/3 |
| P03-Tb | 3/3 | 3/3 |
| P04-Ta | 2/3 | 1/3 |
| P04-Tb | 1/3 | 1/3 |
| P05-Ta | 3/3 | 3/3 |
| P05-Tb | 3/3 | 3/3 |
| P06-Ta | 3/3 | 0/3 |
| P06-Tb | 3/3 | 0/3 |

36次运行中33次功能通过，23次功能通过且踩坑。P06 的 M3 校准三次均避开陷阱，正式 E5 按 `actuallyTrapped` 筛选，可能没有该任务的合格样本。任务与判定规则保持原内容。

一次 P01-Ta 的 C0 Agent 调用了 `knowledge_search`，工具返回空列表。该项目 `toolEnabled=false`，没有知识送达。C3、C4 继续按实验设计取消。

## 复盘通道验收

最终构建的服务端复盘连续三次均合法、引用可解析、没有兜底，引用条数为9、11、9，耗时8.633、15.162、7.774秒。规则均包含 `InventoryStore.transaction`。完整证据33462字符，提供给模型的证据13568字符。原始模型文字保存在 `experiments/knowledge/runs/E6-recap-acceptance-v21-m3-final/`。

命令：

```sh
pnpm --filter @simplercp/experiments exec tsx verify-recap-v21.ts E6-recap-acceptance-v21-m3-final
```

另用真实 P03 episode 检查普通草稿、服务端复盘、Agent 自我复盘，各返回合法且引用可解析的结果，均为 M3。该次三份草稿都没有覆盖指定完整对象 `NotificationOutbox.logicalId`，类型也不属于预定 constraint；这属于内容质量观察。服务端和 Agent 自我复盘提供的自动检查均通过前后版本验证。

T4 的真实 P03 验收中，卡片属于 member-a 的个人范围，未提供给 member-b，后者仍复犯。验收仅检查运行路径，全部验收数据与正式样本分别保存。

## 统计口径

送达分为 `lexical`、`fileRelated`、`projectFallback`。结果同时记录全部卡片数量 `delivery` 和目标卡片数量 `targetDelivery`；送达率使用目标卡片记录。C1 的静态 AGENTS.md 阅读没有注入或工具事件，单独注明其观察限制。

E5 分别报告全部组合与 Ta 实际踩坑的组合；同 pair、variant、repetition 在各条件间的 Ta 状态不一致时单独列出。平台 `k4` 为正式入口，数据仓库工具仅用于校准。E6 失败结果排除于内容质量和人工评分，失败率单独报告。人工评分表由两名标注者独立填写。

## 运行检查

`pnpm build`、`pnpm test`、实验工具测试、数据工具测试与 TypeScript 检查通过；普通 E2E 为24项通过、33项按项目配置跳过，知识 E2E 为25项通过。正式冻结前再次执行数据验证和平台测试，结果保存于实验 `.work/`。
