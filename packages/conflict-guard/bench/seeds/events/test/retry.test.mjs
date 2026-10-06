import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, retryQuote, reset, historySize } from "../src/retry.ts";
import { deliveryDelay, deliveryLabel } from "../src/delivery.ts";

test("事件重试与队列计量", async () => {
  reset();
  assert.ok(evaluate(20, 0.1, "background") > 0);
  assert.ok(retryQuote(30, 0.1, "background").amount > 0);
  assert.ok(historySize() > 0);
  assert.throws(() => evaluate(-1, 0.1, "background"), RangeError);
  assert.ok(await deliveryDelay(40) > 0);
  assert.match(deliveryLabel("ready", 3.1), /^ready:\d+ attempts$/);
});
