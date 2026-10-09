import { expect, it } from "vitest";
import { createAgentQuestions } from "../agent/agentQuestions.js";
import { createApprovalBudget } from "../agent/agentRunSupport.js";
import { createAgentProgress } from "../agent/agentProgress.js";
import type { AgentQuestion } from "@simplercp/shared";
import http from "node:http";

it("question state pauses the run budget and validates answers before processing", async () => {
  const budget = createApprovalBudget();
  const answered: string[][][] = [];
  const rejected: string[] = [];
  let pending: AgentQuestion[] = [];
  const queue = createAgentQuestions({ pause: budget.pause, async reply(_id, answers) { answered.push(answers); }, async reject(id) { rejected.push(id); }, async abort() { throw new Error("Unexpected cancellation"); }, changed(questions) { pending = questions; }, report(error) { throw error; } });
  const question: AgentQuestion = { id: "question-1", sessionID: "child-session", questions: [{ header: "折扣", question: "请确认折扣比例", options: [{ label: "五折", description: "价格乘以 0.5" }, { label: "八折", description: "价格乘以 0.8" }], custom: false }] };
  await queue.asked(question);
  expect(budget.paused()).toBe(true);
  expect(pending).toEqual([question]);
  await expect(queue.answer(question.id, [["其他"]])).rejects.toThrow("请选择");
  expect(answered).toEqual([]);
  await queue.answer(question.id, [["八折"]]);
  expect(answered).toEqual([[["八折"]]]);
  expect(budget.paused()).toBe(false);
  expect(pending).toEqual([]);
  await queue.asked({ ...question, id: "question-2" });
  await queue.dispose();
  expect(rejected).toEqual(["question-2"]);
  expect(budget.paused()).toBe(false);
});

it("question waiting remains visible across tool updates and has a finite timeout", async () => {
  const progress = createAgentProgress(new Date().toISOString());
  const question: AgentQuestion = { id: "timeout-question", sessionID: "session", questions: [{ header: "范围", question: "确认修改范围", options: [] }] };
  progress.event({ type: "question.asked", data: { ...question } }, new Date().toISOString());
  progress.event({ type: "message.part.updated", data: { part: { id: "tool", type: "tool", tool: "question", state: { status: "running", input: {} } } } }, new Date().toISOString());
  expect(progress.snapshot().phase).toBe("question");
  progress.syncQuestions([]);
  expect(progress.snapshot().phase).not.toBe("question");
  const budget = createApprovalBudget();
  const rejected: string[] = [];
  const queue = createAgentQuestions({ pause: budget.pause, async reply() {}, async reject(id) { rejected.push(id); }, async abort() { throw new Error("Unexpected cancellation"); }, changed() {}, report(error) { throw error; }, timeoutMs: 20 });
  await queue.asked(question);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(rejected).toEqual([question.id]);
  expect(budget.paused()).toBe(false);
  await queue.dispose();
});

it("an answer submitted before expiry completes; unresponsive HTTP replies cannot block disposal", async () => {
  let aborts = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/reply") setTimeout(() => res.end(), 80);
    if (req.url === "/abort") { aborts += 1; res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP address");
  const origin = `http://127.0.0.1:${address.port}`;
  const budget = createApprovalBudget();
  const errors: unknown[] = [];
  const queue = createAgentQuestions({
    pause: budget.pause,
    async reply(_id, _answers, signal) { await fetch(`${origin}/reply`, { signal }); },
    async reject(_id, signal) { await fetch(`${origin}/reject`, { signal }); },
    async abort(signal) { await fetch(`${origin}/abort`, { signal }); },
    changed() {}, report(error) { errors.push(error); }, timeoutMs: 40, requestTimeoutMs: 200
  });
  const question: AgentQuestion = { id: "http-question", sessionID: "session", questions: [{ header: "说明", question: "需要哪种语言？", options: [] }] };
  try {
    await queue.asked(question);
    await queue.answer(question.id, [["法文"]]);
    expect(aborts).toBe(0);
    expect(errors).toEqual([]);
    await queue.asked({ ...question, id: "unresponsive" });
    const disposing = queue.dispose();
    expect(budget.paused()).toBe(false);
    await disposing;
    expect(errors).toHaveLength(1);
    await queue.dispose();
  } finally {
    await queue.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
