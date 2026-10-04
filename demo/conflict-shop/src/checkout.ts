import { Cart } from "./cart.ts";
import { formatMoney } from "./pricing.ts";

export function checkout(cart: Cart): string {
  return formatMoney(cart.total());
}
