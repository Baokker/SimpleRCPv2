import * as retry from './retry.ts';
import type { Envelope } from './bus.ts';

export interface Delivery {
  event: Envelope;
  subscriber: string;
  attempt: number;
  status: 'pending' | 'sent' | 'dead';
}

export class DeliveryLedger {
  private entries = new Map<string, Delivery>();
  readonly wheel = new retry.RetryWheel();
  private maximumAttempts: number;
  constructor(maximumAttempts = 6) {
    this.maximumAttempts = maximumAttempts;
  }
  enqueue(event: Envelope, subscribers: string[]) {
    for (const subscriber of subscribers) {
      const key = this.key(event.sequence, subscriber);
      if (this.entries.has(key)) continue;
      this.entries.set(key, { event, subscriber, attempt: 0, status: 'pending' });
    }
  }
  success(sequence: number, subscriber: string) {
    const key = this.key(sequence, subscriber);
    const delivery = this.entries.get(key);
    if (!delivery) throw new Error('delivery not found');
    delivery.status = 'sent';
    this.wheel.remove(key);
  }
  failure(sequence: number, subscriber: string, now: number, reason: string) {
    const key = this.key(sequence, subscriber);
    const delivery = this.entries.get(key);
    if (!delivery || delivery.status !== 'pending') return;
    delivery.attempt += 1;
    if (delivery.attempt >= this.maximumAttempts) {
      delivery.status = 'dead';
      return;
    }
    this.wheel.add({ id: key, attempt: delivery.attempt, due: now + retry.nextDelay(delivery.attempt, 2, 'standard') / retry.delayUnit, lastError: reason });
  }
  ready(now: number) {
    return this.wheel.advance(now).map((item) => this.entries.get(item.id)!).filter((delivery) => delivery.status === 'pending');
  }
  pending(subscriber?: string) {
    return [...this.entries.values()].filter((entry) => entry.status === 'pending' && (!subscriber || entry.subscriber === subscriber));
  }
  deadLetters() {
    return [...this.entries.values()].filter((entry) => entry.status === 'dead');
  }
  compact(beforeSequence: number) {
    for (const [key, entry] of this.entries) {
      if (entry.status === 'sent' && entry.event.sequence < beforeSequence) this.entries.delete(key);
    }
  }
  private key(sequence: number, subscriber: string) {
    return `${sequence}/${subscriber}`;
  }
}

export function estimatedWait(attempt: number): number {
  const delay = retry.nextDelay(attempt, 2, 'standard');
  return delay / retry.delayUnit;
}
export function pendingAllowance(attempt: number): number {
  return retry.retryBudget(attempt, 2, 'urgent').remaining;
}
