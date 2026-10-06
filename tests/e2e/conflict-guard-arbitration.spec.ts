import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openAs } from "./helpers";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = path.join(root, "docs/conflict-guard/evidence/stage-7-manual");
test.skip(process.env.SIMPLERCP_STAGE7_LIVE !== "1", "通过显式命令执行真实 Agent 验收");
test.setTimeout(540000);
const boundaries = "Use edit or write for every file change. Never use bash to write. Do not inspect credentials, environment files, parent directories, or other projects. On permission rejection follow the message and reread files. Print PLAN with file#symbol lines and END_PLAN before changing files.";
const producer = `Change only src/pricing.ts: give applyDiscount a REQUIRED third parameter currency: string. Keep its calculation unchanged. Do not repair any callers. After the edit use bash only to run sleep 45 so another collaborator can finish; then report. ${boundaries}`;
const consumer = `First add the comment // consumer-owned marker above the first import in src/cart.ts using edit. Then change ONLY Cart.total's existing applyDiscount(amount, 0.1) call to applyDiscount(amount + 1, 0.1), keeping two arguments for this first attempt. If permission is rejected with a suggestion, reread pricing.ts and cart.ts and adapt the call to the current signature, including currency if needed. Do not change pricing.ts. ${boundaries}`;

async function request(page: Page, id: string, route: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ id, route, method, body }) => {
    const response = await fetch(`/api/projects/${id}${route}`, { method, headers: { "content-type": "application/json", "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`)! }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
    return response.status === 204 ? undefined : response.json();
  }, { id, route, method, body });
}
async function pair(browser: Browser, name: string) {
  const a = await browser.newContext(); const b = await browser.newContext();
  const alice = await a.newPage(); const bob = await b.newPage();
  await alice.goto("/"); await alice.getByTestId("import-directory").click();
  await alice.getByTestId("project-name").fill(`${name}-${Date.now()}`); await alice.getByTestId("project-directory").fill(path.join(root, "demo/conflict-shop"));
  await alice.getByTestId("create-project-submit").click(); await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
  const id = new URL(alice.url()).pathname.split("/").at(-1)!;
  await openAs(alice, "Alice", id); await openAs(bob, "Bob", id);
  await alice.getByTestId("collab-tab-conflict").click(); await bob.getByTestId("collab-tab-conflict").click();
  return { alice, bob, id, async close() { await a.close(); await b.close(); } };
}
async function run(page: Page, id: string, prompt: string) {
  const budgetFile = path.join(root, ".test-workspaces/stage7-run-budget.json");
  const budget = JSON.parse(await fs.readFile(budgetFile, "utf8"));
  if (budget.used >= 40) throw new Error("阶段七 Agent 次数达到上限");
  budget.used += 1; budget.runs.push({ taskId: "browser", injection: "on", round: 1 });
  await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2) + "\n");
  const { session } = await request(page, id, "/agent/sessions", "POST", { title: "阶段七验收" });
  const { run } = await request(page, id, "/agent/runs", "POST", { prompt, sessionId: session.id, contexts: [{ type: "file", path: "src/pricing.ts" }, { type: "file", path: "src/cart.ts" }] });
  budget.runs.at(-1).runId = run.id; await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2) + "\n");
  return run.id as string;
}
async function state(page: Page, id: string) { return request(page, id, "/conflict-guard/state"); }
async function finished(page: Page, id: string, runId: string) {
  await expect.poll(async () => (await request(page, id, `/agent/runs/${runId}`)).run.status, { timeout: 180000, intervals: [300] }).toMatch(/completed|cancelled|failed/);
  return (await request(page, id, `/agent/runs/${runId}`)).run;
}
async function save(context: Awaited<ReturnType<typeof pair>>, name: string) {
  await fs.mkdir(evidence, { recursive: true });
  await context.alice.screenshot({ path: path.join(evidence, `${name}-alice.png`), fullPage: true });
  await context.bob.screenshot({ path: path.join(evidence, `${name}-bob.png`), fullPage: true });
  await fs.writeFile(path.join(evidence, `${name}.json`), JSON.stringify(await state(context.alice, context.id), null, 2) + "\n");
  const trace = await context.alice.evaluate(async (id) => (await fetch(`/api/projects/${id}/conflict-guard/trace`, { headers: { "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`)! } })).text(), context.id);
  await fs.writeFile(path.join(evidence, `${name}.jsonl`), trace);
}

test("real owner arbitration: intents, both accept, yield, same-owner retry, and human priority", async ({ browser }) => {
  const scenarios = (process.env.SIMPLERCP_STAGE7_SCENARIOS ?? "accept,yield,same,human").split(",");
  for (const action of (["accept", "yield"] as const).filter((action) => scenarios.includes(action))) {
    const context = await pair(browser, `stage7-${action}`);
    try {
      const first = await run(context.alice, context.id, producer);
      await expect.poll(async () => (await state(context.alice, context.id)).intents.some((intent: any) => intent.actor.runId === first && intent.actualScope.includes("src/pricing.ts#applyDiscount")), { timeout: 90000 }).toBe(true);
      const second = await run(context.bob, context.id, consumer);
      await expect(context.alice.getByTestId("agent-intent")).toHaveCount(2, { timeout: 30000 });
      await expect(context.bob.getByTestId("agent-intent")).toHaveCount(2);
      const aliceCard = context.alice.getByTestId("owner-intent-card").first();
      const bobCard = context.bob.getByTestId("owner-intent-card").first();
      await expect(aliceCard).toBeVisible({ timeout: 90000 }); await expect(bobCard).toBeVisible();
      if (action === "accept") {
        await expect(aliceCard.getByRole("button", { name: "采纳建议" })).toBeEnabled({ timeout: 35000 });
        await aliceCard.getByRole("button", { name: "采纳建议" }).click();
        await expect(aliceCard).toBeVisible();
        await bobCard.getByRole("button", { name: "采纳建议" }).click();
        await expect.poll(async () => (await state(context.alice, context.id)).arbitration.outcomes.accepted).toBe(1);
      } else {
        await bobCard.getByRole("button", { name: "让我的 Agent 让路" }).click();
        await expect.poll(async () => (await request(context.bob, context.id, `/agent/runs/${second}`)).run.status).toBe("cancelled");
        await expect.poll(async () => (await request(context.alice, context.id, "/workspace/file?path=src%2Fcart.ts")).content).not.toContain("consumer-owned marker");
      }
      await finished(context.alice, context.id, first); const result = await finished(context.bob, context.id, second);
      if (action === "accept") expect(result.status).toBe("completed");
      await expect(context.alice.getByTestId("arbitration-statistics")).toContainText("累计 1 次");
      await save(context, `01-cross-${action}`);
    } finally { await context.close(); }
  }
  if (scenarios.includes("same")) {
  const same = await pair(browser, "stage7-same-owner");
  try {
    const first = await run(same.alice, same.id, producer);
    await expect.poll(async () => (await state(same.alice, same.id)).intents.some((intent: any) => intent.actor.runId === first && intent.actualScope.length), { timeout: 90000 }).toBe(true);
    const second = await run(same.alice, same.id, consumer);
    await expect.poll(async () => (await state(same.alice, same.id)).intents.some((intent: any) => intent.actor.runId === second && intent.status === "waiting"), { timeout: 90000 }).toBe(true);
    await expect(same.alice.getByTestId("owner-intent-card")).toHaveCount(0);
    await finished(same.alice, same.id, first); await finished(same.alice, same.id, second);
    await save(same, "02-same-owner");
  } finally { await same.close(); }
  }
  if (scenarios.includes("human")) {
  const human = await pair(browser, "stage7-human-priority");
  try {
    await human.alice.getByTestId("dir-src").click(); await human.alice.getByTestId("file-src/pricing.ts").click();
    await human.alice.waitForFunction(() => window.__simplercpYjsSynced?.["src/pricing.ts"]);
    await human.alice.evaluate(() => { const editor = window.__simplercpEditors!["src/pricing.ts"]; const model = editor.getModel()!; const value = model.getValue(); const from = value.indexOf("rate: number)"); const start = model.getPositionAt(from); const end = model.getPositionAt(from + "rate: number)".length); editor.executeEdits("manual", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: "rate: number, currency: string)" }]); });
    await human.alice.waitForTimeout(2000);
    const agent = await run(human.bob, human.id, consumer); await finished(human.bob, human.id, agent);
    await expect(human.alice.locator(".conflict-frozen-range")).toHaveCount(0); await expect(human.alice.getByTestId("conflict-card")).toHaveCount(0);
    await expect.poll(async () => (await state(human.bob, human.id)).arbitration.members.some((member: any) => member.light > 0)).toBe(true);
    await save(human, "03-human-priority");
  } finally { await human.close(); }
  }
});
