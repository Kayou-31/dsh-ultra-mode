import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const evidenceIds = new Set(['gateway-requests', 'tenant-probes', 'pool-metrics', 'deployment']);
const causeCodes = new Set(['LIMITER_SCOPE', 'DATABASE_POOL', 'UPSTREAM_CAPACITY', 'CLIENT_RETRY', 'OTHER']);
const nodeCodes = new Set(['SHARED_BUDGET', 'HTTP_429', 'RETRY_429', 'EXTRA_DB_SESSION_READS', 'POOL_EXHAUSTION', 'UPSTREAM_503']);
const fixCodes = new Set(['TENANT_SCOPED_BUDGET', 'NO_RETRY_429', 'INCREASE_POOL', 'DISABLE_LIMITER', 'DISABLE_ALL_RETRIES']);
const keys = (value, expected) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'Object fields must match the published contract');
};
const words = (value) => assert.ok(typeof value === 'string' && value.trim().length > 0, 'Expected a nonempty string');
const list = (value, member) => {
  assert.ok(Array.isArray(value) && value.length > 0, 'Expected a nonempty array');
  value.forEach(member);
};
const evidence = value => list(value, id => assert.ok(evidenceIds.has(id), 'Unknown evidence ID'));
const replayShape = value => {
  keys(value, ['httpStatuses', 'gatewayAttempts', 'dbSessionReads']);
  assert.equal(value.httpStatuses.length, 4);
  value.httpStatuses.forEach(status => assert.ok(Number.isInteger(status) && status >= 100 && status <= 599));
  for (const name of ['gatewayAttempts', 'dbSessionReads']) assert.ok(Number.isSafeInteger(value[name]) && value[name] >= 0);
};
const diagnosisShape = d => {
  keys(d, ['schemaVersion', 'summary', 'rootCause', 'causalChain', 'rejectedHypotheses', 'beforeReplay', 'afterReplay', 'fixes', 'limitations']);
  assert.equal(d.schemaVersion, 1); words(d.summary);
  keys(d.rootCause, ['code', 'evidenceIds']); assert.ok(causeCodes.has(d.rootCause.code)); evidence(d.rootCause.evidenceIds);
  list(d.causalChain, code => assert.ok(nodeCodes.has(code)));
  list(d.rejectedHypotheses, h => { keys(h, ['code', 'evidenceIds', 'reason']); assert.ok(causeCodes.has(h.code)); evidence(h.evidenceIds); words(h.reason); });
  replayShape(d.beforeReplay); replayShape(d.afterReplay);
  list(d.fixes, code => assert.ok(fixCodes.has(code))); list(d.limitations, words);
};

export async function grade(candidateDir) {
  let serviceApi, limiterApi, retryApi, loadError, diagnosis, diagnosisError;
  const token = '?grade=' + crypto.randomUUID();
  try {
    serviceApi = await import(pathToFileURL(resolve(candidateDir, 'src/service.mjs')).href + token);
    limiterApi = await import(pathToFileURL(resolve(candidateDir, 'src/limiter.mjs')).href + token);
    retryApi = await import(pathToFileURL(resolve(candidateDir, 'src/retry.mjs')).href + token);
  } catch (error) { loadError = error; }
  try { diagnosis = JSON.parse(await readFile(resolve(candidateDir, 'outputs/diagnosis.json'), 'utf8')); }
  catch (error) { diagnosisError = error; }
  const checks = [], criticalFailures = [];
  const check = async (id, category, critical, action) => {
    try {
      await action();
      checks.push({ id, passed: true, category, message: 'Business assertion satisfied' });
    } catch (error) {
      checks.push({ id, passed: false, category, message: String(error?.message ?? error).slice(0, 1600) });
      if (critical) criticalFailures.push(id);
    }
  };
  const diagnosed = () => {
    if (diagnosisError) throw new Error('diagnosis.json could not load: ' + diagnosisError.message);
    diagnosisShape(diagnosis);
    return diagnosis;
  };
  const loaded = () => {
    if (loadError) throw new Error('Candidate module could not load: ' + loadError.message);
    assert.equal(typeof serviceApi.createGateway, 'function');
    assert.equal(typeof limiterApi.createLimiter, 'function');
    assert.equal(typeof retryApi.runWithRetry, 'function');
    assert.equal(typeof retryApi.shouldRetry, 'function');
  };
  const replay = async (tenants = ['red', 'red', 'blue', 'blue']) => {
    loaded();
    const gateway = serviceApi.createGateway({ limit: 2, windowMs: 1000, maxAttempts: 3 });
    const statuses = [];
    for (let i = 0; i < tenants.length; i++) {
      statuses.push((await gateway.request({ tenantId: tenants[i], route: '/checkout', atMs: 100 + i * 10, requestId: 'r' + (i + 1) })).status);
    }
    return { httpStatuses: statuses, gatewayAttempts: gateway.metrics().gatewayAttempts, dbSessionReads: gateway.metrics().dbSessionReads };
  };

  await check('typed-diagnosis-contract', 'diagnosis', true, async () => { diagnosed(); });
  await check('root-cause-not-coincident-deployment', 'root-cause', true, async () => {
    assert.equal(diagnosed().rootCause.code, 'LIMITER_SCOPE');
  });
  await check('root-cause-independent-evidence', 'evidence', false, async () => {
    const ids = diagnosed().rootCause.evidenceIds;
    assert.ok(ids.includes('tenant-probes') && ids.includes('gateway-requests'), 'Use both traffic observation and tenant controls');
  });
  await check('root-to-secondary-causal-order', 'secondary-effects', true, async () => {
    assert.deepEqual(diagnosed().causalChain, ['SHARED_BUDGET', 'HTTP_429', 'RETRY_429', 'EXTRA_DB_SESSION_READS']);
  });
  await check('connection-pool-false-lead-rejected', 'false-lead', false, async () => {
    const rejected = diagnosed().rejectedHypotheses.find(h => h.code === 'DATABASE_POOL');
    assert.ok(rejected, 'Must explicitly distinguish pool deployment from root cause');
    assert.ok(rejected.evidenceIds.includes('pool-metrics') && rejected.evidenceIds.includes('deployment'));
  });
  await check('frozen-before-replay-reported', 'reproduction', false, async () => {
    // Explicit frozen outcomes from the incident package, not values calculated by a duplicate implementation.
    assert.deepEqual(diagnosed().beforeReplay, { httpStatuses: [200, 200, 429, 429], gatewayAttempts: 8, dbSessionReads: 8 });
  });
  await check('after-replay-agrees-with-working-patch', 'reproduction', true, async () => {
    const actual = await replay();
    assert.deepEqual(actual, { httpStatuses: [200, 200, 200, 200], gatewayAttempts: 4, dbSessionReads: 4 });
    assert.deepEqual(diagnosed().afterReplay, actual);
  });
  await check('remediation-preserves-required-capabilities', 'diagnosis', false, async () => {
    assert.deepEqual([...diagnosed().fixes].sort(), ['NO_RETRY_429', 'TENANT_SCOPED_BUDGET']);
  });
  await check('mixed-tenants-reverse-order', 'tenant-isolation', true, async () => {
    assert.deepEqual(await replay(['blue', 'blue', 'red', 'red']), { httpStatuses: [200, 200, 200, 200], gatewayAttempts: 4, dbSessionReads: 4 });
  });
  await check('quota-still-enforced-per-tenant', 'required-capability', true, async () => {
    loaded(); const gateway = serviceApi.createGateway();
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await gateway.request({ tenantId: 'only', atMs: 10 + i, requestId: 'q' + i })).status);
    assert.deepEqual(statuses, [200, 200, 429]);
    assert.deepEqual(gateway.metrics(), { gatewayAttempts: 3, dbSessionReads: 3, accepted: 2, rejected: 1 });
  });
  await check('429-does-not-amplify-database-reads', 'secondary-effects', true, async () => {
    loaded(); let calls = 0;
    const result = await retryApi.runWithRetry(async () => { calls++; return { status: 429, retryAfterMs: 500 }; }, { maxAttempts: 5 });
    assert.equal(calls, 1); assert.equal(result.attempts, 1); assert.equal(result.status, 429); assert.deepEqual(result.retryStatuses, []);
    assert.equal(retryApi.shouldRetry({ status: 429, attempt: 1, maxAttempts: 5 }), false);
  });
  await check('new-window-recovers-budget', 'regression', false, async () => {
    loaded(); const limiter = limiterApi.createLimiter({ limit: 1, windowMs: 1000 });
    assert.equal(limiter.take({ tenantId: 'x', route: '/r', atMs: 0 }).allowed, true);
    assert.deepEqual(limiter.take({ tenantId: 'x', route: '/r', atMs: 999 }), { allowed: false, remaining: 0, retryAfterMs: 1 });
    assert.equal(limiter.take({ tenantId: 'x', route: '/r', atMs: 1000 }).allowed, true);
  });
  await check('routes-have-independent-budget', 'regression', false, async () => {
    loaded(); const limiter = limiterApi.createLimiter({ limit: 1 });
    assert.equal(limiter.take({ tenantId: 'x', route: '/r1', atMs: 1 }).allowed, true);
    assert.equal(limiter.take({ tenantId: 'x', route: '/r2', atMs: 1 }).allowed, true);
    assert.equal(limiter.take({ tenantId: 'x', route: '/r1', atMs: 2 }).allowed, false);
  });
  await check('upstream-transient-retry-retained', 'required-capability', true, async () => {
    loaded(); let calls = 0;
    const result = await retryApi.runWithRetry(async () => ({ status: ++calls === 1 ? 503 : 200 }));
    assert.equal(result.status, 200); assert.equal(result.attempts, 2); assert.equal(calls, 2); assert.deepEqual(result.retryStatuses, [503]);
  });
  await check('nontransient-and-attempt-ceiling', 'regression', false, async () => {
    loaded(); let calls = 0;
    const rejected = await retryApi.runWithRetry(async () => { calls++; return { status: 400 }; }, { maxAttempts: 3 });
    assert.equal(rejected.status, 400); assert.equal(calls, 1);
    calls = 0;
    const exhausted = await retryApi.runWithRetry(async () => { calls++; return { status: 502 }; }, { maxAttempts: 2 });
    assert.equal(exhausted.status, 502); assert.equal(exhausted.attempts, 2); assert.equal(calls, 2); assert.deepEqual(exhausted.retryStatuses, [502]);
  });
  await check('opaque-tenant-route-keys', 'tenant-isolation', false, async () => {
    loaded(); const limiter = limiterApi.createLimiter({ limit: 1 });
    for (const [tenantId, route] of [['a:b', 'c'], ['a', 'b:c'], ['店铺', '收银:入口'], ['另一店铺', '收银:入口']]) {
      assert.equal(limiter.take({ tenantId, route, atMs: 1 }).allowed, true);
      assert.equal(limiter.take({ tenantId, route, atMs: 2 }).allowed, false);
    }
  });
  await check('arbitrary-tenant-and-quota-matrix', 'tenant-isolation', true, async () => {
    loaded();
    for (const limit of [1, 3]) {
      const limiter = limiterApi.createLimiter({ limit, windowMs: 73 });
      for (const atMs of [0, 73]) {
        for (const tenantId of ['customer-17', 'customer-29', '顾客-3']) {
          for (let i = 0; i < limit; i++) assert.equal(limiter.take({ tenantId, route: '/purchase', atMs }).allowed, true);
          assert.equal(limiter.take({ tenantId, route: '/purchase', atMs }).allowed, false);
        }
      }
    }
  });
  return { caseId: 'incident-triage', passed: checks.filter(x => x.passed).length, total: checks.length, checks, criticalFailures,
    accepted: checks.every(x => x.passed) && criticalFailures.length === 0 };
}
