import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, usageQuote, reset, historySize } from "../src/metering.ts";
import { subscriptionCharge, subscriptionLabel } from "../src/subscription.ts";

test("订阅计量与计费", async () => {
  reset();
  assert.ok(evaluate(20, 0.1, "monthly") > 0);
  assert.ok(usageQuote(30, 0.1, "monthly").amount > 0);
  assert.ok(historySize() > 0);
  assert.throws(() => evaluate(-1, 0.1, "monthly"), RangeError);
  assert.ok(await subscriptionCharge(40) > 0);
  assert.match(subscriptionLabel("account-a", 3.1), /^account-a:\d+ units$/);
});
