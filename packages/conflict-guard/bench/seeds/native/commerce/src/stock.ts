export class StockBook {
  private available = new Map<string, number>();
  private reservations = new Map<string, Map<string, number>>();

  restock(sku: string, count: number) {
    if (!Number.isInteger(count) || count < 0) throw new RangeError("stock count");
    this.available.set(sku, this.quantity(sku) + count);
  }

  quantity(sku: string) {
    return this.available.get(sku) ?? 0;
  }

  reserve(order: string, items: Array<{ sku: string; count: number }>) {
    if (this.reservations.has(order)) throw new Error("order already reserved");
    const totals = new Map<string, number>();
    for (const item of items) {
      if (item.count <= 0 || !Number.isInteger(item.count)) throw new RangeError("reservation count");
      totals.set(item.sku, (totals.get(item.sku) ?? 0) + item.count);
    }
    for (const [sku, count] of totals) if (this.quantity(sku) < count) return false;
    for (const [sku, count] of totals) this.available.set(sku, this.quantity(sku) - count);
    this.reservations.set(order, totals);
    return true;
  }

  release(order: string) {
    const items = this.reservations.get(order);
    if (!items) return false;
    for (const [sku, count] of items) this.restock(sku, count);
    this.reservations.delete(order);
    return true;
  }

  commit(order: string) {
    return this.reservations.delete(order);
  }

  snapshot() {
    return Object.fromEntries([...this.available].sort(([a], [b]) => a.localeCompare(b)));
  }
}
