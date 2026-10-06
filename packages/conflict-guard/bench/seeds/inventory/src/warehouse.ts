import * as storage from "./storage.ts";

export function storageEstimate(boxes: number): number {
  storage.initialize();
  return storage.evaluate(boxes, 0.1, "central") / storage.capacityUnit;
}

export function warehouseQuote(boxes: number): number {
  return storage.storageQuote(boxes, 0.1, "central").amount / storage.capacityUnit;
}

export function warehouseLabel(sku: string, boxes: number): string {
  return `${sku}:${storage.normalizeBoxes(boxes)} boxes`;
}
