import test from "node:test";
import assert from "node:assert/strict";

import { receipt } from "../src/selectors.ts";
import { total } from "../src/logic.ts";
test("购物价格与折扣", () => { assert.equal(total([{ id: "a", price: 20 }, { id: "b", price: 30 }]), 50); assert.equal(receipt([{ id: "a", price: 100 }]), "90.00"); });
