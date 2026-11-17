import type { ReactNode } from "react";
import type { KnowledgeCard, RoomMember } from "../types";

// Renders capture evidence as readable parts (who did what, prompts, file changes,
// chat) instead of raw JSON. The raw document stays available for audit.

type Value = Record<string, unknown>;
type Props = { triggerType: string; evidence: Value; members: RoomMember[]; cards?: KnowledgeCard[]; dedupe?: { cardId: string; score: number } };

const isObject = (value: unknown): value is Value => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : undefined;
const time = (value: unknown) => typeof value === "number" ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : undefined;
const statusLabels: Record<string, string> = { completed: "已完成", running: "进行中", failed: "失败", cancelled: "已取消", interrupted: "被打断" };

export function KnowledgeEvidence({ triggerType, evidence, members, cards = [], dedupe }: Props) {
  const name = (id: unknown) => typeof id === "string" ? members.find(member => member.id === id)?.displayName ?? "成员" : "成员";
  const file = text(evidence.file);
  const run = (label: string, value: unknown, showFiles = true) => isObject(value) ? <RunView key={label} label={label} run={value} name={name} showFiles={showFiles} /> : null;
  const sections: ReactNode[] = [];
  sections.push(run("上一次 Agent 任务", evidence.previousRun), run("纠正时的新指令", evidence.correction), run("失败的任务", evidence.failedRun), run("再次运行", evidence.retryRun), run("被打断的任务", evidence.run));
  if (isObject(evidence.interruption)) sections.push(<Section key="interruption" title={`${name(evidence.interruption.memberId)} 打断后的指令`}>{text(evidence.interruption.nextPrompt) ? <Quote>{text(evidence.interruption.nextPrompt)}</Quote> : <p className="evidence-muted">没有新的指令</p>}</Section>);
  if (text(evidence.agentPrompt)) sections.push(<Section key="agentPrompt" title="Agent 当时的指令"><Quote>{text(evidence.agentPrompt)}</Quote></Section>);
  const files = [evidence.agentFileChange, ...(Array.isArray(evidence.correctionFiles) ? evidence.correctionFiles : [])].filter(isObject);
  if (!isObject(evidence.previousRun) && Array.isArray(evidence.previousDiff)) files.push(...evidence.previousDiff.filter(isObject));
  if (files.length) sections.push(<Section key="files" title="文件改动"><FileList changes={files} /></Section>);
  if (Array.isArray(evidence.overwritten) && evidence.overwritten.length) sections.push(<Section key="overwritten" title="被改写的原有内容">{evidence.overwritten.filter(isObject).map((item, index) => <pre key={index} className="evidence-code evidence-removed">{text(item.deletedText)}</pre>)}</Section>);
  if (text(evidence.replacement)) sections.push(<Section key="replacement" title="改写后的内容"><pre className="evidence-code evidence-added">{text(evidence.replacement)}</pre></Section>);
  const snippet = isObject(evidence.diff) ? evidence.diff : isObject(evidence.beforeAfter) ? evidence.beforeAfter : undefined;
  if (snippet && !files.length) sections.push(<Section key="diff" title={`改动片段${typeof snippet.startLine === "number" ? `（第 ${snippet.startLine} 行起）` : ""}`}><LineDiff before={text(snippet.before) ?? ""} after={text(snippet.after) ?? ""} /></Section>);
  if (isObject(evidence.failure)) sections.push(<Section key="failure" title="失败的命令"><pre className="evidence-code">{text(evidence.failure.command)}</pre>{text(evidence.failure.error) ? <pre className="evidence-code evidence-removed">{text(evidence.failure.error)}</pre> : null}</Section>);
  if (Array.isArray(evidence.modifiedFiles) && evidence.modifiedFiles.length) sections.push(<Section key="modified" title="之后修改的文件"><ul className="evidence-plain-list">{evidence.modifiedFiles.map(item => <li key={String(item)}>{String(item)}</li>)}</ul></Section>);
  if (isObject(evidence.success)) sections.push(<Section key="success" title="随后成功的命令"><pre className="evidence-code evidence-added">{text(evidence.success.command)}</pre></Section>);
  for (const [key, label] of [["added", "新增"], ["removed", "移除"]] as const) {
    const items = Array.isArray(evidence[key]) ? (evidence[key] as unknown[]) : [];
    if (items.length) sections.push(<Section key={key} title={label}><ul className="evidence-plain-list">{items.map((item, index) => <li key={index}>{isObject(item) ? String(item.number ?? item.name ?? JSON.stringify(item)) : String(item)}</li>)}</ul></Section>);
  }
  if (isObject(evidence.todo) && text(evidence.todo.before)) sections.push(<Section key="todo" title="完成的待办"><pre className="evidence-code">{text(evidence.todo.before)}</pre></Section>);
  if (Array.isArray(evidence.chatMessages) && evidence.chatMessages.length) sections.push(<Section key="chat" title={`相关聊天（${evidence.chatMessages.length} 条）`}><ol className="evidence-chat">{evidence.chatMessages.filter(isObject).map((message, index) => <li key={String(message.messageId ?? index)}><span className="evidence-who">{name(message.authorId)}</span><time>{time(message.at)}</time><p>{text(message.text)}</p></li>)}</ol></Section>);
  const dedupeCard = dedupe ? cards.find(card => card.id === dedupe.cardId) : undefined;
  return <div className="knowledge-evidence" data-testid="knowledge-evidence">
    <p className="evidence-lead">{lead(triggerType, evidence, name, file)}</p>
    {dedupe ? <p className="evidence-muted">与已有卡片{dedupeCard ? `《${dedupeCard.title}》` : ` ${dedupe.cardId}`}相似，相似度 {Math.round(dedupe.score * 100)}%</p> : null}
    {sections.filter(Boolean)}
    <details className="evidence-raw"><summary>原始数据</summary><pre>{JSON.stringify(evidence, null, 2)}</pre></details>
  </div>;
}

function lead(trigger: string, e: Value, name: (id: unknown) => string, file?: string) {
  const at = file ? `在 ${file} 中` : "";
  switch (trigger) {
    case "agent.corrected": return `${name(e.primaryActor)} 在 Agent 完成任务后很快下达了新的指令，系统把它看作对上一次任务的纠正。`;
    case "agent.interrupted": return `${name(e.primaryActor)} 打断了 Agent 的任务。`;
    case "agent.revised": return `${name(e.editor)} ${at}改写了 Agent 刚写入的内容。`;
    case "agent.retried": return `失败的 Agent 任务再次运行${typeof e.similarity === "number" ? `，两次指令的相似度为 ${Math.round(e.similarity * 100)}%` : ""}。`;
    case "agent.toolRecovered": return "Agent 的命令失败后，修改了文件，随后命令运行成功。";
    case "edit.overwritten": return `${name(e.editor)} ${at}改写了 ${name(e.author)} 刚写的内容。`;
    case "rollback.detected": return `${name(e.restorer)} ${at}恢复了 ${name(e.deleter)} 删除的内容。`;
    case "chat.dense": return `成员在短时间内集中讨论，共 ${Array.isArray(e.chatMessages) ? e.chatMessages.length : 0} 条消息。`;
    case "todo.cleared": return `${at}有一条待办标记被完成。`;
    case "magicNumber.added": return `${at}新增了数字常量。`;
    case "dependency.changed": return "项目依赖发生了变化。";
    default: return file ? `相关文件 ${file}。` : "系统记录了以下协作过程。";
  }
}

function RunView({ label, run, name, showFiles }: { label: string; run: Value; name: (id: unknown) => string; showFiles: boolean }) {
  const changes = Array.isArray(run.fileChanges) ? run.fileChanges.filter(isObject) : [];
  const status = text(run.status);
  return <Section title={label} meta={[name(run.memberId), time(run.at), status ? statusLabels[status] ?? status : undefined].filter(Boolean).join(" · ")}>
    {text(run.prompt) ? <Quote>{text(run.prompt)}</Quote> : null}
    {showFiles && changes.length ? <FileList changes={changes} /> : null}
  </Section>;
}

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return <section className="evidence-section"><header><strong>{title}</strong>{meta ? <span>{meta}</span> : null}</header>{children}</section>;
}

function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="evidence-quote">{children}</blockquote>;
}

function FileList({ changes }: { changes: Value[] }) {
  return <ul className="evidence-files">{changes.map((change, index) => {
    const before = text(change.beforeText); const after = text(change.afterText);
    const added = typeof change.additions === "number" ? change.additions : undefined; const removed = typeof change.deletions === "number" ? change.deletions : undefined;
    const kind = change.status === "added" ? "新增" : change.status === "deleted" ? "删除" : "修改";
    const body = text(change.patch) ? <pre className="evidence-code">{text(change.patch)}</pre> : before !== undefined || after !== undefined ? <LineDiff before={before ?? ""} after={after ?? ""} /> : text(change.addedText) || text(change.removedText) ? <LineDiff before={text(change.removedText) ?? ""} after={text(change.addedText) ?? ""} /> : null;
    return <li key={`${String(change.file)}-${index}`}><details><summary><span className="evidence-kind">{kind}</span><code>{String(change.file)}</code>{added !== undefined ? <span className="evidence-plus">+{added}</span> : null}{removed !== undefined ? <span className="evidence-minus">−{removed}</span> : null}</summary>{body ?? <p className="evidence-muted">没有记录具体内容</p>}</details></li>;
  })}</ul>;
}

type DiffLine = { kind: " " | "+" | "-"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : []; const b = after ? after.split("\n") : [];
  let start = 0; while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length; let endB = b.length; while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head = a.slice(0, start).map(line => ({ kind: " " as const, text: line }));
  const tail = a.slice(endA).map(line => ({ kind: " " as const, text: line }));
  const x = a.slice(start, endA); const y = b.slice(start, endB);
  if (x.length * y.length > 250000) return [...head, ...x.map(line => ({ kind: "-" as const, text: line })), ...y.map(line => ({ kind: "+" as const, text: line })), ...tail];
  const table = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i]![j] = x[i] === y[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const middle: DiffLine[] = []; let i = 0; let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { middle.push({ kind: " ", text: x[i]! }); i++; j++; }
    else if (j < y.length && (i >= x.length || table[i]![j + 1]! >= table[i + 1]![j]!)) { middle.push({ kind: "+", text: y[j]! }); j++; }
    else { middle.push({ kind: "-", text: x[i]! }); i++; }
  }
  return [...head, ...middle, ...tail];
}

function LineDiff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after);
  const keep = lines.map((line, index) => line.kind !== " " || lines.slice(Math.max(0, index - 2), index + 3).some(item => item.kind !== " "));
  if (!keep.some(Boolean)) return <p className="evidence-muted">内容没有变化</p>;
  const rows: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (keep[index]) rows.push(<div key={index} className={line.kind === "+" ? "evidence-added" : line.kind === "-" ? "evidence-removed" : undefined}><span aria-hidden="true">{line.kind}</span>{line.text}</div>);
    else if (keep[index - 1] !== false) rows.push(<div key={index} className="evidence-gap">⋯</div>);
  });
  return <div className="evidence-code evidence-diff" role="group" aria-label="代码差异">{rows}</div>;
}
