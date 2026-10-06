export function createAgentSessionOperations() {
  const pending = new Map<string, Promise<void>>();
  return {
    async run<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
      const previous = pending.get(sessionKey) ?? Promise.resolve();
      const current = previous.then(operation);
      const completion = current.then(() => undefined, () => undefined);
      pending.set(sessionKey, completion);
      try {
        return await current;
      } finally {
        if (pending.get(sessionKey) === completion) pending.delete(sessionKey);
      }
    }
  };
}
