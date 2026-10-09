import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { parse } = require("../apps/server/node_modules/dotenv/lib/main.js");
const environment = parse(await fs.readFile(path.join(root, ".env"), "utf8"));
const secrets = Object.entries(environment).filter(([name, value]) => /(?:KEY|TOKEN|SECRET)(?:_|$)/i.test(name) && value).map(([, value]) => value);
const intermediate = path.join(root, ".test-workspaces/thesis-screenshots");
const evidence = path.join(root, "docs/conflict-guard/evidence/thesis-screenshots");
const runtime = path.join(intermediate, "runtime");
const origin = "http://127.0.0.1:5187";
const action = process.argv[2];
const boundaries = "仅修改当前项目。使用 edit 或 write 修改文件，不使用 bash 写入文件。不要读取环境文件、密钥、父目录和其他项目。收到审批拒绝后，请根据原因重新读取共享文件，调整修改，然后继续。输出 PLAN、文件#符号与 END_PLAN。";
await fs.mkdir(runtime, { recursive: true });
await fs.mkdir(evidence, { recursive: true });

function safe(text) {
  assert(!secrets.some((value) => text.includes(value)), "密钥匹配计数大于零");
  return text;
}
async function writeJson(name, data) {
  await fs.writeFile(path.join(evidence, name), safe(JSON.stringify(data, null, 2)) + "\n");
}

if (action === "serve") {
  const settings = {
    PORT: "4027", SIMPLERCP_HOST: "127.0.0.1", SIMPLERCP_PUBLIC_URL: origin,
    SIMPLERCP_DATA_DIR: path.join(intermediate, "data"),
    SIMPLERCP_OPENCODE_PORT: "4107", SIMPLERCP_FAKE_AGENT_RUNTIME: "false",
    SIMPLERCP_SKIP_MODEL_REQUESTS: "false", SIMPLERCP_TERMINAL_ENABLED: "false",
    CONFLICT_GUARD: "full", CONFLICT_GUARD_STRATEGY: "G3",
    CONFLICT_GUARD_T2_STRATEGY: "G3", CONFLICT_GUARD_T3_STRATEGY: "G3",
    CONFLICT_GUARD_PROVIDER_MODE: "live", CONFLICT_GUARD_ARBITRATION: "owner",
    CONFLICT_GUARD_INTENT_INJECTION: "on", DEEPSEEK_MODEL: "deepseek-flash",
    VITE_SIMPLERCP_API_ORIGIN: "http://127.0.0.1:4027",
    VITE_SIMPLERCP_CLIENT_PORT: "5187", VITE_SIMPLERCP_CLIENT_HOST: "127.0.0.1",
    TMPDIR: runtime
  };
  await writeJson("config.json", { ...settings, codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), modelEndpoint: environment.DEEPSEEK_BASE_URL, startedAt: new Date().toISOString(), viewport: { width: 1440, height: 1000 } });
  const children = [
    spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: path.join(root, "apps/server"), env: { ...process.env, ...settings }, stdio: ["ignore", "pipe", "pipe"] }),
    spawn(process.execPath, [path.join(root, "apps/client/node_modules/vite/bin/vite.js")], { cwd: path.join(root, "apps/client"), env: { ...process.env, ...settings }, stdio: ["ignore", "pipe", "pipe"] })
  ];
  for (const [index, child] of children.entries()) {
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (bytes) => {
      let text = bytes.toString();
      for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
      process.stdout.write(`[${index}] ${text}`);
    });
  }
  const stop = () => { for (const child of children) child.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await Promise.all(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
} else if (action === "check-secrets") {
  let matches = 0;
  async function inspect(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else {
        const bytes = await fs.readFile(file);
        for (const secret of secrets) if (bytes.includes(Buffer.from(secret))) matches += 1;
      }
    }
  }
  await inspect(evidence);
  await inspect(path.join(intermediate, "data"));
  console.log(JSON.stringify({ matches }));
  process.exitCode = matches ? 1 : 0;
} else {
  const playwrightRequire = createRequire(require.resolve("@playwright/test"));
  const { chromium } = playwrightRequire("playwright");
  process.env.TMPDIR = runtime;
  const browser = await chromium.launch({ headless: true });
  try {
    if (action === "compose") await compose(browser);
    else {
      assert(["black", "white", "grey", "human-agent", "agent-agent"].includes(action), "请指定截图场景");
      const pair = await openPair(browser, action);
      try {
        console.log(JSON.stringify({ scenario: action, projectId: pair.id, phase: "开始" }));
        if (["black", "white", "grey"].includes(action)) await humans(pair, action);
        if (action === "human-agent") await humanAgent(pair);
        if (action === "agent-agent") await agents(pair);
      } finally { await Promise.all(pair.contexts.map((context) => context.close())); }
    }
  } finally { await browser.close(); }
}

async function waitUntil(read, accept, timeout = 30_000) {
  const started = Date.now();
  let current;
  while (Date.now() - started < timeout) {
    current = await read();
    if (accept(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待结果超时：${safe(JSON.stringify(current)).slice(0, 1200)}`);
}
async function request(page, id, route, method = "GET", body) {
  return page.evaluate(async ({ id, route, method, body }) => {
    const member = sessionStorage.getItem(`simplercp.memberId.${id}`);
    const response = await fetch(`/api/projects/${id}${route}`, { method, headers: { "X-SimpleRCP-Member": member, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`HTTP ${response.status}：${await response.text()}`);
    return response.status === 204 ? undefined : response.json();
  }, { id, route, method, body });
}
async function openPair(browser, scenario) {
  const contexts = await Promise.all(["dark", "light"].map(async (theme) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await context.addInitScript(({ theme }) => {
      localStorage.setItem("simplercp.theme", theme);
      localStorage.setItem("simplercp.layout.collaborationWidth", "540");
      localStorage.setItem("simplercp.layout.workspaceWidth", "185");
    }, { theme });
    return context;
  }));
  const [alice, bob] = await Promise.all(contexts.map((context) => context.newPage()));
  await alice.goto(origin);
  await alice.getByTestId("import-directory").click();
  const labels = { black: "黑区拦截", white: "白区放行", grey: "灰区模型研判", "human-agent": "人与 Agent 协作", "agent-agent": "跨属主 Agent 协商" };
  await alice.getByTestId("project-name").fill(`${labels[scenario]} ${Date.now()}`);
  await alice.getByTestId("project-directory").fill(path.join(root, "demo/conflict-shop"));
  await alice.getByTestId("create-project-submit").click();
  await alice.waitForURL(/\/projects\/[^/]+$/);
  const id = new URL(alice.url()).pathname.split("/").at(-1);
  for (const [page, name] of [[alice, "Alice"], [bob, "Bob"]]) {
    await page.goto(`${origin}/projects/${id}`);
    await page.getByTestId("display-name").fill(name);
    await page.getByTestId("member-role").fill("协作者");
    await page.getByTestId("join-project").click();
    await page.getByTestId("status-bar").waitFor();
    await page.getByTestId("dir-src").click();
    await page.getByTestId("collab-tab-conflict").click();
  }
  await waitUntil(() => request(alice, id, "/conflict-guard/state"), (state) => !state.indexing && state.index.files > 0);
  return { alice, bob, id, contexts };
}
async function openFile(page, file) {
  await page.getByTestId(`file-${file}`).click();
  await page.waitForFunction((file) => Boolean(window.__simplercpEditors?.[file] && window.__simplercpYjsSynced?.[file]), file);
}
async function edit(page, file, before, after) {
  await page.evaluate(({ file, before, after }) => {
    const editor = window.__simplercpEditors[file];
    const model = editor.getModel();
    const offset = model.getValue().indexOf(before);
    if (offset < 0) throw new Error("没有找到待修改文本");
    const start = model.getPositionAt(offset), end = model.getPositionAt(offset + before.length);
    editor.executeEdits("paper-capture", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { file, before, after });
}
async function disclosure(page, testId, open) {
  const details = page.getByTestId(testId);
  if (await details.evaluate((element) => element.open) !== open) await details.locator(":scope > summary").click();
}
async function save(pair, name, extra = {}) {
  const state = await request(pair.alice, pair.id, "/conflict-guard/state");
  await writeJson(`${name}.json`, { capturedAt: new Date().toISOString(), projectId: pair.id, state, ...extra });
  for (const [page, actor] of [[pair.alice, "alice-dark"], [pair.bob, "bob-light"]]) {
    const text = await page.locator("body").innerText();
    safe(text);
    await fs.writeFile(path.join(evidence, `${name}-${actor}.txt`), text);
    await page.screenshot({ path: path.join(evidence, `${name}-${actor}.png`), animations: "disabled" });
  }
  await pair.alice.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/conflict-guard/trace`, { headers: { "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`) } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }, pair.id).then((text) => fs.writeFile(path.join(evidence, `${name}.jsonl`), safe(text)));
  console.log(JSON.stringify({ scenario: name, phase: "截图已保存", decisions: state.pairDecisions.map((record) => ({ point: record.point, status: record.status, zone: record.verdict?.zone, decision: record.verdict?.decision, rule: record.verdict?.ruleId })) }));
}
async function humans(pair, kind) {
  const { alice, bob, id } = pair;
  await openFile(alice, "src/pricing.ts");
  await openFile(bob, kind === "black" ? "src/cart.ts" : "src/checkout.ts");
  const edits = kind === "black" ? ["rate: number)", "rate: number, currency: string)"]
    : kind === "white" ? ["return price * (1 - rate);", "console.log('discount calculation');\n  return price * (1 - rate);"]
    : ["return price * (1 - rate);", "return Math.round(price * (1 - rate) * 100) / 100;"];
  await edit(alice, "src/pricing.ts", ...edits);
  await waitUntil(() => request(alice, id, "/conflict-guard/state"), (state) => state.activeSymbols.some((entry) => entry.symbols.length));
  if (kind === "black") await edit(bob, "src/cart.ts", "applyDiscount(amount, 0.1)", "applyDiscount(amount + 1, 0.1)");
  else await edit(bob, "src/checkout.ts", "formatMoney(cart.total())", kind === "grey" ? "formatMoney(cart.total()).trim()" : "formatMoney(cart.total() + 1)");
  await waitUntil(() => request(alice, id, "/conflict-guard/state"), (state) => state.pairDecisions.some((record) => record.status === "judged" && record.verdict?.zone === (kind === "grey" ? "grey" : kind) && (kind !== "grey" || record.verdict.adjudication?.status === "success")), 45_000);
  for (const page of [alice, bob]) {
    if (kind === "grey") {
      await page.getByTestId("conflict-guide").locator(":scope > summary").click();
    }
    await disclosure(page, "conflict-progress", false);
    await disclosure(page, "conflict-history", kind !== "black");
    if (kind !== "black") {
      const row = page.getByTestId("human-conflict-record").first();
      await row.locator(":scope > summary").click();
    }
    if (kind === "grey") await page.getByTestId("human-conflict-record").first().getByTestId("adjudication-result").waitFor();
    if (kind === "black") await page.getByTestId("conflict-card").first().waitFor();
  }
  const state = await request(alice, id, "/conflict-guard/state");
  const record = state.pairDecisions.find((record) => record.verdict?.zone === (kind === "grey" ? "grey" : kind));
  if (kind === "grey") {
    assert.equal(record.verdict.adjudication?.status, "success", "模型研判没有完成");
    assert.notEqual(record.pair.left.symbol, record.pair.right.symbol, "灰区示例需要展示不同符号");
    assert.notEqual(record.verdict.decision, "lock", "灰区示例需要展示模型放行或提醒");
    assert.equal(state.frozenFiles.length, 0, "灰区示例不包含冻结区域");
    for (const page of [alice, bob]) {
      assert.equal(await page.getByTestId("conflict-card").count(), 0);
      assert.equal(await page.getByTestId("editor-conflict-banner").count(), 0);
      const result = page.getByTestId("human-conflict-record").first().getByTestId("adjudication-result");
      await result.scrollIntoViewIfNeeded();
      await result.getByTestId("model-explanation").waitFor();
      await result.getByTestId("model-suggestion").waitFor();
    }
  }
  if (kind === "black") {
    const before = await alice.evaluate(() => window.__simplercpEditors["src/pricing.ts"].getValue());
    await edit(alice, "src/pricing.ts", "return price * (1 - rate);", "return 999;");
    const after = await alice.evaluate(() => window.__simplercpEditors["src/pricing.ts"].getValue());
    assert.equal(after, before, "冻结区域仍然允许修改");
    assert.equal(state.frozenFiles.length, 2);
  }
  if (kind === "white") assert.equal(state.frozenFiles.length, 0);
  await save(pair, `0${["black", "white", "grey"].indexOf(kind) + 1}-${kind}`, { verification: { zone: record.verdict.zone, decision: record.verdict.decision, model: record.verdict.adjudication, frozenFiles: state.frozenFiles } });
}
async function startRun(page, id, prompt) {
  const budgetFile = path.join(intermediate, "agent-budget.json");
  let budget = { limit: 4, runs: [] };
  if ((await fs.readdir(intermediate)).includes("agent-budget.json")) budget = JSON.parse(await fs.readFile(budgetFile, "utf8"));
  assert(budget.runs.length < budget.limit, "本次截图 Agent 次数已经达到上限");
  budget.runs.push({ projectId: id, startedAt: new Date().toISOString() });
  await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2));
  await page.getByTestId("collab-tab-agent").click();
  await page.getByTestId("agent-prompt").fill(prompt);
  await page.getByTestId("agent-run-submit").click();
  const run = await waitUntil(() => request(page, id, "/agent/runs"), (result) => result.runs.length > 0).then((result) => result.runs[0]);
  budget.runs.at(-1).runId = run.id;
  await fs.writeFile(budgetFile, JSON.stringify(budget, null, 2));
  console.log(JSON.stringify({ phase: "真实 Agent 已启动", runId: run.id, used: budget.runs.length }));
  return run;
}
async function finished(page, id, runId) {
  return waitUntil(() => request(page, id, `/agent/runs/${runId}`), ({ run }) => ["completed", "failed", "cancelled"].includes(run.status), 240_000).then(({ run }) => run);
}
async function exportRun(page, id, runId, name) {
  const { run } = await request(page, id, `/agent/runs/${runId}`);
  const trace = await request(page, id, `/agent/runs/${runId}/trace`);
  await writeJson(`${name}-run-${runId}.json`, { run, trace });
  return { run, trace };
}
async function humanAgent(pair) {
  const { alice, bob, id } = pair;
  await openFile(alice, "src/cart.ts");
  await openFile(bob, "src/pricing.ts");
  const run = await startRun(alice, id, `在 src/cart.ts 的 Cart.total 中给 amount 增加 1 元运费，然后计算折扣。先读取 cart.ts 与 pricing.ts，输出计划；使用 bash 执行 sleep 20，给协作者编辑时间，然后进行修改。第一次修改将 applyDiscount(amount, 0.1) 改为 applyDiscount(amount + 1, 0.1)，保持阅读时的两个参数调用。审批通过后检查最新签名；如果审批被拒，请重新读取 pricing.ts 与 cart.ts，适配最新签名，再提交修改。仅修改 cart.ts，保留其他逻辑。${boundaries}`);
  await waitUntil(() => request(alice, id, `/agent/runs/${run.id}`), ({ run }) => run.activity?.tools.some((tool) => tool.name === "bash" && tool.status === "running"), 90_000);
  await edit(bob, "src/pricing.ts", "rate: number)", "rate: number, currency: string)");
  await waitUntil(() => request(bob, id, "/conflict-guard/state"), (state) => state.activeSymbols.some((entry) => entry.actor.kind === "human" && entry.symbols.some((symbol) => symbol.key.endsWith("#applyDiscount"))));
  await finished(alice, id, run.id);
  const record = await exportRun(alice, id, run.id, "04-human-agent");
  await disclosure(alice, "agent-trace-disclosure", true);
  const details = alice.getByTestId("agent-trace-disclosure");
  await details.scrollIntoViewIfNeeded();
  await bob.getByTestId("collab-tab-conflict").click();
  await disclosure(bob, "conflict-history", true);
  const row = bob.getByTestId("agent-conflict-record").first();
  if (await row.count()) await row.locator(":scope > summary").click();
  await save(pair, "04-human-agent", { run: record.run, permissionReplies: record.trace.events.filter((event) => event.type === "permission_reply"), humanFrozenDecorations: await bob.locator(".conflict-frozen-range").count() });
}
async function agents(pair) {
  const { alice, bob, id } = pair;
  await openFile(alice, "src/pricing.ts");
  await openFile(bob, "src/pricing.ts");
  const prompt = (rate) => `将 618 促销调整为${rate}。在 src/pricing.ts 中新增 export function promotion618(price: number): number，返回指定折扣后的价格。先读取 pricing.ts，输出计划，然后使用 bash 执行 sleep 20，给协作者协商时间。不要修改其他文件。如果收到双方确认的兼容建议，按建议实现可选折扣并保持各个方案。${boundaries}`;
  const first = await startRun(alice, id, prompt("五折"));
  await waitUntil(() => request(alice, id, `/agent/runs/${first.id}`), ({ run }) => run.activity?.tools.some((tool) => tool.status === "running"), 90_000);
  const second = await startRun(bob, id, prompt("八折"));
  const state = await waitUntil(() => request(alice, id, "/conflict-guard/state"), (state) => state.ownerCards.some((card) => card.status === "waiting" && card.suggestion), 90_000);
  for (const page of [alice, bob]) {
    await page.getByTestId("collab-tab-conflict").click();
    await disclosure(page, "conflict-progress", true);
    await page.getByTestId("owner-intent-card").first().waitFor();
  }
  await exportRun(alice, id, first.id, "05-agent-agent-paused");
  await exportRun(bob, id, second.id, "05-agent-agent-paused");
  await save(pair, "05-agent-agent-paused", { card: state.ownerCards.find((card) => card.status === "waiting"), firstRunId: first.id, secondRunId: second.id });
  for (const [page, actor] of [[alice, "alice-dark"], [bob, "bob-light"]]) {
    await page.getByTestId("owner-intent-card").first().screenshot({ path: path.join(evidence, `05-agent-agent-card-${actor}.png`) });
  }
  await alice.getByTestId("owner-intent-card").first().getByRole("button", { name: "采纳建议" }).click();
  await bob.getByTestId("owner-intent-card").first().getByRole("button", { name: "采纳建议" }).click();
  let results;
  let extraCards = 0;
  await waitUntil(async () => {
    results = await Promise.all([request(alice, id, `/agent/runs/${first.id}`), request(bob, id, `/agent/runs/${second.id}`)]).then((records) => records.map(({ run }) => run));
    const state = await request(alice, id, "/conflict-guard/state");
    const card = state.ownerCards.find((card) => card.status === "waiting" && card.suggestion);
    if (card) {
      assert(extraCards < 2, "追加协商达到截图上限，请检查任务结果");
      extraCards += 1;
      for (const page of [alice, bob]) await page.getByTestId("collab-tab-conflict").click();
      await save(pair, `05-agent-agent-code-conflict-${extraCards}`, { card, runs: results });
      await alice.getByTestId("owner-intent-card").first().getByRole("button", { name: "采纳建议" }).click();
      await bob.getByTestId("owner-intent-card").first().getByRole("button", { name: "采纳建议" }).click();
    }
    return results;
  }, (runs) => runs.every((run) => ["completed", "failed", "cancelled"].includes(run.status)), 240_000);
  await exportRun(alice, id, first.id, "05-agent-agent-completed");
  await exportRun(bob, id, second.id, "05-agent-agent-completed");
  for (const page of [alice, bob]) { await page.getByTestId("collab-tab-agent").click(); await disclosure(page, "agent-trace-disclosure", true); }
  await save(pair, "05-agent-agent-completed", { runs: results });
}
async function compose(browser) {
  const files = await fs.readdir(evidence);
  for (const name of files.filter((name) => name.endsWith("-alice-dark.png") && !name.includes("-card-"))) {
    const prefix = name.replace("-alice-dark.png", "");
    const counterpart = `${prefix}-bob-light.png`;
    assert(files.includes(counterpart), "缺少另一位协作者的截图");
    const context = await browser.newContext({ viewport: { width: 2880, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const sources = await Promise.all([name, counterpart].map(async (file) => `data:image/png;base64,${(await fs.readFile(path.join(evidence, file))).toString("base64")}`));
    await page.setContent(`<html><body style="margin:0;display:flex"><img width="1440" height="1000" src="${sources[0]}"><img width="1440" height="1000" src="${sources[1]}"></body></html>`);
    await page.locator("img").evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({ path: path.join(evidence, `${prefix}-dual.png`) });
    await context.close();
  }
  const manifest = [];
  for (const file of (await fs.readdir(evidence)).filter((file) => file.endsWith(".png"))) {
    const bytes = await fs.readFile(path.join(evidence, file));
    manifest.push({ file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeJson("screenshots.json", manifest);
  console.log(JSON.stringify({ screenshots: manifest.length }));
}
