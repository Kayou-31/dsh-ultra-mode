import test from 'node:test'
import assert from 'node:assert/strict'
import * as driver from './driver.mjs'
import { parseAcceptanceOptions } from './variants.mjs'

const gate = (overrides = {}) => ({ concurrency: 8, maxRequests: 180, activePeak: 6, active: 0, ...overrides })

test('acceptance freezes separate phase/global budgets and inherits only the actual gate concurrency', () => {
  assert.equal(typeof driver.freezeAcceptanceConfig, 'function')
  const config = { maxRequests: 120, workerCount: 5 }
  const actualGate = gate()
  const snapshot = driver.freezeAcceptanceConfig(config, actualGate, 's1')
  assert.deepEqual(snapshot, { streamConcurrency: 8, phaseMaxRequests: 120, globalMaxRequests: 180, workerCount: 5 })
  assert.ok(Object.isFrozen(snapshot))
  config.maxRequests = 1; config.workerCount = 2; actualGate.concurrency = 1
  assert.equal(snapshot.phaseMaxRequests, 120)
  assert.equal(snapshot.workerCount, 5)
  assert.equal(snapshot.streamConcurrency, 8)
  assert.deepEqual(driver.freezeAcceptanceConfig({}, gate({ concurrency: 2, maxRequests: 60 }), 's0'),
    { streamConcurrency: 2, phaseMaxRequests: 2, globalMaxRequests: 60, workerCount: 2 })
  assert.equal(driver.freezeAcceptanceConfig({}, gate(), 's1').phaseMaxRequests, 18)
})

test('acceptance rejects invalid finite limits, explicit gate mismatches and phase budgets exceeding the gate', () => {
  assert.equal(typeof driver.freezeAcceptanceConfig, 'function')
  for (const concurrency of [0, 33, 1.5, Infinity, NaN]) assert.throws(() => driver.freezeAcceptanceConfig({}, gate({ concurrency }), 's1'), /concurrency/i)
  for (const maxRequests of [0, 1001, 1.5, Infinity, NaN]) {
    assert.throws(() => driver.freezeAcceptanceConfig({ maxRequests }, gate(), 's1'), /request/i)
    assert.throws(() => driver.freezeAcceptanceConfig({}, gate({ maxRequests }), 's1'), /request/i)
  }
  for (const workerCount of [1, 6, 2.5, Infinity, NaN]) assert.throws(() => driver.freezeAcceptanceConfig({ workerCount }, gate(), 's1'), /worker/i)
  assert.throws(() => driver.freezeAcceptanceConfig({ streamConcurrency: 4 }, gate(), 's1'), /concurrency/i)
  assert.throws(() => driver.freezeAcceptanceConfig({ maxRequests: 181 }, gate(), 's1'), /exceed/i)
  assert.equal(driver.freezeAcceptanceConfig({ streamConcurrency: 32, maxRequests: 1000 }, gate({ concurrency: 32, maxRequests: 1000 }), 's1').phaseMaxRequests, 1000)
})

test('final gate validation uses the frozen chosen limit and refuses mutated limits or unfinished streams', () => {
  assert.equal(typeof driver.assertFinalAcceptanceGate, 'function')
  const snapshot = driver.freezeAcceptanceConfig({ workerCount: 5 }, gate(), 's1')
  driver.assertFinalAcceptanceGate(snapshot, gate())
  for (const changed of [gate({ activePeak: 9 }), gate({ active: 1 }), gate({ concurrency: 7 }), gate({ maxRequests: 181 })]) {
    assert.throws(() => driver.assertFinalAcceptanceGate(snapshot, changed), /gate|concurrency|stream/i)
  }
})

const topology = (count = 5) => {
  const workerIds = Array.from({ length: count }, (_, index) => 'worker-' + index)
  return { rootId: 'root', workerCount: count,
    notices: [{ runId: 'run-1', routeIds: workerIds, decisionId: 'decision' }],
    requests: [{ sessionId: 'root' }, ...workerIds.map(sessionId => ({ sessionId })), { sessionId: 'decision' }],
    reportSubmissions: workerIds.map(sessionId => ({ sessionId, isError: false, concludesTurn: true })), requireReportSubmission: true }
}

test('manual topology verifies 2 through 5 actual workers and decision from the host notice independent of request order', () => {
  assert.equal(typeof driver.inspectManualTopology, 'function')
  for (const count of [2, 3, 4, 5]) {
    const observation = topology(count)
    const actual = driver.inspectManualTopology(observation)
    assert.deepEqual(actual.workerIds, observation.notices[0].routeIds)
    assert.equal(actual.decisionId, 'decision')
    assert.equal(actual.internalSessions.length, count + 1)
    assert.equal(actual.acceptedWorkerReports, count)
  }
})

test('manual topology rejects missing, duplicate or foreign native identities and incomplete or wrong-worker reports', () => {
  assert.equal(typeof driver.inspectManualTopology, 'function')
  for (const mutate of [
    value => { value.notices = [] },
    value => { value.notices[0].routeIds.pop() },
    value => { value.notices[0].routeIds[1] = value.notices[0].routeIds[0] },
    value => { value.notices[0].decisionId = value.notices[0].routeIds[0] },
    value => { value.notices[0].routeIds[0] = 'root' },
    value => { value.requests.pop() },
    value => { value.requests.push({ sessionId: 'unknown-child' }) },
    value => { value.reportSubmissions[0].isError = true },
    value => { value.reportSubmissions[0].concludesTurn = false },
    value => { value.reportSubmissions[0].sessionId = 'decision' },
    value => { value.reportSubmissions.push({ ...value.reportSubmissions[0] }) },
    value => { value.notices.push({ ...value.notices[0], runId: 'different-run' }) },
  ]) {
    const value = topology(); mutate(value)
    assert.throws(() => driver.inspectManualTopology(value), /notice|worker|decision|session|report|run/i)
  }
  const noReports = topology(3); noReports.requireReportSubmission = false; noReports.reportSubmissions = []
  assert.equal(driver.inspectManualTopology(noReports).acceptedWorkerReports, 0)
})

test('acceptance CLI supports explicit finite concurrency, requests and manual worker count with unchanged defaults', () => {
  assert.deepEqual(parseAcceptanceOptions([], 'long', 'drift-c'), { streamConcurrency: 2, minRequestIntervalMs: 0 })
  assert.deepEqual(parseAcceptanceOptions(['--stream-concurrency=8', '--max-requests=180', '--worker-count=5'], 'ultra', 'control'),
    { streamConcurrency: 8, minRequestIntervalMs: 0, maxRequests: 180, workerCount: 5 })
  assert.equal(parseAcceptanceOptions(['--stream-concurrency=32', '--max-requests=1000', '--worker-count=2'], 'ultra', 'control').maxRequests, 1000)
  for (const option of ['--stream-concurrency=0', '--stream-concurrency=33', '--max-requests=0', '--max-requests=1001', '--max-requests=Infinity', '--worker-count=1', '--worker-count=6']) {
    assert.throws(() => parseAcceptanceOptions([option], 'ultra', 'control'), /concurrency|request|worker/i)
  }
  for (const option of ['--stream-concurrency=4', '--max-requests=80', '--worker-count=3']) {
    assert.throws(() => parseAcceptanceOptions([option, option], 'ultra', 'control'), /duplicate/i)
  }
})
