# 过程性知识分支人工验收

适用仓库：`/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2`。适用分支：`feature/process-knowledge`。整理日期：2026-10-08；验收入口与命令适用于当前分支。

## 1. 分支完成内容

本分支覆盖阶段 1–6，以及阶段 7B 的实验工具。系统把协作讨论、代码修改和 Agent 纠正整理为知识建议，由成员确认成卡片；卡片可以附着在代码上，供后续成员和 Agent 查阅、检索与复用。

### 1.1 功能清单

| 编号 | 功能 | 可以看到的结果 |
|---|---|---|
| F01 | 知识卡片 | 六类卡片，创建、编辑、确认、归档、作者、确认人和演化记录 |
| F02 | 知识视图 | 待处理、知识卡片、知识动态；搜索、范围筛选、分页、阅读顺序及卡片历史 |
| F03 | 代码锚点 | 选区 Pin、行号旁标记、hover、点击定位、重新选择锚点 |
| F04 | 协作中的锚点保持 | Yjs 相对位置配合文本、快照与上下文定位；无法可靠定位时请求复核 |
| F05 | 成员协作捕获 | 密集讨论、TODO 清除、新增数字常量、依赖变化、文本恢复和成员之间的覆写 |
| F06 | 捕获后的处理 | 建议进入待处理；接受、AI 草稿、编辑确认、丢弃、合并；共现推断提供候选锚点 |
| F07 | 风险提醒与通知控制 | 修改相关配置文件时提示已有风险知识；冷却、空闲等待和通知数量控制 |
| F08 | Agent 知识注入 | 任务前预览、排除卡片、字符预算、活动文件与词法排序；任务卡片展示参考知识 |
| F09 | Agent 任务后核对 | 对修改文件匹配已知问题与正则检查，展示核对结果 |
| F10 | 会话内传播 | 新卡片提醒相关运行中任务的发起人；记录查看、注入和工具命中的复用时间 |
| F11 | Agent 协作捕获 | 打断、成员改写、追加纠正、重试成功、工具失败后修复五类触发 |
| F12 | Agent 复盘 | 服务端复盘与同一 OpenCode session 的自我复盘；证据引用、具体代码对象和检查方向校验 |
| F13 | 多人治理 | 个人、待团队确认、团队作用域；异议、二次确认、矛盾与替代关系、同源去重、过期复核 |
| F14 | MCP 知识工具 | `knowledge_search`、`knowledge_get`、可选 `knowledge_propose` |
| F15 | 规范文档导入 | 把工作区规范生成带原文行号证据的草稿，逐条编辑或批量确认 |
| F16 | 团队知识导出 | reviewed/team 卡片生成 Markdown，可写入工作区供静态知识条件使用 |
| F17 | 模型与用量 | MiniMax/DeepSeek provider，Agent token 汇总、知识调用记录与注入字符数 |
| F18 | 录制与实验 | 规范化事件录制、相同引擎离线回放；K1/K2/K3/K4/K5/K7、续跑、判定和统计工具 |

界面验收可参照 [知识界面验收记录](ui-review-20261008.md)：卡片用标签显示类型、作用域和状态，用带名称的字段显示作者、确认人和时间；个人与团队任务使用相同的知识列表和任务后核对样式。记录包含浅色和深色主题截图，以及预览重新勾选、卡片链接和代码文件跳转的验证方法。

### 1.2 卡片类型与状态

- `negative`：已经出现过的问题，以及以后应当遵守的规则。
- `constraint`：实现必须满足的约束。
- `decision`：选择及其依据。
- `risk`：可能遇到的风险。
- `context`：理解项目需要的背景。
- `tutorial`：操作方法和经验。

手动创建的卡片直接为 `reviewed`。捕获、导入和 Agent 提议经过草稿与人工确认。`draft`、`needsReview`、`orphaned`、`superseded`、`archived` 的卡片默认不注入；MCP 只返回 `team` 且 `reviewed` 的卡片。

`personal` 卡片供属主使用；申请后为 `proposedTeam`，仍只对属主生效，其他成员可以在“待处理”的“待确认升级”分组审核。默认需要另一名成员确认后变为 `team`。Agent 产生的内容必须由项目成员确认。

## 2. 环境与启动

### 2.1 安装与构建

在终端执行：

```sh
cd "/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2"
git branch --show-current
node --version
pnpm --version
pnpm install
pnpm build
```

分支应为 `feature/process-knowledge`。近期验证使用 Node.js 22.19.0、pnpm 9、OpenCode/SDK 1.18.31。依赖安装包含 OpenCode；workspace 包的入口指向构建产物，因此启动前需要完成 `pnpm build`。

### 2.2 API Key 配置

使用编辑器打开仓库根目录 `.env`。文件不存在时，可以执行：

```sh
test -f .env || cp .env.example .env
```

保留现有 Key，在本机填写以下配置。示例中的占位文字需要替换：

```dotenv
SIMPLERCP_HOST=127.0.0.1
SIMPLERCP_PUBLIC_URL=http://127.0.0.1:5173
SIMPLERCP_TERMINAL_ENABLED=true
KNOWLEDGE=full
KNOWLEDGE_RECORD_EVENTS=true
AGENT_LLM_PROVIDER=minimax
KNOWLEDGE_LLM_PROVIDER=minimax
MINIMAX_API_KEY=填写本机的MiniMax凭据
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M2
AGENT_MINIMAX_MODEL=
SIMPLERCP_OPENCODE_PORT=4096
SIMPLERCP_AGENT_RUN_TIMEOUT_MS=600000
```

`AGENT_MINIMAX_MODEL` 留空时，Agent 使用 `MINIMAX_MODEL`。首页 Agent 设置可以调整模型名，界面不接收 Key。真实 Agent runtime 缺少当前 provider 的 Key 时启动报错。

需要使用 DeepSeek Agent 时，在 `.env` 设置 `AGENT_LLM_PROVIDER=deepseek`，并填写 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL=https://api.deepseek.com/v1`、`DEEPSEEK_MODEL=deepseek-flash`。知识模块的 provider 独立，由 `KNOWLEDGE_LLM_PROVIDER` 控制。修改进程配置后重启服务。

`.env` 由 Git 忽略。验收记录只保存 provider、model 与结果，不复制 Key、`.env` 内容或请求认证头。服务端知识调用使用 OpenAI 兼容客户端；产品入口通过当前 provider 的环境变量把 Agent 凭据提供给本机 OpenCode 子进程。日志与 trace 执行敏感信息清理。

### 2.3 启动人工验收实例

推荐独立数据目录，便于保存验收材料：

```sh
SIMPLERCP_DATA_DIR="$PWD/.simplercp-data/manual-acceptance" KNOWLEDGE=full SIMPLERCP_FAKE_AGENT_RUNTIME=false pnpm dev
```

浏览器打开 `http://127.0.0.1:5173`。HTTP 服务默认使用 4000，OpenCode 使用 4096。上述命令同时启动服务端与客户端，读取仓库 `.env`；命令行环境变量优先。终止实例使用 `Ctrl+C`，重新执行相同命令会继续使用同一份数据。

检查服务：

```sh
curl --fail-with-body http://127.0.0.1:4000/api/health
curl --fail-with-body http://127.0.0.1:4000/api/agent/status
```

`/api/health` 应包含 `features.knowledge=true` 与 `knowledgeMode=full`。进入项目后，Agent 面板应显示模型及 runtime 状态。

首次启动自动建立 Demo 工作区副本。导入现有目录也创建独立副本；后续编辑和 Agent 任务作用于项目的 `workspacePath`。人工验收使用这些副本。

### 2.4 开关含义

| `KNOWLEDGE` | 当前行为 |
|---|---|
| `off` | 隐藏知识界面，知识 REST 返回 404，不注册知识监听与 MCP，不新增知识文件 |
| `capture` | 卡片、捕获、待处理和治理可用，Agent 不注入卡片，不执行知识任务后核对，不注册 MCP |
| `inject` | 卡片与捕获可用，增加 Agent 注入、任务后核对和在途提醒，不注册 MCP |
| `full` | 以上功能及 MCP 可用；具体项目还受运行配置控制 |

验收全部功能使用 `full`。模式修改需要重启；项目配置可以通过 REST 修改并保存。

## 3. 准备成员与项目配置

### 3.1 两名成员

1. 使用普通浏览器窗口打开 Demo，填写 `Display name=Alice`，点击 `Enter project`。
2. 使用另一个浏览器或独立浏览器配置打开同一个项目 URL，创建成员 `Bob`。可使用单独的无痕会话。
3. 确认成员列表同时出现 Alice 与 Bob，双方打开 `src/projectStatus.js`，输入少量文字并检查实时同步。
4. 保留双方窗口，用于私人可见性、跨成员改写、异议和团队确认。

两个普通标签页会共享 localStorage。验收两个身份时使用独立浏览器存储，并确认选中了不同成员。

### 3.2 获取 REST 验收参数

项目 URL 为 `/projects/<projectId>`。Demo 的 `projectId` 为 `demo`。成员进入项目后，可以在该窗口的开发者工具 Console 执行以下读取操作：

```js
sessionStorage.getItem("simplercp.memberId.demo")
```

其他项目把 `demo` 替换为自己的 projectId。终端设置：

```sh
PROJECT_ID='demo'
MEMBER_ID='填写Alice的memberId'
API_ORIGIN='http://127.0.0.1:4000'
curl --fail-with-body -H "X-SimpleRCP-Member: $MEMBER_ID" "$API_ORIGIN/api/projects/$PROJECT_ID"
curl --fail-with-body -H "X-SimpleRCP-Member: $MEMBER_ID" "$API_ORIGIN/api/projects/$PROJECT_ID/knowledge/config"
```

项目响应包含 `workspacePath` 与 `metadataPath`。以下路径与命令都使用该响应里的实际值。

### 3.3 项目默认配置

| 字段 | 默认值 | 验收用途 |
|---|---|---|
| `injectEnabled` | `true` | 开启任务开始时的卡片注入 |
| `topK` | `5` | 最多选择五张卡片，最终数量还受预算影响 |
| `maxCharsPerCard` / `maxTotalChars` | `800` / `4000` | 单张内容与完整知识段的字符预算 |
| `ranking` / `lexicalScoring` | `bounded` / `legacy` | 排序与词法打分分别配置 |
| `useActiveFiles` | `true` | 结合任务上下文、提示中的文件与成员当前文件 |
| `statuses` | `["reviewed"]` | 正式使用保持此状态门控 |
| `fixedCardIds` | `[]` | 非空时仅使用指定卡片，供控制实验使用 |
| `postRunCheck` / `inflightNotify` | `true` / `true` | 任务后核对与运行期间知识提醒 |
| `requireSecondConfirmForTeam` | `true` | 升级团队卡片需要另一名成员确认 |
| `recapMode` / `recapLanguage` | `server` / `zh` | 服务端复盘，中文自然语言字段 |
| `toolEnabled` / `proposeEnabled` | `true` / `false` | MCP 查询开启，Agent 提议默认关闭 |
| `toolInstructionPlacement` | `prompt` | 工具说明放在范围声明之后，可改为 `system` |
| `orphanedAfterMs` | `604800000` | 无法定位且七天未复核时标记 `orphaned` |
| `riskWarning` | 文件模式、阈值、冷却等 | 默认包含 package.json 等配置文件，冷却五分钟 |

更新示例，未提供的字段保持当前值：

```sh
curl --fail-with-body -X PUT -H "X-SimpleRCP-Member: $MEMBER_ID" -H 'Content-Type: application/json' --data '{"injectEnabled":true,"toolEnabled":true,"proposeEnabled":false,"recapMode":"server","recapLanguage":"zh","fixedCardIds":[]}' "$API_ORIGIN/api/projects/$PROJECT_ID/knowledge/config"
```

## 4. 卡片与代码锚点验收

### A01：生成示例与查看卡片

1. 打开知识页签，在“更多”中点击“生成示例卡片”。
2. 查看“知识卡片”：应出现六类示例卡片，关联 Demo 中的文件；搜索标题、摘要、正文或标签，检查本文件与全部范围。在“筛选”中检查类型多选、作用域、状态和作者，再检查每页十条的分页。
3. 展开卡片，检查正文、作者、确认人、作用域、状态与锚点；点击文件链接定位代码。
4. 在“知识卡片”选择“阅读顺序”，检查当前文件和教程、决策、约束排序；展开详情的历史查看单张卡片记录。“知识动态”显示项目的捕获、确认、应用和演化，可按类别筛选。
5. 编辑一张自己可以管理的卡片，保存后刷新页面，检查修改仍然存在。归档一张测试卡片，检查其状态和演化记录。

预期：卡片按项目保存，刷新后可读取；写操作出现在项目活动记录中。

### A02：选区 Pin、hover 与边界插入

1. Alice 在 `src/projectStatus.js` 选择 `createProjectStatus` 函数内容。
2. 通过编辑器右键菜单选择“Pin 为知识卡片”，检查编辑器立即可见、标题输入框获得焦点，并显示所选文件和行号；默认范围为“这段代码”，填写类型、标题和内容，选择团队或个人后保存。摘要和标签在“更多字段”中，摘要留空使用内容第一句。编辑器正文区可以独立滚动。
3. 检查选中代码的行号旁标记，hover 应显示标题、摘要、作者与打开卡片入口。
4. Bob 在该范围之前插入一个完整的注释行。卡片应继续指向原函数。
5. Bob 在范围结束位置的右侧插入独立注释，检查新文本没有进入卡片范围；在起点左侧插入注释也检查范围。
6. 删除大部分关联代码，等待检查点约 30 秒。详情应显示待复核原因、原代码和操作按钮；点击“重新关联”，选择新的代码范围，点击“确认关联”。分别检查“仍然有效”“改为关联整个文件”和附理由归档。

预期：起点采用 `assoc=0`，终点采用 `assoc=-1`；相邻插入保持范围，内容大量变化时呈现 `needsReview`。重新锚定后恢复可用状态。移动、删除重建及多人交错编辑的处理说明见 [anchoring.md](anchoring.md)。

### A03：个人卡片与团队升级

1. Alice 新建个人卡片。Alice 能读取，Bob 的普通列表和 Agent 预览不能读取。
2. Alice 展开卡片，点击“申请团队确认”。
3. Bob 打开“待处理”，在“待确认升级”分组阅读后点击“确认升级为团队卡片”。也可以选择“暂不确认”，并通过“显示暂不确认的申请”重新查看；申请仍然保留。
4. 双方检查卡片为 `team`，确认人与 `scopeChanged` 演化记录完整。

预期：申请期间只对属主生效；默认由非属主完成团队确认。手动新建团队卡片属于人工直接确认流程。

### A04：明确适用范围与 AI 整理

1. 在“待处理”点击“新建”，填写标题和内容，保留“整个项目或一类文件”，保存后检查自动显示知识卡片。没有打开文件时，也能看到刚创建的卡片。
2. 新建“README，请全部使用英文”，适用范围选择“整个文件”，文件路径填写 `README.md`。创建后立即向 Agent 下达“完善一下这个项目的README”，检查预览与任务的“参考的知识”均包含这张卡片。
3. 改写 README，检查文件规则保持有效。另建一张关联具体选区的卡片，大幅修改选区，检查这张卡片进入待复核；任务预览显示未提供给 Agent 的数量与复核入口。
4. 新建卡片，在“知识描述”填写一句项目约定，点击“AI 整理”。检查加载提示、整理后的类型、标题、内容和范围，核对后保存，展开来源查看“经 AI 整理”。调用记录应包含 `mode: "manual-assist"`。

预期：代码选区、整份文件、项目或路径模式的范围含义明确。AI 整理的内容由成员核对后保存。

## 5. 成员协作捕获验收

触发阈值使用产品默认配置。通知受冷却、活动强度与每小时数量限制；出现建议时检查待处理与未读数量。

需要逐项检查独立建议时，使用不同测试文件或独立项目副本。相同 run、聊天消息等来源会合并，已经处理的来源不一定生成另一条独立建议。

### B01：成员覆写与草稿确认

1. 通过文件树新建 `src/acceptanceNotes.js`，双方打开。
2. Alice 写入至少五行有意义的代码或注释。
3. 十分钟以内，Bob 一次选择并替换 Alice 刚写的全部内容，保持替换范围覆盖超过三行。
4. 双方检查知识页签未读数量及待处理中的“成员改写了协作内容”建议（`edit.overwritten`）。
5. 打开证据，检查编辑成员、被改写成员、文件、前后内容与候选锚点。
6. 点击“AI 草稿”，检查草稿内容；修改标题、摘要、正文和锚点后点击“确认并保存”。

预期：建议参与成员包含 Alice 与 Bob；处理后成为人工确认卡片。只点击“接受”会生成确定性草稿，仍需人工确认。

### B02：密集讨论与手动选取聊天

1. 双方在五分钟内围绕 `src/projectStatus.js` 发送至少十一条成员消息，说明问题、原因与处理办法，同时保持该文件的编辑活动。
2. 等待讨论后的采集窗口，检查 `chat.dense` 与候选锚点；默认后续证据窗口为一分钟。
3. 在聊天工具栏点击“从中创建知识”，选择几条消息，点击“从这些消息创建”，检查建议证据包含所选消息。点击“取消”或创建完成后，消息复选框隐藏。

预期：自动建议保留讨论证据，共现推断给出文件与行段候选；成员可以选择适合的锚点并确认。

### B03：代码与依赖触发

| 操作 | 等待与预期 |
|---|---|
| 在专用测试文件添加 TODO，等待约 30 秒形成检查点，再清除全部 TODO | 再次空闲约 30 秒，产生 `todo.cleared` |
| 添加新的三位及以上数字常量，例如 `const retryDelay = 1500` | 空闲约 30 秒，检查 `magicNumber.added` |
| 修改 package.json 的 dependencies 或 devDependencies，保存合法 JSON | 检查 `dependency.changed`；也可从共享终端用编辑器修改文件 |
| 五分钟内删除超过 500 个字符或超过 20 行，并通过文件编辑恢复原内容 | 检查 `rollback.detected` |

上述操作使用工作区副本，完成后用编辑器恢复测试内容。诊断修复判定保留在知识包中；当前产品验收不要求通过编辑器诊断消息触发它。

### B04：风险提醒

1. 建立一张 `risk` 团队卡片，标题和摘要明确包含 `package.json`、`dependencies`、依赖版本等词语，锚定 package.json。
2. 保存后修改 package.json 的一个依赖版本，保持合法 JSON。Demo 没有依赖时，在 dependencies 中添加一项测试依赖；本项无需执行安装。
3. 保持空闲约 30 秒，检查待处理中的风险提醒、关联卡片和通知；读取后未读数量应更新。

预期：提醒引用已有风险卡片；相同风险不会在默认五分钟冷却内持续提示。模型草稿、风险提醒与成员操作的结果分别保存。

## 6. Agent 注入、核对与传播验收

真实 Agent 请求会产生模型费用。每次保留任务文本、run id、最终代码、测试输出和 trace；行为结果按实际输出记录。

### C01：预览、排除与个人可见性

1. Alice 建立并确认一张 `constraint` 卡片：标题“createProjectStatus 的空数组行为”，摘要和正文写明“修改 src/projectStatus.js 的 createProjectStatus 时，空数组必须返回 taskCount=0、completedCount=0、nextTask=All tasks complete”。锚定对应函数。
2. 在个人 Agent 创建会话，添加 `src/projectStatus.js` 为上下文，输入任务：“为 src/projectStatus.js 的 createProjectStatus 增加空数组测试，保持现有返回格式，运行 npm test。”
3. 检查“将参考的知识”出现该卡片。取消勾选后提交任务。
4. 展开 run 卡片的 trace，检查 `knowledge_injected.excludedByUser` 包含该 id，`cards` 不包含它。
5. 再提交同样任务，勾选卡片；检查“本次参考的知识”可以打开卡片，trace 保存卡片版本、分数与字符数。
6. 把另一张约束设为 Alice 的个人卡片，用 Alice 与 Bob 的个人 Agent 分别预览。该个人卡片只供 Alice 使用。
7. 创建团队 Agent，在聊天通过 `@名称` 提交相关任务，检查聊天任务卡片展示参考知识，run 发起人为发送消息的成员。

预期：预览与运行使用相同选择流程；查询、活动文件、状态、排除、同源去重和字符预算在 trace 中可检查。没有候选时界面不显示预览列表。

### C02：可执行检查

检查字段目前通过 REST 设置。使用 C01 的卡片，填写其 id：

```sh
CARD_ID='填写约束卡片id'
curl --fail-with-body -X PATCH -H "X-SimpleRCP-Member: $MEMBER_ID" -H 'Content-Type: application/json' --data '{"check":{"kind":"regex-present","pattern":"All tasks complete","fileGlob":"src/projectStatus.js"}}' "$API_ORIGIN/api/projects/$PROJECT_ID/knowledge/cards/$CARD_ID"
```

1. 让 Agent 修改该文件并保留 `All tasks complete`，运行结束后检查 `knowledge_post_check` 的命中和 `passed=true`。
2. 暂时关闭 `injectEnabled`，让 Agent 把该字符串改成 `No pending tasks`。检查任务后核对是否出现 `passed=false` 与界面红色提示。
3. 使用编辑器恢复字符串，恢复 `injectEnabled=true`。

`regex-present` 要求存在匹配，`regex-absent` 要求没有匹配。任务后核对只提示。约束卡片与检查不会阻止 Agent 修改文件；即使任务失败或取消，也检查已经产生的文件修改。

### C03：在途提醒与复用时间

1. Bob 提交一个需要修改 `src/projectStatus.js` 并运行测试的任务，确认任务处于运行状态。
2. 任务仍运行时，Alice 创建或确认一张与该文件有关的团队卡片。
3. Bob 检查 run 的新知识提示及 `knowledge_update_available` trace。团队 Agent 的相关任务还应收到系统聊天提示。
4. Bob 打开卡片详情，并在下一次任务中参考这张卡片。
5. 读取指标：

```sh
curl --fail-with-body -H "X-SimpleRCP-Member: $MEMBER_ID" "$API_ORIGIN/api/projects/$PROJECT_ID/knowledge/metrics/reuse"
```

预期：已发生的行为对应 `confirmedAt`、`firstViewedByOtherAt`、`firstInjectedByOtherAt`；捕获来源的卡片还包含 `knowledgeAt`，其他成员工具命中时有 `firstToolHitByOtherAt`。没有发生的时间点可以为空。在途提醒不向正在执行的 `session.prompt` 插入新卡片。

## 7. Agent 捕获、复盘与治理验收

### D01：跨成员改写 Agent 内容

1. Alice 用个人 Agent 要求：“在 src/projectStatus.js 增加 countCompletedTasks helper，至少四行实现，并让 createProjectStatus 使用它；运行 npm test。”
2. 等待 run 完全结束，记录新增代码和 run id。
3. 十五分钟内，Bob 从协作编辑器删除 Agent 新增 helper，并恢复原来的 `tasks.filter(...)` 写法，修改超过本次 Agent 新增行数的 30%。
4. 双方检查 `agent.revised` 建议。证据应包含原任务、Agent 修改、Bob 修改，以及两个成员。
5. Alice 填写异议理由，点击“我有不同意见”。双方查看建议状态 `disputed` 和意见。
6. Bob 接受该建议为个人草稿，检查意见、适用范围与规则，确认保存。

预期：Agent 归属由 run 前后快照的 diff 提取新增区间，在 run 结束后登记为 `agent:<runId>`。运行期间文件系统更新仍使用 `filesystem`。跨成员建议提醒改写者及原 run 发起人；异议内容在确认界面可见。

### D02：追加纠正与两种复盘

1. 在新会话中让 Agent 完成一次 `src/projectStatus.js` 的修改，例如增加 completedCount 的输入检查。十分钟内，在这个会话提交：“不要在 createProjectStatus 中重复计算 completedCount，改用 countCompletedTasks helper，修改 src/projectStatus.js 并运行 npm test。”
2. 检查 `agent.corrected`。打开建议，使用“AI 草稿”生成服务端复盘。
3. 阅读“发生了什么、纠正、规则、适用范围、不适用的情况”。规则应覆盖证据中的具体函数或字段，引用能指向证据；人工判断范围是否合适。
4. 用项目配置设置 `recapMode=agent-self`，在另一条尚未处理的纠正建议上生成 AI 草稿。
5. 检查该 run 的 `knowledge_recap_self` 和 `llm-calls.jsonl`：追加请求使用原 OpenCode session，不增加用户任务，也不在 Agent 面板新增 run。
6. 恢复 `recapMode=server`。

预期：两种模式采用相同 JSON 与引用校验。服务端复盘解析失败的草稿显示“模型未能生成规则，请人工填写”，规则内容为空，确认前必须填写；自我复盘输出无效时报告失败。

模型生成 `checkSuggestion` 时，系统使用 Agent 版本和成员纠正后的完整文件验证检查。只有能够判定前者违反、后者通过的检查会保存。检查被移除时，草稿应提示“自动检查未通过验证，已移除”。

### D03：其余 Agent 触发

| 触发 | 人工操作 | 预期 |
|---|---|---|
| `agent.interrupted` | 团队 Agent 运行时，由另一名成员再次 @ 同一 Agent 给出新指令 | 建议含原 run、打断关系和新指令 |
| `agent.interrupted` | 取消个人任务，三分钟内同一成员在同一会话提交新任务 | 建议含取消任务及新任务 |
| `agent.retried` | 任务失败或取消后，三十分钟内同一成员提交相似任务并成功 | 建议保留失败与成功证据 |
| `agent.toolRecovered` | 让 Agent 在测试失败后修改代码，再执行相同测试命令并成功 | 建议含失败命令、错误摘要、中间修改与成功命令 |

工具恢复排除网络错误。真实模型是否采取这些操作取决于任务执行，检查 trace 后判断是否满足触发条件。自动化用例覆盖各类正例与反例。

### D04：团队确认、知识关系与过期

1. 对一张已确认个人卡片完成 A03 的团队升级；检查 `provenance`、`review`、`scope` 与后续另一成员 run 的注入记录。
2. 创建两张团队卡片，展开其中一张，选择“知识关系”与“关系目标”，建立 `contradicts`。
3. 提交能同时检索到两张卡片的任务，检查知识段保留双方并标明尚未裁决。
4. 建立 `supersedes`，检查目标状态为 `superseded`，后续默认注入排除该卡片。
5. 修改一张 reviewed 卡片所锚定的大部分代码，等待检查点；检查 `needsReview`、属主或确认人的提示以及后续注入排除。
6. 重新选择锚点并完成复核，检查回到 `reviewed`。

同一来源的建议合并或记为复现，注入时同一来源只保留最高分卡片。关系由成员选择。当前配置没有模型纠正分类或模型矛盾判定选项。

## 8. MCP 与规范文件验收

### E01：Agent 主动查询工具

1. 保持 `KNOWLEDGE=full`，项目设为 `injectEnabled=false`、`toolEnabled=true`。
2. 确认 C01 的约束为 `team/reviewed`；另准备 Alice 的 personal 卡片，供返回范围检查。
3. 提交任务：“请先调用 knowledge_search 查询 createProjectStatus 的项目约定，再用 knowledge_get 阅读相关卡片，然后为 src/projectStatus.js 增加测试。workspace 使用提示词范围声明中的绝对路径。执行 npm test。”
4. 检查 OpenCode trace 中工具调用，以及 `knowledge_tool_call`。实际 OpenCode 名称带 MCP 前缀，例如 `knowledge_knowledge_search`。
5. 检查 `knowledge/tool-calls.jsonl` 的 query、files、resultIds、latencyMs 和 run 关联，确认返回的是团队已确认卡片。
6. 提交一条没有明确要求查询的同类任务，单独记录是否产生查询。

预期：Streamable HTTP 服务位于 `/mcp/knowledge`，监听本机并校验随机令牌。缺少认证的直接访问返回拒绝：

```sh
curl -i -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$API_ORIGIN/mcp/knowledge"
```

工具说明在 `toolEnabled=true` 时独立于卡片注入出现。当前项目同一时刻只有一个运行中的 run 时可以直接关联；多个候选记录为 `ambiguous`。MCP 客户端认证、错误 workspace 和卡片可见性由集成测试覆盖。

### E02：提议与工具开关

1. 保持默认 `proposeEnabled=false`，要求 Agent 调用 `knowledge_propose`，检查调用报告该项目未开启提议。
2. 设置 `proposeEnabled=true`，要求 Agent 提议一条任务中发现的项目规则，检查待处理中的“Agent 提议的知识”（`agent.proposed`）、`origin=agent-self` 和 Agent 作者。
3. 成员接受、审核并确认，检查确认人为项目成员。
4. 设置 `toolEnabled=false` 后再次查询，检查返回空结果并记录调用。
5. 恢复 `injectEnabled=true`、`toolEnabled=true`、`proposeEnabled=false`。

全局 MCP 配置保持工具注册；项目开关在服务端处理调用时生效。提议要求能够唯一确定对应 run。

### E03：规范文档导入

1. 在工作区副本新建 `CONTRIBUTING.md`，使用 Markdown 标题与列表写两条明确规范，例如空数组行为和提交前运行 npm test。
2. 知识页签点击“导入规范文档”，输入 `CONTRIBUTING.md`，点击“生成导入草稿”。
3. 逐条检查原文、行号范围、类型、摘要、正文和适用范围；修改需要调整的条目，丢弃不需要的条目。
4. 勾选需要的条目，点击“确认选中的草稿”。
5. 检查待处理和最终卡片，来源为 `preset`，原文证据与人工确认信息完整。

留空路径会查找 AGENTS.md、CLAUDE.md、CONTRIBUTING.md、README.md 与 `.cursor/rules/` 中的直接文件。模型可用时使用知识模块配置的 provider；模型不可用时采用 Markdown 标题和列表的确定性分段。模型结果仍需逐条核对。

### E04：导出与 OpenCode 读取

1. 点击“导出团队 AGENTS.md”，检查界面提示的文件路径。
2. 打开生成文件，检查按类型组织，仅含 `team/reviewed` 卡片，包含规则或摘要及适用文件。
3. 工作区原来没有 AGENTS.md 时生成 AGENTS.md；已有时生成 AGENTS.knowledge.md。
4. 可使用 REST 下载 Markdown：

```sh
curl --fail-with-body -H "X-SimpleRCP-Member: $MEMBER_ID" "$API_ORIGIN/api/projects/$PROJECT_ID/knowledge/export?format=agents-md"
```

OpenCode 会读取工作区 AGENTS.md。AGENTS.knowledge.md 默认不会自动读取，需要人工将内容加入 AGENTS.md，或者设置 OpenCode `instructions`。在新任务开始前检查文件名与内容。

导出文件再次导入的确定性分段往返由测试覆盖。静态文件生成后不会随卡片变化自动更新，需要重新导出。

## 9. 记录与效果核查

### 9.1 保存位置

从项目 REST 响应读取 `metadataPath`。默认独立验收实例的 Demo 元数据为 `.simplercp-data/manual-acceptance/projects/demo`，工作区为 `.simplercp-data/manual-acceptance/workspaces/demo`。

| 位置，相对于 metadataPath | 内容 |
|---|---|
| `knowledge/cards/<id>.json` | 卡片、锚点、作者、确认、关系、演化与 usage |
| `knowledge/inbox/<id>.json` | 建议、证据、参与成员、异议及处理状态 |
| `knowledge/config.json` | 项目运行配置 |
| `knowledge/events.jsonl` | 规范化协作事件，供离线回放 |
| `knowledge/capture-config.json` | 录制使用的捕获参数 |
| `knowledge/llm-calls.jsonl` | provider/model、模式、耗时、token、尝试、兜底和检查验证 |
| `knowledge/tool-calls.jsonl` | MCP 查询、结果与运行任务关联 |
| `knowledge/reuse-metrics.json` | 查看、注入与工具命中时间点 |
| `agent-runs/<runId>/run.json` | run 状态、模型、修改文件与 usage |
| `agent-runs/<runId>/trace.jsonl` | 运行过程、知识注入、核对、工具与用量事件 |
| `activity.json` | 项目活动、知识处理与复用记录 |

run trace 也可在 Agent 面板加载或下载。关键事件：`knowledge_injected`、`knowledge_post_check`、`knowledge_update_available`、`knowledge_tool_call`、`knowledge_recap_self`、`usage_summary`。

`knowledge_injected` 保留完整脱敏查询、活动文件、ranking、lexicalScoring、topK、前二十个候选及过滤原因、最终卡片、字符数和 `estimatedInjectionTokens`。注入 token 估算为 `Math.ceil(totalChars / 4)`；Agent 总用量来自 assistant 消息汇总。MiniMax 估算费用带估算来源；DeepSeek SDK 的零 cost 不用于费用比较。

### 9.2 离线回放

```sh
METADATA_ROOT="$PWD/.simplercp-data/manual-acceptance/projects/demo"
mkdir -p artifacts/manual-acceptance
pnpm --filter @simplercp/knowledge replay "$METADATA_ROOT/knowledge/events.jsonl" > artifacts/manual-acceptance/replayed-suggestions.jsonl
```

回放自动读取事件文件旁的 capture-config.json，使用与线上相同的引擎和 VirtualCaptureClock；输出建议 JSONL，并在终端错误输出显示触发数量。引擎输出与产品保存建议的数量可能因服务端同源合并而不同，比较规则见 [capture.md](capture.md) 和 [实验工具说明](../../experiments/knowledge/README.md)。

人工记录建议保存到 `artifacts/manual-acceptance/`：操作编号、成员、时间、card/run/suggestion id、任务原文、观察、测试输出与人工截图。截图可以由验收者保存，认证信息不进入记录。

## 10. 自动化检查与实验工具

### 10.1 产品检查

在仓库根目录执行：

```sh
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:knowledge
pnpm --filter @simplercp/experiments build
pnpm --filter @simplercp/experiments test
```

需要单独检查实时协作时执行 `pnpm test:collab`。Playwright 使用独立测试数据、HTTP 4100 和客户端 5174，自动启动测试服务。Agent 自动化使用仓库测试 runtime，人工模型效果以真实实例的任务记录为准。

最近一次完整验证记录位于 [stage-7b.md](stage-7b.md)：server 137、knowledge 156、Demo 2 项通过；普通 e2e 21 项通过、15 项按配置跳过；knowledge e2e 13 项通过；实验工具 15 项通过。这些为既有验证记录，本文件的编写核查不代表再次执行真实模型实验。

### 10.2 确定性基准

```sh
pnpm --filter @simplercp/knowledge bench:deterministic
pnpm --filter @simplercp/knowledge bench:anchor
```

旧实验对应指标与冻结语料说明见 [v0-parity.md](v0-parity.md)。这组基准与 K7 的多人协作评价分别报告。

### 10.3 阶段 7B 工具

| 工具 | 检查内容 |
|---|---|
| K1 | 触发精确率、召回率、共现锚点、线上录制与回放 |
| K2 | 普通草稿、服务端复盘、自我复盘的结构、引用、指定对象与人工评分 |
| K3 | 不同知识条件下的任务完成、约束遵守、token、耗时和注入记录 |
| K4 | 纠正、确认与其他成员 Agent 的迁移链路，含 delayed 与 same-session |
| K5 | 检索排名、错误活动文件、线上最终注入重放 |
| K7 | 五种锚点策略，精确范围与边界容忍两种指标 |

验证数据与执行离线锚点评价：

```sh
pnpm --filter @simplercp/experiments experiment verify
pnpm --filter @simplercp/experiments experiment k7 --out experiments/knowledge/runs/manual-acceptance-k7
```

工具校验冻结数据 manifest。已有独立冻结副本时可设置 `KNOWLEDGE_BENCH_ROOT=experiments/knowledge/.work/frozen-bench`。校验失败时核实数据来源和版本，保留原数据。K7 不调用模型。

在线试跑需要单独实例，保持人工实例的数据目录独立：

```sh
SIMPLERCP_KNOWLEDGE_EXPERIMENTS=true EXPERIMENT_SPEED=1 pnpm --filter @simplercp/experiments run server
```

该入口默认 HTTP 4179、OpenCode 4181；数据在 `experiments/knowledge/.work/server/data`。另一个终端执行小规模任务：

```sh
pnpm --filter @simplercp/experiments experiment k3 --config experiments/knowledge/pilot.json --pilot --out experiments/knowledge/runs/manual-acceptance-k3
pnpm --filter @simplercp/experiments experiment k5 --source experiments/knowledge/runs/manual-acceptance-k3 --out experiments/knowledge/runs/manual-acceptance-k5
```

K3 会调用真实模型。每次使用新的输出目录保存独立验收；继续同一次执行时保持命令、代码、配置和数据版本一致，工具会跳过完成组合。K4 的 episode 接口记录 `captureBypassed=true`，用于测量确认后的迁移；`naturallyTriggered` 单独记录产品触发观察。

正式 K3 使用具体条件名：`C0,C1,C2,C5,C6-stale,C6-contradiction,C7`。完整命令、评分表与统计说明见 [实验工具 README](../../experiments/knowledge/README.md)。

## 11. 验收时需要记录的限制

- 阶段 8 的完整实验尚未执行，试跑结果不能直接作为论文最终结论。
- 当前同一项目的 Agent run 排队执行，允许任务在运行时被打断。
- 近期 C3 在 prompt 与 system 两种工具说明位置的八次试跑均无查询；阶段 8 当前建议移除 C3/C4，R4 标记为没有实际查询。显式查询仍可用于人工工具验收。
- C2 的五组线上与离线最终卡片、字符数一致；四项陷阱目标卡片命中为 2/4。检索效果仍需正式数据评价。
- K7 精确存活率为 yjs-relative 79.42%、yjs-multi 83.42%；移动、删除重建与内容大量变化仍可能需要复核。
- 最近九次服务端复盘有八份结构合法、六份覆盖指定标识符，检查保留率为 4/8。语义、对象和适用范围需要人工审核。
- MCP 使用进程级配置，工具必须传绝对 workspace；多候选 run 的关联有歧义。随机 MCP 令牌存在于 OpenCode 配置中。
- `KnowledgeEventSink` 只提供终端审批和冲突事件接口，本分支没有连接点一、点二的事件来源。
- Agent 知识核对与提醒只提示；卡片不会阻止任何成员或 Agent 的操作。
- 当前阶段没有新增向量检索实验服务；模型纠正分类与模型矛盾判定尚未实现。

## 12. 人工验收记录表

每项填写“通过 / 未通过 / 未执行”，并记录对应 id 或证据文件。

| 项目 | 结果 | 证据或备注 |
|---|---|---|
| 启动、health、模型 provider 与配置 | | |
| A01 卡片、视图与持久保存 | | |
| A02 Pin、hover、边界插入与重新锚定 | | |
| A03 个人可见性与二次确认 | | |
| B01 双成员覆写、草稿与确认 | | |
| B02 自动讨论捕获与聊天选择 | | |
| B03 TODO、数字、依赖、文本恢复 | | |
| B04 风险提醒 | | |
| C01 预览、排除、个人与团队注入 | | |
| C02 任务后检查的通过与违反 | | |
| C03 在途提醒与复用时间 | | |
| D01 跨成员 Agent 改写与异议 | | |
| D02 服务端与 Agent 自我复盘 | | |
| D03 打断、重试、工具恢复 | | |
| D04 迁移、知识关系与过期复核 | | |
| E01 MCP 查询与认证 | | |
| E02 Agent 提议与项目开关 | | |
| E03 导入、修改、丢弃与批量确认 | | |
| E04 导出与静态文件读取 | | |
| 事件录制、回放与用量记录 | | |
| 产品检查、实验工具与选定基准 | | |

相关说明：[API](api.md)、[捕获](capture.md)、[Agent 注入](agent-injection.md)、[Agent 捕获](agent-capture.md)、[治理](governance.md)、[MCP](mcp.md)、[Agent 模型](agent-model.md)、[阶段 7B 报告](stage-7b.md)。
