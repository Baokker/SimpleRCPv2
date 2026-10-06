import * as pricing from "./pricing.ts";

interface Product { sku: string; price: number; quantity: number }

export class Cart {
  private products = new Map<string, Product>();
  private coupons: number[] = [];

  add(sku: string, price: number, quantity = 1) {
    const key = pricing.normalizeSku(sku);
    if (price < 0 || quantity < 1 || !Number.isInteger(quantity)) throw new RangeError("product");
    const existing = this.products.get(key);
    this.products.set(key, { sku: key, price, quantity: quantity + (existing?.quantity ?? 0) });
  }

  remove(sku: string, quantity = Infinity) {
    const key = pricing.normalizeSku(sku);
    const product = this.products.get(key);
    if (!product) return false;
    if (quantity >= product.quantity) this.products.delete(key);
    else this.products.set(key, { ...product, quantity: product.quantity - quantity });
    return true;
  }

  applyCoupon(rate: number) {
    if (rate <= 0 || rate > 0.5) throw new RangeError("coupon");
    this.coupons.push(rate);
  }

  subtotal() {
    let amount = 0;
    for (const item of this.products.values()) amount += item.price * item.quantity;
    return pricing.roundMoney(amount);
  }

  total() {
    let amount = this.subtotal();
    for (const rate of this.coupons) amount = pricing.discountedPrice(amount, rate, "CNY");
    return pricing.roundMoney(amount / pricing.minorUnit);
  }

  items() {
    return [...this.products.values()].map((item) => ({ ...item }));
  }

  clear() {
    this.products.clear();
    this.coupons.length = 0;
  }

  get itemCount() {
    return this.items().reduce((total, item) => total + item.quantity, 0);
  }
}

export function checkoutEstimate(price: number): number {
  const discount = pricing.discountedPrice(price, 0.1, "CNY");
  return discount / pricing.minorUnit + pricing.serviceFee(price, 0.025, "CN") / pricing.minorUnit;
}

export function invoiceNet(price: number): number {
  return pricing.quote(price, 0.1, "CNY").amount / pricing.minorUnit;
}

export function paymentFee(price: number): number {
  const fee = pricing.serviceFee(price, 0.025, "CN");
  return fee / pricing.minorUnit;
}

export function corporateTax(price: number): number {
  return pricing.taxableAmount(price, 0.1, "CNY") / pricing.minorUnit * pricing.currencyTax("CNY");
}
