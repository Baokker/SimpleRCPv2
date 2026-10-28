import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";

// Captures the chapter 3 prototype figures (3-5 to 3-11) with one Alice/Bob session on the demo project.
// Usage: node scripts/capture-guard-thesis-screenshots.mjs serve   (keep running)
//        node scripts/capture-guard-thesis-screenshots.mjs capture
//        node scripts/capture-guard-thesis-screenshots.mjs compose
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const batch = process.env.CAPTURE_TAG ? `thesis-screenshots-${process.env.CAPTURE_TAG}` : "thesis-screenshots";
const intermediate = path.join(root, ".test-workspaces", batch);
const output = path.join(root, "docs/guard", batch);
const serverPort = 4031;
const clientPort = 5191;
const origin = `http://127.0.0.1:${clientPort}`;
// Same layout as the chapter 4 and 5 figures: narrow panes, a side panel of 420 px, scale 2.
const viewport = { width: 1000, height: 900 };
const scale = 2;
const action = process.argv[2];
await fs.mkdir(output, { recursive: true });

if (action === "serve") {
  const settings = {
    PORT: String(serverPort), SIMPLERCP_HOST: "127.0.0.1", SIMPLERCP_PUBLIC_URL: origin,
    SIMPLERCP_DATA_DIR: path.join(intermediate, "data"), SIMPLERCP_WORKSPACES_DIR: path.join(intermediate, "data/workspaces"),
    SIMPLERCP_OPENCODE_PORT: "4111", SIMPLERCP_FAKE_AGENT_RUNTIME: "false",
    SIMPLERCP_TERMINAL_ENABLED: "true", SIMPLERCP_SHELL: "/bin/sh", SIMPLERCP_TERMINAL_HOME: path.join(intermediate, "home"),
    SIMPLERCP_GUARD_MODE: "full", SIMPLERCP_GUARD_LLM_MODE: "suggest", SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS: "20000",
    VITE_SIMPLERCP_API_ORIGIN: `http://127.0.0.1:${serverPort}`, VITE_SIMPLERCP_CLIENT_PORT: String(clientPort),
    SIMPLERCP_TERMINAL_ENV_ALLOW: "PS1", PS1: "demo $ "
  };
  await fs.mkdir(settings.SIMPLERCP_TERMINAL_HOME, { recursive: true });
  await fs.writeFile(path.join(output, "config.json"), JSON.stringify({ ...settings, codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), viewport, scale, startedAt: new Date().toISOString() }, null, 2) + "\n");
  const children = [
    spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: path.join(root, "apps/server"), env: { ...process.env, ...settings }, stdio: "inherit" }),
    spawn(process.execPath, [path.join(root, "apps/client/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(clientPort)], { cwd: path.join(root, "apps/client"), env: { ...process.env, ...settings }, stdio: "inherit" })
  ];
  const stop = () => { for (const child of children) child.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await Promise.all(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
} else {
  const playwrightRequire = createRequire(require.resolve("@playwright/test", { paths: [path.join(root, "tests"), root] }));
  const { chromium } = playwrightRequire("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    if (action === "capture") await capture(browser);
    else if (action === "compose") await compose(browser);
    else throw new Error("请指定 serve、capture 或 compose");
  } finally { await browser.close(); }
}

async function open(browser, theme, name, role) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  await context.addInitScript(({ theme }) => {
    localStorage.setItem("simplercp.theme", theme);
    localStorage.setItem("simplercp.layout.collaborationWidth", "420");
    localStorage.setItem("simplercp.layout.workspaceWidth", "180");
    // A taller terminal keeps the command output and the guard status line readable.
    localStorage.setItem("simplercp.layout.terminalHeight", "300");
  }, { theme });
  const page = await context.newPage();
  await page.goto(`${origin}/projects/demo`);
  await page.getByTestId("display-name").fill(name);
  await page.getByTestId("member-role").selectOption(role);
  await page.getByTestId("join-project").click();
  await page.getByTestId("status-bar").waitFor();
  await page.getByTestId("dir-src").click();
  await page.getByTestId("file-src/index.js").click();
  return { context, page };
}
function commandBox(page) { return page.locator('.terminal-command-box input[placeholder="Submit a terminal command"]'); }
async function run(page, command, expected) {
  await commandBox(page).fill(command);
  await commandBox(page).press("Enter");
  await page.locator(".terminal-guard-status").filter({ hasText: expected }).waitFor({ timeout: 30_000 });
}
async function shot(page, name) {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
  await fs.writeFile(path.join(output, `${name}.txt`), await page.locator("body").innerText());
}
async function pair(alice, bob, name) {
  await shot(alice, `${name}-alice-dark`);
  await shot(bob, `${name}-bob-light`);
}

async function capture(browser) {
  const alice = await open(browser, "dark", "Alice", "lead");
  const bob = await open(browser, "light", "Bob", "newcomer");
  try {
    for (const { page } of [alice, bob]) await page.getByTestId("collab-tab-team").click();
    await commandBox(bob.page).waitFor();
    await bob.page.waitForTimeout(1000);
    await pair(alice.page, bob.page, "05-overview");

    await run(bob.page, "ls", "Ran");
    await bob.page.waitForTimeout(800);
    await pair(alice.page, bob.page, "06-allowed");

    await run(bob.page, "sudo ls", "Blocked");
    await pair(alice.page, bob.page, "07-privilege-blocked");

    await run(bob.page, "cat ../projects/demo/project.json", "Blocked");
    await shot(bob.page, "08-path-blocked-bob-light");

    // Capture while the model is still reviewing; the request then expires after the approval timeout.
    await commandBox(bob.page).fill("curl -s https://example.com");
    await commandBox(bob.page).press("Enter");
    await bob.page.getByTestId("guard-notification").filter({ hasText: "reviewing" }).waitFor({ timeout: 15_000 });
    await pair(alice.page, bob.page, "10-model-reviewing");

    await bob.page.getByTestId("collab-tab-agent").click();
    await bob.page.getByTestId("agent-prompt").fill("Run sudo ls in the shared terminal and show me the result.");
    await bob.page.getByTestId("agent-run-submit").click();
    await bob.page.getByTestId("agent-response").last().waitFor({ timeout: 240_000 });
    await bob.page.getByTestId("agent-work-details-status").filter({ hasText: /已结束|Completed|Failed/ }).first().waitFor({ timeout: 240_000 }).catch(() => undefined);
    await shot(bob.page, "09-agent-blocked-bob-light");

    await alice.page.getByTestId("activity-feed").filter({ hasText: "expired" }).waitFor({ timeout: 60_000 });
    await shot(alice.page, "11-activity-alice-dark");
  } finally {
    await alice.context.close();
    await bob.context.close();
  }
}

async function compose(browser) {
  const files = await fs.readdir(output);
  for (const name of files.filter((name) => name.endsWith("-alice-dark.png") && files.includes(name.replace("-alice-dark.png", "-bob-light.png")))) {
    const prefix = name.replace("-alice-dark.png", "");
    const gap = 8;
    const context = await browser.newContext({ viewport: { width: viewport.width * 2 + gap, height: viewport.height }, deviceScaleFactor: scale });
    const page = await context.newPage();
    const sources = await Promise.all([name, `${prefix}-bob-light.png`].map(async (file) => `data:image/png;base64,${(await fs.readFile(path.join(output, file))).toString("base64")}`));
    await page.setContent(`<html><body style="margin:0;display:flex;gap:${gap}px;background:#fff"><img width="${viewport.width}" height="${viewport.height}" src="${sources[0]}"><img width="${viewport.width}" height="${viewport.height}" src="${sources[1]}"></body></html>`);
    await page.locator("img").evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({ path: path.join(output, `${prefix}-dual.png`) });
    await context.close();
  }
  assert((await fs.readdir(output)).some((file) => file.endsWith("-dual.png")), "没有可拼接的截图");
  console.log(JSON.stringify({ output }));
}
