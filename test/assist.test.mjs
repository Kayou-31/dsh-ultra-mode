import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { parseCoordinationDecision } from '../lib/coordination.js'

// Exercise the owned source directly; building the release remains separate.
const compiled = ts.transpileModule(readFileSync(new URL('../src/assist.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText
const exported = {}
vm.runInNewContext(compiled, {
  exports: exported,
  require: name => {
    if (name === 'node:crypto') return { randomUUID }
    if (name === '@deepseek-ai/dsh-llm') return { createUserMessage }
    if (name === './coordination.js') return { parseCoordinationDecision }
    throw new Error('Unexpected assist test import: ' + name)
  },
  AbortSignal, AbortController, setTimeout, clearTimeout,
})
const { startDecisionAssist } = exported

const deferred = () => { const value = Promise.withResolvers(); return value }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const config = { toolName: 'ultra_task', timeoutMs: 5000, reportChars: 20000, researchTools: ['read', 'subagent'],
  jevEnabled: false, coordinationIntervalMs: 100, coordinationMaxRounds: -1 }
const answer = (parentId, instruction) => JSON.stringify({ assessment: 'Observed useful next step', directives: instruction ? [{ routeId: parentId, instruction }] : [] })

function harness({ respond, create, timeoutMs, maxRounds } = {}) {
  const listeners = new Map()
  const controller = new AbortController()
  const events = [{ type: 'turn/start', data: { turn: 7 } }]
  let publishingSessionEvent = false
  const record = { created: [], calls: [], steering: [], disposed: [], phases: [], running: 0, peak: 0, parentCancels: 0, followups: 0, removed: [], admitted: [], reentryAttempts: 0 }
  const on = (name, listener) => {
    const set = listeners.get(name) ?? new Set()
    listeners.set(name, set); set.add(listener)
    return () => { set.delete(listener) }
  }
  const emit = (name, ...args) => {
    const previous = publishingSessionEvent
    if (name === 'session/event') publishingSessionEvent = true
    try { for (const listener of [...(listeners.get(name) ?? [])]) listener(...args) }
    finally { publishingSessionEvent = previous }
  }
  const session = { id: 'main', header: {}, snapshotEvents: () => events }
  const inbox = { nextStep: [], nextTurn: [], remove(id) {
    if (publishingSessionEvent) {
      record.reentryAttempts++
      throw new Error('session append cannot reenter while another append is being published')
    }
    for (const pending of [this.nextTurn, this.nextStep]) {
      const index = pending.findIndex(message => message.id === id)
      if (index < 0) continue
      pending.splice(index, 1); record.removed.push(id); return true
    }
    return false
  } }
  const original = { provider: 'fixture', model: 'normal-model', reasoningEffort: 'medium', permissions: { write: true }, tools: ['write', 'subagent'] }
  const parent = { id: session.id, session, status: 'running', options: original,
    inbox, ctx: { root: { on } }, steer: message => { record.steering.push(message); inbox.nextStep.push(message) },
    cancel: () => { record.parentCancels++ }, followup: () => { record.followups++ } }
  const options = { parent, task: 'Implement the authorized change and deliver it normally', content: [], signal: controller.signal, phase: value => record.phases.push(value) }
  const factory = async (owner, inputs) => {
    assert.equal(owner, parent)
    record.created.push(inputs)
    const handle = { id: inputs.id,
      async run(prompt) {
        assert.equal(record.running, 0, 'the sole decision must stay serial')
        record.running++; record.peak = Math.max(record.peak, record.running)
        const round = record.calls.push(prompt)
        try { return { ok: true, sessionId: inputs.id, text: await (respond?.({ round, prompt, inputs }) ?? answer(parent.id)) } }
        finally { record.running-- }
      },
      setReadOnly() { assert.fail('assist must never gain final write permissions') },
      async dispose() { assert.equal(record.running, 0); record.disposed.push(inputs.id) } }
    return create ? create({ inputs, handle }) : handle
  }
  const progress = (text, { source = parent, kind = 'tool/result', turn = 7, content } = {}) => {
    const event = { type: kind, data: { turn, step: 1, message: { content: content ?? [{ type: 'text', text }] } } }
    if (source === parent) events.push(event)
    emit('session/event', source.session, event)
  }
  const finish = (reason = 'completed') => { const event = { type: 'turn/end', data: { turn: 7, reason: { kind: reason } } }; events.push(event); emit('session/event', session, event) }
  const claimNextStep = () => {
    const claimed = inbox.nextStep.splice(0)
    for (const message of claimed) {
      const event = { type: 'user/message', data: message }; events.push(event); record.admitted.push(message)
      emit('session/event', session, event)
    }
    return claimed
  }
  const start = () => startDecisionAssist({ ...config, ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(maxRounds === undefined ? {} : { coordinationMaxRounds: maxRounds }) }, options, factory)
  const untilCalls = async count => {
    for (let i = 0; record.calls.length < count && i < 150; i++) await delay(10)
    assert.ok(record.calls.length >= count, `expected ${count} decision calls`)
  }
  const listenerCount = () => [...listeners.values()].reduce((count, set) => count + set.size, 0)
  return { parent, original, record, options, controller, factory, start, progress, finish, emit, untilCalls, listenerCount, claimNextStep }
}

test('normal parent proceeds while one read-only decision is held, then receives non-human next-step feedback', async () => {
  const response = deferred()
  const h = harness({ respond: () => response.promise })
  const sidecar = await h.start()
  assert.equal(h.record.calls.length, 1, 'start returns while the first response remains pending')
  assert.equal(h.record.created.length, 1)
  assert.equal(h.record.created[0].readOnly, true)
  assert.equal(h.record.created[0].label, 'Ultra decision assist')
  assert.equal(h.record.created[0].signal.aborted, false)
  h.progress('Normal main Agent successfully wrote the authorized file')
  assert.equal(h.parent.options, h.original)
  assert.equal(h.original.reasoningEffort, 'medium')
  assert.deepEqual(h.original.tools, ['write', 'subagent'])
  response.resolve(answer(h.parent.id, 'Check the resulting file against the original requirement'))
  await delay(0)
  assert.equal(h.record.steering.length, 1)
  const feedback = h.record.steering[0]
  assert.equal(feedback.source.kind, 'ultra-assist', 'middleware must not recognize feedback as fresh human input')
  assert.equal(feedback.source.form, 'feedback')
  assert.equal(feedback.source.runId, sidecar.runId)
  assert.equal(feedback.source.decisionId, sidecar.decisionId)
  assert.equal(sidecar.coordination.directives.length, 1)
  assert.match(h.record.calls[0][0].text, /不能代替主 Agent 执行或交付/)
  assert.doesNotMatch(h.record.calls[0][0].text, /唯一提交者/)
  h.finish(); await sidecar.done
  assert.equal(h.record.parentCancels, 0)
  assert.equal(h.record.followups, 0)
  assert.equal(h.record.disposed.length, 1)
  assert.equal(h.listenerCount(), 0)
})

test('settled main and newly created native-child progress coalesce, without overlapping or timer-only model calls', async () => {
  const first = deferred()
  const h = harness({ respond: ({ round }) => round === 1 ? first.promise : answer('main') })
  const sidecar = await h.start()
  const child = { id: 'native-child', session: { id: 'native-child', header: { origin: 'subagent', parentSession: 'main' } } }
  h.emit('agent/created', { agent: child })
  h.progress('Main tool observation')
  h.progress('Useful native child output', { source: child, kind: 'assistant/message' })
  h.progress('', { kind: 'assistant/message', content: [{ type: 'reasoning', text: 'PRIVATE_REASONING_MUST_NOT_PASS' }] })
  h.progress('FOREIGN_OUTPUT', { source: { session: { id: 'foreign' } } })
  h.progress('PREVIOUS_TURN_OUTPUT', { turn: 6 })
  assert.equal(h.record.calls.length, 1)
  first.resolve(answer('main'))
  await h.untilCalls(2)
  const prompt = h.record.calls[1][0].text
  assert.match(prompt, /Main tool observation/)
  assert.match(prompt, /Useful native child output/)
  assert.doesNotMatch(prompt, /PRIVATE_REASONING_MUST_NOT_PASS|FOREIGN_OUTPUT|PREVIOUS_TURN_OUTPUT/)
  await delay(130)
  assert.equal(h.record.calls.length, 2, 'elapsed time alone cannot trigger another model call')
  assert.equal(h.record.peak, 1)
  h.finish(); await sidecar.done
})

test('turn/end stops admission while parent still reports running and drains a late decision response', async () => {
  const response = deferred()
  const h = harness({ respond: () => response.promise })
  const sidecar = await h.start()
  h.finish()
  assert.equal(h.parent.status, 'running', 'SDK exposes this state at durable turn/end')
  assert.equal(h.record.created[0].signal.aborted, true)
  let drained = false
  void sidecar.done.then(() => { drained = true })
  await delay(0)
  assert.equal(drained, false)
  h.emit('session/event', h.parent.session, { type: 'turn/start', data: { turn: 8 } })
  response.resolve(answer('main', 'This late advice must not start or affect the next turn'))
  await sidecar.done
  assert.equal(h.record.steering.length, 0)
  assert.equal(h.record.followups, 0)
  assert.equal(h.record.parentCancels, 0)
  assert.equal(h.record.disposed.length, 1)
  assert.equal(h.listenerCount(), 0)
})

test('parent cancellation stops only the sidecar and done awaits real decision disposal', async () => {
  const response = deferred()
  const h = harness({ respond: () => response.promise })
  const sidecar = await h.start()
  h.controller.abort(new Error('parent turn cancelled'))
  assert.equal(h.record.created[0].signal.aborted, true)
  assert.equal(h.record.parentCancels, 0)
  assert.equal(h.listenerCount(), 0)
  assert.equal(h.record.disposed.length, 0)
  response.resolve(answer('main', 'Do not deliver cancelled advice'))
  const outcome = await sidecar.done
  assert.equal(outcome.reason, 'cancelled')
  assert.equal(outcome.error, null)
  sidecar.stop(); sidecar.stop()
  assert.equal(h.record.disposed.length, 1)
  assert.equal(h.record.steering.length, 0)
  assert.equal(h.record.followups, 0)
})

test('timeout aborts the held decision and never wakes the main Agent', async () => {
  const h = harness({ timeoutMs: 30, respond: ({ inputs }) => new Promise(resolve => inputs.signal.addEventListener('abort', () => resolve(answer('main', 'Expired')), { once: true })) })
  const sidecar = await h.start()
  await delay(60)
  const outcome = await sidecar.done
  assert.equal(outcome.reason, 'timeout')
  assert.match(outcome.error, /超时/)
  assert.equal(h.record.created[0].signal.aborted, true)
  assert.equal(h.record.disposed.length, 1)
  assert.equal(h.record.steering.length, 0)
  assert.equal(h.record.parentCancels, 0)
  assert.equal(h.listenerCount(), 0)
})

test('malformed or foreign-target decisions are recorded, and fresh evidence can recover', async () => {
  const h = harness({ respond: ({ round }) => round === 1 ? answer('foreign', 'Wrong target') : round === 2 ? 'Malformed JSON' : answer('main', 'Recovered useful advice') })
  const sidecar = await h.start()
  await h.untilCalls(2)
  await delay(0)
  assert.equal(sidecar.coordination.errors.length, 2, 'foreign target and its invalid correction remain visible')
  assert.equal(h.record.steering.length, 0)
  h.progress('New main evidence after failure')
  await h.untilCalls(3)
  await delay(0)
  assert.equal(h.record.steering.length, 1)
  assert.equal(sidecar.coordination.directives.length, 1)
  h.finish(); await sidecar.done
})

test('one strict same-context correction can recover a multiple-object response without copying rejected advice', async () => {
  const invalid = answer('main') + '\n' + answer('main', 'UNTRUSTED_OUTPUT_DO_NOT_COPY')
  const h = harness({ respond: ({ round }) => round === 1 ? invalid : answer('main', 'Verify the authorized result') })
  const sidecar = await h.start()
  await h.untilCalls(2)
  await delay(0)
  assert.equal(h.record.created.length, 1)
  assert.equal(h.record.peak, 1)
  assert.equal(sidecar.coordination.rounds, 1, 'format correction stays in the current logical round')
  assert.equal(sidecar.coordination.errors.length, 1, 'the initial protocol failure is not swallowed')
  assert.equal(sidecar.coordination.directives.length, 1)
  assert.equal(h.record.steering.length, 1)
  assert.match(h.record.calls[0][0].text, /最后一条助手最终消息必须只有一个完整的严格 JSON 对象/)
  assert.match(h.record.calls[1][0].text, /不再调用工具|不复制旧输出/)
  assert.match(h.record.calls[1][0].text, /格式诊断/)
  assert.doesNotMatch(h.record.calls[1][0].text, /UNTRUSTED_OUTPUT_DO_NOT_COPY/)
  await delay(130)
  assert.equal(h.record.calls.length, 2, 'a successful repair does not create a timer-only next round')
  h.finish()
  const outcome = await sidecar.done
  assert.equal(outcome.reason, 'turn-ended')
  assert.equal(outcome.error, null, 'a successfully repaired protocol failure is not the final error')
  assert.deepEqual(outcome.warnings, sidecar.coordination.errors)
  assert.equal(outcome.warnings.length, 1, 'the recoverable diagnostic remains available for audit')
  outcome.warnings.length = 0
  assert.equal(sidecar.coordination.errors.length, 1, 'outcome diagnostics do not expose mutable audit history')
})

test('an invalid correction records both failures and never accepts a foreign target or retries indefinitely', async () => {
  const h = harness({ respond: ({ round }) => round === 1 ? '{"assessment":"bad "quote"","directives":[]}' : answer('foreign', 'Never steer another parent') })
  const sidecar = await h.start()
  await h.untilCalls(2)
  await delay(0)
  assert.equal(sidecar.coordination.rounds, 1)
  assert.equal(sidecar.coordination.errors.length, 2)
  assert.match(sidecar.coordination.errors[1], /协议修复/)
  assert.equal(sidecar.coordination.directives.length, 0)
  assert.equal(h.record.steering.length, 0)
  await delay(130)
  assert.equal(h.record.calls.length, 2)
  assert.equal(h.record.peak, 1)
  h.finish()
  const outcome = await sidecar.done
  assert.equal(outcome.reason, 'failed')
  assert.match(outcome.error, /协议修复/)
  assert.equal(outcome.warnings.length, 2)
})

test('parent end or cancellation during correction prevents late feedback and waits for the same decision to drain', async () => {
  for (const ending of ['end', 'cancel']) {
    const repair = deferred()
    const h = harness({ respond: ({ round }) => round === 1 ? 'Invalid JSON' : repair.promise })
    const sidecar = await h.start()
    await h.untilCalls(2)
    if (ending === 'end') h.finish()
    else h.controller.abort(new Error('parent cancelled during correction'))
    assert.equal(h.record.created[0].signal.aborted, true)
    let drained = false
    void sidecar.done.then(() => { drained = true })
    await delay(0)
    assert.equal(drained, false)
    repair.resolve(answer('main', 'This late correction must not be delivered'))
    await sidecar.done
    assert.equal(h.record.calls.length, 2)
    assert.equal(h.record.steering.length, 0)
    assert.equal(sidecar.coordination.errors.length, 1)
    assert.equal(h.record.disposed.length, 1)
    assert.equal(h.record.parentCancels, 0)
    assert.equal(h.record.followups, 0)
    assert.equal(h.listenerCount(), 0)
  }
})

test('finite decision run budget includes correction and cap zero or one never repairs', async () => {
  for (const maxRounds of [0, 1, 2]) {
    const h = harness({ maxRounds, respond: ({ round }) => round === 1 ? '{"assessment":"Valid JSON but wrong schema","directives":"invalid"}' : answer('main', 'Consume the corrected suggestion') })
    const sidecar = await h.start()
    await h.untilCalls(maxRounds === 2 ? 2 : 1)
    await delay(0)
    assert.equal(sidecar.coordination.errors.length, 1)
    assert.equal(sidecar.coordination.rounds, 1)
    assert.equal(h.record.steering.length, maxRounds === 2 ? 1 : 0)
    h.progress('Fresh evidence cannot exceed the decision.run call budget')
    await delay(130)
    assert.equal(h.record.calls.length, maxRounds === 2 ? 2 : 1)
    assert.equal(h.record.disposed.length, 0, 'decision run budget alone does not discard current-turn feedback')
    assert.equal(h.record.created[0].signal.aborted, false)
    if (maxRounds === 2) {
      const [feedback] = h.claimNextStep()
      assert.equal(feedback.source.runId, sidecar.runId)
      assert.equal(h.record.admitted.length, 1)
    }
    h.finish(); await sidecar.done
    assert.equal(h.record.disposed.length, 1)
  }
})

test('completion during slow creation releases the eventual handle and rejects startup safely', async () => {
  const creation = deferred()
  const h = harness({ create: ({ handle }) => creation.promise.then(() => handle) })
  const pending = h.start()
  const rejected = assert.rejects(pending, error => error.name === 'AbortError')
  assert.equal(h.record.created.length, 1)
  h.finish(); creation.resolve()
  await rejected
  assert.equal(h.record.disposed.length, 1)
  assert.equal(h.record.calls.length, 0)
  assert.equal(h.listenerCount(), 0)
  assert.equal(h.record.parentCancels, 0)
})

test('failed creation and an already-ended parent leave no listeners or new parent work', async () => {
  const h = harness({ create: () => { throw new Error('scripted factory failure') } })
  await assert.rejects(h.start(), /scripted factory failure/)
  assert.equal(h.listenerCount(), 0)
  h.finish()
  await assert.rejects(h.start(), /未结束/)
  assert.equal(h.record.created.length, 1)
  assert.equal(h.record.parentCancels, 0)
  assert.equal(h.record.followups, 0)
})

test('blocked/error event publication defers owned inbox removal until publication ends and done awaits purge', async () => {
  for (const reason of ['blocked', 'error']) {
    const h = harness({ maxRounds: 1, respond: () => answer('main', 'Pending feedback owned by this run') })
    const sidecar = await h.start()
    await delay(0)
    assert.equal(h.record.steering.length, 1)
    const feedback = h.record.steering[0]
    const human = createUserMessage({ content: [{ type: 'text', text: 'Keep this human input' }], source: { kind: 'user' } })
    const foreign = createUserMessage({ content: [{ type: 'text', text: 'Keep another assist run' }], source: { kind: 'ultra-assist', form: 'feedback', summary: 'Another run', runId: 'foreign-run', decisionId: 'foreign-decision' } })
    h.parent.inbox.nextStep.push(foreign)
    h.parent.inbox.nextTurn.push(human)
    if (reason === 'error') {
      h.parent.inbox.nextStep.splice(h.parent.inbox.nextStep.indexOf(feedback), 1)
      h.parent.inbox.nextTurn.push(feedback)
    }
    h.finish(reason)
    assert.equal(h.record.created[0].signal.aborted, true, 'event observer stops the decision immediately')
    assert.equal(h.listenerCount(), 0)
    assert.deepEqual(h.record.removed, [], 'no durable inbox append from inside event publication')
    await sidecar.done
    assert.equal(h.record.reentryAttempts, 0)
    assert.equal(sidecar.coordination.errors.length, 0)
    assert.deepEqual(h.record.removed, [feedback.id])
    assert.deepEqual(h.parent.inbox.nextStep.map(message => message.id), [foreign.id])
    assert.deepEqual(h.parent.inbox.nextTurn.map(message => message.id), [human.id])
    h.emit('session/event', h.parent.session, { type: 'turn/start', data: { turn: 8 } })
    assert.equal(h.parent.inbox.nextStep.some(message => message.source.runId === sidecar.runId), false)
    assert.equal(h.parent.inbox.nextTurn.some(message => message.source.runId === sidecar.runId), false)
    assert.equal(h.record.calls.length, 1)
    assert.equal(h.record.admitted.length, 0)
    assert.equal(h.record.parentCancels, 0)
    assert.equal(h.record.followups, 0)
    assert.equal(h.listenerCount(), 0)
  }
})

test('finite/zero cap stops new decision requests while its feedback remains consumable in the same turn', async () => {
  for (const maxRounds of [0, 1]) {
    const h = harness({ maxRounds, respond: () => answer('main', 'Consume before this main turn ends') })
    const sidecar = await h.start()
    await delay(0)
    assert.equal(h.record.calls.length, 1)
    assert.equal(h.parent.inbox.nextStep.length, 1)
    assert.equal(h.record.disposed.length, 0, 'request cap does not dispose the live turn owner')
    assert.equal(h.record.created[0].signal.aborted, false)
    let done = false
    void sidecar.done.then(() => { done = true })
    h.progress('New evidence after request cap')
    await delay(120)
    assert.equal(h.record.calls.length, 1, 'fresh progress cannot exceed the request cap')
    assert.equal(done, false)
    const feedback = h.parent.inbox.nextStep[0]
    assert.deepEqual(h.claimNextStep().map(message => message.id), [feedback.id])
    assert.equal(h.record.admitted[0].source.runId, sidecar.runId)
    h.finish(); await sidecar.done
    assert.equal(done, true)
    assert.equal(h.parent.inbox.nextStep.length, 0)
    assert.deepEqual(h.record.removed, [], 'admitted history is never removed')
    assert.equal(h.record.disposed.length, 1)
    assert.equal(h.listenerCount(), 0)
  }
})

test('explicit stop, abort, and a new turn remove pending owned feedback without cancelling parent work', async () => {
  for (const stopping of ['stop', 'abort', 'new-turn']) {
    const h = harness({ maxRounds: 1, respond: () => answer('main', 'This advice must not survive stop') })
    const sidecar = await h.start()
    await delay(0)
    const feedback = h.parent.inbox.nextStep[0]
    assert.ok(feedback)
    if (stopping === 'stop') sidecar.stop()
    else if (stopping === 'abort') h.controller.abort(new Error('Parent cancelled'))
    else h.emit('session/event', h.parent.session, { type: 'turn/start', data: { turn: 8 } })
    const outcome = await sidecar.done
    assert.equal(outcome.reason, stopping === 'stop' ? 'stopped' : stopping === 'abort' ? 'cancelled' : 'turn-ended')
    sidecar.stop()
    assert.deepEqual(h.record.removed, [feedback.id])
    assert.equal(h.parent.inbox.nextStep.length, 0)
    assert.equal(h.record.calls.length, 1)
    assert.equal(h.record.parentCancels, 0)
    assert.equal(h.record.followups, 0)
    assert.equal(h.record.disposed.length, 1)
    assert.equal(h.listenerCount(), 0)
  }
})

test('a durable aborted turn is cancellation even before the parent signal aborts', async () => {
  const h = harness({ maxRounds: 1 })
  const sidecar = await h.start()
  h.finish('aborted')
  const outcome = await sidecar.done
  assert.equal(h.controller.signal.aborted, false)
  assert.equal(outcome.reason, 'cancelled')
  assert.equal(outcome.error, null)
  assert.equal(h.record.parentCancels, 0)
  assert.equal(h.record.followups, 0)
})

test('normal turn end wins over a deadline while the decision is still draining', async () => {
  const response = deferred()
  const h = harness({ timeoutMs: 30, respond: () => response.promise })
  const sidecar = await h.start()
  h.finish()
  await delay(60)
  response.resolve(answer('main', 'Late advice stays out of the inbox'))
  const outcome = await sidecar.done
  assert.equal(outcome.reason, 'turn-ended')
  assert.equal(outcome.error, null)
  assert.equal(h.record.steering.length, 0)
  assert.equal(h.record.disposed.length, 1)
})
