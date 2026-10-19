import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const api = await import('../lib/memory-host.js').catch(() => ({}))
const enabled = { skip: !api.UltraMemoryHost }
function fixture(t, config = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-host-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const agents = new Map(), logs = new Map(), hooks = new Map()
  const persistence = { async open(id, access) {
    assert.equal(access, 'read')
    const a = agents.get(id), log = logs.get(id)
    if (!a || !log) throw new Error('not found')
    return { header: a.session.header, async read(from = 0, length = 128) { return { events: log.slice(from, from + length) } }, async close() {} }
  } }
  const services = { sessionPersistence: persistence, sessions: { async flush() { return true } }, agents: { get: id => agents.get(id) } }
  const ctx = { root: null, get: key => services[key], on: (name, fn) => { hooks.set(name, fn); return () => hooks.delete(name) } }; ctx.root = ctx
  function agent(id, parentSession, project = cwd) {
    const log = []; logs.set(id, log)
    const a = { id, ctx, session: { id, header: { id, cwd: project, parentSession }, get seq() { return log.length }, deriveMessages() { return log.flatMap(e => e.data.message ? [e.data.message] : e.type === 'user/message' ? [e.data] : []) } } }
    agents.set(id, a); return a
  }
  const root = agent('root')
  const host = new api.UltraMemoryHost(ctx, { evidenceEnabled: true, memorySearchChars: 4000, memoryGetChars: 6000, ...config })
  function event(a, type, data) { const e = { type, seq: logs.get(a.id).length, time: Date.now(), data }; logs.get(a.id).push(e); return e }
  return { cwd, ctx, host, root, agent, event, logs, agents, hooks }
}
test('exports the host-owned evidence adapter', () => assert.equal(typeof api.UltraMemoryHost, 'function'))

test('global retrieval text is not recaptured as a new local source for onward publication', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'retrieval-provenance')
  for (const name of ['ultra_knowledge_search', 'ultra_knowledge_get']) {
    const callId = 'global-' + name
    assert.deepEqual(run.captureTool(f.root, callId, name, { content: [{ type: 'text', text: 'Shared A-only material' }] }), [])
    assert.deepEqual(run.captureEvent(f.root.session, f.event(f.root, 'tool/call', { callId, name, arguments: '{}' })), [])
    assert.deepEqual(run.captureEvent(f.root.session, f.event(f.root, 'tool/result', { message: { source: { callId }, content: [{ type: 'text', text: 'Shared A-only material' }] } })), [])
  }
  assert.equal([...run.store.recordsFor(run.access())].length, 0)
  await run.dispose()
})

test('verified citation distinguishes the executed read resource from IDs inside its body', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'citation')
  run.captureEvent(f.root.session, f.event(f.root, 'tool/call', { name: 'fixture_read', callId: 'read-1', arguments: JSON.stringify({ id: 'vendor-a' }) }))
  const [id] = run.captureTool(f.root, 'read-1', 'fixture_read', { content: [{ type: 'text', text: 'Source A-2026-10-15\nRelease = Tuesday 09:30' }] })
  const got = await f.host.get(f.root, id, { quote: 'Release = Tuesday 09:30' })
  assert.equal(got.citation.origin.resourceId, 'vendor-a')
  assert.equal(got.citation.sourceId, id)
  await run.dispose()
})

test('a result first captured after restart restores its durable call resource locator', enabled, async t => {
  const f=fixture(t), run=await f.host.begin(f.root,'before-result')
  run.captureEvent(f.root.session,f.event(f.root,'tool/call',{name:'fixture_read',callId:'pending-read',arguments:JSON.stringify({id:'vendor-b'})}))
  await run.dispose()
  const host=new api.UltraMemoryHost(f.ctx,{evidenceEnabled:true}), resumed=await host.begin(f.root,'after-result')
  const [id]=resumed.captureTool(f.root,'pending-read','fixture_read',{content:[{type:'text',text:'Body alias B-2026\nRelease = Thursday'}]})
  const got=await host.get(f.root,id,{quote:'Release = Thursday'})
  assert.equal(got.citation.origin.resourceId,'vendor-b')
  await resumed.dispose()
})
test('worker discovery survives progress truncation and decision can fetch the original tail', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  const w = f.agent('worker', 'root'), d = f.agent('decision', 'root')
  run.bind(w, 'worker-1'); run.bind(d, 'decision')
  const text = 'ordinary output '.repeat(900) + ' SECRET_TAIL_FIXTURE_42'
  const e = f.event(w, 'tool/result', { message: { content: [{ type: 'text', text }], source: { callId: 'call' } } })
  const ids = run.captureEvent(w.session, e)
  const result = await f.host.search(d, { query: 'SECRET_TAIL_FIXTURE_42' })
  assert.ok(result.items.length)
  assert.match((await f.host.get(d, ids[0], { offset: text.length - 80 })).text, /SECRET_TAIL_FIXTURE_42/)
  assert.match(run.entry(), /ultra_memory_search/)
  await run.dispose()
})
test('different projects, unrelated roots, forged callers and unbound tools cannot read evidence', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  const e = f.event(f.root, 'user/message', { content: [{ type: 'text', text: 'private root constraint' }], source: { kind: 'user' } })
  const [id] = run.captureEvent(f.root.session, e)
  const other = f.agent('other'), outsider = f.agent('outside', undefined, os.tmpdir())
  for (const a of [other, outsider, { ...f.root }]) await assert.rejects(f.host.get(a, id), /access|bound|caller/i)
  assert.throws(() => run.bind(outsider, 'forged'), /project|lineage/i)
  assert.throws(() => run.bind(f.agent('prototype-child', 'toString'), 'forged'), /lineage/i)
  await run.dispose()
})
test('restart reloads only the same root grants and original evidence IDs', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  const e = f.event(f.root, 'user/message', { content: [{ type: 'text', text: 'once-only restriction' }], source: { kind: 'user' } })
  const [id] = run.captureEvent(f.root.session, e); await run.dispose()
  const again = new api.UltraMemoryHost(f.ctx, { evidenceEnabled: true })
  const resumed = await again.begin(f.root, 'run2')
  assert.match((await again.get(f.root, id)).text, /once-only/)
  assert.equal((await again.search(f.root, { query: 'once-only' })).items.filter(item => !item.semanticStatus).length, 1)
  await resumed.dispose()
})
test('checkpoint retries a missed worker event and advances its durable coverage without duplicate sources', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'retry-worker')
  const worker = f.agent('retry-worker', 'root'); run.bind(worker, 'worker-1')
  const event = f.event(worker, 'tool/result', { message: { content: [{ type: 'text', text: 'TRANSIENT_WORKER_EVIDENCE_731' }], source: { callId: 'retry-read' } } })
  const capture = run.store.capture.bind(run.store)
  let unavailable = true
  run.store.capture = input => {
    if (unavailable && input.sessionId === worker.id) throw new Error('temporary source write failure')
    return capture(input)
  }
  assert.deepEqual(run.captureEvent(worker.session, event), [])
  unavailable = false
  assert.equal((await f.host.search(f.root, { query: 'TRANSIENT_WORKER_EVIDENCE_731' })).items.length, 0)
  await run.checkpoint()
  const found = await f.host.search(f.root, { query: 'TRANSIENT_WORKER_EVIDENCE_731' })
  assert.equal(found.items.length, 1, 'durable worker log is the independent retry path')
  assert.equal(found.items[0].routeId, 'worker-1')
  assert.match((await f.host.get(f.root, found.items[0].sourceId)).text, /TRANSIENT_WORKER_EVIDENCE_731/)
  assert.deepEqual(run.status().scan.find(row => row.sessionId === worker.id), { sessionId: worker.id, availableEvents: 1, indexedThrough: 1 })
  await run.checkpoint()
  assert.equal((await f.host.search(f.root, { query: 'TRANSIENT_WORKER_EVIDENCE_731' })).items.length, 1)
  await run.dispose()
})
test('fresh host recovery audits authorized historical child logs missed before cancellation', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'before-cancel')
  const worker = f.agent('cancelled-worker', 'root'); run.bind(worker, 'worker-2')
  f.event(worker, 'tool/result', { message: { content: [{ type: 'text', text: 'MISSED_CHILD_RECOVERY_731' }], source: { callId: 'cancelled-read' } } })
  run.rollback() // Cancellation/crash before the observer or final checkpoint indexed this event.
  const host = new api.UltraMemoryHost(f.ctx, { evidenceEnabled: true })
  const resumed = await host.begin(f.root, 'after-cancel'); assert.ok(resumed)
  const found = await host.search(f.root, { query: 'MISSED_CHILD_RECOVERY_731' })
  assert.equal(found.items.length, 1, 'verified lineage grants must also restore raw child evidence')
  assert.equal(found.items[0].routeId, 'worker-2')
  assert.equal(resumed.store.recordsFor(resumed.access()).find(row => row.id === found.items[0].sourceId).runId, 'before-cancel', 'recovered source keeps its originating run provenance')
  assert.match((await host.get(f.root, found.items[0].sourceId)).text, /MISSED_CHILD_RECOVERY_731/)
  await resumed.checkpoint()
  assert.equal((await host.search(f.root, { query: 'MISSED_CHILD_RECOVERY_731' })).items.length, 1)
  await resumed.dispose()
})
test('pre-log tools are promoted to host references only after full durable text matches', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  const text = 'tail '.repeat(1000) + 'unique-ending'
  const ids = run.captureTool(f.root, 'call', 'read', { content: [{ type: 'text', text }] })
  const e = f.event(f.root, 'tool/result', { message: { content: [{ type: 'text', text }], source: { callId: 'call' } } })
  run.captureEvent(f.root.session, e); await run.dispose()
  assert.match((await f.host.get(f.root, ids[0], { offset: text.length - 30 })).text, /unique-ending/)
  const bytes = fs.readdirSync(path.join(f.cwd, '.dsh-ultra', 'v1', 'records')).map(n => fs.readFileSync(path.join(f.cwd, '.dsh-ultra', 'v1', 'records', n), 'utf8')).join('')
  assert.equal(bytes.includes(text), false)
})
test('usage separates disjoint cache counts, unknowns and request estimates without reading reasoning', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  const e = f.event(f.root, 'assistant/message', { message: { content: [{ type: 'thinking', text: 'NEVER_INDEX_PRIVATE_THOUGHT' }, { type: 'text', text: 'public report' }] }, usage: { inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 5, outputTokens: 7, reasoningTokens: 3, totalTokens: 42 }, turn: 1, step: 1 })
  run.captureEvent(f.root.session, e); run.captureEvent(f.root.session, e)
  const status = run.status()
  assert.equal(status.resources.measuredTokens, 42)
  assert.equal(status.resources.settledCalls, 1)
  assert.equal((await f.host.search(f.root, { query: 'NEVER_INDEX_PRIVATE_THOUGHT' })).items.length, 0)
  await run.dispose()
})
test('disabled feature neither creates files nor adds a run', enabled, async t => {
  const f = fixture(t, { evidenceEnabled: false })
  assert.equal(await f.host.begin(f.root, 'off'), undefined)
  assert.equal(fs.existsSync(path.join(f.cwd, '.dsh-ultra')), false)
})
test('failed attempts retain exact usage without indexing private stream contents', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  const e = f.event(f.root, 'assistant/attempt', { turn: 1, step: 1, stream: [
    { type: 'reasoning-chunks', texts: ['DO_NOT_INDEX_ATTEMPT_THOUGHT'] },
    { type: 'chunk', time: Date.now(), chunk: { type: 'usage', usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 2, totalTokens: 9 } } },
  ] })
  run.captureEvent(f.root.session, e)
  assert.equal(run.status().resources.measuredTokens, 9)
  assert.equal(run.status().resources.unknownUsageCalls, 0)
  assert.equal((await f.host.search(f.root, { query: 'DO_NOT_INDEX_ATTEMPT_THOUGHT' })).items.length, 0)
  await run.dispose()
})
for (const finish of ['aborted', 'error', undefined]) test(`zero usage on a failed ${finish ?? 'unterminated'} attempt remains unknown and reserved`, enabled, async t => {
  const f = fixture(t, { memoryMaxTokens: 10000 }), run = await f.host.begin(f.root, 'failed-zero')
  run.observeRequest(f.root, { messages: [{ content: 'bounded request' }] })
  const reserved = run.status().resources.reservedEstimatedTokens
  assert.ok(reserved > 0)
  const e = f.event(f.root, 'assistant/attempt', { turn: 1, step: 1, stream: [
    { type: 'chunk', time: Date.now(), chunk: { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } },
    ...(finish ? [{ type: 'chunk', time: Date.now(), chunk: { type: 'finish', reason: { kind: finish } } }] : []),
  ] })
  run.captureEvent(f.root.session, e); run.captureEvent(f.root.session, e)
  const status = run.status().resources
  assert.equal(status.settledCalls, 1)
  assert.equal(status.unknownUsageCalls, 1, 'a local zero on an incomplete attempt cannot attest free upstream execution')
  assert.equal(status.reservedEstimatedTokens, reserved)
  assert.throws(() => run.observeRequest(f.root, { messages: [{ content: 'next request' }] }), /token budget/i)
  await run.dispose()
})

test('an interrupted message with zero usage retains its estimate while nonzero max-token usage settles exactly', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'interrupted-zero')
  run.observeRequest(f.root, { messages: [{ content: 'first request' }] })
  const reserved = run.status().resources.reservedEstimatedTokens
  run.captureEvent(f.root.session, f.event(f.root, 'assistant/message', { turn: 1, step: 1, interrupted: true,
    message: { content: [{ type: 'text', text: 'partial public reply' }] },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, stream: [] }))
  assert.equal(run.status().resources.unknownUsageCalls, 1)
  assert.equal(run.status().resources.reservedEstimatedTokens, reserved)
  run.observeRequest(f.root, { messages: [{ content: 'second request' }] })
  run.captureEvent(f.root.session, f.event(f.root, 'assistant/message', { turn: 1, step: 2,
    message: { content: [{ type: 'text', text: 'output reached its configured limit' }] },
    usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 2, totalTokens: 9 },
    stream: [{ type: 'chunk', time: Date.now(), chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }] }))
  assert.equal(run.status().resources.measuredTokens, 9)
  assert.equal(run.status().resources.unknownUsageCalls, 1)
  assert.equal(run.status().resources.reservedEstimatedTokens, reserved, 'only the known second call releases its estimate')
  await run.dispose()
})
test('failed initialization leaves no active binding or searchable half-created run', enabled, async t => {
  const f = fixture(t)
  f.ctx.get = key => key === 'sessions' ? { async flush() { throw new Error('disk offline') } } : key === 'agents' ? { get: id => f.agents.get(id) } : key === 'sessionPersistence' ? { open() { throw new Error('unreachable') } } : undefined
  assert.equal(await f.host.begin(f.root, 'failed'), undefined)
  assert.equal(api.memoryFor(f.root), undefined)
  await assert.rejects(f.host.search(f.root, { query: 'private' }), /access|bound/i)
})
test('actual admission reserves estimated in-flight tokens and counts system plus schemas', enabled, async t => {
  const f = fixture(t, { memoryMaxTokens: 15000 }), run = await f.host.begin(f.root, 'run')
  run.observeRequest(f.root, { system: 'mandatory '.repeat(1000), tools: [{ description: 'schema '.repeat(1000) }], messages: [{ content: 'request' }] })
  assert.ok(run.status().resources.estimates.sections.system > 0)
  assert.ok(run.status().resources.estimates.sections.tools > 0)
  assert.throws(() => run.observeRequest(f.root, { messages: [{ content: 'second '.repeat(2000) }] }), /token budget/i)
  await run.dispose()
})
test('latest human task and actual successful operations survive project state recovery', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  run.recordTask('keep offline and do not publish')
  const e = f.event(f.root, 'tool/result', { message: { content: [{ type: 'text', text: 'saved locally' }], source: { callId: 'write-file' } } })
  run.captureEvent(f.root.session, e)
  const state = run.store.projectState(run.access())
  assert.equal(state.goal, 'keep offline and do not publish')
  assert.equal(state.operations[0].status, 'executed')
  await run.dispose()
  const resumed = await f.host.begin(f.root, 'resume')
  assert.equal(resumed.store.projectState(resumed.access()).operations[0].status, 'executed')
  assert.equal((await f.host.search(f.root, { query: 'do not publish' })).items.filter(item => !item.semanticStatus).length, 1)
  await resumed.dispose()
})
test('operation readback includes original tool inputs and filename filters', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  run.recordTask('save the requested local file')
  run.captureEvent(f.root.session, f.event(f.root, 'tool/call', { callId: 'c', name: 'write', arguments: JSON.stringify({ file_path: 'src/rare-input.ts', content: 'requested content' }) }))
  run.captureEvent(f.root.session, f.event(f.root, 'tool/result', { message: { content: [{ type: 'text', text: 'done' }], source: { callId: 'c' } } }))
  const found = await f.host.search(f.root, { file: 'rare-input.ts', query: 'requested content' })
  assert.ok(found.items.length)
  const state = run.store.projectState(run.access())
  assert.equal(state.operations[0].sourceIds.length, 2)
  assert.match((await f.host.get(f.root, found.items[0].sourceId)).text, /rare-input.ts/)
  await run.dispose()
})
test('assist main receives a recovery entry again after native surface compression', enabled, async t => {
  const f = fixture(t), run = await f.host.begin(f.root, 'run')
  f.root.session.surface = { replaceGeneration: 0 }
  run.recordTask('EARLY_ONCE_NO_PUBLISH')
  await run.prepareSeed(f.root)
  assert.match(f.host.mainContext(f.root), /EARLY_ONCE_NO_PUBLISH/)
  assert.equal(f.host.mainContext(f.root), undefined)
  f.root.session.surface.replaceGeneration++
  assert.match(f.host.mainContext(f.root), /EARLY_ONCE_NO_PUBLISH/)
  await run.dispose()
})

async function compressionFixture(t) {
  const { Session, SessionId } = await import('@deepseek-ai/dsh-session')
  const { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const f = fixture(t, { contextCompression: true, contextTargetTokens: 4096 })
  const session = Session.create(SessionId('root'), undefined, { version: 4, id: SessionId('root'), createdAt: 1, isSeeded: false, cwd: f.cwd })
  const log = f.logs.get('root'), append = session.append.bind(session)
  session.append = (...args) => { const event = append(...args); log.push(event); return event }
  f.root.session = session
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Keep the original offline requirement.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const callId = ToolCallId('old-result')
  session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{}' }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'FULL_ORIGINAL '.repeat(6000) }], isError: false }) }, { surfaceOp: 'append' })
  for (let index = 0; index < 8; index++) session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Recent instruction ' + index }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const get = f.ctx.get
  let nativeCompaction
  f.ctx.get = name => name === 'tokenMeter' ? { estimateMessage: message => Math.ceil(JSON.stringify(message).length / 4) } : name === 'compaction' ? nativeCompaction : get(name)
  const run = await f.host.begin(f.root, 'compression-race')
  assert.ok(run, JSON.stringify(f.host.status(f.root.id)))
  t.after(() => run.dispose())
  return { ...f, run, session, mountNative: () => { nativeCompaction = {} } }
}

test('native compaction mounted during a durability checkpoint stops Ultra before replacing history', enabled, async t => {
  const f = await compressionFixture(t), checkpoint = f.run.checkpoint.bind(f.run)
  const seq = f.session.seq, nodes = [...f.session.surface.nodes]
  f.run.checkpoint = async () => { await checkpoint(); f.mountNative() }
  await f.host.beforeStep(f.root)
  assert.equal(f.session.seq, seq)
  assert.deepEqual(f.session.surface.nodes, nodes)
  assert.equal(f.run.status().compression.status, 'limited')
  assert.match(f.run.status().compression.limits.join(' '), /authority|surface/i)
})

test('native step cancellation during a durability checkpoint retains the original surface', enabled, async t => {
  const f = await compressionFixture(t), checkpoint = f.run.checkpoint.bind(f.run)
  const abort = new AbortController(), seq = f.session.seq, nodes = [...f.session.surface.nodes]
  f.run.checkpoint = async () => { await checkpoint(); abort.abort(new Error('native step cancelled')) }
  await f.host.beforeStep(f.root, [], abort.signal)
  assert.equal(f.session.seq, seq)
  assert.deepEqual(f.session.surface.nodes, nodes)
  assert.match(f.run.status().errors.join(' '), /native step cancelled/)
})

test('authority suspension during an in-flight compression checkpoint retains original history', enabled, async t => {
  const f = await compressionFixture(t), checkpoint = f.run.checkpoint.bind(f.run)
  const seq = f.session.seq, nodes = [...f.session.surface.nodes]
  f.run.checkpoint = async () => { await checkpoint(); f.host.config.evidenceEnabled = false; f.host.refreshAuthority() }
  await f.host.beforeStep(f.root)
  assert.equal(f.session.seq, seq)
  assert.deepEqual(f.session.surface.nodes, nodes)
  assert.match(f.run.status().errors.join(' '), /authority suspended/)
  assert.equal(f.run.entry(), '')
})

test('native pruning replacements do not create false raw evidence coverage gaps', enabled, async t => {
  const f = await compressionFixture(t)
  await f.host.beforeStep(f.root)
  assert.equal(f.run.status().compression.status, 'compacted')
  await f.run.checkpoint()
  assert.deepEqual(f.run.status().coverageGaps, [], 'replacement previews must retain the canonical original locator')
})

test('recovered transient source failures do not permanently forbid otherwise durable compression', enabled, async t => {
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
  const f = await compressionFixture(t), capture = f.run.store.capture.bind(f.run.store)
  const event = f.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Recovered exact user constraint.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  f.run.store.capture = () => { throw new Error('resolved transient record failure') }
  assert.deepEqual(f.run.captureEvent(f.session, event), [])
  f.run.store.capture = capture
  await f.run.checkpoint()
  await f.host.beforeStep(f.root)
  assert.equal(f.run.status().compression.status, 'compacted', 'successful current durability audit is independent of historical diagnostics')
  assert.match(f.run.status().errors.join(' '), /resolved transient record failure/, 'the historical failure remains visible')
})

test('host reports restored surface and durability honestly after a post-commit checkpoint failure', enabled, async t => {
  const f = await compressionFixture(t), checkpoint = f.run.checkpoint.bind(f.run)
  let failed = false
  f.run.checkpoint = async () => {
    await checkpoint()
    if (!failed && f.session.surface.replaceGeneration > 0) { failed = true; throw new Error('post-commit checkpoint failure') }
  }
  await f.host.beforeStep(f.root)
  const outcome = f.run.status().compression
  assert.equal(failed, true)
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.originalHistoryRetained, true)
  assert.equal(outcome.surfaceRestored, true)
  assert.equal(outcome.recoveryCheckpointDurable, true)
  assert.equal(outcome.replacements.length, 1)
  assert.match(f.session.deriveMessages().find(message => message.role === 'tool').content[0].text, /FULL_ORIGINAL/)
})
