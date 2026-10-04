# 自行验收原始记录

日期：2026-10-05。分支：`feature/conflict-guard`。Agent 修复提交：`11d2947`；以下产品行为验证使用提交 `0cd88f697e01bd8b774db85dcaeeeb90d2fe2b63`。验收报告见 [review-fix-0-1.md](../../review-fix-0-1.md)。

所有命令在 `/Users/baokker/Work/Master/CSCW/智能语义冲突预防-update/SimpleRCPv2` 执行。配置敏感值仅通过 dotenv 读取，证据内容经过精确值扫描。中间工作目录 `.test-workspaces/` 已被 Git 忽略。

## 构建与测试

```bash
pnpm -r build > docs/conflict-guard/evidence/self-acceptance/build.log 2>&1
pnpm test > docs/conflict-guard/evidence/self-acceptance/tests.log 2>&1
CONFLICT_GUARD=off pnpm test:collab > docs/conflict-guard/evidence/self-acceptance/collab-off.log 2>&1
CONFLICT_GUARD=observe pnpm test:collab > docs/conflict-guard/evidence/self-acceptance/collab-observe.log 2>&1
```

构建通过；`pnpm test` 包含 conflict-guard 20 项、服务端 31 个文件 120 项、`pnpm test:demo` 2 项，全部通过。两种模式的协作测试各 2 项通过。构建后的 conflict-guard 包包含 5 个产品 `.js` 文件。

## 真实 Agent

```bash
pnpm --filter @simplercp/server exec tsx ../../scripts/verify-agent-acceptance.mjs > docs/conflict-guard/evidence/self-acceptance/agent-real.log 2>&1
```

脚本使用 OpenCode 1.18.31 和本地 DeepSeek 配置，`SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=3`、`CONFLICT_GUARD=off`、`SIMPLERCP_FAKE_AGENT_RUNTIME=false`、`SIMPLERCP_TERMINAL_ENABLED=false`。服务、OpenCode 端口和数据目录由脚本创建。`agent-real.json` 包含完整 run、trace 和进程编号；`agent-real.log` 登记三个通过场景：`laterStartEarlierFinish`、`crossProjectModelChange`、`timeoutAttribution`。新模型为 `deepseek-v4-pro`。脚本释放创建的 Y.Doc、服务和 runtime，结束后正常退出。

`observations.applyPatchAvailability` 保存当前模型对工具可用性的回复；它单独登记观察情况。`apply_patch` 字段核验来自已安装 OpenCode 源码与 `agentWriteLedger.test.ts` 的 metadata 测试。

## 双浏览器 observe

```bash
CONFLICT_GUARD=observe PORT=4201 SIMPLERCP_DATA_DIR=/Users/baokker/Work/Master/CSCW/智能语义冲突预防-update/SimpleRCPv2/.test-workspaces/observe-acceptance SIMPLERCP_TERMINAL_ENABLED=false pnpm --filter @simplercp/server dev > docs/conflict-guard/evidence/self-acceptance/observe-server.log 2>&1
VITE_SIMPLERCP_API_ORIGIN=http://127.0.0.1:4201 VITE_SIMPLERCP_CLIENT_PORT=5176 pnpm --filter @simplercp/client exec vite --host 127.0.0.1 --port 5176 > docs/conflict-guard/evidence/self-acceptance/observe-client.log 2>&1
```

使用 Playwright skill 的 CLI wrapper，两个独立 session 为 `observe-alice` 和 `observe-bob`，成员为 Observe Alice 与 Observe Bob。浏览器访问 `http://127.0.0.1:5176`，加入 demo 并打开 `src/index.js`。通过 DOM 定位 Monaco textarea，使用键盘进行编辑，每人输入 3 条 `// Acceptance Alice/Bob N` 注释。三轮操作跨越超过两分钟，未使用截图。

编辑脚本保存于已忽略的 `.test-workspaces/acceptance-browser/append.js`，CLI 在该工作目录执行：

```bash
bash /Users/baokker/.codex/skills/playwright/scripts/playwright_cli.sh --session=observe-alice run-code --filename=append.js
bash /Users/baokker/.codex/skills/playwright/scripts/playwright_cli.sh --session=observe-bob run-code --filename=append.js
```

每次编辑依次聚焦 `.monaco-editor textarea`、按 `ControlOrMeta+End`、按 Enter、通过 `keyboard.insertText` 输入对应注释。批次实际字符范围与行号按下载的文本计算。

采集接口结果的命令：

```bash
node scripts/verify-conflict-guard-evidence.mjs 84385647-c90e-4213-8780-e1a6f88274be > docs/conflict-guard/evidence/self-acceptance/browser.log 2>&1
```

`browser-state.json` 和 `browser-trace.jsonl` 为原始接口返回。`browser-observation.json` 保存 170929 毫秒的编辑跨度、每人 3 个批次、范围与行号、最终全文和回放结果。`browser.log` 登记校验通过。回放文本与磁盘文件完全一致。观察结束后关闭两个浏览器和本次启动的服务。

## 文件检查

```bash
node scripts/verify-evidence-secrets.mjs > docs/conflict-guard/evidence/self-acceptance/secrets.log 2>&1
git diff --check
```

敏感值检查遍历 Git 已追踪及未忽略文件，使用 dotenv 读取的精确值检查内容，只输出检查数量与发现数量。原始结果为 `secrets.log`。
