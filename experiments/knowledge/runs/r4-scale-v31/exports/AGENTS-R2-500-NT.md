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

### 先封存再建立会话

迁移先处理失效会话，再处理缺失会话的运行记录。

> migrateLegacyAgentSessions 先遍历 sessionStore.list，将非 team、成员已不在 memberIds 且 historical 为 false 的会话更新为 historical。随后才遍历 runs 并补建缺失会话；该顺序适用于迁移启动阶段需先稳定旧会话状态、再修复运行引用的场景。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 房间事件使用提交后快照

房间事件须在状态变更成功后生成，并携带最终成员与连接信息。

> createRoomStore 追加 room_created、member_joined、member_rejoined 或 member_removed 事件时，应先完成 RoomState 更新，再从最终状态生成 payload，避免日志与 getRoom 结果分叉。适用于 createRoom、joinRoom 及成员上下线处理。

适用范围：`src/extracted/rooms.ts`

### 桥接路径限制在工作区

ChatAgentBridge 不得越过配置的工作区边界。

> ChatAgentBridge 的实际结构由 createChatAgentBridge 决定，buildDiscussion 涉及路径时只能接受工作区内可解析的位置。工作区外路径或无法解析的相对路径应在桥接层拒绝，避免讨论上下文引用项目范围之外的文件；该规则适用于文件型 Agent 讨论输入。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 桥接失败保留诊断信息

ChatAgentBridge 调用失败应留下可定位的错误上下文。

> ChatAgentBridge 的调用失败应由 createChatAgentBridge 返回或抛出的错误携带可诊断信息，包括所执行的讨论构建步骤 buildDiscussion。调用方记录错误时需保留失败阶段与原始原因；该约定适用于桥接异常排查和运行日志观测，不要求记录业务内容。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 连接记录按 id 复用而非追加

upsertConnection 以 connection.id 为键幂等更新，避免重复连接堆积。

> upsertConnection 先在 room.connections 中按 connection.id 查找，命中则用 Object.assign 更新既有对象并返回，未命中才 push，避免无条件追加导致连接数膨胀并影响 syncMemberFromConnections 的 connectionCount 与 online 状态，适用于所有写入连接条目的入口。

适用范围：`src/extracted/rooms.ts`

### 成员在线数只统计 online 连接

syncMemberFromConnections 用 online 过滤后的连接数决定成员在线状态，非在线连接不计入。

> syncMemberFromConnections 先按 participantId 过滤出该成员的全部连接，再从中筛出 online 为真的连接，用其长度写入 member.connectionCount 与 member.online。原因是房间内可能保留尚未清理的离线连接，若直接用全部连接计数，成员明明已离开仍会显示在线，前端会误判其仍可编辑当前文件。适用于成员上下线、连接超时或客户端异常断开后的状态刷新，lastSeenAt 则取全部连接中最新的时间戳作为兜底信息。

适用范围：`src/extracted/rooms.ts`

### 成员名按受限格式校验

成员句柄必须符合 HANDLE_PATTERN，且校验流程统一交给 validateHandle。

> 成员句柄应先由 validateHandle 校验 HANDLE_PATTERN；normalizeHandle 只负责清理输入，parseMentions 仅从文本中提取候选项。格式限制用于保持代理成员引用稳定，适用于成员加入、提及解析与保留名称检查。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 工作区目录采用缺省路径

未指定 workspacesDir 时，工作区统一落在 dataDir 下的 workspaces。

> createProjectRegistry 在 workspacesDir 缺省时使用 path.join(dataDir, "workspaces")，并把该路径传给 createDemoProject、migrateLegacyProjects 与项目初始化流程。统一根目录可避免同一实例产生分裂的工作区集合，适用范围是创建项目注册表及未显式提供工作区根目录的场景。

适用范围：`src/extracted/projects.ts`

### JSON 读取异常处理边界

readJsonFile 仅将文件不存在视为空结果，其余读取或解析异常继续抛出。

> readJsonFile 调用 JSON.parse 处理文件内容；遇到 ENOENT 返回 undefined，其他读取或解析错误直接抛出，避免把损坏数据误判为缺失。该策略适用于成员名单、项目元数据等 JSON 文件的读取入口，调用方可据此区分尚未生成与现有文件异常。

适用范围：`src/extracted/jsonFile.ts`

### 并发加载复用同一Promise

load合并同项目的重复读取，并清除已完成或失败的加载任务。

> createMemberStore的load应先查cache，再检查loading中已有的pending；存在时直接复用该Promise。首次读取由loadFile执行，并在finally中删除loading条目。这样既避免并发请求重复访问成员文件，也避免失败任务永久占用后续加载，适用于按projectId读取成员列表的异步入口。

适用范围：`src/extracted/auth/identity.ts`

### 迁移标记支撑断点续跑

migrateLegacyProjects 用 started 标记识别已迁移项目。

> migrateLegacyProjects 迁移旧项目时，在 markerDir 写入 migration-${project.id}.started；若该标记与 project.workspacePath 均存在，可直接把 project.id 记入 completed 并跳过再次搬运。这样允许中断后重放而不重复迁移；适用于带 metadataPath 的旧记录。

适用范围：`src/extracted/projects.ts`

### 保留句柄先做保留词校验

解析提及文本时，保留句柄必须通过 validateHandle 后才能进入后续流程。

> parseMentions 识别到 system、all、here 或 everyone 等 RESERVED_HANDLES 条目时，应调用 validateHandle 拒绝，而不是把它们当作普通成员句柄继续处理，避免特殊范围词被误解析为团队成员。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 大文件阈值统一按字节判断

工作区文件大小判断统一使用 LARGE_FILE_BYTES。

> workspace.ts 对文件大小的分类应统一采用 LARGE_FILE_BYTES 的字节阈值，不得分别按字符数或不同常量估算。这样可保证 writeWorkspaceFile、readWorkspaceFile 与 createWorkspaceFile 对同一文件作出一致判断；该决策适用于工作区文件读写路径及大文件策略，不用于 Agent 运行记录。

适用范围：`src/extracted/workspace.ts`

### 二进制扩展名采用默认集合

BINARY_EXTENSIONS 定义默认二进制扩展名集合。

> BINARY_EXTENSIONS 作为识别二进制文件的默认扩展名集合，包含 .class、.dll、.exe、.png、.pdf、.zip 等类型。新增格式时应显式更新该集合，使 listWorkspaceDirectory 与 readWorkspaceFile 对文件类别的判断保持一致；扩展名映射规则适用于工作区文件分类。

适用范围：`src/extracted/workspace.ts`

### 运行记录按创建时间倒序

AgentRunStore 列表按创建时间降序排列，便于查看最近运行。

> createAgentRunStore 返回的 list 必须按 createdAt 倒序输出，并使用 records.list 获取完整记录。这样调用方无需自行排序即可优先看到最近一次运行，适用于 AgentRunStore 的运行记录展示与查询。

适用范围：`src/extracted/agent/agentRunStore.ts`

### EventLog 类型由工厂推导

EventLog 的公开形态应直接跟随 createEventLog。

> EventLog 使用 ReturnType<typeof createEventLog> 推导，而不是手写另一套接口。这样 loadEvents 与事件写入能力发生变化时，类型会随工厂实现同步，减少路由或调用方仍按旧结构访问的风险；适用范围是 EventLog 对外类型声明及 createEventLog 的消费者。

适用范围：`src/extracted/eventLog.ts`

### 运行仓库类型由工厂推导

AgentRunStore 直接从 createAgentRunStore 的返回类型生成。

> AgentRunStore 应由 ReturnType 配合 typeof createAgentRunStore 推导，不要另写重复接口。这样工厂返回结构变化时类型会同步更新，适用于 createAgentRunStore 对外暴露的存储 API 声明。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 目录创建采用存在即报错

createWorkspaceDirectory 不复用已有目录。

> createWorkspaceDirectory 在目标 absolutePath 已存在时抛出 Error，否则调用 mkdir 并启用 recursive。团队采用“创建”和“确保存在”分离的语义，避免幂等 mkdir 掩盖重复请求或路径冲突；适用于需要区分新建成功与目标已存在的目录操作及调用方。

适用范围：`src/extracted/workspace.ts`

### 工作区重命名禁止覆盖

renameWorkspacePath 仅移动源路径，目标已存在时必须失败。

> renameWorkspacePath 允许把 fromPath 移到 toPath，但不得覆盖现有文件或目录；pathExists 检测到 absoluteTo 时应抛出错误。根路径同样由 isWorkspaceRoot 拦截，避免破坏工作区边界。规则适用于工作区内的重命名操作及调用方错误处理。

适用范围：`src/extracted/workspace.ts`

### 项目批量操作采用集合清理

列表读取会并行处置已不在项目注册表中的活动运行时。

> registerProjectRoutes 在列出项目时，先由 registry.listProjects 生成 projectIds，再筛出 listActive 中已消失的项目，并通过 disposeProject 批量关闭。原因是项目注册表与运行时状态可能暂时不同步，需要回收孤立 runtime。该决策仅适用于 GET /api/projects 的清理流程，不改变单个项目路由的处理方式。

适用范围：`src/extracted/routes/projectRoutes.ts`

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

### 列表操作采用异步返回约定

AgentRunStore 的列表能力保持异步形态，为底层读取留出扩展空间。

> 团队决策是让 `AgentRunStore` 中的 `list` 保持异步调用形式，调用方通过 `await` 获取结果，而不是把接口收敛为同步数组。工厂 `createAgentRunStore` 负责把异步读取与排序组合成统一能力，因此上层无需了解底层记录的读取方式。该约定适用于 Agent 运行记录的列表访问；若以后改为全量同步加载，仍须同步调整 `AgentRunStore` 的公开契约。

适用范围：`src/extracted/agent/agentRunStore.ts`

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

### 运行记录以项目根隔离存放

每次运行记录固定落在项目专属目录，并由存储工厂统一管理。

> 团队决策要求 `createAgentRunStore` 将 `runsRoot` 固定为 `projectRoot` 下的 `agent-runs` 目录，并通过 `createRecordStore` 使用统一的 `run.json` 文件布局。这样同一项目的运行数据拥有明确边界，后续的 `create`、`get`、`list` 与 `update` 都复用同一存储实例。创建新项目时必须传入独立 `projectRoot`，禁止复用其他项目的目录，否则记录集合会失去项目隔离。

适用范围：`src/extracted/agent/agentRunStore.ts`

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

### 更新时锁定归属字段

update 接受局部变更，但恢复会话既有身份与项目归属。

> createAgentSessionStore 的 update 先合并 current 与 update，随后明确恢复 current.id、current.projectId、current.memberId，并刷新 updatedAt。原因是调用方传入 Partial<AgentSession> 时可能携带身份字段，若直接接受会改变会话归属或项目边界。该决策适用于全部 sessionId 更新；可编辑的业务字段仍由 update 覆盖，时间字段由存储层统一维护。

适用范围：`src/extracted/agent/agentSessionStore.ts`

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

### 事件发布采用同步遍历

emit 同步遍历监听器，单个回调异常会中断后续通知。

> createAgentRunManager 内部的 emit 同步遍历 listeners 并逐个调用 listener，不隔离回调异常，以保持事件派发顺序与调用栈一致。该方式适用于 AgentRunManagerEvent 的进程内通知；监听器须自行处理异常，否则回调抛错会阻断后续监听器收到 run_updated、trace_appended 等事件。需要容错或异步消费时，应在监听器实现中完成，不能假定 emit 会隔离失败。

适用范围：`src/extracted/agent/agentRunManager.ts`

### Activity 注入自有时钟

由可选回调决定 Activity 写入及时间来源，管理器不直接读取时钟。

> Activity 写入由 AgentRunManagerOptions.appendActivity 负责，回调决定 id、timestamp 等数据；选项缺失时直接返回。该设计隔离持久化与时间依赖，并允许测试注入固定时钟。适用于 Activity 事件接入；配置回调须生成符合 EventRecord 协议的完整记录，否则 activity_appended 携带的数据将缺少有效时间信息。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 团队 Agent 按项目串行

withTeamAgentLock 用 Promise 链串行化同项目操作，并隔离前序失败。

> withTeamAgentLock 按 projectId 维护 teamAgentOperations Promise 链，operation 必须等待前序完成，链会保存结果并吞掉前后序错误，避免一次失败永久阻塞同项目后续任务。它适用于同一 projectId 内需串行执行的团队 Agent 操作，不隔离不同 projectId；调用方仍须处理 current 返回的业务错误。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 队列运行前复制可观测状态

执行队列任务时以存储快照为准，并在工作区隔离后刷新会话与运行记录。

> createAgentRunManager/executeRun 先从 getStore(projectId) 读取 current，仅当 status 为 queued 时继续，避免调用方持有的旧对象影响状态判断。团队工作区完成 prepareWorkspace 后，会清除受影响会话及运行记录中的 runtimeSessionId，并追加 agent_workspace_isolated 活动。原因是运行时绑定会随 Git 仓库隔离失效，适用范围是 team scope 的排队执行流程。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 管理器类型绑定工厂结果

AgentRunManager 直接采用 createAgentRunManager 的返回类型，避免接口漂移。

> AgentRunManager 使用 ReturnType<typeof createAgentRunManager> 定义。工厂返回能力变化时，类型会同步更新，减少声明与实现不一致的风险。该类型别名适用于 R2 中依赖管理器公开契约的 TypeScript 调用方，不涵盖工厂内部私有状态。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 运行入口注入冲突边界

运行管理器由入口统一注入依赖，并将超时与活动写入纳入配置。

> AgentRunManagerOptions 将并发协作所需依赖集中到创建入口：runtime 与 runtimeManager 负责执行和运行环境，members 与 registry 提供成员及项目信息，getSettings 用于读取运行配置。runTimeoutMs 明确单次运行的超时边界，避免不同调用方采用不一致的等待时长；appendActivity 作为可选入口，把并发期间产生的活动交给外部存储。该决策适用于通过 AgentRunManager 创建、排队和执行 Agent 运行的场景。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 运行记录采用独立文件存储

每次 Agent 运行写入 agent-runs 下的 run.json，并按创建时间倒序查询。

> createAgentRunStore 将运行数据存入 projectRoot 下的 agent-runs 目录，由 createRecordStore 以 run.json 保存单条记录，使不同运行独立持久化。list 调用 records.list 后按 createdAt 倒序排列，最新运行优先。适用于隔离运行记录、按时间浏览历史及复用通用记录存储；调整存储位置或排序逻辑时，应验证项目隔离与列表顺序。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 运行事件承担统一观测入口

AgentRuntime.subscribe 作为运行状态与结果的可观测入口，由适配层统一记录。

> AgentRuntime.subscribe 以 listener 接收 AgentRuntimeEvent，并返回可异步调用的取消函数，说明运行过程的通知入口集中在该契约，而不是散落到各方法返回值。适配层可据此统一接入状态变化记录和订阅清理，但不应在 AgentRuntimeEvent.data 上强制日志格式。适用于不同运行后端接入同一观测流程，以及 dispose 前解除仍有效的订阅。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 上下文读取失败即中止

buildRuntimePrompt 任一文件不可读或非文本时整次构建失败，不返回部分提示词。

> buildRuntimePrompt 逐个 await readWorkspaceFile，并把结果写入 sections；只要某个 context.path 的 result.status 不是 text，就抛出 Error，提示文件必须是小于 1 MB 的文本文件。循环完成后才一次性返回包含 scope、文件段和用户请求的提示词。该决策适用于项目范围严格受限的 Agent 运行，避免缺失文件形成残缺上下文；调用方需要处理构建失败，不能把失败视为仅缺少可选资料。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 事件不承载授权结论

权限判定留在业务入口，AgentRuntimeEvent 只报告已发生的运行事件。

> 权限检查须在业务入口调用 AgentRuntime 前完成，不暗示事件已获授权。AgentRuntimeEvent 未声明可信主体、权限范围或授权结果，消费者若据 data 放行，会将不可信载荷误作授权依据。此规则适用于所有由 subscribe 接收事件的协作流程，具体权限仍由现有权限模块判定。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 存储无显式关闭接口

工厂返回对象不含 close，靠 process 退出回收文件句柄。

> createAgentSessionStore 返回的 create、get、list、findByHandle、update 中没有任何 close 或 dispose，AgentSessionStore 因此也没有可调用的清理入口。原因是底层 createRecordStore 以文件为持久化单位，单次读写即开即关，没有长期持有的句柄需要显式释放。适用范围：不要在测试或服务停机钩子里寻找 store.close()，那会直接是 undefined 调用；需要验证落盘结果时读 agent-sessions/session.json 内容，而不是依赖内存状态推断是否已写盘。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 会话存储类型由工厂推导

以工厂返回类型约束 AgentSessionStore，防止接口与实现漂移。

> AgentSessionStore 使用 ReturnType<typeof createAgentSessionStore> 推导，不重复手写接口，使 create、get、list、findByHandle 与 update 的签名随工厂返回值同步，避免遗漏方法或与运行时对象不一致。适用于 R2 中需要注入或依赖 AgentSessionStore 的模块，调用方应依赖该导出类型而非另行描述等价结构。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 跨模块统一引用会话类型

跨模块调用只引用 AgentSessionStore，以工厂签名作为唯一契约。

> R2 的跨模块依赖统一引用 AgentSessionStore，不在各调用方复制 createAgentSessionStore 返回对象的类型声明。由于 AgentSessionStore 来自 ReturnType<typeof createAgentSessionStore>，构造函数增删能力时，依赖模块可立即暴露契约差异。该约定适用于项目、Agent、聊天或房间模块注入会话存储的代码；各模块无需了解 createRecordStore 的内部文件格式。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 会话类型推导的工厂边界

AgentSettingsStore 从工厂返回类型推导，避免接口与实现漂移。

> AgentSettingsStore 通过 Awaited\<ReturnType<typeof createAgentSettingsStore>> 定义，不另行手写方法清单。createAgentSettingsStore 的实现若调整 loadSettings、saveSettings 或失败行为，该类型会随返回值同步变化，避免声明与真实能力不一致。此决策适用于 R2 中消费设置存储的模块；需要稳定公开契约时，应在工厂边界显式导出类型，而不是复制一份平行接口。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 设置落盘采用串行队列

更新操作通过 Promise 队列串行写入，确保内存状态与磁盘结果一致。

> createAgentSettingsStore 的 update 先用 validateSettings 校验输入，再把 saveSettings 挂接到 operations 链末尾；写盘成功后才替换 settings。由此避免并发更新造成旧值后写覆盖新值，也使调用方在 await operations 后读取到已持久化状态。适用于同一存储实例内的多次设置更新。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 尾随换行不额外算行

countLines 排除尾部换行产生的空片段，统计结果贴近编辑器可见行数。

> 技术决策是 countLines 通过 content.split 计算行数，并在 content.endsWith 时扣除末尾换行对应的空项；空字符串直接返回 0。该规则用于统一新增与删除文本的计量口径，防止同一份仅结尾换行不同的内容被 countTextChanges 重复统计。适用范围为快照中的可读文本文件差异计算，不用于 bytes 所表达的二进制文件大小或物理磁盘占用。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 权限判断留在快照边界

SnapshotFile 保存原始字节并可选携带文本，权限过滤由读取边界负责。

> SnapshotFile 同时记录 bytes 与可选 content，后者仅在可安全解码时提供文本比较。权限检查应在 readDirectory 读取工作区时完成，因为只有遍历边界掌握目录访问结果。该规则适用于 createAgentWorkspaceSnapshot 的文件采集及 compareAgentWorkspaceSnapshots 的后续比较，调用方不得因 content 缺失而放宽读取权限。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 存储接口内建类型守卫

RecordStoreOptions 用类型守卫约束反序列化结果。

> RecordStoreOptions 通过 validateRecord 对 unknown 值执行运行时检查，并以 value is T 类型守卫确认记录合法。根目录、项目标识、文件名和记录键由部署方配置，invalidMessage 与 missingMessage 统一错误语义。适用于 createRecordStore 的加载、查询与保存链路；各记录类型须提供校验逻辑，避免把不可信数据当作 T 使用。

适用范围：`src/extracted/agent/recordStore.ts`

### 句柄校验采用确定性规则

validateHandle 仅依据格式和保留词作出结果。

> 技术决策是 validateHandle 只依赖 HANDLE_PATTERN 与 RESERVED_HANDLES 判断句柄，不查询系统时钟、成员状态或远端服务。格式错误或命中保留词时立即抛出 Error，合法时原样返回 handle；这种纯函数式边界便于在注册、引用和解析等流程重复执行，也避免网络状态使同一输入在不同时刻得到不同结论。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 归档入口上限定为 200MB

MAX_ARCHIVE_BYTES 将单个导入归档限制为 200MB，控制解压资源风险。

> 导入流程把 MAX_ARCHIVE_BYTES 设为 200 \* 1024 \* 1024，并据此拒绝超限 ZIP。选择该上限是为了在兼容历史归档的同时限制压缩包解析所需的内存、磁盘与处理时间；它不替代 MAX_FILE_BYTES 和 MAX_TOTAL_BYTES。适用范围是 extractZipArchive 接收的单个归档，适用于服务端导入入口，不代表单个文件或全部解压内容可以突破各自限制。

适用范围：`src/extracted/archiveImport.ts`

### 统一处理条目流错误

openEntryStream 将回调式打开操作封装为 Promise，并显式传播失败。

> openEntryStream 采用 Promise\<NodeJS.ReadableStream> 封装 ZipFile.openReadStream：回调收到 error 时调用 reject 并立即返回，成功时调用 resolve 交付 stream。这样调用方可用统一的异步错误链处理条目读取失败，避免把 error 当作可读流继续消费。该决策适用于 extractZipArchive 中逐条解压流程，尤其是 openZip 已成功但条目流无法创建的场景。

适用范围：`src/extracted/archiveImport.ts`

### 配置解析不持有运行资源

loadConfig 只生成纯配置值，不创建连接、目录或后台任务。

> loadConfig 仅读取环境变量、计算默认路径并返回 ServerConfig，不创建数据库连接、监听端口、创建工作区或启动 Agent。解析过程没有需显式 close 的资源，测试可直接传入 NodeJS.ProcessEnv 验证结果。资源初始化应由服务端启动编排负责，启动失败时按所有权释放；新增配置项时不得在 loadConfig 内加入副作用，以保持配置阶段可重复调用且无清理负担。

适用范围：`src/extracted/config.ts`

### 设置更新先校验后串行提交

未知输入经校验进入串行写队列，失败不更新内存状态。

> 技术决策：createAgentSettingsStore 的 update 先调用 validateSettings 检查 input，再将 saveSettings 接到 operations 链末尾；只有持久化完成后才替换 settings。这样可阻止无效输入进入存储，并让并发更新按提交顺序执行，避免后发更新因较早写入未完成而覆盖它。适用于 AgentSettingsStore 的更新接口及多调用方并发提交场景。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 设置文件实行严格校验

版本、提供方、模型和启用状态均需合法

> validateSettingsFile 只接受 version 为 1、provider 为 deepseek、model 为非空字符串、enabled 为布尔值的 AgentSettingsFile；任一条件不满足便抛出 Error。严格拒绝可防止格式异常或不受支持的配置进入 AgentSettingsStore，适用于 loadSettings 读取现存设置文件以及保存结果的完整校验流程。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 运行时拒绝配置文件中的密钥

validateSettings 仅接受 deepseek 配置，并禁止 apiKey 进入设置文件。

> 决策：validateSettings 对未知输入先确认其为对象，再拒绝 apiKey；provider 只允许 deepseek，model 必须是非空字符串，enabled 必须是 boolean，输出时统一裁剪 model。该边界适用于从磁盘载入的 AgentSettings：凭据由服务端环境提供，文件只保存运行参数；缺字段或类型不符时直接抛出 Error，避免以不完整配置启动 Agent。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 成员入库后再加入房间

成员写入必须先于房间登记，保证两个状态域具有一致的写入次序。

> registerCollaborationRoutes 的成员创建流程固定为先 await members.join，再调用 runtime.rooms.joinRoom，最后返回 roomMember 与 participant。先落 MemberStore 可确保持久成员已存在时房间才接收该成员，避免房间出现无法查询的孤立成员。若 joinRoom 失败，后续补偿应按 memberId 清理已写入成员；该规则适用于成员加入接口及其重试逻辑。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 重试交由客户端按资源判定

路由返回资源结果以支持客户端幂等重试，不在服务端隐式重复执行。

> registerCollaborationRoutes 的成员接口通过 members.join 与 runtime.rooms.joinRoom 返回 member 和 participant，使客户端能够用 memberId、connectionId 或消息标识确认执行结果。服务端没有在该路由内为失败请求自动重试成员加入、离线或消息处理，因为重复写入可能产生重复房间成员或重复副作用。采用该模式时，重试方需携带稳定资源标识，并在超时后先查询现有状态再决定是否再次提交。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 桥接消息按先取消后创建执行

新提及到达时先取消同 Agent 的活动任务，再建立后续运行。

> 决策：createChatAgentBridge 在识别 mentions 后，只处理首个有效 handle；发现同一 agent 存在 running 或 queued 的 activeRun 时，先 await cancelRun，再由 createRun 建立新运行，避免两个任务同时修改会话。历史 agentRuns 仅用于构造 buildDiscussion 的上下文，不直接恢复执行。适用于同一项目内成员通过聊天 @Agent 触发或打断任务的场景；其他 Agent 或非提及消息不进入该流程。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 运行记录工厂采用存储副本

createAgentRunStore 返回独立包装对象，更新时保留原始标识。

> createAgentRunStore 不直接暴露 records，而是返回含 create、get、list、update 的 AgentRunStore 包装，调用方须通过固定入口操作 AgentRun 记录。update 使用 current 与 update 合并，并重新写入 current.id，避免调用方借更新参数改写记录身份，适用于所有基于 createAgentRunStore 创建的运行记录存储实例。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 目录列表采用整批失败语义

listWorkspaceDirectory 任一子项读取失败时不返回部分目录结果

> listWorkspaceDirectory 先通过 resolveWorkspacePath 定位目标目录，再用 fs.readdir 配合 withFileTypes 获取条目；过滤 isIgnoredPath 后执行 sort 和 map，并用 Promise.all 组装 WorkspaceNode。该决策让目录快照保持整体一致：任一子项处理失败会直接拒绝，不会把已转换的 nodes 作为部分结果交给调用方。排序固定为目录优先、同类名称按 localeCompare，适用于工作区目录枚举及依赖完整快照的 Agent 操作。

适用范围：`src/extracted/workspace.ts`

## 约束

### 导出文件使用私有权限

导出 JSON 文件创建时使用 0600 权限

> 导出 JSON 文件创建时使用 0600 权限。已有文件也需要保持相同权限。该规则适用于本地数据。

适用范围：`src/extracted/jsonFile.ts`

### 聊天文本先经过敏感信息处理

聊天正文写入文件前需要调用敏感信息处理函数

> 聊天正文写入文件前需要调用敏感信息处理函数。事件记录使用处理后的文本。这个规则适用于新消息。

适用范围：`src/extracted/chat.ts`

### 临时导出文件使用唯一名称

导出临时文件名称包含随机后缀，避免并发覆盖

> 导出临时文件名称包含随机后缀，避免并发覆盖。完成后再替换目标文件。该规则适用于文件写入。

适用范围：`src/extracted/jsonFile.ts`

### 事件 payload 使用对象结构

事件 payload 保持对象结构，导出时不把它转换为字符串

> 事件 payload 保持对象结构，导出时不把它转换为字符串。调用方可以继续读取字段。该规则适用于报告。

适用范围：`src/extracted/eventLog.ts`

### run 权限入口接收资源信息

run 权限调用提供 Action 和资源对象

> run 权限调用提供 Action 和资源对象。资源对象保留 projectId 与 ownerMemberId，便于权限策略统一处理。该记录说明 run 权限调用参数。

适用范围：`src/extracted/auth/permissions.ts`

### 快照差异按稳定路径排序

工作区差异输出必须使用确定路径顺序。

> compareAgentWorkspaceSnapshots 应合并 before 与 after 的键后按路径排序，再逐项生成 AgentFileChange。原因是调用方需要稳定、可重复审阅的差异列表，不能依赖 Map 的插入顺序；该规则适用于新增、删除、修改以及二进制内容变化的统一比较输出。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 上下文文件必须为受限文本

buildRuntimePrompt 拒绝非文本或超过 1 MB 的工作区文件。

> buildRuntimePrompt 读取 AgentPromptContext.path 后，仅接受 readWorkspaceFile 返回 status 为 text 且大小符合限制的结果，否则抛出 Error。该约束适用于运行时提示词构建；非文本资源和超限文件都不得进入 prompt，以控制上下文类型和体积。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 团队别名避开保留词

常用团队指代不得注册为成员别名。

> RESERVED_HANDLES 集中列出 system、all、here、everyone，团队别名创建前必须避开这些名称。原因是这些词承担广播或语义化指代功能，若同时成为成员标识，parseMentions 可能把普通提及解释为团队范围操作；该约束适用于 normalizeHandle、validateHandle 及团队成员注册流程。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### AgentRunStore 跟随工厂类型

AgentRunStore 必须从 createAgentRunStore 的返回结果推导。

> AgentRunStore 不单独维护手写接口，而采用 ReturnType<typeof createAgentRunStore>。这样工厂新增或调整返回值时，调用方类型会同步变化，避免声明与实际存储行为分叉；适用范围为 agentRunStore 的公开类型引用，修改 createAgentRunStore 后需确认现有 AgentRunStore 使用处仍能通过类型检查。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 工作区变更优先合并

mergeFileChanges 合并同名文件时保留工作区条目，并采用运行时 patch。

> mergeFileChanges 处理批量变更时，先以 workspaceChanges 建立文件顺序和条目，再按 file 从 runtimeChanges 覆盖 patch；仅存在于运行时的变更追加到结果末尾。这样可保留工作区记录的业务含义，同时避免同一路径出现重复条目，适用于 AgentRun.fileChanges 的合并。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 记录加载强校验

createRecordStore 的 load 校验版本、记录结构、项目和目录标识。

> createRecordStore 内部的 load 只接受目录型条目，并从 options.fileName 读取 JSON。任何记录的 version 不等于 1、validateRecord 校验失败、projectId 不匹配或 id 与目录名不一致，都应抛出 options.invalidMessage；校验通过后才写入 records，适用于存储根目录中的全部记录。

适用范围：`src/extracted/agent/recordStore.ts`

### 目录不存在按空列表处理

readDirectory 将 ENOENT 视为空目录，其他读取错误继续抛出。

> readDirectory(directoryPath) 捕获 ENOENT 时返回空数组，但不得吞掉权限、文件系统等其他错误。原因是首次访问尚无目录与读取失败具有不同含义，统一返回空数组会掩盖真实故障。该规则适用于 createRecordStore 扫描记录目录的读取阶段。

适用范围：`src/extracted/agent/recordStore.ts`

### 入房标识按稳定优先级归一

normalizeJoinInput统一参与者标识与连接标识的来源。

> normalizeJoinInput依次采用participantId、connectionId，或human:${name}生成participantId，connectionId缺省时回退到participantId，profileRole原样保留。createRoomStore接收JoinRoomInput时据此形成NormalizedJoinInput，避免同一成员因请求字段差异被识别为多个参与者。

适用范围：`src/extracted/rooms.ts`

### 桥接工厂类型须可重建

ChatAgentBridge 类型直接由工厂推导，测试夹具应使用同一创建入口。

> ChatAgentBridge 必须保持为 createChatAgentBridge 的 ReturnType，测试夹具也通过该工厂创建实例，避免手写结构后与 buildDiscussion 的依赖漂移。这样可让桥接调用在单元测试和生产环境保持一致，适用范围为 ChatAgentBridge 构造及替换测试依赖的场景。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

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

### 成员读取兼容旧版名单

成员文件缺失时读取 participants.json，并转换旧参与者字段。

> createMemberStore 的 loadFile 在 members.json 不存在时读取 participants.json，再把 id、displayName、profileRole 映射为 memberId、displayName、role。兼容转换可让旧项目继续提供成员查询，适用范围是 createMemberStore 读取存量项目成员数据的流程。

适用范围：`src/extracted/auth/identity.ts`

### 成员写操作须串行排队

createMemberStore通过enqueue限制成员写入并发，避免状态覆盖。

> createMemberStore产生的成员写操作必须交给enqueue串行执行，不得让多个调用直接并行修改MemberStore。enqueue以operations承接前序Promise，即使前一次失败也继续后续队列。这样可避免两次成员变更基于同一旧状态写回并丢失记录，适用于成员新增、角色更新等写路径；只读请求无需进入该队列。

适用范围：`src/extracted/auth/identity.ts`

### 工作区成员先校验归属

访问工作区成员前，先按房间与成员编号查询归属记录。

> 调用 requireMember 时，应通过 ProjectRuntime.rooms.getMember 同时核对 runtime.room.id 与 memberId，查询失败即抛出 Error，避免把其他房间或已移除的成员当作有效参与者。该约束用于 registerWorkspaceRoutes 处理工作区请求的成员身份阶段。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 注册表结构须完整合法

loadRegistry 拒绝缺字段或版本不符的项目注册表。

> loadRegistry 读取 registryPath 后，必须确认 parsed.version 为 1 且 parsed.projects 是数组，否则抛出 Error；文件不存在时返回 version 1 和空 projects。这能隔离损坏或旧格式数据，防止后续迁移误判；适用范围为项目注册表加载，不放宽 RegistryFile 的既有结构。

适用范围：`src/extracted/projects.ts`

### 目录项类型保持稳定

工作区目录清单仅输出节点类型、路径与名称。

> listWorkspaceDirectory 返回的 WorkspaceNode 只保留 name、path、type，目录项 type 为 directory，文件项 type 为 file。调用方据此区分节点并定位资源，因此调整该函数时不要加入大小、修改时间或访问权限等易变字段；新增字段必须先确认不会破坏既有反序列化与排序。

适用范围：`src/extracted/workspace.ts`

### 写文件前自动创建父目录

writeWorkspaceFile 支持写入尚无父目录的新文件。

> writeWorkspaceFile 在写入前以 mkdir 的 recursive 选项创建 absolutePath 对应的父目录，再以 utf8 写入 content。该约定避免调用方为每个新文件重复构造目录层级，适用于工作区文件创建和覆盖写入；实现时仍需通过 resolveWorkspacePath 限制写入范围。

适用范围：`src/extracted/workspace.ts`

### 路径探测仅吞掉不存在错误

pathExists 只将 ENOENT 转换为 false。

> pathExists 对 ENOENT 返回 false，对权限不足等其他 stat 失败继续抛出原始 error。统一吞掉异常会掩盖真实存储故障，因此该行为适用于所有依赖 pathExists 判断工作区路径是否可用的调用方。

适用范围：`src/extracted/workspace.ts`

### 提及解析须过滤无效候选

parseMentions 只返回候选集合中有效且不重复的句柄。

> parseMentions 解析文本后，应先核对 candidates，并用 seen 排除重复句柄；无效或不存在的句柄不得进入 mentions。该约束适用于团队 Agent 的提及提取，目的是避免无效通知和重复通知。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 活动任务限制设置变更

Agent 有活动任务时禁止修改模型或启用状态

> registerAgentRoutes 更新 AgentSettingsStore 前必须调用 agentRuns.hasActiveTasks()；存在活动任务且 model 或 enabled 与当前设置不同时，应拒绝更新并交给错误处理。这样可避免运行中的任务使用不一致的 Agent 配置，适用范围为 Agent 设置写接口。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 成员路径不得暴露可变引用

成员存储应返回路径值，不把项目对象交给调用方继续修改。

> createMemberStore 中的 projectDataPath 只应返回 getProjectMetadataPath 生成的路径值，不应返回 ProjectRecord 本体或由其派生的可变对象。这样可让调用方获得定位文件所需的信息，同时避免意外改写项目元数据；该约束适用于成员数据文件的路径计算和调用方使用阶段。

适用范围：`src/extracted/auth/identity.ts`

### 成员文件沿用项目元数据目录

projectDataPath 统一从项目元数据路径派生成员存储位置。

> createMemberStore 处理项目成员文件时，必须让 projectDataPath 调用 getProjectMetadataPath 生成目录，不要另设独立根目录或按展示名称推导路径。该规则适用于成员文件的新增、读取和迁移，可避免同一项目的数据被分散到不同位置。

适用范围：`src/extracted/auth/identity.ts`

### 成员路径缺失即报错

projectDataPath 遇到无元数据的项目时应明确失败，不生成猜测路径。

> createMemberStore 计算成员文件位置时，projectDataPath 应验证传入 ProjectRecord 能否由 getProjectMetadataPath 得到有效结果；缺少必要元数据时应立即抛出 Error，而不是返回空路径或拼接兜底目录。该规则适用于成员存储初始化及后续成员文件定位，可防止错误记录被写入错误位置。

适用范围：`src/extracted/auth/identity.ts`

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

### 存储类型跟随工厂演进

AgentSessionStore 由工厂返回类型自动推导，避免接口副本漂移。

> AgentSessionStore 使用 ReturnType<typeof createAgentSessionStore> 定义，不再手工声明 create、get、list、findByHandle、update 的签名。这样新增或调整工厂方法时，公开类型会同步反映真实返回值，减少类型定义与实现不一致的风险。该规则适用于 createAgentSessionStore 暴露的存储契约；若需独立演进公共 API，再单独引入稳定接口，而不是复制当前推断结构。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### ZIP 条目需通过双重校验

validateEntry 同时约束路径形态与条目类型，阻断越界写入及特殊文件。

> extractZipArchive 必须先调用 validateEntry：entry.fileName 不得包含反斜杠、绝对路径、盘符前缀或 .. 路径段；externalFileAttributes 解析出的 fileType 只允许普通文件或目录。原因是路径穿越可能写出 destination，符号链接等条目也可能把解压结果导向非预期对象。该约束适用于所有 ZIP 条目；resolveArchivePath 的目录检查只能作为第二道边界，不能替代 validateEntry。

适用范围：`src/extracted/archiveImport.ts`

### 句柄校验错误保持稳定

validateHandle 对非法句柄采用统一 Error，便于调用方定位输入问题。

> 团队约定 validateHandle 对不满足 HANDLE_PATTERN 或命中 RESERVED_HANDLES 的输入统一抛出 Error，并返回原文句柄表示通过。调用方可以据此区分成功与拒绝，但不得依赖错误文案识别具体失败条件。该约定适用于 Team Agent 句柄的新增、更新及任何需要确保句柄可直接用于 @ 提及的场景。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

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

### 项目路径统一由元数据函数解析

成员存储访问项目数据时只使用 projectDataPath 返回的路径，禁止自行拼接目录。

> 约束：createMemberStore 内部需要定位项目数据时，必须调用 projectDataPath，并把其返回值作为后续读取或写入目标；不要依据项目名称自行拼接路径。projectDataPath 固定委托 getProjectMetadataPath 解析，使 MemberStore 与项目元数据布局保持一致，避免目录规则变化后成员文件读取和保存指向错误位置。该规则适用于 createMemberStore 管理的项目级成员数据，不覆盖成员运行态身份的解析。

适用范围：`src/extracted/auth/identity.ts`

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

### 会话存储按项目缓存

同一项目复用会话存储实例，项目不存在时立即报错。

> createAgentRunManager 内的 getSessionStore 按 projectId 缓存并复用 createAgentSessionStore，避免生成多个会话状态源，确保活动写入与运行恢复数据一致。options.registry 找不到项目时抛出 Error，适用于所有按 projectId 访问会话存储的调用路径。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 项目队列初始化保持原子

getQueue 一次创建并登记 ProjectQueue，避免半初始化和重复队列。

> getQueue 为未缓存的 projectId 创建包含空 runIds 与 processing=false 的 ProjectQueue，并立即写入 queues 后返回。后续入队与 processQueue 必须依赖同一对象，否则并发调用可能产生两个实例，导致重复消费或状态分裂。该规则适用于 AgentRunManager 的排队、启动和取消流程，新建队列时须同步初始化 runIds 与 processing。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 列表调用必须等待完成

AgentRunStore.list 返回 Promise，调用方不得把结果当数组。

> AgentRunStore 是 createAgentRunStore 返回结构的类型别名，其中 list 被声明为 async，内部通过 await records.list() 读取记录后再按 createdAt 排序。因此 list 返回 Promise，而不是直接给出 AgentRun\[]；调用方必须 await 后再读取、筛选或排序，否则会把 Promise 当成数组，导致错误结果或运行时异常。该约束适用于列表接口、控制器返回链路、测试断言及任何封装 AgentRunStore 的辅助函数。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 列表排序不修改持久化顺序

createAgentRunStore 仅排序读取结果，不改写 run.json。

> createAgentRunStore 的 get 直接映射 records.get，list 将 records.list() 返回数组按 createdAt 降序在内存副本上重排，不影响单条 update 的落盘内容。批量接口要求固定分页、游标或最近运行优先时，应在 AgentRunStore.list 结果上显式定义边界，不能依赖 createRecordStore 的原始遍历顺序，单项读取与批量列表需分别验证。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 运行时提示锁定项目工作区

buildRuntimePrompt 限定文件范围，并只嵌入可读取的文本上下文。

> buildRuntimePrompt 在 scope 中固定 projectName 与 workspacePath，明确禁止 Agent 检视父目录或父仓库。传入 contexts 时，函数逐项调用 readWorkspaceFile；只有 status 为 text 才把 content 包装进带路径边界标记的 sections，否则抛出 Error，要求文件是小于 1 MB 的文本。该边界适用于构建项目协作 Agent 的运行时提示，禁止将工作区外文件直接拼入 prompt。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 运行接口须支持幂等重试

AgentRuntime 的操作需按会话与工作区设计重试语义。

> 团队约定：调用 AgentRuntime 时，把 createSession、run、getDiff、cancel 和 dispose 视为可重试的异步操作；重试必须沿用原 workspacePath 与 sessionId，并依据 messageId 区分同一轮结果，避免重复创建会话或重复执行 prompt。原因是网络中断不代表任务未完成，直接重放可能造成重复消息、重复变更或重复取消。适用范围为 AgentRuntime 及其所有实现方，尤其是基于 subscribe 接收 AgentRuntimeEvent 的协作流程。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 迁移写入必须逐项等待

会话创建和运行更新均串行 await，防止并发迁移导致关联错乱。

> migrateLegacyAgentSessions 对 sessionStore.create、sessionStore.update 和 runStore.update 逐项使用 await，完成前不推进下一次写入。旧 AgentRunStore 数据补建会话时须确保 sessionId 写回 runStore 前目标会话已创建；并发批处理会使失败重试和运行记录关联难以保持确定顺序。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 批量迁移保留既有会话

批量入口先复用已存在会话，只有缺失关联的 run 才进入创建路径。

> migrateLegacyAgentSessions 在批量遍历 runs 时，先检查 run.sessionId 对应的会话是否存在；存在便执行 continue，不覆盖原有会话关系。只有 sessionId 缺失或目标记录不存在时，才依据 memberId 与 legacyRuntimeSessionId 创建新会话并回写 runStore。该规则适用于历史 AgentRunStore 批量迁移，可避免已有会话被重复创建或替换。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 设置文件只接受版本一

历史设置文件须通过严格结构校验，否则拒绝加载。

> validateSettingsFile 只接纳 version 为 1、provider 为 deepseek 的 AgentSettingsFile，并要求 model 是去除空白后非空的 string，enabled 必须是 boolean；任一条件不符即抛出 Error。这样可阻止旧版本或结构异常的历史数据进入 AgentSettingsStore，避免迁移后按错误格式运行。适用于读取和迁移 R2 落盘的 Agent 设置文件，不适用于运行时通过 validateSettings 接收的调用参数。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 密钥禁止由调用方传入

跨模块设置调用须走环境密钥，并校验必要字段。

> validateSettings 接收 unknown 后先确认对象，再显式拒绝包含 apiKey 的输入，要求 provider 为 deepseek、model 为非空 string、enabled 为 boolean，并返回 trim 后的模型配置。API Key 必须由服务端环境提供，调用方不能注入或覆盖。该约定适用于 createAgentSettingsStore 暴露的设置更新路径，可降低密钥进入日志、配置文件和参数链路的风险。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 版本字段预留冲突识别

设置文件固定携带版本号，为并发覆盖和格式演进留出判断依据。

> AgentSettingsFile 固定使用 version: 1 包裹 settings。读取端由 validateSettingsFile 拒绝非 1 版本，以便后续升级时区分旧数据并执行迁移，避免将不同结构按同一格式解析。该约束适用于设置文件的持久化与加载；并发写入方仍须先读取当前 version，再决定是否允许覆盖，不能仅凭固定版本解决写竞争。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### Agent 设置选项边界约定

Agent 设置存储须显式提供路径、默认模型和密钥配置状态。

> 创建 Agent 设置存储时，AgentSettingsStoreOptions 必须包含非空 storagePath、有效 defaultModel 和明确布尔值 apiKeyConfigured，以区分未配置密钥与已配置但不落盘。该约定适用于 createAgentSettingsStore 的所有调用方，不得用空集合替代必需选项。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 快照只遍历指定工作区

文件采集以 workspacePath 为唯一根目录，仅递归工作区内部目录，防止相对路径扩展读取范围。

> createAgentWorkspaceSnapshot 必须以传入的 workspacePath 为唯一根目录，通过 readDirectory 从空相对路径收集文件。递归只能沿工作区内部目录项继续，不得按文件内容拼接新根或扩展扫描起点。此规则限定 Agent 工作区边界、降低越权读取风险，并保证 AgentWorkspaceSnapshot 的路径键来源一致。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 目录读取必须等待递归完成

readDirectory 串行等待子目录和文件读取，防止快照缺项。

> readDirectory 用 await readdir 获取条目，遇目录递归调用自身并等待完成，遇普通文件用 await readFile 后写入 AgentWorkspaceSnapshot。遍历须串行等待，未完成时不得创建快照，否则可能遗漏晚写入条目。路径由 path.join 与 path.posix.join 构造，isIgnoredPath 命中的路径不进入快照。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 取消旧任务再启动新任务

新提及必须先取消同一 Agent 的活动任务，避免运行状态重叠。

> createChatAgentBridge 在处理提及时只选择 mentions\[0] 作为目标 Agent，并从 agentRuns 中查找状态为 running 或 queued 的 activeRun。存在活动任务时，先通过 cancelRun 将其终止，再创建带 interruptsRunId 的后续任务，并写入 kind 为 system 的中断消息。这样可防止同一会话并发执行造成提示混乱；规则适用于 createChatAgentBridge 的 handleMessage 流程及 AgentRunManager 已提供取消能力的项目。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 运行时对象按项目解析

桥接调用必须经依赖管理器取得项目和团队数据，不绕过模块边界。

> createChatAgentBridge 仅接收 AgentRunManager 与 ProjectRuntimeManager，并通过 runtimeManager.get(projectId)、agentRuns.listTeamAgents(projectId) 和 agentRuns.listRuns(projectId) 解析业务上下文。调用方不得直接拼接项目运行时或绕过管理器读取任务，因为项目隔离、团队 Agent 范围和运行记录都需要由各自模块维护。该约定适用于 handleMessage 处理项目聊天、识别提及及创建 Agent 任务的跨模块链路。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 同一Agent运行串行化

触发新任务前取消同一Agent的运行中或排队任务，避免并发导致版本冲突。

> createChatAgentBridge按sessionId筛选目标Agent的activeRun，状态为running或queued时先调用cancelRun，再创建后续任务，并写入kind为system的中断消息记录被中断任务及发起成员。同一项目、同一Agent收到新指令时适用；系统消息携带agentSessionId和runId，可用于追踪取消、接管与版本衔接。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 加载入口统一收敛

权限与初始化检查集中在 ensureLoaded 首次加载路径。

> 团队约定把记录读取前的初始化、权限校验和目录扫描统一收口到 createRecordStore 返回的 ensureLoaded。调用方先等待 loading 对应的 load 完成，再读取项目记录，避免并发请求绕过检查或拿到未初始化状态。该规则适用于 RecordStoreOptions 配置下的记录查询、目录枚举及任何依赖完整加载结果的流程；新增入口不得另建加载路径。

适用范围：`src/extracted/agent/recordStore.ts`

### 保存路径限定根目录

save 用 record.id 构造记录路径，调用方须校验标识符。

> 团队约束要求 save 只能按 options.root、record.id、options.fileName 组合目标文件，并将记录封装为 version 与 recordKey 对应内容后原子写入。由于 record.id 会直接参与 path.join，任何包含路径分隔符、上级目录片段或越界前缀的值都可能把写入位置带离 options.root。适用于所有基于 createRecordStore 的持久化调用；接收外部标识符时必须先验证其可作为单层目录名使用。

适用范围：`src/extracted/agent/recordStore.ts`

### 事件监听须受控等待

AgentRuntime 订阅回调允许异步执行，调用方需控制队列与等待边界。

> AgentRuntime.subscribe 的 listener 可返回 Promise<void>，因此回调可能尚未完成时调用方就继续推进运行控制流程。订阅适配器应按自身队列策略串行或限并发处理回调，不能把返回取消函数当作同步完成的信号；事件密集阶段还需避免无界积压。该规则适用于 AgentRuntime 事件桥接、取消流程和 dispose 收尾，尤其涉及 listener 的异步失败处理。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 会话列表按更新顺序呈现

列表先完成可见性筛选，再按 updatedAt 倒序返回。

> 调用 createAgentSessionStore 返回的 list 时，必须先按 scope 与 memberId 筛选，再按 updatedAt 的 localeCompare 结果降序排列。这样调用方无需自行排序，页面也能稳定展示最近更新的会话；该规则适用于所有读取会话列表的 Agent 协作流程，不改变单条记录的查询语义。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 限制归档总量至 200MB

单个 ZIP 的输入体积上限固定为 200MB，控制导入资源消耗。

> MAX_ARCHIVE_BYTES 固定为 200 \* 1024 \* 1024，表示一次 ZIP 归档允许占用的最大字节数。extractZipArchive 应在读取归档内容前执行该上限检查，以限制内存、磁盘和流处理资源被超大输入持续占用。此约束适用于单个导入归档，不等同于条目大小限制；迁移或调整限制时需同时评估 MAX_FILE_BYTES 与 MAX_TOTAL_BYTES 的组合效果。

适用范围：`src/extracted/archiveImport.ts`

### 单文件上限为128MB

归档内单个普通文件不得超过128MB，避免异常条目占用过多资源。

> MAX_FILE_BYTES设为128 \* 1024 \* 1024，extractZipArchive校验Entry时拒绝超限文件。该规则只限制单文件，不能替代MAX_ARCHIVE_BYTES对归档大小的限制和MAX_TOTAL_BYTES对累计解压量的限制，适用于readEntries发现的普通文件。

适用范围：`src/extracted/archiveImport.ts`

### 归档解压总量上限

extractZipArchive 以 1 GiB 为解压总量硬上限，超限即拒绝处理。

> 团队约定所有通过 extractZipArchive 导入的 ZIP 归档，解压后累计数据不得超过 MAX_TOTAL_BYTES，即 1 GiB。该限制与 MAX_ARCHIVE_BYTES 的压缩包体积限制、MAX_FILE_BYTES 的单文件限制分别执行，不能互相替代。原因是压缩包可能包含高压缩比或大量小文件，压缩体积与解压规模差异很大；只有约束累计输出，才能控制内存、磁盘和执行时间。适用于项目、成员、聊天、房间、事件日志、trace、工作区等 R2 协作数据的归档导入流程；调用方不得通过拆分批次规避该上限。

适用范围：`src/extracted/archiveImport.ts`

### 存储类型只暴露工厂返回值

AgentSessionStore 不额外承诺对象可变性或独立副本语义。

> AgentSessionStore 仅由 createAgentSessionStore 的返回值推导，类型层面不会保证 get 或 list 返回的 AgentSession 已被复制并隔离修改。调用方若要变更查询结果中的字段，应通过 update 提交变更，而不是直接修改对象；该规则适用于所有持有 AgentSessionStore 返回数据的业务代码。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 事件发布先写后通知

运行状态必须先落地，再通过订阅通知观察者。

> AgentRuntime 的事件发布顺序应固定为：先提交对应运行状态，再调用 subscribe 注册的 listener；发布失败不得回滚已经提交的状态，也不得谎报事件投递成功。原因是监听者通常在收到通知后立即查询状态，若先通知后写入，观察者会读到旧数据。适用范围涵盖 run、cancel、prepareRun 等会产生可观察变化的运行时操作。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 身份缺失直接返回 401

requireIdentity 在缺少 request.identity 时终止请求，并统一返回 401 身份错误。

> 团队约定：需要成员身份的服务端入口必须先调用 requireIdentity(request, response)；当 request.identity 不存在时，函数通过 response.status(401).json 返回“Member identity is required”，并以 undefined 阻止后续业务继续执行。采用该规则可让未认证请求在进入成员、聊天或房间处理前得到一致响应，避免空身份沿调用链传播。适用范围是要求 Member 身份的请求，不适用于匿名端点。

适用范围：`src/extracted/auth/permissions.ts`

### 会话存储接口由工厂推导

AgentSessionStore 直接绑定工厂返回能力，避免接口与实现脱节。

> 团队约定使用 `ReturnType<typeof createAgentSessionStore>` 定义 `AgentSessionStore`，让存储接口随工厂能力自动变化，而不是手工重复声明方法签名。这样新增或调整 `createAgentSessionStore` 的公开能力时，调用方仍能获得一致类型。适用范围是 R2 中通过该工厂创建会话存储的模块；涉及代理会话创建、查询与更新时，以推导出的类型为准。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 保留名不得成为句柄

RESERVED_HANDLES 阻止群体指令式名称占用成员句柄。

> 团队约定 system、all、here、everyone 属于 RESERVED_HANDLES，任何成员句柄都不能采用这些名称。该限制避免解析 @ 文本时把群体范围语义与具体成员混为一谈，也减少广播操作中的歧义。适用范围包括 Team Agent 的创建、句柄更新、候选成员生成，以及解析前后的标识检查。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 存储选项按契约注入

创建设置存储时显式提供路径、默认模型和凭据状态。

> 团队约束：调用 createAgentSettingsStore 前，必须提供 AgentSettingsStoreOptions 中的 storagePath、defaultModel 与 apiKeyConfigured。三个值分别决定设置文件位置、缺省模型以及运行态凭据状态，store 不自行猜测环境配置。适用于 AgentSettingsStore 的创建入口；缺项会在 TypeScript 类型检查或参数校验阶段暴露。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 环境变量须在启动时校验

loadConfig 统一转换并校验环境变量，阻止无效配置进入运行期。

> loadConfig 在服务端启动阶段统一读取并校验 PORT、SIMPLERCP_DATA_DIR、SIMPLERCP_PUBLIC_URL、DEEPSEEK_BASE_URL、SIMPLERCP_OPENCODE_PORT 与 SIMPLERCP_AGENT_RUN_TIMEOUT_MS；端口必须是 1 至 65535 的整数，目录必须是绝对路径，URL 只允许 http 或 https 协议。这样可让错误在连接资源前暴露，并避免把相对路径、非法协议或越界端口带入 ServerConfig。规则适用于 R2 的默认启动、测试环境注入以及所有通过 loadConfig 创建的配置。

适用范围：`src/extracted/config.ts`

### 仓库根目录按模块定位

defaultRepositoryRoot 根据模块 URL 定位仓库根目录，避免依赖启动工作目录。

> defaultRepositoryRoot 使用 fileURLToPath 和 import.meta.url 从 config.ts 所在位置向上解析仓库根目录，不依赖 process.cwd。这样 loadConfig 的默认数据目录、demoProjectRoot 等派生路径在不同启动目录下仍保持一致。调整模块目录层级时须同步检查相对定位，该规则适用于 R2 仓库的默认路径计算。

适用范围：`src/extracted/config.ts`

### 布尔环境变量只接受精确值

readBoolean 严格解析 true 和 false，其他字符串立即报错。

> 调用 loadConfig 时，环境变量布尔值统一交给 readBoolean 处理：未提供时返回 defaultValue，明确等于 "true" 或 "false" 时才转换为对应布尔值，其他非空字符串抛出 Error。这样可避免把 "1"、"TRUE" 或带空格的值误判为有效配置，并让部署错误尽早暴露。该规则适用于 ServerConfig 中所有需要布尔语义的配置项。

适用范围：`src/extracted/config.ts`

### loadEvents 先校验再合并

loadEvents 仅接受版本与事件结构合法的 EventFile，失败时中止恢复。

> loadEvents 读取 storagePath 后先检查 EventFile.version 是否为 1、events 是否为数组，并验证每条事件的 id、type 与 timestamp 均为字符串；任一条件不满足就抛出 Error，而不是跳过坏记录。原因是部分合并会掩盖损坏状态并造成重放顺序不一致。该约束适用于所有从存储路径恢复事件的流程，文件不存在则允许返回。

适用范围：`src/extracted/eventLog.ts`

### 缺失配置采用默认值

设置文件不存在时加载固定默认配置

> loadSettings 在读取 storagePath 未得到配置时，返回 provider 为 deepseek、model 使用 defaultModel 且 enabled 为 true 的 AgentSettings；文件存在时则先调用 validateSettingsFile，再取其中的 settings。这样能让首次启动无需预先准备文件，同时确保已有配置必须通过版本和字段校验后才进入 AgentSettingsStore。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 初始化后校验项目目录

初始化会迁移旧项目并补建 demo，调用方仍需处理工作区缺失。

> 调用 `createProjectRegistry` 初始化后，必须通过其 `listProjects` 获取当前项目，而不是直接信任初始化前的 registry。原因是该函数会执行 `migrateLegacyProjects`，并在缺少 demo 时调用 `createDemoProject`；后续 `listProjects` 还会删除工作区已丢失的普通项目并重建 demo。适用范围是 R2 服务端启动、项目列表展示和 registry 恢复流程。

适用范围：`src/extracted/projects.ts`

### 注册表类型跟随工厂

\`ProjectRegistry\` 从工厂返回值推导，接口变化必须同步检查调用方。

> `ProjectRegistry` 必须保持为 `Awaited<ReturnType<typeof createProjectRegistry>>`，不要另建手写接口，以便工厂返回的方法与状态变化时类型自动跟随，避免声明和实现漂移。适用于 `src/extracted/projects.ts` 及导入 `ProjectRegistry` 的服务端代码；工厂返回契约发生破坏性变化时，应集中评估所有调用方。

适用范围：`src/extracted/projects.ts`

### 项目名执行规范化与查重

项目名先 trim，再校验长度和大小写不敏感的唯一性。

> validateProjectName 先对 name 执行 trim，空白名称直接抛出 Error，长度不得超过 100 个字符，并与 projects 中已有 ProjectRecord.name 做大小写不敏感比较。返回的 normalized 才是可用项目名，可阻止空格差异或大小写差异绕过重名限制；该规则适用于创建和重命名项目时的注册表校验。

适用范围：`src/extracted/projects.ts`

### 连接按 ID 原地更新

同一 connection.id 执行覆盖更新，新连接才追加到 connections。

> upsertConnection 先按 connection.id 查找 room.connections，命中后用 Object.assign 原地覆盖 existing，未命中才用 push 追加，以保留 RoomState 中连接数组的引用语义，让房间观察者看到同一连接对象的状态变化。适用于连接重连、状态同步和在线信息更新；不得另建同 ID 的并行连接条目，也不得依赖数组元素位置标识连接。

适用范围：`src/extracted/rooms.ts`

### 成员在线态按连接重算

成员在线数、在线标记和最近活动时间统一由连接集合派生。

> syncMemberFromConnections 从 room.connections 筛选 participantId 对应记录，再以 onlineConnections.length 重算 member.connectionCount 与 member.online；lastSeenAt 取全部连接中的最大值，缺失时使用 fallbackLastSeenAt。这样可避免单项连接更新后成员汇总字段与底层连接状态不一致。该规则适用于成员连接集合发生新增、离线或时间刷新后的同步；批量路径和单项路径都必须最终调用同一汇总逻辑。

适用范围：`src/extracted/rooms.ts`

### 重名后缀按成员顺序生成

displayName 依据当前成员遍历顺序为重名成员追加序号。

> refreshDisplayNames 用 Map 统计 room.members 中相同 name 的次数，首个保留原名，后续使用“名称 #序号”。计数仅在本次调用内创建，相同 members 输入顺序可复现结果，适用于成员加入或改名后的展示名刷新。测试夹具应固定成员顺序；稳定身份应使用 participantId，不能把 displayName 当作成员键。

适用范围：`src/extracted/rooms.ts`

### 入房字段先归一化再写入

JoinRoomInput 是入房写入前的外部输入边界。

> JoinRoomInput 只描述外部提交的原始入房数据，memberId、participantId、connectionId 可缺省，而 name 必须提供。createRoomStore 处理加入请求时，先通过 normalizeJoinInput 生成 NormalizedJoinInput，确定成员、参与者与连接标识，再调用 findExistingMember、upsertConnection 或 syncMemberFromConnections 写入 RoomStore；禁止直接把可选字段传入后续更新逻辑，以免同一成员因标识缺失产生重复记录。

适用范围：`src/extracted/rooms.ts`

### Agent 写操作遵循幂等契约

创建与设置更新请求不能按普通 POST 盲目重放。

> registerAgentRoutes 对创建团队 Agent 使用 POST，因此客户端重试可能再次提交同一创建意图；接入 AgentRunManager 的 createTeamAgent 时必须结合名称、项目和既有结果识别重复请求，不能仅依赖网络超时判断失败。设置更新虽然使用 PUT，仍应把相同 model 与 enabled 的请求视为无状态变化。该约定适用于注册在 registerAgentRoutes 下的 Agent 创建和设置写入接口；若底层 createTeamAgent 没有重复检测能力，应在调用层补充幂等键或先查询结果。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 成员身份限定资源边界

项目会话查询须以成员身份约束，不能只按 projectId 放行。

> 使用 memberIdFor 时，得到的 memberId 必须作为资源访问边界的一部分，而不能仅用 projectId 查询 Agent 数据。registerAgentRoutes 中的会话列表把 projectId 与 memberId 共同传给 agentRuns.listSessions，使 AgentRunManager 能按参与者过滤结果。原因是同一项目可能包含多个成员，仅凭路径中的 projectId 无法防止成员越权查看他人的会话。该约定适用于成员级会话接口；团队级操作仍需结合 requireIdentity 或 requirePermission 判断。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 会话标识由运行时统一生成

createSession 只接收标题与工作区，会话 ID 不由调用方指定。

> AgentRuntime.createSession 的输入仅包含 workspacePath 与 title，返回值中的 id 由具体运行时生成。调用方不得在提交参数中复用或猜测会话标识，也不得假定 id 在不同工作区之间全局唯一；后续 run、getDiff、cancel 和 subscribe 均应保存并回传 createSession 返回的 id。适用于封装不同 AgentRuntime 实现以及持久化会话映射的协作模块。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 异步协作操作逐项等待

成员与消息流程显式等待异步结果，避免响应早于状态提交。

> registerCollaborationRoutes 对 members.listMembers、members.join 等 Promise 操作使用 await，结果可用后才映射成员、调用 runtime.rooms.joinRoom 或发送响应，确保响应反映已完成的成员状态，并避免将未处理的 Promise rejection 误当作成功。适用于读取成员、加入房间、消息处理和 Agent 协作链路。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 身份校验置于路由入口

需要身份的协作请求在读取或写入业务状态前先完成校验。

> registerCollaborationRoutes 中 room 查询与 connection offline 处理都先调用 requireIdentity，失败后立即返回；该顺序用于阻止未认证请求读取房间或修改连接。类似协作路由若依赖 member、message 或项目身份，应在调用 members.listMembers、members.join、runtimeManager.get 等业务方法之前完成同一入口校验。仅在响应阶段补做身份判断无法阻止状态访问，因此不适用于该模块的受保护操作。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### ZIP 上传采用二百兆硬限制

导入 ZIP 的请求体上限固定为 200mb，列表响应未设置分页上限。

> registerProjectRoutes 为 /api/projects/import-zip 配置 express.raw({ type: "application/zip", limit: "200mb" })，超过该阈值的归档会在进入 importZip 前被拒绝。与此同时，GET /api/projects 直接返回 registry.listProjects 的完整 projects 数组，没有分页或条数截断。项目数量增长后，前者限制单个上传体积，后者仍可能形成较大的列表响应。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 项目标识由注册表统一生成

项目 ID 必须由 ProjectRegistry 生成，路由层不得自行拼接或复用标识。

> registerProjectRoutes 只把名称或导入参数交给 registry.createBlankProject、registry.importDirectory 和 registry.importZip，并由返回的 project.id 作为后续查询依据。路由层不能根据名称、路径或时间戳自行构造 Project 标识，否则可能与既有项目冲突，并破坏 listProjects、Set(project.id) 以及 runtime 清理逻辑。创建和导入类项目都必须遵循这一唯一性来源约束。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 运行结果不可由调用方回写

run 返回文本快照，调用方修改结果不会改变运行时状态。

> AgentRuntime.run 返回的 text 与可选 messageId 是执行结果的独立快照；调用方修改该对象中的 text，不会反向更新运行时保存的会话消息。需要在界面中展示结果时，可复制返回内容到自己的状态层，但不要把原地修改当作状态同步机制。getDiff 返回的 AgentFileChange 数组同样应由调用方视为结果数据，而非运行时内部数组。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 删除重试避免重复执行

删除操作需在重试时保持幂等，避免重复清理项目和运行资源。

> registerProjectRoutes 暴露的项目删除流程应把 registry.deleteProject 与 runtimeManager.disposeProject 的关系设计成可重复执行：客户端或上游重试同一删除请求时，不得因项目已不存在而产生错误，也不得遗留 AgentRunManager 中关联运行。该约束适用于删除项目及清理其工作区、房间和运行资源的入口。实现时应先判断删除状态，清理操作需容忍目标已消失，并用并发或重复请求测试验证最终只保留一次有效删除结果。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 成员校验置于写入前

写操作先确认房间成员身份，再改动工作区内容。

> registerWorkspaceRoutes 在调用 writeWorkspaceFile、createWorkspaceFile 或相关写操作前执行 requireMember，使非成员请求在文件变更前终止。之所以把身份确认放在写入边界附近，是为了让房间成员撤出后的访问请求立即失效，并避免产生未授权副作用。适用范围为工作区文件创建、编辑及路径变更等会改变项目状态的接口。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 写入接口不承诺天然幂等

工作区写入重试可能重复执行，不能假设失败后重发总是安全。

> registerWorkspaceRoutes 调用 writeWorkspaceFile、createWorkspaceFile、deleteWorkspacePath 或 renameWorkspacePath 完成变更后，没有返回可用于重放的幂等键，也未记录“请求已执行”状态。因此客户端在响应丢失后重试时，必须按具体操作判断结果：写文件可能再次覆盖，删除可能撞上已不存在路径，重命名还取决于 toPath 是否已生效。适用边界是所有 workspace 写接口，不能把网络重试等同于无副作用。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 工作区响应设置容量边界

目录与文件接口须限制响应规模，避免无界读取。

> registerWorkspaceRoutes 将 listWorkspaceDirectory 的 tree 和 readWorkspaceFile 的结果直接返回，当前仅暴露 force 开关。接入前须设置目录展开深度、条目数、文件大小上限，并使读取失败返回可识别错误。适用于工作区目录及文件读取，force=true 也不得绕过容量限制。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 成员缺失统一抛异常

查无成员时抛出 Error，由路由错误链统一处理响应。

> requireMember 在 getMember 未返回成员时抛出 Error，调用方不把缺失身份当作普通返回值继续执行。采用异常可确保错误沿 registerWorkspaceRoutes 的 try 与 catch 进入 next(error)，同时阻止空 member 被后续逻辑误用。适用范围为房间成员身份校验；当 memberId 为空、成员已退出或项目房间不匹配时，均走同一失败路径。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 工作区缺省路径归一化

读取目录和文件时，空查询路径按工作区根目录处理。

> registerWorkspaceRoutes 使用 String(req.query.path ?? "") 生成 directoryPath 和 filePath，使缺少 path 参数的请求落到工作区根目录，避免 undefined 路径。文件读取可由 force 精确控制刷新行为。该规则仅适用于 GET 目录和文件查询；写入接口仍须显式提供 path，并通过 requirePermission 与 requireMember。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 工作区路径越界防护

所有相对路径必须解析在工作区根目录内。

> resolveWorkspacePath 先拒绝 isIgnoredPath 标记的浏览器访问路径，再以 root 的绝对路径解析 candidate，并通过 path.relative 检查结果。relative 以 .. 开头或仍为绝对路径时抛出 Error，禁止操作工作区外部资源。该规则适用于 readWorkspaceFile、writeWorkspaceFile、createWorkspaceFile 及目录操作传入的相对路径。

适用范围：`src/extracted/workspace.ts`

### 空文件写入属于有效操作

writeWorkspaceFile 接受空 content，并递归创建父目录

> writeWorkspaceFile 接收 string 类型的 content，空字符串仍是合法写入值，不会因内容为空而跳过文件操作。函数先由 resolveWorkspacePath 得到 absolutePath，再以 recursive:true 调用 fs.mkdir 创建父目录，最后使用 fs.writeFile 和 utf8 编码落盘。该边界约定适用于初始化模板、清空文件及生成占位内容；调用方若要区分“保持原内容”和“明确清空”，需在进入 writeWorkspaceFile 前保存原值或另行传递操作语义。

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

### 工作区快照缺失文件按删除统计

快照比较应区分新增、删除与内容变更。

> createAgentWorkspaceSnapshot 读取工作区时，目录不存在或没有可读文件应得到空 Map，而不是让比较流程失败。原因是快照用于前后差异检测，缺少文件必须能与 before 中的条目对应并被识别为删除；该规则适用于工作区采集及 compareAgentWorkspaceSnapshots 的空目录输入。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### AgentRun 更新不得改写标识

AgentRunStore.update 保留 current.id，不接受更新覆盖运行标识。

> createAgentRunStore 暴露的 update 应合并 Partial<AgentRun>，但最终 id 始终取 current.id；传入的同名字段不能改变已有 AgentRun 身份。该规则适用于 AgentRunStore 的创建后更新场景，可避免文件定位键与业务标识漂移。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 预览提示词限制展示长度

previewPrompt 压缩空白并把摘要截断到 120 个字符。

> previewPrompt 应先用 replace 合并连续空白并执行 trim；结果超过 120 个字符时保留前 117 个字符并追加省略号。该规则只适用于提示词预览展示，不限制 buildRuntimePrompt 接收的完整请求，也不改变实际 Agent 执行内容。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 文件上下文先校验再归一化

normalizeAgentContexts 仅接收有效 file 上下文，并移除路径空白。

> normalizeAgentContexts 遇到非数组输入应抛出 Error；每项必须具有 type 为 file、path 为非空字符串，之后才执行 trim 并生成规范项，空数组则返回 undefined。这样可为 buildRuntimePrompt 与 previewPrompt 提供稳定、明确的文件上下文。适用于 Agent 运行前的上下文准备，不应放宽非法结构以兼容异常输入。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 上下文仅限工作区

buildRuntimePrompt 限制 Agent 读取范围，并拒绝非文本或过大的上下文文件。

> buildRuntimePrompt 只能通过 readWorkspaceFile 读取 workspacePath 内由 AgentPromptContext 指定的文件，不得访问父目录或父仓库。文件状态不是 text 时立即抛出 Error，并要求上下文小于 1 MB；该约束适用于构造 Agent 运行时提示词。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 并发加载复用同一任务

ensureLoaded 复用首次 load Promise，避免并发调用重复读取存储目录。

> createRecordStore 的 ensureLoaded 使用 loading 保存正在执行的 load Promise；首次调用创建任务，后续调用直接返回同一结果。若测试需要验证重新读取磁盘行为，应先让首次加载结束并重建 store，而不是依赖 ensureLoaded 再次触发加载；该规则适用于共享记录存储的并发调用。

适用范围：`src/extracted/agent/recordStore.ts`

### 存储操作严格串行

enqueue 让记录存储操作按进入顺序执行，并隔离前一次失败。

> createRecordStore 的 enqueue 将 operation 接到 operations 链尾；无论本次操作成功或失败，operations 都恢复为可继续执行的状态，但调用者仍收到本次 operation 的结果。该机制适用于共享 RecordStoreOptions 的异步读写，目的是避免目录扫描、文件更新等操作相互穿插。

适用范围：`src/extracted/agent/recordStore.ts`

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

### 桥接返回值避免空集合

ChatAgentBridge 的派生类型需覆盖空集合输入。

> ChatAgentBridge 通过 ReturnType<typeof createChatAgentBridge> 派生，因此 createChatAgentBridge 返回结构必须能表达空讨论集合。若 buildDiscussion 在无成员或无文本输入时返回空数组，调用方仍须按正常结果处理；该约束适用于桥接工厂的返回类型及其边界测试。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 聊天写入须防重复提交

ChatStore 重试时应复用既有消息，避免重复追加相同业务记录。

> ChatStore 由 createChatStore 构造，但重试写入不能仅依赖调用方重复执行；应先确认目标消息是否已存在，再决定是否追加并调用 saveMessages。原因是网络重试或并发请求可能提交同一业务事件，盲目落盘会生成重复 ChatMessage。适用于消息创建、失败重试和并发写入；需要以消息标识或稳定业务键进行幂等判断。

适用范围：`src/extracted/chat.ts`

### 成员查询禁止隐式空值

findMember 找不到 memberId 时抛出 Error，调用方须显式处理身份不存在。

> findMember 先通过 findRoom 定位房间，再从 members 中匹配 memberId；候选不存在时直接抛出 Error，而不是返回空对象。使用该函数的成员复用、连接同步和展示名刷新流程应区分房间不存在与成员不存在，避免用空成员对象继续更新状态。

适用范围：`src/extracted/rooms.ts`

### 项目编号先做成员域校验

findProject拒绝不存在的projectId，防止成员数据落入错误项目边界。

> createMemberStore处理成员访问时，应先由findProject核验projectId是否对应现有Project；找不到时抛出Error，不继续读取或写入成员数据。该规则把成员操作限定在有效项目集合内，避免拼写错误或过期编号被当作真实项目，适用于成员查询、更新及任何以projectId定位数据的入口。

适用范围：`src/extracted/auth/identity.ts`

### 项目列表清理孤立运行时

列出项目时同步释放不再对应注册项目的运行时。

> registerProjectRoutes 处理 GET /api/projects 时，先由 registry.listProjects() 建立 projectIds，再释放 runtimeManager.listActive() 中已无注册记录的项目。这样可避免孤立 runtime 持续占用资源；规则仅适用于项目列表读取，不应改动 registry 的项目持久化结果。

适用范围：`src/extracted/routes/projectRoutes.ts`

### Demo 工作区仅初始化一次

createDemoProject 只在工作区缺失时复制 Demo 内容。

> createDemoProject 检查 demo 对应的 workspacePath；仅在 pathExists 返回 false 时，以 recursive 和 mode 0o700 创建 projectDir，并从 demoProjectRoot 复制到 workspacePath。已有工作区时不得重新复制，以免覆盖用户改动；该规则用于 Demo 项目的冷启动准备。

适用范围：`src/extracted/projects.ts`

### 句柄归一化应返回副本

normalizeHandle 应生成规范化结果，避免调用方输入被间接修改。

> normalizeHandle 在 trim、toLowerCase、replace 与 slice 后应返回新的字符串值，不应把调用方传入的 value 直接当作结果继续流转。这样可隔离原始文本与规范化文本，降低调用方意外修改中间结果的风险，适用于句柄比较和提及解析前的统一处理。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

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

### enqueue 操作串行化风险

EventLog 写入队列需避免失败后自动重放。

> createEventLog 内的 enqueue 将 operation 接到 operations 链后，失败会被转为 undefined 以继续后续任务。团队应禁止调用方把同一写入操作再次提交当作重试，否则可能产生重复事件；适用范围是 EventLog 的异步写入与事件落盘。

适用范围：`src/extracted/eventLog.ts`

### 句柄格式须受统一约束

HANDLE_PATTERN 限定可接受的 Agent 句柄结构。

> HANDLE_PATTERN 用于约束句柄只能由小写字母、数字和连字符组成，首位为字母或数字且总长度受限。validateHandle 与 normalizeHandle 应沿用同一格式边界，以避免解析、校验和规范化产生不同结果。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 运行存储类型随工厂演进

AgentRunStore 绑定工厂的实际返回类型，新增存储能力时应同步调整派生类型。

> AgentRunStore 应始终由 createAgentRunStore 的返回类型推导，而不是手写一套重复接口。这样能让运行时新增的方法和字段立即反映到调用方，避免类型声明与真实存储实例漂移；该约束适用于 AgentRunStore 及其所有依赖该类型的编译检查。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 成员存储操作须排队

MemberStore 的文件变更应串行执行，避免并发写入互相覆盖。

> createMemberStore 内的 enqueue 必须让每次文件操作接续前一项完成，即使前一项失败也不能阻断后续队列。这样可防止两个请求同时改写 MemberFile 时出现旧内容覆盖新内容；该规则适用于 MemberStore 的成员加载、登记和更新等所有异步文件操作。

适用范围：`src/extracted/auth/identity.ts`

### 成员文件必须固定版本一

members.json只接受version为1且members为数组的记录。

> 成员持久化文件应保持MemberFile的version: 1与members数组结构；读取时发现版本不是1或members不是数组，必须拒绝该文件，而不是猜测字段含义。这样可避免旧结构或损坏数据被静默转换成错误成员记录。适用于createMemberStore加载和保存项目成员数据的流程。

适用范围：`src/extracted/auth/identity.ts`

### 缺失项目应立即失败

findProject 拒绝未知项目，避免身份流程继续使用无效上下文。

> 在 createMemberStore 的身份数据访问中，findProject 应依据 projectId 定位项目；找不到时直接抛出 Error，不返回空对象或不存在的成员记录。这样可阻止无效项目进入成员缓存与权限链路，适用范围是项目成员存储及其调用方。

适用范围：`src/extracted/auth/identity.ts`

### 成员缺失须在入口抛错

requireMember 找不到成员时立即抛出明确错误，不返回空对象。

> requireMember 应先调用 runtime.rooms.getMember，仅在取得成员后返回；若结果不存在，则抛出 Error("Project membership is required")。原因是阻止无成员记录继续进入 workspace 路由依赖的后续逻辑，并保留可直接定位的失败信息。该风险控制适用于 registerWorkspaceRoutes 中需要校验 ProjectRuntime 成员的入口。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 旧版运行记录兼容性风险

AgentRun 校验过宽，磁盘旧数据可能缺少新增必填字段。

> createAgentRunStore 委托 createRecordStore 持久化 AgentRun，但 validateRecord 仅校验对象及字符串类型的 id、projectId，缺失状态、输入、输出等新增字段仍可写入。读取方按完整 AgentRun 使用时可能得到 undefined，因此新增字段或改变字段含义时，须同步制定 run.json 迁移或更严格校验策略，适用于已有 agent-runs 数据及跨版本升级。

适用范围：`src/extracted/agent/agentRunStore.ts`

### ActiveRun运行态绑定风险

运行态同时记录工作区路径与会话标识，丢失任一绑定都会影响协作执行与事件关联。

> AgentRunManager 维护 ActiveRun 时，workspacePath 与 runtimeSessionId 必须作为同一运行实例的关联信息保存，不能只凭路径重建会话。workspacePath 指向本次协作使用的实际工作区，runtimeSessionId 标识对应的运行时会话；两者共同支撑 processQueue、executeRun 及事件记录。创建、更新或恢复 ActiveRun 时，应沿用既有实例的绑定关系，避免新会话误接旧工作区或旧运行被错误续接。

适用范围：`src/extracted/agent/agentRunManager.ts`

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

### 成员缺失统一拒绝请求

工作区路由先通过 requireMember 确认成员身份，成员不存在时立即终止处理。

> registerWorkspaceRoutes 调用 requireMember 校验请求中的 memberId；该函数使用 ProjectRuntime.rooms.getMember 查询当前 room 的成员，未找到时抛出 Error，并返回查到的 member。规则是缺少有效成员记录就拒绝后续工作区操作，避免请求以无效身份继续执行。适用范围为 registerWorkspaceRoutes 中所有需要成员上下文的入口；调用方应按失败请求处理 requireMember 抛出的异常。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 事件载荷须防外部改写

AgentRuntimeEvent 的 data 仅约定形状，调用方不得假定其内容不可变。

> AgentRuntimeEvent.data 采用 Record\<string, unknown>，只保证事件载荷具有键值结构，不提供冻结或只读语义。消费 AgentRuntime.subscribe 回调时，监听方修改 data 的嵌套对象可能影响仍持有同一引用的其他处理者。生产方应交付独立载荷，消费方若需保留结果则先复制；该规则适用于 AgentRuntime 事件分发及其后续排队处理。

适用范围：`src/extracted/agent/agentRuntime.ts`

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

### 空会话结果须显式处理

AgentRuntime 的异步结果允许为空，调用链必须区分无结果与成功。

> AgentRuntime.createSession 返回 Promise<{ id: string }>，而 getDiff 返回 Promise\<AgentFileChange\[]>；这些签名允许调用方面对空对象、空数组或无条目结果。调用 AgentRuntime.run 前不能假定 sessionId 已由 createSession 产生有效会话，解析 getDiff 结果时也不能把空数组当作异常。实现和上层编排应显式处理空值边界，适用于会话创建、差异展示及运行参数组装。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 项目写操作缺少显式幂等键

创建与导入接口未提供幂等键，客户端重试可能生成重复项目。

> registerProjectRoutes 暴露的 POST /api/projects、/api/projects/import 和 /api/projects/import-zip 都没有读取幂等键；响应超时后重发请求，会再次进入 createBlankProject、importDirectory 或 importZip。风险在于客户端无法区分首次请求与重试，可能生成多个 Project。适用于需要可靠重试或由网关自动重放这些写请求的部署场景。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 导入路径须受工作区约束

目录导入的路径校验应由注册表统一执行，避免越界读取。

> registerProjectRoutes 将 req.body.path 交给 registry.importDirectory，因此路径安全依赖 ProjectRegistry.importDirectory 的根目录约束、路径规范化及符号链接处理。若目标未被解析到允许的工作区，调用方可能读取或导入边界外内容。新增目录导入入口或调整工作区规则时，须验证这些限制并补充越界用例。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 事件数据不得越界承载路径

AgentRuntimeEvent 的 data 应承载事件数据，不应成为路径访问契约。

> AgentRuntimeEvent 仅通过 type 和 data 描述事件，没有声明路径字段或目录层级约束；把 workspacePath 等路径语义塞入 data 会让订阅方依赖未约定结构，也会混淆事件载荷与 AgentRuntime 方法入参。事件生产方应在 data 中提供不含目录结构承诺的业务数据，路径相关操作继续通过 AgentRuntime 的接口参数进入；该边界适用于事件发布、转发和持久化适配。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 运行存储夹具依赖工厂返回类型

测试夹具通过 AgentRunStore 对齐工厂能力，避免依赖内部实现造成重放偏差。

> 编写 R2 运行模块的测试夹具时，使用 AgentRunStore 作为 createAgentRunStore 的返回类型边界，并只通过该类型暴露的能力准备状态。这样既能复用工厂创建的存储实例，又不会把测试绑定到具体对象结构；当工厂内部实现调整时，夹具仍可按同一契约重建并重放。适用范围是针对 R2 Agent 运行流程的单元测试、集成测试及可重复测试数据准备。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 运行时补丁覆盖工作区

mergeFileChanges 以运行时 patch 覆盖同文件工作区变更，同时保留工作区独有记录。

> mergeFileChanges 先用 runtimeByFile 按 file 建立运行时变更索引，再以 workspaceChanges 为基础复制对象，并为同路径记录采用 runtimeByFile 中对应的 patch；仅存在于运行时列表的变更会追加到 merged。返回值是新的 AgentFileChange 数组，调用方修改 merged 不会直接改变传入数组，但其中 patch 等字段仍沿用原对象引用。该合并规则适用于汇总工作区快照与 Agent 本轮文件修改，调用方不得假定其会深拷贝所有字段。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 合并文件修改时以运行结果覆盖

同路径采用 runtime patch，保留工作区独有文件及运行新增记录。

> mergeFileChanges 合并两个 AgentRun 的 fileChanges 时，先按 file 建立 runtimeChanges 索引，再以其中 patch 覆盖工作区同路径记录的 patch。workspacePaths 用于识别已有路径，runtimeChanges 中不在工作区的文件经 filter 后追加。结果仍为 AgentFileChange，适用于工作区修改与 Agent 运行时修改汇入同一持久化变更集。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 事件数据须限制路径边界

AgentRuntimeEvent 的 data 不得携带越界或未解析的路径。

> 团队规则：AgentRuntimeEvent.data 中的路径字段必须在产生事件前解析为工作区内路径，并拒绝 workspacePath 之外的绝对路径、符号链接逃逸及未规范化片段；type 用于区分事件类别，data 只承载经过校验的结构化信息。原因是事件通常会进入订阅端、日志或后续 Agent 流程，保留未验证路径会让读取、写入和文件变更越过工作区边界。适用范围涵盖所有实现 AgentRuntimeEvent 的生产者、AgentRuntime.subscribe 消费者及事件持久化入口。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 迁移缓存只覆盖单次调用

migrated 仅在本次迁移中复用会话，跨调用不会保留映射。

> migrateLegacyAgentSessions 内的 migrated 只缓存当前调用创建的 AgentSessionStore 会话。函数结束后映射即失效，后续再次执行迁移仍会通过 sessionStore.get 核查并可能重新创建记录。运行数据较大或迁移重复触发时，写入量会随调用次数增加，因此该缓存仅用于消除单次执行中的重复创建，不能当作持久化索引。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 读取设置不依赖当前时间

get 仅组合已存设置与密钥状态，不读取时钟或生成时间字段。

> AgentSettingsStore.get 返回 settings 的副本，并用 options.apiKeyConfigured 覆盖响应中的密钥标记；整个过程不查询当前时间。若后续引入缓存过期、签发时间或同步版本，get 会产生与运行时刻相关的结果，使相同存储在不同时间得到不同响应。现有读取路径和上层展示逻辑应保持这一时间无关性。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 快照重试需重建映射

快照使用可变 Map，失败重试应重新创建实例，避免残留旧轮次状态。

> 风险在于 AgentWorkspaceSnapshot 只是 Map\<string, SnapshotFile> 的类型别名，本身不提供版本号、不可变保证或重试隔离。createAgentWorkspaceSnapshot 每次调用会新建 Map，但若调用方复用旧实例或在中途失败后继续追加，就可能混入上一次数据，使 compareAgentWorkspaceSnapshots 的结果无法代表当前工作区。重试流程应重新调用 createAgentWorkspaceSnapshot，并以成功返回的新快照替换旧映射。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 讨论上下文缺失断点

历史游标失效时，讨论上下文可能回退到全部早期消息。

> buildDiscussion 依赖 lastChatMessageId 定位上轮会话边界；若该标识符已不在 messages 中，findIndex 返回 -1 且 start 仍为 0，会把早期记录重新纳入讨论。游标指向已删除消息或历史数据未迁移时也可能回退。该函数仅拼接 Agent 提示上下文，不修改消息，调用方需保证游标有效，必要时保存可靠的 chatMessageId。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 目录缺失按空列表处理

readDirectory仅将ENOENT转为空数组，其他读取错误继续抛出。

> readDirectory调用fs.readdir时启用withFileTypes，并只把ENOENT转换为空数组，权限、路径类型等异常仍抛给调用方。这样首次访问尚未创建的root可视为没有记录，又不会掩盖真实I/O故障。该规则适用于createRecordStore启动时扫描options.root，不应忽略所有fs.readdir错误。

适用范围：`src/extracted/agent/recordStore.ts`

### 存储配置必须完整提供

RecordStoreOptions缺少必要字段会直接造成类型或运行错误。

> 创建基于createRecordStore的存储时，配置对象必须完整提供root、projectId、fileName、recordKey、invalidMessage、missingMessage与validateRecord，且不得依赖默认补全。加载写入路径、记录隔离键和异常文案均依赖这些字段，隐式默认可能导致错误目录或跨项目数据泄露；validateRecord负责运行时结构校验。

适用范围：`src/extracted/agent/recordStore.ts`

### 加载不会补齐缺失字段

load只接受完整且版本匹配的记录，不应用默认值。

> createRecordStore 的 load 从每个目录读取 options.fileName 后，要求 stored.version 严格等于 1、options.validateRecord(value) 成立，且 value.projectId 与 value.id 分别匹配配置和目录名；任一条件不满足都会抛出 options.invalidMessage。由于读取阶段没有缺省值合并，缺少可选业务字段的旧记录也会被拒绝。采用该存储格式时，生成方必须写入完整 T 结构，不能依赖 load 自动修复缺项。

适用范围：`src/extracted/agent/recordStore.ts`

### 目录不存在按空集合处理

readDirectory 仅吞掉 ENOENT，其他读取错误继续上抛。

> readDirectory 遇到 NodeJS.ErrnoException 的 code 为 ENOENT 时返回空数组，其他异常原样抛出，使 RecordStore 可在目录尚未创建时初始化，并保留权限不足、文件系统损坏等错误信号。适用于目录枚举和记录扫描；若需区分“空目录”与“读取失败”，不得扩大 ENOENT 之外的忽略范围。

适用范围：`src/extracted/agent/recordStore.ts`

### 提及解析只返回候选句柄

parseMentions 过滤未知成员并按首次出现去重。

> 风险在于 parseMentions 生成的 mentions 是可直接序列化的字符串数组，元素使用小写句柄并保持文本中的首次出现顺序，而不是成员对象或展示名称。该函数通过 candidates 排除未知句柄，并借助 seen 去除重复提及，因此调用方不能把结果当作成员全集；若后续协议调整字段名或改用对象结构，序列化消费者必须同步升级。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 会话路径受根目录约束

会话文件位置由 projectRoot 推导，类型本身不提供路径隔离保证。

> AgentSessionStore 仅描述 createAgentSessionStore 的返回契约，本身不校验 projectRoot 或阻止路径逃逸。实际会话目录由 path.join(projectRoot, "agent-sessions") 推导，文件名为 session.json，因此边界保障依赖调用方提供可信项目根目录。适用于所有创建会话存储的入口；若外部输入能影响 projectRoot，必须先在工厂外确认其已规范化为工作区内路径。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 会话文件校验兼容风险

旧版 AgentSession 缺少必填字段时会被判为无效文件。

> createAgentSessionStore 固定以 session.json 保存 AgentSession，validateRecord 要求 id、projectId、memberId、title 均为 string。升级后若旧会话缺少 title，或这些字段曾保存为非字符串，createRecordStore 会按 Invalid Agent session file 拒绝读取，导致会话列表和 findByHandle 无法获得历史数据。调整持久化结构时，必须为旧格式提供迁移或兼容校验，并覆盖 personal、team scope 的历史记录。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 会话标识必须由运行时生成

createSession 返回的 id 是后续 run 与 getDiff 关联会话的唯一依据。

> createSession 必须为每次新会话生成全局唯一且不可复用的 id，并把该值原样返回给调用方；调用方随后应把它同时传给 run、getDiff、cancel 和 subscribe，不得根据 title 或 workspacePath 推导替代标识。原因是多个会话可能共享同一工作区或标题，派生值无法稳定区分执行记录。适用范围为 AgentRuntime 的会话创建及其后续操作链路。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 运行事件须校验载荷

AgentRuntimeEvent 的开放字段不代表事件内容可以绕过运行时校验。

> AgentRuntimeEvent 接收方在使用 type 和 data 前必须先确认 type 非空，并按具体事件类型校验 data 必需字段及值域；无法识别的 type 应进入明确的失败路径，不能直接当作普通事件处理。这样做是因为 data 使用 Record\<string, unknown>，编译期不会暴露缺失、错型或多余字段。适用范围包括 subscribe 收到的监听事件，以及任何转发或持久化 AgentRuntimeEvent 的入口。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 会话标识生成须防冲突

短随机标识存在极低概率碰撞，创建后不能假定绝对唯一。

> createAgentSessionStore 使用 nanoid(12) 生成会话 id，生成过程没有附带业务序号或冲突检测。该方案适合低成本区分会话，但调用方不应把短标识当作绝对唯一键；若业务需要全局唯一性，应在上层增加冲突检测或改用带持久化唯一约束的键；此风险仅针对 create 的自动标识分配。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 类型别名不承诺运行时校验

AgentSessionStore 是静态类型，错误处理仍由具体方法负责。

> AgentSessionStore 由 ReturnType 推导，只描述 create、list、update 等方法的编译期契约，不会让调用方获得统一的运行时错误类型。接入该类型时，应依据 createAgentSessionStore 实际返回的错误处理约定编写分支，不能仅凭类型别名假定所有失败都抛出同一种异常；适用于消费 Agent 会话存储的边界代码。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 消息输入缺少非空校验

CreateChatMessageInput 仅约束类型，空值仍可能进入存储。

> 该接口只表达输入形状，不能在编译期排除空字符串或空 mentions。R2 创建消息时应在运行时检查必填文本及标识符，并决定空 mentions 是拒绝、过滤还是归一化为空数组，避免无法检索、空作者或无内容的记录被 saveMessages 持久化。

适用范围：`src/extracted/chat.ts`

### 布尔环境变量严格解析

readBoolean 仅接受精确的 true 或 false，避免配置被静默误读。

> readBoolean 只把字符串 true 和 false 分别解释为布尔值；变量未定义时采用 defaultValue，出现其他文本则抛出 Error，禁止使用 JavaScript 的宽松布尔转换。原因是 TRUE、1、yes 等写法在不同部署工具中语义不一致，静默转成 true 可能意外开启终端或伪造 Agent 运行。该约束适用于 loadConfig 解析 SIMPLERCP_TERMINAL_ENABLED、SIMPLERCP_FAKE_AGENT_RUNTIME，以及后续复用的布尔型环境变量。

适用范围：`src/extracted/config.ts`

### enqueue 串行化事件写入

事件操作必须经 enqueue 排队，避免并发写入破坏事件日志。

> createEventLog 提供的 enqueue 会把 operation 接到 operations 之后，并持续吸收成功或失败结果；调用方不要绕过该入口直接修改持久化事件。这样可避免多个异步写入同时竞争 EventFile，避免事件顺序不确定或文件内容互相覆盖。适用范围是 createEventLog 管理的事件追加流程；只读的 loadEvents 不属于该队列约束。

适用范围：`src/extracted/eventLog.ts`

### 项目路径必须限定边界

项目级协作入口以 projectId 选择运行时，避免跨项目工作区串用。

> registerCollaborationRoutes 的协作接口以 req.params.projectId 定位 ProjectRuntimeManager 中的项目运行时，成员查询则把同一参数传给 MemberStore.listMembers。路由实现不得把客户端提供的任意文件路径直接用于工作区操作，应先通过项目标识解析受管目录，再执行读取或写入，防止路径穿越及不同项目间越权。该约束适用于房间、参与者、连接和聊天等全部项目级协作入口。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 读取异常不可按缺失处理

跨模块调用只能将 undefined 建模为空数据，损坏 JSON 必须触发读取失败。

> readJsonFile 的异常不能统一转为 undefined，否则会掩盖历史文件格式损坏、权限不足或文件系统故障，导致相关数据无提示丢失。仅 ENOENT 对应的 undefined 可作为合法缺失结果；JSON.parse 或 readFile 抛出的 error 必须向上传播，由边界层记录并决定恢复策略。

适用范围：`src/extracted/jsonFile.ts`

### 身份类变量默认拒绝继承

名称命中身份关键词的环境项会被过滤，可能误伤合法凭证但能降低泄露风险。

> identityNames 使用 TOKEN、SECRET、PASSWORD、COOKIE 匹配身份类变量名，buildEnvironment 在筛选 env 时直接排除命中项。该规则用于阻止不同调用方或重试任务复用已有身份凭据，适用范围是普通环境构建；代价是名称包含这些词的非敏感配置也可能被过滤，因此调整匹配范围需同步验证构建结果。

适用范围：`src/extracted/processEnv.ts`

### 项目元数据路径不可缺失

读取项目元数据位置前必须验证 metadataPath 已配置。

> 调用 getProjectMetadataPath 获取路径时，ProjectRecord.metadataPath 为空必须立即抛出 Error，不能返回空串或猜测目录。该约束用于项目注册、迁移及持久化流程，可避免把元数据写到错误位置或因无效路径造成不可追踪的写入失败；带有合法 metadataPath 的记录才可继续处理。

适用范围：`src/extracted/projects.ts`

### 参与者回退值可能发生碰撞

缺失 participantId 时按连接或名称推导，名称相同的人可能被视为同一参与者。

> normalizeJoinInput 在 participantId 缺失时依次采用 connectionId，再退化为 human 加 name；connectionId 缺失时又会把 participantId 当作连接标识。该策略适合连接稳定、名称可区分的加入场景，但同名成员可能得到相同 participantId，进而被 findExistingMember 合并。跨设备重连必须显式提供稳定且唯一的 participantId；不要依赖 displayName 或 name 充当身份键，也应让调用方确认 participantId 与 connectionId 的作用域，避免工作区内不同客户端发生误关联。

适用范围：`src/extracted/rooms.ts`

### 成员查找依赖 participantId

成员查找以 participantId 匹配，连接更新不会生成新的成员身份。

> findExistingMember 仅按 input.participantId 在 members 中定位成员，不能再以显示名或连接 ID 判定同一参与者。原因是 upsertConnection 更新连接对象后，成员身份仍应保持稳定，避免重名成员被错误合并。该规则适用于 join 输入归一化后的成员复用，以及调用 findMember 或 refreshDisplayNames 前确定成员身份的场景；participantId 变化必须视为新成员。

适用范围：`src/extracted/rooms.ts`

### 异步监听器可能拖慢事件分发

订阅回调可返回 Promise，队列串行化时需控制等待时间。

> AgentRuntime.subscribe 允许 listener 返回 void 或 Promise<void>，因此实现方不能假设事件通知天然是同步且立即完成。若运行时按顺序等待监听器，单个慢回调会阻塞后续事件，造成队列积压；反之若并发派发，调用方可能观察到完成顺序与产生顺序不同。适用于实现 AgentRuntimeEvent 分发、订阅队列及关闭逻辑的场景。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 活动任务期间冻结配置

Agent 有活动任务时禁止变更模型与启用状态。

> registerAgentRoutes 的设置更新入口先读取 agentSettings.get()，再通过 agentRuns.hasActiveTasks() 判断是否仍有任务运行；只要 model 或 enabled 与当前值不同，便拒绝更新，防止正在执行的 Agent 使用不一致的配置。适用范围是 Agent 全局设置变更，不影响任务完成后的正常更新。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 房间状态避免陈旧快照

room 查询直接读取运行时当前对象，不维护独立副本或长期缓存。

> registerCollaborationRoutes 处理 GET room 时，通过 runtimeManager.get(req.params.projectId).room 获取当前运行时房间，避免成员加入、连接离线后缓存未失效。返回的是当前对象引用，调用方若要长期持有状态，应在序列化或消费边界复制所需字段；适用于活跃房间状态读取。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 成员与房间写入存在双路径风险

成员加入同时写入 MemberStore 与房间，批量路径可能绕过部分副作用。

> registerCollaborationRoutes 的成员加入流程先调用 members.join，再执行 runtime.rooms.joinRoom；后者同时接收 memberId、participantId 与 connectionId。若另有批量入口只更新成员记录，ParticipantStore 与 Room 的在线状态会不一致。涉及成员、参与者或连接状态同步的接口变更时，需核对两条路径是否执行相同副作用，不能仅依据成员查询结果判断成功。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### ZIP 请求体必须显式校验

ZIP 导入仅接受 application/zip 的 Buffer 请求体，错误类型需在路由层明确返回。

> registerProjectRoutes 的 /api/projects/import-zip 使用 express.raw 解析 ZIP，并在调用 registry.importZip 前通过 Buffer.isBuffer(req.body) 验证请求体。校验失败必须返回 400 JSON，说明请求需要 ZIP archive；若缺少该校验，错误可能被当作其他异常或传入非 Buffer 数据，导致导入行为不可控。该规则适用于所有 ZIP 上传入口及新增的二进制导入路由。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 事件顺序依赖明确投递策略

AgentRuntimeEvent 未携带序号，顺序保障必须由运行时负责。

> AgentRuntimeEvent 只有 type 与 data，没有可用于比较先后位置的标识，因此消费者无法从事件内容本身恢复严格写入顺序。实现 AgentRuntime 时，应明确 subscribe 回调的投递策略，并保证同一订阅中的事件顺序符合运行时声明；重放历史事件时也需保留原顺序。适用于事件日志写入、实时订阅以及异步队列调试。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 来源符号不可按字符串迁移

历史数据若保存 filesystem 字符串，迁移后无法匹配新的 FILESYSTEM_ORIGIN。

> 迁移 R2 历史数据时，不能把旧记录中的 "filesystem" 字符串直接视为 FILESYSTEM_ORIGIN；Symbol("filesystem") 与同名字符串不具有相同身份。若旧格式曾持久化来源值，重新加载时会出现来源判定丢失，进而影响批量内容与单项内容的分支选择。原因是 Symbol 刻意隔离不同来源标记。适用范围是升级旧事件日志、缓存或持久化消息时对来源字段的兼容处理。

适用范围：`src/extracted/textDelta.ts`

### 共享类型缺少体积护栏

类型导出不提供性能保障，跨包传递大对象会放大内存与序列化成本。

> types.ts 重导出共享类型，但未定义数组长度、嵌套深度或负载大小上限。大量 EventRecord 装入 RoomState，或 WorkspaceFileLoadResult 携带无界文件内容，会增加复制、缓存和跨进程序列化的内存与延迟。该文件是契约入口；历史记录、聊天和文件数据调用链须另行设置数量及字节限制。

适用范围：整个项目

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

### Agent 超时后等待取消完成

runWithTimeout 超时触发取消，并在抛错前等待取消流程结束。

> runWithTimeout 以 Promise.race 竞争 operation 与 timeoutMs，超时后调用 cancel，等待取消 Promise 完成再抛出 Error，并在 finally 中 clearTimeout。这样可避免遗留未收束的异步任务，适用于带取消能力的限时执行；cancel 必须可等待，且应区分 operation 原始错误与超时错误。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 提及解析去重并过滤候选

parseMentions 仅返回候选集合中的唯一有效提及。

> parseMentions 应先把匹配文本规范为小写 handle，再用 candidates.has(handle) 排除非候选对象，并通过 seen 集合删除重复项。这样可避免同一账号被多次触发，同时保留首次出现的提及顺序；适用于团队消息中解析成员引用，而不负责校验权限或创建运行。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 迁移结果按会话复用

migrateLegacyAgentSessions 复用同一成员的迁移会话对象。

> migrateLegacyAgentSessions 以 memberId 与 legacyRuntimeSessionId 组成 migrationKey，并通过 migrated 保存 create 返回值。相同键的运行记录复用该对象，同时逐条 update runStore；适合迁移多个运行条目时避免重复创建会话。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 桥接类型由工厂推导

ChatAgentBridge 的公开类型直接跟随工厂返回值，避免手工声明与实现漂移。

> ChatAgentBridge 应使用 ReturnType 配合 typeof createChatAgentBridge 推导，createChatAgentBridge 负责组装讨论桥接行为。这样新增或调整工厂返回结构时，公开类型会同步更新，适用于该桥接模块的导出与调用边界。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 重名成员用序号后缀区分

refreshDisplayNames 为同名成员追加#序号，确保展示名唯一。

> refreshDisplayNames 用 Map 统计 room.members 中 member.name 的出现次数，首次出现保持 member.displayName，第二个及之后改为 name 加#数字。原因昵称可能重复，否则协作者无法分辨是谁改文件或发消息。适用于成员加入、列表重建及移除后重新编号，调用前需保证成员数组顺序稳定。

适用范围：`src/extracted/rooms.ts`

### 讨论上下文限制二十条

buildDiscussion 仅截取最近二十条成员消息，并排除当前消息。

> buildDiscussion 从 lastChatMessageId 之后定位候选记录，过滤当前 ChatMessage.id 与非 member 类型后，仅保留末尾二十条。这样可控制送入 Agent 的讨论文本长度，并避免把工具消息混入成员上下文；适用范围为 buildDiscussion 生成 Agent 讨论输入时。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 成员数据统一挂靠项目元数据

projectDataPath复用项目元数据目录，为成员文件提供稳定路径基准。

> createMemberStore中的成员存储路径应由projectDataPath统一派生，内部调用getProjectMetadataPath取得ProjectRecord对应位置，不另建平行目录规则。成员文件、参与者迁移文件和缓存项都应沿用这一基准，避免同一项目出现多套成员数据位置，适用于成员读写及相关迁移流程。

适用范围：`src/extracted/auth/identity.ts`

### 旧参与者文件需迁移归一

loadFile兼容participants.json，并校验成员结构后写回标准成员文件。

> createMemberStore的loadFile读取members.json；未找到时可回退participants.json，把旧参与者映射为memberId、displayName和role等标准字段。若采用legacy数据或标准文件与归一结果不同，loadFile应调用save持久化转换结果，同时验证版本、数组及成员字段。适用于旧项目首次加载和成员文件格式归一。

适用范围：`src/extracted/auth/identity.ts`

### 二进制样本固定为八千字节

BINARY_SAMPLE_BYTES 统一控制二进制内容采样大小。

> BINARY_SAMPLE_BYTES 固定为 8 \* 1024，readWorkspaceFile 生成二进制预览时应沿用这一上限。统一取样长度可避免不同入口因文件大小产生不一致的截断结果；该决策只适用于二进制样本提取，不用于 LARGE_FILE_BYTES 的大文件读取判定。

适用范围：`src/extracted/workspace.ts`

### 删除工作区根目录被拦截

deleteWorkspacePath 遇到根目录直接抛出错误。

> deleteWorkspacePath 不得删除由 root 标识的工作区根目录，遇到该路径应抛出 Error。根目录承载其余工作区内容，误删会扩大影响范围，因此此约束适用于所有文件与目录删除请求。

适用范围：`src/extracted/workspace.ts`

### 会话存储类型绑定工厂

AgentSessionStore 的公开类型由 createAgentSessionStore 推导。

> AgentSessionStore 通过 ReturnType<typeof createAgentSessionStore> 表达当前工厂返回的存储接口。此类型适用于 Agent 会话数据的创建与读取封装；工厂实现调整后应重新检查调用方，确保会话队列行为仍由该类型完整覆盖。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 匿名请求返回 401

requireIdentity 遇到空身份时终止请求处理

> requireIdentity 发现 request.identity 缺失时，应由 response.status(401).json 返回 Member identity is required，并立即返回 undefined。调用方收到该结果后必须停止后续处理，不得继续访问 Member 数据；该约束用于统一缺少身份时的认证失败响应。

适用范围：`src/extracted/auth/permissions.ts`

### 运行管理器依赖注入边界

创建运行管理器时显式注入存储、运行时和活动回调，避免模块内部隐式读取全局状态。

> 通过 AgentRunManagerOptions 显式传入 members、runtime、registry、runtimeManager、getSettings 和 runTimeoutMs，apiKey、sensitiveValues 可选注入，appendActivity 承接外部事件写入。这样 createAgentRunManager 可在测试和不同宿主中替换依赖，由调用方决定返回值是否继续修改，避免共享可变状态。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 运行管理器采用注入式时钟

createAgentRunManager 的时间行为由调用方配置，便于测试和跨环境运行。

> createAgentRunManager 创建并缓存运行、追踪、会话、队列及活跃任务状态，依赖均从 AgentRunManagerOptions 获取。时间记录统一使用可注入的 now，不直接读取系统时钟，便于测试固定 startedAt、finishedAt、timestamp 并保持一致的 ISO 时间语义。适用于 AgentRunManager 的创建与运行生命周期处理。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 以工厂返回类型固定存储契约

AgentRunStore 直接继承工厂返回结构，避免接口与实现漂移。

> 团队约定用 `export type AgentRunStore = ReturnType<typeof createAgentRunStore>` 暴露存储契约，不另写一套平行接口。这样工厂增减公开方法时，`AgentRunStore` 会同步反映真实能力，调用方仍只依赖 `createAgentRunStore` 的返回结构。该规则适用于 Agent 运行存储的模块边界；若未来需要替换底层实现，应先确认公开成员保持兼容。

适用范围：`src/extracted/agent/agentRunStore.ts`

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

### 会话记录先验型校验

持久化会话须满足最小结构约束，否则按无效记录拒绝加载。

> createAgentSessionStore 通过 validateRecord 校验 AgentSession：value 必须是非空对象，且 id、projectId、memberId、title 均须为字符串。原因是损坏或异构数据不应进入后续 list、findByHandle 与 update 流程，否则会放大无效状态。该约束适用于 agent-sessions/session.json 的读取与初始化，不负责检查可选 scope、handle 等字段的业务语义。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 目录读取兼容缺失场景

readDirectory 将目录不存在视为空集合，其他读取错误继续抛出。

> createRecordStore 使用 readDirectory 枚举存储目录时，若 fs.readdir 返回 ENOENT，则将其转换为空数组，使首次使用或目录尚未创建时仍可继续初始化。此规则只忽略目标目录不存在的场景；权限不足、路径类型错误等其他 ErrnoException 必须原样 throw，避免把真实故障误判为空数据。

适用范围：`src/extracted/agent/recordStore.ts`

### 压缩包采用双层入口限额

ZIP 导入先限制压缩体积，再逐项限制解压体积。

> 导入 ZIP 时先比较 archive.byteLength 与 MAX_ARCHIVE_BYTES，超过 200 MiB 立即拒绝；解压阶段还由 MAX_FILE_BYTES 约束单文件，并由 MAX_TOTAL_BYTES 约束累计输出。这样可在读取目录和落盘前挡住超大输入，避免压缩炸弹与磁盘耗尽。适用于 extractZipArchive 接收的持久化归档导入，不适用于普通文件读取。

适用范围：`src/extracted/archiveImport.ts`

### ZIP 读取保留手动生命周期

延迟读取条目，归档由调用方负责关闭。

> openZip 通过 lazyEntries 避免打开压缩包时立即遍历全部条目，并关闭 autoClose，使 readEntries 与 openEntryStream 可按需访问同一 ZipFile。validateEntrySizes 开启后会校验条目大小与实际读取量。extractZipArchive 在 finally 中调用 zip.close() 释放资源，因此单独复用 openZip 时必须显式关闭。

适用范围：`src/extracted/archiveImport.ts`

### 迁移键防止重复会话

按成员与运行时会话组合生成迁移键，复用同一会话而不是重复创建。

> migrateLegacyAgentSessions 使用 migrationKey 组合 run.memberId 与 legacyRuntimeSessionId，并以 migrated 缓存已创建的 session。多个 run 指向同一成员和运行时会话时，后续 run 会复用同一 session，再分别更新 run.sessionId，避免生成重复会话。该规则适用于一个运行时会话可能关联多条 run 的旧数据迁移；修改 migrationKey 的组成会改变复用边界。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 成员写入先于房间同步

成员加入采用存储与房间双写顺序，响应同时返回两类结果。

> registerCollaborationRoutes 在处理加入成员请求时，先等待 MemberStore.join 完成，再通过 runtimeManager.get 获取运行时并调用 runtime.rooms.joinRoom。这样可让成员档案成为房间成员关系的前置事实，避免房间已展示参与者但成员存储缺失。接口成功响应同时携带 member 与 participant，分别反映房间登记结果和成员摘要；新增成员流程应沿用该顺序，并处理第二步失败后的补偿策略。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

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

### 运行更新由存储层裁决

updateRun 接受局部更新，并按存储层返回结果发布事件。

> AgentRunManager.updateRun 将 Partial<AgentRun> 原样交给 getStore(projectId).update，不在管理器内补字段或覆盖缺失值。这样 runId 定位、持久化和并发版本裁决集中在存储层，避免生成与存量数据不一致的边界值。适用于项目内单次运行状态更新；调用方须提供有效 projectId、runId，并使用返回的 run 继续处理。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 团队代理列表按范围读取

listTeamAgentsWithoutEnsuring 仅查询团队级代理，不触发默认代理初始化。

> 调用 listTeamAgentsWithoutEnsuring(projectId) 时，通过 getSessionStore(projectId).list(undefined, "team") 获取团队代理，不限定具体成员。该方法只负责读取，适合展示或刷新团队代理列表；若需确保项目具有默认共享代理，应另调用 ensureDefaultTeamAgent，避免查询隐式变成写入。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 默认团队代理按需创建

默认共享代理在项目锁内检查并创建，变更后广播团队代理事件。

> ensureDefaultTeamAgent(projectId) 通过 withTeamAgentLock 串行化检查与创建，先由 getSessionStore(projectId).findByHandle("agent") 判断是否已存在；仅在缺失时调用 store.create 建立 scope 为 "team"、runtime 为 "opencode" 的共享代理。创建完成后使用 emit 发送 team_agents_changed，并附带 listTeamAgentsWithoutEnsuring 的结果，使并发调用不会重复创建。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 运行类型依赖运行时校验

AgentRunStore 仅封装已校验的运行记录入口，外部输入仍须单独验证。

> AgentRunStore 由 ReturnType<typeof createAgentRunStore> 生成，公开能力取决于工厂实际返回值。createAgentRunStore 通过 validateRecord 检查 id 与 projectId 是否为 string，并区分无效文件与缺失记录错误。读取 AgentRun 持久化数据或构造测试输入时必须单独校验，不能仅凭 AgentRunStore 的类型声明推断磁盘数据可信。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 超时取消的完成确认

runWithTimeout 报错前等待 cancel，确保资源释放动作真正落地。

> runWithTimeout 用 Promise.race 竞争 operation 与 timeout；定时器触发后保存 cancel 返回的 cancellation，并抛出含 timeoutMs 的 Error。catch 在存在 cancellation 时 await 它，再抛出原错误，使取消异常可被观察；finally 始终清理 timer。适用于限制 Agent 运行时长且超时后必须释放资源的调用点。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 重复迁移需保持结果幂等

迁移可重复执行，已关联有效会话的 run 不再重建。

> migrateLegacyAgentSessions 面向可重试执行设计：已有 sessionId 且 sessionStore.get 能找到目标时直接 continue；同一批内则用 migrationKey 复用 migrated 中的会话，并用 runStore.update 固化 sessionId 与 runtimeSessionId。这样升级脚本失败后可以安全重跑，避免同一成员、同一遗留运行时会话反复生成多条 session。适用前提是 Store 的 sessionId 查询稳定，且 runStore.update 能覆盖既有关联字段。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 迁移标识保留运行时会话边界

以成员和运行时会话组合隔离迁移键，并保留旧关联。

> 迁移运行时记录时，legacyRuntimeSessionId 优先取 run.runtimeSessionId，其次才取 run.sessionId；migrationKey 再组合 memberId 与该标识，使同一运行时上下文只在相同成员范围内复用 session。创建后必须把 session.id 和 legacyRuntimeSessionId 写回 runStore，不能把新 session.id 当成运行时路径或工作区定位依据。该规则适用于遗留运行记录接入 AgentSessionStore 的场景，尤其用于防止跨成员串接会话。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 会话工厂隔离底层记录存储

调用方只接触会话领域操作，不直接修改 records 持久化对象。

> createAgentSessionStore 将 createRecordStore 生成的 records 封装在闭包内，只返回 create、get、list、findByHandle 和 update 等领域操作。调用方无法直接替换或改写底层记录集合，也不需要知道 session.json 的位置；每次调用工厂得到的是独立封装。该边界适用于需要按项目隔离会话数据的 R2 模块，同时避免调用方绕过 memberId、scope 与 historical 过滤规则。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 文本增删量来自行级差异

countTextChanges 将 diff 操作按行累计，无法解码时返回零。

> countTextChanges 只在 previous 与 current 均为可解码文本时使用 diff 计算变更：diff.INSERT 对应 additions，diff.DELETE 对应 deletions，统计粒度由 countLines 决定。任一侧为 undefined 时直接返回零行增删，这一结果用于二进制或不可读内容的修改场景，不能据此宣称文件没有变化。该函数服务于 compareAgentWorkspaceSnapshots 的 modified 文件统计。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 行数规则排除尾随换行

countLines 避免把文件末尾换行额外计算成一行。

> countLines 以换行符拆分 content，并通过减去尾随换行产生的空片段计算实际行数；空字符串返回 0，内容不以换行结束时保留 split 的正常行数。该口径被 countTextChanges 用于累计 diff.INSERT 与 diff.DELETE 的文本行数，因此测试夹具和重放结果应使用相同尾随换行约定，不能用编辑器显示行数替代，否则增量统计会随文件结尾变化。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 快照同时保留字节与文本

SnapshotFile 用 bytes 保真，以可选 content 支持文本差异统计。

> SnapshotFile 要求保存 bytes，并可用 content 提供可比较文本。readDirectory 对不含零字节的文件设置 UTF-8 content，二进制文件则保留 bytes 且 content 为 undefined。compareAgentWorkspaceSnapshots 可先判断字节是否相等，再由 countTextChanges 统计文本增删。该约定用于工作区快照采集与差异计算，二进制内容不得强行解码。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 桥接类型随工厂演进

ChatAgentBridge由createChatAgentBridge的返回结构推导，避免公开接口与实现漂移。

> ChatAgentBridge使用ReturnType<typeof createChatAgentBridge>取得工厂的完整返回类型，不另写接口声明。新增handleMessage等公开方法或调整签名时，类型会随createChatAgentBridge同步变化，减少调用方编译通过但运行时契约不一致。适用于导出此类型供R2协作模块消费的场景；若工厂返回对象包含内部成员，应先区分公开契约，避免暴露内部状态。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 讨论上下文截取规则

buildDiscussion仅截取当前消息之前的成员发言，并限制最近二十条。

> buildDiscussion以lastChatMessageId定位起点，排除current.id及非member消息，再通过slice(-20)保留最近二十条成员发言并格式化为文本。找不到lastChatMessageId时，Math.max(0, start)使上下文从消息列表开头开始；找不到锚点时，findIndex返回-1并加一得到零。该规则用于构造Agent续接讨论时的prompt，避免当前消息重复、非成员事件污染，以及历史过长挤占运行上下文。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 空团队边界不可推断

ChatAgentBridge只描述工厂契约，运行期空集合行为仍由各方法定义。

> ChatAgentBridge作为ReturnType<typeof createChatAgentBridge>的推导类型，只固定createChatAgentBridge返回对象的公开结构，不会把listTeamAgents、listRuns等运行期集合的判定规则编码进类型。团队没有Agent时，parseMentions的输入集合为空；没有历史消息或run时，handleMessage仍需依据自身分支决定返回或继续。因此，调用方不能从ChatAgentBridge推断空集合结果，边界处理责任留在createChatAgentBridge及其依赖的AgentRunManager、ProjectRuntimeManager中。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 写操作采用串行队列

enqueue 串接操作并隔离失败，保证重试时执行顺序。

> createRecordStore 的 enqueue 将 operation 接到 operations 链尾，并通过 result 独立返回本次结果；前序失败不影响后续执行，使重试同一业务动作时写入仍按调用顺序发生。适用于需要落盘、创建或更新 RecordStore 记录的并发场景，调用方应保留业务幂等判断，不能依赖队列消除重复记录。

适用范围：`src/extracted/agent/recordStore.ts`

### 历史归档必须限制落盘范围

resolveArchivePath 将旧 ZIP 条目限制在目标目录内，避免迁移越界。

> resolveArchivePath 先用 path.resolve 合并 destination 与 entryPath，再确认结果以目标目录及 path.sep 开头，否则抛出 invalid path。字符串拼接可能使 ../、绝对路径或平台相关路径逃出目录，因此 ZIP 解压和历史归档导入落盘前必须检查，不能依赖上游条目列表。

适用范围：`src/extracted/archiveImport.ts`

### 关闭自动关闭以控制读取期

ZIP 句柄生命周期由解包流程统一管理。

> context：openZip 使用 yauzl.fromBuffer 时设置 autoClose 为 false，使 ZipFile 在 readEntries 和 openEntryStream 期间保持可读；资源释放交由 extractZipArchive 的 finally 调用 zip.close。该配置适用于从 Buffer 读取 ZIP 的导入流程，不适用于依赖解析库自行管理关闭时机的调用。validateEntrySizes 继续承担条目尺寸元数据校验。

适用范围：`src/extracted/archiveImport.ts`

### 运行结果按值交付

run 与 getDiff 的结果对象不应被调用方改写后反向影响运行时状态。

> AgentRuntime 实现向 run 交付 text、messageId，并向 getDiff 交付 AgentFileChange\[] 时，应提供调用方可安全读取的独立快照，避免后续修改返回值影响已保存的运行记录或事件数据。原因是这些接口暴露的是执行结果而非运行时内部存储句柄。适用范围为实现 AgentRuntime 的适配层及调用 run、getDiff 后继续消费结果的代码。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 提及仅解析候选句柄

parseMentions 只从候选集合识别去重后的小写提及。

> 背景规则是 parseMentions 不会把文本中的任意 @ 名称都视为 Team Agent；候选必须存在于 candidates 中。解析结果转为小写后按首次出现顺序收集，并通过 seen 去除重复项。适用于从聊天文本提取可通知成员的场景，可避免路径、邮箱或普通词组被误认成工作区内的句柄引用。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 每次装载都生成独立配置

loadConfig 返回新对象，调用方修改不会污染后续配置读取。

> 调用 loadConfig 会重新解析 env，并返回新建的 ServerConfig，调用方可独立修改 dataDir、workspacesDir、importRoots 与 agent 配置，不会改动 process.env 或其他调用者持有的对象。测试可传入自定义 NodeJS.ProcessEnv，生产代码默认读取 process.env；同一进程内的不同配置实例不会共享可变顶层值。

适用范围：`src/extracted/config.ts`

### 布尔解析失败即终止装载

非法布尔环境变量会使配置整体装载失败，不保留半成品状态。

> readBoolean 仅接受字符串 true 或 false，环境变量缺省时返回 defaultValue，其他取值均抛出 Error。loadConfig 组装 ServerConfig 时调用 readBoolean，因此 SIMPLERCP_TERMINAL_ENABLED 或 SIMPLERCP_FAKE_AGENT_RUNTIME 格式错误会中断装载，不会使用猜测值继续运行。该规则适用于所有布尔型服务开关。

适用范围：`src/extracted/config.ts`

### 统一规范化团队句柄

成员句柄入库前统一转为可比较的短格式。

> 团队句柄写入成员数据或参与提及解析前，必须经过 normalizeHandle：先去除首尾空白并转为小写，再把连续非字母数字字符替换为连字符，移除两端连字符，并截取前 32 个字符。这样可避免大小写、空白和分隔符差异导致同一成员被识别为多个对象，适用于成员句柄的规范化写入以及 parseMentions 读取文本中的提及。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 敏感变量读取与放行分层

敏感名称集合比身份匹配更广，Agent 场景仅保留明确允许的密钥。

> sensitiveNames 覆盖 KEY、TOKEN、SECRET、PASSWORD、COOKIE，buildEnvironment 据此决定敏感项能否进入结果。agent 为 true 时，例外保留 DEEPSEEK_API_KEY。该流程适用于 terminalEnv、agentEnv 等由 buildEnvironment 派生的环境构造流程。

适用范围：`src/extracted/processEnv.ts`

### 环境白名单与唯一例外规则

环境项须同时满足白名单和敏感过滤，Agent 密钥是唯一显式例外。

> buildEnvironment 将 baseNames 与 additional 合并为 allowed，只保留字符串值、名称未命中 identityNames，且不命中 sensitiveNames 的环境项；LC\_ 前缀项可额外通过。agent 模式例外允许 DEEPSEEK_API_KEY，随后用 SIMPLERCP_TERMINAL_HOME 覆盖 HOME。该规则适用于所有环境构建请求，以明确白名单控制标识注入并维持 HOME 的一致性。

适用范围：`src/extracted/processEnv.ts`

### 项目标识负责关联运行实例

项目列表以 project.id 去重，并清理没有注册表记录的运行实例。

> registerProjectRoutes 在读取项目列表时，先用 Set 收集 ProjectRegistry.listProjects() 返回的 project.id，再筛选 runtimeManager.listActive() 中不存在于该集合的 runtime，并调用 disposeProject。这样可防止已从注册表移除的项目继续占用运行资源；适用于执行 GET /api/projects 时对孤立运行实例进行生命周期收敛。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 读取接口隐藏密钥

查询仅返回设置与密钥是否已配置

> AgentSettingsStore.get 返回当前 settings 的副本，并附带 options.apiKeyConfigured 表示密钥是否已配置，不直接输出密钥内容。该设计让调用方能够判断配置状态，同时限制敏感配置的暴露范围，适用于面向客户端的 AgentSettingsResponse 查询场景。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 先写后读设置状态

设置更新后读取新状态，运行期间禁止变更关键配置。

> Agent 设置的写入顺序是校验 agent:settings 权限、读取 current、对照 nextSettings，再调用 agentSettings.update；后续 agentRuntime.status 读取应反映已完成的更新。agentRuns.hasActiveTasks 为真且 model 或 enabled 改变时必须拒绝写入，以避免运行中的任务混用新旧配置。该约定适用于 registerAgentRoutes 中 settings 更新与 status 查询的组合测试。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 成员标识来自请求身份

memberIdFor 只负责提取已认证请求中的成员标识。

> memberIdFor 从 req.identity 读取 memberId，并把缺失身份表达为 undefined，供 registerAgentRoutes 的调用方决定返回 401 或继续后续授权流程。该函数不生成新标识，也不推断项目成员关系；它适用于把统一认证上下文中的成员身份传给 AgentRunManager 等依赖。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 身份校验置于运行时读取前

敏感协作路由先完成身份校验，再访问项目运行时与成员状态。

> registerCollaborationRoutes 中的 room 查询和连接状态变更都在调用 runtimeManager.get 或处理 connectionId 前执行 requireIdentity；校验失败时立即结束当前处理。该顺序用于防止未认证请求借助项目标识探测运行状态，也避免无效身份进入离线标记流程。适用于房间、成员及连接生命周期相关路由。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 工作区写入先验权后落盘

工作区写路由依次校验写权限、确认项目成员身份，再执行文件变更。

> registerWorkspaceRoutes 注册的写接口先调用 requirePermission 校验写权限，再通过 requireMember 确认当前 memberId 是项目成员，最后调用 writeWorkspaceFile、createWorkspaceFile 等操作落盘。仅有接口权限不足以证明仍可参与当前项目，直接写文件可能绕过成员边界。该规则适用于工作区文件创建、修改及相关路径变更请求。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 文本增量以 Y.Text 为边界

applyTextDelta 接收 Y.Text 和前后文本，在运行时按差分更新。

> applyTextDelta 的类型边界固定为 Y.Text、previousContent 与 nextContent；调用方负责提供完整快照，函数通过 diff 识别 EQUAL、DELETE 和插入片段，再操作同一个 Y.Text 实例。这样做是因为 Y.Text 的位置会随 delete 和 insert 改变，而差分结果能保留原内容中的稳定片段。适用于协作编辑器同步、外部文件变更落盘等需要将两份字符串增量合并到共享文档的场景；不要把普通对象冒充 Y.Text 传入。

适用范围：`src/extracted/textDelta.ts`

### 新文件采用仅创建模式

createWorkspaceFile 以 wx 写入，避免覆盖既有目标文件

> createWorkspaceFile 固定以 UTF-8 文本持久化，content 默认是空字符串。虽先用 pathExists 检查 absolutePath，实际写入仍用 flag:"wx"，要求目标不存在，因此并发竞态不会静默覆盖已有文件，而会触发系统写入错误。适用于协作 Agent 新建文件及需保留既有成果的初始化流程；调用方应将“已存在”视为失败，不重试覆盖。

适用范围：`src/extracted/workspace.ts`

### 工作区重命名的覆盖保护

renameWorkspacePath 拒绝覆盖已有目标，并禁止重命名工作区根目录。

> 调用 renameWorkspacePath 时，fromPath 与 toPath 都必须先经 resolveWorkspacePath 归一化并限制在工作区范围内。目标路径若已由 pathExists 判定存在，函数直接拒绝重命名，防止误覆盖文件或目录；根路径则通过 isWorkspaceRoot 拦截。目标父目录不存在时可用 fs.mkdir 递归创建，随后执行 rename。规则适用于 R2 工作区内的文件和目录移动，不涉及工作区根目录改名或覆盖既有目标。

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

### 别名归一化后需再次校验

清理得到的别名不能绕过格式与保留词检查。

> normalizeHandle 负责去空白、转小写并整理连接符，但生成结果仍需交给 validateHandle 检查。原因是归一化可能产生保留名称、空值或不符合 HANDLE_PATTERN 的字符，继续校验才能阻止无效标识进入团队目录；该规则适用于成员创建、重命名以及 parseMentions 前的人工输入。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 保留别名不得通过校验

成员标识须同时满足格式和非保留约束。

> validateHandle 对不符合 HANDLE_PATTERN 或命中 RESERVED_HANDLES 的值直接抛出 Error，不应尝试自动修正后继续注册。原因是成员标识一旦生效就需要稳定引用，隐式改名会破坏关联；该规则适用于新成员创建、别名更新及任何写入成员目录前的入口校验。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 运行仓库类型绑定工厂

AgentRunStore 的公开类型直接取自 createAgentRunStore 的实例结果。

> 声明 AgentRunStore 时使用 ReturnType<typeof createAgentRunStore>，让公开类型随工厂签名变化而更新，避免单独维护一份接口后发生漂移；适用于 AgentRunStore 的导出定义及其调用方类型检查。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 规范加入参数保持稳定

NormalizedJoinInput 是运行时内存态输入，不是持续演进的持久化协议。

> NormalizedJoinInput 包含 participantId、connectionId 和可选 profileRole，createRoomStore 可据此执行 normalizeJoinInput 与 upsertConnection。运行时标识和展示信息可能变化，固化为持久化格式会增加旧数据兼容难度。该规则适用于房间加入参数归一化和成员同步，调整持久化结构时须单独定义兼容规则。

适用范围：`src/extracted/rooms.ts`

### 房间接口须校验身份

协作路由的成员与房间操作必须先完成请求身份校验。

> registerCollaborationRoutes 暴露的房间、成员与连接操作应在处理 req 前调用 requireIdentity；校验失败时立即结束请求，不继续访问 runtimeManager、MemberStore 或 ChatAgentBridge。该规则适用于 app 注册的协作 HTTP 路由，可防止未识别调用方读取 room 或修改成员、连接状态。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

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

### AgentRunStore 避免脱离工厂

AgentRunStore 的类型必须跟随存储工厂演进。

> AgentRunStore 应继续采用 ReturnType<typeof createAgentRunStore>，不要另行维护平行类型声明。这样存储方法调整后，调用方会在编译阶段暴露不兼容访问，避免运行期才发现 Agent 运行记录接口已变化；适用范围是 AgentRunStore 声明、createAgentRunStore 消费者及存储方法变更。

适用范围：`src/extracted/agent/agentRunStore.ts`

### 协作请求先校验身份

成员、消息与连接接口先验证请求身份，再执行项目级操作。

> registerCollaborationRoutes 中涉及成员、消息和连接变更的接口应先调用 requireIdentity，校验失败立即返回，不继续调用 MemberStore、ChatAgentBridge 或 ProjectRuntimeManager。该规则用于防止匿名请求读取或修改协作数据；新增同类路由时也须沿用这一入口。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 大文件读取须显式放行

readWorkspaceFile 对大文件采用受控读取策略。

> readWorkspaceFile 遇到超过 LARGE_FILE_BYTES 的文件时返回 status 为 large，而非直接把全文载入；只有 force 为 true 才继续读取文本内容。这样可避免工作区预览意外占用大量内存并拖慢服务，适用于文件读取接口、内容预览及任何调用 readWorkspaceFile 的导出流程。

适用范围：`src/extracted/workspace.ts`

### 身份对象限定四个字段

Identity只携带项目成员定位与展示所需字段。

> 定义Identity时使用Pick限制在projectId、memberId、displayName和role四个MemberRecord字段内。不要为临时权限判断扩展该类型，否则中间件会把展示资料与授权上下文混在一起。适用于createIdentityMiddleware生成身份以及后续路由读取身份信息的场景。

适用范围：`src/extracted/auth/identity.ts`

### 成员写入必须串行排队

createMemberStore的enqueue让文件操作按提交顺序执行。

> createMemberStore内的enqueue不要移除。每个新operation都应追加到operations链尾，并让链尾在成功或失败后继续推进，以串行化成员存储变更。直接并发执行save可能造成后写覆盖先写或原子写入相互干扰。适用于成员新增、更新和删除等会调用save的操作。

适用范围：`src/extracted/auth/identity.ts`

### 并发加载应合并请求

load 复用进行中的 Promise，避免同一成员文件被并发读取。

> createMemberStore 的 load 在缓存未命中时，应先检查 loading 中同 projectId 的 pending 操作；存在时复用该 operation，仅首次读取时调用 loadFile，并在 finally 中清理 loading。适用范围是同一进程内的并发成员加载，防止重复磁盘读取和缓存更新竞态。

适用范围：`src/extracted/auth/identity.ts`

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

### 拒绝空值与越界句柄

validateHandle 在写入前拒绝空句柄、非法字符及保留名称。

> 团队约定所有 Team Agent 句柄必须先经过 validateHandle；空字符串、超过 32 个字符、含大写字母或非允许字符的值，以及命中 RESERVED_HANDLES 的名称，均会抛出 Error，不得以空集合、默认名称或截断结果继续处理。该规则用于新建或更新成员时阻断非法标识进入后续流程。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

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

### 迁移写入不可并发

会话迁移的异步写入按顺序执行，避免并发更新造成关联错乱。

> migrateLegacyAgentSessions 对 sessionStore.list、sessionStore.update、sessionStore.create 和 runStore.update 均使用 await，并在循环内完成写入后再处理下一条 run。这样可保持迁移过程中的状态一致，避免多个 create 或 update 同时修改关联数据。该规则适用于旧 Agent 会话向新会话模型迁移的批处理场景；若改用 Promise.all，需先证明各写入之间不存在顺序依赖。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

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

### 旧会话迁移须传当前成员集

迁移前以当前项目成员ID集合界定合法会话，防止已移除成员数据进入新结构。

> 调用 migrateLegacySessions(projectId) 触发 migrateLegacyAgentSessions 时，须同时提供 getStore(projectId)、getSessionStore(projectId) 及成员ID集合。集合取自 options.members.listMembers(projectId) 的 memberId，以当前登记成员为迁移边界。调整成员模型或迁移规则时须同步维护该边界数据。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 取消运行也要合并两侧文件变更

取消路径分别采集工作区快照与运行时 diff，任一失败均写 trace 后继续。

> recordCancelledFileChanges 不能因运行被取消就忽略文件变化。该流程用 compareAgentWorkspaceSnapshots 对比 workspaceBefore 与 createAgentWorkspaceSnapshot，并从 options.runtime.getDiff 获取 runtimeChanges；两侧失败分别追加 file_changes_unavailable trace，随后由 mergeFileChanges 合并并交给 updateRun 写入 fileChanges。若合并结果非空，再追加 file_changes trace。取消收尾应保留此双路径采集约定，以免遗漏运行时已产生的改动。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 历史上下文需先校验

normalizeAgentContexts 拒绝非数组及非文件上下文，避免旧数据进入运行阶段。

> normalizeAgentContexts 将 undefined 视为未提供上下文，非数组值会抛出 Error；元素须为 type 为 file、path 为非空字符串的文件上下文，并清理 path 首尾空格。迁移历史 AgentRun 数据时不能靠 TypeScript 类型断言跳过运行时校验，否则脏数据会流入 buildRuntimePrompt。空数组返回 undefined，调用方应先完成规范化再启动 Agent。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 拒绝无效 Agent 上下文

文件上下文必须是非空路径；缺失与空数组语义不同。

> normalizeAgentContexts 仅接受 undefined 或数组，数组项须满足 type 为 file、path 为字符串且 trim 后非空，非法项会抛出 Error，避免无效路径进入 Agent 提示词。校验后用 map 重建仅含 type 与 path 的对象并过滤多余字段；空数组转为 undefined，使 buildRuntimePrompt 走无上下文分支，不生成空文件区段。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 可选能力不得伪装成默认值

AgentRuntime 的可选方法缺席与返回 false 含义不同，调用方必须区分。

> prepareWorkspace 不存在表示能力缺失，返回 false 表示准备失败。prepareRun 只能用 undefined 判断能力缺失，不能用空 Promise 代替，否则会掩盖真实运行时的准备失败。测试替身模拟不支持能力时可省略 prepareWorkspace，模拟执行失败时应保留方法并返回 false。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 会话历史记录不得直接迁移复用

旧版会话文件缺少必要身份字段时，按无效历史数据处理。

> 从旧服务迁入 Agent 会话时，不能把已有 session.json 直接视为可用的 AgentSession 数据；createAgentSessionStore 的 validateRecord 仅接受 id、projectId、memberId、title 均为字符串的记录，否则 createRecordStore 会按 invalidMessage 拒绝该文件。此做法避免缺少成员归属的旧会话进入成员查询或团队范围判断，适用于 R2 项目历史数据导入与兼容处理。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 设置文件须校验包裹结构

加载配置时须验证 AgentSettingsFile 包装层，禁止直接信任 settings。

> loadSettings 读取 AgentSettingsFile 后必须调用 validateSettingsFile，确认外层结构及 settings 字段均合法才返回内容。直接返回 parsed.settings 会绕过检查，使损坏或旧格式配置进入 AgentSettingsStore。文件不存在时，可使用 provider、model 和 enabled 组成的默认值；该规则适用于 storagePath 指向的全部设置文件。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 快照比较按字节判定变更

工作区差异先比较文件字节，再分类新增、删除和修改。

> compareAgentWorkspaceSnapshots 对 before 与 after 的路径取并集并排序，生成 AgentFileChange。两侧文件均存在时先调用 bytes.equals，字节相同则跳过；缺失分别标记 added 或 deleted，内容不同才标记 modified。该规则适用于工作区快照差异检测，不解释文本增删行。

适用范围：`src/extracted/agent/agentWorkspaceSnapshot.ts`

### 业务标识承担唯一性约束

id由调用方确定，createRecordStore不生成全局唯一标识。

> createRecordStore 直接以 record.id 作为 records 的键、目录名和查询参数，并未生成时间戳、随机串或项目内序号。若调用方复用 id，create 会因 records.has 为真而抛出 options.invalidMessage，更新也可能落到既有记录。新建记录时必须由调用方保证 id 在 options.root 的存储范围内唯一，并同时维持 record.id、record.projectId 与目录语义一致；该约束适用于 create、get、update 等接口。

适用范围：`src/extracted/agent/recordStore.ts`

### 归一化不可替代持久化校验

normalizeHandle 会清洗并截断输入，不能证明句柄合法。

> 负面经验：不要把 normalizeHandle 的成功返回视为句柄已获准持久化。该函数会移除首尾空白、转换大小写、替换非法字符并截断到 32 个字符，原本不合规的输入可能因此变成另一个有效句柄，造成显示值与原始值不一致或静默改名。外部输入进入成员记录前仍须经过 validateHandle，且持久化前应明确采用归一化后的规范值。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 单文件超限会中断解包

128 MiB 单文件限制会阻断当前归档导入。

> negative：遇到条目声明大小超过 MAX_FILE_BYTES 时，extractZipArchive 会直接抛出错误，不再写入该条目。团队不能把超限文件当作可跳过的普通内容，否则调用方可能误以为导入成功。MAX_FILE_BYTES 适用于 ZIP 内单个解压文件的容量判定；需要保留的大文件必须拆分到各自低于 128 MiB 的条目。

适用范围：`src/extracted/archiveImport.ts`

### 拒绝危险 ZIP 条目

归档导入前同时校验路径形态与条目类型，阻断目录穿越及非普通文件。

> 导入 ZIP 时，validateEntry 必须先检查 Entry.fileName，拒绝反斜杠、绝对路径、盘符路径及含 .. 的分段，并仅允许普通文件或目录。这样可避免恶意归档在 resolveArchivePath 前写出目标目录，也防止设备文件、链接被误导入。该规则适用于 extractZipArchive 接收的全部 Entry，不因来源可信而放宽。

适用范围：`src/extracted/archiveImport.ts`

### 空成员筛选保留团队会话

未指定成员时不得把团队会话误判为空结果。

> `createAgentSessionStore` 的 `list` 在未传入 `memberId` 时保留所有匹配作用域的会话；传入成员后，个人会话仅在 `historical` 为假且 `memberId` 相同时返回，团队会话按团队作用域处理。原因是成员筛选属于可选过滤条件，不能让无参数调用遗漏团队数据。适用范围是读取代理会话列表，以及通过 `scope` 区分 `personal` 与 `team` 的调用路径。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 句柄首字符不可缺失

HANDLE_PATTERN 要求句柄以小写字母或数字开头。

> 负面经验：句柄若以连字符开头，即使总长度落在 1 至 32 个字符内，也不会通过 HANDLE_PATTERN。团队新增或重命名 Team Agent 时，应从首字符起满足该表达式，不能先构造空主体再追加连字符。此规则同时约束 validateHandle 的输入结果，并影响 parseMentions 能识别的 @ 引用形式。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 固定仓库根目录引发版本冲突

defaultRepositoryRoot 固定指向模块位置，并行运行的不同版本可能使用不同根目录。

> defaultRepositoryRoot 通过 import.meta.url 固定到模块所在仓库层级，不同版本并行运行时可能采用不同根目录。若 loadConfig 未显式传入 repositoryRoot，依赖该位置解析 demoProjectRoot、dataDir 或 workspacesDir 时，状态可能写入不一致的位置。R2 集成和并行开发环境应显式传入 repositoryRoot，避免绑定单一安装副本。

适用范围：`src/extracted/config.ts`

### 配置结构不承担日志职责

ServerConfig 只保存运行参数，不应混入日志字段或可观测性状态。

> ServerConfig 仅承载 port、host、publicOrigin、dataDir、workspacesDir、demoProjectRoot、terminalEnabled、fakeAgentRuntime、importRoots 及 agent 配置，不把日志级别、请求标识或 trace 状态加入配置契约。这样可避免 loadConfig 每次解析环境变量时同时承担可观测性初始化，防止配置对象演变为运行期状态容器。新增日志或 trace 能力时，应在独立组件中读取所需配置，不要扩展 ServerConfig 形成跨层耦合。

适用范围：`src/extracted/config.ts`

### EventLog 类型禁止手工分叉

EventLog 始终由 createEventLog 推导，接口变化须改源头而非复制类型。

> EventLog 使用 ReturnType<typeof createEventLog> 从唯一工厂推导。复制一份同形接口会让调用方误以为 createEventLog 与实际日志能力完全一致，后续增加缓存失效或异步等待能力时便产生类型漂移。新增日志能力应修改 createEventLog 的返回契约，再由 EventLog 自动继承；该规则适用于所有引用 EventLog 的模块。

适用范围：`src/extracted/eventLog.ts`

### 事件标识不能依赖内存状态

事件 ID 应在每次 append 时生成，而非复用列表位置。

> EventLog 通过 ReturnType 继承 createEventLog 的公开结构，但事件身份仍由 append 中生成的 nanoid 决定。调用方不得把 events 数组下标当作稳定标识，因为过滤、持久化白名单或后续重载都会改变列表构成。需要跨调用、跨进程关联事件时，应保存 EventRecord.id，并为其附加业务可追踪字段，而不是依赖内存顺序。

适用范围：`src/extracted/eventLog.ts`

### 无效注册表必须拒绝

registry.json 缺失可初始化，结构损坏则直接报错。

> `loadRegistry` 仅在文件不存在时视为首次启动，返回 `version 1` 和空 `projects`；若 `parsed` 存在但 `version` 不是 1，或 `projects` 不是数组，则抛出 `Invalid project registry`。这样可区分“没有历史数据”和“历史数据已损坏”，避免用空集合静默覆盖项目。适用于读取或恢复 `registry.json` 的所有入口。

适用范围：`src/extracted/projects.ts`

### 跨盘迁移需保留时间戳

旧工作区跨文件系统迁移时，先复制到暂存目录，再原子切换到目标目录，并保留时间戳。

> migrateLegacyProjects 遇到 EXDEV 时不可直接假定 rename 成功，必须用 stagingPath 暂存：复制 legacyWorkspace 并设置 preserveTimestamps，再将暂存目录切换为 nextWorkspace，最后删除旧目录。这样可避免跨盘操作留下半迁移状态，同时维持文件时间信息；适用于旧版项目向 workspacesDir 搬迁及迁移重试。

适用范围：`src/extracted/projects.ts`

### 缺失成员统一抛出 Error

findMember 对不存在的房间或成员直接抛出 Error。

> 调用 findMember 查询成员时，若 findRoom 未能取得目标房间，或 room.members 中没有匹配 memberId 的成员，函数统一抛出 Error("Member not found")，不返回 null 或 undefined。该约定让房间成员缺失立即中断调用链，避免后续把无效成员写入成员列表、连接关系或权限判断；适用于所有依赖有效成员身份的内部读取流程。

适用范围：`src/extracted/rooms.ts`

### Agent 响应须限制体积

大结果应截断或分页，避免 trace 与导出响应拖垮路由进程。

> registerAgentRoutes 暴露的 trace、runs、events、sessions 与导出接口不得默认返回无限数据，测试大 trace、长事件流或批量导出时应设置明确上限并验证截断行为。超大 JSON 负载经 stringify 或传输会占满内存与连接，因此 AgentRuntime 状态查询、AgentRunManager 列表接口及 ndjson 导出路径均须限制体积，并保持截断标记和客户端识别方式一致。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 事件载荷缺少结构约束

AgentRuntimeEvent.data 接受任意键值，未约束事件数据形状。

> AgentRuntimeEvent.data 使用 Record\<string, unknown>，type 也只是 string，因此接口本身不会拒绝缺少约定字段、字段类型错误或夹带额外成员的事件载荷。消费者不能仅凭 AgentRuntimeEvent 类型就断言 data 已满足业务结构，必须根据 event.type 识别事件并校验 data 中实际需要的值。适用于事件生产、持久化、转发及回放入口。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 协作接口测试须隔离运行态

每个用例使用独立对象，并固定 Agent 的 Promise 结果与事件记录，避免共享状态干扰。

> registerCollaborationRoutes 接收 ProjectRuntimeManager、MemberStore 与 ChatAgentBridge，成员加入、消息处理和连接离线路径会改变运行态，因此测试应为每个用例构造独立实例。若复用这些对象，结果会受前序用例影响且失败难以重放；仅在明确验证跨请求状态时复用实例，并固定 ChatAgentBridge 的 Promise 结果与事件记录。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 请求失败统一交给错误中间件

路由内仅捕获并转交异常，避免把存储异常误报为参数错误。

> registerCollaborationRoutes 中，各处理器的 catch 应执行 next(error)，由统一错误中间件按 Error 实例和失败原因生成响应。不要局部吞掉异常，也不要把所有失败伪装成 400，以免掩盖 members.join、runtimeManager.get 等调用的真实故障语义。适用于该文件注册的全部协作 API。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 先持久化再读取运行态

项目路由必须先完成 registry 写入，再访问 runtime 和 agentRuns，避免读取未落库状态。

> registerProjectRoutes 中，新建、目录导入和 ZIP 导入须先等待 registry.createBlankProject、registry.importDirectory 或 registry.importZip 完成，再生成响应并访问 runtimeManager。颠倒顺序可能导致运行态取得未登记项目、缺失 room，或使 agentRuns 关联旧状态；适用于项目新增、导入及进入运行态的流程。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 目录导入边界风险

importDirectory 接收客户端路径，路径限制必须由注册表实现层强制落实。

> registerProjectRoutes 将 req.body?.path 直接转为 String 交给 registry.importDirectory，路由层未展示根目录校验、规范化或越界拦截。路径边界是 ProjectRegistry.importDirectory 的强制规则，不能仅依赖前端校验，否则可能读取工作区外文件或导入敏感目录。目录导入、恢复来源目录及任何接受本地路径的项目入口都应采用相同限制。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 缺省路径须显式归一化

工作区读取的缺失 path 转为空字符串，不能隐式传入 undefined。

> registerWorkspaceRoutes 在目录和文件读取接口中用 String(req.query.path ?? "") 生成 directoryPath 与 filePath。请求未携带 path 时，空字符串成为后续 listWorkspaceDirectory 或 readWorkspaceFile 的确定输入，避免 undefined 因参数类型和调用语义产生歧义。适用对象是 GET workspace/directory 与 GET workspace/file；force 则仅在 req.query.force 严格等于 "true" 时启用。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 成员校验必须同步完成

requireMember 是同步门禁，不承担异步成员加载。

> requireMember 直接调用 runtime.rooms.getMember，并同步取得 runtime.room.id 对应的成员；查不到就抛出 Error("Project membership is required")。该函数没有队列、Promise 或异步等待逻辑，因此不要把尚未完成登记的 memberId 当作可继续执行的条件，也不要通过 await requireMember 暗示额外一致性。适用于工作区写操作执行前的成员校验；需要等待成员创建完成时，必须先由上游流程完成，再进入这些路由。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 工作区变更逐项广播

批量目录操作不能替代逐路径变更事件。

> registerWorkspaceRoutes 将目录创建、文件创建、删除与重命名分别映射为 createWorkspaceDirectory、createWorkspaceFile、deleteWorkspacePath 和 renameWorkspacePath，并配套 workspace_directory_created、workspace_file_created、workspace_path_deleted、workspace_path_renamed 等事件标识。采用逐项语义是为了让 Agent 精确区分受影响路径，而不是只看到一棵目录树整体变化。适用于工作区写路由及其事件消费方；实现批量操作时仍须保留每个目标路径的独立通知与重命名两端信息。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 文件读取不代表稳定版本

readWorkspaceFile 不锁定文件版本，存在并发写入冲突风险

> readWorkspaceFile 的检测与正文读取不是原子快照，文件在 stat、sample 检测与 fs.readFile 之间被并发写入或替换时，size、binary/large 状态可能与最终 content 不一致，且缺少版本标识。需要一致性时，上层应增加版本校验或写入协调；适用于协作 Agent 并发编辑及读取大文件。

适用范围：`src/extracted/workspace.ts`

### 目录创建失败不承诺幂等

createWorkspaceDirectory 遇到已存在路径会报错而非复用目录

> createWorkspaceDirectory 将目标已存在定义为失败：resolveWorkspacePath 生成 absolutePath 后，pathExists 为真便抛出 Error，以避免误认其他 Agent、权限配置或历史流程留下的目录。recursive:true 仅允许创建缺失的父目录，不改变目标目录必须全新的约束，适用于工作区结构初始化及需确认目录所有权的场景。

适用范围：`src/extracted/workspace.ts`

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

### 运行前先确认工作区就绪

AgentRuntime 启动任务前应完成工作区准备，并明确失败返回行为。

> 实现 AgentRuntime 时，prepareWorkspace 应在工作区不可用时返回 false，调用方据此停止 prepareRun 或 run，避免把请求送入错误目录；该约束只覆盖准备阶段，不改变后续执行结果的判定方式。

适用范围：`src/extracted/agent/agentRuntime.ts`

### Agent 提及须先解析再触发

createChatAgentBridge 仅对有效 mentions 启动或中断 Agent 任务。

> handleMessage 应先用 parseMentions 提取 mentions，再匹配 listTeamAgents 返回的 agent.handle；没有提及或未匹配 Agent 时，仅返回 updateMessage，以避免非 Agent 消息提前制造无来源任务。适用于 Agent 任务创建、活动任务中断及讨论上下文组装，范围限于 chatAgentBridge 消息处理流程。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 成员复用按参与者标识查找

findExistingMember 只用 participantId 判断成员是否已经存在。

> findExistingMember 在 members 集合中查找 participantId 与 input.participantId 相等的 RoomMember，不以连接标识或显示名称作为等价条件。该做法适用于 createRoomStore 的重复入房判断，可防止重连或刷新显示名时被误判为新成员；调用方仍需分别处理连接和展示信息同步。

适用范围：`src/extracted/rooms.ts`

### 成员文件版本约定

MemberFile 固定使用 version: 1，并通过 members 保存记录集合。

> 创建成员存储时，MemberFile 应声明 version: 1，并把成员数组放入 members；不要在初始化数据中另造版本字段或用单个成员对象替代数组。这样便于按 MemberFile 结构恢复集合，适用范围为 createMemberStore 初始化及持久化成员文件。

适用范围：`src/extracted/auth/identity.ts`

### 项目元数据路径必须显式存在

读取项目元数据位置前先验证 metadataPath，避免后续访问无效路径。

> 调用 getProjectMetadataPath 时，ProjectRecord.metadataPath 为空应立即抛出 Error，不应返回空字符串或猜测目录。该规则用于所有依赖项目元数据路径的读取与迁移流程，可防止项目定位错误扩散到 writeProjectMetadata 等后续操作。

适用范围：`src/extracted/projects.ts`

### Team 句柄须先校验

Team Agent 的句柄需通过格式与保留名检查后才能继续处理。

> 调用 validateHandle 时，先用 HANDLE_PATTERN 检查 handle 是否符合 1—32 位小写字母、数字或连字符的格式，再用 RESERVED_HANDLES 排除系统保留名称；任一条件不满足就抛出 Error。该规则适用于创建或接入 Team Agent 前规范化句柄的场景，可避免无效名称进入后续的 parseMentions 与 normalizeHandle 流程。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 新建文件禁止覆盖旧文件

createWorkspaceFile 只负责创建新路径。

> createWorkspaceFile 必须先用 pathExists 检查 absolutePath，发现目标已存在就抛出 Error；不存在时使用 writeFile 的 wx 标志创建文件。预检查用于给出明确业务错误，wx 用于处理并发创建时的覆盖风险，因此修改该函数时应保留“不覆盖既有文件”的边界，适用于工作区新建文件操作。

适用范围：`src/extracted/workspace.ts`

### 保留句柄不得用于通知

RESERVED_HANDLES 集中登记不可选作具体接收者的句柄。

> RESERVED_HANDLES 收录 system、all、here、everyone 等保留字。validateHandle 应拒绝这些值，parseMentions 也不得把它们作为具体成员通知。该做法适用于团队 Agent 句柄注册与提及解析，可防止群体表达被误当作个人句柄。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### MemberRecord 缺省值处理

MemberRecord 字段缺失时须按成员存储约定补齐

> 在构造或读取 MemberRecord 时，memberId、projectId、displayName、role、createdAt 和 updatedAt 都应使用稳定且可追溯的值；缺少必要字段时由 createMemberStore 采取明确的缺省策略，避免生成空成员记录。这样可保证 MemberFile 持久化后仍能被后续身份匹配与项目筛选使用。

适用范围：`src/extracted/auth/identity.ts`

### 会话标识须避免碰撞

createAgentSessionStore 负责生成可区分的会话标识。

> createAgentSessionStore 创建存储实例时，应让每个会话标识具备唯一性，并在 AgentSessionStore 的生命周期内保持可定位。否则并发请求可能错误复用旧会话状态。该要求适用于会话建立、恢复及后续读取，不涉及成员资格或展示信息。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 成员路径跟随项目元数据

成员文件必须定位到所属项目的元数据目录。

> createMemberStore处理成员数据时，应先通过findProject确认项目存在，再用projectDataPath和getProjectMetadataPath取得项目目录，最终访问其中的members.json。不得依据请求中的任意文件路径加载成员数据，否则可能跨出项目工作区。适用于load、loadFile以及旧participants.json迁移读取。

适用范围：`src/extracted/auth/identity.ts`

### 成员文件加载须规范旧数据

loadFile 验证文件版本并迁移旧 participants 数据。

> createMemberStore 的 loadFile 应校验 MemberFile.version 与 members 数组；发现旧 participants.json 时映射为 memberId、projectId 等成员记录，验证关键字段后按需调用 save，并更新 cache。适用范围是成员文件读取及旧格式兼容，不用于放宽记录校验。

适用范围：`src/extracted/auth/identity.ts`

### 工作区成员先查后用

工作区操作应先通过 requireMember 取得成员记录，再继续后续处理。

> registerWorkspaceRoutes 处理请求时，应先调用 requireMember，并由 runtime.rooms.getMember 按当前 runtime.room.id 定位成员。查找失败时立即抛出 Error，查找成功才使用返回的 member；该顺序适用于工作区内以成员为对象的操作入口，可避免后续逻辑使用不存在或仅由参数构造的成员信息。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

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

### 成员存储串行化写入

通过 Promise 队列串行执行成员存储操作，避免并发写入破坏文件状态。

> 教程：在 createMemberStore 中新增写入任务时，统一交给 enqueue 处理，不要直接并发调用 save。enqueue 先把 operation 接到 operations 之后，再将队列恢复为成功或失败后都能继续执行的 Promise。这样可避免成员文件更新时出现写入交错或旧内容覆盖新内容。该做法适用于同一 MemberStore 实例内的成员文件创建、保存等所有会改变持久化状态的操作；不同实例之间不提供协调。

适用范围：`src/extracted/auth/identity.ts`

### 缺省目录可随模块稳定定位

教程：通过 repositoryRoot 缺省参数复用仓库相对路径。

> 调用 loadConfig 时若省略 repositoryRoot，函数会采用 defaultRepositoryRoot；该值由 fileURLToPath 和 import.meta.url 相对定位，而不读取 process.cwd()。编写测试或嵌入程序时，可先准备 ProcessEnv，再调用 loadConfig(env)；需要隔离数据时显式传入目标 repositoryRoot。此做法适用于依赖仓库相对目录的默认配置，避免从不同工作目录启动后找不到 .simplercp-data 或演示项目。

适用范围：`src/extracted/config.ts`

### 先校验配置再做权限判断

权限处理只能消费已通过 loadConfig 校验的 ServerConfig。

> 涉及 terminalEnabled、fakeAgentRuntime、importRoots 与 agent.apiKey 的权限判断，应在 loadConfig 成功返回 ServerConfig 后执行，再把对应字段传给检查逻辑。这样可确保端口、绝对路径、URL 协议和布尔格式已经校验，避免权限分支依据非法配置作出错误决定。该规则适用于 R2 的终端、Agent、导入目录及密钥访问场景。

适用范围：`src/extracted/config.ts`

### 先校验迁移输入

执行旧数据迁移前，先核对项目标识、存储实例与成员集合。

> 调用 migrateLegacyAgentSessions 前，先确认 projectId 非空，runStore 与 sessionStore 均提供 list、get、create、update 能力，并确保 memberIds 是用于判断历史会话的成员集合。函数会依据 memberIds 决定 session.historical；若集合包含无关或过期成员，迁移分类将失真。适用于旧 AgentRunStore 和 AgentSessionStore 数据进入新模型前的启动检查。

适用范围：`src/extracted/agent/agentSessionAccess.ts`

### 批量更新复用单项加入流程

批量成员操作应逐项走 joinRoom，避免绕过连接去重与在线状态同步。

> 批量加入成员时，应逐项调用 createRoomStore 返回对象上的 joinRoom，而不是直接向 RoomState.members 追加数据。joinRoom 会先执行 normalizeJoinInput，再通过 findExistingMember 判断新成员还是重入；两条路径都会调用 upsertConnection、syncMemberFromConnections 与 refreshDisplayNames，并写入 member_joined 或 member_rejoined 事件。批量实现若绕过这些步骤，会造成连接计数、显示名和事件日志互相不一致，因此该规则适用于初始化成员、导入名单及自动化协作场景。

适用范围：`src/extracted/rooms.ts`

### 协作接口注册做法

在统一函数中挂载项目协作路由，并沿用现有身份校验与错误转发模式。

> 新增或调整项目协作接口时，统一在 registerCollaborationRoutes 中注册对应的 app.get、app.post 或 app.patch 路由。处理器沿用 requireIdentity、async/await 与 try/catch 结构：需要身份的请求先调用 requireIdentity(req, res)，异步成员操作通过 await members.listMembers 或 await members.join 执行，异常交给 next(error)。这样可让成员列表、入会和连接状态接口共享同一套鉴权、异常传播及维护入口，适用于 src/extracted/routes/collaborationRoutes.ts 内的协作 API。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 队列单执行器复用完成态

processQueue 复用同一处理循环，避免项目队列并发执行多个运行。

> 启动项目队列时，先从 getQueue(projectId) 取得 ProjectQueue；若 queue.processing 已为 true，直接返回现有 queue.completion。新的处理循环通过 queue.runIds.shift() 顺序取出 runId，并逐个 await executeRun(projectId, runId)。finally 负责复位 queue.processing，使后续入队请求仍能启动新循环；disposing 为真时停止继续取任务。适用于同一项目内多个 Agent 运行需要串行执行的场景。

适用范围：`src/extracted/agent/agentRunManager.ts`

### 用 previewPrompt 压缩界面预览

折叠空白并截断超长提示词，供紧凑界面展示而非替代完整输入。

> 界面展示 Agent 提示词时调用 previewPrompt：先以 replace 将连续空白归一化，再用 trim 清除首尾空格；超过 120 个字符时通过 slice 保留前 117 个字符并追加省略号。该做法降低长提示词对布局的占用，同时避免把 previewPrompt 的结果写入持久化记录；完整提示词仍由 buildRuntimePrompt 消费，运行时上下文不会因预览压缩而丢失。

适用范围：`src/extracted/agent/agentRunSupport.ts`

### 会话存储排查顺序

排查会话问题先看 session.json 与 validateRecord，再看 list 过滤与排序。

> 调试 agent 会话丢失或列表为空时，按固定顺序查：先确认 projectRoot 下 agent-sessions/session.json 是否存在且通过 validateRecord（id、projectId、memberId、title 均为 string）；再确认 list 的过滤条件——scope 参数不匹配即被剔除，memberId 存在时非 team 会话还要求 historical 为 false；最后才看按 updatedAt 的 localeCompare 倒序是否把目标记录排到了后面。findByHandle 只在 scope 为 team 时命中，用来定位被 handle 引用的团队会话。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 会话列表按边界过滤

成员与 scope 参数共同收窄结果，空值和 team 规则需明确处理。

> 使用 createAgentSessionStore 返回的 list 时，应按 memberId 与 scope 设计边界用例：缺少 memberId 可返回全部匹配 scope 的记录；指定 memberId 后，personal 会话仅匹配同成员且排除 historical，team 会话仅在 scope 为 team 时可见。结果再按 updatedAt 降序排列。该规则适用于会话检索，空集合应自然返回空数组，findByHandle 也只匹配 team 会话。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 从工厂推导桥接层类型

通过工厂返回类型约束桥接层契约，避免接口与实现脱节。

> 在 TypeScript 中将 ChatAgentBridge 定义为 ReturnType<typeof createChatAgentBridge>，让公开类型直接跟随工厂函数的实际返回值。修改 createChatAgentBridge 的返回结构时，编译器会检查 ChatAgentBridge 的使用者是否需要同步调整，减少接口声明与运行时分发不一致的问题。该规则适用于 chatAgentBridge.ts 中工厂产物的导出边界；若业务需要额外表达参数化类型，则应先建立独立契约，而不是手写与工厂脱节的返回结构。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 迁移时保留会话游标

迁移聊天历史须保留可定位的 chatMessageId，避免上下文错误重放。

> buildDiscussion 以 lastChatMessageId 查找上次任务对应消息，并截取其后最多 20 条 member 消息。迁移旧记录时须保持消息 id 稳定、游标可解析，否则 findIndex 无法命中或从 0 开始带入更早记录。仍应保留 authorName、text、kind 等上下文数据。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 从工厂推导存储类型

使用 ReturnType 保持 AgentSessionStore 与工厂实现同步。

> 定义 AgentSessionStore 时，通过 ReturnType<typeof createAgentSessionStore> 获取完整方法签名，不再手写重复接口。新增或调整工厂方法后，类型会自动跟随，避免调用方按旧结构编写代码；该做法适用于需要引用 createAgentSessionStore 返回值类型的模块边界和工具函数。

适用范围：`src/extracted/agent/agentSessionStore.ts`

### 用 Promise 封装条目流创建

openEntryStream 将回调式 openReadStream 统一为可等待的流接口。

> 调用方通过 openEntryStream 获取 Promise，创建流发生 error 时立即 reject，成功取得 stream 后 resolve，再消费 NodeJS.ReadableStream。该约定适用于 extractZipArchive 内部逐项读取及需要统一异步错误传播的协作模块，避免重复包装回调，并防止流创建失败被误当作成功读取。

适用范围：`src/extracted/archiveImport.ts`

### 总解压量采用双重校验

声明量与实际流量共同受 1 GiB 总限额约束。

> MAX_TOTAL_BYTES 规定单次归档最多产生 1 GiB 解压数据，extractZipArchive 同时累加 entry.uncompressedSize 并通过 countBytes 统计 extractedBytes。双重校验用于识别元数据超限和压缩数据实际展开超限，防止 ZIP 条目伪造大小。该规则适用于 extractZipArchive 管理的全部 ZIP 导入，并发导入也应分别核算各自上限。

适用范围：`src/extracted/archiveImport.ts`

### 空归档不产生解压文件

空 ZIP 可正常结束并返回零过滤数量。

> extractZipArchive 接收空集合时，readEntries 返回空 entries，accepted 保持为空，函数仍创建 destination，最终返回 filteredEntries 为 0，因为 accepted 循环不会执行。适用于合法但没有条目的 ZIP 边界输入；目录条目可单独创建目录，文件条目使用 wx 标志避免覆盖既有目标。

适用范围：`src/extracted/archiveImport.ts`

### 逐项读取并限制条目数

readEntries 采用惰性遍历，并将归档条目数限制为五万条。

> readEntries 应监听 zip 的 entry 事件，每次调用 zip.readEntry() 推进读取，并在 entries.length 超过 MAX_ENTRY_COUNT 时拒绝。这样可避免一次性加载大量目录项放大内存与遍历成本。规则适用于 openZip 获得的 ZipFile；调用方须处理 Promise 拒绝，并可用 extractZipArchive 的 finally 确保句柄关闭。

适用范围：`src/extracted/archiveImport.ts`

### 将条目限制在目标目录

resolveArchivePath 用绝对目标前缀复核最终落点，禁止归档越出解压目录。

> 调用 resolveArchivePath 时，先用 path.resolve(destination, entryPath) 得到规范路径，再与 path.resolve(destination) 加 path.sep 组成的前缀比较；不满足 startsWith 即抛出 Error。此做法用于抵御路径穿越、目录名碰撞及不规范的相对路径，并确保每个条目只能写入指定 destination。该边界检查适用于 extractZipArchive 处理的所有归档路径，validateEntry 仍承担前置格式校验。

适用范围：`src/extracted/archiveImport.ts`

### 空讨论输入的桥接处理

构造讨论数据时先统一空集合边界，避免桥接层接收不一致输入。

> 调用 createChatAgentBridge 时，buildDiscussion 负责把上游输入整理为讨论对象；对于空数组、空文本等边界输入，先采用明确且稳定的默认值，再交给 ChatAgentBridge。这样可避免协作流程把缺失内容误判为有效讨论，并让后续 Agent 执行获得一致的上下文。该做法适用于项目、成员或聊天模块向桥接层传递初始讨论数据的场景。

适用范围：`src/extracted/agent/chatAgentBridge.ts`

### 设置文件采用版本化结构

持久化设置需保留版本标记，便于识别文件格式。

> 团队约定：AgentSettingsFile 必须同时包含 version: 1 与 settings: AgentSettings，读取时由 validateSettingsFile 校验外层结构，保存时由 saveSettings 维持该结构。原因是要让格式演进具备明确判据，避免旧文件或字段残缺的数据被当作有效设置。适用于 createAgentSettingsStore 管理的配置文件及所有经过 AgentSettingsStore 访问的设置数据。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 读取结果隔离调用方修改

设置读取返回副本，避免外部变更污染缓存状态。

> 团队做法：AgentSettingsStore.get 返回展开 settings 后的新对象，而不是直接暴露内部状态；apiKeyConfigured 作为独立运行态字段合并进结果。调用方即使修改返回对象，也不会改变 store 保存的设置快照。适用于 createAgentSettingsStore 暴露的读取接口及任何消费 AgentSettingsResponse 的上层代码。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### 空导入列表不等于授权目录

ServerConfig.importRoots 为空时，导入流程必须拒绝路径访问。

> ServerConfig 将 importRoots 定义为可选字符串数组，但可选和空数组都不能被视为存在可导入目录。配置装载后，导入逻辑仅在 importRoots 含有至少一个有效绝对路径时才放行；未配置时产生的空集合应直接返回无权限结果，而不是回退到仓库根目录或其他宽泛路径。该规则适用于项目导入和文件访问入口。

适用范围：`src/extracted/config.ts`

### 仓库根目录按模块位置推导

defaultRepositoryRoot 从当前模块路径计算可迁移仓库根目录。

> 迁移 R2 时不要把仓库路径写死为机器相关目录；沿用 defaultRepositoryRoot，通过 fileURLToPath 和 URL 将 import.meta.url 下的相对位置转换为文件系统根路径。该做法使独立部署仍能从模块所在位置推导资源目录，也便于迁移时保留原有项目与历史数据访问方式；调整目录层级时必须同步检查该常量及 loadConfig 的相关配置。

适用范围：`src/extracted/config.ts`

### EventFile 夹具保留版本

构造 EventFile 测试夹具时必须保留版本号与完整事件集合。

> 测试和重放场景构造 EventFile 时，version 固定为 1，events 放入 EventRecord 数组。loadEvents 会依据这两个结构判断文件能否恢复；省略版本或把事件集合改成非数组都会触发无效文件错误。夹具应覆盖一条或多条真实事件，以验证加载后的顺序与内容，而不是只建立空壳对象。该做法适用于所有供 loadEvents 读取的持久化样本。

适用范围：`src/extracted/eventLog.ts`

### 用订阅事件建立运行观测

通过订阅跟踪会话阶段，并为状态变化补充结构化上下文。

> 排查 AgentRuntime 执行问题时，应先 subscribe 到目标 sessionId，再发起 run，并记录事件 type、发生阶段及关联 messageId；listener 收到事件后可用 status 核对当前运行状态。需要终止观察时调用 subscribe 返回的释放函数，避免重复订阅造成日志噪声。原因是分散记录单次调用无法还原 prepareRun、run 与 cancel 之间的阶段关系。适用范围为 AgentRuntime 的联调、故障定位和运行轨迹采集。

适用范围：`src/extracted/agent/agentRuntime.ts`

### 运行态凭据状态不改写设置

读取接口附加凭据就绪状态，不将其持久化进设置。

> 团队做法：createAgentSettingsStore 内部 get 返回 settings 的浅拷贝，并附加 options.apiKeyConfigured。这样调用方既能看到 AgentSettings 内容，也能获得当前运行态的凭据可用性，同时不会把该状态混入可保存的 AgentSettings。适用于通过 AgentSettingsStore 查询配置以及展示设置状态的调用链。

适用范围：`src/extracted/agent/agentSettingsStore.ts`

### Demo 元数据兼容重建

重建 demo 时沿用既有持久化字段，确保旧注册表可继续读取。

> `createDemoProject` 重建 demo 时沿用现有持久化约定：id 固定为 `demo`，source 写为 `demo`，并保留 `createdAt`、`lastOpenedAt`、`workspacePath` 与 `metadataPath`。已有工作区不会再次复制源目录，但仍会调用 `writeProjectMetadata` 刷新项目元数据。适用于 demo 初始化、工作区丢失后的自动恢复，以及旧版 registry 与当前项目记录格式并存的环境。

适用范围：`src/extracted/projects.ts`

### 会话夹具复用成员身份

通过 memberIdFor 注入稳定成员身份，确保 Agent 会话测试可重复。

> 构造 Agent 会话请求夹具时，从 req.identity.memberId 取得成员标识，并为同一成员固定该值，不要随机生成，使 listSessions、getSessionForMember 及创建会话测试稳定命中同一成员数据。memberIdFor 只负责提取身份，夹具仍需设置 req.identity；缺少身份的场景单独覆盖未认证分支，避免混淆成员过滤与登录校验。

适用范围：`src/extracted/routes/agentRoutes.ts`

### Agent 设置更新流程

通过依赖注入注册 Agent 路由，并限制运行期间修改关键设置。

> registerAgentRoutes 通过 dependencies 接收 agentRuntime、agentRuns 与 agentSettings，三项依赖由调用方集中提供，避免路由直接创建运行组件。更新 /api/agent/settings 时，先检查 agent:settings 权限，再比较 nextSettings 与 current 的 model、enabled；只要 agentRuns.hasActiveTasks() 为真，就拒绝改动，防止进行中的任务因模型或启用状态变化而失去一致语义。其余路由沿用 requireIdentity、requirePermission 或 memberIdFor 判定访问者，适用 于 Agent 设置、状态及项目会话接口的注册。

适用范围：`src/extracted/routes/agentRoutes.ts`

### Agent 状态读取保持直读

状态与设置接口直接读取存储，不引入本地缓存。

> registerAgentRoutes 的 GET /api/agent/settings 直接调用 agentSettings.get()，状态接口直接调用 agentRuntime.status()，二者都没有在路由层保存结果副本。这样可让写入后的设置和运行状态立即反映在后续读取中，避免缓存失效遗漏导致 agentRuns.hasActiveTasks 与实际任务状态不一致。该做法适用于 Agent 全局设置和运行状态这类低频、短响应查询；扩展接口时不要另建局部缓存，若 AgentRuntime 内部采用缓存，应由其负责失效并暴露一致的 status 结果。

适用范围：`src/extracted/routes/agentRoutes.ts`

### 消息重试必须复用标识

聊天重试应沿用 chatMessageId，避免重复投递与任务。

> registerCollaborationRoutes 接入 ChatAgentBridge 后，客户端或网关重试聊天请求时，应携带原 chatMessageId，并在服务端先查找已有 message；若 createMessage 已存在，则返回同一消息及既有处理状态，不要再次触发 handleMessage。这样做是因为网络确认丢失不等于处理失败，重复调用 Agent 会造成事件重复、额外任务和顺序污染。适用范围是 ChatAgentBridge 的消息创建、Agent 执行与恢复流程；若当前实现只按文本去重，团队应改为以 chatMessageId 作为幂等键，并让 append 和 start 能识别已完成的候选任务。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 事件读取应限制返回规模

事件查询需设置数量或时间窗口，避免无界列表拖垮协作服务。

> registerCollaborationRoutes 下的 events、messages 等历史查询应设置 limit、游标或时间窗口，并按时间稳定排序。否则响应会随项目运行时间持续膨胀，增加序列化与传输成本。该规则适用于历史查询端点，实时订阅不能由轮询全量列表替代。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 先规范化再校验句柄

成员句柄须先经 normalizeHandle 规范化，再交给 validateHandle 判断。

> 调用 validateHandle 前，先用 normalizeHandle 去除首尾空白并转为小写，将连续非字母数字字符折叠为连字符，移除两端连字符，再截取前 32 个字符，避免大小写、空格或分隔符差异导致匹配失败。规范化结果仍须检查 HANDLE_PATTERN，并确认未命中 RESERVED_HANDLES；适用于 parseMentions 解析的成员句柄及成员创建、查找等入口。

适用范围：`src/extracted/agent/teamAgentSupport.ts`

### 缺省角色不要伪装成角色

可选角色缺失时保留 undefined，成员展示名则规范化为字符串。

> registerCollaborationRoutes 对 req.body.role 仅在类型为 string 时传递，否则传入 undefined；对 req.body.name 使用 String(req.body.name ?? "")，保证 displayName 始终是字符串。响应中的 profileRole 同样通过 member.role || undefined 省略空值。该约定用于区分“未提供角色”和有效角色字符串，避免默认角色被误判为用户权限，适用于成员加入和参与者列表序列化。

适用范围：`src/extracted/routes/collaborationRoutes.ts`

### 缺省输入统一归一为空串

项目名称与导入路径缺省时先经 String 和空值回退归一，再交给 ProjectRegistry。

> registerProjectRoutes 对 req.body?.name、req.body?.path 和 req.query.name 都采用 String(value ?? "") 的归一方式，再传给 registry.createBlankProject、registry.importDirectory 或 registry.importZip。这样可避免 undefined、null 直接进入注册表导致调用方行为不一致，也统一了可选请求字段的形状。新增项目输入字段时应沿用同一策略；ZIP 内容本身则必须通过 Buffer.isBuffer 单独验证。

适用范围：`src/extracted/routes/projectRoutes.ts`

### 工作区读取的失效策略

目录读取实时刷新，文件读取由 force 控制缓存失效。

> registerWorkspaceRoutes 中，listWorkspaceDirectory 每次依据 runtime.project.workspacePath 重新枚举目录；readWorkspaceFile 仅在 force 严格等于 "true" 时强制刷新，避免普通读取绕过缓存。适用于工作区读取接口；内容陈旧时应传入 force=true，不得删除或重建 workspacePath。

适用范围：`src/extracted/routes/workspaceRoutes.ts`

### 跨模块先对齐文本快照

调用 applyTextDelta 前须取得同一文档的 previousContent 与 nextContent。

> 跨模块调用 applyTextDelta 时，先从同一协作文档取得 previousContent，并准备描述同一内容序列的 nextContent，不能使用未同步副本。函数依据 diff 的 EQUAL 与 DELETE 推进 index，并把新增片段写入 text；基线不一致会导致插入、删除位置错误。适用于工作区文件变更、聊天内容编辑及 Agent 修改结果回写，传入对象须为真实 Y.Text 实例。

适用范围：`src/extracted/textDelta.ts`

### 按协议类别选择错误边界

校验失败应落在协议入口，并按客户端、服务端及终端消息区分错误。

> 输入校验须在各协议入口执行，并转换为对应层级的错误结果。聊天或编辑参数依据 ChatMessage、EditRange 验证，终端输入走 TerminalClientMessage 专属通道，服务端回包按 ServerMessage 检查。这样可避免把不可信客户端数据误当服务端事实。适用于客户端、服务端及终端消息接入。

适用范围：整个项目

### 用状态变更顺序约束读取

写入先形成 WorkspaceChange，再读取节点或文件结果，避免观察半完成状态。

> src/extracted/types.ts 同时公开 WorkspaceChange、WorkspaceDirectoryNode、WorkspaceFileNode 与 WorkspaceFileLoadResult，因此实现工作区流程时需明确先后：写入产生 WorkspaceChange，确认应用后再读取 WorkspaceFileNode 或 WorkspaceFileLoadResult。若读取早于变更落定，调用方可能拿到旧目录或旧文件内容；先写后读则让观察结果与已确认变更保持一致，并便于检测落盘失败。

适用范围：整个项目

### 路径忽略检查的放置方式

isIgnoredPath 应在权限处理前拦截目录段与系统文件，避免读取后过滤触发副作用。

> 先调用 isIgnoredPath，再判断成员能否访问工作区路径，可阻断 node_modules、.git、\_\_MACOSX 与 .DS_Store。将 relativePath 按斜杠或反斜杠拆分并过滤空段，交由 IGNORED_SEGMENTS.has 判断，同时用 path.basename 捕获根目录系统文件。该规则适用于路径规范化后的访问判定。

适用范围：`src/extracted/workspacePolicy.ts`

### 幂等重试沿用固定忽略表

重试文件操作时复用 IGNORED_SEGMENTS，避免不同轮次改变过滤口径。

> 文件导入或扫描因暂时性错误重试时，后续轮次必须继续使用 IGNORED_SEGMENTS 排除 node_modules、.git 与 \_\_MACOSX。若每次重试临时重建忽略规则，目录识别结果可能漂移，已跳过的数据也可能被再次处理，破坏操作幂等性。团队应让首轮与重试共享 isIgnoredPath 的判断口径，并保持忽略集合稳定；新增条目时统一更新集合，再从入口重新执行过滤。

适用范围：`src/extracted/workspacePolicy.ts`
