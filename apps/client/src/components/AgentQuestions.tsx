import { useState } from "react";
import type { AgentRun } from "../types";
import { answerAgentQuestion } from "../api";

export function AgentQuestions({ projectId, run, memberId, onError }: { projectId: string; run: AgentRun; memberId?: string; onError(error: unknown): void }) {
  return <>{run.status === "running" ? run.questions?.map((request) => <QuestionForm key={request.id} projectId={projectId} run={run} request={request} canAnswer={memberId === run.memberId} onError={onError} />) : null}</>;
}

function QuestionForm({ projectId, run, request, canAnswer, onError }: { projectId: string; run: AgentRun; request: NonNullable<AgentRun["questions"]>[number]; canAnswer: boolean; onError(error: unknown): void }) {
  const [answers, setAnswers] = useState<string[][]>(request.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(request.questions.map(() => ""));
  const [sending, setSending] = useState(false);
  const [answered, setAnswered] = useState(false);
  const complete = answers.map((selected, index) => custom[index]?.trim() ? [...selected, custom[index]!.trim()] : selected);
  async function submit(values?: string[][]) {
    setSending(true);
    try { await answerAgentQuestion(projectId, run.id, request.id, values); setAnswered(true); }
    catch (error) { onError(error); }
    finally { setSending(false); }
  }
  if (answered) return <p role="status">回答已发送，Agent 将继续执行。</p>;
  return <section className="agent-question" data-testid="agent-question"><strong>Agent 需要你的回答</strong>
    {request.questions.map((question, index) => <fieldset key={index} disabled={!canAnswer || sending}><legend>{question.header}</legend><p>{question.question}</p>
      {question.options.map((option) => <label key={option.label}><input type={question.multiple ? "checkbox" : "radio"} name={`${request.id}-${index}`} checked={answers[index]!.includes(option.label)} onChange={(event) => {
        setAnswers((current) => current.map((selected, position) => position !== index ? selected : question.multiple ? event.target.checked ? [...selected, option.label] : selected.filter((value) => value !== option.label) : [option.label]));
        if (!question.multiple) setCustom((current) => current.map((value, position) => position === index ? "" : value));
      }} /><span>{option.label}<small>{option.description}</small></span></label>)}
      {question.custom !== false ? <label>补充回答<input value={custom[index]} maxLength={4000} onChange={(event) => { setCustom((current) => current.map((value, position) => position === index ? event.target.value : value)); if (!question.multiple) setAnswers((current) => current.map((value, position) => position === index ? [] : value)); }} /></label> : null}
    </fieldset>)}
    {canAnswer ? <div className="agent-question-actions"><button type="button" className="primary" disabled={sending || complete.some((selected) => !selected.length)} onClick={() => void submit(complete)}>发送回答</button><button type="button" disabled={sending} onClick={() => void submit()}>跳过问题</button></div> : <p>等待 {run.memberName ?? "任务发起者"} 回答。</p>}
  </section>;
}
