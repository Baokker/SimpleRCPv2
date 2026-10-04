import assert from "node:assert/strict";
import { test } from "node:test";
import { Cart } from "../src/cart.ts";
import { checkout } from "../src/checkout.ts";
import { applyDiscount, SeasonalRule } from "../src/pricing.ts";
import { discountedReport } from "../src/report.ts";

test("折扣返回折后价格", () => { assert.equal(applyDiscount(100, 0.1), 90); });
test("结账使用购物车折后总价", () => {
  const cart = new Cart();
  cart.add({ title: "Notebook", price: 10, quantity: 2 });
  assert.equal(cart.total(), 18);
  assert.equal(checkout(cart), "USD 18.00");
});
test("季节规则与重导出报告使用折后价格", () => {
  assert.equal(new SeasonalRule().apply(100), 80);
  assert.equal(discountedReport(100), 90);
});
