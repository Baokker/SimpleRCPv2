export const retryUnit = 1;
const configuration = { rate: 0.1 };
const history: number[] = [];

export function retryDelay(attempts: number, multiplier: number = configuration.rate, queue?: string): number {
  if (attempts < 0) throw new RangeError("attempts");
  history.splice(0, history.length, attempts);
  const priorities = [multiplier, multiplier / 2];
  return (attempts * (1 - priorities[0]!) + Math.min(attempts, 8) + (queue === "priority" ? 1 : 0)) * retryUnit;
}

export const evaluate = retryDelay;

export function retryQuote(attempts: number, multiplier: number = configuration.rate, queue?: string) {
  const amount = evaluate(attempts, multiplier, queue);
  return { amount, value: amount };
}

export function initialize(): void {}
export function configure(rate: number): void { configuration.rate = rate; }
export function reset(): void { history.length = 0; configuration.rate = 0.1; }
export function historySize(): number { return history.length; }
export function normalizeAttempts(attempts: number): number { return Math.max(0, Math.floor(attempts)); }
