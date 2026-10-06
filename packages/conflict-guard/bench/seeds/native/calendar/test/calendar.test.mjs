import { test } from 'node:test';
import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { union, subtract, overlap } from '../src/intervals.ts';
import { Calendar } from '../src/calendar.ts';
import { occurrences, shift, splitRecurrence } from '../src/recurrence.ts';
import { slots } from '../src/availability.ts';
import { ReminderQueue } from '../src/reminders.ts';

test('adjacent intervals and resource booking lifecycle', () => {
  deepStrictEqual(union([[5, 10], [1, 5], [14, 20]]), [[1, 10], [14, 20]]);
  deepStrictEqual(subtract([0, 30], [[5, 10], [15, 40]]), [[0, 5], [10, 15]]);
  strictEqual(overlap([0, 10], [10, 20]), false);
  const room = { id: 'r', capacity: 4, opening: [[0, 480]], closures: [[200, 220]] };
  const calendar = new Calendar(new Map([['r', room]]));
  const first = calendar.reserve('r', 'a', [30, 60], ['b']);
  throws(() => calendar.reserve('r', 'c', [45, 80]));
  const moved = calendar.move(first.id, [90, 120], first.version);
  strictEqual(moved.id, first.id);
  strictEqual(calendar.forPerson('b').length, 1);
  const queue = new ReminderQueue();
  queue.schedule(moved, 1, 15);
  strictEqual(queue.takeDue(1440 + 100).length, 2);
  strictEqual(calendar.cancel(first.id, 'a'), true);
  strictEqual(slots(room, [], 30).every(([start, end]) => end <= 200 || start >= 220), true);
});

test('recurrence retains weekday identity after shifts', () => {
  const rule = { startDay: 0, endDay: 14, weekdays: [1, 3], minute: 90, length: 30, exceptions: [3] };
  deepStrictEqual(occurrences(rule).map((entry) => entry.day), [1, 8, 10]);
  strictEqual(occurrences(shift(rule, 2)).length, 3);
  strictEqual(splitRecurrence(rule, 8).after.startDay, 8);
});
