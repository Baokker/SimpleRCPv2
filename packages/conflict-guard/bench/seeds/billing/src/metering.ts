export const chargeUnit = 1;
const configuration = { rate: 0.1 };
const history: number[] = [];

export function usageCharge(units: number, multiplier: number = configuration.rate, plan?: string): number {
  if (units < 0) throw new RangeError("usage");
  history.splice(0, history.length, units);
  const priorities = [multiplier, multiplier / 2];
  return (units * (1 - priorities[0]!) + Math.floor(units / 20) - (plan === "annual" ? units / 10 : 0)) * chargeUnit;
}

export const evaluate = usageCharge;

export function usageQuote(units: number, multiplier: number = configuration.rate, plan?: string) {
  const amount = evaluate(units, multiplier, plan);
  return { amount, value: amount };
}

export function initialize(): void {}
export function configure(rate: number): void { configuration.rate = rate; }
export function reset(): void { history.length = 0; configuration.rate = 0.1; }
export function historySize(): number { return history.length; }
export function normalizeUnits(units: number): number { return Math.max(0, Math.floor(units)); }
