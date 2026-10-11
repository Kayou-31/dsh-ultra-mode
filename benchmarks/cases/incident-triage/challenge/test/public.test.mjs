import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../src/service.mjs';
import { runWithRetry } from '../src/retry.mjs';

test('normal single-tenant successful requests', async () => {
  const gateway = createGateway();
  assert.equal((await gateway.request({ tenantId: 'demo', atMs: 100, requestId: 'r1' })).status, 200);
  assert.equal((await gateway.request({ tenantId: 'demo', atMs: 110, requestId: 'r2' })).status, 200);
  assert.deepEqual(gateway.metrics(), { gatewayAttempts: 2, dbSessionReads: 2, accepted: 2, rejected: 0 });
});

test('transient upstream 503 retry remains supported', async () => {
  const response = await runWithRetry(async ({ attempt }) => ({ status: attempt === 1 ? 503 : 200 }));
  assert.equal(response.status, 200); assert.equal(response.attempts, 2);
  assert.deepEqual(response.retryStatuses, [503]);
});
