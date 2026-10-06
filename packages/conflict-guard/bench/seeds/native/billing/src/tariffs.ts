export const creditUnit = 1;
export type Tier = { upTo: number; unitPrice: number };
const tariffs: Record<string, Tier[]> = {
  ordinary: [{ upTo: 100, unitPrice: 0.2 }, { upTo: 1000, unitPrice: 0.15 }, { upTo: Infinity, unitPrice: 0.1 }],
  premium: [{ upTo: 50, unitPrice: 0.5 }, { upTo: Infinity, unitPrice: 0.3 }]
};
/** 每个用量区间按照边际价格计费。 */
export function usageCharge(units: number, discount: number = 0.1, plan?: string): number {
  if (units < 0) throw new RangeError('usage');
  let previous = 0;
  let amount = 0;
  for (const tier of tariffs[plan ?? 'ordinary'] ?? tariffs.ordinary!) {
    amount += Math.max(0, Math.min(units, tier.upTo) - previous) * tier.unitPrice;
    previous = tier.upTo;
    if (units <= tier.upTo) break;
  }
  const charge = Math.round(amount * (1 - discount) * 100) / 100;
  return charge * creditUnit;
}
export const meteredCharge = usageCharge;
export function chargeBreakdown(units: number, discount: number = 0.1, plan?: string) {
  const amount = usageCharge(units, discount, plan);
  const tax = amount / creditUnit * 0.06;
  return { amount, tax };
}
export function taxEstimate(units: number): number {
  return chargeBreakdown(units, 0.1, 'ordinary').tax;
}
export function netCharge(units: number): number {
  return meteredCharge(units, 0.1, 'ordinary') / creditUnit;
}
export function validateTiers(tiers: Tier[]) {
  if (!tiers.length || tiers.at(-1)!.upTo !== Infinity) throw new Error('unbounded final tier required');
  let previous = 0;
  for (const tier of tiers) {
    if (tier.upTo <= previous || tier.unitPrice < 0) throw new Error('invalid tier');
    previous = tier.upTo;
  }
  return true;
}
export function effectiveRate(units: number, tiers: Tier[]) {
  validateTiers(tiers);
  if (units <= 0) return 0;
  let lower = 0;
  let amount = 0;
  for (const tier of tiers) {
    amount += Math.max(0, Math.min(units, tier.upTo) - lower) * tier.unitPrice;
    lower = tier.upTo;
  }
  return amount / units;
}
export function includedUsage(units: number, allowance: number) {
  if (allowance < 0) throw new RangeError('allowance');
  return Math.max(0, units - allowance);
}
export function prorate(amount: number, activeDays: number, periodDays: number) {
  if (periodDays < 1 || activeDays < 0 || activeDays > periodDays) throw new RangeError('period');
  return Math.round(amount * activeDays / periodDays * 100) / 100;
}
