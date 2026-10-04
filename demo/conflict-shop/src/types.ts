export interface CartItem {
  title: string;
  price: number;
  quantity: number;
}

export type Money = number;

export enum Currency { USD = "USD", CNY = "CNY" }

export interface DiscountRule { apply(price: Money): Money; }
