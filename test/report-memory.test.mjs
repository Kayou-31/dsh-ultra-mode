import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EvidenceStore } from '../lib/evidence.js'

const api = await import('../lib/report-memory.js').catch(() => ({}))
const enabled = { skip: !api.ingestReport }
const access = { projectId: 'p', sessionIds: ['s'] }
const fence = value => '```ultra_evidence\n' + JSON.stringify(value) + '\n```'
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'report-evidence-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new EvidenceStore(directory)
  const source = store.capture({ projectId: 'p', runId: 'r', sessionId: 's', routeId: 'worker', eventId: 'report', kind: 'route/report', at: 1, text: 'Raw report remains unchanged.' })
  return { store, source, ingest: text => api.ingestReport(store, access, { runId: 'r', sessionId: 's', text, sourceIds: [source.id] }) }
}

test('exports local report ingestion and exact metadata prompt', () => {
  assert.equal(typeof api.ingestReport, 'function')
  assert.equal(typeof api.REPORT_EVIDENCE_INSTRUCTIONS, 'string')
})

test('extracts sourced semantic candidates and state without changing raw report', enabled, async t => {
  const { store, source, ingest } = fixture(t)
  const result = ingest(fence({ facts: [{ kind: 'fact', text: 'Offline retrieval is supported', sourceIds: [source.id], topics: ['retrieval'] }], state: { goal: 'Deliver local retrieval', sourceIds: [source.id], next: ['verify'] } }))
  assert.equal(result.errors.length, 0)
  assert.equal(result.added.length, 2)
  assert.match(store.semantics(access)[0].text, /未独立复核/)
  assert.equal(store.projectState(access).goal, 'Deliver local retrieval')
  assert.equal((await store.get(access, source.id)).text, 'Raw report remains unchanged.')
})

test('uses only the last block and repeated report ingestion is idempotent', enabled, t => {
  const { store, source, ingest } = fixture(t)
  const text = fence({ facts: [{ kind: 'fact', text: 'first block ignored', sourceIds: [source.id] }] }) + '\n' + fence({ facts: [{ kind: 'requirement', text: 'last block wins', sourceIds: [source.id] }] })
  ingest(text)
  assert.deepEqual(ingest(text).added, [])
  assert.equal(store.semantics(access).length, 1)
  assert.match(store.semantics(access)[0].text, /last block wins/)
})

test('malformed, oversized, unknown-key and unfinished last blocks produce diagnostics', enabled, t => {
  const { store, source, ingest } = fixture(t)
  for (const text of ['```ultra_evidence\n{broken}\n```', fence({ facts: [], authorize: true }), fence({ facts: [{ kind: 'fact', text: 'a'.repeat(33000), sourceIds: [source.id] }] }), '```ultra_evidence\n' + ' '.repeat(33000) + '{"facts":[]}\n```', fence({ facts: [] }) + '\n```ultra_evidence\n{']) {
    assert.ok(ingest(text).errors.length > 0)
  }
  assert.equal(store.semantics(access).length, 0)
  assert.deepEqual(ingest('ordinary report without metadata'), { added: [], errors: [] })
})

test('rejects unknown or foreign raw and semantic references before adding anything', enabled, t => {
  const { store, source, ingest } = fixture(t)
  const foreign = store.capture({ projectId: 'p', runId: 'r', sessionId: 'private', routeId: 'worker', eventId: 'secret', kind: 'message', at: 2, text: 'secret' })
  const secret = store.addSemantic({ projectId: 'p', kind: 'decision', text: 'private decision', sourceIds: [foreign.id] })
  for (const invalid of [
    { facts: [{ kind: 'fact', text: 'unknown', sourceIds: ['missing'] }] },
    { facts: [{ kind: 'fact', text: 'foreign', sourceIds: [foreign.id] }] },
    { facts: [{ kind: 'decision', text: 'supersedes secret', sourceIds: [source.id], supersedes: [secret.id] }] },
    { facts: [{ kind: 'fact', text: 'valid first', sourceIds: [source.id] }, { kind: 'fact', text: 'invalid second', sourceIds: ['missing'] }] },
  ]) assert.ok(ingest(fence(invalid)).errors.length > 0)
  assert.equal(store.semantics(access).length, 0)
})

test('reported verification and execution become explicit proposed operations', enabled, t => {
  const { store, source, ingest } = fixture(t)
  const result = ingest(fence({ facts: [], state: { goal: 'Review work', sourceIds: [source.id], operations: [{ id: 'test', description: 'all tests pass', status: 'verified', sourceIds: [source.id] }, { id: 'upload', description: 'published', status: 'executed', sourceIds: [] }] } }))
  assert.equal(result.added.length, 1)
  assert.equal(result.errors.length, 2)
  assert.deepEqual(store.projectState(access).operations.map(x => x.status), ['planned', 'planned'])
  assert.ok(store.projectState(access).operations.every(x => /未独立复核/.test(x.description)))
})

test('allows visible semantic supersession and preserves old records', enabled, t => {
  const { store, source, ingest } = fixture(t)
  const old = store.addSemantic({ projectId: 'p', kind: 'decision', text: 'old choice', sourceIds: [source.id] })
  const result = ingest(fence({ facts: [{ kind: 'decision', text: 'new choice', sourceIds: [source.id], supersedes: [old.id], status: 'current' }] }))
  assert.equal(result.errors.length, 0)
  assert.equal(store.semantics(access, { status: 'superseded' })[0].id, old.id)
})

test('caller input cannot forge project session access or report provenance', enabled, t => {
  const { store, source } = fixture(t)
  const text = fence({ facts: [{ kind: 'fact', text: 'forged', sourceIds: [source.id] }] })
  const result = api.ingestReport(store, access, { runId: 'r', sessionId: 'private', text, sourceIds: [source.id] })
  assert.ok(result.errors.length > 0)
  assert.equal(store.semantics(access).length, 0)
})
