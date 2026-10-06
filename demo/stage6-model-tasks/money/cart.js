import { cents } from './money.js';
export function total(items) { return items.reduce((sum, item) => sum + cents(item.price), 0); }
