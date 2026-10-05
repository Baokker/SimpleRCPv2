import test from "node:test";
import assert from "node:assert/strict";

import { duration } from "../src/logic.ts";
import { conflicts } from "../src/selectors.ts";
test("日程时长与重叠", () => { assert.equal(duration({ start: 1, end: 4 }), 3); assert.deepEqual(conflicts([{ start: 0, end: 2 }, { start: 4, end: 6 }], { start: 1, end: 4 }), [{ start: 0, end: 2 }]); });
