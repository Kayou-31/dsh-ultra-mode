function money(value, representation) {
  const pattern = representation === 'signed' ? /^-(0|[1-9]\d*)\.\d{2}$/ : /^(0|[1-9]\d*)\.\d{2}$/
  if (typeof value !== 'string' || !pattern.test(value)) return undefined
  const unsigned = value.startsWith('-') ? value.slice(1) : value
  const [whole, fraction] = unsigned.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction)
  return cents > 0n && cents <= 1000000000n ? Number(cents) : undefined
}
function timestamp(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(20\d{2})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return undefined
  const [, y, mo, d, h, mi, s, ms = '', zone, sign, oh = '0', om = '0'] = match
  const year = Number(y), month = Number(mo), day = Number(d), offsetHours = Number(oh), offsetMinutes = Number(om)
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59 || offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return undefined
  const offset = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (offsetHours * 60 + offsetMinutes) * 60000
  const epoch = Date.UTC(year, month - 1, day, Number(h), Number(mi), Number(s), Number(ms.padEnd(3, '0'))) - offset
  const iso = new Date(epoch).toISOString()
  return { epoch, iso, date: iso.slice(0, 10) }
}
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const counters = () => ({ paymentCents: 0, refundCents: 0, netCents: 0, eventCount: 0 })
function add(total, row) {
  if (row.kind === 'payment') total.paymentCents += row.deltaCents
  else total.refundCents -= row.deltaCents
  total.netCents += row.deltaCents; total.eventCount++
}
export function reconcile({ orders, payments, refunds }) {
  if (![orders, payments, refunds].every(Array.isArray)) throw new TypeError('input arrays are required')
  const orderById = new Map(orders.map(order => [String(Number(order.orderId)), order]))
  const groups = new Map(), anomalies = [], rows = []
  const exclude = (row, code) => anomalies.push({ recordId: row.recordId, code, eventId: row.eventId, orderId: row.orderId })
  for (const row of [...payments.map(value => ({ ...value, kind: 'payment' })), ...refunds.map(value => ({ ...value, kind: 'refund' }))]) {
    if (typeof row.eventId !== 'string' || row.eventId === '') { exclude(row, 'invalid_event_id'); continue }
    if (row.currency !== 'USD') { exclude(row, 'invalid_currency'); continue }
    const order = orderById.get(String(Number(row.orderId)))
    if (!order) { exclude(row, 'orphan_order'); continue }
    if (row.status !== 'settled') { exclude(row, row.status === 'pending' ? 'non_settled' : 'invalid_status'); continue }
    const time = timestamp(row.occurredAt)
    if (!time) { exclude(row, 'invalid_timestamp'); continue }
    if (row.kind === 'refund' && !['positive', 'signed'].includes(row.representation)) { exclude(row, 'invalid_representation'); continue }
    const cents = money(row.amount, row.kind === 'refund' ? row.representation : 'positive')
    if (cents === undefined) { exclude(row, 'invalid_amount'); continue }
    const key = `${row.kind}:${row.eventId}:${row.source}`
    const group = groups.get(key) ?? []
    group.push({ input: row, fingerprint: JSON.stringify([row.orderId, cents, time.epoch]), normalized: {
      eventKey: key, eventId: row.eventId, kind: row.kind, orderId: order.orderId, customerId: order.customerId,
      currency: 'USD', occurredAt: time.iso, date: row.occurredAt.slice(0, 10),
      deltaCents: row.kind === 'payment' || row.representation === 'positive' ? cents : -cents,
    } })
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.sort((a, b) => compare(a.input.recordId, b.input.recordId))
    if (new Set(group.map(item => item.fingerprint)).size > 1) { group.forEach(item => exclude(item.input, 'duplicate_conflict')); continue }
    rows.push({ ...group[0].normalized, sourceRecordIds: group.map(item => item.input.recordId) })
    group.slice(1).forEach(item => exclude(item.input, 'duplicate'))
  }
  rows.sort((a, b) => compare(a.eventKey, b.eventKey))
  anomalies.sort((a, b) => compare(a.recordId, b.recordId))
  const all = counters(), days = new Map()
  const orderTotals = new Map(orders.map(order => [order.orderId, { orderId: order.orderId, customerId: order.customerId, ...counters() }]))
  for (const row of rows) {
    add(all, row)
    const day = days.get(row.date) ?? { date: row.date, ...counters() }
    add(day, row); days.set(row.date, day)
    add(orderTotals.get(row.orderId), row)
  }
  return { report: {
    schemaVersion: 1,
    totals: { paymentCents: all.paymentCents, refundCents: all.refundCents, netCents: all.netCents, keptEvents: rows.length, excludedRecords: payments.length + refunds.length - rows.length },
    daily: [...days.values()].sort((a, b) => compare(a.date, b.date)),
    orders: [...orderTotals.values()].sort((a, b) => compare(a.orderId, b.orderId)), anomalies,
  }, rows }
}
