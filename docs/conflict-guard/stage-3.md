# 阶段 3：规则分区与干预

`src/routing/rules/` 中每条分区规则有独立文件。`classify` 按配置的规则顺序返回首个结果，白区放行条件同时检查双方之间可确认的接口不兼容。`same-symbol-concurrent-write` 位于 `type-only-unchanged` 之前，`call-signature-incompatible` 位于 `consumed-return-property-removed` 之前。

四状态检查使用一个 LanguageService 临时切换受影响文件的快照，读取 TypeScript lib，超过 500 ms 返回跳过结果。返回局部对象变量时提取其已知属性；返回未知变量或者带有未知 spread 的对象时保留属性集合的不确定性。外部接口变化分析只分析具名声明自身的参数、返回类型、导出与返回属性，内部函数变化保持独立。

`src/coordination/` 维护变更对 revision、判定、双方确认、冻结区域和写入文件闸门。revision 由双方符号的 before/after 哈希和关系路径决定。`observe` 只显示结果，`rules/full` 提供冻结、确认和撤回操作。

## 验证命令

- `pnpm -r build`
- `pnpm --filter @simplercp/conflict-guard test`
- `pnpm --filter @simplercp/server test`
- `pnpm test:demo`
- `CONFLICT_GUARD=off|observe|rules pnpm test:collab`
- `pnpm test:e2e -- tests/e2e/conflict-guard-panel.spec.ts tests/e2e/conflict-guard-intervention.spec.ts`

当前分区器单元测试 31 项通过，包含接口必需成员、内部箭头函数、符号新增与删除、未知返回变量及规则顺序。生产参数九项服务端场景通过。项目构建与全部回归的最终命令结果记录于 `review-fix-checkpoint-a.md`。

## 生产参数服务端场景

`conflictGuardScenarios.integration.test.ts` 使用真实 `createApp`、两名成员和两个 `WebsocketProvider`，`idleMs=1500`，写入延迟为默认的 300 ms。以下九项均通过：

| 场景 | 核验内容 | 录制文件 |
|---|---|---|
| 日志白区 | allow、没有冻结、双方文本写入文件 | `rules-white.jsonl` |
| 计算灰区 | warn、没有冻结、双方文本写入文件 | `rules-grey.jsonl` |
| 合并独有类型错误 | `merge-only-type-error`、诊断 2339、双方冻结 | `rules-merge-type-error.jsonl` |
| 双方确认 | 首次确认保持冻结，双方确认后写入双方内容 | `rules-confirmed.jsonl` |
| 重判 | 必需参数改为可选后 `auto-cleared`、恢复写入 | `rules-rejudged.jsonl` |
| 撤回 | `guard-revert`、`resolved(reverted)`、调用方内容补写 | `rules-reverted.jsonl` |
| 冻结违规 | 直接 Yjs 事务继续同步，按编辑记录一次违规 | `rules-freeze-violation.jsonl` |
| 多文件 resync | 实际 observer 遗漏、范围移动、revision 保持 | `rules-mirror-resync-multifile.jsonl` |
| observe | 黑区判定、没有冻结与写入阻挡 | `observe-observe.jsonl` |

录制与完整初始项目文本位于 `evidence/checkpoint-a-live-traces/`。保存前等待打开的批次关闭和语义更新，再等待轨迹写入完成。合并独有类型错误场景的示例四状态耗时为 66.87 ms，诊断为 `Property 'toUpperCase' does not exist on type 'number'`。

同一测试文件还包含两项生产参数回归：完成并释放文档后重新打开，在新一轮锁定中撤回本人修改；删除被引用导出后，在批次尚未关闭的 500 ms 时保持磁盘原文，最终黑区判定后继续阻挡写入。两项均通过。

```text
SIMPLERCP_CHECKPOINT_EVIDENCE=<evidence/checkpoint-a-live-traces 绝对路径> pnpm --filter @simplercp/server test -- src/__tests__/conflictGuardScenarios.integration.test.ts
pnpm --filter @simplercp/conflict-guard test -- src/routing/classifier.test.ts src/routing/greylock-parity.test.ts
```

## GreyLock 原始分区样例对照

从 `packages/open-collaboration-vscode/test/pair-zone-classifier.test.ts` 读取全部 47 个分类调用，展开 `test.each`，保留每条输入，使用真实旧 classifier 与当前 `classify` 执行。接口样例使用旧 `classifyPairZoneWithInterfaceContract`。method 输入按 TypeScript AST 提取相应成员声明，已消失的声明按 deleted 状态传入。此项对照检查移植规则，不额外加入四状态规则。

来源 SHA-256 为 `ee17458de796fbd9ad29fe40c51fae6dfb531abef3d8c8af26d513cee968cf5b`。完整输入、原测试名、源行号、双方结果保存在 `evidence/checkpoint-a-greylock-parity.json`。47 项中的分区一致数和规则一致数均为 27；原白区 2 项全部一致，原黑区 18 项中 12 项一致，原灰区 27 项中 13 项一致。

规则 ID 对照将 `strict-observability` 映射为 `observability-only`，将 `unparseable-edit-batch` 映射为 `unparsable-side`。下表每一行对应一个实际调用。三个源行号为 902 的调用依次为写入属性、删除属性和提供 nullish 默认值；两个源行号为 967 的调用依次为权限策略和无单位元数据的换算。

| 调用 | 原测试源行号 | GreyLock ruleId | 当前 ruleId |
|---|---|---|---|
| 1 | 17 | strict-observability | observability-only |
| 2 | 43 | equivalent-refactor | equivalent-refactor |
| 3 | 60 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 4 | 73 | call-signature-incompatible | call-signature-incompatible |
| 5 | 88 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 6 | 102 | call-signature-incompatible | semantic-interaction-uncertain |
| 7 | 124 | interface-required-member-incompatible | interface-required-member-incompatible |
| 8 | 165 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 9 | 190 | semantic-interaction-uncertain | interface-required-member-incompatible |
| 10 | 213 | runtime-export-removed | semantic-interaction-uncertain |
| 11 | 235 | semantic-interaction-uncertain | runtime-export-removed |
| 12 | 262 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 13 | 297 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 14 | 324 | runtime-export-removed | runtime-export-removed |
| 15 | 360 | runtime-export-removed | semantic-interaction-uncertain |
| 16 | 387 | runtime-export-removed | semantic-interaction-uncertain |
| 17 | 416 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 18 | 443 | semantic-interaction-uncertain | runtime-export-removed |
| 19 | 457 | call-signature-incompatible | call-signature-incompatible |
| 20 | 493 | semantic-interaction-uncertain | call-signature-incompatible |
| 21 | 528 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 22 | 560 | semantic-interaction-uncertain | call-signature-incompatible |
| 23 | 578 | semantic-interaction-uncertain | call-signature-incompatible |
| 24 | 600 | semantic-interaction-uncertain | consumed-return-property-removed |
| 25 | 626 | consumed-return-property-removed | consumed-return-property-removed |
| 26 | 652 | call-signature-incompatible | semantic-interaction-uncertain |
| 27 | 690 | call-signature-incompatible | call-signature-incompatible |
| 28 | 709 | referenced-symbol-removed | referenced-symbol-removed |
| 29 | 721 | call-signature-incompatible | call-signature-incompatible |
| 30 | 736 | consumed-return-property-removed | consumed-return-property-removed |
| 31 | 751 | consumed-return-property-removed | consumed-return-property-removed |
| 32 | 766 | consumed-return-property-removed | semantic-interaction-uncertain |
| 33 | 781 | consumed-return-property-removed | consumed-return-property-removed |
| 34 | 796 | consumed-return-property-removed | consumed-return-property-removed |
| 35 | 811 | semantic-interaction-uncertain | consumed-return-property-removed |
| 36 | 826 | semantic-interaction-uncertain | consumed-return-property-removed |
| 37 | 841 | semantic-interaction-uncertain | consumed-return-property-removed |
| 38 | 856 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 39 | 871 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 40 | 902 | semantic-interaction-uncertain | consumed-return-property-removed |
| 41 | 902 | semantic-interaction-uncertain | consumed-return-property-removed |
| 42 | 902 | semantic-interaction-uncertain | consumed-return-property-removed |
| 43 | 917 | semantic-interaction-uncertain | consumed-return-property-removed |
| 44 | 932 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 45 | 967 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 46 | 967 | semantic-interaction-uncertain | semantic-interaction-uncertain |
| 47 | 976 | unparseable-edit-batch | unparsable-side |

20 项差异集中在 imported alias 和 public alias 的绑定、历史绑定路径校验、其他 module 中的同名声明、返回结果的消费分析（destructuring、optional、nullish、重新赋值、写入和删除属性）、带有 spread 的接口对象。它们记录为规则分析的已知限制。D2 的 51 个来源动作包含 41 个 warn 与 10 个 allow，执行结果 51 项一致；黑区移植证据采用以上原始测试对照。

各差异的具体边界如下。行号与上表对应，相关输入保存在完整 JSON 中。

| 原测试源行号 | 当前分析范围 |
|---|---|
| 102、652 | 调用检查按具名声明名称匹配，未追踪 imported alias 的调用名称。 |
| 190 | 接口必需成员检查无法证明 spread 对象提供了对应成员。 |
| 213、360 | 删除导出检查没有完整的跨文件 import 绑定证据。 |
| 235 | 同名调用通过名称匹配，无法识别来自其他 module 的声明。 |
| 387 | 未区分被移除的 public alias 与同一声明的其他导出。 |
| 443 | 缺少项目绑定证据时，名称匹配仍可能给出黑区。 |
| 493 | 未核验原 TypeChecker 路径对应的调用目标是否发生变化。 |
| 560 | 未核验绑定路径所属的调用方文件。 |
| 578 | 当前名称检查无法排除其他文件同名的被调用声明。 |
| 600 | 返回属性检查无法排除其他文件同名函数的结果消费。 |
| 766 | 未追踪 destructuring 消费的返回属性。 |
| 811 | awaited 结果的属性读取包含 nullish 默认值，当前检查只识别属性名称。 |
| 826 | awaited 结果使用 optional 读取，当前检查仍识别为属性消费。 |
| 841 | 结果变量重新赋值后，当前检查没有沿赋值路径确认对象来源。 |
| 902（写入） | 局部 alias 的属性写入被当前属性名称检查识别为消费。 |
| 902（删除） | 局部 alias 的属性删除被当前属性名称检查识别为消费。 |
| 902（默认值） | 局部 alias 的 nullish 默认值未影响当前属性名称检查。 |
| 917 | 直接读取包含 nullish 默认值，当前检查仍识别为属性消费。 |

重新读取 GreyLock 并生成对照的命令：

```text
GREYLOCK_PARITY_WRITE=1 pnpm --filter @simplercp/conflict-guard test -- src/routing/greylock-parity.test.ts
```

普通回归使用仓库内保存的完整样例和本地输入类型，逐条检查当前结果。生成模式通过模块 URL 读取旧 classifier，适用于来源文件可用的环境。

## 已知局限与后续

冻结在客户端阻止输入，服务端接受全部 Yjs update，并记录 `freeze_violation`。写入闸门恢复时，磁盘上的外部修改通过保存的 Yjs 状态副本产生 update 后合并回主文档，当前文档内容用于后续写入；`persist_conflict` 记录闸门阻挡期间的外部写入。“我来改”使用按成员和文件维护的 `Y.UndoManager`，撤回范围为该文件本轮活跃变更，文档固定期间保留 Undo 历史。

回放使用 `pair_judged` 的 revision、ruleId、双方符号键与 before/after 哈希，类型检查耗时与跳过原因，以及写入、闸门、冻结事件。人工浏览器验收与一致性检查结果以 `review-fix-checkpoint-a.md` 和检查点 A 证据目录为准。
