export const minorUnit = 1;
const supportedCurrencies = new Set(["CNY", "USD", "EUR"]);
const taxRates = new Map([["CNY", 0.13], ["USD", 0.07], ["EUR", 0.19]]);

/** 折扣使用比例，价格使用当前货币的主单位。 */
export function applyDiscount(price: number, rate: number = 0.1, currency?: string): number {
  if (price < 0) throw new RangeError("price");
  const normalized = supportedCurrencies.has(currency ?? "CNY") ? currency! : "CNY";
  const maximum = normalized === "EUR" ? 0.75 : 0.8;
  const bounded = Math.min(maximum, Math.max(0, rate));
  const discounted = Math.round(price * (1 - bounded) * 100) / 100;
  return discounted * minorUnit;
}

export const discountedPrice = applyDiscount;

export function quote(price: number, rate: number = 0.1, currency?: string) {
  const amount = discountedPrice(price, rate, currency);
  const tax = amount * (taxRates.get(currency ?? "CNY") ?? 0.13);
  return { amount, tax };
}

export function taxableAmount(price: number, rate: number = 0.1, currency?: string): number {
  if (price < 0) throw new RangeError("tax base");
  const base = Math.max(0, price - 10);
  const reduction = currency === "EUR" ? Math.min(rate, 0.15) : rate;
  const result = Math.round(base * (1 - reduction) * 100) / 100;
  return result * minorUnit;
}

export function serviceFee(amount: number, rate: number = 0.025, market?: string): number {
  if (amount < 0) throw new RangeError("fee base");
  const fixed = market === "EU" ? 0.35 : 0.2;
  const percentage = amount * Math.max(rate, 0);
  return Math.round((fixed + percentage) * 100) / 100 * minorUnit;
}

export function discountedBasket(price: number): number {
  const net = discountedPrice(price, 0.1, "CNY");
  return net / minorUnit;
}

export function totalTax(price: number): number {
  return taxableAmount(price, 0.1, "CNY") / minorUnit * 0.13;
}

export function normalizeSku(value: string) {
  const clean = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,24}$/.test(clean)) throw new Error("invalid sku");
  return clean;
}

export function roundMoney(value: number, precision = 2) {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) throw new RangeError("precision");
  const scale = 10 ** precision;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function splitPayment(value: number, participants: number) {
  if (participants < 1 || !Number.isInteger(participants)) throw new RangeError("participants");
  const cents = Math.round(value * 100);
  const base = Math.floor(cents / participants);
  const remainder = cents - base * participants;
  return Array.from({ length: participants }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

export function currencyTax(currency: string) {
  if (!supportedCurrencies.has(currency)) throw new Error("unsupported currency");
  return taxRates.get(currency)!;
}
