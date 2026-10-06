import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.env.D3_WORKSPACE;
const task = process.env.D3_TASK;
assert.ok(workspace && task, "D3_WORKSPACE and D3_TASK are required");
const load = (file) => import(pathToFileURL(path.join(workspace, "src", `${file}.ts`)).href);
test(`D3 acceptance ${task}`, async () => {
  if (["d3-01", "d3-07", "d3-11"].includes(task)) {
    const pricing = await load("pricing"); const cart = await load("cart");
    if (task === "d3-01") { assert.equal(pricing.quote(100, 0.1, "USD").net, 90); assert.equal(cart.invoiceLabel(100, "USD"), "USD 90.00"); }
    if (task === "d3-07") { assert.equal(pricing.quote(100, 0.1, "CNY").gross, 101.7); assert.equal(cart.grossEstimate(100), 101.7); }
    if (task === "d3-11") { assert.equal(pricing.quote(100, 0.1, "USD").currency, "USD"); assert.equal(cart.currencyLabel(100, "USD"), "USD 90.00"); }
  } else if (["d3-02", "d3-08", "d3-12"].includes(task)) {
    const intervals = await load("intervals"); const availability = await load("availability");
    if (task === "d3-02") { assert.equal(intervals.capacity(100, 0.1, "room").used, 116); assert.equal(availability.roomSummary(100), "116/364"); }
    if (task === "d3-08") { assert.equal(intervals.capacity(500, 0.1, "room").full, true); assert.equal(availability.roomFull(500), true); assert.equal(availability.roomFull(10), false); }
    if (task === "d3-12") { assert.equal(intervals.capacity(100, 0.1, "room").utilization, 116 / 480); assert.equal(availability.roomUtilization(100), 116 / 480); }
  } else if (["d3-03", "d3-09", "d3-13"].includes(task)) {
    const weights = await load("weights"); const lru = await load("lru");
    if (task === "d3-03") { assert.equal(weights.weightDetails(10, 0.1, "image").bytes, 75); assert.equal(lru.admittedLabel(10), "75 bytes"); }
    if (task === "d3-09") { assert.equal(weights.memoryBudget(2_000_000, 0.1, "image").overBudget, true); assert.equal(lru.fitsBudget(2_000_000), false); assert.equal(lru.fitsBudget(10), true); }
    if (task === "d3-13") { assert.equal(weights.memoryBudget(10, 0.1, "image").fraction, 75 / 1048576); assert.equal(lru.budgetFraction(10), 75 / 1048576); }
  } else if (task === "d3-04") {
    const width = await load("width"); const layout = await load("layout"); assert.equal(width.lineMetrics(100, 0.1, "letter").total, 100); assert.equal(layout.layoutSummary(100), "80/100");
  } else if (["d3-05", "d3-10"].includes(task)) {
    const retry = await load("retry"); const delivery = await load("delivery");
    if (task === "d3-05") { assert.equal(retry.retryBudget(6).exhausted, true); assert.equal(delivery.retrySummary(6), "stop"); assert.equal(delivery.retrySummary(1), "100"); }
    if (task === "d3-10") { assert.deepEqual(retry.retryWindow(1), { delay: 100, attemptsLeft: 5 }); assert.equal(delivery.retryWindowLabel(1), "100:5"); }
  } else if (task === "d3-06") {
    const tariffs = await load("tariffs"); const invoices = await load("invoices"); assert.equal(tariffs.chargeBreakdown(100).total, 19.08); assert.equal(invoices.chargeLabel(100), "19.08");
  } else throw new Error(`Unknown task ${task}`);
});
