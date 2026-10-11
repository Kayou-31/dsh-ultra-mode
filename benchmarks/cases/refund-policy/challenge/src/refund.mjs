export const REFUND_CLOCK = '2026-01-15T12:00:00.000Z'

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be an integer`)
  if (value < min || value > max) throw new RangeError(`${name} out of range`)
  return value
}
function timestamp(value) {
  if (typeof value !== 'string') throw new TypeError('timestamp must be a string')
  const match = /^(20\d{2})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) throw new TypeError('timestamp requires an explicit zone')
  const [, y, mo, d, h, mi, s, ms = '', zone, sign, oh = '0', om = '0'] = match
  const year = Number(y), month = Number(mo), day = Number(d)
  const offsetHours = Number(oh), offsetMinutes = Number(om)
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59 || offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) throw new RangeError('invalid timestamp')
  const offset = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (offsetHours * 60 + offsetMinutes) * 60000
  return Date.UTC(year, month - 1, day, Number(h), Number(mi), Number(s), Number(ms.padEnd(3, '0'))) - offset
}
export function calculateRefund(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input must be an object')
  const { customerType, purchasedAt, requestedAt = REFUND_CLOCK, totalUnits, consumedUnits } = input
  if (!['consumer', 'enterprise'].includes(customerType)) throw new TypeError('unknown customerType')
  const paidCents = integer(input.paidCents, 'paidCents', 0, 1000000000)
  integer(totalUnits, 'totalUnits', 1, 1000000)
  integer(consumedUnits, 'consumedUnits', 0, totalUnits)
  const age = timestamp(requestedAt) - timestamp(purchasedAt)
  if (age < 0) throw new RangeError('request before purchase')
  if (customerType === 'enterprise') return { eligible: true, refundCents: integer(input.contractRefundCents, 'contractRefundCents', 0, paidCents), reason: 'contract' }
  if (age > 7 * 86400000) return { eligible: false, refundCents: 0, reason: 'consumer-expired' }
  return { eligible: true, refundCents: paidCents, reason: 'consumer-window' }
}
