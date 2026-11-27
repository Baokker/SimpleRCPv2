# 团队过程性知识

## 决策

### Trace 分页按 sequence 排序

分页结果按照 sequence 递增输出

> 分页结果按照 sequence 递增输出。游标只表示最后一条记录。它不改变 payload。

适用范围：`src/extracted/agent/traceStore.ts`

### 聊天消息 sequence 单调递增

新消息的 sequence 使用历史最后值加一

> 新消息的 sequence 使用历史最后值加一。读取历史时保留原序号。这个规则适用于写入。

适用范围：`src/extracted/chat.ts`

### 成员导出保留名称与角色

成员记录包含 memberId、displayName 和 role

> 成员记录包含 memberId、displayName 和 role。名单导出保留这三个字段，名称中的逗号与引号交给 CSV 格式库处理。这条记录适用于 CSV 内容。

适用范围：`src/extracted/auth/identity.ts`

### 事件日志按追加顺序保存

事件写入文件时保持追加顺序

> 事件写入文件时保持追加顺序。读取接口返回同一顺序。它适用于持久事件。

适用范围：`src/extracted/eventLog.ts`

### run 路由先取得成员身份

run 读取路由取得 request.identity 后调用权限入口

> run 读取路由取得 request.identity 后调用权限入口。缺少身份时 requireIdentity 返回 401。这个顺序适用于 run 和项目路由。

适用范围：`src/extracted/auth/permissions.ts`

### 按数组次序持久化消息

ChatFile 中的 messages 必须保持业务写入顺序，避免读取后顺序漂移。

> saveMessages 写出的 ChatFile.messages 应沿用 createChatStore 维护的消息数组次序，loadMessages 也应按该次序还原 ChatMessage。原因是该文件同时承担版本化和历史内容存储，乱序会让会话上下文与业务记录不一致。此规则适用于消息创建、更新、删除后的文件写入，以及启动时的历史加载。

适用范围：`src/extracted/chat.ts`

### 房间事件使用提交后快照

房间事件须在状态变更成功后生成，并携带最终成员与连接信息。

> createRoomStore 追加 room_created、member_joined、member_rejoined 或 member_removed 事件时，应先完成 RoomState 更新，再从最终状态生成 payload，避免日志与 getRoom 结果分叉。适用于 createRoom、joinRoom 及成员上下线处理。

适用范围：`src/extracted/rooms.ts`

### 工作区目录采用缺省路径

未指定 workspacesDir 时，工作区统一落在 dataDir 下的 workspaces。

> createProjectRegistry 在 workspacesDir 缺省时使用 path.join(dataDir, "workspaces")，并把该路径传给 createDemoProject、migrateLegacyProjects 与项目初始化流程。统一根目录可避免同一实例产生分裂的工作区集合，适用范围是创建项目注册表及未显式提供工作区根目录的场景。

适用范围：`src/extracted/projects.ts`

### 大文件阈值统一按字节判断

工作区文件大小判断统一使用 LARGE_FILE_BYTES。

> workspace.ts 对文件大小的分类应统一采用 LARGE_FILE_BYTES 的字节阈值，不得分别按字符数或不同常量估算。这样可保证 writeWorkspaceFile、readWorkspaceFile 与 createWorkspaceFile 对同一文件作出一致判断；该决策适用于工作区文件读写路径及大文件策略，不用于 Agent 运行记录。

适用范围：`src/extracted/workspace.ts`

### 二进制扩展名采用默认集合

BINARY_EXTENSIONS 定义默认二进制扩展名集合。

> BINARY_EXTENSIONS 作为识别二进制文件的默认扩展名集合，包含 .class、.dll、.exe、.png、.pdf、.zip 等类型。新增格式时应显式更新该集合，使 listWorkspaceDirectory 与 readWorkspaceFile 对文件类别的判断保持一致；扩展名映射规则适用于工作区文件分类。

适用范围：`src/extracted/workspace.ts`

### 运行记录采用稳定字段约定

run.json 固定使用 run 包装与 AgentRun 核心字段命名。

> AgentRun 持久化到 run.json，createRecordStore 通过 recordKey: "run" 定位，create 固定生成公共标识 id 和时间 createdAt。统一 JSON 命名风格可稳定支持按 id、createdAt 查询。修改字段名或包装键时，须同步调整 createRecordStore 配置、迁移脚本和所有读取端，不能仅改 TypeScript 属性名。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 超时后先完成取消

runWithTimeout 以 Promise.race 限制等待，并等待取消流程结束。

> runWithTimeout 用 Promise.race 竞争 operation 与 timeout；定时器触发后调用 cancel，并抛出包含 timeoutMs 的 Error。捕获异常时若 cancellation 已创建，会 await 它完成后再继续抛出，finally 中则 clearTimeout 清理 timer。该决策适用于需要释放 Agent 执行资源的排队场景；若取消动作失败，调用方仍会收到原异常，因此取消实现本身不能永久阻塞。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 会话记录校验失败即抛错

session.json 落盘前由 validateRecord 校验，非法文件报 Invalid、缺失报 missingMessage。

> createAgentSessionStore 把校验交给 createRecordStore 的 validateRecord 回调：value 不是对象直接返回 false，id、projectId、memberId、title 必须都是 string 才算合法。非法内容统一提示 invalidMessage（Invalid Agent session file），查不到记录用 missingMessage（Agent session not found），避免上层拿到半截 AgentSession 去渲染。适用�� agent-sessions 目录下 session.json 的读写路径：新增或改动字段时必须同步放宽或收紧 validateRecord，否则历史文件会整体被判为损坏。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 存储接口类型由工厂推导

AgentSessionStore 用 ReturnType 推导工厂返回结构，新增方法无需手改类型声明。

> AgentSessionStore 直接写作 ReturnType<typeof createAgentSessionStore>，而不是手写接口。原因是工厂返回的 create、get、list、findByHandle、update 五个方法的签名是唯一事实来源，工厂一改，类型自动跟着变，不会出现接口与实现漂移。适用范围是 agentSessionStore.ts 及其调用方：只要保持工厂返回对象形状稳定，消费者就不用调整 import；若将来要给存储加生命周期钩子（如 close），先改工厂返回值再让 ReturnType 扩散，不要在类型别名里硬写补丁。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 会话 id 由 nanoid 分配

create 用 nanoid(12) 生成会话 id，调用方无需自带主键。

> createAgentSessionStore.create 的入参类型是 Omit\<AgentSession, "id" | "createdAt" | "updatedAt">，id 由 nanoid(12) 在存储层生成，createdAt 与 updatedAt 同为一次 new Date().toISOString() 的快照。原因是主键唯一性与时间戳由存储统一负责，调用方传入脏 id 会造成覆盖风险，所以接口层面直接禁掉这三个字段。适用范围：任何新建 Agent 会话的入口（HTTP handler、CLI、Agent 运行时）都不要再自行拼接 id 或时间；需要在创建前知道 id 的场景要在 records.create 之后再取回记录。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 设置文件采用版本化封装

AgentSettingsFile 以 version 隔离持久化格式演进，避免旧数据被误当作当前配置。

> 持久化设置统一写入 AgentSettingsFile，业务配置置于 settings 字段，version 固定为 1。validateSettingsFile 同时校验外层结构和内部 AgentSettings，字段变更不得直接改变文件根结构，以区分文件不存在与格式不受支持并使 loadSettings 失败行为可预测。适用于 AgentSettingsStore 的磁盘格式及后续版本迁移。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 快照文件保留双态内容

SnapshotFile 同时保存原始字节与可选文本，避免二进制文件被错误统计。

> SnapshotFile 必须保留 bytes，并以可选 content 区分文本与二进制内容。createAgentWorkspaceSnapshot 读取文件后，仅在不含零字节时将 bytes 解码为字符串，变更检测始终以 bytes 为准。这样可避免二进制文件乱码被 countTextChanges 或 countLines 当作文本差异，适用于工作区快照、文件变更统计及需保留原始文件内容的协作流程。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 目录遍历逐项等待

readDirectory 串行等待子目录与文件读取，使快照写入顺序稳定。

> readDirectory 应逐项 await：先执行 fs.readdir，再递归 await readDirectory 读取目录，读取普通文件时 await fs.readFile，完成后立即调用 snapshot.set，以避免并发资源峰值及写入交错，保证快照生成顺序确定。该策略适用于 createAgentWorkspaceSnapshot 的目录遍历；若改为并行读取，仍须显式控制快照结果及错误传播顺序。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 运行状态按创建时间判定

以创建时间排序后倒序定位最新运行，避免旧任务被误判为当前任务。

> createChatAgentBridge 在处理消息时先调用 listRuns，按 sessionId 过滤该 Agent 的运行，并用 createdAt.localeCompare 升序排列，再反转后查找 status 为 running 或 queued 的 activeRun。原因是仅按返回顺序判断可能误取消旧任务，尤其在运行记录来自不同持久化层时。规则适用于同一项目、同一 Agent session 的运行选择；新增运行管理实现时必须保留基于 createdAt 的确定性排序语义。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 桥接类型跟随工厂推导

ChatAgentBridge 由 createChatAgentBridge 的返回类型生成，避免接口声明漂移。

> ChatAgentBridge 定义为 ReturnType<typeof createChatAgentBridge>，不另行手写 handleMessage 的参数和返回值结构。原因是工厂已决定桥接对象的方法、异步行为及依赖注入边界，重复手写类型容易在工厂调整后遗漏变化。该约定适用于 R2 中导出桥接 API、测试替身及调用方类型标注；独立消费者契约或额外方法应先调整工厂类型，再由 ChatAgentBridge 自动同步。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 敏感值递归脱敏并识别凭据

redactSensitive 递归处理容器，按最长敏感值优先替换并识别凭据。

> redactSensitive 先合并 collectSensitiveEnvironment 与 sensitiveValues，去重、过滤空值并按长度降序替换，避免短值遮住精确标签，再识别 API_KEY、Bearer 和 Authorization 格式。数组与对象递归调用自身，非字符串标量保持不变。适用于写入 TraceStore 前的 AgentTraceEvent 载荷；输入含空字符串时跳过无意义替换。

适用范围：`src/extracted/agent/traceStore.ts`

### 仓库根目录由模块位置推导

defaultRepositoryRoot 固定默认数据与演示目录的推导基准。

> defaultRepositoryRoot 以 config.ts 相对仓库根目录的固定位置为基准，并由 loadConfig 的 repositoryRoot 缺省参数统一使用。根目录未显式传入时，数据目录、workspacesDir 和 demoProjectRoot 仍可稳定解析，避免依赖进程启动工作目录。适用于默认部署与测试初始化；覆盖目录时须向 loadConfig 传入真实 repositoryRoot。

适用范围：`src/extracted/config.ts`

### 环境变量按配置域顺序装配

loadConfig 依次读取服务、路径、Agent 与功能开关。

> loadConfig 按“读取、转换、校验、归一”顺序装配环境变量：先确认 PORT，再处理 SIMPLERCP_DATA_DIR 与公开地址，随后解析 DEEPSEEK_BASE_URL、模型和超时，最后读取终端、假运行时、导入根目录及工作区配置。固定顺序能让错误尽早定位到具体环境变量，并保证 ServerConfig 有一致默认值。所有服务启动入口都应调用 loadConfig，不要自行读取 process.env。

适用范围：`src/extracted/config.ts`

### 布尔环境变量拒绝模糊值

readBoolean 仅接受精确的 true 与 false。

> readBoolean 对未设置值返回 defaultValue，对精确字符串 true 或 false 返回布尔值；其他内容直接抛出带变量名的 Error。该规则避免把 1、yes、空格或任意非空文本误当成启用，防止终端访问或 fakeAgentRuntime 在不同环境中产生不可预期状态。适用于所有通过 loadConfig 读取的布尔开关，也要求部署清单只写入规范的小写值。

适用范围：`src/extracted/config.ts`

### 事件日志限定传入存储路径

createEventLog 仅将 storagePath 作为持久化目标，不扩展路径。

> createEventLog 直接把 storagePath 传给 loadEvents 与 writeJsonFileAtomically，不解析相对目录、拼接工作区根路径或扩大访问边界。调用方须传入已解析的绝对路径，且目标位于允许工作区内，不能将未经校验的用户输入作为 storagePath。未传 storagePath 时仍可 append 和 list，但事件仅保留在当前 EventLog 的内存状态中。

适用范围：`src/extracted/eventLog.ts`

### JSON 读取缺失文件返回空值

读取不存在的数据文件视为空数据，其余读取错误继续抛出。

> readJsonFile 对 storagePath 执行 JSON 读取与解析，系统返回 ENOENT 时将结果定义为 undefined，让上层按“尚无持久化数据”处理首次启动或文件被移除的场景。JSON 损坏、权限不足等其他异常不在降级范围内，函数会原样 throw error，避免将数据问题误判为文件不存在。该约定适用于 R2 中通过 jsonFile 读取项目、成员、聊天、房间、事件日志、trace、工作区及权限数据的流程。

适用范围：`src/extracted/jsonFile.ts`

### 项目名先规范化再判重

创建项目时统一去除首尾空格，并按不区分大小写的名称阻止重名。

> 调用 validateProjectName 时必须以 name.trim() 的结果作为规范化名称；空名称直接拒绝，长度超过 100 个字符也拒绝。判重时将现有 ProjectRecord.name 与规范化名称同时转成小写比较，避免仅大小写不同的项目并存。该规则适用于通过项目注册表创建新项目的流程，已有项目改名若复用此函数也必须接受同样的大小写语义。

适用范围：`src/extracted/projects.ts`

### 参与者采用稳定字段契约

参与者响应统一字段名，内部成员模型不直接暴露。

> registerCollaborationRoutes 决定 participants 接口的外部契约：MemberStore 返回的 memberId 输出为 id，role 输出为 profileRole，同时保留 projectId、displayName、createdAt 和 updatedAt。团队决策是响应层显式构造 participant，不把 MemberStore 的成员对象直接 res.json，避免内部字段变更或额外数据意外成为公开 API。加入房间时则由 runtime.rooms.joinRoom 接收 name、profileRole 等房间模型字段。适用范围为 participants 列表和 POST members 响应中的 participant；若需调整公开字段，应同步更新调用方契约。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 成员检查不承担批量路径授权

requireMember 只确认成员身份，不能替代每条路径的权限与边界校验。

> requireMember 仅通过 runtime.rooms.getMember(runtime.room.id, memberId) 判断成员是否存在并返回成员，不验证路径、权限令牌或批量操作中的每个目标，因为成员资格与路径访问权属于不同授权维度。适用于含多项 path 的工作区请求：先检查成员，再逐项校验路径边界和权限，不能用一次 requireMember 推导整批授权。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

## 约束

### Trace 导出重新执行递归脱敏

导出当前及历史 trace 时递归处理凭据文本，历史记录不能依赖写入时的配置

> 导出当前及历史 trace 时递归处理凭据文本，历史记录不能依赖写入时的配置。规则适用于traceStore 的分页与 JSON 导出。历史 trace 可能在写入时未脱敏，导出边界必须再次清除嵌套凭据。修改redactSensitive相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/extracted/agent/traceStore.ts`

### 导出文件使用私有权限

导出 JSON 文件创建时使用 0600 权限

> 导出 JSON 文件创建时使用 0600 权限。已有文件也需要保持相同权限。该规则适用于本地数据。

适用范围：`src/extracted/jsonFile.ts`

### 聊天历史关联当前临时 roomId

历史聊天按项目文件保存，roomId 是临时协作房间；读取历史记录时关联当前 roomId

> 历史聊天按项目文件保存，roomId 是临时协作房间；读取历史记录时关联当前 roomId。规则适用于下载历史聊天并返回 ChatMessage 数组。历史文件只保存内容，下载接口需要用当前项目房间标识建立上下文。修改createChatStore相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/extracted/chat.ts`

### 聊天文本先经过敏感信息处理

聊天正文写入文件前需要调用敏感信息处理函数

> 聊天正文写入文件前需要调用敏感信息处理函数。事件记录使用处理后的文本。这个规则适用于新消息。

适用范围：`src/extracted/chat.ts`

### 成员 CSV 导出文件使用 0600

成员导出文件采用 0600，已有文件权限宽于 0600 时也必须收紧

> 成员导出文件采用 0600，已有文件权限宽于 0600 时也必须收紧。规则适用于成员名单导出与临时文件替换。导出包含成员名称和角色，创建新文件与覆盖旧文件都必须限制为属主可读写。修改writeJsonFileAtomically相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/extracted/jsonFile.ts`

### 临时导出文件使用唯一名称

导出临时文件名称包含随机后缀，避免并发覆盖

> 导出临时文件名称包含随机后缀，避免并发覆盖。完成后再替换目标文件。该规则适用于文件写入。

适用范围：`src/extracted/jsonFile.ts`

### 活动历史导出只包含持久事件

过程活动导出只包括 durableEventTypes，光标与连接状态不构成开发过程记录

> 过程活动导出只包括 durableEventTypes，光标与连接状态不构成开发过程记录。规则适用于EventLog 的活动历史 JSON 导出。连接状态等短暂事件无法在重启后重现，报告只能统计 durableEventTypes。修改createEventLog相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/extracted/eventLog.ts`

### 事件 payload 使用对象结构

事件 payload 保持对象结构，导出时不把它转换为字符串

> 事件 payload 保持对象结构，导出时不把它转换为字符串。调用方可以继续读取字段。该规则适用于报告。

适用范围：`src/extracted/eventLog.ts`

### 同项目成员可以查看 Agent run

同一协作项目的成员可以读取项目 run；成员展示角色不决定读取权限

> 同一协作项目的成员可以读取项目 run；成员展示角色不决定读取权限。规则适用于run 详情权限判断。项目协作成员需要复盘同项目的运行记录，展示角色不能替代项目成员关系。修改can相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/extracted/auth/permissions.ts`

### run 权限入口接收资源信息

run 权限调用提供 Action 和资源对象

> run 权限调用提供 Action 和资源对象。资源对象保留 projectId 与 ownerMemberId，便于权限策略统一处理。该记录说明 run 权限调用参数。

适用范围：`src/extracted/auth/permissions.ts`

### 空文件视为无历史事件

readTrace 仅将 ENOENT 转换为空数组，其余读取错误继续抛出。

> readTrace 遇到 ENOENT 时返回空数组，但 JSON.parse、行格式或其他读取异常必须原样抛出，不能把损坏的 trace 文件伪装成无记录。该约束适用于 TraceStore 的历史读取、分页准备和错误上报，使用者可区分尚未创建与已损坏两种状态。

适用范围：`src/extracted/agent/traceStore.ts`

### 上下文文件必须为受限文本

buildRuntimePrompt 拒绝非文本或超过 1 MB 的工作区文件。

> buildRuntimePrompt 读取 AgentPromptContext.path 后，仅接受 readWorkspaceFile 返回 status 为 text 且大小符合限制的结果，否则抛出 Error。该约束适用于运行时提示词构建；非文本资源和超限文件都不得进入 prompt，以控制上下文类型和体积。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### JSON 缺失读取约定

readJsonFile 将不存在文件视为空结果，其他解析错误继续抛出。

> 调用 readJsonFile 读取 storagePath 时，文件不存在且错误码为 ENOENT 应返回 undefined；JSON 内容损坏等其他异常必须抛出。这样调用方能区分首次创建与真实故障，适用范围为读取 JSON 存储文件的路径。

适用范围：`src/extracted/jsonFile.ts`

### 成员访问失败语义

工作区成员门禁用固定 Error 表达身份不匹配，避免响应内容泄露成员探测结果。

> requireMember 在 runtime.rooms.getMember 未找到 memberId 时抛出固定 Error，不把查询结果写入响应或控制台日志。调用 registerWorkspaceRoutes 的工作区接口应沿用这一失败语义，因为成员是否存在属于敏感信息，统一错误可减少枚举探测。适用范围限于需要先确认工作区成员身份的路由处理。

适用范围：`src/extracted/auth/identity.ts`

### 工作区写入失败回滚

工作区操作失败后不得遗留可被误认为成功结果的部分状态。

> registerWorkspaceRoutes 涉及 createWorkspaceDirectory、createWorkspaceFile、renameWorkspacePath 或 deleteWorkspacePath 时，操作失败必须回滚该操作产生的中间状态，再通过 next 传递异常。原因是请求返回失败后仍残留文件会与业务记录不一致，适用范围为所有 workspace 写路由。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 注册表采用版本化项目结构

项目注册表使用固定版本与项目记录数组，便于校验和后续迁移。

> RegistryFile 固定包含 version: 1 和 projects: ProjectRecord\[]，loadRegistry 可据此拒绝结构不符的数据，saveRegistry 再按同一结构持久化。这样能控制注册表演进并让迁移逻辑可识别，适用范围是项目注册表的读取、保存及迁移流程。

适用范围：`src/extracted/projects.ts`

### 注册表类型由工厂推导

ProjectRegistry 从 createProjectRegistry 的异步返回类型推导，避免重复声明接口。

> ProjectRegistry 使用 Awaited\<ReturnType<typeof createProjectRegistry>> 定义，不再手写一套方法签名。工厂新增返回能力后，类型会随实现同步更新，减少调用方与实现漂移，适用范围是引用项目注册表实例及其公开方法的 TypeScript 代码。

适用范围：`src/extracted/projects.ts`

### Action 权限词表迁移边界

Action 是权限判断使用的固定动作集合，迁移时不得随意扩充或改写。

> Action 只允许使用 permissions.ts 已列出的动作名称，新增权限需同步检查 requirePermission 与 can 的匹配关系，否则授权判断可能静默失效。迁移历史数据时应保留原有动作字符串语义，仅在明确业务需求后增删成员、Agent 或 workspace 相关项。

适用范围：`src/extracted/auth/permissions.ts`

### 活动任务限制设置变更

Agent 有活动任务时禁止修改模型或启用状态

> registerAgentRoutes 更新 AgentSettingsStore 前必须调用 agentRuns.hasActiveTasks()；存在活动任务且 model 或 enabled 与当前设置不同时，应拒绝更新并交给错误处理。这样可避免运行中的任务使用不一致的 Agent 配置，适用范围为 Agent 设置写接口。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 活动运行禁止并发覆盖

同一项目的活动运行必须串行更新，防止会话和文件状态发生版本冲突。

> ActiveRun 中的 workspacePath 与 runtimeSessionId 共同绑定一次运行所占用的工作区和运行时会话。团队禁止两个运行同时写入同一项目活动状态；新运行需等待旧运行完成或明确中断后再登记，避免后写入者覆盖前者的会话信息。该约束适用于 createAgentRunManager 触发 AgentRuntime 的并发执行路径。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 运行事件按四类消费

AgentRunManagerEvent 仅含四类通知，消费者须区分空集合。

> AgentRunManagerEvent 的联合类型限定为 run_updated、activity_appended、trace_appended、team_agents_changed。团队代理变化时 agents 即使为空数组，也须发送 team_agents_changed，不能视为无变化；其余分支须携带对应项目标识。适用于 createAgentRunManager 对外订阅和增量刷新。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 快照按路径建立幂等索引

AgentWorkspaceSnapshot 以相对路径为键，同路径只能对应一份文件状态。

> 团队约束 AgentWorkspaceSnapshot 使用 Map\<string, SnapshotFile> 表示工作区状态，键必须是相对路径，同一路径只能保留一个 SnapshotFile。readDirectory 递归遍历时通过 snapshot.set 写入该键，因此重复快照必须产出稳定键集合，调用方才能用 before 与 after 精确判断新增、删除和修改。此约束适用于 createAgentWorkspaceSnapshot 的所有调用、快照比较及依赖路径键的重试流程，禁止用绝对路径或数组位置替代唯一键。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 讨论上下文仅取成员消息

buildDiscussion 从上次回复后截取最近二十条成员消息，排除当前消息及系统事件。

> buildDiscussion 以 lastChatMessageId 定位上次 Agent 聊天消息之后的位置；找不到该消息时从零开始。候选范围随后排除 current.id，并仅保留 kind 缺省为 member 的消息，最终 slice(-20) 后按 authorName 与 text 拼接。规则保证 Agent 不重复接收当前指令，也不把 system 事件混入讨论上下文，同时限制提示词长度。适用于构造常规成员讨论上下文；需要改变窗口大小、事件筛选或消息格式时，必须同步修改 buildDiscussion 及其测试预期。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 桥接依赖通过构造参数注入

测试可替换 AgentRunManager 与 ProjectRuntimeManager，重放消息处理流程。

> createChatAgentBridge 将 AgentRunManager 和 ProjectRuntimeManager 放在 options 中注入，handleMessage 只通过 options.agentRuns 与 options.runtimeManager 获取能力。这样测试可提供可控的 listTeamAgents、listRuns、cancelRun、createRun 以及项目运行时，固定时间、运行记录和聊天消息后重放中断与新任务流程。规则适用于桥接层单元测试和替代实现；不得在 handleMessage 内直接创建具体管理器，否则运行顺序与外部状态将难以复现。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 记录存储的类型校验契约

RecordStoreOptions 将外部数据校验、归属检查和错误提示集中为调用方必须提供的边界契约。

> 使用 createRecordStore 时，RecordStoreOptions<T> 要求 T 至少包含 id 与 projectId，并由 validateRecord 对未知值执行运行时类型守卫。root、fileName 和 recordKey 共同定义磁盘布局，invalidMessage 与 missingMessage 则统一异常语义。这样做是为了避免把不符合协议的历史文件误当成有效记录，并让项目隔离逻辑在加载阶段即生效。该约束适用于所有通过 createRecordStore 创建的项目级记录存储，也适用于调整文件格式或记录结构时同步更新校验器的场景。

适用范围：`src/extracted/agent/recordStore.ts`

### 加载记录必须校验归属

load 遇到格式、类型、项目或目录身份不一致的数据时直接拒绝加载。

> createRecordStore 的 load 只接受 version 为 1、validateRecord 通过、projectId 与当前 options.projectId 相同，并且 value.id 等于 entry.name 的目录记录。任一条件不满足就抛出 options.invalidMessage，不降级跳过。这样既防止跨项目串入记录，也避免目录改名后形成身份漂移。规则适用于所有调用 createRecordStore 的持久化目录；新增字段或升级 version 时，应在 load 中明确兼容策略，不能仅放宽校验而忽略项目归属。

适用范围：`src/extracted/agent/recordStore.ts`

### 句柄格式采用不可变常量

HANDLE_PATTERN 统一限定句柄字符集与长度。

> 团队约定所有 Team Agent 句柄必须匹配 HANDLE_PATTERN：以小写字母或数字开头，后续仅允许小写字母、数字和连字符，总长度为 1 至 32 个字符。该正则作为共享且不可变的格式边界，供 validateHandle 等校验入口复用，避免不同调用方各自放宽或收紧规则；新增句柄入口时应沿用这一约束。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 保留句柄不得进入成员目录

RESERVED_HANDLES 阻止广播或系统语义被成员占用。

> 团队规定 system、all、here、everyone 四个名称属于 RESERVED_HANDLES，成员句柄即使满足 HANDLE_PATTERN 也不得注册。这样可避免广播目标、系统角色与真实成员在命令或提及解析中产生歧义；validateHandle 应在格式检查后同时检查该集合，新增全局语义词时也必须同步扩充保留名单。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### Trace 写入必须串行提交

createTraceStore 通过 Promise 链串行化追加，避免并发写坏 trace 文件。

> createTraceStore 的 append 操作必须沿 operations 形成的 Promise 链依次执行；每个事件都要先由 readTrace 取得末尾 sequence，再写入 AgentTraceEvent。这样做是因为 appendFile 并发执行可能造成行交错或 sequence 重复，串行提交可保持事件顺序。适用范围是同一 TraceStore 实例管理单个 storagePath 的场景；append 失败会中断后续操作，调用方必须处理该异常。

适用范围：`src/extracted/agent/traceStore.ts`

### ZIP 条目需通过双重校验

validateEntry 同时约束路径形态与条目类型，阻断越界写入及特殊文件。

> extractZipArchive 必须先调用 validateEntry：entry.fileName 不得包含反斜杠、绝对路径、盘符前缀或 .. 路径段；externalFileAttributes 解析出的 fileType 只允许普通文件或目录。原因是路径穿越可能写出 destination，符号链接等条目也可能把解压结果导向非预期对象。该约束适用于所有 ZIP 条目；resolveArchivePath 的目录检查只能作为第二道边界，不能替代 validateEntry。

适用范围：`src/extracted/archiveImport.ts`

### 聊天文件只保留版本化消息

ChatFile 固定使用 version 1 保存消息数组。

> 持久化聊天历史必须符合 ChatFile 的 version 1 格式，聊天正文集中写入 messages，读取方不能绕过 version 字段直接接受任意 JSON。loadMessages 会依据 version 和 messages 校验旧数据，格式漂移会被判定为无效历史。该约定适用于 createChatStore 使用的聊天存储文件及 saveMessages 写出的数据，不涵盖仅存在于内存中的临时状态。

适用范围：`src/extracted/chat.ts`

### 跨模块统一引用 ChatStore

模块依赖通过 ChatStore 类型声明，不复制工厂签名。

> 其他 R2 模块需要聊天能力时，类型标注统一使用 ChatStore，而非手工复制 createChatStore 返回对象的字段结构。ChatStore 由 ReturnType 推导，工厂接口增删能力后，依赖方可通过类型检查发现不兼容调用，因为手写类型会与 createChatStore 漂移，迁移期尤其容易遗漏 awaitIdle 等生命周期方法。该约定适用于项目、房间、Agent 等模块与聊天模块之间的静态接口边界。

适用范围：`src/extracted/chat.ts`

### 项目目录必须留在根目录内

项目标识符解析后若越出 projectsDir，立即以无效标识符拒绝。

> resolveProjectDir 将 projectsDir 和 projectId 分别通过 path.resolve 转为绝对路径，再要求 path.dirname(projectDir) 精确等于 root。原因是防止包含路径分隔符、上级目录跳转或绝对路径形态的 projectId 将项目写到注册表根目录之外。该约束适用于所有依据 ProjectRegistry 数据定位项目工作目录的场景，调用方不得绕过该函数自行拼接路径。

适用范围：`src/extracted/projects.ts`

### 缺失判断限定 ENOENT

仅当错误为 Error 且错误码为 ENOENT 时，才归类为路径缺失。

> isMissingPath 须同时满足 error instanceof Error、存在 code 属性且 error.code === ENOENT 三个条件。字符串异常、无 code 的 Error 及 EACCES 等错误均不算路径缺失。该判断仅供资源清理或注册表加载忽略不存在的目标；真实故障须继续抛出并保留现场，避免掩盖权限或文件系统问题。

适用范围：`src/extracted/projects.ts`

### 注册表固定使用版本一结构

RegistryFile 仅接受 version 为 1、projects 为 ProjectRecord 数组的数据。

> RegistryFile 的 version 必须是字面量 1，projects 必须是 ProjectRecord 数组，不得用未声明字段替代核心成员，也不得将 version 放宽为任意数字。结构升级须经独立迁移路径，并保存为受支持版本。该约束适用于 saveRegistry、loadRegistry 与 migrateLegacyProjects 之间的数据交接。

适用范围：`src/extracted/projects.ts`

### Agent 路由依赖注入规则

registerAgentRoutes 通过依赖注入接收运行、任务和设置组件，便于隔离测试与稳定重放。

> registerAgentRoutes 必须只从 dependencies 参数取得 agentRuntime、agentRuns 和 agentSettings，并在注册全部 Agent 路由时复用同一组实例。这样测试可注入可控的 AgentRuntime、AgentRunManager 与 AgentSettingsStore，精确控制 status、hasActiveTasks、listSessions 等调用，避免请求期间切换全局实例导致结果不可重放。该约定适用于所有在 registerAgentRoutes 中注册的设置、状态、会话、团队 Agent、运行与 trace 接口。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 成员身份读取保持轻量

memberIdFor 仅提取请求身份中的成员标识，避免身份读取路径引入额外处理。

> memberIdFor 只允许从 req.identity?.memberId 返回成员标识，不应查询成员、补充资料或触发远端调用。身份解析属于请求前置流程，而该函数仅用于为会话列表等后续逻辑提供稳定的 memberId；额外工作会增加请求延迟，并可能混淆身份缺失与依赖失败。该规则适用于 registerAgentRoutes 内所有需要按成员隔离资源的只读操作。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 身份先于成员资源读取

成员资源访问须先解析成员身份，身份缺失立即返回401，再读取会话或运行。

> registerAgentRoutes 访问成员隔离数据时，先调用 memberIdFor(req) 获取 memberId；为空即响应401，不得再调用 agentRuns.listSessions、getSessionForMember 或其他成员资源方法。固定此顺序可避免未认证请求触发存储查询，并区分认证失败与资源不存在。适用于会话、运行、事件和 trace 等绑定成员身份的数据读取接口。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 会话归属依赖成员标识

会话查询使用成员标识过滤，未登录请求直接返回未授权。

> registerAgentRoutes 在列举项目会话时，从 memberIdFor 取得成员标识，再调用 agentRuns.listSessions 按成员过滤。这样可避免不同成员在同一项目中互相看到会话；请求缺少成员身份时返回 401。适用范围是项目级会话列表接口，新增会话接口也应沿用同一成员边界。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 外部响应采用字段投影

成员与参与者响应通过字段映射生成独立快照，避免暴露存储对象。

> registerCollaborationRoutes 读取成员数据时使用 map 构造 participant，仅返回 memberId、projectId、displayName、role、createdAt 和 updatedAt，加入房间后也另行创建 participant 对象。这样可隔离 MemberStore 与房间模型的内部字段，使调用方获得可序列化的局部副本，后续修改原始成员对象不会隐式改变已返回的数据。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 边界输入按类型逐字段兜底

POST members 对 memberId、name、role 分别做 typeof 与 String 转换，缺省字段传 undefined 而非报错。

> 约定：POST /api/projects/:projectId/members 中 memberId 仅在 typeof req.body?.memberId === "string" 时透传，role 同样按字符串类型判定，否则置为 undefined；displayName 走 String(req.body?.name ?? "") 得到字符串。为什么：请求体由外部客户端提交，字段缺失或类型不符时不能把非法值写入 MemberStore，宽松转换避免整个请求因单个字段失败。适用范围：所有接收 body 的协作路由新增字段时沿用这一模式，先判类型再落值。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 写操作先验权限校验

创建和导入项目前必须先校验写权限，拒绝后立即终止请求。

> 在 registerProjectRoutes 中，POST /api/projects、POST /api/projects/import 和 POST /api/projects/import-zip 都先调用 can(req.identity, "project:write")；校验不通过时执行 res.sendStatus(403) 并 return，不进入 createBlankProject、importDirectory 或 importZip。这样可避免未授权请求触发文件写入、目录导入或压缩包处理，并保证失败响应发生在任何项目变更之前。该规则适用于所有会创建或导入项目资源的路由。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 项目列表承担运行时失效职责

读取项目列表时会同步清理由 registry 删除的运行时实例。

> GET /api/projects 先由 registry.listProjects 构造 projectIds，再筛选 runtimeManager.listActive 中已不存在于注册表的 runtime，并调用 disposeProject。因而项目列表读取不是纯查询：它会清理陈旧运行时，且该过程受 Promise.all 中任一 disposeProject 失败影响。适用于 ProjectRegistry 与 ProjectRuntimeManager 可能因删除操作或重启而短暂不同步的环境。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 工作区路径必须受根目录约束

所有工作区路径操作都应传入项目 workspacePath，并由底层统一限制在项目边界内。

> registerWorkspaceRoutes 调用 listWorkspaceDirectory、readWorkspaceFile 和 writeWorkspaceFile 时，必须同时传入 runtime.project.workspacePath 与请求中的 filePath 或 directoryPath，不能把用户路径直接交给文件系统。原因是 path 来自 HTTP 查询参数或请求体，可能包含越界片段；统一以项目工作区作为根路径可阻止访问项目外文件。适用范围是目录浏览、文件读取、创建、写入及后续同类工作区路由。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 成员查询不设旁路缓存

成员身份以房间实时成员表为准，避免退出后仍获授权。

> requireMember 每次都通过 runtime.rooms.getMember 查询 runtime.room.id 对应的成员，不保存成员对象或查询结果。这样成员退出房间后，后续工作区写操作会立即失去访问资格，不会因旧数据继续放行。该约定适用于 registerWorkspaceRoutes 中需要确认项目成员身份的所有请求，并要求成员增减后沿用同一实时查询路径。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 工作区测试复用真实运行态

工作区路由测试从 ProjectRuntimeManager 取得运行态并走完整请求链。

> registerWorkspaceRoutes 的接口测试通过 ProjectRuntimeManager 按 projectId 获取 runtime，使鉴权、成员校验与 workspacePath 均来自真实运行态。请求携带 identity，覆盖创建、读取、修改，以及权限拒绝、参数缺失和写入结果。适用于工作区路由集成测试，夹具须重建对应项目运行态与房间成员关系。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 文件系统来源须用唯一符号

FILESYSTEM_ORIGIN 统一标记文件系统来源，避免批量与单项路径混淆。

> 团队约定用 FILESYSTEM_ORIGIN 标记来自文件系统的内容来源，不以普通字符串拼接或散落常量代替。applyTextDelta 处理协作文本时，可依赖该来源标记区分批量导入、文件编辑与用户直接输入的路径，避免更新被误判。稳定的 Symbol 身份不会与路径文本、消息标识碰撞，模块迁移后也无需依赖具体文件名。适用于 R2 中涉及文件读取、批量写入与协作文本同步的调用链。

适用范围：`src/extracted/textDelta.ts`

### 大文件读取阈值

工作区读取超过一兆字节时进入截断流程。

> 工作区文件读取以 LARGE_FILE_BYTES 设定上限，其值为 1024 \* 1024 字节。达到或超过该阈值的文件由 readWorkspaceFile 按大文件策略处理，避免把完整内容一次性载入内存。该约束适用于工作区文件读取及依赖其结果的 Agent 上下文构建，不应把截断结果当作完整文件。

适用范围：`src/extracted/workspace.ts`

### 二进制探测采样限制

二进制识别只检查文件前八千字节。

> 二进制内容识别限定在 BINARY_SAMPLE_BYTES 指定的 8 \* 1024 字节采样范围内，由读取流程据此避免扫描整个文件。规则适用于 readWorkspaceFile 判断文件是否属于二进制内容；调用方不能据此断言文件后半段不存在二进制数据，测试也应使用包含目标格式特征的前段样本。

适用范围：`src/extracted/workspace.ts`

### 二进制扩展名白名单

常见二进制扩展名集合用于拦截直接文本写入。

> writeWorkspaceFile 遇到 BINARY_EXTENSIONS 中的扩展名时，不把文件作为普通文本处理。该集合覆盖 class、dll、dylib、exe、jar、pdf、png、zip 等格式，用于减少二进制内容被错误编码或破坏的风险。扩展名判定适用于写入入口；未列入集合的格式仍需依赖内容识别策略。

适用范围：`src/extracted/workspace.ts`

## 风险

### JSON 文件原子写入

JSON 文件先写入临时文件，再替换目标路径

> JSON 文件先写入临时文件，再替换目标路径。写入过程设置文件权限。该规则适用于本地存储。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/jsonFile.ts`

### 工作区路径保持规范化

工作区路径使用 resolve 计算并拒绝越过项目根目录

> 工作区路径使用 resolve 计算并拒绝越过项目根目录。错误路径立即抛出。该规则适用于工作区服务。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/workspace.ts`

### 终端环境过滤密钥

终端环境创建时删除内部密钥字段

> 终端环境创建时删除内部密钥字段。保留项目需要的环境变量。该规则适用于进程启动。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/processEnv.ts`

### 活动记录分配 ISO 时间

append 为活动记录分配 id 和 ISO timestamp

> append 为活动记录分配 id 和 ISO timestamp。list 返回已有事件数组的副本。该规则适用于活动日志。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/eventLog.ts`

### 聊天更新只改变关联字段

聊天更新接口只允许修改 mentions、agentSessionId 和 runId

> 聊天更新接口只允许修改 mentions、agentSessionId 和 runId。正文和作者字段保持原样。该规则适用于消息更新。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/chat.ts`

### Agent 环境不继承内部字段

Agent 子进程环境只保留允许的公开字段

> Agent 子进程环境只保留允许的公开字段。内部通信参数不会传入子进程。该规则适用于环境构造。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/processEnv.ts`

### 房间标识用于消息关联

房间标识用于关联聊天消息和成员事件

> 房间标识用于关联聊天消息和成员事件。读取历史时保留关联字段。该规则适用于协作数据。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/rooms.ts`

### 追加返回值须与落盘事件一致

createTraceStore.append 返回本次实际写入的 AgentTraceEvent。

> createTraceStore.append 应把 operations 队列中最终赋给 result 的 event 返回给调用方，而不是回显 input；这样 sequence、timestamp 与脱敏后的内容才和落盘记录一致。该规则适用于 TraceStore 追加调用及其结果消费，不涉及历史记录的读取边界。

适用范围：`src/extracted/agent/traceStore.ts`

### AgentRun 更新不得改写标识

AgentRunStore.update 保留 current.id，不接受更新覆盖运行标识。

> createAgentRunStore 暴露的 update 应合并 Partial<AgentRun>，但最终 id 始终取 current.id；传入的同名字段不能改变已有 AgentRun 身份。该规则适用于 AgentRunStore 的创建后更新场景，可避免文件定位键与业务标识漂移。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 预览提示词限制展示长度

previewPrompt 压缩空白并把摘要截断到 120 个字符。

> previewPrompt 应先用 replace 合并连续空白并执行 trim；结果超过 120 个字符时保留前 117 个字符并追加省略号。该规则只适用于提示词预览展示，不限制 buildRuntimePrompt 接收的完整请求，也不改变实际 Agent 执行内容。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 消息序号依赖已加载末项

createMessage 递增 sequence 前必须先完成历史加载，避免编号回退或重复。

> createMessage 通过 ensureLoaded 获取完整 messages 后，再以末条消息的 sequence 加一生成新序号。若并发调用或加载尚未完成就计算序号，可能产生重复 sequence；应让创建操作等待加载完成，并仅在消息成功写入后更新内存状态。

适用范围：`src/extracted/chat.ts`

### 加入参数须先完成归一化

JoinRoomInput 应经 normalizeJoinInput 统一后再执行成员复用和连接登记。

> 处理 JoinRoomInput 时，先调用 normalizeJoinInput 生成稳定输入，再执行 findExistingMember、upsertConnection 等操作。直接使用原始 memberId、participantId 或 connectionId 可能因空值和格式差异创建重复身份；归一化应发生在任何房间成员状态变更之前。

适用范围：`src/extracted/rooms.ts`

### RoomStore 查询须处理空集合

RoomStore 查询为空时，调用方必须显式处理缺失值。

> findRoom、findMember 与 findExistingMember 可能返回空集合或 undefined，调用方不得直接解引用。临时协作房间可能尚未建立，或 participantId、connectionId 不在当前集合中。适用于 RoomStore 成员查找、连接同步及加入房间流程；命中后仍应检查对象字段，再执行 refreshDisplayNames 等操作。

适用范围：`src/extracted/rooms.ts`

### 运行记录倒序返回

Agent 运行列表以 createdAt 降序展示。

> createAgentRunStore 的 list 应按 createdAt 降序返回 AgentRun，使最近创建的运行排在前面。排序依据使用 ISO 时间字符串的 localeCompare，可保持与创建端时间格式一致；该顺序适用于项目运行历史列表，不应改变单条记录内部的 createdAt，也不替代 get 的精确查询。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 活动任务期间冻结设置

Agent 有活动任务时禁止修改关键设置。

> registerAgentRoutes 更新 AgentSettingsStore 时，若 agentRuns.hasActiveTasks() 为真且 model 或 enabled 发生变化，应拒绝请求并返回明确错误。原因是运行中的任务可能已读取旧配置，立即切换会造成执行语义不一致；该保护适用于设置更新接口，不妨碍无任务时保存相同配置。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 工作区路径先做越界校验

resolveWorkspacePath 在返回路径前阻断根目录外访问。

> resolveWorkspacePath 必须先拒绝被排除的路径，再校验 candidate 是否仍位于 root 内；relative 以 .. 开头或为绝对路径时立即抛出 Error。该防线适用于 createWorkspaceFile、readWorkspaceFile、renameWorkspacePath 等所有工作区路径入口，不能只依赖浏览器侧限制。

适用范围：`src/extracted/workspace.ts`

### 成员缓存刷新顺序风险

save 必须先完成原子写入，再更新 cache，防止读取到未落盘成员。

> createMemberStore 的 save 应先通过 writeJsonFileAtomically 持久化 members.json，成功后再执行 cache.set。若提前更新 cache，写入失败时内存会暴露尚未落盘的成员状态。该顺序适用于成员新增、角色变更及其他会改变 MemberFile 的操作。

适用范围：`src/extracted/auth/identity.ts`

### 身份解析失败不得放行

成员身份无效时返回 401，避免后续处理使用空身份继续执行。

> createIdentityMiddleware 在 required 为 true 时，若 x-simplercp-member 无法通过 resolveIdentity 或 findIdentity 解析，应由 response.status(401).json 返回错误并停止 next。此规则只约束需要可信成员身份的请求；解析异常也应交给 next(error)，不能改写为成功身份。

适用范围：`src/extracted/auth/identity.ts`

### 工作区写入需双重校验

工作区文件写入既要验证权限词，也要确认项目成员关系。

> registerWorkspaceRoutes 暴露的工作区写入操作必须同时通过权限检查与 requireMember 校验，避免仅有操作权限的主体改动不属于其项目的 workspacePath。该约束适用于文件创建、目录创建、重命名和删除等变更入口；身份无效时应在执行文件操作前终止请求。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 旧版运行记录兼容性风险

AgentRun 校验过宽，磁盘旧数据可能缺少新增必填字段。

> createAgentRunStore 委托 createRecordStore 持久化 AgentRun，但 validateRecord 仅校验对象及字符串类型的 id、projectId，缺失状态、输入、输出等新增字段仍可写入。读取方按完整 AgentRun 使用时可能得到 undefined，因此新增字段或改变字段含义时，须同步制定 run.json 迁移或更严格校验策略，适用于已有 agent-runs 数据及跨版本升级。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 运行时间依赖系统时钟

AgentRunStore 的记录时间与排序受进程系统时钟影响。

> AgentRunStore 的 list 按 createdAt 降序排列，create 通过 new Date().toISOString() 写入 createdAt。系统时间调整或多节点时钟不同步会导致记录时间不一致，列表顺序可能偏离真实事件先后。并发创建、跨机器共享 projectRoot 或依赖精确耗时的测试，应注入可控时间来源，并明确单调性与时区语义。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 文件上下文须先校验缓存

normalizeAgentContexts 拒绝非数组及非法文件路径。

> 缓存 Agent 文件上下文前须调用 normalizeAgentContexts：contexts 未提供时返回 undefined，非数组抛出 Error，每项须满足 type 为 file、path 为非空 string，并在写入 normalized 前 trim；空数组归一化为 undefined。原因是防止非法数据进入后续文件读取与缓存流程，适用于准备进入 buildRuntimePrompt 的上下文输入。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 运行提示限定项目工作区

buildRuntimePrompt 明确项目边界，并只注入已验证文本文件。

> 构造可重放 Agent 请求时，buildRuntimePrompt 在 scope 中写入 projectName 与 workspacePath，并明确禁止使用父目录或父仓库；上下文只能来自 contexts，通过 readWorkspaceFile 读取。若 result.status 不是 text，则抛出 Error，防止非文本或超过限制的文件进入提示。该规则适用于项目级运行与测试夹具：测试应固定工作区、contexts 和 projectName，避免依赖机器上的父级仓库，同时确保失败可复现。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 事件载荷存在膨胀风险

AgentRuntimeEvent.data 无字段数量、文本长度或二进制体积限制，可能放大传输、内存与留存压力。

> AgentRuntimeEvent.data 使用 Record\<string, unknown>，未限制字段数量、文本长度或二进制体积。生产者持续附加调试内容，消费者复制并长期保存事件，会增加内存、序列化耗时和日志体积。生产事件时仅放业务必需字段，消费者应限制单次处理规模；文件内容或完整响应保存引用或摘要。适用于事件生产、订阅转发和持久化链路。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 更新操作串行化防覆盖

update 通过 operations 队列串行落盘，避免并发写入造成状态覆盖。

> createAgentSettingsStore 接收 update 时，先用 validateSettings 校验输入，再将 saveSettings 追加到 operations 链；前一次落盘完成后才替换内存 settings。并发触发 update 会使后提交者覆盖先提交者，因此调用方须按业务顺序提交。失败后的保存会沿队列继续传播。规则适用于同一 AgentSettingsStore 实例内的更新操作。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 缺失配置回退到默认项

loadSettings 仅在文件不存在时生成默认配置，损坏文件不会被静默覆盖。

> loadSettings 读取 storagePath 后，只有 readJsonFile 返回 undefined 才采用 provider 为 deepseek、model 为 defaultModel、enabled 为 true 的默认设置；读到内容则必须通过 validateSettingsFile，拒绝静默回退。该规则避免格式错误或旧版本数据被默认值覆盖，掩盖真实故障。适用于 AgentSettingsStore 首次启动及设置文件缺失场景，不适用于文件损坏场景。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 文件比较须刷新失效快照

比较前重新采集 after，避免缓存持有旧字节导致伪差异。

> 风险点在于 compareAgentWorkspaceSnapshots 只比较传入的 before 与 after，不会自行读取磁盘。若 after 来自未失效的缓存，即使文件已被外部修改，previous.bytes.equals(current.bytes) 仍会跳过变更。新增、删除路径也依赖两个 Map 的真实键集合。团队执行差异计算前必须重新调用 createAgentWorkspaceSnapshot 获取 after，并在工作区可能被并发修改时同步刷新快照；该规则适用于缓存工作区、Agent 变更检测和增量提交判断。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### can 当前是放行占位实现

can 恒返回 true，调用方不能据此认定权限检查有效。

> 当前 can(identity, \_action, resource) 无条件返回 true，identity、\_action、resource 均未参与判定。因此 requirePermission 调用 can 时不会产生 403，所有已接入该函数的路径实际上处于放行状态。若后续接入成员角色、项目归属或所有者规则，需要同步定义 Action 与 resource.projectId、ownerMemberId 的映射，并补充拒绝用例；在此之前，不得把 can 的结果作为生产授权依据。该事实适用于当前 src/extracted/auth/permissions.ts 及所有依赖它的调用链。

适用范围：`src/extracted/auth/permissions.ts`

### 消息创建依赖运行时字段校验

TypeScript 输入边界仍需显式规范化消息字段。

> createChatStore 接收 CreateChatMessageInput 后，不能直接信任 text 等运行时值；createMessage 会用 String 和 redactSensitive 转换正文，并把缺省 kind 设为 member。这样可避免非字符串进入 ChatMessage，同时降低敏感内容直接落盘和写入事件的风险。规则适用于通过 createChatStore 创建消息的所有调用方，尤其是从外部请求、Agent 或插件传入 CreateChatMessageInput 的场景。

适用范围：`src/extracted/chat.ts`

### 加载事件前验证持久化结构

loadEvents 拒绝版本不符或事件字段缺失的日志文件。

> loadEvents 读取 storagePath 后必须同时确认 stored.version 为 1、stored.events 是数组，并逐项验证 id、type、timestamp 均为字符串；任一条件不满足就抛出 Error("Invalid activity file")。这样可避免损坏或不兼容的 EventFile 被 unshift 到 events 后继续参与重放。校验适用于所有从磁盘恢复的事件日志，而不是仅针对内存中由 append 生成的数据。

适用范围：`src/extracted/eventLog.ts`

### 事件文件不承担权限判定

EventFile 仅定义持久化结构，访问授权须在写入前处理。

> EventFile 只含 version 与 events: EventRecord\[]，不含操作者、成员角色或工作区权限信息，不能据此判断 append 是否获准。权限检查须在事件进入 createEventLog 返回的 append 前，使用当前请求上下文完成；文件可读也不等于调用者拥有业务权限。loadEvents 仅负责恢复数据。

适用范围：`src/extracted/eventLog.ts`

### Agent 请求体必须运行时校验

TypeScript 类型断言不能替代运行时校验，未知请求体不得直接传给存储或运行组件。

> registerAgentRoutes 中将 req.body 断言为 nextSettings 仅用于静态类型提示，不是输入验证。调用 agentSettings.update、createTeamAgent 等边界时必须检查实际值、允许类型和必填项，并将格式错误映射为明确的客户端错误，避免 malformed JSON、数组或错误标量污染持久化状态。该规则适用于所有接收 Agent 请求体的 POST、PUT 路由。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 连接状态受时钟回拨影响

连接离线判定若依赖本地时间，可能把有效连接误判为过期。

> 在 registerCollaborationRoutes 的连接管理流程中，markConnectionOffline、cleanupStaleMembers 及成员时间字段会参与连接生命周期判断。若实现使用 System 毫秒值并直接比较连接时间，进程时钟回拨会让新连接看起来早于旧连接，或使清理任务过早删除有效成员。团队约定：连接排序和过期判定应使用单调递增时钟或服务端统一时间源，并为时钟偏差预留容差；createdAt、updatedAt 只用于展示和审计。适用范围是 ProjectRuntimeManager 管理的全部 Connection 状态变更。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 项目写操作缺少显式幂等键

创建与导入接口未提供幂等键，客户端重试可能生成重复项目。

> registerProjectRoutes 暴露的 POST /api/projects、/api/projects/import 和 /api/projects/import-zip 都没有读取幂等键；响应超时后重发请求，会再次进入 createBlankProject、importDirectory 或 importZip。风险在于客户端无法区分首次请求与重试，可能生成多个 Project。适用于需要可靠重试或由网关自动重放这些写请求的部署场景。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 导入路径须受工作区约束

目录导入的路径校验应由注册表统一执行，避免越界读取。

> registerProjectRoutes 将 req.body.path 交给 registry.importDirectory，因此路径安全依赖 ProjectRegistry.importDirectory 的根目录约束、路径规范化及符号链接处理。若目标未被解析到允许的工作区，调用方可能读取或导入边界外内容。新增目录导入入口或调整工作区规则时，须验证这些限制并补充越界用例。

适用范围：`src/extracted/routes/projectRoutes.ts`

## 上下文

### 项目目录来自配置

项目数据路径由配置中的项目根目录计算

> 项目数据路径由配置中的项目根目录计算。路径处理使用 node:path。这个规则适用于项目存储。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/projects.ts`

### 房间加入事件包含成员标识

成员加入房间时写入成员标识和房间标识

> 成员加入房间时写入成员标识和房间标识。重复加入保持幂等。这个规则适用于房间模块。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/rooms.ts`

### 聊天消息保存作者信息

聊天消息保存作者标识、名称和可选角色

> 聊天消息保存作者标识、名称和可选角色。消息创建事件包含作者名称。这个规则适用于聊天存储。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/chat.ts`

### 权限检查保留项目范围

权限判断接收 projectId 资源范围

> 权限判断接收 projectId 资源范围。缺少项目成员时拒绝访问。这个规则适用于权限函数。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/auth/permissions.ts`

### run 更新保留原始 id

运行记录更新时始终保留原始 id

> 运行记录更新时始终保留原始 id。传入更新对象不能替换标识。这个规则适用于记录存储。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 配置端口必须是数字

配置端口解析为正整数

> 配置端口解析为正整数。非法端口会立即抛出错误。这个规则适用于服务器配置。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/config.ts`

### Trace 下载需核对成员归属

registerAgentRoutes 的下载入口必须按会话成员关系授权。

> registerAgentRoutes 暴露 trace 下载前，应先取得请求成员身份，并确认目标 session 或 run 属于该成员，再调用 getTrace 或 listRuns 生成下载内容。原因是仅验证登录状态不足以阻止成员读取他人会话。适用范围是 agentRoutes 中所有 trace、run 和 session 查询及下载处理。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 创建消息前校验输入

收紧消息创建接口的必填项与字段类型，避免无效记录进入聊天存储。

> 调用 createChatStore 的 createMessage 前，应按 CreateChatMessageInput 校验 roomId、authorId、authorName 与 text，kind 仅接受 ChatMessage 支持的值，以防止无效输入污染持久化数据。该规则适用于成员消息、Agent 消息及 mentions、runId 等可选字段的创建入口。

适用范围：`src/extracted/chat.ts`

### 二进制样本固定为八千字节

BINARY_SAMPLE_BYTES 统一控制二进制内容采样大小。

> BINARY_SAMPLE_BYTES 固定为 8 \* 1024，readWorkspaceFile 生成二进制预览时应沿用这一上限。统一取样长度可避免不同入口因文件大小产生不一致的截断结果；该决策只适用于二进制样本提取，不用于 LARGE_FILE_BYTES 的大文件读取判定。

适用范围：`src/extracted/workspace.ts`

### Action 词表承担接口契约

新增或调整权限动作时，必须同步维护 Action 联合类型及调用侧映射。

> Action 是权限检查使用的封闭词表，新增“agent:read”或“project:write”等能力时应同步更新类型及调用侧。遗漏任一分支会导致编译期才发现契约断裂。适用于定义权限入口、路由动作和 can 数据出口的类型迁移，不用于判断具体主体能否执行某项操作。

适用范围：`src/extracted/auth/permissions.ts`

### 运行管理器依赖注入边界

创建运行管理器时显式注入存储、运行时和活动回调，避免模块内部隐式读取全局状态。

> 通过 AgentRunManagerOptions 显式传入 members、runtime、registry、runtimeManager、getSettings 和 runTimeoutMs，apiKey、sensitiveValues 可选注入，appendActivity 承接外部事件写入。这样 createAgentRunManager 可在测试和不同宿主中替换依赖，由调用方决定返回值是否继续修改，避免共享可变状态。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 运行管理器采用注入式时钟

createAgentRunManager 的时间行为由调用方配置，便于测试和跨环境运行。

> createAgentRunManager 创建并缓存运行、追踪、会话、队列及活跃任务状态，依赖均从 AgentRunManagerOptions 获取。时间记录统一使用可注入的 now，不直接读取系统时钟，便于测试固定 startedAt、finishedAt、timestamp 并保持一致的 ISO 时间语义。适用于 AgentRunManager 的创建与运行生命周期处理。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 追踪文件按运行隔离

getTrace 为每个项目和运行组合建立独立 JSONL 追踪存储。

> getTrace 以 projectId 和 runId 组成缓存键，追踪文件固定写入 store.runsRoot 下的 runId/trace.jsonl。不同运行的事件需隔离，以防并发任务串写日志。createTraceStore 接收 options.sensitiveValues，未配置时使用由 options.apiKey 组成的数组。适用于 AgentRunManager 的追踪读取、追加和诊断。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 运行补丁按文件覆盖工作区

mergeFileChanges 保留工作区文件集合，并以运行结果替换补丁。

> mergeFileChanges 先按 change.file 建立 runtimeByFile，再遍历 workspaceChanges 生成 merged，同名文件采用对应 patch；工作区外的 runtimeChanges 经 filter 后追加。工作区决定最终文件范围，运行结果仅覆盖其补丁内容，不新增文件；同一 file 有多条 runtimeChanges 时仅最后映射项生效。适用于批量变更与单项路径并存。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 读取响应不改写密钥事实

get 合并运行时密钥状态，返回值不会把密钥内容载入设置模型。

> AgentSettingsStore.get 返回 settings 的浅拷贝，并附加 options.apiKeyConfigured，磁盘中的 AgentSettingsFile 不承担 API 密钥存储职责。这样可以把可编辑模型配置与运行时凭据状态分开，调用方依据布尔值展示能力，而不尝试反查密钥内容。扩展响应字段时应保持这一边界，适用范围为 store 对外的全部读取调用。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 桥接类型不承担窗口策略

ChatAgentBridge 仅描述桥接结构，讨论条数上限由 buildDiscussion 控制。

> ChatAgentBridge 使用 ReturnType<typeof createChatAgentBridge> 表达工厂产出的调用边界，本身不声明消息数量、字符数或运行队列上限。当前讨论窗口由 buildDiscussion 的 slice(-20) 限定，类型层无需复制该数值。原因是把截断策略塞入公共类型会让调用方误以为可通过类型扩大窗口，同时造成实现与声明重复。适用于 R2 桥接 API 建模；新增上下文字段时应先明确它是公开契约还是函数内部策略，再决定是否进入 ChatAgentBridge。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### save仅负责落盘

save执行原子写入，不承担内存更新或冲突检测。

> createRecordStore 内部的 save 只把 record 以 version: 1 和 options.recordKey 写入 record.id 目录下的 options.fileName，并调用 writeJsonFileAtomically。这样可避免文件出现半写状态，也把持久化格式与 Map 的状态维护分开；但 save 本身不检查记录是否存在，也不更新 records，因此创建、更新等调用方必须另行完成唯一性判断与内存同步。该规则适用于 createRecordStore 提供的记录写入流程。

适用范围：`src/extracted/agent/recordStore.ts`

### Trace 读取采用追加日志格式

readTrace 逐行解析非空 JSON 事件，文件不存在时返回空数组。

> readTrace 按 UTF-8 读取 storagePath，以换行分隔事件，对每个非空行执行 JSON.parse，产出 AgentTraceEvent\[]；仅 ENOENT 返回空数组，其他读取或解析错误原样抛出。因 createTraceStore 的 append 必须用 appendFile 写入完整 JSON 行，该格式适用于单进程写入的追加日志，其他进程同时改写同一文件时可能读到不完整的一行。

适用范围：`src/extracted/agent/traceStore.ts`

### 压缩包采用双层入口限额

ZIP 导入先限制压缩体积，再逐项限制解压体积。

> 导入 ZIP 时先比较 archive.byteLength 与 MAX_ARCHIVE_BYTES，超过 200 MiB 立即拒绝；解压阶段还由 MAX_FILE_BYTES 约束单文件，并由 MAX_TOTAL_BYTES 约束累计输出。这样可在读取目录和落盘前挡住超大输入，避免压缩炸弹与磁盘耗尽。适用于 extractZipArchive 接收的持久化归档导入，不适用于普通文件读取。

适用范围：`src/extracted/archiveImport.ts`

### ZIP 读取保留手动生命周期

延迟读取条目，归档由调用方负责关闭。

> openZip 通过 lazyEntries 避免打开压缩包时立即遍历全部条目，并关闭 autoClose，使 readEntries 与 openEntryStream 可按需访问同一 ZipFile。validateEntrySizes 开启后会校验条目大小与实际读取量。extractZipArchive 在 finally 中调用 zip.close() 释放资源，因此单独复用 openZip 时必须显式关闭。

适用范围：`src/extracted/archiveImport.ts`

### 加载聊天历史返回原数组

loadMessages 返回已解析的消息引用，调用方应按只读数据使用。

> loadMessages 在 storagePath 缺失或文件不存在时返回空数组，文件有效时返回 parsed.messages，不克隆每条 ChatMessage，因为读取器只负责校验并提供历史。createChatStore 后续会整体替换 messages，并通过 saveMessages 持久化。该规则适用于需要变更消息的调用方，应使用 ChatStore 更新入口，避免仅修改内存而未写入存储。

适用范围：`src/extracted/chat.ts`

### 持久事件集合界定重试范围

durableEventTypes 标识需落盘并按幂等事件处理的操作。

> durableEventTypes 收录 terminal_input、chat_message_created、file_changed 及 Agent 任务生命周期事件。这些操作会改变协作状态或产生可观察副作用，重试时须先按 event.id 去重并确认前次任务或写入结果，不能直接重复执行。该集合也决定 createEventLog 写入 EventFile 的事件范围，未列入的业务瞬时事件不自动获得持久化保证。

适用范围：`src/extracted/eventLog.ts`

### 仅将 ENOENT 视为路径缺失

存在性探测吞掉缺失错误，但权限等异常继续向上传播。

> pathExists 使用 fs.access 探测 targetPath，并把成功映射为 true、ENOENT 映射为 false；其他异常不会被伪装成“不存在”，而是原样抛出。这样可区分真正缺少项目目录与权限故障、I/O 错误等情况，避免加载或迁移流程误判后覆盖有效数据。该行为适用于 RegistryFile 对应项目的本地路径检查，也适用于任何需要区分缺失与故障的注册表操作。

适用范围：`src/extracted/projects.ts`

### RoomStore 类型跟随工厂演进

RoomStore 从 createRoomStore 自动推导，测试夹具应通过工厂构造而非手写结构。

> RoomStore 定义为 createRoomStore 的 ReturnType，测试和工具代码应通过同一工厂创建夹具，以共享 createRoom、joinRoom、getRoom 等能力及内部同步规则，避免结构变更后仍按旧协议运行。场景需可重放时，应向每个夹具注入 EventLog，并通过事件记录核对加入、离线与重入行为。

适用范围：`src/extracted/rooms.ts`

### 加入成员失败留下半写状态

members.join 成功而 runtime.rooms.joinRoom 抛错时，成员已落库但未加入房间，形成部分写入。

> POST /api/projects/:projectId/members 先执行 members.join，再调用 runtime.rooms.joinRoom，二者无事务或补偿。失败后成员存在于 MemberStore，但不在 room 中，因为两套存储无法原子提交。依赖房间成员列表完整性的场景重试前，应检查 members.listMembers，避免重复 join。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 并发成员写入缺少版本校验

并发 POST members 未使用版本号、updatedAt 比较或乐观锁，导致成员落库与 joinRoom 交错，房间成员视图短暂不一致。

> registerCollaborationRoutes 只负责编排写入，未提供冲突处理或重试语义，members.join 与 runtime.rooms.joinRoom 的执行顺序不确定。GET participants 读取 members.listMembers，房间视图读取 runtime.room，两侧快照可能短暂不一致。并发加入、退出及 offline 场景排查时，应先区分存储延迟与写序错乱。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 成员查询采用房间域索引

requireMember 仅查询当前项目房间成员，不遍历项目或全局成员集合。

> requireMember 通过 runtime.rooms.getMember(runtime.room.id, memberId) 定位成员，成员不存在即请求失败。查询限定于当前 runtime.room.id 对应的房间域，避免权限校验扫描 Project 全部成员，适用于工作区写操作中的项目成员确认。getMember 返回精确成员记录，可直接支持按 memberId 或 displayName 进行事件路由。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 工作区根路径的可重放判定

通过绝对路径比较确认操作目标确为工作区根。

> 测试夹具可用 isWorkspaceRoot 判断 relativePath 是否解析到工作区根：先将 root 转为绝对路径，再与 resolveWorkspacePath 的结果比较。该判定适用于验证 createWorkspaceFile、writeWorkspaceFile 等操作是否仍指向根目录，也便于在测试中识别路径归一化后的等价目标。

适用范围：`src/extracted/workspace.ts`

## 负向经验

### 事件日志等待写入完成

事件日志提供 awaitIdle 用于等待异步写入

> 事件日志提供 awaitIdle 用于等待异步写入。关闭前需要等待所有操作完成。该规则适用于事件模块。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/eventLog.ts`

### 文本增量按差异顺序应用

applyTextDelta 使用 fast-diff 的差异顺序操作 Y.Text

> applyTextDelta 使用 fast-diff 的差异顺序操作 Y.Text。相同内容增加当前位置，删除内容保持当前位置，插入后继续增加位置。该规则适用于编辑器文本处理。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/textDelta.ts`

### 配置读取环境变量

服务配置从环境变量读取默认值

> 服务配置从环境变量读取默认值。缺少必填值时抛出配置错误。该规则适用于配置加载。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/config.ts`

### 成员记录支持更新显示信息

join 遇到已有 memberId 时更新 displayName 和 role

> join 遇到已有 memberId 时更新 displayName 和 role。新成员使用 randomUUID 分配标识，空白显示名称被拒绝。该规则适用于身份模块。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/auth/identity.ts`

### 路径使用平台分隔符

文件路径由 node:path 组合，避免手写分隔符

> 文件路径由 node:path 组合，避免手写分隔符。路径输出在当前系统上保持有效。该规则适用于文件模块。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/jsonFile.ts`

### 历史消息复制后返回

读取聊天消息时返回新数组和新对象

> 读取聊天消息时返回新数组和新对象。调用方修改结果不会改变存储。该规则适用于读取接口。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/chat.ts`

### 记录存储参数不得缺省

RecordStoreOptions 要求调用方明确提供存储定位与校验策略。

> 创建记录存储时必须完整提供 RecordStoreOptions，包括 root、fileName、recordKey、projectId 及 validateRecord；不能依赖隐式默认路径、文件后缀或宽松校验。原因是不同项目可能共用文件系统，必须让目录边界、记录键和有效性条件清晰可审计。该约束适用于 createRecordStore 的全部调用方及新增存储类型。

适用范围：`src/extracted/agent/recordStore.ts`

### 规范加入参数保持稳定

NormalizedJoinInput 是运行时内存态输入，不是持续演进的持久化协议。

> NormalizedJoinInput 包含 participantId、connectionId 和可选 profileRole，createRoomStore 可据此执行 normalizeJoinInput 与 upsertConnection。运行时标识和展示信息可能变化，固化为持久化格式会增加旧数据兼容难度。该规则适用于房间加入参数归一化和成员同步，调整持久化结构时须单独定义兼容规则。

适用范围：`src/extracted/rooms.ts`

### 身份字段选择顺序

Identity 仅承载成员身份字段，不包含成员记录中的时间字段。

> 构造 Identity 时只选取 MemberRecord 中的 projectId、memberId、displayName 与 role，不把 createdAt、updatedAt 带入身份上下文。原因是路由鉴权只需要稳定的成员身份信息，适用范围为 Request 身份注入及 requireMember 一类成员判断。

适用范围：`src/extracted/auth/identity.ts`

### EventInput 负载需受控

避免无界 payload 拖慢事件写入与历史加载。

> EventInput 的 payload 不应承载无限增长的二进制或大文本，提交前应设置体积上限并优先保存摘要或引用。这样可避免 EventLog 写入放大及 loadEvents 内存占用过高；该限制适用于 createEventLog 接收的普通协作事件，超限输入应明确拒绝。

适用范围：`src/extracted/eventLog.ts`

### EventFile 版本不可混读

旧版事件文件应被识别并拒绝读取。

> EventFile.version 只能表示当前支持的格式版本；loadEvents 遇到未知 version 时不应按 events 字段猜测解析，而应返回可识别的兼容性错误。这样可防止字段语义错位或记录丢失；适用于 createEventLog 持久化文件的恢复，不涉及接口层临时查询结果。

适用范围：`src/extracted/eventLog.ts`

### 运行存储按项目惰性创建

getStore 只缓存可验证项目的存储实例，缺失项目立即失败。

> getStore 的缓存键是 projectId，但只有 options.registry.getProject(projectId) 成功后才调用 createAgentRunStore，并写入 stores。原因是运行数据必须绑定真实项目的 metadata 路径，避免为不存在的 projectId 生成孤立目录或无效 AgentRunStore。调用方应在创建运行、读取运行或处理项目队列前使用 getStore；项目不存在时允许抛出 Error，而不要继续写入。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 预览提示词固定截断

previewPrompt 仅生成最多 120 字符的展示文本，不能作为完整 Agent 输入。

> previewPrompt 会先把 prompt 中的连续空白折叠并去除首尾空格，随后在长度超过 120 时截取前 117 个字符并追加省略号。该限制只适合界面预览、日志摘要或结果列表，不能替代 buildRuntimePrompt 构造的完整运行提示词。调用方若把 previewPrompt 的结果传给 Agent，会静默丢失请求尾部内容，因此完整输入必须直接保留原始 prompt。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### AgentRuntimeEvent 仅表示单个事件

AgentRuntimeEvent 没有批量投递契约，消费方应逐条处理并按事件类型分派。

> 消费 AgentRuntimeEvent 时，应将 type 用于事件分类，将 data 用于读取当前事件自身的载荷，不得假定回调包含批量结果或把多条记录合并进 data。原因是 AgentRuntimeEvent 未声明数组边界、顺序或批处理语义，擅自合并会导致订阅方无法准确分派。此规则适用于 AgentRuntime.subscribe 的所有事件监听器及测试夹具；需要批处理时，应在监听器之外显式聚合。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 缺省文本不计入差异

缺少旧值或新值时，按零变更处理，避免把不可比较内容误报为增删。

> 团队约定 countTextChanges 仅在 previous 与 current 同时存在时计算增删行；任一参数为 undefined，直接返回 additions 和 deletions 均为 0。这样可区分“无法取得文本”与“已取得相同文本”，避免批量快照比较把缺失字段放大成删除或新增。适用于 createAgentWorkspaceSnapshot 收集文件内容后，由 compareAgentWorkspaceSnapshots 汇总文本差异的场景；二进制文件也应继续依赖 bytes 比较。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 避免暴露内部记录引用

读取结果必须复制，调用方不得修改 createRecordStore 持有的原始对象。

> createRecordStore 的 get 与 list 返回记录时必须展开生成新对象，不能把 records 中的 T 引用交给调用方，否则修改会绕过 update 的 change 回调与落盘流程，导致内存状态和文件内容分叉。ensureLoaded 仅保证 load 已执行，不提供隔离副本。适用于所有读取项目、成员、聊天或其他 T 记录的场景；变更记录应走 update，而非修改 get 或 list 的返回值。

适用范围：`src/extracted/agent/recordStore.ts`

### 脱敏标签不能依赖环境变量名

sensitiveLabel 仅在当前进程环境中反查名称，否则固定返回 TOKEN。

> sensitiveLabel 通过 Object.entries(process.env) 查找与 value 相同的环境变量，找不到时返回 TOKEN，因为脱敏发生在持久化前，不能假定环境项名称长期存在。环境变量被删除、值被动态传入或多个名称共用同一值时，只能得到通用标签。createTraceStore 和 redactSensitive 可继续安全脱敏，但依赖具体标签做审计分类的消费者不能把环境变量名视为稳定元数据。

适用范围：`src/extracted/agent/traceStore.ts`

### ZIP 导入需双重计量防护

声明大小与实际流字节都必须通过总量限制。

> extractZipArchive 解析 ZIP 时累计 declaredBytes，超过 MAX_TOTAL_BYTES 即终止，落盘时由 countBytes 按 chunk.byteLength 统计 extractedBytes，超限后通过 pipeline 中断写入，以防伪造或不一致的 uncompressedSize 绕过限制。该规则适用于所有外部 ZIP 归档导入，临时文件残留与并发写入须结合现有清理策略处理。

适用范围：`src/extracted/archiveImport.ts`

### readEntries 终止后须释放 ZIP

读取条目达到上限后必须关闭 ZIP，避免异步资源继续占用。

> readEntries 在条目数超过 MAX_ENTRY_COUNT 时虽会 reject，但不会替调用方关闭 ZipFile。extractZipArchive 的异常清理路径必须关闭已经打开的 zip，再把错误交给调用者；不能只依赖 Promise 状态结束。这样可避免压缩包流、文件描述符在失败后继续占用，适用范围是所有 ZIP 导入流程，包括正常结束、读取报错和条目超限三类退出路径。

适用范围：`src/extracted/archiveImport.ts`

### 缺少身份时返回 undefined

requireIdentity 在鉴权链中拒绝匿名请求并返回 undefined。

> request.identity 缺失时，requireIdentity 立即以 response.status(401).json 响应并终止后续处理，调用方获得 undefined。这可阻止匿名身份进入单项权限逻辑，但批量接口应逐个区分无身份与无权限，避免聚合鉴权掩盖具体失败项。适用于直接使用 Request、Response 的 HTTP 鉴权入口，调用后须先处理 undefined 再使用返回值。

适用范围：`src/extracted/auth/permissions.ts`

### 避免重复触发历史加载

ensureLoaded 复用首次加载 Promise，勿在调用前另行读取。

> 调用方不要绕过 ensureLoaded 重复执行 loadMessages；该函数用 operations 缓存首次加载的 Promise，并仅在加载成功后替换 messages。自行读取会让磁盘状态与 createChatStore 内部状态出现两个来源，迁移期间尤其容易把旧消息覆盖到新消息之后。该限制适用于 createChatStore 暴露的 listMessages、createMessage 和更新操作，测试或修复代码也不应另建独立的加载链路。

适用范围：`src/extracted/chat.ts`

### 运行配置先校验再落地

ServerConfig 承载已规范化的服务、Agent 与路径配置。

> ServerConfig 只接收 loadConfig 完成校验和默认值归一后的结果：port、openCodePort、runTimeoutMs 必须是合法整数，dataDir、workspacesDir、demoProjectRoot 与 importRoots 应为绝对路径，publicOrigin 和 agent.baseUrl 应为 HTTP(S) URL。不要绕过 loadConfig 直接构造不可信配置，否则端口越界、相对路径和非法协议会延迟到运行时才暴露，影响服务启动、Agent 调用和文件导入。

适用范围：`src/extracted/config.ts`

### 基础环境变量采用固定白名单

普通进程环境仅继承稳定的基础变量，避免重试时携带变化或污染数据。

> baseNames 固定列出 PATH、HOME、USER、LANG、TERM 等通用变量，buildEnvironment 与 terminalEnv 都以此作为环境继承边界。这样做可防止重试或任务重建时把临时值、会话标识及运行产物意外带入子进程，适用于所有通过 buildEnvironment 构造的环境；新增通用变量时必须先评估跨任务稳定性。

适用范围：`src/extracted/processEnv.ts`

### 加入输入不承担排队语义

JoinRoomInput 仅含成员与连接信息，不表达异步等待或任务队列状态。

> joinRoom 调用 normalizeJoinInput 规范化 JoinRoomInput 后，立即更新 RoomStore 的成员与连接状态。该输入承载 memberId、name、participantId、connectionId 与 profileRole，不含 Promise、等待次数或队列位置，因为这些身份参数不应混入调度控制数据。若需限制同一成员并发加入、等待连接确认或延后广播，应在房间协作层另建队列协议。

适用范围：`src/extracted/rooms.ts`

### 规范化输入不代表容量控制

NormalizedJoinInput 只保证关键字段可用，不提供成员数、连接数或队列长度上限。

> NormalizedJoinInput 通过 Required\<Pick\<JoinRoomInput, "name">> 保证 name 存在，并明确 participantId、connectionId 与可选 profileRole 的形状；它不是容量策略描述。调用 normalizeJoinInput 后，joinRoom 仍可能持续创建成员和连接，代码中没有成员总数、connectionCount 或待处理队列的截断规则。因此，大批量接入场景不能把输入规范化视为限流手段，必须在调用 joinRoom 前按业务配额筛选或分批，并为拒绝项单独记录原因。

适用范围：`src/extracted/rooms.ts`

### 工作区异步操作必须完整等待

文件与目录变更完成后再响应，禁止用未等待的 Promise 表示成功。

> registerWorkspaceRoutes 对 writeWorkspaceFile、createWorkspaceFile、createWorkspaceDirectory、deleteWorkspacePath 和 renameWorkspacePath 等异步动作必须使用 await，并在完成后才发送成功响应或发布 workspace 事件。原因是文件系统写入、删除和重命名尚未完成时提前返回，会让客户端看到成功却找不到目标路径，也会造成事件早于实际变更。适用范围包括所有工作区变更路由及其错误转交 next(error) 逻辑。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 导出类型不等于运行时校验

types.ts 仅提供类型出口，不能替代消息和状态数据的运行时验证。

> src/extracted/types.ts 通过 export type 转出 ChatMessage、RoomState、WorkspaceNode 等类型，只建立编译期契约。接收 ClientMessage、TerminalClientMessage 或服务端状态的边界必须另行执行运行时验证，否则外部或旧版本数据即使通过 TypeScript 编译，也可能破坏 RoomState、WorkspaceChange 等结构。

适用范围：整个项目

### 忽略目录不得进入路径处理

IGNORED_SEGMENTS 仅用于排除不应参与文件操作的目录。

> 团队约定将 node_modules、.git 与 \_\_MACOSX 收录在 IGNORED_SEGMENTS 中。调用路径处理逻辑时，先依据该集合排除这些目录，避免依赖目录、版本库元数据和 macOS 压缩包残留进入工作区扫描或权限校验。该集合不代表拒绝整个输入路径：isIgnoredPath 仍只负责判定具体路径是否属于忽略范围，因此适用点是文件枚举、目录导入及成员访问控制入口。

适用范围：`src/extracted/workspacePolicy.ts`

## 教程

### 身份中间件读取认证成员

认证中间件从请求上下文读取成员标识

> 认证中间件从请求上下文读取成员标识。缺少身份时返回未授权。这个规则适用于身份模块。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/auth/identity.ts`

### 运行记录保留成员名称

Agent run 保存 memberId 和 memberName

> Agent run 保存 memberId 和 memberName。记录存储读取时等待正在执行的写入操作，并返回对象副本。这个规则适用于运行记录。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 项目列表确认工作区是否存在

listProjects 会检查项目工作区路径是否仍然存在

> listProjects 会检查项目工作区路径是否仍然存在。缺失的普通项目从列表移除，演示项目重新创建。这个规则适用于项目查询。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/projects.ts`

### 存储文件写入前创建父目录

JSON 文件写入前递归创建父目录

> JSON 文件写入前递归创建父目录。文件内容使用两个空格缩进，并以换行结束。这个规则适用于本地存储。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/jsonFile.ts`

### 房间记录事件类型固定

房间加入和离开事件使用固定 type 字段

> 房间加入和离开事件使用固定 type 字段。事件 payload 保留房间和成员信息。这个规则适用于协作模块。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/rooms.ts`

### 记录存储拒绝无效 JSON

记录文件读取后需要检查对象结构

> 记录文件读取后需要检查对象结构。无效内容抛出模块定义的错误信息。这个规则适用于运行记录。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/extracted/agent/recordStore.ts`

### 权限校验置于写入路由

createRecordStore 负责数据隔离，不承担请求权限判断。

> createRecordStore 的 create、update 等方法应先完成记录加载与项目归属约束，但成员是否有权调用这些操作，应由注册路由的权限检查负责。这样可把身份授权与持久化一致性分层处理，避免存储组件自行猜测请求身份；适用于 recordStore 的全部写入口及 createRecordStore 的调用封装。

适用范围：`src/extracted/agent/recordStore.ts`

### Agent 提及须先解析再触发

createChatAgentBridge 仅对有效 mentions 启动或中断 Agent 任务。

> handleMessage 应先用 parseMentions 提取 mentions，再匹配 listTeamAgents 返回的 agent.handle；没有提及或未匹配 Agent 时，仅返回 updateMessage，以避免非 Agent 消息提前制造无来源任务。适用于 Agent 任务创建、活动任务中断及讨论上下文组装，范围限于 chatAgentBridge 消息处理流程。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 成员文件版本约定

MemberFile 固定使用 version: 1，并通过 members 保存记录集合。

> 创建成员存储时，MemberFile 应声明 version: 1，并把成员数组放入 members；不要在初始化数据中另造版本字段或用单个成员对象替代数组。这样便于按 MemberFile 结构恢复集合，适用范围为 createMemberStore 初始化及持久化成员文件。

适用范围：`src/extracted/auth/identity.ts`

### MemberStore 返回类型约束

MemberStore 直接继承 createMemberStore 的返回形态，调用方应沿用其方法契约。

> MemberStore 定义为 ReturnType<typeof createMemberStore>，因此接入成员数据时应使用该工厂已提供的 save、resolveIdentity 或 findIdentity 等能力，不要另建同义存储接口。这样可让类型检查持续覆盖成员查找与持久化流程，并减少运行时行为差异。

适用范围：`src/extracted/auth/identity.ts`

### MemberRecord 缺省值处理

MemberRecord 字段缺失时须按成员存储约定补齐

> 在构造或读取 MemberRecord 时，memberId、projectId、displayName、role、createdAt 和 updatedAt 都应使用稳定且可追溯的值；缺少必要字段时由 createMemberStore 采取明确的缺省策略，避免生成空成员记录。这样可保证 MemberFile 持久化后仍能被后续身份匹配与项目筛选使用。

适用范围：`src/extracted/auth/identity.ts`

### 项目队列失败后保留任务

项目级队列记录待运行项与处理状态，失败后仍保留未完成任务。

> 使用 ProjectQueue 时，runIds 保存项目内待处理运行，processing 标识当前是否由队列协程占用，completion 可让调用方等待本轮结束。执行某项失败时不能清空其余 runIds，否则会丢失排队请求；应保留可重试状态并释放 processing。适用于 createAgentRunManager 管理的同一项目串行调度场景。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 中断提示保持兼容格式

中断提示保留固定句式、文件列表和空列表兜底，便于历史上下文继续解析。

> buildInterruptionPrompt 生成可持久化的英文提示：先说明上一任务被 nextRun 对应成员中断，再列出 interruptedRun.fileChanges 中的文件。成员显示名缺失时依次回退到 memberName、memberId；文件为空时写入 none，避免生成含糊句子。该格式适用于后续 AgentRun 恢复任务及跨版本会话读取。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 预览提示先归一化再截断

previewPrompt 将空白提示压缩为单行，并限制展示长度。

> 调用 previewPrompt 展示用户输入时，先用 replace 把连续空白压成空格并执行 trim，再按 normalized.length 判断是否用 slice 截取前 117 个字符并追加省略号。该规则仅适用于界面预览和日志摘要，不适合改写实际发送给 Agent 的 prompt；执行链路仍应由 buildRuntimePrompt 保留原始请求语义，避免展示压缩影响任务内容。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 构造可重放的运行时夹具

测试 AgentRuntime 时应实现完整接口并记录调用顺序，避免依赖真实运行环境。

> 做法教程：为 AgentRuntime 编写测试替身时，逐一实现 status、createSession、run、getDiff、cancel、subscribe 和 dispose；可按场景补充 prepareWorkspace 或 prepareRun。用固定 sessionId、messageId 和 AgentRuntimeEvent 序列驱动 subscribe，使 run 与 getDiff 的输入和事件先后关系能够重放；由 subscribe 返回的释放函数验证取消订阅。该做法适用于 AgentRuntime 的契约测试，因为真实工作区执行会引入非确定性。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 按成员状态回填会话历史标记

非团队会话中已退场成员的数据统一标记为 historical。

> 迁移遗留 Agent 数据时，遍历 sessionStore.list()，对 scope 为 personal、成员已不在 memberIds 且 historical 尚未置位的 sessionStore 调用 update，标记为 historical。团队 scope 不参与判断，已有 historical 的记录和当前有效成员的 personal 会话不更新。该规则用于项目成员变更后的历史归属修正。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 迁移须同时注入两个存储接口

迁移入口通过依赖注入协调运行记录与会话记录。

> 调用 migrateLegacyAgentSessions 时，应同时提供 projectId、runStore、sessionStore 和 memberIds，不要让迁移函数自行读取全局状态。runStore 负责列举和回写 run，sessionStore 负责查询、创建及更新 session；memberIds 则是判断成员是否仍在项目内的依据。该约定适用于项目初始化、升级和历史数据修复场景，也能让调用方通过同一组 Store 接口控制持久化位置并便于测试替换。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### Store 返回对象按引用交接

迁移流程保存并复用 Store 返回的会话对象，不另行复制。

> sessionStore.create 返回的 session 对象会直接放入 migrated，并以其 id 和字段更新 runStore；实现中不额外克隆返回值。因此，调用方和实现方必须把 create、get、list、update 的结果视为 Store 管理的对象，而不是可任意原地改写的普通副本。该规则适用于 AgentSessionStore 与 AgentRunStore 的 TypeScript 接口约定：若未来需要不可变返回值或独立快照，应在 Store 层统一调整，不能只修改 migrateLegacyAgentSessions 的局部使用方式。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 存储初始化参数约定

创建 AgentSettingsStore 时必须提供路径、默认模型和密钥配置状态。

> 调用 createAgentSettingsStore 前，先组装 AgentSettingsStoreOptions：storagePath 指定设置文件落盘位置，defaultModel 供首次加载缺失文件时生成默认配置，apiKeyConfigured 决定对外响应中的密钥状态。三个参数分别覆盖持久化、缺省行为和敏感信息展示，不能由调用方隐式推断。配置字段变更时同步调整此接口，适用于所有 AgentSettingsStore 实例的创建流程。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 递归快照限定工作区根

工作区快照从根目录递归收集，相对路径决定条目身份。

> 使用 createAgentWorkspaceSnapshot 时，调用方传入 workspacePath 作为唯一工作区边界，函数创建空 AgentWorkspaceSnapshot 后调用 readDirectory(workspacePath, "", snapshot)。readDirectory 内部递归生成相对路径，并以该路径写入快照。操作流程应先确定根目录，再从相对目录空串启动遍历；后续比较依赖 before 与 after 中完全一致的相对路径键，因此不要混入工作区外文件，也不要在不同调用中改变根目录语义。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 迁移旧记录时复用存储工厂

历史数据迁移应接入 createRecordStore，而不是另写读取与落盘分支。

> 迁移旧版目录数据时，以 createRecordStore 提供的 load 为唯一目录扫描入口：每个 entry.name 对应记录 id，fileName 指定版本化文件，recordKey 定位业务对象。随后沿用 store 暴露的 create、update 或 save 流程写入，使校验、projectId 归属检查、原子落盘和内存索引保持一致。直接复制文件会绕过 version 与 validateRecord 约束，可能把无效历史结构带入新模块；该做法适用于 R2 中从旧目录结构迁移项目、成员、聊天等记录的场景。

适用范围：`src/extracted/agent/recordStore.ts`

### 写操作失败后队列继续运行

enqueue 隔离单次失败，让后续写操作仍可进入队列执行。

> createRecordStore 的 enqueue 把 operation 接到 operations 之后，同时把队列尾设置为无论 result 成功或失败都转为 undefined 的 Promise。这样，某次 save 或 update 失败不会让 operations 永久保持 rejected，后续操作仍能执行；调用者仍通过 result 收到原始成功值或异常。若直接把 result 赋给 operations，失败后所有排队写入都会被拒绝。该规则适用于同一 createRecordStore 实例内的创建、更新和删除操作，尤其是可能因磁盘或校验错误失败的写入路径。

适用范围：`src/extracted/agent/recordStore.ts`

### 单文件大小随归档格式约定

ZIP 内单文件解压上限为 128 MiB。

> 持久化 ZIP 格式约定单个条目解压后不得超过 MAX_FILE_BYTES，即 128 MiB。extractZipArchive 依据 entry.uncompressedSize 在写入前执行校验，既保护运行节点的内存与磁盘，也避免导入结果与后续文件处理能力不匹配。调整该常量会改变归档兼容性，修改时需同步评估既有 ZIP 的接收范围。

适用范围：`src/extracted/archiveImport.ts`

### 累计解压量采用独立预算

ZIP 解压总量最多 1 GiB，与单文件限额并行生效。

> 归档导入的总输出预算由 MAX_TOTAL_BYTES 定义为 1 GiB，不能用 MAX_FILE_BYTES 替代。extractZipArchive 先累计 entry.uncompressedSize，再在流式写出时统计 extractedBytes，分别拦截声明超限和实际超限的 ZIP。即使目录声明不可信，实际解压写入也不会越过总量预算，适用于所有 extractZipArchive 的 ZIP 条目集合。

适用范围：`src/extracted/archiveImport.ts`

### Action 用冒号划分权限域

Action 采用“资源域:操作”形式扩展权限枚举。

> 新增权限时，Action 必须沿用“资源域:操作”的序列化格式，例如 project:list、agent:cancel 和 workspace:write；资源域限定为 project、member、agent、terminal 或 workspace，操作限定为 list、write、read、join、role、settings、create、cancel 或 input。这样 can 与 requirePermission 能按同一字符串稳定匹配，也便于接口、事件和日志持久化该字段。适用于所有权限声明、鉴权调用及跨模块传递 Action 的位置，不能临时创建格式不一致的别名。

适用范围：`src/extracted/auth/permissions.ts`

### 缺省目录可随模块稳定定位

教程：通过 repositoryRoot 缺省参数复用仓库相对路径。

> 调用 loadConfig 时若省略 repositoryRoot，函数会采用 defaultRepositoryRoot；该值由 fileURLToPath 和 import.meta.url 相对定位，而不读取 process.cwd()。编写测试或嵌入程序时，可先准备 ProcessEnv，再调用 loadConfig(env)；需要隔离数据时显式传入目标 repositoryRoot。此做法适用于依赖仓库相对目录的默认配置，避免从不同工作目录启动后找不到 .simplercp-data 或演示项目。

适用范围：`src/extracted/config.ts`

### 先校验配置再做权限判断

权限处理只能消费已通过 loadConfig 校验的 ServerConfig。

> 涉及 terminalEnabled、fakeAgentRuntime、importRoots 与 agent.apiKey 的权限判断，应在 loadConfig 成功返回 ServerConfig 后执行，再把对应字段传给检查逻辑。这样可确保端口、绝对路径、URL 协议和布尔格式已经校验，避免权限分支依据非法配置作出错误决定。该规则适用于 R2 的终端、Agent、导入目录及密钥访问场景。

适用范围：`src/extracted/config.ts`

### 构造事件时省略可选上下文

EventInput 仅强制要求 type，其余上下文按事件需要选择性提供。

> 调用 append 时，EventInput 只要求提供 type，roomId、memberId、participantId 和 payload 均可省略。缺失上下文时不要用空字符串或虚构成员填充，因为事件可能属于全局范围或仅携带业务载荷。payload 使用 Record\<string, unknown> 接收结构化扩展数据，适用于聊天、文件、工作区及 Agent 等事件；具体事件若需关联主体，再显式填写对应字段。

适用范围：`src/extracted/eventLog.ts`

### 批量更新复用单项加入流程

批量成员操作应逐项走 joinRoom，避免绕过连接去重与在线状态同步。

> 批量加入成员时，应逐项调用 createRoomStore 返回对象上的 joinRoom，而不是直接向 RoomState.members 追加数据。joinRoom 会先执行 normalizeJoinInput，再通过 findExistingMember 判断新成员还是重入；两条路径都会调用 upsertConnection、syncMemberFromConnections 与 refreshDisplayNames，并写入 member_joined 或 member_rejoined 事件。批量实现若绕过这些步骤，会造成连接计数、显示名和事件日志互相不一致，因此该规则适用于初始化成员、导入名单及自动化协作场景。

适用范围：`src/extracted/rooms.ts`

### 协作接口注册做法

在统一函数中挂载项目协作路由，并沿用现有身份校验与错误转发模式。

> 新增或调整项目协作接口时，统一在 registerCollaborationRoutes 中注册对应的 app.get、app.post 或 app.patch 路由。处理器沿用 requireIdentity、async/await 与 try/catch 结构：需要身份的请求先调用 requireIdentity(req, res)，异步成员操作通过 await members.listMembers 或 await members.join 执行，异常交给 next(error)。这样可让成员列表、入会和连接状态接口共享同一套鉴权、异常传播及维护入口，适用于 src/extracted/routes/collaborationRoutes.ts 内的协作 API。

适用范围：`src/extracted/routes/collaborationRoutes.ts`
