import * as metering from "./metering.ts";

export function subscriptionCharge(units: number): number {
  metering.initialize();
  return metering.evaluate(units, 0.1, "monthly") / metering.chargeUnit;
}

export function subscriptionQuote(units: number): number {
  return metering.usageQuote(units, 0.1, "monthly").amount / metering.chargeUnit;
}

export function subscriptionLabel(account: string, units: number): string {
  return `${account}:${metering.normalizeUnits(units)} units`;
}
