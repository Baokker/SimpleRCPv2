import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openAs } from "./helpers";

const root = fileURLToPath(new URL("../../", import.meta.url));
test("第三名成员看到幽灵成员输入、冻结与冲突卡片", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const health = await (await page.request.get("/api/health")).json();
  test.skip(health.features.conflictGuard !== "rules", "界面回放验收需要 rules 模式");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await page.getByTestId("new-project").click();
  await page.getByTestId("project-name").fill("replay-ui-acceptance");
  await page.getByTestId("create-project-submit").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  await openAs(page, "Observer", projectId);
  await page.getByTestId("collab-tab-conflict").click();
  const traceFile = path.join(root, "packages/conflict-guard/bench/datasets/d1-v1/traces/d1-1-conflict.jsonl");
  const child = spawn("pnpm", ["--filter", "@simplercp/conflict-guard", "replay:ui", "--server", "http://127.0.0.1:4100", "--project", projectId, "--trace", traceFile, "--speed", "2", "--hold", "5000"], { cwd: root });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk.toString());
  child.stderr.on("data", (chunk) => output += chunk.toString());
  const completed = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  try {
    await page.getByTestId("dir-src").click();
    await page.getByTestId("file-src/consumer.ts").click();
    await page.waitForFunction(() => Boolean(window.__simplercpYjsSynced?.["src/consumer.ts"]));
    await expect(page.getByTestId("conflict-guard-panel")).toContainText("Replay origin", { timeout: 20_000 });
    await expect(page.getByTestId("conflict-current")).toContainText("调用签名不兼容", { timeout: 20_000 });
    await expect(page.locator(".conflict-frozen-range").first()).toBeVisible();
    await expect(page.getByTestId("conflict-card").first()).toBeVisible();
    expect(await completed, output).toBe(0);
    expect(browserErrors).toEqual([]);
    expect(output).toContain('"participants":["origin","candidate"]');
    const headers = await page.evaluate((id) => ({ "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`)! }), projectId);
    const recorded = await (await page.request.get(`/api/projects/${projectId}/conflict-guard/trace`, { headers })).text();
    const directory = path.join(root, "docs/conflict-guard/evidence/stage-4-ui");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "trace.jsonl"), recorded);
    await fs.writeFile(path.join(directory, "acceptance.json"), JSON.stringify({ trace: "d1-1-conflict", ghostMembers: true, freezeDecoration: true, conflictCard: true, commandCompleted: true }, null, 2) + "\n");
  } finally {
    await testInfo.attach("replay-cli", { body: output, contentType: "text/plain" });
    await testInfo.attach("browser-errors", { body: JSON.stringify(browserErrors), contentType: "application/json" });
    if (child.exitCode === null) child.kill();
  }
});
