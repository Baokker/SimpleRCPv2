import test from "node:test";
import assert from "node:assert/strict";

import { tax } from "../src/logic.ts";
import { statement } from "../src/selectors.ts";
test("税额与账单", () => { assert.equal(tax({ total: 12.34, currency: "USD" }, 0.2), 2.47); assert.equal(statement({ total: 100, currency: "USD" }), "USD 120.00"); });
