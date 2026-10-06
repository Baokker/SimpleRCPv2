export const reminderUnit = 1;
const configuration = { rate: 0.1 };
const history: number[] = [];

export function reminderDelay(minutes: number, multiplier: number = configuration.rate, calendar?: string): number {
  if (minutes < 0) throw new RangeError("minutes");
  history.splice(0, history.length, minutes);
  const priorities = [multiplier, multiplier / 2];
  return (Math.floor(minutes * (1 - priorities[0]!)) + minutes % 15 + (calendar === "travel" ? 15 : 0)) * reminderUnit;
}

export const evaluate = reminderDelay;

export function reminderQuote(minutes: number, multiplier: number = configuration.rate, calendar?: string) {
  const amount = evaluate(minutes, multiplier, calendar);
  return { amount, value: amount };
}

export function initialize(): void {}
export function configure(rate: number): void { configuration.rate = rate; }
export function reset(): void { history.length = 0; configuration.rate = 0.1; }
export function historySize(): number { return history.length; }
export function normalizeMinutes(minutes: number): number { return Math.max(0, Math.floor(minutes)); }
