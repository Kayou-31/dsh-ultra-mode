// Ground truth comes from explicit integer/UTC event blueprints, not reconcile().
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { writeCsv } from '../challenge/src/csv.mjs'
const challenge = new URL('../challenge/', import.meta.url)
await mkdir(new URL('data/', challenge), { recursive: true })
const orders = Array.from({ length: 24 }, (_, i) => ({ orderId: i === 23 ? '7' : String(i + 1).padStart(4, '0'), customerId: 'C' + String(i % 6 + 1).padStart(2, '0'), amountCents: 2000 + i * 137, currency: 'USD' }))
const orderMap = new Map(orders.map(order => [order.orderId, order]))
const a = [], b = [], refunds = [], canonical = new Map(), anomalies = []
const amount = cents => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
const pad = value => String(value).padStart(2, '0')
function event(kind, eventId, orderId, cents, utc) {
  const key = `${kind}:${eventId}`
  canonical.set(key, { eventKey: key, eventId, kind, orderId, customerId: orderMap.get(orderId).customerId, currency: 'USD', occurredAt: utc, date: utc.slice(0, 10), deltaCents: kind === 'payment' ? cents : -cents, sourceRecordIds: [] })
  return key
}
function pay(eventId, orderId, cents, raw, utc, index) {
  const truth = event('payment', eventId, orderId, cents, utc)
  const row = { source: index % 2 ? 'bank' : 'stripe', eventId, orderId, currency: 'USD', amount: amount(cents), occurredAt: raw, status: 'settled', truth }
  ;(index % 2 ? b : a).push(row)
  return row
}
const primary = []
for (let i = 0; i < 24; i++) {
  const raw = i % 4 === 0 ? '2026-04-02T00:15:00+08:00' : i % 4 === 1 ? '2026-04-01T23:45:00-05:00' : `2026-04-01T15:${pad(i)}:00Z`
  const utc = i % 4 === 0 ? '2026-04-01T16:15:00.000Z' : i % 4 === 1 ? '2026-04-02T04:45:00.000Z' : `2026-04-01T15:${pad(i)}:00.000Z`
  primary.push(pay('p' + String(i + 1).padStart(3, '0'), orders[i].orderId, orders[i].amountCents, raw, utc, i))
}
for (let j = 0; j < 12; j++) primary.push(pay('p' + String(j + 25).padStart(3, '0'), orders[j * 5 % 24].orderId, (j + 1) * 111, `2026-04-03T09:${pad(j)}:00Z`, `2026-04-03T09:${pad(j)}:00.000Z`, j))
for (const index of [2, 13, 19, 29]) {
  const original = primary[index]
  const duplicate = { ...original, source: original.source === 'stripe' ? 'bank' : 'stripe' }
  if (index === 2) duplicate.occurredAt = '2026-04-01T23:02:00+08:00'
  ;(original.source === 'stripe' ? b : a).push(duplicate)
}
const base = { source: 'stripe', orderId: '0001', currency: 'USD', amount: '5.00', occurredAt: '2026-04-03T10:00:00Z', status: 'settled' }
const faults = [
  { ...base, eventId: 'p-conflict', bad: 'duplicate_conflict' },
  { ...base, source: 'bank', eventId: 'p-conflict', amount: '6.00', bad: 'duplicate_conflict' },
  { ...base, eventId: 'p-orphan', orderId: '9999', bad: 'orphan_order' },
  { ...base, eventId: 'p-fraction', amount: '1.005', bad: 'invalid_amount' },
  { ...base, eventId: 'p-negative', amount: '-2.00', bad: 'invalid_amount' },
  { ...base, eventId: 'p-currency', currency: 'EUR', bad: 'invalid_currency' },
  { ...base, eventId: 'p-pending', status: 'pending', bad: 'non_settled' },
  { ...base, eventId: 'p-no-zone', occurredAt: '2026-04-01T12:00:00', bad: 'invalid_timestamp' },
  { ...base, eventId: 'p-bad-date', occurredAt: '2026-02-30T12:00:00Z', bad: 'invalid_timestamp' },
  { ...base, eventId: 'p-zero', amount: '0.00', bad: 'invalid_amount' },
]
faults.forEach((row, i) => (i % 2 ? b : a).push(row))
function refund(eventId, orderId, cents, raw, utc, representation) {
  const truth = event('refund', eventId, orderId, cents, utc)
  const row = { source: 'shop', eventId, orderId, currency: 'USD', amount: (representation === 'signed' ? '-' : '') + amount(cents), occurredAt: raw, status: 'settled', representation, truth }
  refunds.push(row); return row
}
for (let i = 0; i < 12; i++) {
  const raw = i % 3 === 0 ? '2026-04-02T00:10:00+08:00' : i % 3 === 1 ? '2026-04-01T23:10:00-05:00' : `2026-04-03T12:${pad(i)}:00Z`
  const utc = i % 3 === 0 ? '2026-04-01T16:10:00.000Z' : i % 3 === 1 ? '2026-04-02T04:10:00.000Z' : `2026-04-03T12:${pad(i)}:00.000Z`
  refund('r' + String(i + 1).padStart(3, '0'), orders[i * 2].orderId, (i + 1) * 93, raw, utc, i % 2 ? 'signed' : 'positive')
}
for (const index of [1, 6, 9]) {
  const original = refunds[index]
  refunds.push({ ...original, representation: original.representation === 'signed' ? 'positive' : 'signed', amount: original.amount.startsWith('-') ? original.amount.slice(1) : '-' + original.amount })
}
refund('r013', '0007', 200, '2026-04-02T20:00:00Z', '2026-04-02T20:00:00.000Z', 'positive')
refund('r014', '7', 300, '2026-04-03T00:30:00+08:00', '2026-04-02T16:30:00.000Z', 'signed')
refund('r015', '0001', 400, '2026-04-03T11:00:00Z', '2026-04-03T11:00:00.000Z', 'positive')
const refundBase = { source: 'shop', orderId: '0001', currency: 'USD', amount: '2.00', occurredAt: '2026-04-03T11:00:00Z', status: 'settled', representation: 'positive' }
refunds.push(
  { ...refundBase, eventId: 'r-orphan', orderId: '9999', bad: 'orphan_order' },
  { ...refundBase, eventId: 'r-amount', amount: 'NaN', bad: 'invalid_amount' },
  { ...refundBase, eventId: 'r-pending', status: 'pending', bad: 'non_settled' },
  { ...refundBase, eventId: 'r-representation', representation: 'absolute', bad: 'invalid_representation' },
)
const headers = ['source', 'eventId', 'orderId', 'currency', 'amount', 'occurredAt', 'status']
const byId = new Map()
function register(row, recordId) {
  byId.set(recordId, row)
  if (row.bad) anomalies.push({ recordId, code: row.bad, eventId: row.eventId, orderId: row.orderId })
  else canonical.get(row.truth).sourceRecordIds.push(recordId)
}
for (const [filename, records] of [['payments-a.csv', a], ['payments-b.csv', b]]) {
  records.forEach((row, i) => register(row, `${filename}#${i + 2}`))
  await writeFile(new URL('data/' + filename, challenge), writeCsv([headers, ...records.map(row => headers.map(key => row[key]))]))
}
refunds.forEach((row, i) => register(row, `refunds.json#${i + 1}`))
await writeFile(new URL('data/orders.json', challenge), JSON.stringify(orders, null, 2) + '\n')
await writeFile(new URL('data/refunds.json', challenge), JSON.stringify(refunds.map(({ truth, bad, ...row }) => row), null, 2) + '\n')
const rows = [...canonical.values()].sort((x, y) => x.eventKey < y.eventKey ? -1 : x.eventKey > y.eventKey ? 1 : 0)
for (const row of rows) {
  row.sourceRecordIds.sort()
  for (const recordId of row.sourceRecordIds.slice(1)) {
    const original = byId.get(recordId)
    anomalies.push({ recordId, code: 'duplicate', eventId: original.eventId, orderId: original.orderId })
  }
}
anomalies.sort((x, y) => x.recordId < y.recordId ? -1 : x.recordId > y.recordId ? 1 : 0)
const summary = subset => ({
  paymentCents: subset.filter(row => row.kind === 'payment').reduce((sum, row) => sum + row.deltaCents, 0),
  refundCents: subset.filter(row => row.kind === 'refund').reduce((sum, row) => sum - row.deltaCents, 0),
  netCents: subset.reduce((sum, row) => sum + row.deltaCents, 0), eventCount: subset.length,
})
const all = summary(rows)
const report = {
  schemaVersion: 1,
  totals: { paymentCents: all.paymentCents, refundCents: all.refundCents, netCents: all.netCents, keptEvents: rows.length, excludedRecords: a.length + b.length + refunds.length - rows.length },
  daily: [...new Set(rows.map(row => row.date))].sort().map(date => ({ date, ...summary(rows.filter(row => row.date === date)) })),
  orders: orders.map(order => ({ orderId: order.orderId, customerId: order.customerId, ...summary(rows.filter(row => row.orderId === order.orderId)) })).sort((x, y) => x.orderId < y.orderId ? -1 : x.orderId > y.orderId ? 1 : 0), anomalies,
}
assert.equal(orders.length + a.length + b.length + refunds.length, 96)
assert.deepEqual(report.totals, { paymentCents: 94470, refundCents: 8154, netCents: 86316, keptEvents: 51, excludedRecords: 21 })
assert.deepEqual(report.daily.map(day => [day.date, day.netCents, day.eventCount]), [['2026-04-01', 62724, 22], ['2026-04-02', 18124, 12], ['2026-04-03', 5468, 17]])
assert.equal(report.orders.find(order => order.orderId === '0007').netCents, 3027)
assert.equal(report.orders.find(order => order.orderId === '7').netCents, 4851)
assert.equal(anomalies.length, 21)
await writeFile(new URL('./groundtruth.json', import.meta.url), JSON.stringify({ schemaVersion: 1, inputCounts: { orders: orders.length, payments: a.length + b.length, refunds: refunds.length }, report, rows }, null, 2) + '\n')
const correct = await readFile(new URL('./reference/src/reconcile.mjs', import.meta.url), 'utf8')
const baseline = correct
  .replace('[order.orderId, order]', '[String(Number(order.orderId)), order]')
  .replace('orderById.get(row.orderId)', 'orderById.get(String(Number(row.orderId)))')
  .replace('orderId: row.orderId, customerId:', 'orderId: order.orderId, customerId:')
  .replace('const key = `${row.kind}:${row.eventId}`', 'const key = `${row.kind}:${row.eventId}:${row.source}`')
  .replace('date: time.date', 'date: row.occurredAt.slice(0, 10)')
  .replace("row.kind === 'payment' ? cents : -cents", "row.kind === 'payment' || row.representation === 'positive' ? cents : -cents")
assert.notEqual(baseline, correct)
await writeFile(new URL('src/reconcile.mjs', challenge), baseline)
