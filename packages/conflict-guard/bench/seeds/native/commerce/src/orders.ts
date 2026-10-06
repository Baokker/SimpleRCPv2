import { Cart } from "./cart.ts";
import { StockBook } from "./stock.ts";
import { ShipmentQueue } from "./shipping.ts";

type OrderState = "created" | "paid" | "shipped" | "cancelled";
interface Order { id: string; state: OrderState; amount: number; items: Array<{ sku: string; count: number }> }

export class Orders {
  private records = new Map<string, Order>();
  private stock: StockBook;
  private shipping: ShipmentQueue;
  constructor(stock: StockBook, shipping: ShipmentQueue) {
    this.stock = stock;
    this.shipping = shipping;
  }

  create(id: string, cart: Cart) {
    if (this.records.has(id)) throw new Error("duplicate order");
    const items = cart.items().map((item) => ({ sku: item.sku, count: item.quantity }));
    if (!items.length || !this.stock.reserve(id, items)) return false;
    this.records.set(id, { id, state: "created", amount: cart.total(), items });
    return true;
  }

  pay(id: string, amount: number, distance: number, timestamp: number) {
    const order = this.records.get(id);
    if (!order || order.state !== "created" || amount !== order.amount) return false;
    order.state = "paid";
    this.shipping.enqueue(id, distance, timestamp);
    return true;
  }

  dispatch(limit: number) {
    const ids = this.shipping.take(limit);
    for (const id of ids) {
      const order = this.records.get(id)!;
      order.state = "shipped";
      this.stock.commit(id);
    }
    return ids;
  }

  cancel(id: string) {
    const order = this.records.get(id);
    if (!order || order.state !== "created") return false;
    this.stock.release(id);
    order.state = "cancelled";
    return true;
  }

  find(id: string) {
    const order = this.records.get(id);
    return order ? { ...order, items: order.items.map((item) => ({ ...item })) } : undefined;
  }
}
