const key = (tenantId, id) => JSON.stringify([tenantId, id]);
const problem = (code) => Object.assign(new Error(code), { code });

export function createStore(initialBalances = []) {
  let balances = new Map(initialBalances.map(x => [key(x.tenantId, x.accountId), x.balanceCents]));
  let events = new Map();
  let ledger = [];
  let failCommit = false;
  return {
    readBalance(tenantId, accountId) { return balances.get(key(tenantId, accountId)) ?? 0; },
    failNextCommit() { failCommit = true; },
    snapshot() {
      return {
        balances: [...balances].map(([k, balanceCents]) => {
          const [tenantId, accountId] = JSON.parse(k);
          return { tenantId, accountId, balanceCents };
        }),
        ledger: structuredClone(ledger),
        eventCount: events.size,
      };
    },
    begin() {
      const nextBalances = new Map(balances);
      const nextEvents = new Map(events);
      const nextLedger = structuredClone(ledger);
      let closed = false;
      const open = () => { if (closed) throw problem('TRANSACTION_CLOSED'); };
      return {
        readBalance(tenantId, accountId) { open(); return nextBalances.get(key(tenantId, accountId)) ?? 0; },
        setBalance(tenantId, accountId, amount) { open(); nextBalances.set(key(tenantId, accountId), amount); },
        findEvent(tenantId, eventId) { open(); return nextEvents.get(key(tenantId, eventId)); },
        recordEvent(tenantId, eventId, fingerprint) { open(); nextEvents.set(key(tenantId, eventId), fingerprint); },
        append(entry) { open(); nextLedger.push(structuredClone(entry)); },
        async commit() {
          open();
          if (failCommit) { failCommit = false; closed = true; throw problem('COMMIT_FAILED'); }
          balances = nextBalances; events = nextEvents; ledger = nextLedger; closed = true;
        },
        rollback() { closed = true; },
      };
    },
  };
}
