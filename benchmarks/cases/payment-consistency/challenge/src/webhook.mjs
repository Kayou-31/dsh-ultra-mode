import { balanceCacheKey } from './cache.mjs';

const problem = (code) => Object.assign(new Error(code), { code });
function validate(event) {
  for (const name of ['tenantId', 'accountId', 'eventId', 'requestId']) {
    if (typeof event?.[name] !== 'string' || event[name].length === 0) throw problem('INVALID_EVENT');
  }
  if (!['payment', 'refund'].includes(event.kind) || !Number.isSafeInteger(event.amountCents) || event.amountCents <= 0) {
    throw problem('INVALID_EVENT');
  }
}

export async function applyEvent(event, { store, cache, getBalance }) {
  validate(event);
  const tx = store.begin();
  const eventKey = event.requestId;
  const fingerprint = JSON.stringify([event.accountId, event.kind, event.amountCents]);
  try {
    const seen = tx.findEvent(event.tenantId, eventKey);
    if (seen !== undefined) {
      tx.rollback();
      if (seen !== fingerprint) throw problem('EVENT_CONFLICT');
      return { status: 'duplicate', balanceCents: await getBalance(event.tenantId, event.accountId) };
    }
    const previous = tx.readBalance(event.tenantId, event.accountId);
    const balanceCents = previous + (event.kind === 'payment' ? -event.amountCents : event.amountCents);
    if (!Number.isSafeInteger(balanceCents)) throw problem('INVALID_EVENT');
    if (balanceCents < 0) throw problem('INSUFFICIENT_FUNDS');
    tx.setBalance(event.tenantId, event.accountId, balanceCents);
    tx.recordEvent(event.tenantId, eventKey, fingerprint);
    tx.append({ tenantId: event.tenantId, accountId: event.accountId, eventId: event.eventId,
      kind: event.kind, amountCents: event.amountCents, balanceCents });
    cache.set(balanceCacheKey(event.tenantId, event.accountId), balanceCents);
    await tx.commit();
    return { status: 'applied', balanceCents };
  } catch (error) {
    tx.rollback();
    throw error;
  }
}
