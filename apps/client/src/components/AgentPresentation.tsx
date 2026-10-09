import type { ReactNode } from "react";

export function AgentBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "danger" | "warning" | "success" | "info" }) {
  return <span className="agent-badge" data-tone={tone}>{children}</span>;
}

export function AgentMetrics({ items }: { items: Array<{ id: string; label: string; value: ReactNode }> }) {
  return <dl className="agent-metrics">{items.map((item) => <div data-metric={item.id} key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}
