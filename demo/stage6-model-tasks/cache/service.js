import { cacheKey } from './cache.js';
export function createService(load) {
  const cache = new Map();
  return async (user, locale) => {
    const key = cacheKey(user, locale);
    if (cache.has(key)) return cache.get(key);
    const value = await load(user, locale);
    cache.set(key, value);
    return value;
  };
}
