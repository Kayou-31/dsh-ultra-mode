// Organizer-only fixture construction. Expected amounts below are hand-frozen.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const out = new URL('./reference/', import.meta.url)
await mkdir(new URL('src/', out), { recursive: true })
const old = await readFile(new URL('../challenge/src/refund.mjs', import.meta.url), 'utf8')
const correct = old.replace('age > 7 * 86400000', 'age > 14 * 86400000').replace(
  'refundCents: paidCents, reason:',
  'refundCents: Number((BigInt(paidCents) * BigInt(totalUnits - consumedUnits) * 2n + BigInt(totalUnits)) / (BigInt(totalUnits) * 2n)), reason:',
)
await writeFile(new URL('src/refund.mjs', out), correct)
const base = { customerType: 'consumer', paidCents: 10000, purchasedAt: '2026-01-10T12:00:00Z', requestedAt: '2026-01-15T12:00:00Z', totalUnits: 10, consumedUnits: 0 }
const yes = cents => ({ eligible: true, refundCents: cents, reason: 'consumer-window' })
const no = { eligible: false, refundCents: 0, reason: 'consumer-expired' }
const checks = []
function value(id, category, change, expected, critical = true) { checks.push({ id, category, input: { ...base, ...change }, expected, critical }) }
function invalid(id, change) { checks.push({ id, category: 'invalid-input', input: { ...base, ...change }, throws: true, critical: true }) }
value('window-day-10', 'window-update', { purchasedAt: '2026-01-05T12:00:00Z' }, yes(10000))
value('window-exact-day-14', 'window-boundary', { purchasedAt: '2026-01-01T12:00:00Z' }, yes(10000))
value('window-14-days-plus-1ms', 'window-boundary', { purchasedAt: '2026-01-01T11:59:59.999Z' }, no)
value('default-fixed-clock', 'fixed-clock', { purchasedAt: '2026-01-05T12:00:00Z', requestedAt: undefined }, yes(10000))
value('equivalent-zone-boundary', 'timezone', { purchasedAt: '2026-01-01T20:00:00+08:00' }, yes(10000))
value('consumption-three-of-ten', 'proration', { consumedUnits: 3 }, yes(7000))
value('money-fraction-two-thirds', 'rounding', { paidCents: 5, totalUnits: 3, consumedUnits: 1 }, yes(3))
value('money-exact-half-up', 'rounding', { paidCents: 1, totalUnits: 2, consumedUnits: 1 }, yes(1))
value('fully-consumed', 'proration', { consumedUnits: 10 }, yes(0))
value('large-money-boundary', 'rounding', { paidCents: 1000000000, totalUnits: 1000000, consumedUnits: 999999 }, yes(1000))
value('zero-paid', 'money-boundary', { paidCents: 0, consumedUnits: 5 }, yes(0))
value('enterprise-aged-consumed-contract', 'enterprise-regression', { customerType: 'enterprise', purchasedAt: '2025-10-01T12:00:00Z', consumedUnits: 10, contractRefundCents: 3611 }, { eligible: true, refundCents: 3611, reason: 'contract' })
value('enterprise-zero-contract', 'enterprise-regression', { customerType: 'enterprise', contractRefundCents: 0 }, { eligible: true, refundCents: 0, reason: 'contract' })
invalid('reject-fractional-money', { paidCents: 1.25 })
invalid('reject-negative-money', { paidCents: -1 })
invalid('reject-overconsumption', { consumedUnits: 11 })
invalid('reject-zero-total', { totalUnits: 0 })
invalid('reject-impossible-date', { purchasedAt: '2026-02-30T12:00:00Z' })
invalid('reject-zone-missing', { purchasedAt: '2026-01-10T12:00:00' })
invalid('reject-request-before-purchase', { purchasedAt: '2026-01-16T12:00:00Z' })
invalid('reject-enterprise-contract-overpaid', { customerType: 'enterprise', contractRefundCents: 10001 })
await writeFile(new URL('./groundtruth.json', import.meta.url), JSON.stringify({ schemaVersion: 1, policyRevision: '14-day-prorated', checks }, null, 2) + '\n')
