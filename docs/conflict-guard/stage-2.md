# 阶段 2：符号关系与观察面板

## 文件与接口

实现提交为 `b6dffc3`、`8a22d05`、`fcc6da8`、`e05042d`，基线为 `a04580a`，分支为 `feature/conflict-guard`。

| 位置 | 内容 |
|---|---|
| `packages/conflict-guard/src/semantic/` | LanguageService 宿主、具名声明、七种关系、双向路径、符号 before/after |
| `packages/conflict-guard/src/routing/` | 稳定候选编号、生命周期事件、变更单元统计 |
| `packages/conflict-guard/src/model/`、`tracking/`、`trace/` | 符号变更字段、声明名称删除归属、schema 2 与版本 1 兼容 |
| `apps/server/src/conflictGuard/`、`projectRuntime.ts`、`routes/conflictGuardRoutes.ts`、`createApp.ts` | 镜像和磁盘文件提供者、25 毫秒合并更新、state 与 symbol 接口、health 开关字段 |
| `apps/client/src/components/ConflictGuardPanel.tsx`、`CollaborationPanel.tsx`、`EditorArea.tsx`、`App.tsx`、`api.ts`、`conflictGuardTypes.ts`、`styles.css` | 中文观察页签、每秒轮询、候选文本、Yjs 同步后的符号行导航 |
| `demo/conflict-shop/` | 六个 TS 文件、三项 Node 测试与演示说明 |
| 包内测试、`apps/server/src/__tests__/`、`tests/e2e/conflict-guard-panel.spec.ts` | 单元、真实双成员集成、浏览器与开关回归 |
| `docs/conflict-guard/`、`scripts/verify-stage-2-evidence.mjs` | schema、使用说明、截图、接口与轨迹证据核验 |

TypeScript 为包的唯一新增运行时依赖。客户端沿用现有依赖。观察面板读取状态、展示文本并提供导航，Yjs 编辑与同步流程继续使用现有实现。

增量更新处理修改文件、直接引用者、经过重导出的引用者和直接推断类型依赖。类型依赖包含继承来源、union、intersection、generic 与 mapped type 参数。文件列表变化后刷新当前 Program 的声明节点。包内回归使用真实 TypeScript LanguageService，将新增、删除、重命名及类型变化的增量结果与全量结果比较。

## 测试记录

运行环境为 macOS、Node.js `v24.7.0`、pnpm `9.0.0`。完整命令、配置和原始输出见 [检查记录](evidence/stage-2-checks/README.md)。

| 检查 | 结果 |
|---|---|
| `pnpm -r build` | 通过，四个工作区包完成构建 |
| 包内单元测试 | 5 个文件、36 项通过 |
| 服务端全部测试 | 32 个文件、123 项通过 |
| `pnpm test:demo` | 2 项通过 |
| `pnpm --dir demo/conflict-shop test` | 3 项通过 |
| `CONFLICT_GUARD=off` 下的观察面板 E2E | 1 项通过，双方页签隐藏 |
| `CONFLICT_GUARD=observe` 下的观察面板 E2E | 1 项通过，包含七项浏览器清单 |
| off 与 observe 下的 `pnpm test:collab` | 各 2 项通过 |
| 最终包内检查与服务端相关集成检查 | 36 项与 12 项通过 |
| 证据核验 | 7 项清单、8 张截图、39 条轨迹事件、5 个变更单元通过核验 |
| 精确敏感值检查 | 已配置敏感值出现次数为 0 |

服务端语义集成使用两位真实 WebsocketProvider 成员，验证两跳调用关系、恢复基线后候选关闭、无关单元增加、同符号距离 0 和磁盘修改未打开文件。浏览器验收使用两个独立 Chromium 上下文，通过首页导入项目并实际编辑 Monaco，修改经 Yjs 同步。

## 索引性能

演示项目包含 6 个文件、22 个符号、21 条关系。性能测试对未打开的 `report.ts` 执行 30 次真实磁盘修改，统计同步 `SemanticIndex.update` 的计算耗时，采用排序后第 29 个样本作为 p95。

| 记录 | 首次索引 | 增量更新 p95 |
|---|---|---|
| 全部服务端测试，[tests.log](evidence/stage-2-checks/tests.log) | 8.13 ms | 2.10 ms |
| 最终相关集成，[server-final.log](evidence/stage-2-checks/server-final.log) | 5.88 ms | 2.77 ms |

两次记录均低于 200 ms 要求。数值测量索引计算时间；批次等待、25 毫秒合并窗口与客户端每秒刷新时间独立计算。2000 文件规模尚未进行性能测量。

## 浏览器清单

[manual-acceptance.md](manual-acceptance.md) 中的七项全部执行通过。双方页签和成员符号可见，两跳候选展示路径和各自 before/after，独立函数使候选关闭并增加无关单元，同符号候选显示距离 0，点击条目定位第 11 行，统计显示规模与耗时。截图、state 和 trace 保存在 [stage-2-manual/](evidence/stage-2-manual/README.md)。

无关函数操作明确包含恢复 checkout 原文。活跃修改按原有追踪规则保留，打开另一个文件会继续保留之前的净修改。

## 阶段 3 接口建议与使用范围

- 使用 `SemanticChangeTracker.onEvent` 接收候选打开、更新与关闭，按 `id` 保存规则结果；双方文本或关系变化时重新处理，关闭事件结束相应结果。
- `getActiveChangeSets()` 提供双方符号 before/after，`findPaths` 提供每跳种类与方向。删除规则需要结合基线索引的引用关系；当前关系图描述当前共享文本。
- 四状态检查可以复用 `SemanticFileProvider` 和相同符号键，为每个程序状态提供独立版本号。加载 TypeScript lib 的决定属于该检查阶段。
- schema 1 保留文本回放能力；schema 2 增加符号哈希和候选生命周期。阶段 4 使用初始项目文件与 edit 序列复原符号哈希，当前轨迹校验器已验证 edit、批次全文哈希和语义事件字段。
- 当前语言范围、`noLib: true` 和 2000 文件上限按设计启用。重名后缀随同容器声明顺序分配，插入或删除同名声明会影响后续编号。成员范围内部的他人插入沿用阶段 1 范围规则。

当前阶段提供关系发现与观察界面。分区规则、四状态诊断、模型研判和 Agent run 修改归属按后续阶段接入。
