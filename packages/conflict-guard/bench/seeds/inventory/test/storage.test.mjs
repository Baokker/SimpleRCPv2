import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, storageQuote, reset, historySize } from "../src/storage.ts";
import { storageEstimate, warehouseLabel } from "../src/warehouse.ts";

test("仓储报价与计量", async () => {
  reset();
  assert.ok(evaluate(20, 0.1, "central") > 0);
  assert.ok(storageQuote(30, 0.1, "central").amount > 0);
  assert.ok(historySize() > 0);
  assert.throws(() => evaluate(-1, 0.1, "central"), RangeError);
  assert.ok(await storageEstimate(40) > 0);
  assert.match(warehouseLabel("sku-a", 3.1), /^sku-a:\d+ boxes$/);
});
