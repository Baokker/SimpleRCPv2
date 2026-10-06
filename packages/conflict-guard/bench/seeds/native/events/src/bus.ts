export interface Envelope<T = unknown> {
  sequence: number;
  topic: string;
  payload: T;
  correlation?: string;
}
export type Listener = (event: Envelope) => void;

export class EventBus {
  private listeners: Record<string, Map<number, Listener>> = Object.create(null);
  private nextListener = 0;
  private sequence = 0;
  private publishing = false;
  private queued: Envelope[] = [];
  readonly errors: Array<{ sequence: number; error: unknown }> = [];

  subscribe(topic: string, listener: Listener) {
    const group = this.listeners[topic] ??= new Map();
    const id = ++this.nextListener;
    group.set(id, listener);
    return () => {
      group.delete(id);
      if (!group.size) delete this.listeners[topic];
    };
  }

  once(topic: string, listener: Listener) {
    const unsubscribe = this.subscribe(topic, (event) => {
      unsubscribe();
      listener(event);
    });
    return unsubscribe;
  }

  publish<T>(topic: string, payload: T, correlation?: string) {
    const event: Envelope<T> = { sequence: ++this.sequence, topic, payload, correlation };
    this.queued.push(event);
    if (this.publishing) return event.sequence;
    this.publishing = true;
    try {
      while (this.queued.length) {
        const current = this.queued.shift()!;
        const handlers = [...(this.listeners[current.topic]?.values() ?? []), ...(this.listeners['*']?.values() ?? [])];
        for (const handler of handlers) {
          try {
            handler(current);
          } catch (error) {
            this.errors.push({ sequence: current.sequence, error });
          }
        }
      }
    } finally {
      this.publishing = false;
    }
    return event.sequence;
  }

  listenerCount(topic: string) {
    return this.listeners[topic]?.size ?? 0;
  }

  clear() {
    this.listeners = Object.create(null);
    this.queued.length = 0;
  }
}
