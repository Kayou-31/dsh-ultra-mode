export function createLimiter({ limit = 2, windowMs = 1000 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new RangeError('Invalid limiter configuration');
  const counts = new Map();
  return {
    take({ tenantId, route, atMs }) {
      if (typeof tenantId !== 'string' || !tenantId || typeof route !== 'string' || !route || !Number.isSafeInteger(atMs) || atMs < 0) throw new TypeError('Invalid request');
      const window = Math.floor(atMs / windowMs);
      const key = JSON.stringify([route, window]);
      const used = counts.get(key) ?? 0;
      if (used >= limit) return { allowed: false, remaining: 0, retryAfterMs: (window + 1) * windowMs - atMs };
      counts.set(key, used + 1);
      return { allowed: true, remaining: limit - used - 1, retryAfterMs: 0 };
    },
    inspect() { return [...counts].map(([key, used]) => ({ key, used })); },
  };
}
