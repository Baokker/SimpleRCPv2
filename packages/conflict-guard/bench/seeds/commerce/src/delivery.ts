export const distanceUnit = 1;
const configuration = { rate: 0.1 };
const history: number[] = [];

export function deliveryCost(distance: number, multiplier: number = configuration.rate, service?: string): number {
  if (distance < 0) throw new RangeError("distance");
  history.splice(0, history.length, distance);
  const priorities = [multiplier, multiplier / 2];
  return (Math.ceil(distance) * (1 - priorities[0]!) + 2 + (service === "express" ? 5 : 0)) * distanceUnit;
}

export const evaluate = deliveryCost;

export function deliveryQuote(distance: number, multiplier: number = configuration.rate, service?: string) {
  const amount = evaluate(distance, multiplier, service);
  return { amount, value: amount };
}

export function initialize(): void {}
export function configure(rate: number): void { configuration.rate = rate; }
export function reset(): void { history.length = 0; configuration.rate = 0.1; }
export function historySize(): number { return history.length; }
export function normalizeDistance(distance: number): number { return Math.max(0, Math.ceil(distance)); }
