import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { readTrace } from "../../packages/conflict-guard/src/trace/trace";
import type { ConflictGuardState } from "../../apps/client/src/conflictGuardTypes";
import { pairMatches } from "../../apps/client/src/conflictGuardFilters";
import { guardRuleLabels, ruleName } from "../../apps/client/src/conflictGuardLabels";
import { openAs } from "./helpers";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = path.join(root, "docs/conflict-guard/evidence/ui-information");
const archivedTrace = path.join(root, "docs/conflict-guard/evidence/round2-dual-agent/original-source/project-trace.jsonl.gz");

test("首次打开的说明、统计与处理区域在首屏可见，说明状态保持", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const peerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const peer = await peerContext.newPage();
  try {
    await page.goto("/");
    await page.getByTestId("import-directory").click();
    await page.getByTestId("project-name").fill("信息分层验收");
    await page.getByTestId("project-directory").fill(path.join(root, "demo/conflict-shop"));
    await page.getByTestId("create-project-submit").click();
    await expect(page).toHaveURL(/\/projects\/[^/]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await openAs(page, "Alice", id);
    await page.getByTestId("collab-tab-conflict").click();
    const guide = page.getByTestId("conflict-guide");
    await expect(guide).toHaveAttribute("open", "");
    await expect(guide.locator(".conflict-guide-zones > li")).toHaveCount(3);
    await expect(guide).toContainText("白区");
    await expect(guide).toContainText("黑区");
    await expect(guide).toContainText("灰区");
    await expect(guide).toContainText("大模型研判");
    await expect(page.getByTestId("conflict-attention")).toContainText("当前没有需要你处理的冲突");
    await expect(page.getByTestId("conflict-progress")).not.toHaveAttribute("open");
    await expect(page.getByTestId("conflict-history")).not.toHaveAttribute("open");
    await openAs(peer, "Bob", id);
    for (const [browserPage, file] of [[page, "src/pricing.ts"], [peer, "src/cart.ts"]] as const) {
      await browserPage.getByTestId("dir-src").click();
      await browserPage.getByTestId(`file-${file}`).click();
      await browserPage.waitForFunction((file) => window.__simplercpYjsSynced?.[file], file);
    }
    await editFile(page, "src/pricing.ts", "rate: number)", "rate: number, currency: string)");
    await editFile(peer, "src/cart.ts", "amount, 0.1", "amount, 0.2");
    await expect(page.getByTestId("conflict-card")).toHaveCount(1);
    await expect(page.getByTestId("conflict-attention").locator("h3")).toContainText("1 项");
    const themes: Record<string, unknown> = {};
    await fs.mkdir(evidence, { recursive: true });
    for (const theme of ["dark", "light"]) {
      if (theme === "light") await page.getByTestId("theme-toggle").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const positions = await page.getByTestId("conflict-guard-panel").evaluate((panel) => {
        const viewport = panel.getBoundingClientRect();
        return { scrollTop: panel.scrollTop, sections: ["conflict-guide", "conflict-overview", "conflict-attention"].map((id) => {
          const section = panel.querySelector(`[data-testid="${id}"]`)!;
          const element = id === "conflict-attention" ? section.querySelector("h3")! : section;
          const box = element.getBoundingClientRect();
          return { id, top: box.top, bottom: box.bottom, viewportTop: viewport.top, viewportBottom: viewport.bottom, windowHeight: window.innerHeight };
        }), contrast: [...panel.querySelectorAll(".conflict-guide-zones .conflict-badge")].map((badge) => {
          const style = getComputedStyle(badge);
          return { text: badge.textContent, color: style.color, background: style.backgroundColor };
        }) };
      });
      expect(positions.scrollTop).toBe(0);
      for (const section of positions.sections) {
        expect(section.top).toBeGreaterThanOrEqual(section.viewportTop);
        expect(section.bottom).toBeLessThanOrEqual(section.viewportBottom);
        expect(section.bottom).toBeLessThanOrEqual(720);
      }
      for (const colors of positions.contrast) expect(contrastRatio(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
      themes[theme] = positions;
      await page.screenshot({ path: path.join(evidence, `first-screen-${theme}.png`) });
    }
    await guide.locator("summary").click();
    await page.getByTestId("collab-tab-chat").click();
    await page.getByTestId("collab-tab-conflict").click();
    await expect(page.getByTestId("conflict-guide")).not.toHaveAttribute("open");
    await page.reload();
    await page.getByTestId("collab-tab-conflict").click();
    await expect(page.getByTestId("conflict-guide")).not.toHaveAttribute("open");
    await fs.writeFile(path.join(evidence, "first-screen.json"), JSON.stringify({ viewport: { width: 1280, height: 720 }, themes, persistedGuide: true }, null, 2) + "\n");
  } finally { await context.close(); await peerContext.close(); }
});

test("真实协作产生的列表限制、筛选计数、本人筛选与轨迹下载", async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [alice, bob, carol] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await alice.goto("/");
    await alice.getByTestId("new-project").click();
    await alice.getByTestId("project-name").fill("列表与筛选验收");
    await alice.getByTestId("create-project-submit").click();
    await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
    const id = new URL(alice.url()).pathname.split("/").at(-1)!;
    await openAs(alice, "Alice", id);
    await openAs(bob, "Bob", id);
    await openAs(carol, "Carol", id);
    const content = await fs.readFile(path.join(root, "tests/fixtures/conflict-panel/symbols.ts"), "utf8");
    await request(alice, id, "workspace/file", "PUT", { path: "symbols.ts", content });
    for (const page of [alice, bob, carol]) {
      await page.getByTestId("collab-tab-conflict").click();
      await page.getByTestId("file-symbols.ts").click();
      await page.waitForFunction(() => window.__simplercpYjsSynced?.["symbols.ts"]);
      await page.getByTestId("conflict-progress").locator(":scope > summary").click();
    }
    await replaceAll(alice, "first", "Alice");
    await expect.poll(() => editorText(bob)).toContain('"Alice"');
    await replaceAll(bob, "second", "Bob");
    await expect.poll(async () => (await request(alice, id, "conflict-guard/state")).candidatePairs.length).toBe(12);
    await expect.poll(async () => (await request(alice, id, "conflict-guard/state")).pairDecisions.filter((record: { status: string }) => record.status === "judged").length).toBe(12);
    const panel = alice.getByTestId("conflict-guard-panel");
    await expect(panel.getByTestId("conflict-active-list").locator(":scope > li")).toHaveCount(10);
    await expect(panel.getByTestId("conflict-candidate")).toHaveCount(10);
    await expect(panel.getByRole("button", { name: "显示全部（共 24 条）", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "显示全部（共 12 条）", exact: true })).toBeVisible();
    const filter = panel.getByTestId("conflict-filter-candidates");
    await expect(filter.getByRole("button", { name: "人之间 12", exact: true })).toBeVisible();
    await filter.getByRole("button", { name: "Agent 之间 0", exact: true }).click();
    await expect(panel.getByTestId("conflict-candidate")).toHaveCount(0);
    await filter.getByRole("button", { name: "人之间 12", exact: true }).click();
    await expect(panel.getByTestId("conflict-candidate")).toHaveCount(10);
    await panel.getByRole("button", { name: "显示全部（共 12 条）", exact: true }).click();
    await expect(panel.getByTestId("conflict-candidate")).toHaveCount(12);
    await filter.getByRole("checkbox", { name: "只看与我相关" }).check();
    await expect(panel.getByTestId("conflict-candidate")).toHaveCount(10);
    const activeFilter = panel.getByTestId("conflict-filter-active");
    await expect(activeFilter.getByRole("button", { name: "人之间 24", exact: true })).toBeVisible();
    await activeFilter.getByRole("button", { name: "人与 Agent 0", exact: true }).click();
    await expect(panel.getByTestId("conflict-active-list").locator(":scope > li")).toHaveCount(0);
    await activeFilter.getByRole("button", { name: "人之间 24", exact: true }).click();
    await expect(panel.getByTestId("conflict-active-list").locator(":scope > li")).toHaveCount(10);
    await alice.getByTestId("collab-tab-chat").click();
    await alice.getByTestId("collab-tab-conflict").click();
    await expect(alice.getByTestId("conflict-progress")).toHaveAttribute("open", "");
    await expect(alice.getByTestId("conflict-filter-candidates").getByRole("checkbox")).toBeChecked();
    await expect(alice.getByTestId("conflict-filter-candidates").getByRole("button", { name: "人之间 12", exact: true })).toHaveAttribute("aria-pressed", "true");
    await carol.getByTestId("conflict-filter-candidates").getByRole("checkbox").check();
    await expect(carol.getByTestId("conflict-candidate")).toHaveCount(0);
    await carol.getByTestId("conflict-filter-active").getByRole("checkbox").check();
    await expect(carol.getByTestId("conflict-active-list").locator(":scope > li")).toHaveCount(0);
    await alice.getByTestId("conflict-history").locator(":scope > summary").click();
    await expect(alice.getByTestId("human-conflict-record")).toHaveCount(12);
    const checkFilter = alice.getByTestId("conflict-filter-checks");
    await expect(checkFilter.getByRole("button", { name: "人之间 12", exact: true })).toBeVisible();
    await checkFilter.getByRole("button", { name: "Agent 之间 0", exact: true }).click();
    await expect(alice.getByTestId("human-conflict-record")).toHaveCount(0);
    await checkFilter.getByRole("button", { name: "人之间 12", exact: true }).click();
    await expect(alice.getByTestId("human-conflict-record")).toHaveCount(12);
    expect(await panel.innerText()).not.toMatch(/\bT[23]\b|ruleId|same-symbol-concurrent-write|type-only-unchanged|runtime-export-removed/);
    const [download] = await Promise.all([alice.waitForEvent("download"), alice.getByRole("button", { name: "导出轨迹", exact: true }).click()]);
    expect(download.suggestedFilename()).toBe("conflict-guard-trace.jsonl");
    const downloaded = path.join(root, ".test-workspaces/ui-information-download.jsonl");
    await download.saveAs(downloaded);
    expect(readTrace(await fs.readFile(downloaded, "utf8")).some((event) => event.type === "pair_judged")).toBe(true);
    await fs.mkdir(evidence, { recursive: true });
    await fs.writeFile(path.join(evidence, "collaboration.json"), JSON.stringify({ state: await request(alice, id, "conflict-guard/state"), visibleActive: 10, visibleCandidates: 10, filteredCandidates: 12, unrelatedMemberCandidates: 0, download: true }, null, 2) + "\n");
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test("原始真实轨迹的三种参与者筛选、记录分页、倒序与中文映射", async ({ page }) => {
  const events = readTrace(gunzipSync(await fs.readFile(archivedTrace)).toString("utf8"));
  const latest = new Map<string, NonNullable<ConflictGuardState["pairDecisions"]>[number]>();
  for (const event of events) if (event.type === "pair_judged" && event.pair && event.verdict) {
    const pair = event.pair as ConflictGuardState["candidatePairs"][number];
    latest.set(pair.id, { pair, revision: Number(event.revision), status: String(event.status), updatedAt: event.at, point: event.point as "T2" | "T3" | undefined, shadow: Boolean(event.shadow), verdict: event.verdict as NonNullable<ConflictGuardState["pairDecisions"]>[number]["verdict"] });
  }
  const records = [...latest.values()];
  expect(records.length).toBeGreaterThan(40);
  const state: ConflictGuardState = {
    mode: String(events[0].mode), version: events.at(-1)!.seq,
    index: { files: 0, symbols: 0, edges: 0, truncated: false, latestUpdate: { files: 0, durationMs: 0, full: false } },
    activeSymbols: [], candidatePairs: [], pairDecisions: records,
    statistics: { total: 0, related: 0, unrelated: 0, unrelatedRatio: 0 }
  };
  await page.addInitScript((state) => { window.__guardArchiveState = state; }, state);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(`/@fs/${path.join(root, "apps/client/tests/conflict-panel-preview.html")}`);
  await expect(page.getByTestId("conflict-guard-panel"), browserErrors.join("\n")).toBeVisible();
  await page.getByTestId("conflict-history").locator(":scope > summary").click();
  const list = page.getByTestId("conflict-check-list");
  await expect(list.locator(":scope > details")).toHaveCount(20);
  await page.getByRole("button", { name: /^显示更多/ }).click();
  await expect(list.locator(":scope > details")).toHaveCount(40);
  const times = await list.locator(":scope > details > summary time").evaluateAll((elements) => elements.map((element) => Date.parse(element.getAttribute("datetime")!)));
  expect(times).toEqual([...times].sort((left, right) => right - left));
  const filter = page.getByTestId("conflict-filter-checks");
  const counts: Record<string, number> = {};
  for (const [kind, label] of [["human-human", "人之间"], ["human-agent", "人与 Agent"], ["agent-agent", "Agent 之间"]] as const) {
    const expected = records.filter((record) => {
      const agents = [record.pair.left.actor, record.pair.right.actor].filter((actor) => actor.kind === "agent").length;
      return agents === (kind === "human-human" ? 0 : kind === "human-agent" ? 1 : 2);
    }).length;
    expect(expected).toBeGreaterThan(0);
    await filter.getByRole("button", { name: new RegExp(`^${label} ${expected}$`) }).click();
    await expect(list.locator(":scope > details")).toHaveCount(Math.min(20, expected));
    await expect(filter.getByRole("button", { name: new RegExp(`^${label} ${expected}$`) })).toHaveAttribute("aria-pressed", "true");
    await filter.getByRole("button", { name: /^全部 / }).click();
    counts[kind] = expected;
  }
  await filter.getByRole("button", { name: /^人与 Agent / }).click();
  await filter.getByRole("button", { name: /^Agent 之间 / }).click();
  await expect(list.locator(":scope > details")).toHaveCount(20);
  const record = list.locator(":scope > details").first();
  await record.locator(":scope > summary").click();
  await expect(record).toContainText(/Agent 写入前检查|Agent 任务完成后复检/);
  await expect(record.getByTestId("conflict-technical-detail")).not.toHaveAttribute("open");
  expect(await page.getByTestId("conflict-guard-panel").innerText()).not.toMatch(/\bT[23]\b|ruleId|same-symbol-concurrent-write|type-only-unchanged|runtime-export-removed/);
  for (const record of records) if (record.verdict) expect(guardRuleLabels[record.verdict.ruleId], record.verdict.ruleId).toBeDefined();
  expect(ruleName("unlisted-rule")).toBe("unlisted-rule（未翻译）");
  const agent = records.flatMap((record) => [record.pair.left.actor, record.pair.right.actor]).find((actor) => actor.kind === "agent" && actor.ownerId)!;
  const ownRecords = records.filter((record) => pairMatches(record.pair, { kinds: [], mine: true }, agent.ownerId));
  expect(ownRecords.length).toBe(records.filter((record) => [record.pair.left.actor, record.pair.right.actor].some((actor) => actor.kind === "agent" ? actor.ownerId === agent.ownerId : actor.memberId === agent.ownerId)).length);
  expect(ownRecords.length).toBeGreaterThan(0);
  expect(ownRecords.length).toBeLessThan(records.length);
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, "archive.json"), JSON.stringify({ source: path.relative(root, archivedTrace), records: records.length, counts, firstPage: 20, secondPage: 40, ownRecords: ownRecords.length, translationsComplete: true }, null, 2) + "\n");
  expect(browserErrors).toEqual([]);
});

test("真实 Agent 验收归档在顶部统计中计入黑区与灰区，检查类型使用中文", async ({ page }) => {
  for (const [file, zone] of [["01-cross-accept.json", "black"], ["03-human-priority.json", "grey"]] as const) {
    const state = JSON.parse(await fs.readFile(path.join(root, "docs/conflict-guard/evidence/stage-7-manual", file), "utf8")) as ConflictGuardState;
    await page.addInitScript((state) => { window.__guardArchiveState = state; }, state);
    await page.goto(`/@fs/${path.join(root, "apps/client/tests/conflict-panel-preview.html")}`);
    await expect(page.getByTestId("conflict-overview").locator('[data-metric="decisions"] dd')).toHaveText("1");
    await expect(page.getByTestId("conflict-overview").locator(`[data-metric="${zone}"] dd`)).toHaveText("1");
    await expect(page.getByTestId("conflict-overview").locator(`[data-metric="${zone === "black" ? "grey" : "black"}"] dd`)).toHaveText("0");
    if (!(await page.getByTestId("conflict-history").evaluate((element) => element.hasAttribute("open")))) await page.getByTestId("conflict-history").locator(":scope > summary").click();
    await expect(page.getByTestId("agent-conflict-record")).toHaveCount(1);
    await expect(page.getByTestId("agent-conflict-record").locator(":scope > summary")).toContainText("Agent 写入前检查");
    if (!(await page.getByTestId("agent-conflict-record").evaluate((element) => element.hasAttribute("open")))) await page.getByTestId("agent-conflict-record").locator(":scope > summary").click();
    expect(await page.getByTestId("conflict-guard-panel").innerText()).not.toMatch(/\bT[23]\b|ruleId|same-symbol-concurrent-write|type-only-unchanged|runtime-export-removed/);
  }
});

async function request(page: Page, id: string, endpoint: string, method = "GET", body?: unknown): Promise<any> {
  return page.evaluate(async ({ id, endpoint, method, body }) => {
    const response = await fetch(`/api/projects/${id}/${endpoint}`, { method, headers: { "Content-Type": "application/json", "X-SimpleRCP-Member": sessionStorage.getItem(`simplercp.memberId.${id}`)! }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }, { id, endpoint, method, body });
}

async function replaceAll(page: Page, before: string, after: string) {
  await page.evaluate(({ before, after }) => {
    const editor = window.__simplercpEditors?.["symbols.ts"];
    const model = editor?.getModel();
    if (!editor || !model) throw new Error("编辑器尚未准备完成");
    const text = model.getValue();
    const changes = [...text.matchAll(new RegExp(before, "g"))].map((match) => {
      const start = model.getPositionAt(match.index!);
      const end = model.getPositionAt(match.index! + before.length);
      return { range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after };
    });
    if (changes.length !== 12) throw new Error("需要十二处真实日志修改");
    editor.executeEdits("information-acceptance", changes);
  }, { before, after });
}

async function editorText(page: Page) { return page.evaluate(() => window.__simplercpEditors?.["symbols.ts"]?.getValue()); }

async function editFile(page: Page, file: string, before: string, after: string) {
  await page.evaluate(({ file, before, after }) => {
    const editor = window.__simplercpEditors?.[file];
    const model = editor?.getModel();
    if (!editor || !model) throw new Error("编辑器尚未准备完成");
    const offset = model.getValue().indexOf(before);
    if (offset < 0) throw new Error("没有找到待修改的文本");
    const start = model.getPositionAt(offset), end = model.getPositionAt(offset + before.length);
    editor.executeEdits("information-acceptance", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { file, before, after });
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map((channel) => Number(channel) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const left = luminance(foreground), right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}
