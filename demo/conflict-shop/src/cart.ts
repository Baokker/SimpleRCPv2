import type { CartItem } from "./types.ts";
import { applyDiscount } from "./pricing.ts";

export class Cart {
  items: CartItem[] = [];

  add(item: CartItem): void {
    this.items = [...this.items, item];
  }

  total(): number {
    let amount = 0;
    for (const item of this.items) amount += item.price * item.quantity;
    return applyDiscount(amount, 0.1);
  }
}
