# 阶段 2 检查记录

仓库基线 `a04580a`，实现提交为 `b6dffc3`（demo）、`8a22d05`（conflict-guard）、`fcc6da8`（server）、`e05042d`（client 与 E2E），分支 `feature/conflict-guard`。环境为 macOS、Node.js `v24.7.0`、pnpm `9.0.0`。所有命令从仓库目录执行，输出完整保存到本目录。

| 原始输出 | 命令 | 结果 |
|---|---|---|
| [build.log](build.log) | `pnpm -r build` | 四个工作区包构建通过 |
| [tests.log](tests.log) | `pnpm test` | 包内 36 项、服务端 123 项、demo 2 项通过；包含索引首次与 30 次增量的性能输出 |
| [shop.log](shop.log) | `pnpm --dir demo/conflict-shop test` | 3 项通过 |
| [panel-off.log](panel-off.log) | `CONFLICT_GUARD=off SIMPLERCP_FAKE_AGENT_RUNTIME=false pnpm test:e2e tests/e2e/conflict-guard-panel.spec.ts` | 1 项通过 |
| [panel-observe.log](panel-observe.log) | `CONFLICT_GUARD=observe SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_STAGE2_EVIDENCE=true pnpm test:e2e tests/e2e/conflict-guard-panel.spec.ts` | 1 项通过；生成浏览器证据 |
| [collab-off.log](collab-off.log) | `CONFLICT_GUARD=off SIMPLERCP_FAKE_AGENT_RUNTIME=false pnpm test:collab` | 2 项通过 |
| [collab-observe.log](collab-observe.log) | `CONFLICT_GUARD=observe SIMPLERCP_FAKE_AGENT_RUNTIME=false pnpm test:collab` | 2 项通过 |
| [package-final.log](package-final.log) | `pnpm --filter @simplercp/conflict-guard test` | 最终包内 36 项通过 |
| [server-final.log](server-final.log) | `pnpm --filter @simplercp/server test -- src/__tests__/conflictGuardApi.integration.test.ts src/__tests__/conflictGuardSemantic.integration.test.ts src/__tests__/projectApi.test.ts` | 最终相关 12 项通过；首次索引 5.88 ms、增量 p95 2.77 ms |
| [evidence.log](evidence.log) | `node scripts/verify-stage-2-evidence.mjs` | 7 项清单、8 张截图、39 条事件与 5 个单元核验通过 |
| [secrets.log](secrets.log) | `node scripts/verify-evidence-secrets.mjs` | 已配置敏感值出现次数为 0 |

浏览器测试启动真实服务端运行配置，使用两个成员、实际 Monaco 编辑和 Yjs WebSocket。测试服务允许从仓库 `demo/` 导入项目，服务端端口 4100，客户端端口 5174。state 每秒刷新；批次空闲阈值为 1.5 秒，服务端更新触发合并窗口为 25 毫秒。

语义集成测试通过内置项目导入接口创建副本，使用 50 毫秒批次空闲阈值、500 毫秒批次最长时间、30 秒活跃空闲阈值与 20 毫秒光标记录窗口。性能样本使用真实磁盘文本变更和同步索引更新，测试结束移除隔离数据目录。
