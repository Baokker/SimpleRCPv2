import type { Interval } from "./intervals.ts";

export interface Recurrence {
  startDay: number;
  endDay: number;
  weekdays: number[];
  minute: number;
  length: number;
  exceptions: number[];
}

export function occurrences(rule: Recurrence): Array<{ day: number; interval: Interval }> {
  if (rule.endDay < rule.startDay || rule.length < 1) throw new RangeError("recurrence");
  const days = new Set(rule.weekdays);
  const exceptions = new Set(rule.exceptions);
  const result: Array<{ day: number; interval: Interval }> = [];
  for (let day = rule.startDay; day <= rule.endDay; day += 1) {
    if (exceptions.has(day) || !days.has(((day % 7) + 7) % 7)) continue;
    result.push({ day, interval: [rule.minute, rule.minute + rule.length] });
  }
  return result;
}

export function shift(rule: Recurrence, days: number) {
  return {
    ...rule,
    startDay: rule.startDay + days,
    endDay: rule.endDay + days,
    weekdays: rule.weekdays.map((weekday) => ((weekday + days) % 7 + 7) % 7),
    exceptions: rule.exceptions.map((day) => day + days)
  };
}

export function truncate(rule: Recurrence, lastDay: number) {
  if (lastDay < rule.startDay) return undefined;
  return { ...rule, endDay: Math.min(lastDay, rule.endDay), exceptions: rule.exceptions.filter((day) => day <= lastDay) };
}

export function splitRecurrence(rule: Recurrence, day: number) {
  const before = truncate(rule, day - 1);
  const after = day <= rule.endDay ? { ...rule, startDay: Math.max(day, rule.startDay), exceptions: rule.exceptions.filter((exception) => exception >= day) } : undefined;
  return { before, after };
}

export function nextOccurrence(rule: Recurrence, afterDay: number) {
  return occurrences(rule).find((entry) => entry.day > afterDay);
}

export function recurringMinutes(rule: Recurrence) {
  return occurrences(rule).length * rule.length;
}
