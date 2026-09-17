# Task Plan: SimpleRCPv2 文档同步方案与基线实施计划

## Goal

为 SimpleRCPv2 确定一套最简的「磁盘 ↔ Yjs ↔ Agent」三方同步方案，写入基线需求文档，并产出一份可交接给其他 Agent 执行的完整实施计划。

## Phases

- [x] Phase 0: 读完现有代码与 PRD，完成第一轮评审
- [x] Phase 1: 调研业界文档同步方案与可用库
- [x] Phase 2: 确定同步设计，写入 `docs/07-document-sync-design.md`
- [x] Phase 3: 更新 `docs/05-baseline-product-requirements.md`
- [x] Phase 4: 产出 `docs/08-implementation-plan.md` 可执行计划
- [x] Phase 5: 更新 `docs/README.md` 索引，标注 `docs/04` 中已废弃的密钥方案

## Key Questions

1. 业界（jupyter-collaboration、Zed、open-collaboration-tools、VS Code Live Share）如何处理 CRDT 文档与磁盘文件的双向同步？
2. 回声抑制（echo suppression）的标准做法是什么？
3. 把外部文件内容并入 Y.Text 时，用什么库做最小 delta？`fast-diff`、`diff-match-patch` 还是 jsdiff？
4. 三方合并（base/ours/theirs）在 Node 生态有没有可直接用的行级实现？`node-diff3` 是否可用？
5. Agent 基于过期读取写回时，能否用 run 内的首次读取快照作为合并 base？

## Decisions Made

- 磁盘作为唯一真相源，且通过写穿（write-through）保持永远最新，删除 `flushAll` 概念。理由：让「Agent 任意时刻 grep 都正确」成为结构性保证，而不是依赖时序推理。
- 回声判据改为「与本进程上次写出内容的哈希相同」，不再用「与当前 Yjs 内容相同」。理由：现有判据在写盘到 watcher 回调的 100ms 窗口内会误判，导致丢失用户输入。
- 禁止全量 `delete + insert` 更新 Y.Text。理由：会摧毁 CRDT 字符身份，使所有在线成员光标错位。

- 最小 delta 采用 `fast-diff` 而非自写前后缀替换。理由：Agent 一次写入常同时改动文件多处，只裁前后缀会把中间未改动的几十行一并替换，照样丢失字符标识。
- 不引入 `diffWithCursor`。理由：外部写入来自终端和 Agent，没有对应光标可作提示，歧义代价被限制在改动区域内部。
- 基线不做三方合并。理由：diff3 引入 base 快照管理、冲突标记、冲突态 UI 三块新内容，而基线连一次完整人机协作流程都未跑通。
- 运行数据只保留 `AgentRunRecord`，删除 `AgentSessionRecord`，Agent 接口 9 个减为 5 个。
- 删除 Agent 权限交互。理由：与可信网络前提矛盾，且是队列之外的第二个死锁来源。
- 采用全局单个 OpenCode 进程与全局单队列。理由：消掉进程上限、LRU 回收、空闲超时与端口竞态。
- 单元测试引入 `FakeAgentRuntime`，E2E 仍只用正式 OpenCode。

## Errors Encountered

（无）

## Deliverables

- `docs/07-document-sync-design.md`（新增）
- `docs/08-implementation-plan.md`（新增）
- `docs/05-baseline-product-requirements.md`（21 处修订）
- `docs/04-agent-runtime-research.md`（标注已废弃的密钥方案）
- `docs/README.md`（索引更新）

## Status

**已完成** - 文档全部落地，等待用户确认第 14 节的 11 项决定后进入代码开发
