# 阶段 3 人工验收证据

`01-black-zone-card.png` 与 `01-bob-black-zone-card.png` 由 `CONFLICT_GUARD=rules pnpm test:e2e -- tests/e2e/conflict-guard-intervention.spec.ts` 生成，显示两个成员的黑区判定、冻结区域和冲突卡片。`acceptance.json` 记录本次自动验收覆盖的项目；完整十项人工操作需要按照 `manual-acceptance.md` 现场执行。
