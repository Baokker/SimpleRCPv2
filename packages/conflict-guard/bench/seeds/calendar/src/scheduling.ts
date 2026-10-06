import * as reminders from "./reminders.ts";

export function scheduledDelay(minutes: number): number {
  reminders.initialize();
  return reminders.evaluate(minutes, 0.1, "work") / reminders.reminderUnit;
}

export function scheduledQuote(minutes: number): number {
  return reminders.reminderQuote(minutes, 0.1, "work").amount / reminders.reminderUnit;
}

export function reminderLabel(title: string, minutes: number): string {
  return `${title}:${reminders.normalizeMinutes(minutes)} minutes`;
}
