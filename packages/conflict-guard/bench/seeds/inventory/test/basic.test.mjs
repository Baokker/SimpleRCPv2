import test from "node:test";
import assert from "node:assert/strict";

import { reserve } from "../src/logic.ts";
import { inStock } from "../src/selectors.ts";
test("库存扣减与筛选", () => { assert.deepEqual(reserve({ sku: "a", count: 3 }, 2), { sku: "a", count: 1 }); assert.deepEqual(inStock([{ sku: "a", count: 0 }, { sku: "b", count: 2 }]), ["b"]); assert.throws(() => reserve({ sku: "a", count: 0 }, 1)); });
