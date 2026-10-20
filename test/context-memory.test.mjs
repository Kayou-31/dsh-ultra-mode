import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = new URL('../src/context-memory.ts', import.meta.url)
const exports = {}
if (existsSync(source)) {
  const compiled = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(compiled, { exports, Buffer, structuredClone, Set, Map, WeakSet, Error, TypeError, Number, Math, JSON })
}
const { estimateRequestBudget, assembleRouteContext, compactSession } = exports
const ready = { skip: typeof compactSession !== 'function' }
const human = (seq, text, blocks) => ({ type: 'user/message', seq, time: seq + 1, data: {
  id: `u${seq}`, role: 'user', source: { kind: 'user' }, content: blocks ?? [{ type: 'text', text }],
}, surfaceOp: 'append' })
const assistant = (seq, callId) => ({ type: 'assistant/message', seq, time: seq + 1, data: {
  turn: 1, step: 1, stream: [], message: { id: `a${seq}`, role: 'assistant', source: { kind: 'model', provider: 'offline', model: 'fixture' },
    content: [{ type: 'reasoning', text: 'PRIVATE_REASONING_MUST_NOT_BE_INDEXED' }, { type: 'tool-call', id: callId, name: 'read', arguments: '{}' }] },
}, surfaceOp: 'append' })
const result = (seq, callId, text) => ({ type: 'tool/result', seq, time: seq + 1, data: {
  turn: 1, step: 1, message: { id: `t${seq}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }] },
}, surfaceOp: 'append' })
function fixture() {
  const events = [human(0, 'Only work offline. Never publish.'), assistant(1, 'call-1'), result(2, 'call-1', 'OLD_RESULT_MARKER '.repeat(1800)),
    assistant(3, 'call-2'), result(4, 'call-2', 'RECENT_RESULT_MUST_REMAIN '.repeat(400)), human(5, 'Keep the literal user constraints.')]
  const nodes = [0, 1, 2, 3, 4, 5]
  const writes = []
  const session = {
    id: 's', header: { id: 's', version: 4, createdAt: 1, isSeeded: false }, surface: { nodes, replaceGeneration: 0 },
    get seq() { return events.length },
    deriveEventMessage: event => event.type === 'user/message' ? event.data : event.data.message ?? null,
    append(type, data, options) {
      const event = { type, seq: events.length, time: events.length + 1, data: structuredClone(data), ...options }
      events.push(event); writes.push(event)
      if (options?.surfaceOp?.op === 'replace') {
        const start = nodes.indexOf(options.surfaceOp.startSeq), end = nodes.indexOf(options.surfaceOp.endSeq)
        assert.ok(start >= 0 && end >= start)
        nodes.splice(start, end - start + 1, event.seq)
        session.surface.replaceGeneration++
      }
      return event
    },
  }
  const order = []
  const options = {
    session, readEvents: async () => [...events], checkpoint: async () => { order.push('durable') },
    evidenceForEvent: async event => { order.push(`source:${event.seq}`); return { ids: [`src_${event.seq}`], sessionId: 's', sourceSeq: event.seq, durable: true } },
    estimateMessage: message => Math.ceil(JSON.stringify(message).length / 4),
    authority: { protocol: 'dsh-0.2.0-rc.2', soleOwner: true },
    stateText: 'Completed operation: inspected config. Still unverified: runtime behavior.', evidenceIds: ['src_retrieval'],
    config: { contextCompression: true, targetTokens: 3000, outputReserveTokens: 100, toolReserveTokens: 100, retainRecentMessages: 2, minResultChars: 100 },
  }
  return { events, nodes, writes, session, options, order }
}

test('context memory exposes assembly, inclusive request budgeting and deterministic host compression', () => {
  assert.equal(typeof estimateRequestBudget, 'function')
  assert.equal(typeof assembleRouteContext, 'function')
  assert.equal(typeof compactSession, 'function')
})

test('request budget includes system, schemas, history, retrieval and both reserves', ready, () => {
  const budget = estimateRequestBudget({ system: 'system'.repeat(20), tools: [{ name: 'search', schema: 'x'.repeat(50) }], messages: [{ role: 'user', content: 'message' }],
    retrieval: 'retrieved'.repeat(25), outputReserveTokens: 50, toolReserveTokens: 70, targetTokens: 300 })
  assert.ok(budget.sections.system > 0 && budget.sections.tools > 0 && budget.sections.messages > 0 && budget.sections.retrieval > 0)
  assert.equal(budget.totalTokens, budget.inputTokens + 120)
  assert.equal(budget.estimated, true)
  assert.equal(budget.withinBudget, budget.totalTokens <= 300)
  assert.equal(estimateRequestBudget({ inputTokens: 101, outputReserveTokens: 50, toolReserveTokens: 70 }).inputTokens, 101)
  assert.throws(() => estimateRequestBudget({ targetTokens: Number.NaN }), /token|budget/i)
})

test('native usage anchored pressure is a conservative estimate and cannot lower the full envelope', ready, () => {
  const ordinary = estimateRequestBudget({ messages: ['small'], outputReserveTokens: 50, toolReserveTokens: 70 })
  const metered = estimateRequestBudget({ messages: ['small'], nativeInputEstimate: 420000, outputReserveTokens: 50, toolReserveTokens: 70 })
  assert.equal(metered.inputTokens, 420000)
  assert.equal(metered.totalTokens, 420120)
  assert.equal(metered.estimated, true)
  assert.equal(metered.method, 'native-meter-envelope')
  assert.equal(estimateRequestBudget({ messages: ['small'], nativeInputEstimate: 0, outputReserveTokens: 50, toolReserveTokens: 70 }).inputTokens, ordinary.inputTokens)
  assert.equal(estimateRequestBudget({ inputTokens: 101 }).estimated, false, 'explicit exact input count preserves the public API contract')
  for (const value of [NaN, -1, 0.5]) assert.throws(() => estimateRequestBudget({ nativeInputEstimate: value }))
})

test('model-visible JSONL tool text is counted once without JSON transport escaping or internal message metadata', ready, () => {
  const text = ('{"caseId":"audit","observed":{"value":123456},"passed":true}\n').repeat(12000)
  const message = { id: 'internal-id', role: 'tool', source: { kind: 'tool', diagnostic: 'private-host-metadata'.repeat(10000) }, toolCallId: 'call-1', isError: false, content: [{ type: 'text', text }] }
  const budget = estimateRequestBudget({ messages: [message], outputReserveTokens: 8192, toolReserveTokens: 2048, targetTokens: 500000 })
  const rawText = Math.ceil(Buffer.byteLength(text, 'utf8') / 3)
  assert.ok(budget.inputTokens >= rawText, 'raw public result text is included')
  assert.ok(budget.inputTokens <= rawText + 256, 'JSON string escaping and host source metadata are not model input')
  assert.equal(budget.estimated, true)
  const noMetadata = { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text }] }
  assert.equal(estimateRequestBudget({ messages: [noMetadata] }).inputTokens, budget.inputTokens)
})

test('message budget retains tool-call arguments, reasoning, rich and unknown blocks plus fallback messages', ready, () => {
  for (const block of [{ type: 'tool-call', id: 'call-1', name: 'tool', arguments: '{"payload":"' + 'x'.repeat(3000) + '"}' }, { type: 'reasoning', text: 'y'.repeat(3000) }, { type: 'image', ref: 'attachment-' + 'z'.repeat(3000) }, { type: 'unknown', data: 'w'.repeat(3000) }]) {
    assert.ok(estimateRequestBudget({ messages: [{ role: 'assistant', content: [block] }] }).inputTokens >= 1000, block.type)
  }
  assert.ok(estimateRequestBudget({ messages: [{ custom: 'fallback'.repeat(1000) }] }).inputTokens >= 2000)
})

test('usage anchored pressure can trigger compression below the byte heuristic threshold and is remeasured after replace', ready, async () => {
  const f = fixture(), original = JSON.stringify(f.events)
  const targetTokens = 100000
  let measurements = 0
  const outcome = await compactSession({ ...f.options, config: { ...f.options.config, targetTokens }, measureInputTokens: () => {
    measurements++
    return f.session.surface.replaceGeneration === 0 ? 420000 : 8000
  } })
  assert.equal(outcome.status, 'compacted')
  assert.equal(outcome.before.inputTokens, 420000)
  assert.equal(outcome.before.estimated, true)
  assert.equal(outcome.before.method, 'native-meter-envelope')
  assert.ok(outcome.after.totalTokens < targetTokens)
  assert.ok(measurements >= 2)
  assert.ok(JSON.stringify(f.events).startsWith(original.slice(0, -1)), 'raw event prefix survives')
})

test('separate compression trigger waits for 420K then prunes toward the 30K soft target', ready, async () => {
  const f = fixture(), config = { ...f.options.config, targetTokens: 30000, triggerTokens: 420000 }
  const waiting = await compactSession({ ...f.options, config, measureInputTokens: () => 419000 })
  assert.equal(waiting.status, 'unchanged')
  assert.equal(waiting.before.withinBudget, false, '30K remains the declared soft target')
  assert.equal(f.writes.length, 0)
  const pruned = await compactSession({ ...f.options, config, measureInputTokens: () => f.session.surface.replaceGeneration === 0 ? 420000 : 8000 })
  assert.equal(pruned.status, 'compacted')
  assert.ok(pruned.after.withinBudget)
  const count = f.writes.length
  assert.equal((await compactSession({ ...f.options, config, measureInputTokens: () => 8000 })).status, 'unchanged')
  assert.equal(f.writes.length, count, 'repeating a completed compaction is idempotent')
})

test('compression trigger lower than its target is rejected before any history changes', ready, async () => {
  const f = fixture()
  await assert.rejects(compactSession({ ...f.options, config: { ...f.options.config, targetTokens: 30000, triggerTokens: 29000 } }), /trigger.*target/i)
  assert.equal(f.writes.length, 0)
})

test('optional compact locators prune durable short results without repeating state or every shared source', ready, async () => {
  const f = fixture(), original = 'SHORT_ORIGINAL_RESULT '.repeat(70)
  f.events[2].data.message.content[0].text = original
  const outcome = await compactSession({ ...f.options,
    config: { ...f.options.config, minResultChars: 64, previewChars: 0, compactLocators: true },
    measureInputTokens: () => f.session.surface.replaceGeneration === 0 ? 420000 : 100,
  })
  assert.equal(outcome.status, 'compacted')
  const compact = f.writes[1].data.message.content[0].text
  assert.match(compact, /src_2/)
  assert.match(compact, /ultra_memory_get/)
  assert.equal(compact.includes('src_retrieval'), false)
  assert.equal(compact.includes(f.options.stateText), false)
  assert.equal(compact.includes('SHORT_ORIGINAL_RESULT'), false)
  assert.equal(f.events[2].data.message.content[0].text, original)
  assert.equal(f.writes[1].data.message.id, 't2')
  assert.equal(f.writes[1].data.message.toolCallId, 'call-1')
})

test('invalid native pressure fails before replacing any history', ready, async () => {
  const f = fixture()
  await assert.rejects(compactSession({ ...f.options, measureInputTokens: () => NaN }))
  assert.equal(f.writes.length, 0)
})

test('native pressure failure after replacement restores the complete original surface', ready, async () => {
  const f = fixture(), original = structuredClone(f.events[2].data.message)
  await assert.rejects(compactSession({ ...f.options, measureInputTokens: () => f.session.surface.replaceGeneration === 0 ? 420000 : NaN }), error => {
    assert.equal(error.surfaceRestored, true)
    assert.equal(error.originalHistoryRetained, true)
    assert.equal(error.recoveryCheckpointDurable, true)
    return true
  })
  assert.deepEqual(f.session.deriveEventMessage(f.events[f.nodes[2]]), original)
  assert.equal(f.writes.filter(event => event.type === 'compaction/prune').length, 2, 'one attempted replacement and one compensation, not two successful cycles')
})

test('new routes retain every exact historical human constraint without copying shared logs or private reasoning', ready, () => {
  const { events } = fixture()
  const assembled = assembleRouteContext(events, { sessionId: 's', stateText: 'Unverified working state.', evidenceIds: ['src_retrieval'], eventSourceIds: { 0: ['src_user'] } }, { targetTokens: 3000 })
  assert.equal(assembled.seed.length, 0)
  assert.match(assembled.text, /Only work offline\. Never publish\./)
  assert.match(assembled.text, /Keep the literal user constraints\./)
  assert.match(assembled.text, /src_user/)
  assert.match(assembled.text, /src_retrieval/)
  assert.equal(assembled.text.includes('PRIVATE_REASONING_MUST_NOT_BE_INDEXED'), false)
  assert.ok(assembled.text.length < JSON.stringify(events).length / 2)
})

test('oversized human instructions are never silently dropped to hit the soft target', ready, () => {
  const text = 'MANDATORY_CONSTRAINT '.repeat(1000)
  const events = [human(0, text)]
  const assembled = assembleRouteContext(events, '', { targetTokens: 100, outputReserveTokens: 10, toolReserveTokens: 10 })
  assert.ok(assembled.text.includes(text))
  assert.equal(assembled.budget.withinBudget, false)
  assert.match(assembled.limit, /constraint|target|budget/i)
})

test('rich user input falls back to canonical seed rather than discarding attachment identity', ready, () => {
  const events = [human(0, '', [{ type: 'text', text: 'Compare this attachment.' }, { type: 'image', attachment: { id: 'image-id' } }])]
  const assembled = assembleRouteContext(events, '', {})
  assert.equal(assembled.seed, events)
  assert.match(assembled.limit, /attachment|rich|non-text/i)
})

test('same-session compression is off by default and refuses a foreign native engine', ready, async () => {
  const { options, writes } = fixture()
  assert.equal((await compactSession({ ...options, config: {} })).status, 'disabled')
  assert.equal((await compactSession({ ...options, nativeCompaction: {} })).status, 'unsupported')
  assert.equal(writes.length, 0)
})

test('full evidence is checkpointed before actual adjacent native prune/replacement events', ready, async () => {
  const { options, events, writes, nodes, order } = fixture()
  const original = structuredClone(events[2])
  const outcome = await compactSession(options)
  assert.equal(outcome.status, 'compacted')
  assert.equal(writes[0].type, 'compaction/prune')
  assert.equal(writes[1].type, 'tool/result')
  assert.deepEqual(events[2], original)
  assert.deepEqual(structuredClone(writes[1].surfaceOp), { op: 'replace', startSeq: 2, endSeq: 2 })
  assert.deepEqual([...writes[1].sourceEventSeqs], [2])
  assert.equal(writes[1].data.message.toolCallId, 'call-1')
  assert.equal(writes[1].data.message.id, original.data.message.id)
  assert.match(writes[1].data.message.content[0].text, /src_2/)
  assert.match(writes[1].data.message.content[0].text, /src_retrieval/)
  assert.match(writes[1].data.message.content[0].text, /Still unverified/)
  assert.equal(nodes.includes(0), true)
  assert.equal(nodes.includes(4), true, 'recent result remains verbatim')
  assert.ok(order.indexOf('durable') < order.indexOf('source:2'))
  assert.equal(order.at(-1), 'durable')
})

test('checkpoint failure or missing durable source never replaces history', ready, async () => {
  const a = fixture()
  await assert.rejects(compactSession({ ...a.options, checkpoint: async () => { throw new Error('disk full') } }), /disk full/)
  assert.equal(a.writes.length, 0)
  const b = fixture()
  const outcome = await compactSession({ ...b.options, evidenceForEvent: async () => ({ ids: [], sessionId: 's', sourceSeq: 2, durable: false }) })
  assert.equal(outcome.status, 'limited')
  assert.equal(b.writes.length, 0)
})

test('post-commit durability failure compensates the native surface back to full originals', ready, async () => {
  const f = fixture(), original = f.events[2].data.message
  const initialSeq = f.session.seq
  let attempts = 0
  await assert.rejects(compactSession({ ...f.options, checkpoint: async () => {
    attempts++
    if (f.session.seq > initialSeq) throw new Error('post-commit disk full')
  } }), error => {
    assert.equal(error.originalHistoryRetained, true)
    assert.equal(error.surfaceRestored, true)
    assert.equal(error.recoveryCheckpointDurable, false)
    return /post-commit disk full/.test(String(error))
  })
  assert.ok(attempts >= 4)
  assert.deepEqual(f.session.deriveEventMessage(f.events[f.nodes[2]]), original)
  assert.equal(f.writes.length, 4)
  assert.equal(f.writes[2].type, 'compaction/prune')
  assert.equal(f.writes[3].surfaceOp.startSeq, f.writes[1].seq)
  assert.equal(f.writes[3].data.message.toolCallId, original.toolCallId)
})

test('post-commit failure with superseded replacement refuses to claim the original live surface', ready, async () => {
  const f = fixture(), initialSeq = f.session.seq
  await assert.rejects(compactSession({ ...f.options, checkpoint: async () => {
    if (f.session.seq > initialSeq) {
      f.nodes.splice(f.nodes.indexOf(initialSeq + 1), 1)
      throw new Error('concurrent post-commit failure')
    }
  } }), error => {
    assert.equal(error.originalHistoryRetained, false)
    assert.equal(error.surfaceRestored, false)
    return true
  })
})

test('cross-session receipts, missing host token meter and stale surfaces fail closed', ready, async () => {
  const a = fixture()
  const refused = await compactSession({ ...a.options, evidenceForEvent: async event => ({ ids: ['wrong'], sessionId: 'secret', sourceSeq: event.seq, durable: true }) })
  assert.equal(refused.status, 'limited')
  assert.equal(a.writes.length, 0)
  const b = fixture()
  assert.equal((await compactSession({ ...b.options, estimateMessage: undefined })).status, 'unsupported')
  const c = fixture()
  const outcome = await compactSession({ ...c.options, checkpoint: async () => { c.session.surface.replaceGeneration++ } })
  assert.equal(outcome.status, 'limited')
  assert.equal(c.writes.length, 0)
})

test('unpaired tool results are never compacted', ready, async () => {
  const { options, events, writes } = fixture()
  events[1].data.message.content = []
  assert.equal((await compactSession(options)).status, 'limited')
  assert.equal(writes.length, 0)
})

test('native token-meter price must decrease even when the local heuristic predicts savings', ready, async () => {
  const { options, writes } = fixture()
  const outcome = await compactSession({ ...options, estimateMessage: message => message.content[0].text.startsWith('[Ultra stored') ? 500 : 10 })
  assert.equal(outcome.status, 'limited')
  assert.equal(writes.length, 0)
})

test('all-user oversized history reports the remaining overage without calling a model', ready, async () => {
  const { options, events, nodes, writes } = fixture()
  events.splice(0, events.length, human(0, 'Exact non-negotiable user instruction. '.repeat(2000)))
  nodes.splice(0, nodes.length, 0)
  const outcome = await compactSession(options)
  assert.equal(outcome.status, 'limited')
  assert.equal(outcome.after.withinBudget, false)
  assert.equal(writes.length, 0)
})

test('real rc.2 Session accepts replacement, preserves paired protocol, and replays the complete raw log', ready, async () => {
  const { Session, SessionId } = await import('@deepseek-ai/dsh-session')
  const { createUserMessage, createAssistantMessage, createMessage, ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const { events, options } = fixture()
  const session = Session.create(SessionId('s'))
  const log = []
  const append = session.append.bind(session)
  session.append = (...args) => { const event = append(...args); log.push(event); return event }
  session.append('user/message', createUserMessage({ content: events[0].data.content, source: { kind: 'user' } }), { surfaceOp: 'append' })
  for (const [callId, text] of [['call-1', 'FULL_ORIGINAL_TOOL_RESULT '.repeat(1500)], ['call-2', 'RECENT_RESULT_MUST_REMAIN']]) {
    session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({
      content: [{ type: 'tool-call', id: ToolCallId(callId), name: 'read', arguments: '{}' }], source: { provider: 'offline', model: 'fixture' },
    }) }, { surfaceOp: 'append' })
    session.append('tool/result', { turn: 1, step: 1, message: createMessage({ role: 'tool', source: { kind: 'tool', callId: ToolCallId(callId) }, toolCallId: ToolCallId(callId), content: [{ type: 'text', text }] }) }, { surfaceOp: 'append' })
  }
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Keep exact obligations.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const outcome = await compactSession({ ...options, session, readEvents: async () => [...log] })
  assert.equal(outcome.status, 'compacted')
  assert.match(log[2].data.message.content[0].text, /FULL_ORIGINAL_TOOL_RESULT/)
  const projected = session.deriveMessages()
  assert.equal(projected.filter(message => message.role === 'tool').length, 2)
  assert.match(projected.find(message => message.role === 'tool').content[0].text, /src_2/)
  const restored = Session.create(SessionId('s'), log, session.header)
  assert.deepEqual(restored.deriveMessages(), projected)
  assert.deepEqual(restored.surface.nodes, session.surface.nodes)
})
