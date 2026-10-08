# 分区规则求值顺序

配置版本为 `routing-ui-1`。候选生成前，用 TypeScript AST 比较语法结构与 token 内容，过滤注释、空白与缩进修改。字符串内容、正则表达式与换行引起的语法变化保留。仅修改注释的批次记录 `change_unit.commentOnly=true`，符号列表为空。声明之间的注释与空白不产生符号变更，也不产生 T0 提示。

分类器预先检查引用删除、导出删除、调用签名、返回属性和接口成员不兼容，供白区规则使用。之后按下面的顺序选择结果。

| 顺序 | 规则 | 结果与条件 |
|---|---|---|
| 1 | `comment-only-edit` | 两侧都仅修改注释或空白，白区放行。 |
| 2 | `comment-format-only` | 一侧仅修改注释或空白，双方没有已确认的接口不兼容，白区放行。 |
| 3 | `observability-only` | 一侧仅修改无副作用的日志，双方没有已确认的接口不兼容。同声明任一侧改变公开接口时继续检查。 |
| 4 | `declaration-body-unrelated` | 同一声明、两侧公开接口保持不变、修改行距离超过配置值，灰区警告。 |
| 5 | `same-symbol-concurrent-write` | 其余同符号或包含关系的并发修改，黑区冻结。 |
| 6 | `type-only-unchanged` | 仅类型关联且类型接口保持不变，白区放行。 |
| 7 | `equivalent-refactor` | 等价重构且没有已确认的接口不兼容，白区放行。 |
| 8 | `referenced-symbol-removed` | 删除仍被使用的符号，黑区。 |
| 9 | `runtime-export-removed` | 删除仍被使用的运行时导出，黑区。 |
| 10 | `call-signature-incompatible` | 调用签名不兼容，黑区。 |
| 11 | `consumed-return-property-removed` | 删除调用方读取的返回属性，黑区。 |
| 12 | `interface-required-member-incompatible` | 接口必需成员不兼容，黑区。 |
| 13 | `merge-only-type-error` | 合并状态独有的类型错误，黑区。 |
| 14 | `unparsable-side` | 暂时无法解析，灰区。 |
| 15 | `semantic-interaction-uncertain` | 其余有关联的修改，灰区。 |

无副作用的白区情形优先结束判断，因此注释与空白不会进入同声明冻结规则。日志参数中的函数调用保留语义检查。相邻行仍然使用同声明并发修改规则；参数、返回类型和导出变化也继续检查黑区。

`CONFLICT_GUARD_BODY_ADJACENT_LINES=3` 表示两侧任意修改行范围之间的距离不超过 3 行时视为相邻。例如第 4 行与第 8 行的距离为 4，可以进入 `declaration-body-unrelated`；第 4 行与第 7 行的距离为 3，继续检查黑区。配置必须为非负整数，写入服务端 `session_start.config`，回放读取相同数值。

`declaration-body-unrelated` 的结果带 `localOnly=true`，在 `rules` 和 `full` 中保持本地灰区警告。该规则判断修改位置与公开接口，不证明两处计算完全独立；用户仍需检查警告。其他灰区继续使用所配置的模型策略。
