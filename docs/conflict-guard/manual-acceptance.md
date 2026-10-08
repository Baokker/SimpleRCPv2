# 冲突预防人工验收文档

本文用于在 `feature/conflict-guard` 分支上通过真实浏览器检查冲突预防功能。验收对象是 `demo/conflict-shop`，建议每个场景使用新建项目，避免前一个场景留下的修改影响后续结果。

当前阶段八仍处于检查点 C 等待人工确认状态。X1 至 X7 正式实验和保留集评价暂不执行。

## 一、验收对象

- 协作身份、编辑来源、批次、光标和活跃变更集。
- TypeScript 符号索引、调用关系、类型关系、重导出和两跳候选变更对。
- 白区、灰区、黑区、本地规则、冻结范围、写入闸门和冲突卡片。
- Jev 快判、DeepSeek 深判、分析中状态、失败降级、解释和建议。
- Agent 的 T2 写前审批与 T3 run 结束复检。
- Agent 意图板、意图注入、属主仲裁、意图差异卡片和打扰统计。
- Yjs 文档保持、撤回、外部修改合并、轨迹记录和回放一致性。

## 二、开始之前

开发时，如果另一个进程正在修改这个仓库，`pnpm dev` 中的服务端会随文件变化重新启动。重新启动期间，页面可能出现 500，Vite 可能显示 `ws proxy error: socket hang up`。等待修改停止、终端重新显示监听地址与时间戳后，刷新页面即可。通常不需要重新启动开发服务器。页面会提示“服务端可能正在重启，请稍后刷新”；如果服务端已经启动后仍然持续出现错误，请检查服务端日志。

在项目根目录执行：

```bash
cd "/Users/baokker/Work/Master/CSCW/智能语义冲突预防-update/SimpleRCPv2"
pnpm install
pnpm -r build
```

尚未创建 `.env` 时，执行 `cp .env.example .env`，填写自己的 API Key。已有 `.env` 时，直接修改其中的配置。

`pnpm dev` 必须从 `SimpleRCPv2` 根目录执行。上级目录还包含另一个项目，`pnpm` 从上级目录启动时会扫描到该项目的临时目录，可能出现 `ENAMETOOLONG`。如果终端当前位于上级目录，可以使用：

```bash
pnpm --dir "/Users/baokker/Work/Master/CSCW/智能语义冲突预防-update/SimpleRCPv2" dev
```

## 三、`.env` 配置

### 3.1 人工验收推荐配置

复制 `.env.example` 后，至少填写两枚密钥，并确认以下配置：

```dotenv
PORT=4000
SIMPLERCP_HOST=127.0.0.1
SIMPLERCP_PUBLIC_URL=http://127.0.0.1:5173
SIMPLERCP_TERMINAL_ENABLED=true
SIMPLERCP_FAKE_AGENT_RUNTIME=false
SIMPLERCP_IMPORT_ROOTS=/Users/baokker/Work/Master/CSCW/智能语义冲突预防-update/SimpleRCPv2/demo

CONFLICT_GUARD=full
CONFLICT_GUARD_STRATEGY=G3
CONFLICT_GUARD_THRESHOLD=0
CONFLICT_GUARD_PROVIDER_MODE=live
CONFLICT_GUARD_INVARIANTS=true
CONFLICT_GUARD_BODY_ADJACENT_LINES=3
CONFLICT_GUARD_ARBITRATION=owner
CONFLICT_GUARD_INTENT_INJECTION=on
CONFLICT_GUARD_T2_STRATEGY=G1
CONFLICT_GUARD_T3_STRATEGY=G1
CONFLICT_GUARD_T2_REASONING=false
CONFLICT_GUARD_T3_REASONING=false

DEEPSEEK_API_KEY=填写你的DeepSeek密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-flash
TYPESAFE_API_KEY=填写你的TypeSafe密钥
TYPESAFE_BASE_URL=https://api.typesafe.ai

SIMPLERCP_OPENCODE_PORT=4096
SIMPLERCP_AGENT_RUN_TIMEOUT_MS=600000
SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=3
```

其中 `SIMPLERCP_IMPORT_ROOTS` 必须写绝对路径。路径中包含空格时，直接在 `.env` 中填写完整路径即可。API Key 只放在根目录 `.env`，客户端页面和浏览器请求中不填写 API Key。

### 3.2 模式和默认值

代码默认值用于保证服务可以启动；人工验收使用上面的 `full` 配置。

| 配置 | 代码默认值 | 人工验收值 | 作用 |
|---|---|---|---|
| `CONFLICT_GUARD` | `off` | `full` | `off` 关闭保护，`observe` 只记录，`rules` 使用本地规则，`full` 增加模型研判和 Agent 保护。 |
| `CONFLICT_GUARD_STRATEGY` | `G3` | `G3` | 人与人的灰区策略。 |
| `CONFLICT_GUARD_PROVIDER_MODE` | `live` | `live` | `live` 请求模型，`record` 请求模型并保存缓存，`replay` 只读缓存并禁止联网。 |
| `CONFLICT_GUARD_THRESHOLD` | `0` | `0` | G3 快判升级阈值，当前冻结配置来自开发集校准。 |
| `CONFLICT_GUARD_INVARIANTS` | `true` | `true` | 给模型加入调用点、测试断言、注释和返回值使用方式。 |
| `CONFLICT_GUARD_BODY_ADJACENT_LINES` | `3` | `3` | 同一声明中，两侧修改行距离超过 3 行、公开接口保持不变时给出灰区警告。注释与空白不计入符号修改。 |
| `CONFLICT_GUARD_ARBITRATION` | `owner` | `owner` | 按 Agent 属主决定拒绝、等待、通知和卡片。 |
| `CONFLICT_GUARD_INTENT_INJECTION` | `on` | `on` | 把相关协作者意图加入 Agent 上下文。 |
| `CONFLICT_GUARD_T2_STRATEGY` | `G1` | `G1` | Agent 每次写入前使用深判检查。 |
| `CONFLICT_GUARD_T3_STRATEGY` | `G1` | `G1` | Agent run 结束时使用深判复检。 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | `deepseek-flash` | Agent 和 DeepSeek 深判使用的模型。 |

### 3.3 G0 到 G4 如何选择

- `G0`：灰区全部给出警告，不调用模型，适合检查阶段三的基线行为。
- `G1`：只使用 DeepSeek 深判，返回决策、证据、中文解释和建议。
- `G2`：只使用 Jev 快判，返回 `allow`、`warn` 或 `lock` 与置信度。
- `G3`：先使用 Jev；置信度低、快判结果为 `lock` 或快判失败时，再使用 DeepSeek。人工验收推荐这个策略。
- `G4`：按时点选择策略。当前人与人场景按配置使用 G3，Agent 的 T2、T3 分别读取 `CONFLICT_GUARD_T2_STRATEGY` 和 `CONFLICT_GUARD_T3_STRATEGY`。

白区和黑区由本地规则直接处理，不调用模型。同一声明中距离较远、公开接口保持不变的修改使用本地灰区警告。其余灰区在模型返回前显示“分析中”，相关文件暂缓写入；模型失败时人与人场景降为警告，Agent 的 T2 采用拒绝处理。

### 3.4 启动服务

配置完成后，在项目根目录执行：

```bash
pnpm dev
```

人工验收时，可以使用 `pnpm dev:stable` 同时启动前后端。服务端只启动一次，修改服务端源文件不会触发重新启动。修改 `.env` 或服务端代码后，需要结束当前命令并重新执行 `pnpm dev:stable`。只启动服务端的命令为 `pnpm --filter @simplercp/server dev:once`。

打开 <http://127.0.0.1:5173>。服务端地址为 <http://127.0.0.1:4000>，健康检查地址为 <http://127.0.0.1:4000/api/health>。

首页点击 **Add directory**，项目名称填写 `conflict-shop`，目录填写：

```text
/Users/baokker/Work/Master/CSCW/智能语义冲突预防-update/SimpleRCPv2/demo/conflict-shop
```

创建项目后，使用不同浏览器，或普通窗口与无痕窗口，打开同一个项目，分别加入为 Alice 和 Bob。在右侧打开“冲突预防”页签。

客户端默认使用 `127.0.0.1:4000` 和 `127.0.0.1:5173`，所以 `pnpm dev` 不需要额外设置 `VITE_*` 变量。需要自定义客户端地址时，在启动命令前设置 `VITE_SIMPLERCP_API_ORIGIN`、`VITE_SIMPLERCP_CLIENT_HOST` 和 `VITE_SIMPLERCP_CLIENT_PORT`。

## 四、阶段二：正在修改和关联关系

每次编辑后停留约 2 秒，让批次关闭和索引更新完成。

1. Alice 打开 `src/pricing.ts`，修改 `applyDiscount` 的计算表达式。
2. 确认两边的“正在修改”区域显示 Alice、文件、行号和符号名称。
3. Bob 打开 `src/checkout.ts`，修改 `checkout` 中的总价计算。
4. 确认“相互关联的修改”出现候选条目，并显示 `checkout`、`Cart.total`、`applyDiscount` 的关系路径。
5. 展开候选条目，确认双方修改前后文本、成员名称和当前状态均可查看。
6. 把 Bob 的修改恢复，再修改 `src/report.ts` 中的标题。确认原候选消失，无关系单元增加。
7. 点击关联条目，确认编辑器打开对应文件并定位到相关行。

## 五、阶段三：本地规则、冻结和撤回

将 `.env` 中的 `CONFLICT_GUARD` 临时改为 `rules`，重启 `pnpm dev`。

### 5.1 黑区和冻结

1. Alice 把 `applyDiscount(price, rate)` 改为增加必填 `currency: string`。
2. Bob 在 `Cart.total` 中继续使用旧的两参数调用。
3. 等待判定后，确认相关区域出现冻结装饰，页签显示黑区、冻结和调用签名不兼容。
4. 在冻结区域输入，确认输入被阻止；在冻结区域外输入，确认仍可编辑。
5. 在共享终端读取 `src/cart.ts`，确认判定完成前磁盘文件仍保持冲突前内容。

### 5.2 灰区、白区和 T0

1. Alice 只修改 `applyDiscount` 的计算方式，保持签名不变；Bob 修改 `checkout` 的计算。确认页签显示灰区警告，文件保持可编辑。
2. Alice 在 `applyDiscount` 中只增加无副作用的日志；Bob 修改有关联的 `checkout` 计算。确认显示白区和放行，文件可以写入。
3. Bob 在 Alice 的签名修改已经判定后开始新的相关批次。确认 Bob 收到 T0 提示，提示中包含 Alice、`applyDiscount` 和接口变化。
4. 重复第 3 项，Bob 在 `Cart.total` 中先增加一个空行，随即修改 `applyDiscount` 的调用参数。确认批次结束前出现一次 T0 提示。单独增加空白或注释时仍然没有提示。

### 5.3 撤回、重开文件和外部修改

1. 重复黑区场景，在卡片中点击“我来改”。确认文件恢复到可撤回的原内容，冻结解除，磁盘内容同步更新。
2. 锁定期间关闭 `cart.ts`，再重新打开。确认未写入的协作修改仍然存在，冻结状态没有因为关闭文件消失。
3. 锁定期间从终端在文件开头、中间和末尾各插入一行。确认共享文本保留双方修改，内容顺序合理，没有把一行插入到错误位置。
4. 查看“冲突预防”页签，确认冻结范围随编辑移动，卡片和状态实时更新。

### 5.4 注释、日志与声明内部修改

每个场景使用新建项目，双方编辑完成后等待约 2 秒。

1. 在 `Cart.total` 中准备 `console.log('aaa');`。Alice 将文字改为 `bbb`，Bob 修改同一函数的金额计算。确认白区放行，双方修改都能保留。
2. Alice 修改 `Cart.total` 的金额计算，Bob 在函数或类体中增加、修改注释。确认 Bob 的注释不出现在符号修改列表中，没有冻结。
3. Bob 在已有注释前面按回车，再输入一行注释；然后单独尝试修改注释文字中间的字符。确认两种操作均不产生新的符号变更或 T0 提示。
4. 双方修改同一函数中相隔超过 3 行的计算语句，保持参数、返回类型和导出状态不变。确认显示“灰区”“警告”“同一声明的不同部分”，编辑保持可用。`full` 模式下该情形也使用本地警告。
5. Alice 修改函数签名，Bob 修改同一声明。确认仍然出现黑区与冻结。
6. Alice 修改一处计算语句，并在同一批次中逐字符输入 `//` 注释。Bob 修改距离计算语句超过 3 行、靠近注释的另一处计算。确认注释不影响行距离判定，结果仍为灰区警告。
7. 双方分别在同一函数相隔超过 3 行的位置新增 `const shared`。确认合并独有的重复变量错误触发黑区冻结。再使用新建项目，在没有返回类型标注的函数中让一方将返回值由数字改为字符串，另一方修改远处计算；确认返回类型变化仍然冻结。
8. 在类属性箭头函数中重复第 7 项的返回值修改。确认数字改为字符串时仍然冻结。
9. Alice 修改代码，同时用 `/* … */` 包围已有说明文字；Bob 修改远处计算。确认注释文字不扩大代码修改范围，双方内容保留，结果仍为灰区警告。
10. Alice 用 `/* … */` 注释整个 `applyDiscount` 声明，Bob 修改仍然调用它的 `Cart.total`。确认删除保护形成黑区，相关文件保持冻结。

### 5.5 卡片、角标与横幅

1. 制造两个独立黑区冲突。确认双方“冲突预防”页签角标显示 `2`，关联修改每项显示身份与符号，以及中文区、动作、规则标签和关系路径。
2. 查看卡片，确认标题、标签、摘要、符号和路径分别显示，双方代码通过“查看双方修改前后代码”展开。较长的解释与建议可以展开或收起。
3. 确认三个操作按“我来改”“双方确认后继续”“去聊天里商量”纵向排列，每项同宽、同高。
4. 点击一次确认，确认按钮显示“已确认”并禁用；双方完成确认后，角标减少。全部冲突处理后，角标消失。
5. 确认编辑器顶部只有一条可折叠横幅，展开可查看当前文件的冲突列表，代码区域保留冻结装饰与悬停提示。
6. 使用“我来改”处理本人仍可撤回的修改，确认文本恢复，页面没有 JSON 解析错误。修改与他人交叠时，确认页面提示协商，并保留当前文本和冲突状态。
7. 查看统计，确认变更对、白区、灰区、黑区分别显示名称与数值；点击“索引与运行统计”，查看文件数量和最近更新时间，再次点击可以收起。
8. 切换浅色与深色主题，确认卡片、状态标签、统计数据和通知随系统主题变化。拖动右侧面板边界，将宽度缩小后，确认文件路径和长文字自动换行，操作按钮保持同宽、同高。
9. 查看意图板与 Agent 检查记录，确认身份与状态分别显示，计划范围和实际范围各占独立区域；实际修改超出计划的符号带有“超出计划”标签。T2 显示为“写入前检查”，T3 显示为“结束后复检”。

## 六、阶段五：灰区模型研判

把 `CONFLICT_GUARD` 改回 `full`，确认 `CONFLICT_GUARD_STRATEGY=G3`、`CONFLICT_GUARD_PROVIDER_MODE=live`，然后重启服务。

1. Alice 修改 `applyDiscount` 的计算逻辑，保留函数签名。
2. Bob 修改 `checkout` 的相关计算。
3. 确认双方相关区域先标为“分析中”，文件写入暂时暂停。
4. 研判完成后，查看页签、通知或卡片中的决策、模型来源、置信度、耗时、中文解释和建议。
5. 返回 `allow` 时确认标记消失且文件可以写入；返回 `warn` 时确认出现通知；返回 `lock` 时确认出现冻结和卡片。
6. 在分析期间继续修改同一相关区域，确认旧请求取消，新的 revision 重新研判。
7. 临时设置 `CONFLICT_GUARD_STRATEGY=G2`，将 `TYPESAFE_API_KEY` 改为无效值，重启并重复灰区场景。确认显示“研判失败，已降级为警告”，文件保持可编辑。完成后恢复密钥与 `G3`，重新启动服务。

页签中的统计应显示模型调用次数、升级比例、失败次数、p50、p95 和费用估算。`DEEPSEEK_MODEL` 应显示为 `deepseek-flash`。

## 七、阶段六：Agent 的 T2 和 T3

### 7.1 通俗解释

T2 是“写入前检查”。Agent 每次准备修改文件时，服务端先看到这次修改的内容，再检查它是否会影响其他人的修改。通过后才允许写入；遇到黑区、冻结区域或模型拒绝时，Agent 收到原因并重新读取文件后再尝试。

T3 是“任务结束检查”。Agent 可能连续工作几分钟，开始任务时依据的函数在这段时间里可能已经被人修改。Agent run 结束后，服务端只检查这些依据已经变化的部分。确认冲突后，仍保持 Agent 原文的修改块恢复为任务开始前的文本；已经被其他人继续修改的交叠块保留当前文本，并通知属主人工处理。

可以把两者理解为：T2 检查“这一次写入能否发生”，T3 检查“整个任务完成后是否仍然符合最新代码”。

### 7.2 Agent 验收

保持 `CONFLICT_GUARD=full`、`SIMPLERCP_FAKE_AGENT_RUNTIME=false`、`DEEPSEEK_MODEL=deepseek-flash`。

1. Alice 给 `applyDiscount` 增加必填 `currency: string` 并等待判定。
2. Bob 让自己的 Agent 在 `Cart` 中增加 `discountedTotal`，先使用旧的两参数调用。
3. 确认 Agent 面板出现一次拒绝，原因包含对方显示名、`applyDiscount`、`signature` 和修改建议。
4. 确认 Alice 没有被冻结，也没有收到需要处理的冲突卡片；页签保留 Agent 关联记录。
5. 确认 Agent 重新读取签名后改用兼容调用，并最终完成任务。
6. 让 Agent 执行较长任务，任务期间由 Alice 修改 Agent 依赖的函数。run 结束后确认 Agent 收到 T3 结果和撤回通知。
7. 查看编辑器，确认未被其他人继续修改的 Agent 块已经恢复；交叠块仍保留并标记为需要人工处理。

### 7.3 observe 模式

把 `CONFLICT_GUARD` 改为 `observe` 并重启服务，重复 T2 场景。确认 Agent 修改直接写入，页签显示 `t2_shadow` 和“若启用将被拒绝”的记录，页面没有真正拒绝 Agent。

## 八、阶段七：意图板和属主仲裁

确认以下配置：

```dotenv
CONFLICT_GUARD=full
CONFLICT_GUARD_ARBITRATION=owner
CONFLICT_GUARD_INTENT_INJECTION=on
SIMPLERCP_FAKE_AGENT_RUNTIME=false
```

1. Alice 和 Bob 各启动一个 Agent，确认页签顶部意图板显示属主、任务摘要、计划范围和实际范围。
2. 让两个 Agent 修改有接口关系的符号，确认双方出现意图差异卡片。卡片应包含任务、符号、关系路径、中文不兼容说明和折中建议。
3. 两位属主都点击“采纳建议”，确认后到 Agent 收到追加指令，挂起的修改得到带建议的回复，后到 Agent 继续执行。
4. 重复冲突，让 Bob 点击“让我的 Agent 让路”。确认 Bob 的 Agent 被取消或撤回冲突修改，Alice 的 Agent 继续执行。
5. 让 Alice 启动两个有依赖关系的 Agent。确认后到 Agent 自动等待和重试，Alice 不收到处理卡片。
6. Alice 在编辑器中修改相关符号，让 Bob 的 Agent 访问该符号。确认 Alice 保持可编辑，Bob 收到轻提示。
7. 查看统计，确认存在打扰次数、轻提示次数、冲突双方类型、卡片处理方式和挂起时长。

## 九、验收记录

每个场景记录以下内容即可：

- 验收日期、浏览器版本、当前提交号。
- `.env` 使用的模式、策略、模型名和是否打开意图注入。
- 两个成员的操作顺序和等待时间。
- 页面截图：冲突预防页签、冻结装饰、模型卡片、Agent 面板、意图板。
- 最终文件内容是否符合预期。
- 发现问题时记录页面提示、项目编号和发生步骤，避免把 API Key 写入截图或日志。

## 十、常见问题

| 现象 | 处理方式 |
|---|---|
| `ENAMETOOLONG` | 进入 `SimpleRCPv2` 根目录后运行 `pnpm dev`，或使用 `pnpm --dir "/.../SimpleRCPv2" dev`。 |
| 页面无法打开 | 检查服务端是否监听 `4000`，再访问 `/api/health`。 |
| 项目无法导入 | 检查 `SIMPLERCP_IMPORT_ROOTS` 是否是包含项目目录的绝对路径。 |
| full 模式没有模型结果 | 检查两枚 API Key、端点、`CONFLICT_GUARD_PROVIDER_MODE=live` 和服务端终端输出。 |
| 模型研判失败 | 查看页签中的 `provider_call` 状态。人与人场景应降为警告；Agent T2 应拒绝并给出原因。 |
| Agent 一直拒绝 | 检查 Agent 面板的最近拒绝原因，确认 Agent 读取了最新文件内容。 |
| 页面显示旧模型名 | 确认 `.env` 中为 `DEEPSEEK_MODEL=deepseek-flash`，停止旧服务后重新执行 `pnpm dev`。 |
| 想离线查看已有结果 | 恢复对应模型缓存，把 `CONFLICT_GUARD_PROVIDER_MODE` 改为 `replay`，再按已有轨迹回放。 |

完成验收后，可以运行以下命令确认密钥没有出现在证据文件中：

```bash
node scripts/verify-evidence-secrets.mjs
```

预期输出：

```json
{"configuredValuesFound":0}
```
