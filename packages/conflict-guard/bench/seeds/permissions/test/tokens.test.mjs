import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, tokenQuote, reset, historySize } from "../src/tokens.ts";
import { sessionLifetime, sessionLabel } from "../src/authentication.ts";

test("令牌期限与会话标记", async () => {
  reset();
  assert.ok(evaluate(20, 0.1, "reader") > 0);
  assert.ok(tokenQuote(30, 0.1, "reader").amount > 0);
  assert.ok(historySize() > 0);
  assert.throws(() => evaluate(-1, 0.1, "reader"), RangeError);
  assert.ok(await sessionLifetime(40) > 0);
  assert.match(sessionLabel("alice", 3.1), /^alice:\d+ minutes$/);
});
