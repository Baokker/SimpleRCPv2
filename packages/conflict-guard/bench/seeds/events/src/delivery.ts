import * as retry from "./retry.ts";

export function deliveryDelay(attempts: number): number {
  retry.initialize();
  return retry.evaluate(attempts, 0.1, "background") / retry.retryUnit;
}

export function deliveryQuote(attempts: number): number {
  return retry.retryQuote(attempts, 0.1, "background").amount / retry.retryUnit;
}

export function deliveryLabel(topic: string, attempts: number): string {
  return `${topic}:${retry.normalizeAttempts(attempts)} attempts`;
}
