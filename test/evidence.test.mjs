import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { EvidenceStore } = await import('../lib/evidence.js').catch(() => ({}))
const enabled = { skip: !EvidenceStore }
const access = { projectId: 'p', sessionIds: ['s'] }
function fixture(t, resolver) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return { directory, store: new EvidenceStore(directory, resolver) }
}
function input(extra = {}) {
  return { projectId: 'p', runId: 'run', sessionId: 's', routeId: 'main', eventId: 'e', seq: 1, at: 100, kind: 'message', text: 'The acceptance criterion is offline retrieval.', ...extra }
}

test('exports a persistent evidence store', () => assert.equal(typeof EvidenceStore, 'function'))

test('verified citation uses canonical source and outer tool resource identity after restart', enabled, async t => {
  const { directory, store } = fixture(t)
  const body = 'Source A-2026-10-15 is a label inside the document.\nRelease = Tuesday 09:30'
  const record = store.capture(input({ text: body, origin: { tool: 'read', callId: 'call-1', resourceId: 'vendor-a' } }))
  const reopened = new EvidenceStore(directory)
  const got = await reopened.get(access, record.chunks[0].id, { quote: 'Release = Tuesday 09:30', maxChars: 1200 })
  assert.deepEqual(got.citation, { sourceId: record.id, quote: 'Release = Tuesday 09:30', start: body.indexOf('Release'), end: body.length, sha256: record.sha256, origin: { tool: 'read', callId: 'call-1', resourceId: 'vendor-a' } })
  assert.equal(got.text, got.citation.quote)
  assert.ok(JSON.stringify(got).length <= 1200)
})

test('citation rejects altered quotes, inaccessible sources, unavailable text and undersized budgets', enabled, async t => {
  const { store } = fixture(t)
  const record = store.capture(input({ text: 'Original punctuation = unchanged; do not normalize.' }))
  await assert.rejects(store.get(access, record.id, { quote: 'Original punctuation: unchanged' }), /quote/i)
  await assert.rejects(store.get({ projectId: 'other', sessionIds: ['s'] }, record.id, { quote: 'Original' }), /access|not found/i)
  await assert.rejects(store.get(access, record.id, { quote: 'Original punctuation = unchanged; do not normalize.', maxChars: 256 }), /budget/i)
  const noText = store.capture(input({ eventId: 'missing', host: { sessionId: 's', seq: 5 } }))
  await assert.rejects(store.get(access, noText.id, { quote: 'acceptance' }), /unavailable|quote/i)
})

test('capture is durable, idempotent and rejects conflicting event rewrites', enabled, async t => {
  const { directory, store } = fixture(t)
  const first = store.capture(input())
  assert.match(first.id, /^src_[a-f0-9]{64}$/)
  assert.equal(store.capture(input()).id, first.id)
  assert.throws(() => store.capture(input({ text: 'silently changed evidence' })), /conflict/i)
  const reopened = new EvidenceStore(directory)
  assert.equal(reopened.stats(access).raw.sources, 1)
  assert.match((await reopened.get(access, first.id)).text, /offline retrieval/)
  assert.equal(reopened.idsFor('s', 'e')[0], first.id)
})

test('host capture persists metadata, resolves original text and detects changed host text', enabled, async t => {
  let original = 'SENSITIVE_COMPLETE_HOST_TEXT launch blocker: missing lockfile.'
  const { directory, store } = fixture(t, async () => ({ text: original }))
  const record = store.capture(input({ text: original, host: { sessionId: 's', seq: 1 } }))
  const serialized = fs.readdirSync(path.join(directory, 'records')).map(name => fs.readFileSync(path.join(directory, 'records', name), 'utf8')).join('')
  assert.equal(serialized.includes(original), false)
  assert.match((await store.search(access, { query: 'lockfile' })).items[0].excerpt, /missing lockfile/)
  original = 'host log has been replaced'
  const changed = await store.get(access, record.id)
  assert.equal(changed.status, 'hash-mismatch')
  assert.equal(changed.text, '')
})

test('local retrieval context receipts reuse host integrity and pagination without indexing or republishing returned text', enabled, async t => {
  let body = 'RETRIEVAL_WRAPPER_ONLY_CANARY '.repeat(80)
  let resolvedCallId = 'get-1'
  const { directory, store } = fixture(t, async () => ({ text: body, callId: resolvedCallId }))
  const receiptInput = input({ text: body, kind: 'tool/result:ultra_memory_get', eventId: 'tool:get-1', host: { sessionId: 's', seq: 1 }, origin: { tool: 'ultra_memory_get', callId: 'get-1' }, contextReceipt: true })
  const record = store.capture(receiptInput)
  assert.equal(record.contextReceipt, true)
  assert.deepEqual(record.chunks, [])
  assert.equal(store.capture(receiptInput).id, record.id)
  assert.equal([...store.recordsFor(access)].length, 0)
  assert.equal((await store.search(access, { query: 'RETRIEVAL_WRAPPER_ONLY_CANARY' })).total, 0)
  assert.equal((await store.search(access, { id: record.id })).total, 0)
  assert.equal(store.exportMarkdown(access).files.some(file => file.content.includes(record.id)), false)
  assert.throws(() => store.addSemantic({ projectId: 'p', kind: 'fact', text: 'not new original evidence', sourceIds: [record.id] }), /context|source|provenance/i)
  assert.throws(() => store.updateProjectState(access, { goal: 'do not promote retrieval', sourceIds: [record.id] }), /context|source|provenance/i)
  const serialized = fs.readdirSync(path.join(directory, 'records')).map(name => fs.readFileSync(path.join(directory, 'records', name), 'utf8')).join('')
  assert.equal(serialized.includes('RETRIEVAL_WRAPPER_ONLY_CANARY'), false)
  const reopened = new EvidenceStore(directory, async () => ({ text: body, callId: resolvedCallId }))
  assert.deepEqual(reopened.idsFor('s', 'tool:get-1'), [record.id])
  const page = await reopened.get(access, record.id, { maxChars: 700 })
  assert.ok(JSON.stringify(page).length <= 700)
  assert.ok(page.nextOffset > 0)
  assert.equal(page.text, body.slice(0, page.text.length))
  const next = await reopened.get(access, record.id, { offset: page.nextOffset, maxChars: 700 })
  assert.equal(next.text, body.slice(page.nextOffset, page.nextOffset + next.text.length))
  const quote = await reopened.get(access, record.id, { quote: 'RETRIEVAL_WRAPPER_ONLY_CANARY', maxChars: 900 })
  assert.equal(quote.citation.sha256, record.sha256)
  await assert.rejects(reopened.get({ projectId: 'p', sessionIds: ['unrelated'] }, record.id), /access|not found/i)
  await assert.rejects(reopened.get({ projectId: 'elsewhere', sessionIds: ['s'] }, record.id), /access|not found/i)
  assert.equal(reopened.stats(access).raw.sources, 0)
  assert.equal(reopened.stats(access).contextReceipts.sources, 1)
  resolvedCallId = 'different-call-with-the-same-body'
  assert.equal((await reopened.get(access, record.id)).status, 'identity-mismatch')
  await assert.rejects(reopened.get(access, record.id, { quote: 'RETRIEVAL_WRAPPER_ONLY_CANARY' }), /integrity|unavailable/i)
  resolvedCallId = 'get-1'
  body += ' changed canonical bytes'
  assert.equal((await reopened.get(access, record.id)).status, 'hash-mismatch')
})

test('context receipt capture rejects nonlocal retrieval, captured copies and invalid canonical identities', enabled, t => {
  const { store } = fixture(t)
  const value = input({ kind: 'tool/result:ultra_memory_get', eventId: 'tool:get-1', host: { sessionId: 's', seq: 1 }, origin: { tool: 'ultra_memory_get', callId: 'get-1' }, contextReceipt: true })
  for (const patch of [{ contextReceipt: 'yes' }, { coverage: 'captured' }, { host: undefined }, { origin: { tool: 'ultra_knowledge_get', callId: 'get-1' } }, { eventId: 'wrong' }, { seq: 2 }, { attachments: [{ type: 'image', ref: 'attachment://x' }] }]) {
    assert.throws(() => store.capture({ ...value, ...patch }), /context|receipt|host/i)
  }
})

test('missing host data and references expose gaps without inventing attachment text', enabled, async t => {
  const { store } = fixture(t, async () => undefined)
  const host = store.capture(input({ host: { sessionId: 's', seq: 1 }, attachments: [{ type: 'image', ref: 'attachment://picture' }] }))
  assert.equal((await store.get(access, host.id)).status, 'unavailable')
  store.capture(input({ eventId: 'file', text: '', coverage: 'reference-only', attachments: [{ type: 'file', ref: 'file:///x.pdf' }] }))
  const stats = store.stats(access)
  assert.equal(stats.raw.coverage.host, 1)
  assert.equal(stats.raw.coverage['reference-only'], 1)
  assert.equal(stats.raw.attachments, 2)
  assert.equal((await store.search(access, { query: 'pdf' })).items.length, 0)
})

test('lexical search independently retrieves early evidence, filters metadata and paginates tail', enabled, async t => {
  const { store } = fixture(t)
  const early = store.capture(input({ text: '最初的验收要求：必须离线检索。needle acceptance', files: ['src/evidence.ts'], topics: ['memory'] }))
  for (let i = 2; i < 15; i++) store.capture(input({ eventId: `event${i}`, seq: i, at: 100 + i, text: `later status ${i}` }))
  assert.equal((await store.search(access, { query: '验收要求' })).items[0].sourceId, early.id)
  assert.equal((await store.search(access, { query: 'needle', file: 'evidence.ts', topic: 'memory', routeId: 'main', before: 101 })).items[0].sourceId, early.id)
  assert.equal((await store.search(access, { query: 'needle', after: 101 })).items.length, 0)
  const tail = await store.search(access, { limit: 2 })
  assert.match(tail.items[0].excerpt, /later status 14/)
  assert.equal(tail.nextOffset, 2)
  assert.equal((await store.search(access, { limit: 2, offset: tail.nextOffset })).items.length, 2)
})

test('all raw retrieval and metadata are limited to granted project sessions', enabled, async t => {
  const { store } = fixture(t)
  store.capture(input())
  const secret = store.capture(input({ sessionId: 'secret', eventId: 'secret', text: 'private-session-marker' }))
  store.capture(input({ projectId: 'other', text: 'other-project-marker' }))
  assert.equal((await store.search(access, { query: 'marker' })).items.length, 0)
  await assert.rejects(store.get(access, secret.id), /not found|access/i)
  assert.equal([...store.recordsFor(access)].length, 1)
  assert.equal(store.stats(access).raw.sources, 1)
})

test('source-kind filter finds raw tool evidence without matching recent query quotes or semantic reports', enabled, async t => {
  const { store } = fixture(t)
  const raw = store.capture(input({ eventId: 'original', kind: 'tool/result:read', text: 'ONCE_ONLY_CANARY original tool answer' }))
  const host = store.capture(input({ eventId: 'native', kind: 'tool/result', text: 'ONCE_ONLY_CANARY second native tool result' }))
  store.capture(input({ eventId: 'query', at: 999, kind: 'user/task', text: 'Please retrieve ONCE_ONLY_CANARY original tool answer' }))
  store.addSemantic({ id: 'candidate', projectId: 'p', kind: 'fact', text: 'ONCE_ONLY_CANARY report candidate', sourceIds: [raw.id], topics: [] })
  const found = await store.search(access, { query: 'ONCE_ONLY_CANARY', kind: 'tool/result' })
  assert.deepEqual(new Set(found.items.map(item => item.sourceId)), new Set([raw.id, host.id]))
  assert.ok(found.items.every(item => item.kind === 'tool/result' || item.kind === 'tool/result:read'))
  assert.equal((await store.search(access, { query: 'ONCE_ONLY_CANARY', kind: 'fact' })).items.length, 1)
  assert.equal((await store.search(access, { query: 'ONCE_ONLY_CANARY', kind: 'tool/res' })).items.length, 0)
  await assert.rejects(store.search(access, { kind: '' }), /kind/i)
})

test('chunk expansion is bounded and source ids survive restart', enabled, async t => {
  const { directory, store } = fixture(t)
  const record = store.capture(input({ text: 'prefix '.repeat(800) + 'RARE_END_MARKER' }))
  const found = await store.search(access, { query: 'RARE_END_MARKER', maxChars: 900 })
  assert.equal(found.items.length, 1)
  assert.ok(JSON.stringify(found).length <= 900)
  const expanded = await new EvidenceStore(directory).get(access, found.items[0].id, { maxChars: 700, neighbors: 1 })
  assert.ok(JSON.stringify(expanded).length <= 700)
  assert.deepEqual(expanded.sourceIds, [record.id])
  assert.equal((await store.get(access, record.id, { offset: 1, maxChars: 500 })).text.startsWith('refix'), true)
})

test('semantic source refs are validated and supersession preserves original facts', enabled, async t => {
  const { directory, store } = fixture(t)
  const source = store.capture(input())
  const foreign = store.capture(input({ projectId: 'other' }))
  assert.throws(() => store.addSemantic({ projectId: 'p', kind: 'fact', text: 'fake', sourceIds: ['missing'] }), /source/i)
  assert.throws(() => store.addSemantic({ projectId: 'p', kind: 'fact', text: 'foreign', sourceIds: [foreign.id] }), /source/i)
  const old = store.addSemantic({ projectId: 'p', kind: 'decision', text: 'Use v1', sourceIds: [source.id] })
  const current = store.addSemantic({ projectId: 'p', kind: 'decision', text: 'Use v2', sourceIds: [source.id], supersedes: [old.id] })
  const reopened = new EvidenceStore(directory)
  assert.deepEqual(reopened.semantics(access, { status: 'current' }).map(x => x.id), [current.id])
  assert.equal(reopened.semantics(access, { status: 'superseded' })[0].text, 'Use v1')
  assert.equal(reopened.stats(access).semantic.total, 2)
})

test('mixed-session semantic facts and project revisions never leak through a narrow grant', enabled, async t => {
  const { store } = fixture(t)
  const a = store.capture(input())
  const b = store.capture(input({ sessionId: 'secret', eventId: 'secret' }))
  store.addSemantic({ projectId: 'p', kind: 'fact', text: 'mixed-secret', sourceIds: [a.id, b.id], topics: ['private'] })
  const broad = { projectId: 'p', sessionIds: ['s', 'secret'] }
  store.updateProjectState(broad, { goal: 'secret goal', sourceIds: [a.id, b.id] })
  assert.equal(store.semantics(access).length, 0)
  assert.equal(store.projectState(access), undefined)
  assert.equal(JSON.stringify(store.exportMarkdown(access)).includes('mixed-secret'), false)
  assert.equal(JSON.stringify(store.exportMarkdown(access)).includes('secret goal'), false)
})

test('project state revisions validate operation evidence and survive restart', enabled, async t => {
  const { directory, store } = fixture(t)
  const a = store.capture(input())
  assert.throws(() => store.updateProjectState(access, { goal: 'goal', sourceIds: [a.id], operations: [{ id: 'x', description: 'work', status: 'verified', sourceIds: [] }] }), /source|evidence/i)
  store.updateProjectState(access, { goal: 'offline search', acceptance: ['retrieve early evidence'], constraints: ['local only'], progress: ['captured'], next: ['verify'], blockers: [], sourceIds: [a.id], operations: [{ id: 'x', description: 'captured', status: 'executed', sourceIds: [a.id] }] })
  store.updateProjectState(access, { goal: 'offline search v2', sourceIds: [a.id] })
  assert.equal(new EvidenceStore(directory).projectState(access).revision, 2)
  assert.equal(store.projectState(access).goal, 'offline search v2')
  const files = store.exportMarkdown(access).files
  assert.ok(files.some(x => x.path === 'index.md' && x.content.includes('offline search v2')))
})

test('corrupt durable records fail closed and torn temporary writes remain explicit', enabled, t => {
  const { directory, store } = fixture(t)
  store.capture(input())
  fs.writeFileSync(path.join(directory, 'records', 'orphan.tmp-interrupted'), '{"partial":')
  const restarted = new EvidenceStore(directory)
  assert.equal(restarted.stats(access).integrity.tornWrites, 1)
  assert.equal(restarted.stats(access).raw.sources, 1)
  const name = fs.readdirSync(path.join(directory, 'records')).find(x => x.endsWith('.json'))
  fs.writeFileSync(path.join(directory, 'records', name), '{"corrupt":true}')
  assert.throws(() => new EvidenceStore(directory), /integrity|corrupt/i)
})

test('returned metadata cannot mutate the canonical authority and export cannot overwrite it', enabled, async t => {
  const { store } = fixture(t)
  const source = store.capture(input({ topics: ['memory'] }))
  source.topics.push('injected')
  const record = [...store.recordsFor(access)][0]
  record.topics.push('second-injection')
  assert.equal((await store.search(access, { topic: 'injected' })).items.length, 0)
  const semantic = store.addSemantic({ projectId: 'p', kind: 'requirement', text: 'Keep history', topics: ['../escape'], sourceIds: [source.id] })
  const exported = store.exportMarkdown(access)
  assert.ok(exported.files.every(x => !x.path.includes('..')))
  exported.files[0].content = 'replaced'
  assert.equal(store.semantics(access)[0].id, semantic.id)
})

test('invalid identity, coverage, host relation and private reasoning are rejected', enabled, t => {
  const { store } = fixture(t)
  assert.throws(() => store.capture(input({ at: NaN })), /at|timestamp/i)
  assert.throws(() => store.capture(input({ eventId: '' })), /eventId/i)
  assert.throws(() => store.capture(input({ coverage: 'host' })), /host/i)
  assert.throws(() => store.capture(input({ host: { sessionId: 'different', seq: 1 } })), /session/i)
  assert.throws(() => store.capture(input({ kind: 'reasoning', text: 'private chain' })), /reasoning|private/i)
})

test('verified host promotion releases captured body while preserving references and idempotency', enabled, async t => {
  const text = 'captured tool output with a durable host source'
  let hostText
  const { directory, store } = fixture(t, async () => hostText === undefined ? undefined : { text: hostText })
  const source = store.capture(input({ text }))
  store.addSemantic({ projectId: 'p', kind: 'fact', text: 'tool completed', sourceIds: [source.id] })
  assert.equal(await store.promoteToHost(source.id, { sessionId: 's', seq: 2 }), false)
  hostText = 'different host body'
  assert.equal(await store.promoteToHost(source.id, { sessionId: 's', seq: 2 }), false)
  assert.equal([...store.recordsFor(access)][0].coverage, 'captured')
  hostText = text
  assert.equal(await store.promoteToHost(source.id, { sessionId: 's', seq: 2 }), true)
  assert.equal([...store.recordsFor(access)][0].coverage, 'host')
  assert.equal(store.capture(input({ text })).coverage, 'host')
  const encoded = fs.readdirSync(path.join(directory, 'records')).map(name => fs.readFileSync(path.join(directory, 'records', name), 'utf8')).join('')
  assert.equal(encoded.includes(text), false)
  const reopened = new EvidenceStore(directory, async () => ({ text }))
  assert.equal((await reopened.get(access, source.id)).text, text)
  assert.equal(reopened.semantics(access)[0].sourceIds[0], source.id)
  await assert.rejects(store.promoteToHost(source.id, { sessionId: 'other', seq: 2 }), /session/i)
})

test('multiple store instances preserve earlier commits and fail closed after later corruption', enabled, async t => {
  const { directory, store } = fixture(t)
  const second = new EvidenceStore(directory)
  const a = store.capture(input())
  second.capture(input({ eventId: 'second', seq: 2 }))
  store.capture(input({ eventId: 'third', seq: 3 }))
  assert.equal(store.stats(access).raw.sources, 3)
  const name = fs.readdirSync(path.join(directory, 'records')).find(x => x.endsWith('.json'))
  fs.writeFileSync(path.join(directory, 'records', name), '{}')
  assert.throws(() => store.capture(input({ eventId: 'fourth', seq: 4 })), /integrity/i)
  await assert.rejects(store.get(access, a.id), /integrity/i)
  assert.throws(() => store.stats(access), /integrity/i)
})

test('a live writer lock fails after bounded attempts and leaves existing evidence intact', enabled, t => {
  const { directory, store } = fixture(t)
  store.capture(input())
  fs.writeFileSync(path.join(directory, '.writer-lock'), JSON.stringify({ pid: process.pid }))
  assert.throws(() => store.capture(input({ eventId: 'busy' })), /busy|retry/i)
  assert.equal(store.stats(access).raw.sources, 1)
})

test('public search and get expose scoped semantic current and superseded decisions with bounded provenance', enabled, async t => {
  const { store } = fixture(t)
  const source = store.capture(input())
  const old = store.addSemantic({ projectId: 'p', kind: 'decision', text: 'Parser choice version one', sourceIds: [source.id], topics: ['parser'], files: ['src/parser.ts'] })
  const latest = store.addSemantic({ projectId: 'p', kind: 'decision', text: 'Parser choice version two', sourceIds: [source.id], supersedes: [old.id], topics: ['parser'] })
  const results = await store.search(access, { query: 'Parser choice' })
  assert.equal(results.items.find(x => x.id === old.id).semanticStatus, 'superseded')
  assert.equal(results.items.find(x => x.id === latest.id).semanticStatus, 'current')
  assert.deepEqual(results.items.find(x => x.id === latest.id).sourceIds, [source.id])
  const exact = await store.get(access, old.id, { maxChars: 1500 })
  assert.equal(JSON.parse(exact.text).status, 'superseded')
  assert.equal(exact.semanticStatus, 'superseded')
  assert.ok(JSON.stringify(exact).length <= 1500)
  const small = await store.search(access, { topic: 'parser', maxChars: 700 })
  assert.ok(JSON.stringify(small).length <= 700)
  const paged = await store.get(access, old.id, { maxChars: 400 })
  assert.ok(JSON.stringify(paged).length <= 400)
  assert.ok(paged.nextOffset > 0)
  const resumed = await store.get(access, old.id, { maxChars: 400, offset: paged.nextOffset })
  assert.notEqual(paged.text, resumed.text)
})

test('raw lexical topic/file search follows visible semantic source relations without leaking hidden annotations', enabled, async t => {
  const { store } = fixture(t)
  const a = store.capture(input({ text: 'The original raw needle has no labels.' }))
  const privateSource = store.capture(input({ sessionId: 'secret', eventId: 'secret', text: 'private note' }))
  store.addSemantic({ projectId: 'p', kind: 'fact', text: 'classified public topic', sourceIds: [a.chunks[0].id], topics: ['lookup'], files: ['src/raw.ts'] })
  const hidden = store.addSemantic({ projectId: 'p', kind: 'fact', text: 'hidden label candidate', sourceIds: [a.id, privateSource.id], topics: ['classified'], files: ['secret.ts'] })
  assert.ok((await store.search(access, { query: 'raw needle', topic: 'lookup', file: 'raw.ts' })).items.some(x => x.sourceId === a.id && x.id.startsWith('chunk_')))
  assert.equal((await store.search(access, { topic: 'classified' })).items.length, 0)
  await assert.rejects(store.get(access, hidden.id), /not found|access/i)
  assert.equal((await store.search(access, { id: hidden.id })).items.length, 0)
})

test('verified files are reused across incremental writes while external appends and corruption are rechecked', enabled, async t => {
  const { directory, store } = fixture(t)
  for (let i = 0; i < 100; i++) store.capture(input({ eventId: `incremental-${i}`, seq: i, text: `source ${i}` }))
  const before = store.stats(access).integrity.parsedRecords
  assert.equal(typeof before, 'number')
  for (let i = 0; i < 5; i++) store.capture(input({ eventId: 'incremental-0', seq: 0, text: 'source 0' }))
  assert.equal(store.stats(access).integrity.parsedRecords, before)
  const other = new EvidenceStore(directory)
  assert.equal(other.stats(access).integrity.parsedRecords, 100)
  other.capture(input({ eventId: 'external', seq: 101, text: 'external source' }))
  store.capture(input({ eventId: 'incremental-0', seq: 0, text: 'source 0' }))
  assert.equal(store.stats(access).integrity.parsedRecords, before + 1)
  assert.equal(store.idsFor('s', 'external').length, 1)
  const recordPath = path.join(directory, 'records', fs.readdirSync(path.join(directory, 'records')).find(name => name.endsWith('.json')))
  const bytes = fs.readFileSync(recordPath, 'utf8')
  fs.writeFileSync(recordPath, bytes.replace('"kind":"message"', '"kind":"broken!"'))
  assert.throws(() => store.capture(input({ eventId: 'after-corruption' })), /integrity/i)
  await assert.rejects(store.search(access, {}), /integrity/i)
})

test('project state identifiers retrieve canonical paginated state after restart with complete provenance ACL', enabled, async t => {
  const { directory, store } = fixture(t)
  const source = store.capture(input())
  const state = store.updateProjectState(access, { goal: 'goal', progress: ['p'.repeat(2000)], sourceIds: [source.id] })
  const reopened = new EvidenceStore(directory)
  const result = await reopened.get(access, state.id, { maxChars: 350 })
  assert.ok(JSON.stringify(result).length <= 350)
  assert.equal(result.sourceIds[0], source.id)
  const tail = await reopened.get(access, state.id, { maxChars: 350, offset: result.nextOffset })
  assert.notEqual(result.text, tail.text)
  assert.equal(JSON.parse((await reopened.get(access, state.id, { maxChars: 5000 })).text).id, state.id)
  await assert.rejects(reopened.get({ projectId: 'p', sessionIds: [] }, state.id), /access|not found/i)
  await assert.rejects(reopened.get({ projectId: 'other', sessionIds: ['s'] }, state.id), /access|not found/i)
})

test('final serialized search budgets include omitted counters and pagination at exact boundaries', enabled, async t => {
  const { store } = fixture(t)
  const sources = []
  for (let i = 0; i < 164; i++) sources.push(store.capture(input({ eventId: `budget-${i}`, seq: i, at: i, text: 'later progress '.repeat(20) + i })))
  store.addSemantic({ projectId: 'p', kind: 'decision', text: 'many provenance refs', sourceIds: sources.map(x => x.id), topics: ['budget'] })
  for (const maxChars of [256, 257, 399, 400, 511, 512, 699, 700, 1024, 2047, 2048, 2049]) {
    const page = await store.search(access, { maxChars, limit: 100 })
    assert.ok(JSON.stringify(page).length <= maxChars, `${maxChars}: serialized ${JSON.stringify(page).length}`)
    assert.ok(page.nextOffset === undefined || page.nextOffset > 0)
  }
  const seen = new Set()
  let offset = 0
  for (let i = 0; i < 170; i++) {
    const page = await store.search(access, { maxChars: 512, limit: 100, offset })
    assert.ok(JSON.stringify(page).length <= 512)
    for (const item of page.items) { assert.equal(seen.has(item.id), false); seen.add(item.id) }
    if (page.nextOffset === undefined) break
    assert.ok(page.nextOffset > offset, 'budget pagination must make progress')
    offset = page.nextOffset
  }
  assert.equal(seen.size, 164)
})

test('tiny semantic and state pages bound escaped text plus many provenance ids and make progress', enabled, async t => {
  const { store } = fixture(t)
  const refs = []
  for (let i = 0; i < 16; i++) refs.push(store.capture(input({ eventId: `ref-${i}`, seq: i })).id)
  const semantic = store.addSemantic({ id: 'semantic-' + 'x'.repeat(240), projectId: 'p', kind: 'fact', text: '\\"\n\t😃'.repeat(1000), sourceIds: refs })
  const state = store.updateProjectState(access, { goal: '\\"\n\t😃'.repeat(1000), sourceIds: refs })
  for (const id of [semantic.id, state.id]) for (const maxChars of [256, 257, 300, 511, 512]) {
    const page = await store.get(access, id, { maxChars })
    assert.ok(JSON.stringify(page).length <= maxChars)
    assert.ok(page.nextOffset > 0)
    const next = await store.get(access, id, { maxChars, offset: page.nextOffset })
    assert.ok(JSON.stringify(next).length <= maxChars)
    assert.ok(next.nextOffset > page.nextOffset)
  }
})

test('cold raw search combines public resource and tool identity with late body keywords without migrating records', enabled, async t => {
  const { directory, store } = fixture(t)
  const text = 'First page only.\n' + 'Routine inventory observation. '.repeat(300) + '\nFOOTER_ZETA batch=verified-late-value\n'
  const record = store.capture(input({ kind: 'tool/result:read_file', text, origin: { tool: 'read_file', callId: 'read-17', resourceId: 'ledger-rotor-a' } }))
  const before = fs.readdirSync(path.join(directory, 'records')).map(name => fs.readFileSync(path.join(directory, 'records', name), 'utf8'))
  const reopened = new EvidenceStore(directory)
  for (const query of ['ledger-rotor-a FOOTER_ZETA', 'read_file FOOTER_ZETA']) {
    const found = await reopened.search(access, { query, kind: 'tool/result' })
    assert.equal(found.total, 1)
    assert.equal(found.items[0].sourceId, record.id)
    assert.ok(found.items[0].start >= 2048)
    assert.ok(found.items[0].excerpt.includes('FOOTER_ZETA batch=verified-late-value'))
    assert.equal(found.items[0].status, 'captured')
  }
  const filtered = await reopened.search(access, { id: record.id, query: 'FOOTER_ZETA', kind: 'tool/result' })
  assert.equal(filtered.items[0].sourceId, record.id)
  assert.deepEqual(fs.readdirSync(path.join(directory, 'records')).map(name => fs.readFileSync(path.join(directory, 'records', name), 'utf8')), before)
})

test('source-only search labels partial metadata matches and guides bounded refinement without changing source bytes', enabled, async t => {
  const { directory, store } = fixture(t)
  const text = 'First page.\n' + 'Ordinary archive observation. '.repeat(300) + '\ncaseNumber = verified-middle-record\n' + 'Trailing routine observation. '.repeat(120)
  const record = store.capture(input({ kind: 'tool/result:read_file', text, origin: { tool: 'read_file', callId: 'source-only-read', resourceId: 'local-ledger' } }))
  const before = fs.readdirSync(path.join(directory, 'records')).map(name => fs.readFileSync(path.join(directory, 'records', name), 'utf8'))
  const reopened = new EvidenceStore(directory)
  const broad = await reopened.search(access, { query: 'local-ledger', kind: 'tool/result', maxChars: 1200 })
  assert.ok(broad.items.length > 0)
  assert.ok(!broad.items[0].excerpt.includes('verified-middle-record'), 'source location does not imply every fact is in the first page')
  assert.equal(broad.items[0].match, 'source-identity')
  assert.equal(broad.items[0].sourceChars, text.length)
  assert.equal(broad.items[0].sourceChunks, record.chunks.length)
  assert.match(broad.retrievalHint, /摘录不是全文/)
  assert.match(broad.retrievalHint, /sourceId.*id.*关键词/)
  assert.match(broad.retrievalHint, /nextOffset/)
  assert.match(broad.retrievalHint, /quote/)
  assert.ok(JSON.stringify(broad).length <= 1200)
  const precise = await reopened.search(access, { id: record.id, query: 'caseNumber', kind: 'tool/result' })
  assert.ok(precise.items[0].excerpt.includes('verified-middle-record'))
  assert.equal(precise.items[0].match, undefined)
  assert.equal(precise.retrievalHint, undefined)
  assert.ok((await reopened.get(access, precise.items[0].id, { maxChars: 4096 })).text.includes('verified-middle-record'))
  const hidden = await reopened.search({ projectId: 'other', sessionIds: ['s'] }, { query: 'local-ledger' })
  assert.equal(hidden.items.length, 0)
  assert.equal(hidden.retrievalHint, undefined)
  for (const maxChars of [256, 320, 512, 800]) {
    const bounded = await reopened.search(access, { query: 'local-ledger', maxChars })
    assert.ok(JSON.stringify(bounded).length <= maxChars)
  }
  assert.deepEqual(fs.readdirSync(path.join(directory, 'records')).map(name => fs.readFileSync(path.join(directory, 'records', name), 'utf8')), before)
})

test('multiword excerpts anchor on actual body matches rather than metadata or the chunk beginning', enabled, async t => {
  const { store } = fixture(t)
  const text = 'ledger-rotor-a FIRST_PAGE_HEADER\n' + 'Ordinary observation. '.repeat(52) + 'flightAnchor ' + 'detail '.repeat(20) + 'batchMarker = original-body-value'
  const source = store.capture(input({ kind: 'tool/result', text, origin: { tool: 'read_file', callId: 'read-18', resourceId: 'ledger-rotor-a' } }))
  assert.equal(source.chunks.length, 1)
  const found = await store.search(access, { query: 'ledger-rotor-a flightAnchor batchMarker', kind: 'tool/result' })
  assert.equal(found.total, 1)
  assert.ok(found.items[0].excerpt.includes('flightAnchor'))
  assert.ok(found.items[0].excerpt.includes('batchMarker = original-body-value'))
  assert.equal(found.items[0].excerpt.includes('FIRST_PAGE_HEADER'), false)
  assert.ok(text.includes(found.items[0].excerpt), 'excerpt remains one contiguous original substring')
  const bodyOnly = await store.search(access, { id: source.id, query: 'flightAnchor batchMarker' })
  assert.ok(bodyOnly.items[0].excerpt.includes('batchMarker'))
})

test('metadata search obeys complete source ACL and does not widen semantic or legacy source matching', enabled, async t => {
  const { directory, store } = fixture(t)
  const visible = store.capture(input({ kind: 'tool/result', text: 'BODY_MARK visible observation', origin: { tool: 'read_file', callId: 'visible', resourceId: 'shared-document' } }))
  const hidden = store.capture(input({ kind: 'tool/result', eventId: 'hidden', sessionId: 'hidden', text: 'BODY_MARK HIDDEN_SESSION', origin: { tool: 'read_file', callId: 'hidden', resourceId: 'shared-document' } }))
  store.capture(input({ kind: 'tool/result', eventId: 'foreign', projectId: 'other', text: 'BODY_MARK FOREIGN_PROJECT', origin: { tool: 'read_file', callId: 'foreign', resourceId: 'shared-document' } }))
  const legacy = store.capture(input({ kind: 'tool/result', eventId: 'legacy', text: 'LEGACY_MARK no origin metadata' }))
  store.addSemantic({ projectId: 'p', kind: 'fact', text: 'BODY_MARK visible fact', sourceIds: [visible.id] })
  store.addSemantic({ projectId: 'p', kind: 'fact', text: 'HIDDEN_LABEL', topics: ['HIDDEN_LABEL'], sourceIds: [visible.id, hidden.id] })
  const reopened = new EvidenceStore(directory)
  const result = await reopened.search(access, { query: 'shared-document BODY_MARK', kind: 'tool/result' })
  assert.equal(result.total, 1)
  assert.deepEqual(result.items.map(item => item.sourceId), [visible.id])
  assert.equal(/HIDDEN_SESSION|FOREIGN_PROJECT/.test(JSON.stringify(result)), false)
  assert.equal((await reopened.search({ projectId: 'p', sessionIds: [] }, { query: 'shared-document BODY_MARK' })).total, 0)
  assert.equal((await reopened.search({ projectId: 'no-project', sessionIds: ['s', 'hidden'] }, { query: 'shared-document BODY_MARK' })).total, 0)
  assert.equal((await reopened.search(access, { query: 'HIDDEN_LABEL BODY_MARK', kind: 'tool/result' })).total, 0)
  assert.equal((await reopened.search(access, { query: 'shared-document BODY_MARK', kind: 'fact' })).total, 0)
  assert.equal((await reopened.search(access, { query: 'LEGACY_MARK', id: legacy.id })).items[0].sourceId, legacy.id)
  assert.equal((await reopened.search(access, { query: 'read_file LEGACY_MARK', id: legacy.id })).total, 0)
})

test('metadata-assisted multiword search still budgets the entire escaped JSON envelope', enabled, async t => {
  const { store } = fixture(t)
  for (let i = 0; i < 5; i++) store.capture(input({ eventId: 'metadata-budget-' + i, kind: 'tool/result', text: 'Leading ordinary text. '.repeat(42) + 'BODY_MARK ' + '\\"\n😃'.repeat(60), origin: { tool: 'read_file', callId: 'budget-' + i, resourceId: 'ledger-rotor-a' } }))
  for (const maxChars of [256, 257, 399, 511, 512, 700, 1024, 2048]) {
    const result = await store.search(access, { query: 'ledger-rotor-a BODY_MARK', kind: 'tool/result', maxChars })
    assert.equal(result.total, 5)
    assert.ok(JSON.stringify(result).length <= maxChars, 'complete JSON must fit ' + maxChars)
    assert.ok(result.items.every(item => item.status === 'captured'))
  }
})
