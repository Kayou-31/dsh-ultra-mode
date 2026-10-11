import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { parseCsv, COLUMNS } from '../challenge/src/csv.mjs'

const run = promisify(execFile)
const home = dirname(fileURLToPath(import.meta.url))
const definitions = [
  ['artifacts', 'execution', true], ['report-schema', 'schema', true],
  ['event-identities', 'identity', true], ['event-money', 'money', true],
  ['utc-days', 'timezone', true], ['overall-totals', 'money', true],
  ['separate-orders', 'identity', true], ['anomaly-recall', 'anomalies', true],
  ['anomaly-precision', 'anomalies', true], ['source-traceability', 'traceability', true],
  ['repeatable-output', 'determinism', true],
]
function shape(value, keys) { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(), [...keys].sort()) }
function integer(value, nonnegative = true) { assert.ok(Number.isSafeInteger(value)); if (nonnegative) assert.ok(value >= 0) }
function summary(value) { for (const key of ['paymentCents', 'refundCents', 'netCents', 'eventCount']) integer(value[key], key !== 'netCents') }
function validate(report, rows) {
  shape(report, ['schemaVersion', 'totals', 'daily', 'orders', 'anomalies']); assert.equal(report.schemaVersion, 1)
  shape(report.totals, ['paymentCents', 'refundCents', 'netCents', 'keptEvents', 'excludedRecords'])
  for (const [key, value] of Object.entries(report.totals)) integer(value, key !== 'netCents')
  for (const key of ['daily', 'orders', 'anomalies']) assert.ok(Array.isArray(report[key]))
  for (const day of report.daily) { shape(day, ['date', 'paymentCents', 'refundCents', 'netCents', 'eventCount']); assert.match(day.date, /^20\d{2}-\d{2}-\d{2}$/); summary(day) }
  for (const order of report.orders) { shape(order, ['orderId', 'customerId', 'paymentCents', 'refundCents', 'netCents', 'eventCount']); assert.equal(typeof order.orderId, 'string'); assert.equal(typeof order.customerId, 'string'); summary(order) }
  const anomalyIds = new Set()
  for (const anomaly of report.anomalies) {
    shape(anomaly, ['recordId', 'code', 'eventId', 'orderId'])
    for (const value of Object.values(anomaly)) assert.equal(typeof value, 'string')
    assert.equal(anomalyIds.has(anomaly.recordId), false); anomalyIds.add(anomaly.recordId)
  }
  const keys = new Set()
  for (const row of rows) {
    shape(row, COLUMNS)
    for (const key of COLUMNS.filter(key => !['deltaCents', 'sourceRecordIds'].includes(key))) assert.equal(typeof row[key], 'string')
    assert.ok(['payment', 'refund'].includes(row.kind)); assert.equal(row.currency, 'USD')
    integer(row.deltaCents, false); assert.ok(row.kind === 'payment' ? row.deltaCents > 0 : row.deltaCents < 0)
    assert.equal(keys.has(row.eventKey), false); keys.add(row.eventKey)
    assert.ok(Array.isArray(row.sourceRecordIds) && row.sourceRecordIds.length > 0)
    for (const id of row.sourceRecordIds) assert.equal(typeof id, 'string')
  }
}
async function artifacts(outputDir) {
  const reportText = await readFile(join(outputDir, 'report.json'), 'utf8')
  const csvText = await readFile(join(outputDir, 'cleaned.csv'), 'utf8')
  const [headers, ...data] = parseCsv(csvText)
  assert.deepEqual(headers, COLUMNS)
  const rows = data.map(fields => {
    assert.equal(fields.length, COLUMNS.length)
    const row = Object.fromEntries(COLUMNS.map((key, i) => [key, fields[i]]))
    assert.match(row.deltaCents, /^-?\d+$/)
    row.deltaCents = Number(row.deltaCents); row.sourceRecordIds = JSON.parse(row.sourceRecordIds)
    return row
  })
  return { report: JSON.parse(reportText), rows, reportText, csvText }
}
function pick(rows, keys) { return rows.map(row => Object.fromEntries(keys.map(key => [key, row[key]]))) }
const anomalyKey = item => JSON.stringify([item.recordId, item.code, item.eventId, item.orderId])

export async function grade(candidateDir) {
  const expected = JSON.parse(await readFile(new URL('./groundtruth.json', import.meta.url), 'utf8'))
  const candidate = resolve(candidateDir)
  const temporary = await mkdtemp(join(home, '.grade-run-'))
  const output = join(temporary, 'outputs')
  const checks = []
  try {
    let actual, executionError
    const launch = () => run(process.execPath, [join(candidate, 'src', 'cli.mjs'), '--input-dir', join(candidate, 'data'), '--output-dir', output], { cwd: candidate, timeout: 15000, maxBuffer: 1048576, windowsHide: true })
    try { await launch(); actual = await artifacts(output) } catch (error) { executionError = '候选 CLI 或交付文件无法读取：' + String(error.message ?? error).slice(0, 500) }
    const verify = async (id, callback, message) => {
      const [, category] = definitions.find(item => item[0] === id)
      let passed = false
      if (!executionError) { try { await callback(); passed = true } catch { /* Keep candidate data out of console/output diagnostics. */ } }
      checks.push({ id, passed, category, message: executionError ?? (passed ? '符合冻结的期望值' : message) })
    }
    await verify('artifacts', () => assert.ok(actual), '本次未生成可读 report.json 与 cleaned.csv')
    await verify('report-schema', () => validate(actual.report, actual.rows), '字段、类型、唯一身份或整数金额不符合 SPEC')
    await verify('event-identities', () => assert.deepEqual(pick(actual.rows, ['eventKey', 'eventId', 'kind', 'orderId', 'customerId', 'currency']), pick(expected.rows, ['eventKey', 'eventId', 'kind', 'orderId', 'customerId', 'currency'])), '经济事件数量/顺序/身份错误，或前导零订单丢失')
    await verify('event-money', () => assert.deepEqual(pick(actual.rows, ['eventKey', 'deltaCents']), pick(expected.rows, ['eventKey', 'deltaCents'])), '逐事件金额不符，重复入账或退款方向错误')
    await verify('utc-days', () => { assert.deepEqual(pick(actual.rows, ['eventKey', 'occurredAt', 'date']), pick(expected.rows, ['eventKey', 'occurredAt', 'date'])); assert.deepEqual(actual.report.daily, expected.report.daily) }, '绝对时间、UTC 日期或日净收入不符')
    await verify('overall-totals', () => assert.deepEqual(actual.report.totals, expected.report.totals), '支付/退款/净额或保留、排除计数不符')
    await verify('separate-orders', () => assert.deepEqual(actual.report.orders, expected.report.orders), '不同订单被合并、客户维度替代订单，或订单金额错误')
    await verify('anomaly-recall', () => { const found = new Set(actual.report.anomalies.map(anomalyKey)); assert.ok(expected.report.anomalies.every(item => found.has(anomalyKey(item)))) }, '遗漏预先冻结的重复、冲突或无效来源记录')
    await verify('anomaly-precision', () => { const allowed = new Set(expected.report.anomalies.map(anomalyKey)); assert.ok(actual.report.anomalies.every(item => allowed.has(anomalyKey(item)))) }, '把有效来源误报为异常，或异常身份/原因不符')
    await verify('source-traceability', () => assert.deepEqual(pick(actual.rows, ['eventKey', 'sourceRecordIds']), pick(expected.rows, ['eventKey', 'sourceRecordIds'])), '来源记录丢失、混淆或重复来源未关联至同一事件')
    await verify('repeatable-output', async () => { await launch(); const repeated = await artifacts(output); assert.equal(repeated.reportText, actual.reportText); assert.equal(repeated.csvText, actual.csvText) }, '再次执行产生不同内容或未能再次生成交付')
  } finally {
    // mkdtemp's resolved target is checked before recursive cleanup on Windows.
    if (dirname(temporary) !== home || !basename(temporary).startsWith('.grade-run-')) throw new Error('temporary cleanup path outside organizer')
    await rm(temporary, { recursive: true, force: true })
  }
  const passed = checks.filter(check => check.passed).length
  const critical = new Set(definitions.filter(item => item[2]).map(item => item[0]))
  return { caseId: 'reconciliation', passed, total: checks.length, checks, criticalFailures: checks.filter(check => !check.passed && critical.has(check.id)).map(check => check.id), accepted: passed === checks.length }
}
