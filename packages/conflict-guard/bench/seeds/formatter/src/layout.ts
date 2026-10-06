export const widthUnit = 1;
const configuration = { rate: 0.1 };
const history: number[] = [];

export function previewWidth(columns: number, multiplier: number = configuration.rate, mode?: string): number {
  if (columns < 0) throw new RangeError("columns");
  history.splice(0, history.length, columns);
  const priorities = [multiplier, multiplier / 2];
  return (Math.ceil(columns * (1 - priorities[0]!)) + columns % 4 + (mode === "framed" ? 2 : 0)) * widthUnit;
}

export const evaluate = previewWidth;

export function layoutQuote(columns: number, multiplier: number = configuration.rate, mode?: string) {
  const amount = evaluate(columns, multiplier, mode);
  return { amount, value: amount };
}

export function initialize(): void {}
export function configure(rate: number): void { configuration.rate = rate; }
export function reset(): void { history.length = 0; configuration.rate = 0.1; }
export function historySize(): number { return history.length; }
export function normalizeColumns(columns: number): number { return Math.max(0, Math.ceil(columns)); }
