import test from "node:test";
import assert from "node:assert/strict";

import { requireAccess } from "../src/logic.ts";
import { visibleActions } from "../src/selectors.ts";
test("权限筛选与拒绝", () => { const grants = [{ subject: "reader", action: "read" }]; assert.deepEqual(visibleActions(grants, "reader"), ["read"]); assert.throws(() => requireAccess(grants, "reader", "delete")); });
