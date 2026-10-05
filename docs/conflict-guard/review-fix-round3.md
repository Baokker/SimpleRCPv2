# 阶段 0–4 复核修复记录

本轮复核覆盖阶段 0–4 的服务端、客户端、回放和分区逻辑。所有复现测试均先在修复前确认失败，再保留为回归测试。

## 语义分区与回放

- `SemanticChangeTracker` 只为仍处于活跃删除变更的符号保留墓碑边。普通关系消失后候选对关闭；覆盖 `candidates.test.ts`。
- 四状态类型检查按照当前共享文本中的符号范围替换，并在连续检查中读取文件版本变化；覆盖 `classifier.test.ts`。
- 分区器使用 AST 识别类方法、箭头函数、嵌套调用参数、返回对象属性、运行时导出和可观测性语句；`classifier.test.ts` 共 24 项通过。
- 撤回回放操作后立即更新冻结与写盘闸门区间；覆盖 `replay.test.ts`。
- D2 重新导入 51 个 GreyLock 规则案例，当前产品逻辑逐项执行并写入 `manifest.json` 与 `replay-results.json`。

## Agent 与轨迹隔离

- 工作区快照、文件归属、监听器停止、轨迹写入链的异常均记录诊断，不改变成功 run 的状态。
- 轨迹写入失败后，后续写入继续执行；读取持续失败时返回空事件并记录读取失败计数。
- 模型切换先增加运行计数，再等待实际进程切换；run 记录订阅完成后读取的实际模型。`openCodeRuntime`、`agentConcurrency` 与 `traceStore` 故障注入测试通过。

## 客户端干预

- 冻结判断按照实际编辑范围处理选区、多光标、Tab、粘贴、拖放、快捷删除和历史 undo/redo；冻结区外的历史操作保持可用。
- 灰区通知按参与者和 `pairId:revision` 去重；第三名成员可查看卡片，无法执行双方操作。
- 双方确认状态显示各自等待状态。

## 验证结果

- `pnpm -r build` 通过。
- conflict-guard 包 89 项测试通过。
- server 152 项测试通过。
- `pnpm test:demo` 2 项通过；`CONFLICT_GUARD=off|observe|rules pnpm test:collab` 各 2 项通过。
- 阶段 3 干预 Playwright 6 项通过，历史操作专项 2 项通过。
- 三份真实轨迹执行 `replay:check` 均返回 `checked=true`、`valid=true`、`differences=[]`。
