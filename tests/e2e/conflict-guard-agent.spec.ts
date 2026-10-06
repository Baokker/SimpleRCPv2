import { expect, test, type Browser, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { openAs } from "./helpers";

const shop = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidence = fileURLToPath(new URL("../../docs/conflict-guard/evidence/stage-6-manual/", import.meta.url));
test("Agent receives a rejection and retries while the human remains editable", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const alice = await a.newPage();
  const bob = await b.newPage();
  try {
    await alice.goto("/");
    await alice.getByTestId("import-directory").click();
    await alice.getByTestId("project-name").fill("stage6-agent");
    await alice.getByTestId("project-directory").fill(shop);
    await alice.getByTestId("create-project-submit").click();
    await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
    const id = new URL(alice.url()).pathname.split("/").at(-1)!;
    await openAs(alice, "Alice", id);
    await openAs(bob, "Bob", id);
    const health = await alice.request.get("/api/health").then((response) => response.json());
    test.skip(health.features.conflictGuard === "off", "需要启用冲突预防");
    const shadow = health.features.conflictGuard === "observe";
    await alice.getByTestId("dir-src").click();
    await alice.getByTestId("file-src/pricing.ts").click();
    await alice.waitForFunction(() => window.__simplercpYjsSynced?.["src/pricing.ts"]);
    await edit(alice, "src/pricing.ts", "rate: number)", "rate: number, currency: string)");
    await alice.getByTestId("collab-tab-conflict").click();
    await expect(alice.getByTestId("conflict-guard-panel")).toContainText("applyDiscount");
    await bob.getByTestId("collab-tab-agent").click();
    const declaration = (from: string, to: string) => `src/cart.ts:${encodeURIComponent(from)}=>${encodeURIComponent(to)}`;
    await bob.getByTestId("agent-prompt").fill(`fake-edit=${declaration("applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)")} fake-on-reject=${declaration("applyDiscount(amount, 0.1)", 'applyDiscount(amount, 0.1, "CNY")')} fake-delay=300`);
    await bob.getByTestId("agent-run-submit").click();
    await expect(bob.getByTestId("agent-message-list")).toContainText("Completed", { timeout: 20000 });
    await expect(bob.getByTestId("agent-guard-result")).toContainText(shadow ? "修改被拒绝 0 次" : "修改被拒绝 1 次");
    if (!shadow) await expect(bob.getByTestId("agent-last-rejection")).toContainText("signature");
    await expect(alice.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect(alice.getByTestId("conflict-card")).toHaveCount(0);
    await edit(alice, "src/pricing.ts", "price * (1 - rate)", "price * (1 - rate) + 0");
    await expect(alice.getByTestId("agent-conflict-record").first()).toContainText(shadow ? "若启用将被拒绝" : "T2");
    await expect(alice.getByTestId("agent-conflict-record").first()).toContainText("Bob 的 Agent");
    const content = await bob.evaluate(async (projectId) => {
      const response = await fetch(`/api/projects/${projectId}/workspace/file?path=src%2Fcart.ts`, { headers: { "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${projectId}`)! } });
      return response.json();
    }, id);
    expect(content.content).toContain(shadow ? "applyDiscount(amount + 1, 0.1)" : 'applyDiscount(amount, 0.1, "CNY")');
    if (process.env.SIMPLERCP_STAGE6_EVIDENCE === "true") {
      await fs.mkdir(evidence, { recursive: true });
      const state = await alice.evaluate(async (projectId) => {
        const response = await fetch(`/api/projects/${projectId}/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${projectId}`)! } });
        return response.json();
      }, id);
      await fs.writeFile(path.join(evidence, `${health.features.conflictGuard}.json`), JSON.stringify({ state, content, checks: { rejection: !shadow, shadow, humanEditable: true, noHumanFreeze: true, noHumanCard: true } }, null, 2) + "\n");
    }
  } finally { await a.close(); await b.close(); }
});

test("the later Agent receives a rejection for an active Agent dependency", async ({ browser }) => {
  test.skip(process.env.SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS === "1", "此用例需要两个并发 run");
  const context = await openAgentPair(browser);
  try {
    const { alice, bob, id } = context;
    await alice.getByTestId("collab-tab-agent").click();
    await bob.getByTestId("collab-tab-agent").click();
    await alice.getByTestId("agent-prompt").fill(`fake-edit=${declaration("src/pricing.ts", "rate: number)", "rate: number, currency: string)")} fake-delay=7000`);
    await alice.getByTestId("agent-run-submit").click();
    await expect.poll(async () => {
      const state = await guardState(alice, id);
      return state.activeSymbols.some((set: { actor: { kind: string }; symbols: Array<{ key: string }> }) => set.actor.kind === "agent" && set.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount")));
    }).toBe(true);
    await bob.getByTestId("agent-prompt").fill(`fake-edit=${declaration("src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)")} fake-delay=100`);
    await bob.getByTestId("agent-run-submit").click();
    await expect(bob.getByTestId("agent-guard-result")).toContainText("修改被拒绝 1 次", { timeout: 20000 });
    await expect(bob.getByTestId("agent-last-rejection")).toContainText("signature");
    await expect(bob.getByTestId("agent-last-rejection")).toContainText("agent:");
    await expect(alice.getByTestId("agent-message-list")).toContainText("Completed", { timeout: 20000 });
    await saveEvidence("agent-agent", alice, id, { laterEditRejected: true });
  } finally { await context.close(); }
});

test("the owner sees a T3 withdrawal when the dependency changes during the run", async ({ browser }) => {
  const context = await openAgentPair(browser);
  try {
    const { alice, bob, id } = context;
    await alice.getByTestId("dir-src").click();
    await alice.getByTestId("file-src/pricing.ts").click();
    await alice.waitForFunction(() => window.__simplercpYjsSynced?.["src/pricing.ts"]);
    await bob.getByTestId("collab-tab-agent").click();
    await bob.getByTestId("agent-prompt").fill(`fake-edit=${declaration("src/cart.ts", "let amount = 0;", "let amount = 10;")} fake-delay=5000`);
    await bob.getByTestId("agent-run-submit").click();
    await expect.poll(async () => (await guardState(alice, id)).activeSymbols.some((set: { actor: { kind: string } }) => set.actor.kind === "agent")).toBe(true);
    await edit(alice, "src/pricing.ts", "rate: number)", "rate: number, currency: string)");
    await expect(bob.getByTestId("agent-guard-result")).toContainText("已撤回修改", { timeout: 20000 });
    await expect(bob.getByTestId("agent-message-list")).toContainText("Completed");
    await expect(bob.getByTestId("workspace-notice")).toContainText("已撤回 Agent 的");
    const content = await bob.request.get(`/api/projects/${id}/workspace/file?path=src%2Fcart.ts`, { headers: { "X-SimpleRCP-Member": await memberId(bob, id) } }).then((response) => response.json());
    expect(content.content).toContain("let amount = 0;");
    await expect(alice.locator(".conflict-frozen-range")).toHaveCount(0);
    await expect(alice.getByTestId("conflict-card")).toHaveCount(0);
    await saveEvidence("t3-revert", bob, id, { reverted: true, ownerNotified: true, runCompleted: true });
  } finally { await context.close(); }
});

const declaration = (file: string, from: string, to: string) => `${file}:${encodeURIComponent(from)}=>${encodeURIComponent(to)}`;
async function memberId(page: Page, id: string) {
  return page.evaluate((id) => sessionStorage.getItem(`simplercp.memberId.${id}`)!, id);
}
async function guardState(page: Page, id: string) {
  return page.request.get(`/api/projects/${id}/conflict-guard/state`, { headers: { "X-SimpleRCP-Member": await memberId(page, id) } }).then((response) => response.json());
}
async function saveEvidence(name: string, page: Page, id: string, checks: Record<string, boolean>) {
  if (process.env.SIMPLERCP_STAGE6_EVIDENCE !== "true") return;
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, `${name}.json`), JSON.stringify({ checks, state: await guardState(page, id) }, null, 2) + "\n");
}
async function openAgentPair(browser: Browser) {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const alice = await a.newPage();
  const bob = await b.newPage();
  await alice.goto("/");
  const health = await alice.request.get("/api/health").then((response) => response.json());
  if (!["rules", "full"].includes(health.features.conflictGuard)) {
    await a.close(); await b.close();
    test.skip(true, "此用例需要 rules 或 full 模式");
  }
  await alice.getByTestId("import-directory").click();
  await alice.getByTestId("project-name").fill(`stage6-agent-check-${Date.now()}`);
  await alice.getByTestId("project-directory").fill(shop);
  await alice.getByTestId("create-project-submit").click();
  await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
  const id = new URL(alice.url()).pathname.split("/").at(-1)!;
  await openAs(alice, "Alice", id);
  await openAs(bob, "Bob", id);
  return { alice, bob, id, close: async () => { await a.close(); await b.close(); } };
}

async function edit(page: Page, file: string, before: string, after: string) {
  await page.evaluate(({ file, before, after }) => {
    const editor = window.__simplercpEditors?.[file]!;
    const model = editor.getModel()!;
    const from = model.getValue().indexOf(before);
    if (from < 0) throw new Error("未找到修改内容");
    const start = model.getPositionAt(from);
    const end = model.getPositionAt(from + before.length);
    editor.executeEdits("stage6", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { file, before, after });
}
