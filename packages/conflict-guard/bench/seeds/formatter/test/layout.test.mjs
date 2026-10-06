import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, layoutQuote, reset, historySize } from "../src/layout.ts";
import { documentWidth, documentLabel } from "../src/document.ts";

test("文档宽度与布局标记", async () => {
  reset();
  assert.ok(evaluate(20, 0.1, "plain") > 0);
  assert.ok(layoutQuote(30, 0.1, "plain").amount > 0);
  assert.ok(historySize() > 0);
  assert.throws(() => evaluate(-1, 0.1, "plain"), RangeError);
  assert.ok(await documentWidth(40) > 0);
  assert.match(documentLabel("readme", 3.1), /^readme:\d+ columns$/);
});
