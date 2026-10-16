import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createGlobalLimit } from '../scripts/host-acceptance/real-model-global-limit.mjs'

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(import.meta.dirname, '.gate-unit-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(import.meta.dirname))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const logFile = path.join(directory, 'logs', 'gate.jsonl')
  const config = { testRoot: directory, logFile, allowedProvider: 'offline-unit-route', allowedModel: 'unit-model', ...options }
  return { gate: createGlobalLimit(config), config, log: () => fs.readFileSync(logFile, 'utf8') }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const options = (sessionId, signal) => Object.freeze({ provider: 'offline-unit-route', model: 'unit-model', sessionId,
  purpose: sessionId === 'decision' ? 'compaction' : undefined,
  messages: Object.freeze([{ role: 'user', content: Object.freeze([{ type: 'text', text: 'PRIVATE_PROMPT_NEVER_LOG' }]) }]), signal })
const consume = async iterator => { const chunks = []; for await (const chunk of iterator) chunks.push(chunk); return chunks }
const finish = { type: 'finish', reason: { kind: 'stop' } }

test('global FIFO gate limits all sessions and auxiliary streams to two without mutating frozen options', async t => {
  const f = fixture(t), admittedOrder = []
  let release, current = 0, peak = 0
  const barrier = new Promise(resolve => { release = resolve })
  const identifiers = ['worker-a', 'decision', 'worker-b', 'title', 'assist']
  const runs = identifiers.map(id => {
    const request = options(id)
    return consume(f.gate.stream(request, async function * () {
      admittedOrder.push(id); current++; peak = Math.max(peak, current)
      await barrier
      assert.ok(Object.isFrozen(request))
      yield { type: 'usage', usage: Object.freeze({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 1, totalTokens: 8 }) }
      yield finish
      current--
    }))
  })
  await tick()
  assert.equal(f.gate.snapshot().active, 2)
  assert.equal(f.gate.snapshot().queueDepth, 3)
  release(); await Promise.all(runs)
  assert.equal(peak, 2)
  assert.deepEqual(admittedOrder, identifiers)
  assert.equal(f.gate.snapshot().activePeak, 2)
  assert.equal(f.gate.snapshot().completed, 5)
  assert.equal(f.gate.snapshot().active, 0)
  assert.ok(!f.log().includes('PRIVATE_PROMPT_NEVER_LOG'))
  const usage = f.log().trim().split('\n').map(JSON.parse).find(x => x.event === 'usage')
  assert.equal(usage.usage.inputTokens, 5)
  assert.equal(usage.synthetic, false)
})

test('aborted queued request never invokes downstream and releases its queue listener', async t => {
  const f = fixture(t, { concurrency: 1 }), controller = new AbortController()
  let release, unexpected = 0
  const first = consume(f.gate.stream(options('first'), async function * () { await new Promise(resolve => { release = resolve }); yield finish }))
  await tick()
  const aborted = assert.rejects(consume(f.gate.stream(options('queued', controller.signal), async function * () { unexpected++; yield finish })), { code: 'ACCEPTANCE_ABORTED' })
  await tick(); assert.equal(f.gate.snapshot().queueDepth, 1)
  controller.abort(new Error('PRIVATE_ABORT_REASON_NEVER_LOG')); await aborted
  release(); await first
  await consume(f.gate.stream(options('after-cancel'), async function * () { yield finish }))
  assert.equal(unexpected, 0)
  assert.equal(f.gate.snapshot().active, 0)
  assert.equal(f.gate.snapshot().admitted, 2)
  assert.equal(f.gate.snapshot().cancelled, 1)
  assert.ok(!f.log().includes('PRIVATE_ABORT_REASON_NEVER_LOG'))
})

test('exact route allowlist and finite request budget reject before downstream dispatch', async t => {
  const f = fixture(t, { maxRequests: 1 })
  let dispatches = 0
  const downstream = async function * () { dispatches++; yield finish }
  await assert.rejects(consume(f.gate.stream(Object.freeze({ ...options('wrong'), provider: 'secret-route-token=PRIVATE_KEY' }), downstream)), { code: 'ACCEPTANCE_ROUTE_NOT_ALLOWED' })
  await consume(f.gate.stream(options('allowed'), downstream))
  await assert.rejects(consume(f.gate.stream(options('over-budget'), downstream)), { code: 'ACCEPTANCE_REQUEST_LIMIT' })
  assert.equal(dispatches, 1)
  assert.equal(f.gate.snapshot().admitted, 1)
  assert.equal(f.gate.snapshot().rejected, 2)
  assert.ok(!f.log().includes('PRIVATE_KEY'))
})

test('downstream failure, terminal error and consumer return release all permits without logging private messages', async t => {
  const f = fixture(t, { concurrency: 1 })
  await assert.rejects(consume(f.gate.stream(options('throws'), async function * () { throw new Error('PRIVATE_PROVIDER_ERROR_NEVER_LOG') })))
  await consume(f.gate.stream(options('terminal-error'), async function * () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'PRIVATE_PROVIDER_ERROR_NEVER_LOG' } } } }))
  for await (const _chunk of f.gate.stream(options('early-return'), async function * () { yield { type: 'text-delta', index: 0, text: 'PRIVATE_OUTPUT_NEVER_LOG' }; yield finish })) break
  await consume(f.gate.stream(options('recovered'), async function * () { yield finish }))
  assert.equal(f.gate.snapshot().active, 0)
  assert.equal(f.gate.snapshot().failed, 3)
  assert.equal(f.gate.snapshot().completed, 1)
  assert.ok(!f.log().includes('PRIVATE_PROVIDER_ERROR_NEVER_LOG'))
  assert.ok(!f.log().includes('PRIVATE_OUTPUT_NEVER_LOG'))
})

test('configuration rejects expanded concurrency, unbounded budgets and logs outside the test root', t => {
  const f = fixture(t)
  assert.throws(() => createGlobalLimit({ ...f.config, concurrency: 3 }), /hard maximum/u)
  assert.throws(() => createGlobalLimit({ ...f.config, maxRequests: Infinity }), /finite positive/u)
  assert.throws(() => createGlobalLimit({ ...f.config, maxRequests: 0 }), /finite positive/u)
  assert.throws(() => createGlobalLimit({ ...f.config, allowedProvider: '' }), /nonempty/u)
  assert.throws(() => createGlobalLimit({ ...f.config, logFile: path.join(f.config.testRoot, '..', 'escape.jsonl') }), /below testRoot/u)
})

test('closing the gate rejects pending requests and never admits more work', async t => {
  const f = fixture(t, { concurrency: 1 })
  let release, dispatches = 0
  const active = consume(f.gate.stream(options('active'), async function * () { dispatches++; await new Promise(resolve => { release = resolve }); yield finish }))
  await tick()
  const queued = assert.rejects(consume(f.gate.stream(options('pending'), async function * () { dispatches++; yield finish })), { code: 'ACCEPTANCE_GATE_CLOSED' })
  await tick(); f.gate.close(); await queued
  release(); await active
  await assert.rejects(consume(f.gate.stream(options('closed'), async function * () { dispatches++; yield finish })), { code: 'ACCEPTANCE_GATE_CLOSED' })
  assert.equal(dispatches, 1)
  assert.equal(f.gate.snapshot().active, 0)
})
