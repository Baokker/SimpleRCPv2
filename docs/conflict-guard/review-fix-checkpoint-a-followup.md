# 检查点 A 补充复核

复核范围为 `0d6c8f7..244dbbe`，执行分支为 `feature/conflict-guard`。测试使用产品 tracker、TypeScript LanguageService、classifier、会话编排器、createApp 与 WebsocketProvider。新增服务端用例使用批次空闲 1500 ms、文件写入防抖 300 ms。

产品修复提交为 `d074d1c`，回放修复提交为 `fa5ca0f`。本报告中的开发集结果与录制轨迹使用这两项提交对应的代码。

## 修改位置与回归测试

| 编号 | 修改位置与行为 | 测试 |
|---|---|---|
| F1 / C7 | `routing/fingerprints.ts`：临时变量消除要求下一条语句直接返回该变量，保持求值条件和调用顺序。 | `改变条件求值的临时变量提取保留语义警告`、`改变调用顺序的临时变量提取保留语义警告`；测试编译并执行双方文本，验证调用记录，再通过真实索引运行 classifier。 |
| F2 / M3 | `replay/engine.ts`：P1 对成员的首次文件编辑登记所有权，注释与空白区域同样建立文件锁。 | `P1 首次编辑文件尾部注释立即冻结其他成员的整个文件`。 |
| F3 / M3 | `replay/engine.ts`：P1/P2 根据编辑所有权标记反事实；反事实输入维护文本坐标，原成员继续拥有编辑权限。P2 查询首次输入前同步当前文件版本。 | `P2 反事实编辑保持原有符号所有权，批次关闭后所有者继续编辑`；`锁定后进入冻结区域的编辑被标记为应当阻止` 验证首次输入与后续输入。 |
| F4 / P7 | `semantic/relations.ts`、`semantic/index.ts`、`routing/candidates.ts`：未解析引用保留导入原名称、alias、namespace 与重导出来源；本地声明及参数保持自身绑定。每次更新重新计算动态悬空边，移除引用后关闭对应关系。 | `未解析引用保留导入名称与重导出来源，排除已有的本地声明`；生产参数 `同名本地函数保持独立关系，不与改名导出形成冻结`；`P7 新增旧名称引用仍与已改名导出形成黑区关系` 同时验证引用移除、解除冻结与恢复文件写入。 |
| F5 / C9 | `routing/contracts.ts`：公开箭头函数属性的参数、返回类型与直接返回形状纳入外部接口指纹。 | `公开箭头函数属性的参数和返回类型变化报告外部接口变化`；生产参数 `公开箭头函数属性签名变化向新批次发送 T0`；函数内部箭头函数的排除用例继续通过。 |
| F6 / P6 | `coordination/session.ts`：冻结范围变换合并相邻替换操作，索引刷新时重新取得当前声明的完整范围。 | 生产参数 `整段替换冻结方法后保留当前声明的完整行范围`，分别验证索引刷新与批次关闭后的完整起止行。 |
| F7 / C9 | `coordination/session.ts`：批次关闭时同步登记外部接口变化，依赖方的即时输入可以查询 T0；语义刷新时继续维护变化表。 | `批次关闭后的即时输入可以查询公开箭头函数的 T0 信息`：1600 ms 关闭 Alice 批次，1601 ms 的 Bob 输入收到 T0；公开箭头函数属性的生产参数用例同时验证通知接收者。 |

## 变异检验

每次检验通过文件编辑工具暂时替换对应条件，运行指定测试，随后恢复修复代码。服务端检验在执行前重新构建 conflict-guard 包，确保使用当前变异产物。以下九次命令均以退出码 1 结束，合计检测十个失败用例。

| 编号 | 变异条件 | 检测结果 |
|---|---|---|
| F1 | 临时变量允许在下一条语句任意位置使用一次。 | 两个可执行样例的 `warn` 断言失败，结果为 `equivalent-refactor/allow`。 |
| F2 | P1 仅对 `symbolsInRange` 返回的声明登记所有权。 | 反事实标记断言失败，第二名成员的输入标记为 false。 |
| F3 | 反事实输入登记所有权，并将产品的双方冻结同时用于基线阻止判断。 | 标记序列断言失败；原成员的第三、第四次输入均被标记为 true。 |
| F3 首次输入 | 移除 P2 输入前的版本同步。 | 首次输入的反事实断言失败。 |
| F4 名称绑定 | 动态悬空边使用文本名称匹配。 | 同名本地函数的空候选对断言失败，出现指向改名导出的候选对。 |
| F4 引用移除 | 动态悬空边在删除符号持续活跃时保留。 | 引用移除后的候选对关闭等待超时，测试失败。 |
| F5 | 外部接口指纹仅处理变量中的箭头函数，属性只读取自身类型标注。 | `symbolContractChanged` 的 true 断言失败。 |
| F6 | 冻结范围逐个处理替换操作，索引刷新保持已有范围。 | 完整行范围断言失败，startLine 与 endLine 均为 15，预期起始行为 11。 |
| F7 | 仅在延迟语义刷新时登记外部接口变化。 | 1601 ms 的 T0 事件断言失败，事件列表为空。 |

压缩后的原始输出保存在 `evidence/checkpoint-a-followup-tests/`。全部条件恢复后重新执行完整构建与测试。

## D2 对照与开发集结果

D2 重新导入并校验 37 份来源与 57 条轨迹哈希。51 个规则案例中，47 个最终动作与来源一致；当前动作为 6 个 allow、45 个 warn。以下四项当前均为 `semantic-interaction-uncertain/warn`，来源动作为 allow：

- `ky-retry-method-normalization-safe`
- `ky-json-schema-validation-order-safe`
- `defu-config-layer-order-safe`
- `cookie-max-age-validation-safe`

这四项临时变量使用形式未满足保持求值条件与调用顺序的等价检查。来源标签保存在 `sourceTruth` 与 `sourceDecision`，完整判定及差异保存在 D2 的 `manifest.json`、`replay-results.json` 与 `verification.json`。GreyLock 原始测试的 47 个 classifier 调用仍为 27 个分区和规则一致、20 个记录差异，逐项证据见 `stage-3.md`。

开发集每个策略运行 28 个去重样本，重复两次。两个独立进程结果除 `timing` 外逐字节相同，SHA-256 为 `c23fa19bb907343a9be37240eff20eb9d08f543285121f0053d3ea348d2c25d8`。保留集策略没有执行。

| 策略 | 逃逸率 | 漏阻断率 | 误阻断率 | 本地决定比例 | 冻结人秒 |
|---|---:|---:|---:|---:|---:|
| P0 | 100.0% | 100.0% | 0.0% | N/A | 0.00 |
| P1 | 90.0% | 87.5% | 33.3% | N/A | 29873.85 |
| P2 | 0.0% | 0.0% | 72.2% | N/A | 27335.33 |
| P3 | 0.0% | 62.5% | 0.0% | 24.2% | 3355.05 |
| P* | 0.0% | 0.0% | 0.0% | N/A | 11408.82 |

完整 JSON 以 gzip 保存于 `evidence/checkpoint-a-followup-dev-report/results.json.gz`，同目录包含 Markdown 主表、Wilson 区间、分组指标、散点图和确定性证据。P3 的 runtime-only 样例获得 warn 或 T0 提示；提示效果与 lock 判定能力由逃逸率、漏阻断率分别描述。

## 验证命令

| 命令 | 结果 |
|---|---|
| `pnpm -r build` | 四个包通过 |
| `pnpm --filter @simplercp/conflict-guard test` | 12 个测试文件、137 项通过 |
| `pnpm --filter @simplercp/server test` | 40 个测试文件、181 项通过 |
| `pnpm test:demo` | 2 项通过 |
| `CONFLICT_GUARD=rules SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/collaboration.spec.ts tests/e2e/conflict-guard-panel.spec.ts tests/e2e/conflict-guard-intervention.spec.ts tests/e2e/conflict-guard-checkpoint.spec.ts tests/e2e/conflict-guard-replay.spec.ts` | 17 项通过 |
| `CONFLICT_GUARD=off SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/collaboration.spec.ts tests/e2e/conflict-guard-panel.spec.ts` | 3 项通过 |
| `CONFLICT_GUARD=observe SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/collaboration.spec.ts tests/e2e/conflict-guard-panel.spec.ts` | 3 项通过 |
| `bench:import-greylock --source ../../../collaboration-tools` | 哈希及重复执行通过，47/51 动作一致 |
| `replay:run --dataset bench/datasets/d1-v1 --split dev --policy 'P0,P1,P2,P3,P*' --repeat 2` | 两个独立进程均通过，各策略零错误 |
| `pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/check-checkpoint-traces.ts <本次录制目录>` | 九份真实服务端轨迹通过，判定、闸门、写入和冻结事件零差异，errors 为空 |

浏览器用 DOM、编辑器内容及文件读取断言完成阶段 3 十项与先后编辑、关闭重开、切换文件撤回三项。截图位于 `evidence/checkpoint-a-manual/`，幽灵成员回放轨迹位于 `evidence/stage-4-ui/`。

本次录制目录为 `evidence/checkpoint-a-followup-live-traces/`。九份轨迹覆盖白区、灰区、合并独有类型错误、确认、撤回、重判、冻结期间输入、observe 与多文件 `mirror_resync`；每份保留完整初始项目文本与 `verification.json`。

服务端完整 `updateSemantic` 测量包含目录扫描和 pricing 的直接引用更新：首次 5.41 ms，30 次增量 p50 为 5.40 ms、p95 为 6.58 ms。300 文件合成索引在与构建同时运行的测试中测量为 273.63 ms；性能数字来自实际进程，独立记录于测试日志。

提交前执行 `node scripts/verify-evidence-secrets.mjs`，检查普通文件及 gzip 解压内容，精确匹配计数为零。所有提交保存在 `feature/conflict-guard`；main 保持原状态，远端未推送。
