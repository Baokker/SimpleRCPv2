import test from "node:test";
import assert from "node:assert/strict";
import { Cart, invoiceNet, paymentFee } from "../src/cart.ts";
import { splitPayment, discountedBasket } from "../src/pricing.ts";
import { StockBook } from "../src/stock.ts";
import { Orders } from "../src/orders.ts";
import { ShipmentQueue, shippingEstimate, packedWeight } from "../src/shipping.ts";

test("订单从库存预约经过付款进入配送", () => {
  const stock = new StockBook();
  stock.restock("BOOK", 8);
  const cart = new Cart();
  cart.add("book", 20, 2);
  const orders = new Orders(stock, new ShipmentQueue());
  assert.equal(orders.create("order-1", cart), true);
  assert.equal(stock.quantity("BOOK"), 6);
  assert.equal(orders.pay("order-1", cart.total(), 30, 5), true);
  assert.deepEqual(orders.dispatch(1), ["order-1"]);
  assert.equal(orders.find("order-1").state, "shipped");
});

test("取消订单恢复库存并保持原始购物车", () => {
  const stock = new StockBook();
  stock.restock("PEN", 3);
  const cart = new Cart();
  cart.add("PEN", 4, 3);
  const orders = new Orders(stock, new ShipmentQueue());
  assert.equal(orders.create("order-2", cart), true);
  assert.equal(orders.cancel("order-2"), true);
  assert.equal(stock.quantity("PEN"), 3);
  assert.equal(cart.itemCount, 3);
});

test("账单与配送金额可用于汇总，分付款保持整数分总额", () => {
  assert.equal(Number.isFinite(invoiceNet(100)), true);
  assert.equal(paymentFee(100) > 0, true);
  assert.equal(discountedBasket(100) <= 100, true);
  assert.equal(shippingEstimate(100) > 0, true);
  assert.equal(packedWeight(8) > 8, true);
  assert.deepEqual(splitPayment(10, 3), [3.34, 3.33, 3.33]);
});

test("多种商品的预约保持原子性并合并同商品数量", () => {
  const stock = new StockBook();
  for (const [sku, count] of [['A', 7], ['B', 4], ['C', 9]]) stock.restock(sku, count);
  assert.deepEqual(stock.snapshot(), { A: 7, B: 4, C: 9 });
  const items = [{ sku: 'A', count: 2 }, { sku: 'A', count: 3 }, { sku: 'B', count: 2 }];
  assert.ok(stock.reserve('combined', items));
  assert.deepEqual(stock.snapshot(), { A: 2, B: 2, C: 9 });
  assert.equal(stock.reserve('insufficient', [{ sku: 'A', count: 1 }, { sku: 'B', count: 5 }]), false);
  assert.deepEqual(stock.snapshot(), { A: 2, B: 2, C: 9 });
  assert.throws(() => stock.reserve('combined', items));
  assert.ok(stock.release('combined'));
  assert.deepEqual(stock.snapshot(), { A: 7, B: 4, C: 9 });
  assert.ok(stock.reserve('sold', [{ sku: 'C', count: 4 }]));
  assert.ok(stock.commit('sold'));
  assert.equal(stock.release('sold'), false);
  assert.deepEqual(stock.snapshot(), { A: 7, B: 4, C: 5 });
});
