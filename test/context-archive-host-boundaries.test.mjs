import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { UltraMemoryHost } from '../lib/memory-host.js'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'

async function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-archive-boundary-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const session = Session.create(SessionId('archive-boundary-root'), undefined, { version: 4, id: SessionId('archive-boundary-root'), createdAt: 1, isSeeded: false, cwd })
  const events = [], append = session.append.bind(session)
  session.append = (...args) => { const event = append(...args); events.push(event); return event }
  const config = { evidenceEnabled: true, contextCompression: true, contextArchiveCompletedTurns: true, contextTargetTokens: 4096,
    contextRetainRecentMessages: 2, contextMinResultChars: 1000000, contextOutputReserveTokens: 256, contextToolReserveTokens: 256 }
  const services = { tools: { get: name => name === 'ultra_memory_get' ? {} : undefined }, tokenMeter: { estimateMessage: message => Math.ceil(JSON.stringify(message).length / 4) },
    sessions: { async flush() { return true } }, sessionPersistence: { async open(id, access) {
      assert.equal(id, session.id); assert.equal(access, 'read')
      return { header: session.header, async read(offset = 0, length = 128) { return { events: events.slice(offset, offset + length) } }, async close() {} }
    } } }
  const ctx = { root: null, get: name => services[name] }; ctx.root = ctx
  const root = { id: session.id, session, ctx }
  services.agents = { get: id => id === root.id ? root : undefined }
  const host = new UltraMemoryHost(ctx, config)
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Preserve initial offline permission and completed operations.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  const callId = ToolCallId('boundary-call')
  session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{}' }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId, name: 'read', arguments: '{}' })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'CANONICAL_RECOVERY_BODY '.repeat(5000) }], isError: false }) }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 }); session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  for (const text of ['Current work remains unverified.', 'Do not republish or repeat completed work.']) session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const run = await host.begin(root, 'archive-boundary-run')
  assert.ok(run, JSON.stringify(host.status(root.id)))
  t.after(() => run.dispose())
  return { cwd, session, events, config, services, ctx, root, host, run }
}

test('disabling evidence cannot bypass an already committed but unconfirmed archive persistence boundary', async t => {
  const f = await fixture(t), checkpoint = f.run.checkpoint.bind(f.run)
  f.run.checkpoint = async () => { await checkpoint(); if (f.session.surface.replaceGeneration > 0) throw new Error('injected committed durability failure') }
  await assert.rejects(f.host.beforeStep(f.root), /archive|persist|commit/i)
  assert.equal(f.run.status().archive.committed, true)
  f.config.evidenceEnabled = false
  await assert.rejects(f.host.beforeStep(f.root), /archive|persist|commit/i)
  assert.throws(() => f.host.observeRequest({ sessionId: f.root.id, messages: f.session.deriveMessages() }), /archive|persist|commit/i)
})

test('a newly appended archive checkpoint cannot reuse a generation cache from a previously verified checkpoint', async t => {
  const f = await fixture(t)
  await f.host.beforeStep(f.root)
  assert.equal(f.run.status().archive.status, 'archived')
  const generation = f.session.surface.replaceGeneration
  const event = f.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Unverified capsule must not become admitted history.' }], source: { kind: 'compact-checkpoint', compactionId: 'arc_' + '0'.repeat(64) } }), { surfaceOp: 'append' })
  f.host.capture(f.session, event)
  assert.equal(f.session.surface.replaceGeneration, generation)
  assert.throws(() => f.host.observeRequest({ sessionId: f.root.id, messages: f.session.deriveMessages() }), /archive|verification/i)
  await assert.rejects(f.host.beforeStep(f.root), /archive|ENOENT|integrity|checkpoint/i)
})

test('a capsule appended during disabled evidence cannot disappear from active archive validation after reenable', async t => {
  const f = await fixture(t)
  await f.host.beforeStep(f.root)
  assert.equal(f.run.status().archive.status, 'archived')
  f.config.evidenceEnabled = false; f.host.refreshAuthority()
  const event = f.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Disabled-range archive must remain untrusted and block admission.' }], source: { kind: 'compact-checkpoint', compactionId: 'arc_' + '1'.repeat(64) } }), { surfaceOp: 'append' })
  f.host.capture(f.session, event)
  f.config.evidenceEnabled = true; f.host.refreshAuthority()
  await assert.rejects(f.host.beforeStep(f.root), /archive|checkpoint|exclu|coverage|disabled/i)
})

test('an archive appended during prepare must be verified before the same pending model admission', async t => {
  const f = await fixture(t), store = f.run.archives(), prepare = store.prepare.bind(store)
  store.prepare = async (...args) => {
    const receipt = await prepare(...args)
    const event = f.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'A concurrently appended checkpoint is not authorized by failing another transaction.' }], source: { kind: 'compact-checkpoint', compactionId: 'arc_' + '2'.repeat(64) } }), { surfaceOp: 'append' })
    f.host.capture(f.session, event)
    return receipt
  }
  await assert.rejects(f.host.beforeStep(f.root), /archive|checkpoint|surface|source|ENOENT/i)
})

test('a confirmed active archive requires usable recovery on every host and direct request admission', async t => {
  for (const failure of ['evidence-disabled', 'missing-scoped-tool', 'insufficient-budget']) await t.test(failure, async t => {
    const f = await fixture(t)
    await f.host.beforeStep(f.root)
    const archive = f.run.status().archive
    assert.equal(archive?.status, 'archived')
    assert.equal(archive.persistenceUncertain, false)
    assert.equal(f.run.needsArchiveRecovery, false, 'this tests a confirmed archive, not the existing uncertain-commit guard')
    const tools = f.services.tools, originalBudget = f.config.memoryGetChars
    if (failure === 'evidence-disabled') { f.config.evidenceEnabled = false; f.host.refreshAuthority() }
    if (failure === 'missing-scoped-tool') f.services.tools = { get: () => undefined }
    if (failure === 'insufficient-budget') f.config.memoryGetChars = 256
    const request = { sessionId: f.root.id, messages: f.session.deriveMessages(), tools: [{ name: 'ultra_memory_get' }] }
    const checks = [
      ['host.beforeStep', () => f.host.beforeStep(f.root)],
      ['host.observeRequest', () => f.host.observeRequest(request)],
      ['run.beforeStep', () => f.run.beforeStep(f.root)],
      ['run.observeRequest', () => f.run.observeRequest(f.root, request)],
    ]
    const denied = []
    for (const [name, check] of checks) {
      try { await check() }
      catch (error) { assert.match(String(error), /archive|recovery|memory|get|evidence|budget|1024/i); denied.push(name) }
    }
    f.config.evidenceEnabled = true
    if (originalBudget === undefined) delete f.config.memoryGetChars
    else f.config.memoryGetChars = originalBudget
    f.services.tools = tools; f.host.refreshAuthority()
    await f.host.beforeStep(f.root)
    await f.run.beforeStep(f.root)
    f.host.observeRequest(request)
    f.run.observeRequest(f.root, request)
    assert.equal((await f.host.get(f.root, archive.receiptId, { maxChars: 1500 })).contextArchive, true)
    assert.deepEqual(denied, checks.map(([name]) => name), 'each admission must refuse while the original recovery path is unavailable')
  })
})

test('failed cold initialization cannot admit an active native archive without a bound recovery run', async t => {
  const f = await fixture(t)
  await f.host.beforeStep(f.root)
  const id = f.run.status().archive.receiptId
  assert.equal(f.run.status().archive.status, 'archived')
  await f.run.dispose()
  // A fresh human input makes the saved scan cursor incomplete, so begin must
  // actually open persistence rather than satisfying initialization from cache.
  f.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Resume only after validating prior archived work.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const persistence = f.services.sessionPersistence
  let failedReads = 0
  f.services.sessionPersistence = { async open() { failedReads++; throw new Error('injected cold source unavailable') } }
  const reopened = await f.host.begin(f.root, 'failed-cold-init')
  assert.ok(reopened === undefined, 'the injected persistence failure must prevent a recovery binding')
  assert.ok(failedReads > 0)
  f.services.sessionPersistence = persistence
  assert.ok(f.session.deriveMessages().some(message => message.source?.kind === 'compact-checkpoint'))
  await assert.rejects(f.host.get(f.root, id), /bound|access/i)
  const denied = [], expected = []
  for (const enabled of [true, false]) {
    f.config.evidenceEnabled = enabled; f.host.refreshAuthority()
    for (const [name, check] of [
      ['beforeStep', () => f.host.beforeStep(f.root)],
      ['observeRequest', () => f.host.observeRequest({ sessionId: f.root.id, messages: f.session.deriveMessages(), tools: [{ name: 'ultra_memory_get' }] })],
    ]) {
      const label = `${enabled ? 'enabled' : 'disabled'}:${name}`; expected.push(label)
      try { await check() }
      catch (error) { assert.match(String(error), /archive|recovery|bound|access|initial/i); denied.push(label) }
    }
  }
  f.config.evidenceEnabled = true; f.host.refreshAuthority()
  const restored = await f.host.begin(f.root, 'recovered-cold-init')
  assert.ok(restored !== undefined)
  t.after(() => restored.dispose())
  await f.host.beforeStep(f.root)
  assert.equal((await f.host.get(f.root, id, { maxChars: 1500 })).contextArchive, true)
  assert.deepEqual(denied, expected, 'native archive dependency must fail closed even when begin returned no run')
})
