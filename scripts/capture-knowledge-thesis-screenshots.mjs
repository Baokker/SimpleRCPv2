import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";

// Captures the chapter 5 prototype figures by replaying the demo steps in scripts/knowledge-thesis-screenshots/.
// Each step is a Playwright function `async (page) => {}` that finds Alice and Bob through the browser contexts.
// Usage: node scripts/capture-knowledge-thesis-screenshots.mjs serve   (keep running; uses MiniMax from .env)
//        node scripts/capture-knowledge-thesis-screenshots.mjs capture
//        node scripts/capture-knowledge-thesis-screenshots.mjs compose
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const steps = path.join(root, "scripts/knowledge-thesis-screenshots");
const batch = process.env.CAPTURE_TAG ? `thesis-screenshots-${process.env.CAPTURE_TAG}` : "thesis-screenshots";
const intermediate = path.join(root, ".test-workspaces", batch);
const output = path.join(root, "docs/knowledge", batch);
const serverPort = 4180;
const clientPort = 5180;
const origin = `http://127.0.0.1:${clientPort}`;
// Same layout as the chapter 3 and 4 figures (narrow panes, scale 2), except the side panel is 480 px:
// with the extra knowledge tab, 420 px makes the tab bar scroll and cut off Chat and Team.
const viewport = { width: 1060, height: 900 };
const panelWidth = "480";
const scale = 2;
const order = ["01-setup", "02-manual", "03-discussion-import", "03b-import", "03c-magic", "04-capture-agent-start", "04b-agent-progress", "05-correct-agent", "06-human-drafts", "06b-confirm-human-drafts", "07-agent-recap", "08-agent-knowledge", "09-demo-reading", "10-post-check", "11-review-human-cards", "12-final-collaboration"];
// Some steps wait on model output and may time out; the original demo then retried the recap step once.
const retry = new Set(["07-agent-recap"]);
const figures = { "07-discussion-capture": "图5-4a", "16-agent-recap-draft": "图5-4b", "19-knowledge-detail": "图5-6a", "20-inline-knowledge": "图5-6b", "21-agent-knowledge-preview": "图5-7a", "23-agent-post-check": "图5-7b", "24-knowledge-activity": "图5-7c" };
const action = process.argv[2];
await fs.mkdir(output, { recursive: true });

if (action === "serve") {
  const settings = {
    PORT: String(serverPort), SIMPLERCP_OPENCODE_PORT: "4196", KNOWLEDGE: "full",
    SIMPLERCP_TERMINAL_ENABLED: "false", SIMPLERCP_FAKE_AGENT_RUNTIME: "false",
    SIMPLERCP_PUBLIC_URL: origin, SIMPLERCP_DATA_DIR: path.join(intermediate, "data"), TMPDIR: path.join(intermediate, "tmp"),
    VITE_SIMPLERCP_API_ORIGIN: `http://127.0.0.1:${serverPort}`, VITE_SIMPLERCP_CLIENT_PORT: String(clientPort)
  };
  await fs.mkdir(settings.TMPDIR, { recursive: true });
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

async function capture(browser) {
  globalThis.CAPTURE_OUTPUT = output + path.sep;
  globalThis.CAPTURE_ORIGIN = origin;
  globalThis.CAPTURE_CONTEXT = { viewport, deviceScaleFactor: scale };
  globalThis.CAPTURE_PANEL_WIDTH = panelWidth;
  // Every context gets the shared pane widths; the first one (Alice) is dark, later ones (Bob) are light.
  const newContext = browser.newContext.bind(browser);
  let created = 0;
  browser.newContext = async (options) => {
    const context = await newContext({ ...options, viewport, deviceScaleFactor: scale });
    const theme = created++ === 0 ? "dark" : "light";
    await context.addInitScript(({ theme, panelWidth }) => {
      if (!localStorage.getItem("simplercp.theme")) localStorage.setItem("simplercp.theme", theme);
      localStorage.setItem("simplercp.layout.workspaceWidth", "180");
      localStorage.setItem("simplercp.layout.collaborationWidth", panelWidth);
    }, { theme, panelWidth });
    // Steps scroll targets into view, which can shift a slightly overflowing panel sideways; undo that before each shot.
    context.on("page", (page) => {
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async (options) => {
        await page.evaluate(() => { for (const element of document.querySelectorAll("*")) if (element.scrollLeft) element.scrollLeft = 0; }).catch(() => undefined);
        return screenshot(options);
      };
    });
    return context;
  };
  const alice = await (await browser.newContext()).newPage();
  await alice.goto(`${origin}/projects/demo`);
  const log = [];
  // CAPTURE_STEPS=01-setup,02-manual runs only the listed steps, for debugging a single step.
  const selected = process.env.CAPTURE_STEPS ? order.filter((name) => process.env.CAPTURE_STEPS.split(",").includes(name)) : order;
  for (const name of selected) {
    const step = eval(await fs.readFile(path.join(steps, `${name}.js`), "utf8"));
    for (let attempt = 1; attempt <= (retry.has(name) ? 2 : 1); attempt += 1) {
      const started = Date.now();
      try {
        const result = await step(alice);
        log.push({ name, attempt, ok: true, ms: Date.now() - started, result });
        console.log(JSON.stringify({ step: name, attempt, ok: true }));
        break;
      } catch (error) {
        // The original demo continued after a failed step; later steps pick up the state that exists.
        log.push({ name, attempt, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 600) });
        console.log(JSON.stringify({ step: name, attempt, ok: false, error: String(error?.message ?? error).split("\n")[0] }));
        const pages = browser.contexts().flatMap((context) => context.pages());
        for (const [index, page] of pages.entries()) await page.screenshot({ path: path.join(output, `failed-${name}-${index ? "bob" : "alice"}.png`) }).catch(() => undefined);
      }
    }
  }
  await fs.writeFile(path.join(output, "steps.json"), JSON.stringify(log, null, 2) + "\n");
  const missing = Object.keys(figures).filter((name) => ![`${name}-alice.png`, `${name}-bob.png`].every((file) => existsSync(path.join(output, file))));
  console.log(JSON.stringify({ missing }));
}

async function compose(browser) {
  const files = await fs.readdir(output);
  const gap = 8;
  for (const name of files.filter((name) => name.endsWith("-alice.png") && files.includes(name.replace("-alice.png", "-bob.png")))) {
    const prefix = name.replace("-alice.png", "");
    const context = await browser.newContext({ viewport: { width: viewport.width * 2 + gap, height: viewport.height }, deviceScaleFactor: scale });
    const page = await context.newPage();
    const sources = await Promise.all([name, `${prefix}-bob.png`].map(async (file) => `data:image/png;base64,${(await fs.readFile(path.join(output, file))).toString("base64")}`));
    await page.setContent(`<html><body style="margin:0;display:flex;gap:${gap}px;background:#fff"><img width="${viewport.width}" height="${viewport.height}" src="${sources[0]}"><img width="${viewport.width}" height="${viewport.height}" src="${sources[1]}"></body></html>`);
    await page.locator("img").evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({ path: path.join(output, `${prefix}-dual.png`) });
    await context.close();
  }
  console.log(JSON.stringify({ output, figures }));
}
