export interface AccessSession {
  token: string;
  subject: string;
  issued: number;
  expires: number;
  scopes: Set<string>;
}
export class AccessSessions {
  private byToken = new Map<string, AccessSession>();
  private serial = 0;
  create(subject: string, now: number, ttl: number, scopes: string[]) {
    if (!subject || ttl <= 0) throw new Error('invalid session');
    const token = `session-${++this.serial}`;
    this.byToken.set(token, { token, subject, issued: now, expires: now + ttl, scopes: new Set(scopes) });
    return token;
  }
  validate(token: string, scope: string, now: number) {
    const session = this.byToken.get(token);
    if (!session || session.expires <= now || !session.scopes.has(scope)) return undefined;
    return session.subject;
  }
  narrow(token: string, scopes: string[]) {
    const session = this.byToken.get(token);
    if (!session) throw new Error('unknown session');
    if (scopes.some((scope) => !session.scopes.has(scope))) throw new Error('scope escalation');
    session.scopes = new Set(scopes);
  }
  revokeSubject(subject: string) {
    let count = 0;
    for (const [token, session] of this.byToken) {
      if (session.subject === subject) {
        this.byToken.delete(token);
        count += 1;
      }
    }
    return count;
  }
  expire(now: number) {
    for (const [token, session] of this.byToken) if (session.expires <= now) this.byToken.delete(token);
  }
  active(subject: string, now: number) {
    return [...this.byToken.values()].filter((session) => session.subject === subject && session.expires > now).length;
  }
}
