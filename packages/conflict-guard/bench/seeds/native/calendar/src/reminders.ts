import type { Booking } from "./calendar.ts";

export interface Reminder {
  key: string;
  recipient: string;
  due: number;
  booking: string;
  delivered: boolean;
}

export class ReminderQueue {
  private pending: Reminder[] = [];
  private completed = new Set<string>();

  schedule(booking: Booking, day: number, leadMinutes: number) {
    if (leadMinutes < 0) throw new RangeError("lead minutes");
    const due = day * 1440 + booking.interval[0] - leadMinutes;
    for (const recipient of new Set([booking.owner, ...booking.attendees])) {
      const key = `${booking.id}:${booking.version}:${recipient}`;
      if (this.completed.has(key) || this.pending.some((entry) => entry.key === key)) continue;
      this.pending.push({ key, recipient, due, booking: booking.id, delivered: false });
    }
    this.pending.sort((a, b) => a.due - b.due || a.key.localeCompare(b.key));
  }

  takeDue(now: number, limit = 20) {
    const due = this.pending.filter((entry) => entry.due <= now).slice(0, limit);
    const keys = new Set(due.map((entry) => entry.key));
    this.pending = this.pending.filter((entry) => !keys.has(entry.key));
    return due;
  }

  acknowledge(reminder: Reminder) {
    this.completed.add(reminder.key);
  }

  retry(reminder: Reminder, due: number) {
    if (this.completed.has(reminder.key)) return;
    this.pending.push({ ...reminder, due });
    this.pending.sort((a, b) => a.due - b.due);
  }

  removeBooking(id: string) {
    this.pending = this.pending.filter((entry) => entry.booking !== id);
  }

  count() {
    return this.pending.length;
  }
}
