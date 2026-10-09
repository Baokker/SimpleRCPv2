import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { checkReplay, replayTrace, readTrace, validateTraceDetailed } from "@simplercp/conflict-guard";
import { createApp } from "../createApp.js";
import { attachRealtimeServer } from "../realtime.js";
import { joinMember } from "./memberTestHelper.js";
import { createTestWorkspace } from "./testWorkspace.js";
import { replayUi } from "../replay/uiReplay.js";
import type { ProjectConflictGuard } from "../conflictGuard/projectConflictGuard.js";

const shopRoot = fileURLToPath(new URL("../../../../demo/conflict-shop/", import.meta.url));

describe("rules 模式冲突干预", () => {
  let root: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  let server: http.Server;
  let realtime: ReturnType<typeof attachRealtimeServer>;
  let origin: string;
  let projectId: string;
  let roomId: string;
  let alice: Awaited<ReturnType<typeof joinMember>>;
  let bob: Awaited<ReturnType<typeof joinMember>>;
  const providers: WebsocketProvider[] = [];
  const documents: Y.Doc[] = [];

  beforeEach(async () => {
    root = await createTestWorkspace("rules-api-");
    await fs.mkdir(path.join(root, "demo"));
    app = await createApp({ port: 0, host: "127.0.0.1", publicOrigin: "http://127.0.0.1:5173", dataDir: path.join(root, "data"), demoProjectRoot: path.join(root, "demo"), terminalEnabled: false, importRoots: [path.dirname(shopRoot)], conflictGuard: { mode: "rules", idleMs: 1500, cursorLeaveLines: 3, maxBatchDurationMs: 30_000, activeIdleMs: 600_000, cursorDebounceMs: 200 } });
    const project = await app.locals.registry.importDirectory("Conflict shop", shopRoot);
    projectId = project.id;
    roomId = app.locals.runtimeManager.get(projectId).room.id;
    server = http.createServer(app);
    realtime = attachRealtimeServer(server, app.locals.runtimeManager, app.locals.agentRuns, { members: app.locals.members });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("服务没有启动");
    origin = `http://127.0.0.1:${address.port}`;
    alice = await joinMember(origin, projectId, { name: "Alice" });
    bob = await joinMember(origin, projectId, { name: "Bob" });
  });

  afterEach(async () => {
    for (const provider of providers.splice(0)) { provider.disconnect(); provider.destroy(); }
    for (const document of documents.splice(0)) document.destroy();
    realtime?.dispose();
    await app?.locals.runtimeManager.dispose();
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([
    ["类体增加注释", "  items: CartItem[] = [];", "  // 购物车数据\n  items: CartItem[] = [];"],
    ["注释前面回车再写注释", "  total(): number {", "\n  // 计算金额\n  total(): number {"],
    ["注释文字中间修改", "// 原说明", "// 新的说明"],
    ["两个声明之间添加空白注释", "export class Cart", "\n// 说明\nexport class Cart"]
  ])("%s 与他人同文件修改保持同步、没有符号冲突与 T0", async (name, before, after) => {
    if (name === "注释文字中间修改") {
      const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/cart.ts");
      await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("    let amount = 0;", "    // 原说明\n    let amount = 0;"));
    }
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => second.getText("content").toString().includes("amount, 0.2"));
    replace(second, before, after);
    await waitFor(() => currentGuard().tracker.getOpenBatches().length === 0);
    const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/cart.ts");
    await waitFor(async () => (await fs.readFile(file, "utf8")).includes(after));
    await waitFor(async () => readTrace(await (await bob.request("/conflict-guard/trace")).text()).some((event) => event.type === "change_unit" && event.commentOnly === true));
    const state = currentGuard().state();
    expect(state.activeSymbols.find((set) => set.actor.kind === "human" && set.actor.memberId === bob.member.id)?.symbols).toEqual([]);
    expect(state.candidatePairs).toEqual([]);
    expect(state.frozenFiles).toEqual([]);
    expect(state.blockedPersists).toEqual([]);
    const events = readTrace(await (await bob.request("/conflict-guard/trace")).text());
    expect(events.some((event) => event.type === "change_unit" && (event.actor as { memberId?: string })?.memberId === bob.member.id && event.commentOnly === true && (event.symbols as unknown[]).length === 0)).toBe(true);
    expect(events.filter((event) => event.type === "t0_warning" && event.memberId === bob.member.id)).toEqual([]);
    expect(validateTraceDetailed(events).valid).toBe(true);
    const replay = replayTrace(events, { policy: "P3" });
    expect(replay.errors).toEqual([]);
    expect(replay.judgements).toEqual([]);
    expect(replay.freezeIntervals).toEqual([]);
    expect(replay.finalTexts["src/cart.ts"]).toBe(second.getText("content").toString());
  });

  it("console.log 内容修改与同函数计算修改放行并写入双方内容", async () => {
    const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/cart.ts");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("    let amount = 0;", "    console.log('aaa');\n    let amount = 0;"));
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "'aaa'", "'bbb'");
    await waitFor(() => second.getText("content").toString().includes("'bbb'"));
    replace(second, "let amount = 0", "let amount = 1");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "observability-only") === true);
    expect(currentState().pairDecisions?.every((record) => record.verdict?.decision === "allow")).toBe(true);
    expect(currentState().frozenFiles).toEqual([]);
    await waitFor(async () => (await fs.readFile(file, "utf8")).includes("let amount = 1"));
    expect(await fs.readFile(file, "utf8")).toContain("console.log('bbb')");
  });

  it("相隔较远的同函数计算修改进入灰区，邻近行仍然冻结", async () => {
    const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/cart.ts");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("    let amount = 0;", "    let amount = 0;\n    amount += 1;\n    amount += 2;\n    amount += 3;\n    amount += 4;\n    amount += 5;"));
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "let amount = 0", "let amount = 1");
    await waitFor(() => second.getText("content").toString().includes("let amount = 1"));
    replace(second, "amount += 5", "amount += 50");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "declaration-body-unrelated") === true);
    expect(currentState().pairDecisions?.every((record) => record.verdict?.decision === "warn")).toBe(true);
    const warning = currentState().pairDecisions!.find((record) => record.verdict?.ruleId === "declaration-body-unrelated")!;
    const endpoint = `/conflict-guard/pairs/${encodeURIComponent(warning.pair.id)}/acknowledge`;
    expect((await alice.request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: warning.revision + 1, contentKey: warning.warningKey }) })).status).toBe(409);
    expect((await alice.request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: warning.revision, contentKey: warning.warningKey }) })).status).toBe(204);
    const aliceState = await (await alice.request("/conflict-guard/state")).json() as { pairDecisions: Array<{ acknowledged: boolean }> };
    const bobState = await (await bob.request("/conflict-guard/state")).json() as { pairDecisions: Array<{ acknowledged: boolean }> };
    expect(aliceState.pairDecisions[0]?.acknowledged).toBe(true);
    expect(bobState.pairDecisions[0]?.acknowledged).toBe(false);
    expect(currentState().frozenFiles).toEqual([]);
    await waitFor(async () => (await fs.readFile(file, "utf8")).includes("amount += 50"));
    expect(await fs.readFile(file, "utf8")).toContain("let amount = 1");
    replace(second, "amount += 1", "amount += 10");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.decision === "lock") === true);
    expect(currentState().frozenFiles?.length).toBeGreaterThan(0);
  });

  it("同函数远距离新增同名变量仍然冻结并阻止冲突版本写入", async () => {
    const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/cart.ts");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("    let amount = 0;", "    let amount = 0;\n    amount += 1;\n    amount += 2;\n    amount += 3;\n    amount += 4;\n    amount += 5;"));
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "let amount = 0;", "const shared = 1;\n    let amount = 0;");
    await waitFor(() => second.getText("content").toString().includes("shared = 1"));
    replace(second, "return applyDiscount(amount, 0.1);", "const shared = 2;\n    return applyDiscount(amount, 0.1);");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "merge-only-type-error") === true);
    expect(currentGuard().state().frozenFiles.length).toBeGreaterThan(0);
    expect(await fs.readFile(file, "utf8")).not.toContain("shared = 2");
    expect(checkReplay(readTrace(await (await bob.request("/conflict-guard/trace")).text()))).toMatchObject({ checked: true, valid: true, differences: [] });
  }, 12000);

  it("同函数远距离修改改变推断返回类型时保持冻结", async () => {
    const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/cart.ts");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("total(): number", "total()").replace("    let amount = 0;", "    let amount = 0;\n    amount += 1;\n    amount += 2;\n    amount += 3;\n    amount += 4;\n    amount += 5;"));
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "amount += 1", "amount += 10");
    await waitFor(() => second.getText("content").toString().includes("amount += 10"));
    replace(second, "return applyDiscount(amount, 0.1);", "return `${applyDiscount(amount, 0.1)}`;");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.status === "judged" && record.verdict?.decision === "lock") === true);
    const record = currentGuard().state().pairDecisions[0]!;
    const bobSide = record.pair.left.actor.kind === "human" && record.pair.left.actor.memberId === bob.member.id ? "left" : "right";
    expect(record.verdict!.contractChanged[bobSide]).toBe(true);
    expect(currentGuard().state().frozenFiles.length).toBeGreaterThan(0);
    expect(checkReplay(readTrace(await (await bob.request("/conflict-guard/trace")).text()))).toMatchObject({ checked: true, valid: true, differences: [] });
  }, 12000);

  it("同批次修改代码与逐字符输入注释后，远距离修改保持警告并写入双方内容", async () => {
    const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/cart.ts");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("    let amount = 0;", "    let amount = 0;\n    amount += 1;\n    amount += 2;\n    amount += 3;\n    amount += 4;\n    amount += 5;\n    "));
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "amount += 1", "amount += 10");
    await waitFor(() => second.getText("content").toString().includes("amount += 10"));
    const text = first.getText("content");
    const from = text.toString().indexOf("    \n    for");
    expect(from).toBeGreaterThanOrEqual(0);
    text.insert(from + 4, "/");
    await waitFor(() => second.getText("content").toString().includes("    /\n"));
    text.insert(from + 5, "/");
    await waitFor(() => second.getText("content").toString().includes("    //\n"));
    replace(second, "amount, 0.1", "amount, 0.2");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "declaration-body-unrelated") === true);
    expect(currentGuard().state().frozenFiles).toEqual([]);
    await waitFor(async () => (await fs.readFile(file, "utf8")).includes("amount, 0.2"));
    expect(await fs.readFile(file, "utf8")).toContain("amount += 10");
    expect(await fs.readFile(file, "utf8")).toContain("    //\n");
    expect(checkReplay(readTrace(await (await bob.request("/conflict-guard/trace")).text()))).toMatchObject({ checked: true, valid: true, differences: [] });
  }, 12000);

  it("代码与成对块注释的混合修改保留双方内容并保持灰区", async () => {
    const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/cart.ts");
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("    let amount = 0;", "    let amount = 0;\n    amount += 1;\n    amount += 2;\n    amount += 3;\n    amount += 4;\n    // 金额说明\n    // 保留说明\n    amount += 5;"));
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    const before = first.getText("content").toString();
    replace(first, before, before.replace("amount += 1", "amount += 10").replace("    // 金额说明", "    /*\n    // 金额说明").replace("    // 保留说明", "    // 保留说明\n    */"));
    await waitFor(() => second.getText("content").toString().includes("amount += 10"));
    replace(second, "amount, 0.1", "amount, 0.2");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "declaration-body-unrelated") === true);
    expect(currentGuard().state().frozenFiles).toEqual([]);
    await waitFor(async () => (await fs.readFile(file, "utf8")).includes("amount, 0.2"));
    expect(await fs.readFile(file, "utf8")).toContain("amount += 10");
    expect(await fs.readFile(file, "utf8")).toContain("/*\n    // 金额说明");
    expect(checkReplay(readTrace(await (await bob.request("/conflict-guard/trace")).text()))).toMatchObject({ checked: true, valid: true, differences: [] });
  }, 12000);

  it("整个被引用函数被注释禁用时仍然形成黑区删除保护", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    const declaration = "export function applyDiscount(price: number, rate: number): number {\n  return price * (1 - rate);\n}";
    expect(pricing.getText("content").toString()).toContain(declaration);
    replace(pricing, declaration, `/* ${declaration} */`);
    replace(cart, "amount, 0.1", "amount, 0.2");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.status === "judged" && record.verdict?.decision === "lock") === true);
    expect(currentGuard().state().activeSymbols.find((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id)?.symbols).toContainEqual(expect.objectContaining({ key: "src/pricing.ts#applyDiscount", status: "deleted" }));
    expect(currentGuard().state().frozenFiles.length).toBeGreaterThan(0);
    const file = path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/pricing.ts");
    expect(await fs.readFile(file, "utf8")).toContain(declaration);
    expect(await fs.readFile(file, "utf8")).not.toContain(`/* ${declaration}`);
    expect(checkReplay(readTrace(await (await bob.request("/conflict-guard/trace")).text()))).toMatchObject({ checked: true, valid: true, differences: [] });
  }, 12000);

  it("签名变化后依赖函数中的注释修改不产生 T0 与候选对", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    replace(pricing, "rate: number)", "rate: number, currency: string)");
    await waitFor(() => currentGuard().tracker.getOpenBatches().length === 0);
    await waitFor(() => currentGuard().state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.name === "applyDiscount")));
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(cart, "    let amount = 0;", "    // 检查金额\n    let amount = 0;");
    await waitFor(() => currentGuard().tracker.getOpenBatches().length === 0);
    await waitFor(async () => readTrace(await (await bob.request("/conflict-guard/trace")).text()).some((event) => event.type === "change_unit" && event.commentOnly === true));
    const events = readTrace(await (await bob.request("/conflict-guard/trace")).text());
    expect(events.some((event) => event.type === "change_unit" && event.commentOnly === true)).toBe(true);
    expect(events.filter((event) => event.type === "t0_warning" && event.memberId === bob.member.id)).toEqual([]);
    expect(currentGuard().state().candidatePairs).toEqual([]);
  });

  it("逐字符输入回车与注释后不生成符号修改与 T0", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    replace(pricing, "rate: number)", "rate: number, currency: string)");
    await waitFor(() => currentGuard().state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.name === "applyDiscount")));
    const cart = await connect("src/cart.ts", bob.member.id);
    const content = cart.getText("content");
    let position = content.toString().indexOf("    let amount = 0;");
    for (const character of "\n    // 金额说明\n") {
      content.insert(position++, character);
      await waitFor(() => currentGuard().tracker.getOpenBatches().some((batch) => batch.actor.kind === "human" && batch.actor.memberId === bob.member.id));
    }
    await waitFor(() => currentGuard().tracker.getOpenBatches().length === 0);
    await waitFor(async () => readTrace(await (await bob.request("/conflict-guard/trace")).text()).some((event) => event.type === "change_unit" && event.commentOnly === true));
    expect(currentGuard().state().activeSymbols.find((set) => set.actor.kind === "human" && set.actor.memberId === bob.member.id)?.symbols).toEqual([]);
    expect(currentGuard().state().candidatePairs).toEqual([]);
    const events = readTrace(await (await bob.request("/conflict-guard/trace")).text());
    expect(events.filter((event) => event.type === "t0_warning" && event.memberId === bob.member.id)).toEqual([]);
    expect(events.some((event) => event.type === "change_unit" && event.commentOnly === true)).toBe(true);
  });

  it.each(["空白", "暂时无法解析"])("批次从%s开始，后续有效代码修改仍然收到一次 T0", async (start) => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    replace(pricing, "rate: number)", "rate: number, currency: string)");
    await waitFor(() => currentGuard().tracker.getOpenBatches().length === 0);
    await waitFor(() => currentGuard().state().activeSymbols.some((set) => set.symbols.some((symbol) => symbol.name === "applyDiscount")));
    const cart = await connect("src/cart.ts", bob.member.id);
    if (start === "空白") replace(cart, "    let amount = 0;", "\n    let amount = 0;");
    else replace(cart, "return applyDiscount(amount, 0.1);", "return applyDiscount(amount, 0.1) +;");
    await waitFor(() => currentGuard().tracker.getOpenBatches().some((batch) => batch.actor.kind === "human" && batch.actor.memberId === bob.member.id));
    if (start === "空白") replace(cart, "amount, 0.1", "amount, 0.2");
    else replace(cart, "amount, 0.1) +;", "amount, 0.2);");
    await waitFor(() => currentGuard().state(bob.member.id).t0Warnings.length === 1);
    expect(currentGuard().tracker.getOpenBatches().some((batch) => batch.actor.kind === "human" && batch.actor.memberId === bob.member.id)).toBe(true);
    await waitFor(() => currentGuard().tracker.getOpenBatches().length === 0);
    await waitFor(() => currentState().pairDecisions?.some((record) => record.status === "judged" && record.verdict?.decision === "lock") === true);
    const events = readTrace(await (await bob.request("/conflict-guard/trace")).text());
    const warnings = events.filter((event) => event.type === "t0_warning" && event.memberId === bob.member.id);
    const closed = events.find((event) => event.type === "batch_closed" && (event.actor as { memberId?: string })?.memberId === bob.member.id)!;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.seq).toBeLessThan(closed.seq);
    expect(replayTrace(events, { policy: "P3" }).coordinationEvents.filter((event) => event.type === "t0_warning")).toHaveLength(1);
    expect(checkReplay(events)).toMatchObject({ checked: true, valid: true, differences: [] });
  }, 12000);

  it("同位置先后替换文本仍然产生双方的黑区变更对", async () => {
    const first = await connect("src/report.ts", alice.member.id);
    const second = await connect("src/report.ts", bob.member.id);
    replace(first, '"Shop report"', '"Daily report"');
    await waitFor(() => second.getText("content").toString().includes("Daily report"));
    replace(second, '"Daily report"', '"Weekly report"');
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.decision === "lock") === true);
    expect(currentGuard().state().activeSymbols.filter((set) => set.symbols.some((symbol) => symbol.name === "reportTime"))).toHaveLength(2);
    expect(currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "same-symbol-concurrent-write")).toBe(true);
    expect(checkReplay(readTrace(await (await alice.request("/conflict-guard/trace")).text()))).toMatchObject({ checked: true, valid: true, differences: [] });
  });

  it("同一函数判黑、冻结并阻止写盘，轨迹保留判定", async () => {
    const first = await connect("src/cart.ts", alice.member.id);
    const second = await connect("src/cart.ts", bob.member.id);
    replace(first, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => second.getText("content").toString().includes("amount, 0.2"));
    replace(second, "let amount = 0", "let amount = 1");
    await waitFor(() => {
      const state = currentState();
      return state.pairDecisions?.some((record: { verdict?: { decision?: string }; status: string }) => record.status === "judged" && record.verdict?.decision === "lock") === true;
    });
    const state = currentState();
    expect(state.frozenFiles?.some((entry: { file: string }) => entry.file === "src/cart.ts")).toBe(true);
    const source = await fs.readFile(app.locals.runtimeManager.get(projectId).project.workspacePath + "/src/cart.ts", "utf8");
    expect(source).toContain("applyDiscount(amount, 0.1)");
    await alice.request("/conflict-guard/done", { method: "POST" });
    await bob.request("/conflict-guard/done", { method: "POST" });
    const events = readTrace(await (await alice.request("/conflict-guard/trace")).text());
    expect(events.some((event) => event.type === "pair_judged")).toBe(true);
    expect(validateTraceDetailed(events).valid).toBe(true);
    const replay = checkReplay(events);
    expect(replay, JSON.stringify(replay)).toMatchObject({ checked: true, valid: true, differences: [] });
    await saveReplayEvidence("same-symbol", events);
  });

  it("调用签名不兼容判黑并挡住两个文件的写盘", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    await waitFor(() => cart.getText("content").toString().includes("applyDiscount(amount, 0.1)"));
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => currentState().pairDecisions?.some((record: { verdict?: { ruleId?: string; decision?: string } }) => record.verdict?.ruleId === "call-signature-incompatible" && record.verdict.decision === "lock") === true);
    await waitFor(() => (currentState().blockedPersists?.length ?? 0) > 0);
    const state = currentState();
    expect(state.frozenFiles?.map((entry: { file: string }) => entry.file)).toEqual(expect.arrayContaining(["src/pricing.ts", "src/cart.ts"]));
    expect(state.blockedPersists?.length).toBeGreaterThan(0);
    const pricingSource = await fs.readFile(path.join(app.locals.runtimeManager.get(projectId).project.workspacePath, "src/pricing.ts"), "utf8");
    expect(pricingSource).toContain("applyDiscount(price: number, rate: number)");
    const events = readTrace(await (await alice.request("/conflict-guard/trace")).text());
    expect(checkReplay(events)).toMatchObject({ checked: true, valid: true, differences: [] });
    await saveReplayEvidence("call-signature", events);
  });

  it("成员撤回后解除冻结并记录 guard-revert", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => currentState().pairDecisions?.some((record: { verdict?: { ruleId?: string; decision?: string } }) => record.verdict?.ruleId === "call-signature-incompatible" && record.verdict.decision === "lock") === true);
    const pair = currentState().pairDecisions?.find((record: { verdict?: { ruleId?: string } }) => record.verdict?.ruleId === "call-signature-incompatible") as { pair: { id: string } } | undefined;
    expect(pair).toBeDefined();
    const chatResponse = await alice.request(`/conflict-guard/pairs/${pair!.pair.id}/chat`, { method: "POST", body: JSON.stringify({ text: "@Alice @Bob 请确认冲突处理" }), headers: { "Content-Type": "application/json" } });
    expect(chatResponse.status).toBe(200);
    const response = await alice.request(`/conflict-guard/pairs/${pair!.pair.id}/revert`, { method: "POST" });
    expect(response.status).toBe(204);
    await waitFor(() => currentState().pairDecisions?.some((record: { pair: { id: string }; resolution?: string }) => record.pair.id === pair!.pair.id && record.resolution === "reverted") === true);
    const trace = readTrace(await (await alice.request("/conflict-guard/trace")).text());
    expect(trace.some((event) => event.type === "ui_action" && event.action === "revert_pair")).toBe(true);
    expect(trace.some((event) => event.type === "edit" && (event.origin as { kind?: string })?.kind === "guard-revert")).toBe(true);
  });

  it("撤回覆盖当前活跃文件的全部批次并保留另一成员的修改", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const bobPricing = await connect("src/pricing.ts", bob.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    const baseline = pricing.getText("content").toString();
    replace(pricing, "`${currency} ${amount.toFixed(2)}`", "`${currency}: ${amount.toFixed(2)}`");
    await waitFor(() => currentGuard().state().activeSymbols.some((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id && set.symbols.some((symbol) => symbol.name === "formatMoney")));
    await waitFor(() => currentGuard().tracker.getActiveChangeSets().some((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id && set.status === "settled"));
    replace(bobPricing, "applyDiscount(price, 0.2)", "applyDiscount(price, 0.25)");
    await waitFor(() => pricing.getText("content").toString().includes("applyDiscount(price, 0.25)"));
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "call-signature-incompatible" && record.verdict.decision === "lock") === true);
    const pair = currentState().pairDecisions!.find((record) => record.verdict?.ruleId === "call-signature-incompatible")!;
    expect((await alice.request(`/conflict-guard/pairs/${pair.pair.id}/revert`, { method: "POST" })).status).toBe(204);
    const expected = baseline.replace("applyDiscount(price, 0.2)", "applyDiscount(price, 0.25)");
    await waitFor(() => !pricing.getText("content").toString().includes("currency: string"));
    expect(pricing.getText("content").toString()).toBe(expected);
    expect(cart.getText("content").toString()).toContain("applyDiscount(amount, 0.2)");
  });

  it("撤回新一轮活跃文件时保留已经完成的修改", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(pricing, "`${currency} ${amount.toFixed(2)}`", "`${currency}: ${amount.toFixed(2)}`");
    await waitFor(() => currentGuard().tracker.getActiveChangeSets().some((set) => set.actor.kind === "human" && set.actor.memberId === alice.member.id && set.status === "settled"));
    expect((await alice.request("/conflict-guard/done", { method: "POST" })).status).toBe(204);
    const completed = pricing.getText("content").toString();
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "call-signature-incompatible" && record.verdict.decision === "lock") === true);
    const pair = currentState().pairDecisions!.find((record) => record.verdict?.ruleId === "call-signature-incompatible")!;
    expect((await alice.request(`/conflict-guard/pairs/${pair.pair.id}/revert`, { method: "POST" })).status).toBe(204);
    await waitFor(() => !pricing.getText("content").toString().includes("currency: string"));
    expect(pricing.getText("content").toString()).toBe(completed);
  });

  it("T0 不向开始编辑无关函数的成员发送提示", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "call-signature-incompatible") === true);
    const report = await connect("src/report.ts", bob.member.id);
    replace(report, 'return "Shop report"', 'return "Updated report"');
    await waitFor(() => currentGuard().state().activeSymbols.some((set) => set.actor.kind === "human" && set.actor.memberId === bob.member.id && set.symbols.some((symbol) => symbol.name === "reportTime")));
    const state = await (await bob.request("/conflict-guard/state")).json() as { t0Warnings: unknown[] };
    expect(state.t0Warnings).toEqual([]);
    const events = readTrace(await (await bob.request("/conflict-guard/trace")).text());
    expect(events.filter((event) => event.type === "t0_warning" && event.memberId === bob.member.id)).toEqual([]);
  });

  it("T0 向没有参加已有变更对的依赖方成员发送提示", async () => {
    const pricing = await connect("src/pricing.ts", alice.member.id);
    const cart = await connect("src/cart.ts", bob.member.id);
    replace(pricing, "applyDiscount(price: number, rate: number)", "applyDiscount(price: number, rate: number, currency: string)");
    replace(cart, "applyDiscount(amount, 0.1)", "applyDiscount(amount, 0.2)");
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "call-signature-incompatible") === true);
    const carol = await joinMember(origin, projectId, { name: "Carol" });
    const checkout = await connect("src/checkout.ts", carol.member.id);
    replace(checkout, "return formatMoney(cart.total());", "return formatMoney(cart.total() + 1);");
    await waitFor(() => currentGuard().state().activeSymbols.some((set) => set.actor.kind === "human" && set.actor.memberId === carol.member.id && set.symbols.some((symbol) => symbol.name === "checkout")));
    const state = await (await carol.request("/conflict-guard/state")).json() as { t0Warnings: Array<{ summary: string }> };
    expect(state.t0Warnings).toHaveLength(1);
    expect(state.t0Warnings[0]!.summary).toContain("applyDiscount");
    const events = readTrace(await (await carol.request("/conflict-guard/trace")).text());
    expect(events.filter((event) => event.type === "t0_warning" && event.memberId === carol.member.id)).toHaveLength(1);
    expect((await (await alice.request("/conflict-guard/state")).json() as { t0Warnings: unknown[] }).t0Warnings).toEqual([]);
  });

  it("幽灵成员通过真实连接重放编辑与光标并形成冻结", async () => {
    const pricing = await fs.readFile(path.join(shopRoot, "src/pricing.ts"), "utf8");
    const cart = await fs.readFile(path.join(shopRoot, "src/cart.ts"), "utf8");
    const events = [
      { schema: 3 as const, seq: 1, at: 0, type: "session_start", config: { idleMs: 50 } },
      { schema: 3 as const, seq: 2, at: 0, type: "doc_open", file: "src/pricing.ts", text: pricing },
      { schema: 3 as const, seq: 3, at: 0, type: "doc_open", file: "src/cart.ts", text: cart },
      { schema: 3 as const, seq: 4, at: 100, type: "edit", file: "src/pricing.ts", origin: { kind: "human", memberId: "origin" }, ops: [{ from: pricing.indexOf("rate: number)"), deleted: "rate: number)", inserted: "rate: number, currency: string)" }] },
      { schema: 3 as const, seq: 5, at: 200, type: "edit", file: "src/cart.ts", origin: { kind: "human", memberId: "candidate" }, ops: [{ from: cart.indexOf("amount, 0.1"), deleted: "amount, 0.1", inserted: "amount, 0.2" }] },
      { schema: 3 as const, seq: 6, at: 210, type: "cursor", file: "src/cart.ts", memberId: "candidate", position: { lineNumber: 14, column: 10 } }
    ];
    const replay = replayUi({ server: origin, projectId, events, speed: 2, settleMs: 100, holdMs: 500 });
    await waitFor(() => currentState().pairDecisions?.some((record) => record.verdict?.ruleId === "call-signature-incompatible") === true);
    expect(currentState().frozenFiles?.map((file) => file.file)).toEqual(expect.arrayContaining(["src/pricing.ts", "src/cart.ts"]));
    const result = await replay;
    const trace = readTrace(await (await alice.request("/conflict-guard/trace")).text());
    expect(trace.some((event) => event.type === "cursor" && event.memberId === result.memberIds.candidate)).toBe(true);
    expect(Object.keys(result.memberIds)).toEqual(["origin", "candidate"]);
  });

  function currentGuard() { return app.locals.runtimeManager.get(projectId).conflictGuard as ProjectConflictGuard; }
  function currentState() { return currentGuard().state(); }
  async function connect(file: string, memberId: string) {
    const document = new Y.Doc();
    documents.push(document);
    const provider = new WebsocketProvider(`${origin}/yjs/${projectId}`, encodeURIComponent(`${roomId}:${file}`), document, { disableBc: true, params: { memberId }, WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
    providers.push(provider);
    await new Promise<void>((resolve, reject) => { provider.once("sync", (synced) => synced ? resolve() : undefined); provider.once("connection-error", reject); });
    return document;
  }
  function replace(document: Y.Doc, before: string, after: string) { const text = document.getText("content"); const start = text.toString().indexOf(before); expect(start).toBeGreaterThanOrEqual(0); document.transact(() => { text.delete(start, before.length); text.insert(start, after); }); }
});

async function saveReplayEvidence(name: string, events: ReturnType<typeof readTrace>) {
  const directory = process.env.SIMPLERCP_REPLAY_EVIDENCE;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${name}.jsonl`), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  await fs.writeFile(path.join(directory, `${name}-check.json`), JSON.stringify(checkReplay(events), null, 2) + "\n");
}

async function waitFor(check: () => boolean | Promise<boolean>) { const end = Date.now() + 5_000; while (!await check()) { if (Date.now() >= end) throw new Error("等待规则判定超时"); await new Promise((resolve) => setTimeout(resolve, 10)); } }
