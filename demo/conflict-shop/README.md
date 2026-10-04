# conflict-shop

一个使用 TypeScript 编写的购物示例。Node.js 22.18 以上可以执行测试，项目没有外部依赖。

```bash
pnpm --dir demo/conflict-shop test
```

| 文件 | 内容 |
|---|---|
| `src/types.ts` | `CartItem`、`Money`、`Currency`、`DiscountRule` |
| `src/pricing.ts` | `applyDiscount`、`formatMoney`、`PriceRule`、`SeasonalRule` |
| `src/cart.ts` | `Cart.items`、`Cart.add`、`Cart.total` |
| `src/checkout.ts` | `checkout` 调用 `Cart.total` 与 `formatMoney` |
| `src/index.ts` | 重导出价格函数与 `Cart` |
| `src/report.ts` | `discountedReport` 经重导出调用价格函数；独立函数 `reportTime` |
| `test/shop.test.mjs` | 使用 `node:test` 验证折扣、购物车和报告 |

项目包含 `call`、`value-reference`、`type-reference`、`inheritance`、`implementation`、`state-read`、`state-write` 七种关系。`discountedReport` 的调用关系经过 `src/index.ts`。

演示操作：

1. Alice 将 `applyDiscount` 的 `price * (1 - rate)` 改为 `price - price * rate`，Bob 将 `checkout` 的 `cart.total()` 改为 `cart.total() + 1`。两处修改经过 `Cart.total` 形成两跳候选关系。后续阶段可以将 Alice 的返回语义改为返回折扣金额，演示依赖方仍按最终价格使用返回值的情况。
2. Bob 将 `checkout` 恢复为原文，再将 `reportTime` 的 `"Shop report"` 改为 `"Daily report"`。候选条目关闭，无关系变更单元数量增加。
3. 两位成员在 `Cart.total` 中分别修改折扣参数与 `amount` 初始值，出现距离 0 的候选对。

启动、导入与观察面板操作见 [人工验收说明](../../docs/conflict-guard/manual-acceptance.md)。
