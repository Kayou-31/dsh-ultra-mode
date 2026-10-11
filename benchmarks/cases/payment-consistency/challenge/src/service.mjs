import { createCache, balanceCacheKey } from './cache.mjs';
import { createStore } from './store.mjs';
import { applyEvent } from './webhook.mjs';
export { createStore, createCache };

export function createPaymentService({ store = createStore(), cache = createCache() } = {}) {
  const getBalance = async (tenantId, accountId) => {
    const key = balanceCacheKey(tenantId, accountId);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = store.readBalance(tenantId, accountId);
    cache.set(key, value);
    return value;
  };
  return { store, cache, getBalance, process(event) { return applyEvent(event, { store, cache, getBalance }); } };
}
