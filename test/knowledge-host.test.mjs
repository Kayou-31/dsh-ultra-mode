import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { GlobalKnowledgeHost } from '../lib/knowledge-host.js'
import { UltraMemoryHost } from '../lib/memory-host.js'
const digest = text => createHash('sha256').update(text).digest('hex')
async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-knowledge-host-'))
  const dirs = Object.fromEntries(['profile', 'a', 'b', 'c', 'd'].map(k => { const d = path.join(base, k); fs.mkdirSync(d); return [k, d] }))
  const agents = new Map(), logs = new Map(), runs = new Map()
  const services = { profileContext: { dir: dirs.profile }, agents: { get: id => agents.get(id) }, sessions: { get: id => agents.get(id)?.session, async flush() { return true } }, sessionPersistence: { async open(id) { const a = agents.get(id), events = logs.get(id); if (!a || !events) throw new Error('unavailable'); return { header: a.session.header, async read(offset = 0, n = 128) { return { events: events.slice(offset, offset + n) } }, async close() {} } } } }
  const ctx = { get: key => services[key] }; ctx.root = ctx
  const memory = new UltraMemoryHost(ctx, { evidenceEnabled: true })
  t.after(async () => { await memory.close(); fs.rmSync(base, { recursive: true, force: true }) })
  function agent(id, project, parentSession) { const events = []; logs.set(id, events); const a = { id, ctx, session: { id, header: { id, cwd: project, parentSession }, get seq() { return events.length } } }; agents.set(id, a); return a }
  const a = agent('agent-a', dirs.a), b = agent('agent-b', dirs.b), c = agent('agent-c', dirs.c)
  for (const x of [a, b, c]) runs.set(x.id, await memory.begin(x, 'run-' + x.id))
  let config = { globalKnowledge: { enabled: true, projects: [{ id: 'A', root: dirs.a, read: true, publish: true, shareWith: ['B'] }, { id: 'B', root: dirs.b, read: true, publish: false, shareWith: [] }] } }
  const writable = new Set([a, b])
  const host = new GlobalKnowledgeHost(ctx, memory, () => config.globalKnowledge, x => writable.has(x))
  function source(text, coverage = 'captured') { const run = runs.get(a.id); return run.store.capture({ projectId: run.projectId, runId: run.runId, sessionId: a.id, routeId: 'main', eventId: 'source:' + Math.random(), at: Date.now(), kind: 'tool/result', text: coverage === 'reference-only' ? '' : text, coverage }) }
  function hostSource(text) { const events = logs.get(a.id), event = { type: 'tool/result', seq: events.length, time: Date.now(), data: { message: { content: [{ type: 'text', text }], source: { callId: 'read-' + events.length } } } }; events.push(event); const [id] = runs.get(a.id).captureEvent(a.session, event); return { id, event } }
  const publication = id => ({ key: 'service-rule', title: 'Published rule', summary: 'Model assessment only; use the exact approved rule.', applicability: 'This project release.', topics: ['release'], sources: [{ sourceId: id, quote: 'Exact release rule' }] })
  return { dirs, services, memory, host, a, b, c, agents, logs, runs, source, hostSource, publication, agent, writable, get config() { return config }, set config(x) { config = x } }
}

test('disabled config and unavailable host profile fail closed without creating guessed storage', async t => {
  const f = await fixture(t)
  f.config = {}
  assert.equal(f.host.entry(f.a), undefined)
  await assert.rejects(f.host.search(f.a, {}), /disabled|denied/i)
  f.config = { globalKnowledge: { enabled: true, projects: [{ id: 'A', root: f.dirs.a, read: true }] } }
  delete f.services.profileContext
  await assert.rejects(f.host.search(f.a, {}), /profile/i)
  assert.equal(fs.existsSync(path.join(f.dirs.a, '.dsh-ultra-knowledge')), false)
})

test('only registered live callers with active same-project MemoryRun can read or write', async t => {
  const f = await fixture(t)
  for (const caller of [{ ...f.a }, f.agent('unbound', f.dirs.a), f.c]) await assert.rejects(f.host.search(caller, {}), /denied|bound|authorized/i)
  await f.runs.get(f.a.id).dispose()
  await assert.rejects(f.host.search(f.a, {}), /active|denied|bound/i)
})

test('publishes exact current-session quotes and cross-project get returns only the shared slice', async t => {
  const f = await fixture(t), source = f.source('PRIVATE PREFIX Exact release rule PRIVATE SUFFIX')
  const result = await f.host.publish(f.a, f.publication(source.id))
  assert.equal(result.hostVerified, false)
  const found = await f.host.search(f.b, { query: 'rule' })
  assert.equal(found.total, 1)
  const got = await f.host.get(f.b, { id: result.id })
  const body = JSON.parse(got.text)
  assert.equal(body.sources[0].quote, 'Exact release rule')
  assert.equal(body.sources[0].verification, 'source-match')
  assert.equal(got.verification, 'source-match')
  assert.equal(body.hostVerified, false)
  assert.doesNotMatch(JSON.stringify(got), /PRIVATE PREFIX|PRIVATE SUFFIX/)
})

test('rejects fake quote, incomplete source, cross-session and write-role bypass', async t => {
  const f = await fixture(t), source = f.source('Exact release rule')
  await assert.rejects(f.host.publish(f.a, { ...f.publication(source.id), sources: [{ sourceId: source.id, quote: 'fake' }] }), /quote|substring/i)
  for (const coverage of ['truncated', 'reference-only']) await assert.rejects(f.host.publish(f.a, f.publication(f.source('Exact release rule', coverage).id)), /complete|coverage/i)
  const unrelated = f.agent('unrelated', f.dirs.a), run = await f.memory.begin(unrelated, 'unrelated-run')
  const privateSource = run.store.capture({ projectId: run.projectId, runId: run.runId, sessionId: unrelated.id, routeId: 'main', eventId: 'private', at: Date.now(), kind: 'tool/result', text: 'Exact release rule', coverage: 'captured' })
  await assert.rejects(f.host.publish(f.a, f.publication(privateSource.id)), /source|denied/i)
  f.writable.delete(f.a)
  await assert.rejects(f.host.publish(f.a, f.publication(source.id)), /publish|write|denied/i)
})

test('current grants and captured reader snapshot gate titles, counts and get before matching', async t => {
  const f = await fixture(t), result = await f.host.publish(f.a, f.publication(f.source('Exact release rule').id))
  f.config.globalKnowledge.projects.push({ id: 'C', root: f.dirs.c, read: true })
  f.config.globalKnowledge.projects[0].shareWith.push('C')
  assert.equal((await f.host.search(f.c, { query: 'rule' })).total, 0)
  await assert.rejects(f.host.get(f.c, { id: result.id }), /denied|not found/i)
  f.config.globalKnowledge.projects[0].shareWith = []
  assert.equal((await f.host.search(f.b, {})).total, 0)
  await assert.rejects(f.host.get(f.b, { id: result.id }), /denied|not found/i)
  f.config.globalKnowledge.projects[0].shareWith = ['B']
  f.config.globalKnowledge.projects[1].read = false
  await assert.rejects(f.host.search(f.b, {}), /denied|read/i)
})

test('changing publisher canonical root hides old records before result counts', async t => {
  const f = await fixture(t), result = await f.host.publish(f.a, f.publication(f.source('Exact release rule').id))
  f.config.globalKnowledge.projects[0].root = f.dirs.d
  assert.equal((await f.host.search(f.b, { query: 'rule' })).total, 0)
  await assert.rejects(f.host.get(f.b, { id: result.id }), /denied|not found/i)
})

test('host source changes and disappears report hash mismatch and unavailable with stored shared material', async t => {
  const f = await fixture(t), source = f.hostSource('SECRET BEFORE Exact release rule SECRET AFTER')
  const result = await f.host.publish(f.a, f.publication(source.id))
  assert.equal((await f.host.get(f.b, { id: result.id })).verification, 'source-match')
  source.event.data.message.content[0].text = 'changed host output'
  const changed = await f.host.get(f.b, { id: result.id })
  assert.equal(changed.verification, 'hash-mismatch')
  assert.match(changed.text, /Exact release rule/)
  f.logs.delete(f.a.id)
  assert.equal((await f.host.get(f.b, { id: result.id })).verification, 'unavailable')
})

test('source metadata identity drift is rejected and no raw path is leaked', async t => {
  const f = await fixture(t), source = f.source('Exact release rule')
  const result = await f.host.publish(f.a, f.publication(source.id))
  const records = path.join(f.dirs.a, '.dsh-ultra', 'v1', 'records')
  const file = fs.readdirSync(records).map(n => path.join(records, n)).find(n => JSON.parse(fs.readFileSync(n)).record.id === source.id)
  const envelope = JSON.parse(fs.readFileSync(file)); envelope.record.version++
  envelope.sha256 = digest(JSON.stringify(envelope.record)); fs.writeFileSync(file, JSON.stringify(envelope))
  const got = await f.host.get(f.b, { id: result.id })
  assert.ok(['identity-mismatch', 'unavailable'].includes(got.verification))
  assert.doesNotMatch(JSON.stringify(got), new RegExp(f.dirs.a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('actual JSON budgets include metadata and get pagination rebuilds an escape-heavy document', async t => {
  const f = await fixture(t), source = f.source('Exact release rule')
  const result = await f.host.publish(f.a, { ...f.publication(source.id), title: '\\"'.repeat(80), summary: '\\"\n'.repeat(1000) })
  let offset = 0, text = ''
  for (let i = 0; i < 300; i++) {
    const page = await f.host.get(f.b, { id: result.id, maxChars: 512, offset })
    assert.ok(JSON.stringify(page).length <= 512)
    assert.equal(page.offset, offset)
    text += page.text
    if (page.nextOffset === undefined) break
    assert.ok(page.nextOffset > offset)
    offset = page.nextOffset
  }
  assert.equal(JSON.parse(text).summary, '\\"\n'.repeat(1000))
  const search = await f.host.search(f.b, { maxChars: 512 })
  assert.ok(JSON.stringify(search).length <= 512)
})

test('a different host profile cannot read the publication and entry stays compact', async t => {
  const f = await fixture(t), result = await f.host.publish(f.a, f.publication(f.source('Exact release rule').id))
  assert.match(f.host.entry(f.b), /ultra_knowledge_search/)
  assert.ok(f.host.entry(f.b).length < 1500)
  assert.doesNotMatch(f.host.entry(f.b), /Published rule|Exact release rule/)
  const other = path.join(f.dirs.profile, 'other'); fs.mkdirSync(other)
  f.services.profileContext = { dir: other }
  assert.equal((await f.host.search(f.b, {})).total, 0)
  await assert.rejects(f.host.get(f.b, { id: result.id }), /denied|not found/i)
})

test('revocation hides all payload even from explicitly requested publisher history', async t => {
  const f = await fixture(t), result = await f.host.publish(f.a, f.publication(f.source('Exact release rule').id))
  f.host.revoke(f.a, { id: result.id, reason: 'outdated' })
  assert.equal((await f.host.search(f.b, {})).total, 0)
  await assert.rejects(f.host.get(f.b, { id: result.id, includeInactive: true }), /denied|not found/i)
  const own = await f.host.get(f.a, { id: result.id, includeInactive: true })
  assert.equal(own.status, 'revoked')
  assert.doesNotMatch(JSON.stringify(own), /Published rule|Exact release rule/)
})

test('duplicate or invalid project registrations fail closed and status discloses only caller context', async t => {
  const f = await fixture(t)
  const status = JSON.stringify(f.host.status(f.b))
  assert.doesNotMatch(status, /agent-a|shareWith|Published rule/)
  assert.equal(status.includes(f.dirs.a), false)
  f.config.globalKnowledge.projects.push({ id: 'ALIAS', root: f.dirs.a, read: true })
  await assert.rejects(f.host.search(f.b, {}), /duplicate|unique|configuration/i)
})



test('bootstrap policy supports volatile config before MemoryRun binding without storage creation', async t => {
  const f = await fixture(t)
  const unbound = f.agent('preflight', f.dirs.a)
  const host = new GlobalKnowledgeHost(f.a.ctx, f.memory, () => ({ get: () => f.config.globalKnowledge }), x => x === unbound)
  assert.equal(host.authorized(unbound), true)
  assert.match(host.entry(unbound), /ultra_knowledge_search/)
  assert.equal(fs.existsSync(path.join(f.dirs.profile, '.dsh-ultra-knowledge')), false)
  await assert.rejects(host.search(unbound, {}), /bound|denied/i)
  f.config.globalKnowledge.enabled = false
  assert.equal(host.authorized(unbound), false)
  assert.equal(host.entry(unbound), undefined)
})

test('publishing rechecks live grants and writer eligibility after asynchronous source validation', async t => {
  const f = await fixture(t), source = f.hostSource('Exact release rule')
  const original = f.memory.resolve.bind(f.memory)
  f.memory.resolve = async (...args) => { const result = await original(...args); f.writable.delete(f.a); return result }
  await assert.rejects(f.host.publish(f.a, f.publication(source.id)), /denied/i)
  assert.equal((await f.host.search(f.b, {})).total, 0)
})

test('get rechecks live reader grant after asynchronous original source verification', async t => {
  const f = await fixture(t), source = f.hostSource('Exact release rule')
  const result = await f.host.publish(f.a, f.publication(source.id))
  const original = f.memory.resolve.bind(f.memory)
  f.memory.resolve = async (...args) => { const value = await original(...args); f.config.globalKnowledge.projects[0].shareWith = []; return value }
  await assert.rejects(f.host.get(f.b, { id: result.id }), /denied/i)
})

test('retrieval-derived and private reasoning records cannot be republished as original evidence', async t => {
  const f = await fixture(t), run = f.runs.get(f.a.id)
  for (const origin of [{ tool: 'ultra_knowledge_get', callId: 'k' }, { tool: 'ultra_memory_get', callId: 'm' }]) {
    const source = run.store.capture({ projectId: run.projectId, runId: run.runId, sessionId: f.a.id, routeId: 'main', eventId: origin.callId, at: Date.now(), kind: 'tool/result', text: 'Exact release rule', coverage: 'captured', origin })
    await assert.rejects(f.host.publish(f.a, f.publication(source.id)), /original|public/i)
  }
  const source = run.store.capture({ projectId: run.projectId, runId: run.runId, sessionId: f.a.id, routeId: 'main', eventId: 'reasoning', at: Date.now(), kind: 'assistant/reasoning', text: 'Exact release rule', coverage: 'captured' })
  await assert.rejects(f.host.publish(f.a, f.publication(source.id)), /original|public/i)
})

test('full-source SHA validation survives Unicode across evidence pages and configured response caps', async t => {
  const f = await fixture(t), source = f.source(('x'.repeat(63000) + '🌙').repeat(2) + 'Exact release rule')
  f.config.globalKnowledge.maxGetChars = 600
  f.config.globalKnowledge.maxSearchChars = 600
  const result = await f.host.publish(f.a, f.publication(source.id))
  assert.equal(result.verification, 'source-match')
  assert.ok(JSON.stringify(await f.host.get(f.b, { id: result.id, maxChars: 64000 })).length <= 600)
  assert.ok(JSON.stringify(await f.host.search(f.b, { maxChars: 32000 })).length <= 600)
})

test('revoked historical search never matches the hidden title or summary', async t => {
  const f = await fixture(t), result = await f.host.publish(f.a, f.publication(f.source('Exact release rule').id))
  f.host.revoke(f.a, { id: result.id, reason: 'withdrawn' })
  const resultHistory = await f.host.search(f.a, { includeInactive: true })
  assert.doesNotMatch(JSON.stringify(resultHistory), /Published rule|Model assessment|Exact release rule/)
  assert.equal((await f.host.search(f.a, { includeInactive: true, query: 'Published rule' })).total, 0)
  assert.equal((await f.host.search(f.a, { includeInactive: true, topic: 'release' })).total, 0)
})


test('rebinding a reader project ID to a new canonical root cannot inherit earlier publications', async t => {
  const f = await fixture(t), source = f.source('Exact release rule')
  const published = await f.host.publish(f.a, f.publication(source.id))
  f.config.globalKnowledge.projects[1].root = f.dirs.d
  const rebound = f.agent('rebound-b', f.dirs.d)
  await f.memory.begin(rebound, 'rebound-run')
  const search = await f.host.search(rebound, { query: 'rule' })
  assert.equal(search.total, 0)
  assert.equal(search.items.length, 0)
  await assert.rejects(f.host.get(rebound, { id: published.id }), /denied|not found/i)
  const replacement = await f.host.publish(f.a, { ...f.publication(source.id), supersedes: published.id })
  assert.notEqual(replacement.id, published.id)
  assert.equal((await f.host.search(rebound, { query: 'rule' })).total, 1)
  assert.equal((await f.host.get(rebound, { id: replacement.id })).verification, 'source-match')
})

test('publication refuses corrupted canonical source records even when the bound MemoryRun cached valid evidence', async t => {
  const f = await fixture(t), source = f.source('Exact release rule')
  const records = path.join(f.dirs.a, '.dsh-ultra', 'v1', 'records')
  const file = fs.readdirSync(records).map(n => path.join(records, n)).find(n => JSON.parse(fs.readFileSync(n)).record.id === source.id)
  fs.writeFileSync(file, '{corrupt')
  await assert.rejects(f.host.publish(f.a, f.publication(source.id)), /integrity|source|JSON/i)
  assert.equal((await f.host.search(f.b, {})).total, 0)
})

test('per-tool cancellation during source validation prevents publication while the caller remains running', async t => {
  const f = await fixture(t), source = f.hostSource('Exact release rule')
  const controller = new AbortController()
  f.a.status = 'running'
  let held, release
  const started = new Promise(resolve => { held = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const original = f.memory.resolve.bind(f.memory)
  f.memory.resolve = async (...args) => { const result = await original(...args); held(); await gate; return result }
  const pending = f.host.publish(f.a, f.publication(source.id), controller.signal)
  await started
  controller.abort(new Error('tool cancelled while validating source'))
  assert.equal(f.a.status, 'running')
  release()
  await assert.rejects(pending, /cancel|abort/i)
  assert.equal((await f.host.search(f.b, {})).total, 0)
})

test('a pre-aborted tool signal creates no knowledge storage or publication', async t => {
  const f = await fixture(t), source = f.source('Exact release rule')
  const controller = new AbortController()
  controller.abort(new Error('tool pre-aborted'))
  await assert.rejects(f.host.publish(f.a, f.publication(source.id), controller.signal), /abort/i)
  assert.equal(fs.existsSync(path.join(f.dirs.profile, '.dsh-ultra-knowledge')), false)
})
