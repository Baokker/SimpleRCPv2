import test from "node:test";
import assert from "node:assert/strict";

import { format } from "../src/logic.ts";
import { preview } from "../src/selectors.ts";
test("格式化与预览", () => { assert.equal(format("  hello  world ", "long"), "hello world"); assert.deepEqual(preview(["abcdefghijkl"]), ["abcdefghij"]); });
