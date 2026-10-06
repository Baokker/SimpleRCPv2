export interface AuditEntry {
  subject: string;
  action: string;
  resource: string;
  allowed: boolean;
  at: number;
  rule?: string;
}
export class AuditTrail {
  private log: AuditEntry[] = [];
  constructor(readonlyLimit = 500) {
    this.limit = readonlyLimit;
  }
  private limit: number;
  record(entry: AuditEntry) {
    if (this.log.length && entry.at < this.log.at(-1)!.at) throw new Error('audit time ordering');
    this.log.push({ ...entry });
    if (this.log.length > this.limit) this.log.shift();
  }
  denied(subject: string, since: number) {
    return this.log.filter((entry) => entry.subject === subject && !entry.allowed && entry.at >= since);
  }
  summarize(since: number) {
    const counts: Record<string, { allowed: number; denied: number }> = Object.create(null);
    for (const entry of this.log) {
      if (entry.at < since) continue;
      const count = counts[entry.action] ??= { allowed: 0, denied: 0 };
      count[entry.allowed ? 'allowed' : 'denied'] += 1;
    }
    return counts;
  }
  export(subject?: string) {
    return this.log.filter((entry) => !subject || entry.subject === subject).map((entry) => ({ ...entry }));
  }
  forget(subject: string) {
    const previous = this.log.length;
    this.log = this.log.filter((entry) => entry.subject !== subject);
    return previous - this.log.length;
  }
  repeatedDenials(threshold: number, window: number, now: number) {
    const subjects = new Set(this.log.map((entry) => entry.subject));
    return [...subjects].filter((subject) => this.denied(subject, now - window).length >= threshold);
  }
  transitionCounts(subject: string) {
    const counts = [[0, 0], [0, 0]];
    const history = this.log.filter((entry) => entry.subject === subject);
    for (let index = 1; index < history.length; index += 1) {
      const before = Number(history[index - 1]!.allowed);
      const after = Number(history[index]!.allowed);
      counts[before]![after]! += 1;
    }
    return counts;
  }
  longestDenialSequence(subject: string) {
    let current = 0;
    let longest = 0;
    for (const entry of this.log) {
      if (entry.subject !== subject) continue;
      current = entry.allowed ? 0 : current + 1;
      longest = Math.max(current, longest);
    }
    return longest;
  }
}
