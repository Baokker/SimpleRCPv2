# Agent 并行执行调研

调研日期：2026-09-17

## OpenCode server 与 session

多个 Agent 可以共用一个 OpenCode server，并分别使用独立 session。

- OpenCode server 支持多个 client，提供创建 session、异步提交 prompt、查询全部 session 状态和订阅事件的接口。[OpenCode server 文档](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/server.mdx)
- 每个 session 保存自己的 `id`、`directory`、消息、状态和配置；创建 session 时会记录当前实例的工作目录。[Session 数据与创建逻辑](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/opencode/src/session/session.ts#L224-L270)
- OpenCode 的运行状态以 `sessionID` 为键保存 `Runner`，忙碌检查、取消和状态更新均作用于指定 session。因此，不同 session 可以各自运行。[SessionRunState 源码](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/opencode/src/session/run-state.ts#L35-L93)
- 请求可以通过 `directory` 查询参数或 `x-opencode-directory` 请求头选择工作目录；已有 session 的请求会继续使用该 session 保存的目录。[工作目录路由源码](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts#L160-L185)

独立 session 不提供文件隔离。多个 session 指向同一个目录时，Agent 会直接读写同一批文件。OpenHands 对同类结构给出了明确边界：同一 sandbox 中的多个 conversation 拥有独立历史，同时共享文件系统、凭据、计算资源和故障影响范围；单独 conversation 不能作为安全边界。[OpenHands conversation 与 sandbox 文档](https://github.com/OpenHands/docs/blob/aeff633a47ba3df945d3a01ab0de3598a3287dd6/enterprise/conversations-and-sandboxes.mdx#L7-L60)

## 并行修改的隔离方法

### 每个并行任务使用独立 `git worktree`

这是同一 Git 项目中成本较低的文件隔离方法。Git 官方说明，一个仓库可以拥有多个 working tree，同时检出多个分支；每个 linked worktree 有独立的 `HEAD`、index 和工作目录，Git 对象与大部分 refs 仍然共享。[Git worktree 文档](https://github.com/git/git/blob/12cb6293d6288865c1a133cf22accbaf99d13eb6/Documentation/git-worktree.adoc#L25-L49) [共享范围](https://github.com/git/git/blob/12cb6293d6288865c1a133cf22accbaf99d13eb6/Documentation/git-worktree.adoc#L66-L97)

任务创建时从已记录的 base commit 创建独立 worktree 和独立分支，OpenCode session 绑定该目录。因为 OpenCode session 会保存 `directory`，复用 session 的后续 run 需要继续使用该 worktree。每个 run 开始前记录新的 base，并把共享项目中的新变化并入隔离目录；run 完成后计算 diff，再把 Agent 结果与成员当前内容执行三方合并。合并完成前不修改共享项目目录。每个并行任务使用不同分支；Git 默认会拒绝把同一个分支同时检出到多个 worktree。

`git worktree add` 从 commit 创建工作目录，不能直接包含共享项目中的未提交修改和 untracked 文件。创建隔离目录时需要保存完整 base 快照，或把这些内容显式复制到 worktree。非 Git 项目需要使用独立目录副本或独立执行环境，并沿用同一套 base、diff 和三方合并流程。

该方法仍然共享 Git 对象、refs 和仓库级配置。并发执行 fetch、gc、修改 refs、修改共同外部服务或使用仓库外路径时，仍需单独限制。含有 submodule 的项目还需专项验证；Git 官方文档说明多个 checkout 对 submodule 的支持仍不完整。[Git worktree 限制](https://git-scm.com/docs/git-worktree#_bugs)

### 每个 run 使用独立 clone

独立 clone 会创建新的工作目录和 Git 管理目录，适用于需要隔离 refs、仓库配置和 Git 维护命令的任务。[Git clone 文档](https://git-scm.com/docs/git-clone#_description) 代价包括更多磁盘占用、依赖安装时间和远端传输；合并仍然需要明确的 base commit 与冲突处理。

### 每个 run 使用独立执行环境

容器或远端环境可以进一步隔离进程、依赖、凭据、端口和资源。OpenHands 把 sandbox 定义为执行命令、修改文件和启动服务的环境，并推荐 Docker sandbox 提供主机隔离。[OpenHands sandbox 文档](https://github.com/OpenHands/docs/blob/aeff633a47ba3df945d3a01ab0de3598a3287dd6/openhands/usage/sandboxes/overview.mdx#L6-L25)

独立执行环境可以在内部使用 worktree 或 clone。项目结果仍需通过 diff、commit 或制品进入共享项目，资源配额、凭据范围和清理过程也需要由调度器管理。

### 共享目录配合 FIFO

同一项目只运行一个写入型 Agent，可以避免 Agent 彼此覆盖。该方式符合当前基线，也保留了成员编辑与 Agent 写入同时发生的风险。它适合现阶段直接写项目目录的实现，无法提供并行写入能力。

## 基线后续改进方向

1. 当前基线继续采用每个项目一个 FIFO。独立工作目录、结果提取、三方合并、冲突处理和生命周期清理完成后，再允许同一项目中的写入型 Agent 并行运行。
2. 在任务创建时记录工作目录、分支名称、OpenCode `sessionId` 和所属成员；隔离目录与 session 使用相同生命周期。每个 run 另行记录不可变的 `baseCommit` 或完整 base 快照。
3. 增加隔离目录生命周期管理：创建、状态检查、超时取消、异常启动清理、正常删除和残留目录检查。所有路径放在项目数据目录中，不加入成员文件树。
4. 把运行结果保存为 base 到 Agent 结果之间的 patch 或 commit，并记录新增、修改、删除、重命名和二进制文件。
5. run 完成后执行三方合并：base 内容、成员当前内容、Agent 结果。无冲突内容自动合并，有冲突内容进入明确的处理界面；完成合并前保留隔离目录。
6. 把调度单位从“每个项目一个 FIFO”改为“每个项目限制并发数量”。只读任务可以直接并行，写入任务进入独立工作目录；Git refs、依赖缓存、端口和外部服务分别设置资源锁。
7. 为每个 run 增加 CPU、内存、磁盘、进程数量、时间和模型调用限额。需要更强隔离时，把工作目录放入独立容器或远端环境，并给每个 run 发放范围受限的短期凭据。
8. 补充正式并发测试：两个 Agent 修改不同文件、修改同一文件、一个重命名而另一个修改、成员编辑与 Agent 合并、取消后清理、服务重新启动后恢复、未提交文件、非 Git 项目，以及 submodule 项目行为。
