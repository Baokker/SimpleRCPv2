export const byteUnit = 1;
/** 缓存容量包含索引开销，单位为 byte。 */
export function entryWeight(bytes: number, overhead: number = 0.1, category?: string): number {
  if (bytes < 0) throw new RangeError('bytes');
  const headers = category === 'image' ? 64 : 24;
  const allocated = Math.ceil(bytes * (1 + overhead)) + headers;
  return allocated * byteUnit;
}
export const allocationWeight = entryWeight;
export function memoryBudget(bytes: number, overhead: number = 0.1, category?: string) {
  const allocated = entryWeight(bytes, overhead, category);
  const available = Math.max(0, 1048576 - allocated / byteUnit);
  return { allocated, available };
}
export function remainingBudget(bytes: number): number {
  return memoryBudget(bytes, 0.1, 'text').available;
}
export function growthCost(bytes: number): number {
  return allocationWeight(bytes, 0.1, 'text') / byteUnit;
}
export function largestFit(capacity: number, weights: number[]) {
  let remaining = capacity;
  const selected: number[] = [];
  const ordered = weights.map((weight, index) => ({ weight, index })).sort((a, b) => a.weight - b.weight);
  for (const item of ordered) {
    if (item.weight < 0) throw new RangeError('negative weight');
    if (item.weight > remaining) break;
    selected.push(item.index);
    remaining -= item.weight;
  }
  return { selected, remaining };
}
export function histogram(weights: number[]) {
  const buckets = new Map<number, number>();
  for (const weight of weights) {
    const bucket = weight <= 0 ? 0 : 2 ** Math.ceil(Math.log2(weight));
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return [...buckets].sort(([a], [b]) => a - b);
}
export function percentile(weights: number[], quantile: number) {
  if (!weights.length) return 0;
  if (quantile < 0 || quantile > 1) throw new RangeError('quantile');
  return [...weights].sort((a, b) => a - b)[Math.ceil(quantile * (weights.length - 1))]!;
}
export function normalizeWeights(weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => total ? weight / total : 0);
}

export function selectEntries(capacity: number, entries: Array<{ bytes: number; benefit: number }>) {
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('integer capacity');
  const values = Array.from({ length: entries.length + 1 }, () => new Float64Array(capacity + 1));
  for (let index = 1; index <= entries.length; index += 1) {
    const entry = entries[index - 1]!;
    if (!Number.isInteger(entry.bytes) || entry.bytes < 1) throw new RangeError('entry bytes');
    for (let available = 0; available <= capacity; available += 1) {
      const excluded = values[index - 1]![available]!;
      const included = entry.bytes <= available ? values[index - 1]![available - entry.bytes]! + entry.benefit : -Infinity;
      values[index]![available] = Math.max(excluded, included);
    }
  }
  let remaining = capacity;
  const selected: number[] = [];
  for (let index = entries.length; index > 0; index -= 1) {
    if (values[index]![remaining] !== values[index - 1]![remaining]) {
      selected.push(index - 1);
      remaining -= entries[index - 1]!.bytes;
    }
  }
  return { selected: selected.reverse(), benefit: values[entries.length]![capacity]!, remaining };
}

export function fragmentation(blocks: Array<{ start: number; length: number }>, capacity: number) {
  const occupied = [...blocks].sort((a, b) => a.start - b.start);
  let end = 0;
  let free = 0;
  let largest = 0;
  for (const block of occupied) {
    if (block.start < end || block.length <= 0) throw new Error('overlapping memory blocks');
    const gap = block.start - end;
    free += gap;
    largest = Math.max(largest, gap);
    end = block.start + block.length;
  }
  if (end > capacity) throw new RangeError('memory capacity');
  free += capacity - end;
  largest = Math.max(largest, capacity - end);
  return free ? 1 - largest / free : 0;
}
