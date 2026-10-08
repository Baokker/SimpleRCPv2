# D1 界面回放

conflict-guard-replay.spec.ts 创建独立空项目，第三名成员 Observer 加入。包命令 replay:ui 读取 D1 的 d1-0001-conflict.jsonl，通过真实 presence 和 Yjs 连接创建 Replay origin 与 Replay candidate，重放编辑和光标。

Playwright 的 DOM 断言验证成员名称、黑区冻结标签、合并状态独有的类型错误、红色冻结装饰与冲突卡片；CLI 完成且浏览器没有 pageerror。acceptance.json 保存验收项，trace.jsonl 保存服务端录制。

```bash
SIMPLERCP_SKIP_MODEL_REQUESTS=true CONFLICT_GUARD=rules pnpm test:e2e tests/e2e/conflict-guard-replay.spec.ts
pnpm --filter @simplercp/conflict-guard replay:check ../../docs/conflict-guard/evidence/stage-4-ui/trace.jsonl
```

界面验收通过，录制一致性返回 checked=true、valid=true、differences=[]。证据通过 DOM 与接口生成。
