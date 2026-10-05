import test from "node:test";
import assert from "node:assert/strict";

import { dispatch } from "../src/logic.ts";
import { summary } from "../src/selectors.ts";
test("事件筛选与计数", () => { const events = [{ name: "ready", payload: 1 }, { name: "ready", payload: 2 }, { name: "end", payload: null }]; assert.deepEqual(dispatch(events, "ready"), [1, 2]); assert.deepEqual(summary(events), { ready: 2, end: 1 }); });
