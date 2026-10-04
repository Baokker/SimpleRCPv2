export interface NotificationConfig { windowMs: number; idleMs: number; hourlyLimit: number; highEdits: number; highActivity: number; }
export const defaultNotificationConfig: NotificationConfig = { windowMs: 30_000, idleMs: 5_000, hourlyLimit: 4, highEdits: 8, highActivity: 20 };
export class NotificationPolicy {
  private readonly activities = new Map<string, Array<{ at: number; type: string }>>();
  private readonly popped = new Map<string, number[]>();
  readonly config: NotificationConfig;
  constructor(config: Partial<NotificationConfig> = {}) { this.config = { ...defaultNotificationConfig, ...config }; }
  restorePopup(memberId: string, at: number) { this.popped.set(memberId, [...(this.popped.get(memberId) ?? []), at]); }
  record(memberId: string, type: string, at: number) {
    const events = this.activities.get(memberId) ?? [];
    events.push({ at, type });
    this.activities.set(memberId, events.filter(event => at - event.at <= this.config.windowMs));
  }
  decide(memberId: string, at: number): "popup" | "deferred" | "limit" {
    const popped = (this.popped.get(memberId) ?? []).filter(time => at - time < 3_600_000);
    this.popped.set(memberId, popped);
    if (popped.length >= this.config.hourlyLimit) return "limit";
    const events = (this.activities.get(memberId) ?? []).filter(event => at - event.at <= this.config.windowMs);
    const lastAt = events.at(-1)?.at;
    if (lastAt !== undefined && at - lastAt < this.config.idleMs && (events.filter(event => event.type === "edit").length >= this.config.highEdits || events.length >= this.config.highActivity)) return "deferred";
    popped.push(at);
    return "popup";
  }
}
