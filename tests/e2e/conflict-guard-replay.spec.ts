import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { openAs } from "./helpers";

const root = fileURLToPath(new URL("../../", import.meta.url));
test("第三名成员看到幽灵成员输入、冻结与冲突卡片", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const health = await (await page.request.get("/api/health")).json();
  test.skip(health.features.conflictGuard !== "rules", "界面回放验收需要 rules 模式");
  const shop = path.join(root, "demo/conflict-shop");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await page.getByTestId("import-directory").click();
  await page.getByTestId("project-name").fill("replay-ui-acceptance");
  await page.getByTestId("project-directory").fill(shop);
  await page.getByTestId("create-project-submit").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  await openAs(page, "Observer", projectId);
  await page.getByTestId("collab-tab-conflict").click();
  await page.getByTestId("dir-src").click();
  await page.getByTestId("file-src/cart.ts").click();
  await page.waitForFunction(() => Boolean(window.__simplercpYjsSynced?.["src/cart.ts"]));
  const pricing = await fs.readFile(path.join(shop, "src/pricing.ts"), "utf8");
  const cart = await fs.readFile(path.join(shop, "src/cart.ts"), "utf8");
  const trace = [
    { schema: 3, seq: 1, at: 0, type: "session_start", mode: "rules", config: { idleMs: 1500 } },
    ...[["src/pricing.ts", pricing], ["src/cart.ts", cart]].map(([file, text], index) => ({ schema: 3, seq: index + 2, at: 0, type: "doc_open", file, text, textHash: createHash("sha256").update(text!).digest("hex") })),
    { schema: 3, seq: 4, at: 100, type: "edit", file: "src/pricing.ts", origin: { kind: "human", memberId: "Alice" }, ops: [{ from: pricing.indexOf("rate: number)"), deleted: "rate: number)", inserted: "rate: number, currency: string)" }], revisionAfter: 1 },
    { schema: 3, seq: 5, at: 200, type: "edit", file: "src/cart.ts", origin: { kind: "human", memberId: "Bob" }, ops: [{ from: cart.indexOf("amount, 0.1"), deleted: "amount, 0.1", inserted: "amount, 0.2" }], revisionAfter: 1 },
    { schema: 3, seq: 6, at: 250, type: "cursor", memberId: "Bob", file: "src/cart.ts", position: { lineNumber: 14, column: 10 } }
  ];
  const traceFile = path.join(root, ".test-workspaces/replay-ui-trace.jsonl");
  await fs.mkdir(path.dirname(traceFile), { recursive: true });
  await fs.writeFile(traceFile, trace.map((event) => JSON.stringify(event)).join("\n") + "\n");
  const child = spawn("pnpm", ["--filter", "@simplercp/server", "replay:ui", "--server", "http://127.0.0.1:4100", "--project", projectId, "--trace", traceFile, "--speed", "2", "--hold", "5000"], { cwd: root });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk.toString());
  child.stderr.on("data", (chunk) => output += chunk.toString());
  const completed = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  try {
    await expect(page.getByTestId("conflict-guard-panel")).toContainText("Replay Alice");
    await expect(page.getByTestId("conflict-current")).toContainText("调用签名不兼容");
    await expect(page.locator(".conflict-frozen-range").first()).toBeVisible();
    await expect(page.getByTestId("conflict-card").first()).toBeVisible();
    expect(await completed, output).toBe(0);
    expect(browserErrors).toEqual([]);
    expect(output).toContain('"participants":["Alice","Bob"]');
    const headers = await page.evaluate((id) => ({ "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`)! }), projectId);
    const recorded = await (await page.request.get(`/api/projects/${projectId}/conflict-guard/trace`, { headers })).text();
    const directory = path.join(root, "docs/conflict-guard/evidence/stage-4-ui");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "trace.jsonl"), recorded);
    await fs.writeFile(path.join(directory, "acceptance.json"), JSON.stringify({ ghostMembers: true, freezeDecoration: true, conflictCard: true, commandCompleted: true }, null, 2) + "\n");
  } finally {
    await testInfo.attach("replay-cli", { body: output, contentType: "text/plain" });
    await testInfo.attach("browser-errors", { body: JSON.stringify(browserErrors), contentType: "application/json" });
    if (child.exitCode === null) child.kill();
  }
});
