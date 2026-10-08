import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openAs } from "./helpers";

const shop = fileURLToPath(new URL("../../demo/conflict-shop/", import.meta.url));
const evidence = fileURLToPath(new URL("../../docs/conflict-guard/evidence/round2-dual-agent/", import.meta.url));
test.skip(process.env.SIMPLERCP_ROUND2_LIVE !== "1", "真实双 Agent 验收通过显式命令运行");

test("双十一与 618 的真实并发任务保留双方人与 Agent 的修改", async ({ browser }) => {
  test.setTimeout(540_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [alice, bob] = await Promise.all(contexts.map((context) => context.newPage()));
  await fs.mkdir(evidence, { recursive: true });
  let projectId = "";
  try {
    await alice.goto("/");
    await alice.getByTestId("import-directory").click();
    await alice.getByTestId("project-name").fill("双十一与618并发验收");
    await alice.getByTestId("project-directory").fill(shop);
    await alice.getByTestId("create-project-submit").click();
    await expect(alice).toHaveURL(/\/projects\/[^/]+$/);
    projectId = new URL(alice.url()).pathname.split("/").at(-1)!;
    await openAs(alice, "Alice", projectId);
    await openAs(bob, "Bob", projectId);
    await expect.poll(async () => {
      const response = await alice.request.get("/api/agent/status");
      const status = await response.json();
      if (!response.ok()) throw new Error(`OpenCode 启动失败：${JSON.stringify(status)}`);
      return status.state;
    }, { timeout: 30_000 }).toBe("ready");
    for (const page of [alice, bob]) {
      await page.getByTestId("dir-src").click();
      await page.getByTestId("file-src/pricing.ts").click();
      await page.waitForFunction(() => window.__simplercpYjsSynced?.["src/pricing.ts"]);
      await page.getByTestId("collab-tab-agent").click();
    }
    const instructions = "使用 edit 或 write 修改文件，不用 bash 写入文件。保留已有接口和其他人的修改。审批要求重新读取时重新读取并调整；语义冲突时按照拒绝说明处理。仅查看此项目的 src、test 和 package.json，不查看上级目录、环境或配置，不创建 git 提交。完成后运行现有测试。";
    await alice.getByTestId("agent-prompt").fill(`给 conflict-shop 增加双十一优惠：在 src/promotionsDoubleEleven.ts 导出 applyDoubleElevenDiscount(total: Money): Money，满300减50，低于300保持原价，负数返回0。在 src/types.ts 新增 DoubleElevenPromotion 类型供该模块使用。保持原有 Money 定义。增加相应测试。${instructions}`);
    await bob.getByTestId("agent-prompt").fill(`给 conflict-shop 增加618优惠：在 src/promotions618.ts 导出 apply618Discount(total: Money): Money，减免原价的18%，负数返回0。在 src/types.ts 新增 Promotion618Options 类型供该模块使用。保持原有 Money 定义。增加相应测试。${instructions}`);
    await Promise.all([alice.getByTestId("agent-run-submit").click(), bob.getByTestId("agent-run-submit").click()]);
    await expect(alice.getByTestId("agent-run-progress").first()).toContainText("实时活动");
    await expect(bob.getByTestId("agent-run-progress").first()).toContainText("实时活动");
    await edit(alice, "return price * (1 - rate);", 'console.info("人工检查双十一");\n  return price * (1 - rate);');
    await edit(bob, 'return `${currency} ${amount.toFixed(2)}`;', 'console.info("人工检查618");\n  return `${currency} ${amount.toFixed(2)}`;');
    await alice.screenshot({ path: path.join(evidence, "alice-running.png"), fullPage: true });
    await bob.screenshot({ path: path.join(evidence, "bob-running.png"), fullPage: true });
    await expect.poll(async () => {
      const { runs } = await request(alice, projectId, "/agent/runs");
      expect(runs.length).toBeLessThanOrEqual(2);
      const project = await request(alice, projectId, "");
      const traceFile = path.join(project.project.metadataPath, "conflict-guard", "trace.jsonl");
      const trace = await fs.readFile(traceFile, "utf8");
      const events = trace.trim().split("\n").map((line) => JSON.parse(line));
      if (events.filter((event) => event.type === "provider_call" && event.role === "deep").length > 60) {
        for (const run of runs.filter((entry: any) => entry.status === "running")) await request(alice, projectId, `/agent/runs/${run.id}/cancel`, "POST");
        throw new Error("真实深判预算已经达到上限");
      }
      for (const page of [alice, bob]) {
        const state = await request(page, projectId, "/conflict-guard/state");
        if (!state.ownerCards?.some((card: any) => card.status === "waiting")) continue;
        await page.getByTestId("collab-tab-conflict").click();
        const cards = page.getByTestId("owner-intent-card");
        if (await cards.count()) {
          const accept = cards.first().getByRole("button", { name: "采纳建议", exact: true });
          if (await accept.isEnabled()) await accept.click();
        }
      }
      return runs.length === 2 && runs.every((run: any) => ["completed", "failed", "cancelled"].includes(run.status));
    }, { timeout: 480_000, intervals: [1000] }).toBe(true);
    const project = await request(alice, projectId, "");
    const runs = (await request(alice, projectId, "/agent/runs")).runs;
    await fs.writeFile(path.join(evidence, "runs.json"), JSON.stringify(runs, null, 2) + "\n");
    const trace = await fs.readFile(path.join(project.project.metadataPath, "conflict-guard", "trace.jsonl"), "utf8");
    await fs.writeFile(path.join(evidence, "trace.jsonl"), trace);
    for (const run of runs) {
      const events = (await request(alice, projectId, `/agent/runs/${run.id}/trace`)).events;
      await fs.writeFile(path.join(evidence, `run-${run.id}.jsonl`), events.map((event: any) => JSON.stringify(event)).join("\n") + "\n");
    }
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--experimental-transform-types", "--test", "test/shop.test.mjs"], { cwd: project.project.workspacePath });
    await fs.writeFile(path.join(evidence, "shop-tests.log"), stdout + stderr);
    const acceptance = await promisify(execFile)(process.execPath, ["--experimental-transform-types", fileURLToPath(new URL("../fixtures/round2-promotions.mjs", import.meta.url)), project.project.workspacePath]);
    await fs.writeFile(path.join(evidence, "promotion-tests.log"), acceptance.stdout + acceptance.stderr);
    const pricing = await fs.readFile(path.join(project.project.workspacePath, "src/pricing.ts"), "utf8");
    expect(pricing).toContain("人工检查双十一");
    expect(pricing).toContain("人工检查618");
    expect(runs.every((run: any) => run.status === "completed")).toBe(true);
    const events = trace.trim().split("\n").map((line) => JSON.parse(line));
    const checks = { completed: runs.filter((run: any) => run.status === "completed").length, judged: events.filter((event) => event.type === "pair_judged").length, deepCalls: events.filter((event) => event.type === "provider_call" && event.role === "deep").length, humanEditsPreserved: true, promotionTestsPassed: true };
    await fs.writeFile(path.join(evidence, "acceptance.json"), JSON.stringify(checks, null, 2) + "\n");
    expect(checks.judged).toBeLessThanOrEqual(20);
    await alice.getByTestId("collab-tab-agent").click();
    await bob.getByTestId("collab-tab-agent").click();
    await alice.screenshot({ path: path.join(evidence, "alice-completed.png"), fullPage: true });
    await bob.screenshot({ path: path.join(evidence, "bob-completed.png"), fullPage: true });
  } finally {
    if (projectId && !alice.isClosed()) {
      const { runs } = await request(alice, projectId, "/agent/runs");
      for (const run of runs.filter((entry: any) => ["running", "queued"].includes(entry.status))) await request(alice, projectId, `/agent/runs/${run.id}/cancel`, "POST");
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});

async function edit(page: Page, before: string, after: string) {
  await page.evaluate(({ before, after }) => {
    const editor = window.__simplercpEditors?.["src/pricing.ts"];
    if (!editor || !editor.getValue().includes(before)) throw new Error("编辑器缺少目标内容");
    const model = editor.getModel()!;
    const offset = editor.getValue().indexOf(before);
    const start = model.getPositionAt(offset);
    const end = model.getPositionAt(offset + before.length);
    editor.executeEdits("round2-acceptance", [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: after }]);
  }, { before, after });
}

async function request(page: Page, projectId: string, suffix: string, method = "GET") {
  const memberId = await page.evaluate((id) => sessionStorage.getItem(`simplercp.memberId.${id}`)!, projectId);
  const response = await page.request.fetch(`/api/projects/${projectId}${suffix}`, { method, headers: { "X-SimpleRCP-Member": memberId } });
  if (!response.ok()) throw new Error(`验收请求失败：HTTP ${response.status()}`);
  return response.status() === 204 ? undefined : response.json();
}
