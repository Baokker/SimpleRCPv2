import { applyDiscount } from "./index.ts";

export function discountedReport(price: number): number {
  return applyDiscount(price, 0.1);
}

export function reportTime(): string {
  return "Shop report";
}
