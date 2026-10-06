import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, deliveryQuote, reset, historySize } from "../src/delivery.ts";
import { shippingEstimate, shippingLabel } from "../src/fulfillment.ts";

test("配送报价与历史记录", async () => {
  reset();
  assert.ok(evaluate(20, 0.1, "standard") > 0);
  assert.ok(deliveryQuote(30, 0.1, "standard").amount > 0);
  assert.ok(historySize() > 0);
  assert.throws(() => evaluate(-1, 0.1, "standard"), RangeError);
  assert.ok(await shippingEstimate(40) > 0);
  assert.match(shippingLabel("order-1", 3.1), /^order-1:\d+km$/);
});
