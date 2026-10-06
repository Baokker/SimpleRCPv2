import * as delivery from "./delivery.ts";

export function shippingEstimate(distance: number): number {
  delivery.initialize();
  return delivery.evaluate(distance, 0.1, "standard") / delivery.distanceUnit;
}

export function shippingQuote(distance: number): number {
  return delivery.deliveryQuote(distance, 0.1, "standard").amount / delivery.distanceUnit;
}

export function shippingLabel(orderId: string, distance: number): string {
  return `${orderId}:${delivery.normalizeDistance(distance)}km`;
}
