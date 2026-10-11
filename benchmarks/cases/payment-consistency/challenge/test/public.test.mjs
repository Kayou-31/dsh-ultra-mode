import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentService, createStore } from '../src/service.mjs';

test('normal payment, refund and visible balance', async () => {
  const service = createPaymentService({ store: createStore([{ tenantId: 'demo', accountId: 'main', balanceCents: 1000 }]) });
  const common = { tenantId: 'demo', accountId: 'main' };
  assert.deepEqual(await service.process({ ...common, eventId: 'sale-1', requestId: 'http-1', kind: 'payment', amountCents: 125 }), { status: 'applied', balanceCents: 875 });
  assert.deepEqual(await service.process({ ...common, eventId: 'refund-1', requestId: 'http-2', kind: 'refund', amountCents: 40 }), { status: 'applied', balanceCents: 915 });
  assert.equal(await service.getBalance('demo', 'main'), 915);
  assert.equal(service.store.snapshot().ledger.length, 2);
});

test('invalid and insufficient payments do not alter ledger', async () => {
  const service = createPaymentService({ store: createStore([{ tenantId: 'demo', accountId: 'main', balanceCents: 5 }]) });
  await assert.rejects(service.process({ tenantId: 'demo', accountId: 'main', eventId: 'x', requestId: 'r', kind: 'payment', amountCents: 6 }), { code: 'INSUFFICIENT_FUNDS' });
  assert.equal(service.store.snapshot().ledger.length, 0);
  assert.equal(await service.getBalance('demo', 'main'), 5);
});
