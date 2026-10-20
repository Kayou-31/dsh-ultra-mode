import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as report from '../scripts/host-acceptance/ocg-report.mjs'

const admit = (id, extra = {}) => ({ runId: 'run-a', event: 'admitted', requestId: id, provider: 'opencode-go', model: 'deepseek-v4.1-flash', synthetic: false, activePeak: 2, ...extra })
const terminal = (id, usage, extra = {}) => ({ ...admit(id), event: 'completed', usage, elapsedMs: 12, ...extra })
const attempt = (extra = {}) => ({ attemptId: 'long-on-1', launch: { mode: 's2', sdk: '0.2.1-rc.2', candidateSha256: 'a'.repeat(64), driverSha256: 'b'.repeat(64), concurrency: 8 },
  result: { status: 'passed', mode: 's2', elapsedMs: 100, requests: [{ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }], checks: [{ name: 'native model turn completed 1', passed: true }], grade: { passed: true, checks: [{ name: 'tail batch exact', passed: true }] }, globalGate: { final: { runId: 'run-a', admitted: 1, activePeak: 2, synthetic: false } } },
  streams: [admit('r1'), terminal('r1', { inputTokens: 10, outputTokens: 3, totalTokens: 15, reasoningTokens: 2 })], ...extra })

test('usage identity drift invalidates the ledger instead of becoming a terminal fallback measurement', () => {
  for (const drift of [{ model: 'foreign-model' }, { provider: 'foreign-provider' }, { synthetic: true }]) {
    const input = attempt()
    input.streams = [admit('r1'), { ...admit('r1'), ...drift, event: 'usage', usage: { totalTokens: 99 } }, terminal('r1', null)]
    const result = report.summarizeOcgAttempt(input)
    assert.equal(result.ledger.complete, false)
    assert.equal(result.usage.knownRequests, 0)
    assert.equal(result.usage.reported.totalTokens, null)
    assert.equal(result.quality.included, false)
  }
})

test('public report counts each admitted identity once using only its last terminal usage', () => {
  assert.equal(typeof report.summarizeOcgAttempt, 'function')
  const input = attempt(); input.streams = [admit('r1'), admit('r1'), { ...admit('r1'), event: 'usage', usage: { totalTokens: 90 } },
    terminal('r1', { inputTokens: 1, outputTokens: 1, totalTokens: 2 }), terminal('r1', { inputTokens: 10, outputTokens: 3, totalTokens: 15, reasoningTokens: 2 })]
  const value = report.summarizeOcgAttempt(input)
  assert.equal(value.ledger.uniqueAdmitted, 1)
  assert.equal(value.ledger.duplicateAdmissionRows, 1)
  assert.equal(value.ledger.duplicateTerminalRows, 1)
  assert.equal(value.usage.knownRequests, 1)
  assert.equal(value.usage.reported.totalTokens, 15)
  assert.equal(value.usage.reported.inputTokens, 10)
  assert.equal(value.usage.reported.outputTokens, 3)
  assert.equal(value.usage.reported.reasoningTokens, 2)
  assert.equal(value.usage.reported.cacheReadTokens, null)
  assert.equal(value.cost, null)
  assert.equal(value.concurrency.scope, 'per-process gate observations')
  assert.equal(value.concurrency.observedPeak, 2)
})

test('usage distinguishes failed zero, missing, pending and partial reported fields without inventing totals', () => {
  const input = attempt()
  input.result.requests = Array.from({ length: 5 }, () => ({})); input.result.globalGate.final.admitted = 5
  input.streams = [admit('r1'), terminal('r1', { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, { event: 'failed', failureCode: 'TIMEOUT' }),
    admit('r2'), terminal('r2', null), admit('r3'), terminal('r3', null, { lastUsage: { inputTokens: 12, outputTokens: 4 } }),
    admit('r4'), { ...admit('r4'), event: 'usage', usage: { totalTokens: 99 } },
    admit('r5'), terminal('r5', { totalTokens: 8 }, { event: 'failed', failureCode: 'TRANSPORT' })]
  const value = report.summarizeOcgAttempt(input)
  assert.equal(value.usage.knownRequests, 2)
  assert.equal(value.usage.unknownRequests, 3)
  assert.equal(value.usage.reported.totalTokens, 8)
  assert.equal(value.usage.reported.inputTokens, 12)
  assert.equal(value.ledger.pendingRequests, 1)
  assert.deepEqual(value.failureCodes, ['TIMEOUT', 'TRANSPORT'])
  assert.equal(value.ledger.complete, false)
  assert.equal(value.usage.missingFields.totalTokens, 1)
})

test('last usage fallback works across legacy spellings and synthetic counts stay separate', () => {
  const input = attempt()
  input.streams = [admit('r1', { synthetic: true }), terminal('r1', null, { synthetic: true, lastusage: { totalTokens: 3 } })]
  input.result.globalGate.final.synthetic = true
  const value = report.summarizeOcgAttempt(input)
  assert.equal(value.evidenceClass, 'scripted-native')
  assert.equal(value.usage.reported.totalTokens, 3)
  const actual = attempt({ attemptId: 'actual-real' })
  actual.streams = actual.streams.map(row => ({ ...row, runId: 'real-run' })); actual.result.globalGate.final.runId = 'real-run'
  const aggregate = report.summarizeOcgExperiments([input, actual])
  assert.equal(aggregate.totals.realReportedUsage.totalTokens, 15)
  assert.equal(aggregate.totals.syntheticReportedUsage.totalTokens, 3)
})

test('orphan terminal rows and conflicting duplicate admission identities cannot manufacture measured usage', () => {
  const input = attempt()
  input.streams = [admit('r1'), admit('r1', { model: 'glm-5.1' }), terminal('r1', { totalTokens: 100 }), terminal('not-admitted', { totalTokens: 999 })]
  const value = report.summarizeOcgAttempt(input)
  assert.equal(value.usage.knownRequests, 0)
  assert.equal(value.usage.unknownRequests, 1)
  assert.equal(value.usage.reported.totalTokens, null)
  assert.equal(value.ledger.orphanTerminalRows, 1)
  assert.equal(value.ledger.complete, false)
})

test('terminal ordering and terminal identity drift cannot turn orphan or foreign usage into admitted measurements', () => {
  for (const streams of [
    [terminal('r1', { totalTokens: 99 }), admit('r1')],
    [admit('r1'), terminal('r1', { totalTokens: 99 }, { model: 'glm-5.1' })],
  ]) {
    const value = report.summarizeOcgAttempt(attempt({ streams }))
    assert.equal(value.usage.knownRequests, 0)
    assert.equal(value.ledger.complete, false)
  }
})

test('cancelled zero usage remains unknown and impossible token values cannot overflow into a false total', () => {
  const cancelled = report.summarizeOcgAttempt(attempt({ streams: [admit('r1'), terminal('r1', { inputTokens: 0, totalTokens: 0 }, { event: 'cancelled', failureCode: 'ABORTED' })] }))
  assert.equal(cancelled.usage.unknownRequests, 1)
  assert.equal(cancelled.usage.reported.totalTokens, null)
  const input = attempt(); input.result.requests = [{}, {}]; input.result.globalGate.final.admitted = 2
  input.streams = [admit('r1'), terminal('r1', { totalTokens: Number.MAX_SAFE_INTEGER }), admit('r2'), terminal('r2', { totalTokens: 1 })]
  const overflow = report.summarizeOcgAttempt(input)
  assert.equal(overflow.usage.reported.totalTokens, null)
  assert.deepEqual(overflow.usage.overflowFields, ['totalTokens'])
})

test('incomplete or scripted ledgers cannot contribute to real-model quality statistics', () => {
  const missing = attempt({ streams: [] })
  const scripted = attempt({ attemptId: 'scripted' }); scripted.streams = scripted.streams.map(row => ({ ...row, synthetic: true })); scripted.result.globalGate.final.synthetic = true
  const value = report.summarizeOcgExperiments([missing, scripted])
  assert.equal(value.totals.strictGradePassed, 0)
  assert.equal(value.attempts[0].quality.exclusion.code, 'incomplete-ledger')
  assert.equal(value.attempts[1].quality.exclusion.code, 'scripted-evidence')
  const omitted = report.summarizeOcgAttempt(attempt({ invalidReason: 'supplemental-protocol-omission' }))
  assert.equal(omitted.quality.exclusion.code, 'supplemental-protocol-omission')
})

test('normalizes native knowledge, pool and long compression metadata with explicit estimate and prune scopes', () => {
  const input = attempt()
  input.result.native = { sessionId: 'private-root', prunes: [{ seq: 10 }, { seq: 10 }, { seq: 20 }] }
  input.result.compressionSamples = [{ beforeGeneration: 0, afterGeneration: 1, elapsedMs: 3, metrics: { before: { inputTokens: 50000, totalTokens: 56000, estimated: true, method: 'utf8-heuristic' }, after: { inputTokens: 2000, totalTokens: 8000, estimated: true, method: 'utf8-heuristic' } } }]
  const value = report.summarizeOcgAttempt(input)
  assert.equal(value.nativePrunes.count, 2)
  assert.equal(value.nativePrunes.scope, 'cumulative native session')
  assert.equal(value.compression[0].before.inputTokens, 50000)
  assert.equal(value.compression[0].before.estimated, true)
  assert.equal(value.compression[0].countsAreProviderUsage, false)
  const knowledge = attempt({ attemptId: 'knowledge' }); knowledge.launch = { scenario: 'knowledge', candidate: { sha256: 'c'.repeat(64) } }
  knowledge.result = { status: 'passed', phase: 'core', target: 'memory', requests: [], compression: { rounds: [{ round: 1, beforeSurfaceTokens: 50902, afterSurfaceTokens: 2082, replacementSeq: 40 }] } }
  knowledge.streams = []
  const kg = report.summarizeOcgAttempt(knowledge)
  assert.equal(kg.mode, 'knowledge')
  assert.equal(kg.provenance.candidateSha256, 'c'.repeat(64))
  assert.equal(kg.compression[0].before.estimated, true)
  assert.equal(kg.compression[0].before.method, 'native-token-meter')
  assert.equal(kg.nativePrunes.count, null)
  const pool = attempt({ attemptId: 'pool' }); pool.launch = { scenario: 'pool' }; pool.result.phaseProofs = [{ route: { id: 'code', provider: 'opencode-go', model: 'glm-5.1' }, audit: { passed: true }, challenge: { nonce: 'PRIVATE_NONCE' }, publicText: 'PRIVATE_ANSWER' }]
  const p = report.summarizeOcgAttempt(pool)
  assert.equal(p.phases[0].routeId, 'code')
  assert.equal(p.phases[0].passed, true)
  assert.ok(!JSON.stringify(p).includes('PRIVATE_'))
})

test('pool support manifest resolves only the known driver hash and inconsistent grade cannot claim a pass', () => {
  const input = attempt()
  input.launch = { scenario: 'pool', candidate: { sha256: 'c'.repeat(64) }, support: [{ path: 'ocg-pool-plugin.mjs', sha256: 'd'.repeat(64) }, { path: 'E:/private.json', sha256: 'e'.repeat(64) }] }
  input.result.grade.checks[0].passed = false
  const value = report.summarizeOcgExperiments([input])
  assert.equal(value.attempts[0].provenance.driverSha256, 'd'.repeat(64))
  assert.equal(value.attempts[0].grade.consistent, false)
  assert.equal(value.totals.strictGradePassed, 0)
})

test('invalid attempts retain classified exclusion and costs but are excluded from quality aggregation', () => {
  const invalid = attempt({ invalidReason: { code: 'driver-defect', message: 'C:\\private\\secret error body' } })
  const value = report.summarizeOcgAttempt(invalid)
  assert.equal(value.quality.included, false)
  assert.equal(value.quality.exclusion.code, 'driver-defect')
  assert.equal(value.usage.reported.totalTokens, 15)
  const good = attempt({ attemptId: 'good' }); good.streams = good.streams.map(row => ({ ...row, runId: 'run-b' })); good.result.globalGate.final.runId = 'run-b'
  const aggregate = report.summarizeOcgExperiments([invalid, good])
  assert.equal(aggregate.totals.qualityIncludedAttempts, 1)
  assert.equal(aggregate.totals.strictGradePassed, 1)
  assert.equal(aggregate.totals.realReportedUsage.totalTokens, 30)
})

test('public whitelist never propagates private bodies, local paths, credentials, unknown labels or nested payloads', () => {
  const forbidden = 'PRIVATE_CANARY_7x9'
  const input = attempt()
  input.attemptId = 'C:\\private\\' + forbidden
  Object.assign(input.launch, { providerConfig: { apiKey: forbidden }, projectDir: 'E:\\' + forbidden, argv: [forbidden] })
  Object.assign(input.result, { messages: [forbidden], publicAnswers: [{ publicText: forbidden, endReason: { kind: 'completed' } }], reasoning: forbidden, error: { message: forbidden, code: forbidden }, failure: { body: forbidden }, requestUsageSummary: { cost: 9999 } })
  input.result.requests[0].text = forbidden; input.result.requests[0].finish = { failure: { message: forbidden } }
  input.result.checks.push({ name: forbidden, passed: false, details: { prompt: forbidden } })
  input.streams[1].error = forbidden; input.streams[1].credentials = forbidden; input.streams[1].usage = { totalTokens: 15, reasoning: forbidden }
  input.invalidReason = forbidden
  const value = JSON.stringify(report.summarizeOcgAttempt(input))
  assert.ok(!value.includes(forbidden)); assert.ok(!value.includes('C:\\private')); assert.ok(!value.includes('apiKey'))
  assert.ok(value.includes('check-2')); assert.ok(value.includes('tail batch exact'))
})

test('aggregate deduplicates repeated gate rows across manifests and native prunes across cold resumes', () => {
  const first = attempt({ attemptId: 'before' }), second = attempt({ attemptId: 'after' })
  first.result.native = { sessionId: 'same-private-root', prunes: [{ seq: 10 }] }
  second.result.native = { sessionId: 'same-private-root', prunes: [{ seq: 10 }, { seq: 20 }] }
  const value = report.summarizeOcgExperiments([first, second])
  assert.equal(value.totals.uniqueAdmittedRequests, 1)
  assert.equal(value.totals.realReportedUsage.totalTokens, 15)
  assert.equal(value.totals.uniqueNativePrunes, 2)
  assert.throws(() => report.summarizeOcgExperiments([first, first]), /duplicate/i)
})

test('CLI reads only explicit manifest paths and refuses overwriting a public report', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocg-public-report-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const input = attempt(); fs.writeFileSync(path.join(root, 'launch.json'), JSON.stringify(input.launch)); fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(input.result)); fs.writeFileSync(path.join(root, 'gate.jsonl'), input.streams.map(row => JSON.stringify(row)).join('\n'))
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify([{ attemptId: 'cli-case', launchFile: 'launch.json', resultFile: 'result.json', streamsFile: 'gate.jsonl' }]))
  fs.writeFileSync(path.join(root, 'DO-NOT-SCAN.json'), '{ this unrelated private file is not readable JSON')
  const cli = new URL('../scripts/host-acceptance/ocg-report.mjs', import.meta.url)
  const command = () => spawnSync(process.execPath, [fileURLToPath(cli), '--input', path.join(root, 'manifest.json'), '--output', path.join(root, 'public.json')], { encoding: 'utf8', windowsHide: true })
  const first = command(); assert.equal(first.status, 0, first.stderr)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'public.json'), 'utf8')).attempts[0].attemptId, 'cli-case')
  assert.equal(command().status, 1)
  assert.ok(!first.stdout.includes(root)); assert.ok(!first.stderr.includes(root))
})
