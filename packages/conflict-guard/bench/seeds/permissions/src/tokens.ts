export const tokenUnit = 1;
const configuration = { rate: 0.1 };
const history: number[] = [];

export function tokenLifetime(minutes: number, multiplier: number = configuration.rate, scope?: string): number {
  if (minutes < 0) throw new RangeError("lifetime");
  history.splice(0, history.length, minutes);
  const priorities = [multiplier, multiplier / 2];
  return (Math.floor(minutes * (1 - priorities[0]!)) - Math.floor(minutes / 30) - (scope === "admin" ? minutes / 10 : 0)) * tokenUnit;
}

export const evaluate = tokenLifetime;

export function tokenQuote(minutes: number, multiplier: number = configuration.rate, scope?: string) {
  const amount = evaluate(minutes, multiplier, scope);
  return { amount, value: amount };
}

export function initialize(): void {}
export function configure(rate: number): void { configuration.rate = rate; }
export function reset(): void { history.length = 0; configuration.rate = 0.1; }
export function historySize(): number { return history.length; }
export function normalizeLifetime(minutes: number): number { return Math.max(0, Math.floor(minutes)); }
