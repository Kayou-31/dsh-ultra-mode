import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const initial = (tenantId, accountId, balanceCents) => ({ tenantId, accountId, balanceCents });
const event = (eventId, requestId, amountCents, kind = 'payment', tenantId = 'north', accountId = 'wallet') =>
  ({ tenantId, accountId, eventId, requestId, kind, amountCents });
const amount = (snapshot, tenantId, accountId) => snapshot.balances.find(x => x.tenantId === tenantId && x.accountId === accountId)?.balanceCents ?? 0;

// Frozen operation sequences and explicit business outcomes; never call the reference implementation as an oracle.
export async function grade(candidateDir) {
  let api, loadError;
  try {
    api = await import(pathToFileURL(resolve(candidateDir, 'src/service.mjs')).href + '?grade=' + crypto.randomUUID());
  } catch (error) { loadError = error; }
  const checks = [];
  const criticalFailures = [];
  const check = async (id, category, critical, action) => {
    try {
      if (loadError) throw new Error('Candidate entry could not load: ' + loadError.message);
      await action();
      checks.push({ id, passed: true, category, message: 'Business assertion satisfied' });
    } catch (error) {
      checks.push({ id, passed: false, category, message: String(error?.message ?? error).slice(0, 1600) });
      if (critical) criticalFailures.push(id);
    }
  };
  const setup = (rows = [initial('north', 'wallet', 1000)]) => {
    assert.equal(typeof api.createStore, 'function');
    assert.equal(typeof api.createPaymentService, 'function');
    assert.equal(typeof api.createCache, 'function');
    const store = api.createStore(rows);
    const cacheValues = new Map();
    const stats = { reads: 0, cacheGets: 0, cacheSets: 0 };
    const originalRead = store.readBalance.bind(store);
    store.readBalance = (...args) => { stats.reads++; return originalRead(...args); };
    const cache = {
      get(key) { stats.cacheGets++; return cacheValues.get(key); },
      set(key, value) { stats.cacheSets++; cacheValues.set(key, value); },
    };
    const service = api.createPaymentService({ store, cache });
    assert.equal(service.store, store, 'Must retain injected store');
    assert.equal(service.cache, cache, 'Must retain injected cache');
    return { service, store, stats };
  };

  await check('normal-payment', 'regression', true, async () => {
    const { service, store } = setup();
    assert.deepEqual(await service.process(event('p-1', 'http-1', 125)), { status: 'applied', balanceCents: 875 });
    assert.equal(await service.getBalance('north', 'wallet'), 875);
    const snap = store.snapshot();
    assert.equal(snap.ledger.length, 1); assert.equal(snap.eventCount, 1);
    assert.deepEqual(snap.ledger[0], { tenantId: 'north', accountId: 'wallet', eventId: 'p-1', kind: 'payment', amountCents: 125, balanceCents: 875 });
  });
  await check('normal-refund', 'regression', true, async () => {
    const { service, store } = setup();
    await service.process(event('p-1', 'h-1', 125));
    assert.deepEqual(await service.process(event('r-1', 'h-2', 40, 'refund')), { status: 'applied', balanceCents: 915 });
    assert.equal(await service.getBalance('north', 'wallet'), 915);
    assert.equal(store.snapshot().ledger.length, 2);
  });
  await check('cache-remains-effective', 'required-capability', true, async () => {
    const { service, stats } = setup();
    assert.equal(await service.getBalance('north', 'wallet'), 1000);
    assert.equal(await service.getBalance('north', 'wallet'), 1000);
    assert.equal(stats.reads, 1, 'Unchanged second read must use cache');
    assert.ok(stats.cacheGets >= 2 && stats.cacheSets >= 1, 'Injected cache must be used');
  });
  await check('stable-event-new-request-retry', 'idempotency', true, async () => {
    const { service, store } = setup();
    await service.process(event('sale', 'attempt-1', 125));
    assert.deepEqual(await service.process(event('sale', 'attempt-2', 125)), { status: 'duplicate', balanceCents: 875 });
    assert.equal(amount(store.snapshot(), 'north', 'wallet'), 875);
    assert.equal(store.snapshot().ledger.length, 1);
  });
  await check('distinct-events-reused-request-id', 'idempotency', false, async () => {
    const { service, store } = setup();
    await service.process(event('sale-a', 'connection-7', 100));
    assert.deepEqual(await service.process(event('sale-b', 'connection-7', 100)), { status: 'applied', balanceCents: 800 });
    assert.equal(store.snapshot().ledger.length, 2);
  });
  await check('tenant-visible-balance-isolation', 'tenant-isolation', true, async () => {
    const { service } = setup([initial('north', 'wallet', 1000), initial('south', 'wallet', 250)]);
    assert.equal(await service.getBalance('north', 'wallet'), 1000);
    assert.equal(await service.getBalance('south', 'wallet'), 250);
    assert.equal(await service.getBalance('north', 'wallet'), 1000);
  });
  await check('same-event-id-across-tenants', 'tenant-isolation', false, async () => {
    const { service, store } = setup([initial('north', 'wallet', 1000), initial('south', 'wallet', 250)]);
    await service.process(event('shared-event', 'same-http', 100));
    assert.deepEqual(await service.process(event('shared-event', 'same-http', 50, 'payment', 'south')), { status: 'applied', balanceCents: 200 });
    assert.equal(await service.getBalance('north', 'wallet'), 900);
    assert.equal(await service.getBalance('south', 'wallet'), 200);
    assert.equal(store.snapshot().ledger.length, 2);
  });
  await check('zero-balance-is-cacheable', 'required-capability', false, async () => {
    const { service, stats } = setup([initial('north', 'wallet', 0)]);
    assert.equal(await service.getBalance('north', 'wallet'), 0);
    assert.equal(await service.getBalance('north', 'wallet'), 0);
    assert.equal(stats.reads, 1);
  });
  await check('failed-commit-no-visible-phantom', 'atomicity', true, async () => {
    const { service, store } = setup();
    await service.getBalance('north', 'wallet');
    store.failNextCommit();
    await assert.rejects(service.process(event('fail', 'h-1', 100)), { code: 'COMMIT_FAILED' });
    assert.equal(await service.getBalance('north', 'wallet'), 1000);
    assert.equal(amount(store.snapshot(), 'north', 'wallet'), 1000);
    assert.equal(store.snapshot().ledger.length, 0); assert.equal(store.snapshot().eventCount, 0);
  });
  await check('failed-event-retry-then-redelivery', 'coupled-sequence', true, async () => {
    const { service, store } = setup();
    store.failNextCommit();
    await assert.rejects(service.process(event('pending', 'a-1', 150)), { code: 'COMMIT_FAILED' });
    assert.deepEqual(await service.process(event('pending', 'a-2', 150)), { status: 'applied', balanceCents: 850 });
    assert.deepEqual(await service.process(event('pending', 'a-3', 150)), { status: 'duplicate', balanceCents: 850 });
    assert.equal(store.snapshot().ledger.length, 1); assert.equal(store.snapshot().eventCount, 1);
  });
  await check('failure-does-not-poison-other-tenant', 'coupled-sequence', true, async () => {
    const { service, store } = setup([initial('north', 'wallet', 1000), initial('south', 'wallet', 250)]);
    await service.getBalance('north', 'wallet');
    store.failNextCommit();
    await assert.rejects(service.process(event('failed-north', 'a-1', 100)), { code: 'COMMIT_FAILED' });
    assert.equal(await service.getBalance('south', 'wallet'), 250);
    assert.equal(await service.getBalance('north', 'wallet'), 1000);
  });
  await check('refund-redelivery-once', 'idempotency', false, async () => {
    const { service, store } = setup();
    await service.process(event('r-1', 'delivery-1', 75, 'refund'));
    assert.deepEqual(await service.process(event('r-1', 'delivery-2', 75, 'refund')), { status: 'duplicate', balanceCents: 1075 });
    assert.equal(store.snapshot().ledger.length, 1);
  });
  await check('failed-refund-preserves-visible-balance', 'atomicity', false, async () => {
    const { service, store } = setup();
    store.failNextCommit();
    await assert.rejects(service.process(event('refund-fail', 'r-1', 75, 'refund')), { code: 'COMMIT_FAILED' });
    assert.equal(await service.getBalance('north', 'wallet'), 1000);
    assert.equal(store.snapshot().ledger.length, 0);
  });
  await check('conflicting-stable-event-rejected', 'idempotency', false, async () => {
    const { service, store } = setup();
    await service.process(event('immutable', 'r-1', 100));
    await assert.rejects(service.process(event('immutable', 'r-2', 200)), { code: 'EVENT_CONFLICT' });
    assert.equal(await service.getBalance('north', 'wallet'), 900);
    assert.equal(store.snapshot().ledger.length, 1);
  });
  await check('invalid-and-overdraft-rejected', 'regression', false, async () => {
    const { service, store } = setup();
    for (const value of [0, -1, 1.5, NaN]) {
      await assert.rejects(service.process(event('bad', 'x', value)), { code: 'INVALID_EVENT' });
    }
    await assert.rejects(service.process(event('too-large', 'x', 1001)), { code: 'INSUFFICIENT_FUNDS' });
    assert.equal(store.snapshot().ledger.length, 0); assert.equal(await service.getBalance('north', 'wallet'), 1000);
  });
  await check('opaque-keys-and-overflow', 'regression', false, async () => {
    const { service } = setup([initial('a:b', 'c', 19), initial('a', 'b:c', 37), initial('店铺', '用户:钱包', Number.MAX_SAFE_INTEGER)]);
    assert.equal(await service.getBalance('a:b', 'c'), 19);
    assert.equal(await service.getBalance('a', 'b:c'), 37);
    await assert.rejects(service.process(event('overflow', 'r', 1, 'refund', '店铺', '用户:钱包')), { code: 'INVALID_EVENT' });
    assert.equal(await service.getBalance('店铺', '用户:钱包'), Number.MAX_SAFE_INTEGER);
  });
  await check('combined-payment-refund-rollback-retry', 'coupled-sequence', true, async () => {
    const { service, store } = setup([initial('north', 'wallet', 800), initial('south', 'wallet', 250)]);
    assert.equal(await service.getBalance('north', 'wallet'), 800);
    store.failNextCommit();
    await assert.rejects(service.process(event('sale-a', 'a-1', 90)), { code: 'COMMIT_FAILED' });
    assert.equal(await service.getBalance('south', 'wallet'), 250);
    await service.process(event('sale-a', 'a-2', 90));
    await service.process(event('sale-a', 'a-3', 90));
    await service.process(event('refund-a', 'a-4', 40, 'refund'));
    await service.process(event('sale-b', 'b-1', 25, 'payment', 'south'));
    assert.equal(await service.getBalance('north', 'wallet'), 750);
    assert.equal(await service.getBalance('south', 'wallet'), 225);
    const snap = store.snapshot();
    assert.equal(snap.ledger.length, 3); assert.equal(snap.eventCount, 3);
    assert.deepEqual(snap.ledger.map(x => [x.tenantId, x.kind, x.balanceCents]), [['north', 'payment', 710], ['north', 'refund', 750], ['south', 'payment', 225]]);
  });
  return { caseId: 'payment-consistency', passed: checks.filter(x => x.passed).length, total: checks.length, checks, criticalFailures,
    accepted: checks.every(x => x.passed) && criticalFailures.length === 0 };
}
