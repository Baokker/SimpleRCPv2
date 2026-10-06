import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, reminderQuote, reset, historySize } from "../src/reminders.ts";
import { scheduledDelay, reminderLabel } from "../src/scheduling.ts";

test("日程提醒与时间计量", async () => {
  reset();
  assert.ok(evaluate(20, 0.1, "work") > 0);
  assert.ok(reminderQuote(30, 0.1, "work").amount > 0);
  assert.ok(historySize() > 0);
  assert.throws(() => evaluate(-1, 0.1, "work"), RangeError);
  assert.ok(await scheduledDelay(40) > 0);
  assert.match(reminderLabel("meeting", 3.1), /^meeting:\d+ minutes$/);
});
