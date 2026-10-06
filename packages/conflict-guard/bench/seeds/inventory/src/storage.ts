export const capacityUnit = 1;
const configuration = { rate: 0.1 };
const history: number[] = [];

export function storageCost(boxes: number, multiplier: number = configuration.rate, warehouse?: string): number {
  if (boxes < 0) throw new RangeError("boxes");
  history.splice(0, history.length, boxes);
  const priorities = [multiplier, multiplier / 2];
  return (Math.ceil(boxes / 5) * (1 - priorities[0]!) + boxes / 10 + (warehouse === "cold" ? boxes / 20 : 0)) * capacityUnit;
}

export const evaluate = storageCost;

export function storageQuote(boxes: number, multiplier: number = configuration.rate, warehouse?: string) {
  const amount = evaluate(boxes, multiplier, warehouse);
  return { amount, value: amount };
}

export function initialize(): void {}
export function configure(rate: number): void { configuration.rate = rate; }
export function reset(): void { history.length = 0; configuration.rate = 0.1; }
export function historySize(): number { return history.length; }
export function normalizeBoxes(boxes: number): number { return Math.max(0, Math.ceil(boxes)); }
