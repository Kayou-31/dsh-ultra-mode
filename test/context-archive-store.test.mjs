import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { isTaskMemorySnapshot } from '../lib/task-memory-context.js'

const require = createRequire(import.meta.url)
function load(overrides = {}) {
  const exports = {}
  const source = new URL('../src/context-archive-store.ts', import.meta.url)
  if (fs.existsSync(source)) vm.runInNewContext(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: name => overrides[name] ?? (name === './task-memory-context.js' ? { isTaskMemorySnapshot } : require(name)), Buffer, structuredClone, AbortSignal, Set, Map, Error, TypeError, Number, Math, JSON, process })
  return exports
}
const { ContextArchiveStore, verifyArchiveEnvelope } = load()
const enabled = { skip: typeof ContextArchiveStore !== 'function' }
const access = { projectId: 'project-a', sessionIds: ['session-a'] }
const human = (seq, text, source = { kind: 'user' }) => ({ seq, time: seq + 10, type: 'user/message', surfaceOp: 'append', data: { id: `m${seq}`, role: 'user', source, content: [{ type: 'text', text }] } })
const assistant = (seq, text = 'I inspected the file.', name = 'read', args = '{"path":"exact original.json"}') => ({ seq, time: seq + 10, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, stream: [{ private: 'STREAM_SECRET' }], message: { id: `m${seq}`, role: 'assistant', source: { kind: 'model', provider: 'offline', model: 'fixture', replayState: 'REPLAY_SECRET' }, content: [{ type: 'reasoning', text: 'THINKING_SECRET' }, { type: 'text', text }, { type: 'tool-call', id: `call-${seq}`, name, arguments: args }] } } })
const result = (seq, callId, text) => ({ seq, time: seq + 10, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, meta: { private: 'META_SECRET' }, message: { id: `m${seq}`, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }] } } })
function fixture(t, events, Class = ContextArchiveStore, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-archive-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const reads = []; let allowed = true
  const options = { projectId: 'project-a', authorize: () => allowed, readEvents: async (sessionId, from, length) => {
    assert.equal(sessionId, 'session-a'); reads.push([from, length]); return events.slice(from, from + length)
  }, ...extra }
  return { directory, reads, options, store: Class && new Class(directory, options), revoke: () => { allowed = false } }
}
const unpack = value => JSON.parse(JSON.stringify(value))

test('archive store exposes durable metadata-only preparation and read-through pagination', () => assert.equal(typeof ContextArchiveStore, 'function'))

test('only exact Ultra native snapshots leave capsules while raw and mixed contexts remain recoverable',enabled,async t=>{
  const text='OLD_TASK_SNAPSHOT_451', prefix='Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n'
  const own=human(0,prefix+text,{kind:'runtime-context',form:'snapshot',sections:[{name:'ultra-task-memory',text}]})
  const mixed=human(1,'Mixed context must remain',{kind:'runtime-context',form:'snapshot',sections:[{name:'ultra-task-memory',text},{name:'other-plugin',text:'Keep other context'}]})
  const forged=human(2,'Metadata does not match this body',{kind:'runtime-context',form:'snapshot',sections:[{name:'ultra-task-memory',text}]})
  const events=[own,mixed,forged,human(3,'Never delete originals')],f=fixture(t,events)
  assert.equal(isTaskMemorySnapshot(own),true)
  assert.equal(isTaskMemorySnapshot(mixed),false)
  assert.equal(isTaskMemorySnapshot(forged),false)
  const receipt=await f.store.prepare(access,{sessionId:'session-a',events,currentStateText:'Current state'})
  assert.equal(receipt.text.includes(prefix+text),false)
  for(const value of ['Mixed context must remain','Metadata does not match this body','Never delete originals']) assert.ok(receipt.text.includes(value))
  let full='',offset=0
  do {const page=await f.store.get(access,receipt.id,{offset,maxChars:4000});full+=page.text;offset=page.nextOffset}while(offset!==undefined)
  assert.match(full,/OLD_TASK_SNAPSHOT_451/)
})

test('preparation preserves literal user/control/public assistant text and original tools only in read-through', enabled, async t => {
  const events = [human(0, 'Never publish.\nKeep "literal" text.\\path'), assistant(1), result(2, 'call-1', 'TOOL_BODY_TAIL '.repeat(1000)), human(3, 'New constraint: offline only.', { kind: 'host-notice' })]
  const f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: 'planned: verify; executed: read; verified: none' })
  assert.match(prepared.id, /^arc_[a-f0-9]{64}$/)
  assert.equal(prepared.durable, true)
  assert.deepEqual(unpack(prepared.sourceSeqs), [0, 1, 2, 3])
  assert.ok(prepared.text.includes('Never publish.\nKeep "literal" text.\\path'))
  assert.ok(prepared.text.includes('New constraint: offline only.'))
  assert.ok(prepared.text.includes('I inspected the file.'))
  assert.equal(prepared.text.includes('TOOL_BODY_TAIL'), false)
  assert.equal(prepared.text.includes('exact original.json'), false)
  const encoded = fs.readdirSync(path.join(f.directory, 'archives')).map(name => fs.readFileSync(path.join(f.directory, 'archives', name), 'utf8')).join('')
  for (const secret of ['Never publish.', 'TOOL_BODY_TAIL', 'I inspected', 'STREAM_SECRET', 'REPLAY_SECRET', 'THINKING_SECRET', 'META_SECRET']) assert.equal(encoded.includes(secret), false)
  let full = '', offset = 0
  do {
    const page = await f.store.get(access, prepared.id, { offset, maxChars: 1700 })
    assert.ok(JSON.stringify(page).length <= 1700)
    assert.equal(page.contextArchive, true)
    assert.equal(page.citation, undefined)
    full += page.text; offset = page.nextOffset
  } while (offset !== undefined)
  const transcript = JSON.parse(full)
  assert.equal(transcript.length, 4)
  assert.equal(transcript[1].data.message.content.find(block => block.type === 'tool-call').arguments, '{"path":"exact original.json"}')
  assert.ok(full.includes('TOOL_BODY_TAIL'))
  for (const secret of ['STREAM_SECRET', 'REPLAY_SECRET', 'THINKING_SECRET', 'META_SECRET']) assert.equal(full.includes(secret), false)
})

test('ACL rejects other projects, ungranted sessions and revoked access before host reads', enabled, async t => {
  const events = [human(0, 'PRIVATE_USER_TEXT')], f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  f.reads.length = 0
  for (const denied of [{ projectId: 'project-b', sessionIds: ['session-a'] }, { projectId: 'project-a', sessionIds: [] }]) await assert.rejects(f.store.get(denied, prepared.id), /access/i)
  f.revoke()
  await assert.rejects(f.store.get(access, prepared.id), /access/i)
  assert.equal(f.reads.length, 0)
})

test('get verifies only the returned page events, reports page verification and rejects altered originals', enabled, async t => {
  const events = [human(0, 'Initial restriction. '.repeat(100)), assistant(1), result(2, 'call-1', 'LARGE_BODY '.repeat(250000))], f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  f.reads.length = 0
  const first = await f.store.get(access, prepared.id, { maxChars: 1100 })
  assert.equal(first.verification, 'returned-events')
  assert.equal(f.reads.some(([from]) => from === 2), false)
  const next = await f.store.get(access, prepared.id, { offset: first.nextOffset, maxChars: 3000 })
  assert.ok(next.text.length > 0)
  events[2].data.message.content[0].text += 'tampered'
  await assert.rejects(f.store.get(access, prepared.id, { offset: first.length - 1000, maxChars: 3000 }), /integrity|changed|hash/i)
})

test('repeated preparation flattens only validated host checkpoints without copying prior state or tool bodies', enabled, async t => {
  const events = [human(0, 'One original restriction.'), assistant(1, 'One public operation receipt.'), result(2, 'call-1', 'HUGE_ORIGINAL '.repeat(3000))], f = fixture(t, events)
  const first = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: 'OLD_STATE_MUST_NOT_NEST' })
  events.push({ ...human(3, first.text, { kind: 'compact-checkpoint', compactionId: first.id }), sourceEventSeqs: [0, 1, 2], surfaceOp: { op: 'replace', startSeq: 0, endSeq: 2 } }, human(4, 'Later exact restriction.'))
  f.reads.length = 0
  const second = await f.store.prepare(access, { sessionId: 'session-a', events: events.slice(3), currentStateText: 'CURRENT_STATE' })
  assert.deepEqual(unpack(second.flatSeqs), [0, 1, 2, 4])
  assert.equal(second.text.split('One original restriction.').length - 1, 1)
  assert.equal(second.text.includes('OLD_STATE_MUST_NOT_NEST'), false)
  assert.equal(second.text.includes('One public operation receipt.'), true)
  assert.equal(f.reads.some(([from]) => from === 2), false, 'old large tool body is not read again while flattening')
  const pasted = human(5, first.text)
  events.push(pasted)
  const third = await f.store.prepare(access, { sessionId: 'session-a', events: [pasted], currentStateText: '' })
  assert.deepEqual(unpack(third.flatSeqs), [5])
  assert.ok(third.text.includes('OLD_STATE_MUST_NOT_NEST'), 'a human quotation remains literal user text')
})

test('checkpoint source spoofing, wrong capsule body, missing sources and cross-session manifests fail closed', enabled, async t => {
  const events = [human(0, 'restriction')], f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  for (const checkpoint of [
    { ...human(1, prepared.text + ' altered', { kind: 'compact-checkpoint', compactionId: prepared.id }), sourceEventSeqs: [0] },
    { ...human(1, prepared.text, { kind: 'compact-checkpoint', compactionId: prepared.id }), sourceEventSeqs: [] },
    { ...human(1, prepared.text, { kind: 'compact-checkpoint', compactionId: 'arc_' + 'a'.repeat(64) }), sourceEventSeqs: [0] },
  ]) {
    events[1] = checkpoint
    await assert.rejects(f.store.prepare(access, { sessionId: 'session-a', events: [checkpoint], currentStateText: '' }), /archive|checkpoint|integrity|source/i)
  }
})

test('tool result prune aliases resolve original text and preserve original call arguments', enabled, async t => {
  const events = [human(0, 'constraint'), assistant(1, 'Done', 'ultra_memory_get', '{"id":"original-ref","quote":"EXACT_QUOTE"}'), result(2, 'call-1', 'ORIGINAL_TAIL_MARKER')]
  events.push({ ...result(3, 'call-1', '[Ultra stored tool evidence]'), sourceEventSeqs: [2], surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } })
  const f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events: [events[0], events[1], events[3]], currentStateText: '' })
  assert.deepEqual(unpack(prepared.flatSeqs), [0, 1, 2])
  const full = (await f.store.get(access, prepared.id, { maxChars: 10000 })).text
  assert.ok(full.includes('ORIGINAL_TAIL_MARKER'))
  assert.ok(full.includes('EXACT_QUOTE'))
  assert.equal(full.includes('[Ultra stored tool evidence]'), false)
})

test('all knowledge name prefixes and rich unsupported input refuse archive preparation', enabled, async t => {
  for (const name of ['ultra_knowledge_get', 'memory_knowledge_search', 'decision_knowledge_publish', 'knowledge_revoke']) {
    const events = [assistant(0, 'public', name), result(1, 'call-0', 'SHARED_KNOWLEDGE_BODY')], f = fixture(t, events)
    await assert.rejects(f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' }), /knowledge/i)
    assert.equal(fs.readdirSync(path.join(f.directory, 'archives')).length, 0)
  }
  const event = human(0, 'attachment'); event.data.content.push({ type: 'image', attachment: { attachmentId: 'att_safe', savedPath: '/safe/ref.png' } })
  const f = fixture(t, [event])
  await assert.rejects(f.store.prepare(access, { sessionId: 'session-a', events: [event], currentStateText: '' }), /rich|unsupported|attachment/i)
})

test('manifest is immutable and restart-safe; partial temp files do not activate and corruption is rejected', enabled, async t => {
  const events = [human(0, 'original')], f = fixture(t, events)
  const input = { sessionId: 'session-a', events, currentStateText: 'state' }
  const one = await f.store.prepare(access, input)
  assert.equal((await f.store.prepare(access, input)).id, one.id)
  fs.writeFileSync(path.join(f.directory, 'archives', '.incomplete.tmp-dead'), '{')
  const reopened = new ContextArchiveStore(f.directory, f.options)
  assert.ok((await reopened.get(access, one.id)).text.includes('original'))
  const file = path.join(f.directory, 'archives', one.id + '.json'), original = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, original.replace('project-a', 'project-b'))
  await assert.rejects(reopened.get(access, one.id), /integrity|checksum|hash/i)
  await assert.rejects(reopened.prepare(access, input), /integrity|checksum|hash/i)
  assert.equal(fs.readFileSync(file, 'utf8').includes('project-b'), true, 'corrupt immutable file was not overwritten')
})

test('cancel and authorization loss during reads never publish a usable manifest or expose text', enabled, async t => {
  const events = [human(0, 'secret')], f = fixture(t, events)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '', signal: abort.signal }), /abort/i)
  assert.equal(fs.existsSync(path.join(f.directory, 'archives')), false)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  f.options.readEvents = async () => { f.revoke(); return events }
  await assert.rejects(f.store.get(access, prepared.id), /access/i)
})

test('constructor and an unknown archive get perform no directory or manifest writes', enabled, async t => {
  const f = fixture(t, [human(0, 'restricted')])
  assert.deepEqual(fs.readdirSync(f.directory), [])
  await assert.rejects(f.store.get(access, 'arc_' + 'f'.repeat(64)), /ENOENT|unavailable|not found/i)
  assert.deepEqual(fs.readdirSync(f.directory), [])
})

test('cold capsule verification authenticates canonical host source, literal body, coverage and project scope', enabled, async t => {
  const events = [human(0, 'original human control')], f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: 'current' })
  const checkpoint = { ...human(1, prepared.text, { kind: 'compact-checkpoint', compactionId: prepared.id }), sourceEventSeqs: [0], surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 } }
  events.push(checkpoint)
  const cold = new ContextArchiveStore(f.directory, f.options)
  const verified = await cold.verifyCapsule(access, checkpoint)
  assert.equal(verified.id, prepared.id)
  assert.equal(verified.manifestSha256, prepared.sha256)
  assert.deepEqual(unpack(verified.flatSeqs), [0])
  assert.equal(verified.text, undefined)
  await assert.rejects(cold.verifyCapsule(access, human(1, prepared.text)), /checkpoint|canonical|source/i)
  events[1] = { ...checkpoint, data: { ...checkpoint.data, content: [{ type: 'text', text: prepared.text + 'wrong' }] } }
  await assert.rejects(cold.verifyCapsule(access, events[1]), /integrity|body|checksum/i)
  await assert.rejects(cold.verifyCapsule({ projectId: 'foreign', sessionIds: ['session-a'] }, checkpoint), /access/i)
})

test('offline sealed-envelope verifier rejects unknown fields and yields only metadata for independent auditing', enabled, async t => {
  assert.equal(typeof verifyArchiveEnvelope, 'function')
  const events = [human(0, 'private-original-text')], f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  const encoded = fs.readFileSync(path.join(f.directory, 'archives', prepared.id + '.json'), 'utf8')
  const verified = verifyArchiveEnvelope(encoded, prepared.id)
  assert.equal(verified.sha256, prepared.sha256)
  assert.equal(verified.manifest.events[0].seq, 0)
  assert.equal(JSON.stringify(verified).includes('private-original-text'), false)
  const tampered = JSON.parse(encoded); tampered.unexpected = 'injected'
  assert.throws(() => verifyArchiveEnvelope(JSON.stringify(tampered), prepared.id), /integrity|unknown/i)
})

test('failed manifest durability never returns a receipt and a later retry remains idempotent', enabled, async t => {
  const failedFs = { ...fs, fsyncSync() { const error = new Error('simulated disk write failure'); error.code = 'EIO'; throw error } }
  const FailedStore = load({ 'node:fs': failedFs }).ContextArchiveStore
  const events = [human(0, 'exact original')], f = fixture(t, events, FailedStore)
  const input = { sessionId: 'session-a', events, currentStateText: '' }
  await assert.rejects(f.store.prepare(access, input), /disk write failure/)
  assert.equal(fs.readdirSync(path.join(f.directory, 'archives')).filter(name => name.endsWith('.json')).length, 0)
  const normal = new ContextArchiveStore(f.directory, f.options)
  const prepared = await normal.prepare(access, input)
  assert.equal((await normal.prepare(access, input)).id, prepared.id)
  assert.equal(fs.readdirSync(path.join(f.directory, 'archives')).filter(name => name.endsWith('.json')).length, 1)
})

test('existing canonical source IDs are exposed as pointers without becoming archive citations', enabled, async t => {
  const events = [human(0, 'quote unchanged')], id = 'src_' + 'a'.repeat(64)
  const f = fixture(t, events, ContextArchiveStore, { sourceIdsFor: () => [id] })
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  const page = await f.store.get(access, prepared.id, { maxChars: 10000 })
  assert.deepEqual(JSON.parse(page.text)[0].sourceIds, [id])
  assert.equal(page.citation, undefined)
  assert.equal(page.contextArchive, true)
})

test('pagination does not read events that are outside the final returned page', enabled, async t => {
  const events = [human(0, 'Initial restriction.'), assistant(1), result(2, 'call-1', 'large tail '.repeat(20000))], f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  for (const maxChars of [1024, 1100, 1400, 1700]) {
    f.reads.length = 0
    const page = await f.store.get(access, prepared.id, { maxChars })
    assert.deepEqual([...new Set(f.reads.map(([seq]) => seq))], unpack(page.verifiedEvents).map(item => item.seq))
  }
})

test('escaped transcript pages fit the whole JSON response budget and continue making progress', enabled, async t => {
  const events = [human(0, '\\"\n\t'.repeat(2000))], f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  let offset = 0
  for (let index = 0; index < 4; index++) {
    const page = await f.store.get(access, prepared.id, { offset, maxChars: 1024 })
    assert.ok(JSON.stringify(page).length <= 1024)
    assert.ok(page.nextOffset > offset)
    offset = page.nextOffset
  }
})

test('a same-project granted child cannot silently flatten another session checkpoint into its own archive', enabled, async t => {
  const events = [human(0, 'parent restriction')], f = fixture(t, events)
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  const copied = { ...human(1, prepared.text, { kind: 'compact-checkpoint', compactionId: prepared.id }), sourceEventSeqs: [0] }
  const ChildStore = new ContextArchiveStore(f.directory, { ...f.options, readEvents: async () => [copied] })
  await assert.rejects(ChildStore.prepare({ projectId: 'project-a', sessionIds: ['session-a', 'child'] }, { sessionId: 'child', events: [copied], currentStateText: '' }), /scope|access/i)
})

test('archive pairing rejects incomplete or mismatched calls and accepts a call ID reused after completion', enabled, async t => {
  const pending = [assistant(0)], f = fixture(t, pending)
  await assert.rejects(f.store.prepare(access, { sessionId: 'session-a', events: pending, currentStateText: '' }), /pair|pending|result|complete/i)
  const events = [assistant(0, 'first', 'read'), result(1, 'call-0', 'read completed'), assistant(2, 'second', 'list')]
  events[2].data.message.content.find(block => block.type === 'tool-call').id = 'call-0'
  events.push(result(3, 'call-0', 'list completed'))
  const reused = fixture(t, events)
  const prepared = await reused.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  const page = await reused.store.get(access, prepared.id, { maxChars: 10000 })
  assert.equal(JSON.parse(page.text).length, 4)
})

test('canonical assistant call and execution log arguments cannot be silently mismatched', enabled, async t => {
  const events = [assistant(0), { seq: 1, time: 11, type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-0', name: 'read', arguments: '{"path":"different.json"}' } }, result(2, 'call-0', 'tail')]
  const f = fixture(t, events)
  await assert.rejects(f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' }), /identity|arguments|conflict|pair/i)
})

test('exact own recovery notice is omitted only from the capsule while retained in the raw archive', enabled, async t => {
  const own = human(0, 'OLD_AUTO_STATE', { kind: 'ultra-mode', form: 'notice', summary: '项目证据恢复入口' })
  const unknown = human(1, 'UNKNOWN_CONTEXT_MUST_REMAIN', { kind: 'external-notice' })
  const f = fixture(t, [own, unknown])
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events: [own, unknown], currentStateText: 'NEW_STATE' })
  assert.equal(prepared.text.includes('OLD_AUTO_STATE'), false)
  assert.ok(prepared.text.includes('UNKNOWN_CONTEXT_MUST_REMAIN'))
  const page = await f.store.get(access, prepared.id, { maxChars: 10000 })
  assert.ok(page.text.includes('OLD_AUTO_STATE'))
})

test('thirty offline checkpoints flatten each original once across cold store restarts without rereading old large bodies', enabled, async t => {
  const events = [human(0, 'EARLY_ONLY_ONCE: never publish.'), assistant(1, 'OPERATION_RECEIPT_INITIAL'), result(2, 'call-1', 'OLD_LARGE_SOURCE '.repeat(20000))]
  const f = fixture(t, events)
  let selected = [...events], store = f.store
  const expected = new Set([0, 1, 2]), oldBodies = new Set(), constraints = ['EARLY_ONLY_ONCE: never publish.']
  for (let cycle = 1; cycle <= 30; cycle++) {
    f.reads.length = 0
    const prepared = await store.prepare(access, { sessionId: 'session-a', events: selected, currentStateText: `LATEST_STATE_${cycle}` })
    assert.deepEqual(unpack(prepared.flatSeqs), [...expected].sort((a, b) => a - b))
    assert.equal(new Set(prepared.flatSeqs).size, prepared.flatSeqs.length)
    for (const constraint of constraints) assert.equal(prepared.text.split(constraint).length - 1, 1)
    assert.ok(prepared.text.includes('OPERATION_RECEIPT_INITIAL'))
    assert.equal(prepared.text.includes('OLD_LARGE_SOURCE'), false)
    assert.equal(f.reads.some(([seq]) => oldBodies.has(seq)), false)
    const checkpoint = { ...human(events.length, prepared.text, { kind: 'compact-checkpoint', compactionId: prepared.id }), sourceEventSeqs: selected.map(event => event.seq), surfaceOp: { op: 'replace', startSeq: selected[0].seq, endSeq: selected.at(-1).seq } }
    events.push(checkpoint)
    oldBodies.add(2)
    if (cycle === 30) break
    const followup = human(events.length, `ADDED_REQUIREMENT_${cycle}: keep operation ${cycle}.`)
    constraints.push(followup.data.content[0].text); expected.add(followup.seq); events.push(followup)
    const progress = assistant(events.length, `PUBLIC_PROGRESS_${cycle}`); expected.add(progress.seq); events.push(progress)
    const evidence = result(events.length, `call-${progress.seq}`, `RAW_RESULT_${cycle} ` + 'x'.repeat(1000)); expected.add(evidence.seq); events.push(evidence)
    for (const event of selected) if (event.type === 'tool/result') oldBodies.add(event.seq)
    selected = [checkpoint, followup, progress, evidence]
    if (cycle % 3 === 0) store = new ContextArchiveStore(f.directory, f.options)
  }
})

test('authorization loss after durable preparation leaves an inaccessible orphan, never an activation receipt', enabled, async t => {
  const events = [human(0, 'private operation control')]
  const f = fixture(t, events)
  let denyPublished = true
  const options = { ...f.options, authorize: () => !denyPublished || !fs.existsSync(path.join(f.directory, 'archives')) || !fs.readdirSync(path.join(f.directory, 'archives')).some(name => name.endsWith('.json')) }
  const store = new ContextArchiveStore(f.directory, options)
  const input = { sessionId: 'session-a', events, currentStateText: '' }
  await assert.rejects(store.prepare(access, input), /access/i)
  const files = fs.readdirSync(path.join(f.directory, 'archives')).filter(name => name.endsWith('.json'))
  assert.equal(files.length, 1)
  f.reads.length = 0
  await assert.rejects(store.get(access, files[0].slice(0, -5)), /access/i)
  assert.equal(f.reads.length, 0)
  denyPublished = false
  const retry = await store.prepare(access, input)
  assert.equal(retry.id + '.json', files[0])
})

test('concurrent identical writers publish one immutable manifest and safe read-only gets', enabled, async t => {
  const events = [human(0, 'one restriction')], f = fixture(t, events)
  const second = new ContextArchiveStore(f.directory, f.options)
  const input = { sessionId: 'session-a', events, currentStateText: 'same snapshot' }
  const receipts = await Promise.all([f.store.prepare(access, input), second.prepare(access, input), f.store.prepare(access, input)])
  assert.equal(new Set(receipts.map(receipt => receipt.id)).size, 1)
  assert.equal(fs.readdirSync(path.join(f.directory, 'archives')).filter(name => name.endsWith('.json')).length, 1)
  assert.ok((await second.get(access, receipts[0].id)).text.includes('one restriction'))
})

test('linked storage directories and multiply linked manifests are refused', enabled, async t => {
  const events = [human(0, 'one restriction')], f = fixture(t, events)
  const target = path.join(f.directory, 'other'); fs.mkdirSync(target)
  try { fs.symlinkSync(target, path.join(f.directory, 'archives'), process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) return t.skip('Directory links unavailable for this test account'); throw error }
  await assert.rejects(f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' }), /linked|storage/i)
  fs.unlinkSync(path.join(f.directory, 'archives'))
  const prepared = await f.store.prepare(access, { sessionId: 'session-a', events, currentStateText: '' })
  const file = path.join(f.directory, 'archives', prepared.id + '.json')
  fs.linkSync(file, path.join(f.directory, 'extra-link'))
  await assert.rejects(f.store.get(access, prepared.id), /integrity|unsafe|linked/i)
})
