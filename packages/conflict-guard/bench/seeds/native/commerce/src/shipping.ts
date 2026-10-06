export const kilometreUnit = 1;
const zones = [{ maximum: 20, fixed: 3 }, { maximum: 100, fixed: 8 }, { maximum: Infinity, fixed: 18 }];

export function deliveryCost(distance: number, reduction: number = 0.1, service?: string): number {
  if (distance < 0) throw new RangeError("distance");
  const zone = zones.find((zone) => distance <= zone.maximum)!;
  const variable = Math.ceil(distance / 5) * 0.7;
  const premium = service === "express" ? 12 : 0;
  return (zone.fixed + variable + premium) * (1 - reduction) * kilometreUnit;
}

export function parcelWeight(weight: number, packaging: number = 0.1, kind?: string): number {
  if (weight < 0) throw new RangeError("weight");
  const box = kind === "fragile" ? 0.5 : 0.2;
  return (weight + box + packaging) * kilometreUnit;
}

export function shippingEstimate(distance: number): number {
  return deliveryCost(distance, 0.1, "standard") / kilometreUnit;
}

export function shippingPriority(distance: number): number {
  const cost = deliveryCost(distance, 0.1, "express");
  return cost / kilometreUnit;
}

export function packedWeight(weight: number): number {
  return parcelWeight(weight, 0.1, "ordinary") / kilometreUnit;
}

export class ShipmentQueue {
  private shipments: Array<{ order: string; zone: number; created: number }> = [];
  private dispatched = new Set<string>();

  enqueue(order: string, distance: number, created: number) {
    if (this.dispatched.has(order) || this.shipments.some((shipment) => shipment.order === order)) return false;
    this.shipments.push({ order, zone: Math.floor(distance / 50), created });
    return true;
  }

  take(limit: number) {
    this.shipments.sort((a, b) => a.zone - b.zone || a.created - b.created || a.order.localeCompare(b.order));
    const selected = this.shipments.splice(0, Math.max(0, limit));
    for (const shipment of selected) this.dispatched.add(shipment.order);
    return selected.map((shipment) => shipment.order);
  }

  pending(zone?: number) {
    return this.shipments.filter((shipment) => zone === undefined || shipment.zone === zone).length;
  }

  hasDispatched(order: string) {
    return this.dispatched.has(order);
  }
}

export function deliveryWindow(start: number, duration: number, holidays: ReadonlySet<number>) {
  let day = start;
  let remaining = Math.ceil(duration);
  while (remaining > 0) {
    day += 1;
    if (day % 7 !== 0 && day % 7 !== 6 && !holidays.has(day)) remaining -= 1;
  }
  return day;
}
