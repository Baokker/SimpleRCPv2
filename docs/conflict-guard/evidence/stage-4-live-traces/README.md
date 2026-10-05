# 服务端录制一致性

same-symbol.jsonl 与 call-signature.jsonl 由 conflictGuardRules.integration.test.ts 的两个真实 WebsocketProvider 场景录制。测试对产品 trace 直接调用 checkReplay，核验规则编号、动作、pairId、revision 与时间。

```bash
pnpm --filter @simplercp/conflict-guard replay:check ../../docs/conflict-guard/evidence/stage-4-live-traces/same-symbol.jsonl
pnpm --filter @simplercp/conflict-guard replay:check ../../docs/conflict-guard/evidence/stage-4-live-traces/call-signature.jsonl
```

两项均返回 checked=true、valid=true、differences=[]。对应 JSON 保存检查结果。
