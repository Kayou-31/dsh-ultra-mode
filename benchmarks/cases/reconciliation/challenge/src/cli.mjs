import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { reconcile } from './reconcile.mjs'
import { parseCsv, writeCsv, COLUMNS } from './csv.mjs'

const args = process.argv.slice(2)
let inputDir = resolve('data'), outputDir = resolve('outputs')
for (let i = 0; i < args.length; i += 2) {
  if (!args[i + 1]) throw new Error('missing path argument')
  if (args[i] === '--input-dir') inputDir = resolve(args[i + 1])
  else if (args[i] === '--output-dir') outputDir = resolve(args[i + 1])
  else throw new Error('unknown argument ' + args[i])
}
const orders = JSON.parse(await readFile(resolve(inputDir, 'orders.json'), 'utf8'))
const refunds = JSON.parse(await readFile(resolve(inputDir, 'refunds.json'), 'utf8')).map((row, index) => ({ ...row, recordId: `refunds.json#${index + 1}` }))
const payments = []
for (const name of ['payments-a.csv', 'payments-b.csv']) {
  const [headers, ...rows] = parseCsv(await readFile(resolve(inputDir, name), 'utf8'))
  const expected = ['source', 'eventId', 'orderId', 'currency', 'amount', 'occurredAt', 'status']
  if (JSON.stringify(headers) !== JSON.stringify(expected)) throw new Error('unexpected payment header')
  rows.forEach((row, index) => {
    if (row.length !== headers.length) throw new Error('unexpected payment width')
    payments.push({ ...Object.fromEntries(headers.map((key, column) => [key, row[column]])), recordId: `${name}#${index + 2}` })
  })
}
const { report, rows } = reconcile({ orders, payments, refunds })
await mkdir(outputDir, { recursive: true })
await writeFile(resolve(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
await writeFile(resolve(outputDir, 'cleaned.csv'), writeCsv([COLUMNS, ...rows.map(row => COLUMNS.map(key => row[key]))]))
