import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runUltra, completedSeed } from '../lib/orchestrator.js'

const config = {
  toolName: 'ultra_task', timeoutMs: 3000, reportChars: 1000,
  researchTools: ['read_file'], jevEnabled: false,
  jevKeyEnv: '__DSH_ULTRA_TEST_MISSING_JEV_KEY__', jevModel: 'jev-latest',
  jevBaseUrl: 'https://api.typesafe.ai', jevTimeoutMs: 100,
}
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const result = (id, text, ok = true) => ({ sessionId: id, text, ok, ...(ok ? {} : { error: 'scripted failure' }) })
const snapshot = [
  { type: 'turn/start', data: { id: 'complete' } },
  { type: 'assistant/message', data: { text: 'old completed response' } },
  { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  { type: 'turn/start', data: { id: 'active' } },
  { type: 'assistant/message', data: { text: 'unfinished response' } },
]

/** A barrier forces all successful workers to overlap before any can finish. */
function harness(count, { createFailure, workers = [], final = {}, planning = {}, waitForAbort = false } = {}) {
  const started = deferred()
  const release = deferred()
  const expected = count - (createFailure === undefined ? 0 : 1)
  const record = { created: [], creationAttempts: [], calls: [], disposed: [], accessChanges: [], workerActive: 0, peak: 0, workerStarts: 0, aborts: 0 }
  const parent = { session: { snapshotEvents: () => snapshot } }
  Object.defineProperty(parent, 'subagents', { get: () => assert.fail('Ultra must not use subagent orchestration') })
  const factory = async (_parent, options, suppliedConfig) => {
    assert.equal(_parent, parent)
    assert.equal(suppliedConfig.toolName, config.toolName)
    record.creationAttempts.push(options)
    const isDecision = options.label === 'Ultra decision'
    const index = isDecision ? undefined : Number(options.label.match(/^Ultra (\d+)\//)[1]) - 1
    if (index === createFailure && !isDecision) throw new Error('scripted create failure')
    const handle = { options, runs: 0, active: false, disposed: false }
    record.created.push(handle)
    return {
      id: options.id,
      async run(prompt) {
        assert.equal(handle.active, false, 'the persistent decision cannot overlap its own turns')
        assert.equal(handle.disposed, false)
        handle.active = true
        handle.runs++
        record.calls.push({ id: options.id, isDecision, turn: handle.runs, prompt })
        try {
          if (isDecision) {
            if (handle.runs === 1) return result(options.id, planning.text ?? JSON.stringify({ assignments: Array.from({ length: count }, (_, i) => `Research ${i + 1}`) }), planning.ok ?? true)
            assert.equal(handle.runs, 2, 'exactly one planning turn and one final turn')
            return result(options.id, final.text ?? 'Authorized work delivered with verified evidence.', final.ok ?? true)
          }
          record.workerActive++
          record.workerStarts++
          record.peak = Math.max(record.peak, record.workerActive)
          let onAbort
          try {
            const aborted = new Promise(resolve => {
              onAbort = () => { record.aborts++; resolve() }
              options.signal.addEventListener('abort', onAbort, { once: true })
              if (options.signal.aborted) onAbort()
            })
            if (record.workerStarts === expected) {
              started.resolve()
              if (!waitForAbort) release.resolve()
            }
            await Promise.race([release.promise, aborted])
            if (options.signal.aborted) return result(options.id, '', false)
            const outcome = workers[index] ?? {}
            return result(options.id, outcome.text ?? `Evidence from worker ${index + 1}`, outcome.ok ?? true)
          } finally {
            options.signal.removeEventListener('abort', onAbort)
            record.workerActive--
          }
        } finally { handle.active = false }
      },
      setReadOnly(value) {
        assert.equal(handle.active, false)
        record.accessChanges.push({ id: options.id, value })
      },
      async dispose() {
        assert.equal(handle.active, false, 'cleanup must drain each route first')
        assert.equal(handle.disposed, false, 'dispose every acquired handle once')
        handle.disposed = true
        record.disposed.push(options.id)
      },
    }
  }
  const controller = new AbortController()
  const phases = []
  const image = { type: 'image', url: 'fixture://image' }
  const options = { parent, task: 'Fix and deliver the original task', content: [{ type: 'text', text: 'Original task text' }, image], concurrency: count, signal: controller.signal, route: { provider: 'fixture', model: 'fixture-max' }, phase: value => phases.push(value) }
  return { record, factory, controller, phases, options, image, started: started.promise, release: release.resolve }
}

function assertDrained(h) {
  assert.equal(h.record.workerActive, 0)
  assert.equal(h.record.disposed.length, h.record.created.length)
  assert.deepEqual(new Set(h.record.disposed), new Set(h.record.created.map(handle => handle.options.id)))
  assert.equal(h.phases.at(-1), 'cleaning')
}

for (const count of [3, 4, 5]) {
  test(`${count} execution loops overlap; one extra persistent decision plans and finalizes`, async () => {
    const h = harness(count)
    const output = await runUltra(config, h.options, h.factory)
    assert.equal(h.record.peak, count)
    assert.equal(h.record.created.length, count + 1)
    assert.equal(new Set(h.record.created.map(handle => handle.options.id)).size, count + 1)
    const decision = h.record.created.filter(handle => handle.options.label === 'Ultra decision')
    assert.equal(decision.length, 1)
    assert.equal(decision[0].runs, 2)
    assert.equal(h.record.calls.filter(call => call.isDecision).length, 2)
    assert.equal(output.requested, count)
    assert.equal(output.succeeded, count)
    assert.equal(output.routeIds.length, count)
    assert.equal(output.decisionId, decision[0].options.id)
    assert.equal(output.routeIds.includes(output.decisionId), false)
    assert.equal(output.decided, true)
    assert.equal(output.degraded, false)
    assert.deepEqual(h.record.accessChanges, [{ id: output.decisionId, value: false }])
    assert.ok(h.record.created.every(handle => handle.options.readOnly === true))
    assert.ok(h.record.created.every(handle => handle.options.route === h.options.route))
    assert.ok(h.record.created.every(handle => handle.options.seed.length === 3))
    for (const call of h.record.calls.filter(call => !call.isDecision || call.turn === 1)) {
      assert.ok(call.prompt.includes(h.image), 'retain image context in planning and execution')
      assert.equal(call.prompt.filter(block => block.type === 'text').length, 1)
    }
    assert.deepEqual(h.phases, ['planning', 'researching', 'deciding', 'cleaning'])
    assertDrained(h)
  })
}

test('branch creation failure retains two good reports and drains acquired handles', async () => {
  const h = harness(3, { createFailure: 1 })
  const output = await runUltra(config, h.options, h.factory)
  assert.equal(h.record.creationAttempts.length, 4)
  assert.equal(h.record.created.length, 3)
  assert.equal(h.record.peak, 2)
  assert.equal(output.succeeded, 2)
  assert.equal(output.degraded, true)
  assert.match(output.output, /成功 2\/3，失败 1；另有 1 条决策路线/)
  const finalPrompt = h.record.calls.find(call => call.isDecision && call.turn === 2).prompt[0].text
  assert.match(finalPrompt, /scripted create failure/)
  assertDrained(h)
})

test('two completed reports of three produce a transparent degraded result', async () => {
  const h = harness(3, { workers: [{}, { ok: false, text: 'discard this failed output' }, {}] })
  const output = await runUltra(config, h.options, h.factory)
  assert.equal(output.succeeded, 2)
  assert.equal(output.degraded, true)
  assert.equal(output.decided, true)
  assert.match(output.output, /Ultra 降级/)
  assert.match(output.output, /成功 2\/3，失败 1/)
  assert.doesNotMatch(output.output, /discard this failed output/)
  assertDrained(h)
})

test('fewer than two useful reports rejects before final decision or write access', async () => {
  const h = harness(3, { workers: [{}, { ok: false }, { ok: true, text: '   ' }] })
  await assert.rejects(runUltra(config, h.options, h.factory), /1\/3.*少于 2 条.*未开始实施/)
  assert.equal(h.record.calls.filter(call => call.isDecision).length, 1)
  assert.deepEqual(h.record.accessChanges, [])
  assert.equal(h.phases.includes('deciding'), false)
  assertDrained(h)
})

test('parent cancellation drains all parallel loops without final implementation', async () => {
  const h = harness(5, { waitForAbort: true })
  const pending = runUltra(config, h.options, h.factory)
  const rejection = assert.rejects(pending, error => error.name === 'AbortError')
  await h.started
  assert.equal(h.record.peak, 5)
  h.controller.abort()
  await rejection
  assert.equal(h.record.aborts, 5)
  assert.equal(h.record.calls.filter(call => call.isDecision).length, 1)
  assert.deepEqual(h.record.accessChanges, [])
  assert.equal(h.phases.includes('deciding'), false)
  assertDrained(h)
})

test('failed planning drains the decision loop and starts no executions', async () => {
  const h = harness(3, { planning: { ok: false, text: 'invalid plan' } })
  await assert.rejects(runUltra(config, h.options, h.factory), /无法完成规划/)
  assert.equal(h.record.created.length, 1)
  assert.equal(h.record.workerStarts, 0)
  assert.deepEqual(h.record.accessChanges, [])
  assertDrained(h)
})

for (const final of [{ ok: false, text: 'Everything has been delivered' }, { ok: true, text: '   ' }]) {
  test(`failed/empty decision (${final.ok}) never claims completed delivery`, async () => {
    const h = harness(3, { final })
    const output = await runUltra(config, h.options, h.factory)
    assert.equal(output.decided, false)
    assert.equal(output.succeeded, 3)
    assert.match(output.output, /决策路线失败/)
    assert.match(output.output, /尚未完成统一决策或交付/)
    assert.match(output.output, /Evidence from worker 1/)
    assert.doesNotMatch(output.output, /Everything has been delivered/)
    assertDrained(h)
  })
}

test('context replay stops at the last complete turn boundary', () => {
  assert.deepEqual(completedSeed({ session: { snapshotEvents: () => snapshot } }), snapshot.slice(0, 3))
  assert.deepEqual(completedSeed({ session: { snapshotEvents: () => snapshot.slice(3) } }), [])
  const multiple = [...snapshot.slice(0, 3), ...snapshot.slice(0, 3), ...snapshot.slice(3)]
  assert.deepEqual(completedSeed({ session: { snapshotEvents: () => multiple } }), multiple.slice(0, 6))
})

for (const enabled of [false, true]) {
  test(`Jev ${enabled ? 'enabled without a key degrades explicitly' : 'disabled makes no requests'}`, async () => {
    const h = harness(3)
    const fetch = globalThis.fetch
    let calls = 0
    assert.equal(Object.hasOwn(process.env, config.jevKeyEnv), false, 'fixture never reads or changes a real key')
    globalThis.fetch = async () => { calls++; assert.fail('missing/disabled Jev must not contact an API') }
    try {
      const output = await runUltra({ ...config, jevEnabled: enabled }, h.options, h.factory)
      assert.equal(output.decided, true)
      assert.equal(calls, 0)
      assert.equal(h.phases.includes('jev'), enabled)
      const prompt = h.record.calls.find(call => call.isDecision && call.turn === 2).prompt[0].text
      if (enabled) assert.match(prompt, /Jev 不可用：configuration；本次由 DSH Max 决策路线独立判断/)
      else assert.doesNotMatch(prompt, /Jev 不可用/)
      assertDrained(h)
    } finally { globalThis.fetch = fetch }
  })
}
