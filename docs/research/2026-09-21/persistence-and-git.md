# 项目保存与 Git 边界调研

调研日期：2026-09-21

## 调研问题

SimpleRCP 以服务端目录作为项目的唯一代码来源。需要明确哪些项目状态应当跨 Server 重启保存，Git 仓库如何处理，以及多人和 Agent 同时修改时应当采用什么边界。

## 官方产品行为

### Replit：项目状态与 Agent 工作记录

Replit 的 checkpoint 保存完整项目状态，内容包括项目文件、目录、已安装包、项目配置、完整 AI 对话上下文、Agent memory，以及 checkpoint 时刻的数据库内容。checkpoint 可以从 Agent History 和 Git pane 访问，Replit 建议同时使用 checkpoint 与手动 Git commit。[Replit：Checkpoints and Rollbacks](https://docs.replit.com/features/version-control/checkpoints-and-rollbacks)

Replit 把 Agent 的每个后台任务放在项目的独立副本中。任务完成后，用户查看工作日志、测试结果和文件变化，再决定是否把修改应用到主版本。多个任务可以并行运行，修改在应用时统一处理冲突。[Replit：Task system](https://docs.replit.com/core-concepts/agent/task-system)、[Replit：Invite teammates](https://docs.replit.com/build/invite-teammates)

Replit 的项目页面把 Agent 对话组织为 thread；主 thread 用于方向和决策，后台任务拥有独立 thread 与独立工作副本。项目重新打开时，项目文件、历史记录和运行中的应用仍可访问。[Replit：Project Editor](https://docs.replit.com/learn/projects-and-artifacts/project-editor)

Replit 的导入流程也把项目文件和目录结构作为核心数据；ZIP 导入要求清晰的项目根目录，并明确说明已有数据库数据和 secret 不随 ZIP 自动迁移。[Replit：Import from providers](https://docs.replit.com/build/import-from-providers)

### Git：仓库结构、忽略规则与冲突

Git 官方文档定义了两种常见仓库形式：工作目录根部的 `.git` 目录，以及没有工作目录、用于推送和获取历史的 bare repository。`.git` 目录包含 object store、refs、HEAD、配置和索引等仓库元数据。[Git：Repository Layout](https://git-scm.com/docs/gitrepository-layout)

`.gitignore` 只规定 Git 应忽略的未跟踪路径，已经被 Git 跟踪的文件不会因为新增忽略规则而停止跟踪。团队共同使用的生成文件规则放在项目 `.gitignore`；只属于当前仓库或个人环境的规则可以放在 `.git/info/exclude` 或用户级 excludes 文件。[Git：gitignore](https://git-scm.com/docs/gitignore)

Git 的分支合并在两个分支修改同一文件的同一部分时可能产生冲突。Git 会暂停合并，并把文件标记为未合并，等待用户解决冲突后再提交结果。[Git Book：Basic Branching and Merging](https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging)

## SimpleRCP 应当保存的内容

### 项目级长期数据

以下内容与项目本身相关，服务端重启后应继续可读：

- 项目注册信息：项目 ID、显示名称、创建时间、来源和项目根目录。
- 项目代码与全部用户文件，包括空目录对应的目录信息（当前文件系统无法保存空目录时，可以保留目录索引）。
- 项目级 Participant，以及 Participant 的显示名称和最近使用时间。
- 项目 Chat 消息和消息附件引用。
- 所有 Agent session、run、trace、工具调用摘要、文件变化和最终回复。
- 项目 Activity，包括文件创建、修改、重命名、删除，以及 Agent run 的开始、完成、失败、取消和中断。
- 每次 Agent run 的代码快照或可重建的基线版本标识，用于查看修改范围和恢复上下文。
- 项目配置，例如默认 Agent、Provider、model 和安全设置。API key 只保存为服务端 secret 引用或环境变量名称，不写入项目历史和 Activity。
- 项目内已经存在的 Git 元数据属于项目代码目录，会随着 workspace 一起保留；Git 的分支、标签和提交历史由 Git 自己保存，SimpleRCP 当前不建立另一份副本。
- OpenCode 的 session 数据库需要放在服务端持久化目录中，或者通过备份策略纳入保存范围。SimpleRCP 只保存 `runtimeSessionId`，不能单独重建 OpenCode 的完整上下文。

### 可选的长期数据

这些内容有价值，但可以在核心功能稳定后增加：

- 用户最近打开的文件、编辑器布局和主题偏好。它们属于用户偏好，可以按 Participant 保存。
- Agent 生成的任务计划、依赖关系和任务状态。
- 项目级搜索历史、收藏文件和常用命令。
- 构建缓存、依赖缓存和预览服务配置。缓存可被清理，不能作为代码或运行结果的唯一来源。
- 文件上传记录与导入来源，以便重新执行导入或查看导入摘要。
- 项目级 checkpoint 元数据，例如创建时间、创建者、关联的 Agent session 和变更文件列表。代码快照与恢复操作需要单独设计。

### 只保留在运行期间的数据

以下内容依赖具体连接或进程，退出后不应假设能够恢复：

- WebSocket connection ID、member ID、在线心跳和当前在线成员。
- 光标位置、当前选中文件、终端窗口当前显示内容和滚动位置。
- 正在执行的子进程句柄、临时端口和短时间的事件合并状态。

Server 关闭后，当前实现会把 queued 或 running 的 Agent run 标记为 `failed`，并写入服务重新启动的原因；已经收到的 trace 和 Activity 会保留。重新进入 session 后，用户可以阅读历史并继续发起新 run。

## 数据目录建议

项目代码与项目元数据需要放在同一个受控数据根目录下，同时保持元数据与代码目录分开：

```text
<data-root>/
  registry.json
  projects/<project-id>/
    workspace/             # 项目代码，可能包含项目自己的 .git
    participants.json
    activity.json
    chat.json
    agent-sessions/
    agent-runs/
    project.json
```

`workspace/` 是文件编辑、Agent 工具和终端的工作目录。`participants.json`、`activity.json`、`chat.json` 与 Agent 记录属于 SimpleRCP 的服务端元数据，不应放进用户项目的 Git 提交中。项目删除操作需要同时删除项目元数据和 `workspace/`，并在删除前完成明确确认。

## Git 处理策略

### 基线版本的职责边界

SimpleRCP 负责保存项目目录和协作历史。Git 继续由项目中的 Git CLI 和用户已有的远程仓库负责版本发布、分支管理和远程同步。服务端不会替用户自动 push，也不会把 Participant、Chat、Activity、Agent trace 或 API key 写入用户仓库。

如果用户在已经登记的 workspace 内通过共享终端执行 `git init`，`.git` 会留在服务端项目目录中。后续 commit、branch、merge、rebase、push 和 pull 仍由用户明确执行。页面可以显示 `git status` 和 diff，但当前基线不自动执行会改变历史的 Git 命令。

当前目录复制和 ZIP 导入会过滤 `.git`，所以导入结果是一个新的代码副本，不包含原仓库历史。这个行为与基线的 Git 范围一致：导入功能只负责获得可协作的文件内容，历史迁移留给后续 Git 功能处理。将来支持保留 `.git` 时，需要增加来源提示、远程地址检查和 hooks 风险提示。

### `.git` 是否忽略

`.git` 不能作为项目文件树中的普通可编辑文件发送给浏览器，也不能被删除、重命名或通过批量上传覆盖。用户在 workspace 内初始化 Git 后，它仍然保存在服务端项目目录中，因为它包含提交历史、分支引用和索引。导入流程过滤 `.git` 时，导入副本不会包含这些历史数据。

文件树接口只返回工作目录内容，并过滤 `.git/` 及其内部路径；Git 专用接口通过受限的只读查询返回状态、分支、提交和 diff。这样既能保留 Git 仓库，又不会让编辑器误修改仓库内部文件。

项目的 `.gitignore` 仍然由项目作者维护。SimpleRCP 可以在新建项目时提供基础忽略模板，例如 `node_modules/`、`.DS_Store`、构建输出和服务端本地数据目录；用户可以在项目中修改它。SimpleRCP 自身的服务端数据目录应放在 workspace 之外，减少误提交风险。

### 提交与自动保存

文件编辑和 Agent 修改先写入服务端 workspace，并记录 Activity 与 diff。它们不自动生成 Git commit。用户明确执行 commit 后，Git 才创建长期版本节点。

如果将来需要类似 Replit checkpoint 的恢复能力，可以创建独立的服务端快照或 Git commit，但必须让用户看见触发原因、修改文件和恢复范围。快照应当记录对应的 Agent session、run、Participant 和时间点，避免把恢复代码状态与恢复聊天上下文混为同一动作。

## 并发与冲突处理

### 当前基线的写入规则

当前基线保留单一 workspace，并通过服务端的串行写入队列保证同一时刻一个文件写入操作完成。所有文件写入都记录来源 Participant、session、run 和基线文件版本。

Agent 执行前保存文件快照或版本标识。Agent 提交写入时，服务端检查文件版本是否仍与快照一致：

- 版本一致：写入文件并记录 diff。
- 版本变化：拒绝静默覆盖，保留 Agent 生成内容和当前文件内容，创建 `conflict` Activity，并要求用户查看 diff 后选择处理方式。

这个检查只能减少 Agent 读后写覆盖用户编辑的风险，不能替代完整的三方合并。当前基线不自动合并同一文件的冲突，也不自动选择用户版本或 Agent 版本。

### Git 冲突与实时协作冲突是两类问题

Git 合并冲突发生在不同提交或分支应用到同一工作树时。实时协作冲突发生在用户编辑、Agent 写入和外部 Git 操作同时作用于当前 workspace 时。两者都需要版本基线和可见 diff，但处理入口不同：Git 冲突由 Git 工作流处理，实时写入冲突由服务端文件写入检查处理。

如果用户在终端执行 `git checkout`、`git reset`、`git merge` 或 `git pull`，服务端需要通过文件监视器刷新文件树，并把外部变更记录为一次 workspace 更新。Agent 正在运行时发生这类变化，应当让 Agent run 进入等待或中断状态，避免继续依据旧快照写入。

### 并行 Agent 的后续方向

Replit 的做法是每个后台 task 使用独立副本，完成后由用户 review 并应用到主版本。SimpleRCP 未来可以为每个 Agent run 创建临时 workspace 副本，保存 run 的基线提交或快照，完成后生成 diff；用户确认后再应用到主 workspace。这个方向能够支持多个 Participant 同时发起 Agent，并把冲突集中到应用步骤处理。

在实现独立副本以前，服务端应限制 Agent 对主 workspace 的直接写入，或明确允许一次只存在一个写入中的 Agent run。并行读取和独立分析可以继续执行，代码应用需要经过基线检查。

## 当前基线建议

1. 持久化项目代码、Participant、Chat、Agent session/run/trace、Activity、项目配置，并确保 OpenCode session 数据库位于服务端持久化范围内。
2. 对已在 workspace 中初始化的项目保留 `.git`，同时过滤文件树展示和文件编辑接口中的 `.git/` 路径；目录复制和 ZIP 导入继续按当前规则过滤 `.git`。
3. 不自动 commit、push、pull、merge 或 reset；Git 命令由用户通过终端或后续 Git 面板明确触发。
4. 所有 Agent 写入携带文件版本检查，发现版本变化时生成冲突记录并停止静默覆盖。
5. 记录 Server 重启导致的 Agent run 中断，允许用户在原 session 中继续发送消息。
6. 将 Agent trace、Activity 和 Chat 作为可查询的项目历史保存；在线状态、光标和终端屏幕保持运行期间状态。
7. 将独立 Agent workspace、review、diff 应用和多 Agent 并行列入后续开发计划，当前不把它们与 Git 自动合并绑定。

## 结论

Server Only 的项目适合把所有具有协作意义、可用于恢复上下文或解释代码变化的数据保存在服务端。代码目录与 Git 历史属于项目数据，Chat、Activity 与 Agent 记录属于协作数据，两者应当分别存储并通过项目 ID、Participant ID、session ID 和 run ID 关联。

Git 可以在项目目录中正常初始化和使用。主要风险来自编辑器误触 `.git` 内部文件、Agent 依据旧快照覆盖新修改，以及用户通过终端改变工作树后服务端仍持有旧文件状态。文件树过滤、写入版本检查、外部变更刷新和可见 diff 能够覆盖当前基线需要的安全边界；完整的多 Agent 隔离和自动合并属于后续能力。
