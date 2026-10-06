export interface PairedObservation { relationGroupId: string; id: string; correct: boolean; value: number }

export function mcnemar(left: PairedObservation[], right: PairedObservation[]) {
  const rightById = new Map(right.map((row) => [row.id, row]));
  let leftOnlyCorrect = 0; let rightOnlyCorrect = 0;
  for (const row of left) {
    const other = rightById.get(row.id);
    if (!other || other.relationGroupId !== row.relationGroupId) throw new Error("配对样本不一致");
    if (row.correct && !other.correct) leftOnlyCorrect += 1;
    if (!row.correct && other.correct) rightOnlyCorrect += 1;
  }
  if (left.length !== right.length) throw new Error("配对样本数量不一致");
  const discordant = leftOnlyCorrect + rightOnlyCorrect;
  const tail = Math.min(leftOnlyCorrect, rightOnlyCorrect);
  let term = 2 ** -discordant; let probability = term;
  for (let k = 1; k <= tail; k += 1) { term *= (discordant - k + 1) / k; probability += term; }
  return { leftOnlyCorrect, rightOnlyCorrect, discordant, p: discordant ? Math.min(1, 2 * probability) : 1 };
}

export function holm(values: Array<{ id: string; p: number }>) {
  if (values.some((value) => !Number.isFinite(value.p) || value.p < 0 || value.p > 1)) throw new Error("概率无效");
  let previous = 0;
  const adjusted = new Map([...values].sort((a, b) => a.p - b.p || a.id.localeCompare(b.id)).map((value, index) => {
    previous = Math.max(previous, Math.min(1, value.p * (values.length - index)));
    return [value.id, previous] as const;
  }));
  return values.map((value) => ({ ...value, adjustedP: adjusted.get(value.id)! }));
}

export function bootstrapGroups(rows: PairedObservation[], statistic: (values: number[]) => number, seed: number, repetitions = 2000) {
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("bootstrap 重复次数无效");
  const groups = new Map<string, number[]>();
  for (const row of rows) { const group = groups.get(row.relationGroupId) ?? []; group.push(row.value); groups.set(row.relationGroupId, group); }
  const clusters = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([, values]) => values);
  if (!clusters.length) return { estimate: null, low: null, high: null, groups: 0, repetitions, seed };
  let state = seed >>> 0 || 1;
  const samples: number[] = [];
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    const values: number[] = [];
    for (let index = 0; index < clusters.length; index += 1) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; values.push(...clusters[state % clusters.length]!); }
    samples.push(statistic(values));
  }
  samples.sort((a, b) => a - b);
  return { estimate: statistic(rows.map((row) => row.value)), low: samples[Math.floor(repetitions * 0.025)]!, high: samples[Math.min(repetitions - 1, Math.floor(repetitions * 0.975))]!, groups: clusters.length, repetitions, seed };
}
