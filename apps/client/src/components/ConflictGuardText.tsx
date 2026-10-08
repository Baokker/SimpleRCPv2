import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export function GuardBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "danger" | "warning" | "success" | "info" }) {
  return <span className="conflict-badge" data-tone={tone}>{children}</span>;
}

export function GuardMetrics({ items, testId }: { items: Array<{ id: string; label: string; value: ReactNode }>; testId?: string }) {
  return <dl className="conflict-metrics" data-testid={testId}>{items.map((item) => <div className="conflict-metric" data-metric={item.id} key={item.id}><dt>{item.label}</dt>{" "}<dd>{item.value}</dd></div>)}</dl>;
}

export function GuardScope({ label, scope, extraScope = [], empty = "尚未声明" }: { label: string; scope: string[]; extraScope?: string[]; empty?: string }) {
  return <div className="conflict-scope"><span className="conflict-field-label">{label}</span>{scope.length ? <ul>{scope.map((key) => {
    const boundary = key.indexOf("#");
    return <li key={key}><code>{boundary < 0 ? key : key.slice(0, boundary)}</code>{boundary >= 0 ? <strong>{key.slice(boundary + 1)}</strong> : null}{extraScope.includes(key) ? <GuardBadge tone="warning">超出计划</GuardBadge> : null}</li>;
  })}</ul> : <span className="conflict-empty-inline">{empty}</span>}</div>;
}

export function ReadableText({ text, testId }: { text: string; testId?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const formatted = text.trim().replace(/([。！？；])\s*(?=\S)/g, "$1\n");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [formatted, expanded]);
  return <div className="conflict-readable"><p ref={ref} className={expanded ? "expanded" : "collapsed"} data-testid={testId}>{formatted}</p>{overflowing ? <button className="conflict-text-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开"}</button> : null}</div>;
}
