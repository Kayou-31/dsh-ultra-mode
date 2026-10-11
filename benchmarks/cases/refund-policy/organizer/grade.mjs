import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

export async function grade(candidateDir) {
  const oracle = JSON.parse(await readFile(new URL('./groundtruth.json', import.meta.url), 'utf8'))
  let calculateRefund, loadError
  try {
    ;({ calculateRefund } = await import(pathToFileURL(resolve(candidateDir, 'src/refund.mjs')).href + '?grade=' + randomUUID()))
    if (typeof calculateRefund !== 'function') throw new Error('calculateRefund export is missing')
  } catch (error) { loadError = String(error.message ?? error).slice(0, 500) }
  const checks = []
  for (const item of oracle.checks) {
    let passed = false, message
    if (loadError) message = '候选模块无法加载：' + loadError
    else {
      const input = structuredClone(item.input), before = structuredClone(input)
      let value, error
      try { value = await calculateRefund(input) } catch (caught) { error = caught }
      try {
        if (item.throws) assert.ok(error instanceof TypeError || error instanceof RangeError, 'invalid input must throw TypeError/RangeError')
        else { assert.equal(error, undefined); assert.deepEqual(value, item.expected) }
        assert.deepEqual(input, before, 'input must not be mutated')
        passed = true; message = '符合冻结的最终规则'
      } catch { message = item.throws ? '异常输入未按契约抛错，或输入被修改' : '结果或输入保留不符合预先冻结的期望值' }
    }
    checks.push({ id: item.id, passed, category: item.category, message })
  }
  const critical = new Set(oracle.checks.filter(item => item.critical).map(item => item.id))
  const passed = checks.filter(check => check.passed).length
  return { caseId: 'refund-policy', passed, total: checks.length, checks, criticalFailures: checks.filter(check => !check.passed && critical.has(check.id)).map(check => check.id), accepted: passed === checks.length }
}
