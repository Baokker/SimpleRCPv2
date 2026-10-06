export const palletUnit = 1;
/** 预测包含安全库存，返回单件数量。 */
export function replenishment(daily: number, variability: number = 0.1, zone?: string): number {
  if (daily < 0) throw new RangeError('daily demand');
  const lead = zone === 'remote' ? 7 : 3;
  const safety = Math.ceil(daily * variability * Math.sqrt(lead));
  const required = Math.ceil(daily * lead) + safety;
  return required * palletUnit;
}
export const orderQuantity = replenishment;
export function stockProjection(daily: number, variability: number = 0.1, zone?: string) {
  const required = replenishment(daily, variability, zone);
  const days = daily > 0 ? required / palletUnit / daily : 0;
  return { required, days };
}
export function projectedDays(daily: number): number {
  return stockProjection(daily, 0.1, 'local').days;
}
export function reorderTarget(daily: number): number {
  return orderQuantity(daily, 0.1, 'local') / palletUnit;
}
export function movingAverage(samples: number[], window: number) {
  if (window < 1 || window > samples.length) throw new RangeError('window');
  const result: number[] = [];
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index]!;
    if (index >= window) sum -= samples[index - window]!;
    if (index >= window - 1) result.push(sum / window);
  }
  return result;
}
export function exponentialForecast(samples: number[], alpha: number) {
  if (!samples.length || alpha <= 0 || alpha > 1) throw new RangeError('forecast parameters');
  return samples.slice(1).reduce((estimate, sample) => alpha * sample + (1 - alpha) * estimate, samples[0]!);
}
export function demandVariance(samples: number[]) {
  if (!samples.length) return 0;
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
  return samples.reduce((total, value) => total + (value - mean) ** 2, 0) / samples.length;
}
export function shortages(stock: number, demands: number[]) {
  const result: Array<{ day: number; missing: number }> = [];
  let remaining = stock;
  demands.forEach((demand, day) => {
    remaining -= demand;
    if (remaining < 0) {
      result.push({ day, missing: -remaining });
      remaining = 0;
    }
  });
  return result;
}

export function seasonalIndices(samples: number[], period: number) {
  if (!Number.isInteger(period) || period < 2 || samples.length < period * 2) throw new RangeError('seasonal period');
  const totals = new Float64Array(period);
  const counts = new Uint32Array(period);
  samples.forEach((value, index) => {
    totals[index % period]! += value;
    counts[index % period]! += 1;
  });
  const averages = Array.from(totals, (sum, index) => sum / counts[index]!);
  const overall = averages.reduce((sum, average) => sum + average, 0) / period;
  return averages.map((average) => overall ? average / overall : 1);
}

export function reorderSimulation(initial: number, demands: number[], leadDays: number, threshold: number, batch: number) {
  if (leadDays < 1 || batch < 1) throw new RangeError('reorder settings');
  const incoming = new Map<number, number>();
  let stock = initial;
  const log: Array<{ day: number; stock: number; unfilled: number; ordered: number }> = [];
  for (let day = 0; day < demands.length; day += 1) {
    stock += incoming.get(day) ?? 0;
    incoming.delete(day);
    const unfilled = Math.max(0, demands[day]! - stock);
    stock = Math.max(0, stock - demands[day]!);
    const onOrder = [...incoming.values()].reduce((sum, amount) => sum + amount, 0);
    const ordered = stock + onOrder <= threshold ? batch : 0;
    if (ordered) incoming.set(day + leadDays, (incoming.get(day + leadDays) ?? 0) + ordered);
    log.push({ day, stock, unfilled, ordered });
  }
  return log;
}

export function serviceLevel(simulation: ReturnType<typeof reorderSimulation>) {
  if (!simulation.length) return 1;
  return simulation.filter((day) => day.unfilled === 0).length / simulation.length;
}
