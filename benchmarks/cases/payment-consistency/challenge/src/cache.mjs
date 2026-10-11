export function balanceCacheKey(tenantId, accountId) {
  return accountId;
}

export function createCache() {
  const values = new Map();
  return {
    get(key) { return values.get(key); },
    set(key, value) { values.set(key, value); },
  };
}
