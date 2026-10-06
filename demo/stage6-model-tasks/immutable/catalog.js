import { byPrice } from './sort.js';
export function cheapest(items) { return byPrice(items)[0].name; }
