import test from 'node:test'
import assert from 'node:assert/strict'
import * as runner from './variants.mjs'
import * as driver from './driver.mjs'
import { expected, driftExpected, prompts } from './fixture.mjs'

test('only drift long-repair enables final recovery and overrides the general sixty-request budget', () => {
  assert.equal(typeof runner.finalRecoveryConfig, 'function')
  for (const variant of ['drift', 'drift-c', 'drift-diverse']) {
    const config = Object.assign({ maxRequests: 60 }, runner.finalRecoveryConfig(variant, 'long-repair'))
    assert.deepEqual(config, { maxRequests: 8, driftFinalRecovery: true })
  }
  for (const [variant, mode] of [['control', 'long-repair'], ['extreme', 'long-repair'], ['drift-c', 'resume'], ['drift-c', 'baseline-long-repair']]) {
    assert.deepEqual(runner.finalRecoveryConfig(variant, mode), {})
  }
})

test('final recovery gets final quote and drift obligations without the progress-only instruction or answer hints', () => {
  assert.equal(typeof driver.prepareTurnPrompt, 'function')
  const config = { driftStress: true, driftFinalRecovery: true, requireVerifiedCitations: true }
  const prepared = driver.prepareTurnPrompt(driver.driftFinalRecoveryPrompt, config, 'long-repair')
  assert.equal(prepared.isFinal, true)
  assert.equal(prepared.isInitial, false)
  assert.match(prepared.prompt, /网络|传输/)
  assert.match(prepared.prompt, /只输出一个 JSON 对象/)
  assert.match(prepared.prompt, /kind="tool\/result"/)
  assert.match(prepared.prompt, /原始alpha\/beta只允许/)
  assert.match(prepared.prompt, /activeDecisionId 和 decisionHistory/)
  assert.match(prepared.prompt, /vendor-a、vendor-b/)
  assert.doesNotMatch(prepared.prompt, /只给不含早期batch\/checksum具体值的进度/)
  for (const value of [expected.batch, expected.checksum, expected.left, expected.right, driftExpected.v1, driftExpected.v2, driftExpected.v3]) assert.equal(prepared.prompt.includes(value), false)
})

test('ordinary repair remains progress-only and existing final prompts keep their original final obligations', () => {
  const ordinary = driver.prepareTurnPrompt(driver.longRepairPrompt, { driftStress: true, requireVerifiedCitations: true }, 'long-repair')
  assert.equal(ordinary.isFinal, false)
  assert.equal(ordinary.prompt, driver.longRepairPrompt + '\n只给不含早期batch/checksum具体值的进度，不用短摘要重述它们；保持先前限制与最新用户决定。')
  const final = driver.prepareTurnPrompt(prompts.longFinal, { driftStress: true, requireVerifiedCitations: true }, 's2-resume')
  assert.equal(final.isFinal, true)
  assert.match(final.prompt, /最终交付前，用 ultra_memory_search/)
  assert.match(final.prompt, /activeDecisionId 和 decisionHistory/)
})

function evidenceCall(resourceId, fact, size = 1_500_100) {
  const sourceId = 'src_' + resourceId.replaceAll('-', '').padEnd(64, 'a').slice(0, 64)
  const origin = { tool: 'fixture_read', callId: 'call-' + resourceId, resourceId }
  const quote = expected[fact], sha256 = 'a'.repeat(64)
  return { name: 'ultra_memory_get', sessionId: 'same-root', isError: false, sourceIds: [sourceId], status: 'host', facts: { [fact]: true },
    citation: { sourceId, quote, start: 500, end: 500 + quote.length, sha256, origin },
    originalSources: [{ id: sourceId, length: size, sha256, coverage: 'host', origin, fullCaptureAtRequestedThreshold: size >= 1_500_000 }] }
}
const observations = () => ({ sessionId: 'same-root', value: { activeDecisionId: driftExpected.v3, decisionHistory: [{ id: driftExpected.v1, status: 'superseded' }, { id: driftExpected.v2, status: 'superseded' }] },
  memoryCalls: [evidenceCall('payload-alpha', 'batch'), evidenceCall('payload-beta', 'checksum'), evidenceCall('vendor-a', 'left', 800), evidenceCall('vendor-b', 'right', 800)],
  preFinalPublicValueExposure: 0, compressedPreviewFactExposures: 0 })

test('recovery requires both original large archival quotes, independent vendor receipts and no early value exposure', () => {
  assert.equal(typeof driver.driftFinalRecoveryChecks, 'function')
  assert.ok(driver.driftFinalRecoveryChecks(observations()).every(check => check.passed))
  for (const mutate of [
    data => { data.memoryCalls = data.memoryCalls.filter(call => call.citation.origin.resourceId !== 'payload-beta') },
    data => { data.memoryCalls[0].originalSources[0].length = 800; data.memoryCalls[0].originalSources[0].fullCaptureAtRequestedThreshold = false },
    data => { data.memoryCalls[0].citation.origin.resourceId = 'load-0' },
    data => { data.memoryCalls[1].citation.sha256 = 'b'.repeat(64) },
    data => { data.memoryCalls[2].sessionId = 'different-root' },
    data => { data.memoryCalls[3].isError = true },
    data => { data.value.activeDecisionId = driftExpected.v2 },
    data => { data.value.decisionHistory[0].status = 'current' },
    data => { data.preFinalPublicValueExposure = 1 },
    data => { data.compressedPreviewFactExposures = 1 },
  ]) {
    const data = observations(); mutate(data)
    assert.ok(driver.driftFinalRecoveryChecks(data).some(check => !check.passed))
  }
})

test('failed-turn preservation exports only sequence and public failure classification', () => {
  assert.equal(typeof driver.failedTurnMetadata, 'function')
  const events = [{ seq: 7, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'private-error-body' } } } },
    { seq: 8, type: 'assistant/message', data: { message: { content: [{ type: 'thinking', thinking: 'private-thinking' }] } } }]
  assert.deepEqual(driver.failedTurnMetadata(events), [{ seq: 7, kind: 'error', code: 'TRANSPORT' }])
})
