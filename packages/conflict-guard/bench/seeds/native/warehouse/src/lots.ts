export interface Lot {
  id: string;
  sku: string;
  bin: string;
  received: number;
  expires: number;
  quantity: number;
  reserved: number;
}
export type Inventory = ReadonlyMap<string, Lot>;
export function receive(inventory: Inventory, lot: Lot) {
  if (inventory.has(lot.id) || lot.quantity < 1 || lot.reserved !== 0) throw new Error('invalid receipt');
  const next = new Map(inventory);
  next.set(lot.id, { ...lot });
  return next;
}
export function available(inventory: Inventory, sku: string, now: number) {
  return [...inventory.values()].filter((lot) => lot.sku === sku && lot.expires > now)
    .reduce((quantity, lot) => quantity + lot.quantity - lot.reserved, 0);
}
export function reserve(inventory: Inventory, sku: string, quantity: number, now: number) {
  if (quantity < 1 || available(inventory, sku, now) < quantity) throw new Error('insufficient stock');
  const next = new Map(inventory);
  const allocation: Array<{ lot: string; quantity: number }> = [];
  let required = quantity;
  const candidates = [...inventory.values()].filter((lot) => lot.sku === sku && lot.expires > now)
    .sort((a, b) => a.expires - b.expires || a.received - b.received);
  for (const lot of candidates) {
    const taken = Math.min(required, lot.quantity - lot.reserved);
    if (!taken) continue;
    next.set(lot.id, { ...lot, reserved: lot.reserved + taken });
    allocation.push({ lot: lot.id, quantity: taken });
    required -= taken;
    if (!required) break;
  }
  return { inventory: next, allocation };
}
export function release(inventory: Inventory, allocation: Array<{ lot: string; quantity: number }>) {
  const next = new Map(inventory);
  for (const item of allocation) {
    const lot = next.get(item.lot);
    if (!lot || lot.reserved < item.quantity) throw new Error('invalid allocation');
    next.set(item.lot, { ...lot, reserved: lot.reserved - item.quantity });
  }
  return next;
}
export function consume(inventory: Inventory, allocation: Array<{ lot: string; quantity: number }>) {
  const next = release(inventory, allocation);
  for (const item of allocation) {
    const lot = next.get(item.lot)!;
    next.set(lot.id, { ...lot, quantity: lot.quantity - item.quantity });
  }
  return next;
}
export function quarantine(inventory: Inventory, lotId: string) {
  const lot = inventory.get(lotId);
  if (!lot || lot.reserved) throw new Error('reserved stock cannot be quarantined');
  const next = new Map(inventory);
  next.set(lotId, { ...lot, expires: -Infinity });
  return next;
}
export function bins(inventory: Inventory) {
  const result = new Map<string, number>();
  for (const lot of inventory.values()) result.set(lot.bin, (result.get(lot.bin) ?? 0) + lot.quantity);
  return result;
}
