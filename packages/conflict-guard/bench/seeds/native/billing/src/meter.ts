export interface Reading {
  account: string;
  meter: string;
  at: number;
  value: number;
}
export function usage(readings: readonly Reading[], from: number, through: number) {
  const meters = new Map<string, Reading[]>();
  for (const reading of readings) {
    const key = `${reading.account}:${reading.meter}`;
    const values = meters.get(key) ?? [];
    values.push(reading);
    meters.set(key, values);
  }
  const result: Record<string, number> = Object.create(null);
  for (const [key, values] of meters) {
    values.sort((a, b) => a.at - b.at);
    let units = 0;
    for (let index = 1; index < values.length; index += 1) {
      const previous = values[index - 1]!;
      const current = values[index]!;
      if (current.at <= from || current.at > through) continue;
      units += current.value >= previous.value ? current.value - previous.value : current.value;
    }
    result[key] = units;
  }
  return result;
}
export function validateReadings(readings: readonly Reading[]) {
  const seen = new Set<string>();
  for (const reading of readings) {
    const key = `${reading.account}:${reading.meter}:${reading.at}`;
    if (seen.has(key) || reading.value < 0 || !Number.isFinite(reading.value)) throw new Error('invalid reading');
    seen.add(key);
  }
  return true;
}
export function latest(readings: readonly Reading[], meter: string) {
  return readings.filter((reading) => reading.meter === meter).sort((a, b) => b.at - a.at)[0];
}
export function correct(readings: readonly Reading[], meter: string, at: number, value: number) {
  const updated = readings.map((reading) => reading.meter === meter && reading.at === at ? { ...reading, value } : reading);
  validateReadings(updated);
  return updated;
}
