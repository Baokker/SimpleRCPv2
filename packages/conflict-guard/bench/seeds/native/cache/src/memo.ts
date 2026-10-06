export function memoize<K, V>(compute: (key: K) => V, maximum = 100) {
  const values = new Map<K, V>();
  const call = (key: K): V => {
    if (values.has(key)) return values.get(key)!;
    const value = compute(key);
    values.set(key, value);
    if (values.size > maximum) values.delete(values.keys().next().value!);
    return value;
  };
  return Object.assign(call, {
    clear: () => values.clear(),
    forget: (key: K) => values.delete(key),
    size: () => values.size
  });
}
export function singleFlight<K, V>(compute: (key: K) => Promise<V>) {
  const pending = new Map<K, Promise<V>>();
  return (key: K): Promise<V> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve().then(() => compute(key));
    pending.set(key, request);
    const finish = () => {
      if (pending.get(key) === request) pending.delete(key);
    };
    void request.then(finish, finish);
    return request;
  };
}
export function boundedMemo<K, V>(compute: (key: K) => V, accept: (value: V) => boolean) {
  const values = new Map<K, V>();
  return {
    get(key: K) {
      const stored = values.get(key);
      if (stored !== undefined) return stored;
      const result = compute(key);
      if (accept(result)) values.set(key, result);
      return result;
    },
    invalidate(keys: Iterable<K>) {
      for (const key of keys) values.delete(key);
    },
    entries: () => [...values.entries()]
  };
}
