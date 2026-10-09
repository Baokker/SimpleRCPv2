import type { AgentQuestion } from "@simplercp/shared";

export function createAgentQuestions(options: {
  pause(): () => void;
  reply(id: string, answers: string[][], signal: AbortSignal): Promise<void>;
  reject(id: string, signal: AbortSignal): Promise<void>;
  abort(signal: AbortSignal): Promise<void>;
  changed(questions: AgentQuestion[]): void | Promise<void>;
  report(error: unknown): void;
  timeoutMs?: number;
  requestTimeoutMs?: number;
}) {
  const pending = new Map<string, { question: AgentQuestion; resume(): void; timer: ReturnType<typeof setTimeout>; responding: boolean }>();
  const operations = new Set<Promise<void>>();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const publish = () => options.changed([...pending.values()].map((entry) => entry.question));
  async function request(operation: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("问题回复请求超时"));
          }, options.requestTimeoutMs ?? 10_000);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function remove(id: string) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.resume();
  }
  async function respond(id: string, answers?: string[][]) {
    const entry = pending.get(id);
    if (!entry || entry.responding) throw new Error("该问题已经处理");
    if (answers) {
      if (answers.length !== entry.question.questions.length) throw new Error("请回答所有问题");
      for (const [index, selected] of answers.entries()) {
        const question = entry.question.questions[index]!;
        if (!Array.isArray(selected) || !selected.length || selected.some((value) => typeof value !== "string" || !value.trim() || value.length > 4000) || !question.multiple && selected.length !== 1) throw new Error("回答格式不正确");
        if (question.custom === false && selected.some((value) => !question.options.some((option) => option.label === value))) throw new Error("请选择提供的选项");
      }
    }
    entry.responding = true;
    clearTimeout(entry.timer);
    try {
      await request((signal) => answers ? options.reply(id, answers, signal) : options.reject(id, signal));
    } catch (error) {
      try { await request(options.abort); }
      catch (abortError) { options.report(abortError); }
      throw error;
    } finally {
      remove(id);
      await publish();
    }
  }
  const track = (operation: Promise<void>) => {
    operations.add(operation);
    void operation.then(() => operations.delete(operation), () => operations.delete(operation));
  };
  function answer(id: string, answers?: string[][]) {
    const operation = respond(id, answers);
    track(operation);
    return operation;
  }
  return {
    async asked(question: AgentQuestion) {
      if (disposed) {
        await request((signal) => options.reject(question.id, signal));
        return;
      }
      if (pending.has(question.id)) return;
      const resume = options.pause();
      const timer = setTimeout(() => { void answer(question.id).catch(options.report); }, options.timeoutMs ?? 300_000);
      pending.set(question.id, { question, resume, timer, responding: false });
      await publish();
    },
    async closed(id: string) { remove(id); await publish(); },
    answer,
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      const waiting = [...pending.entries()];
      for (const [id] of waiting) remove(id);
      disposal = (async () => {
        await publish();
        const results = await Promise.allSettled([
          ...operations,
          ...waiting.filter(([, entry]) => !entry.responding).map(([id]) => request((signal) => options.reject(id, signal)))
        ]);
        for (const result of results) if (result.status === "rejected") options.report(result.reason);
      })();
      return disposal;
    }
  };
}
