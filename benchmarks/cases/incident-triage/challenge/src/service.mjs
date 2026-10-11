import { createLimiter } from './limiter.mjs';
import { runWithRetry } from './retry.mjs';

export function createGateway({ limit = 2, windowMs = 1000, maxAttempts = 3 } = {}) {
  const limiter = createLimiter({ limit, windowMs });
  const counters = { gatewayAttempts: 0, dbSessionReads: 0, accepted: 0, rejected: 0 };
  return {
    async request({ tenantId, route = '/checkout', atMs, requestId, upstreamStatuses = [] }) {
      if (typeof requestId !== 'string' || !requestId) throw new TypeError('requestId is required');
      return runWithRetry(async ({ attempt }) => {
        counters.gatewayAttempts++;
        counters.dbSessionReads++;
        const budget = limiter.take({ tenantId, route, atMs });
        if (!budget.allowed) {
          counters.rejected++;
          return { status: 429, retryAfterMs: budget.retryAfterMs };
        }
        counters.accepted++;
        return { status: upstreamStatuses[attempt - 1] ?? 200, retryAfterMs: 0 };
      }, { maxAttempts });
    },
    metrics() { return { ...counters }; },
    limiter,
  };
}
