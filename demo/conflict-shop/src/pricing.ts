import { Currency, type Money, type DiscountRule } from "./types.ts";

export function applyDiscount(price: number, rate: number): number {
  return price * (1 - rate);
}

export function formatMoney(amount: Money, currency: Currency = Currency.USD): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export class PriceRule implements DiscountRule {
  apply(price: Money): Money { return applyDiscount(price, 0.1); }
}

export class SeasonalRule extends PriceRule {
  apply(price: Money): Money { return applyDiscount(price, 0.2); }
}

export const defaultDiscount = applyDiscount;
