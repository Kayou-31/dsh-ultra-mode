export function parseCsv(text) {
  const rows = [], row = []
  let field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field === '') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push([...row]); row.length = 0; field = ''
    } else field += char
  }
  if (quoted) throw new Error('unterminated CSV quote')
  if (field !== '' || row.length) { row.push(field); rows.push([...row]) }
  return rows
}
export function writeCsv(rows) {
  return rows.map(row => row.map(value => {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text
  }).join(',')).join('\n') + '\n'
}
export const COLUMNS = ['eventKey', 'eventId', 'kind', 'orderId', 'customerId', 'currency', 'occurredAt', 'date', 'deltaCents', 'sourceRecordIds']
