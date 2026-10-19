import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// Run every native class AND each independently bundled core against the same
// selected SDK. Otherwise a nominal new-SDK run silently uses local old peers.
const selectedSdk = process.env.DSH_ULTRA_TEST_SDK && path.resolve(process.env.DSH_ULTRA_TEST_SDK)
const selectedRequire = createRequire(selectedSdk ? path.join(selectedSdk, '.ultra-sdk-selector.cjs') : import.meta.url)
const sdkImport = name => import(pathToFileURL(selectedRequire.resolve('@deepseek-ai/' + name)).href)
const [{ Context }, { ToolRuntime, defineContentToolFixture }, { SystemPrompt }, { SessionStore, SessionId }] =
  await Promise.all(['cordis', 'dsh-tools', 'dsh-system-prompt', 'dsh-session'].map(sdkImport))

// Separate self-contained bundles reproduce independent plugin module registries.
const output = fs.mkdtempSync(path.resolve('node_modules/.evidence-support-test-'))
async function bundle(name) {
  if (!fs.existsSync('src/evidence-support.ts')) return {}
  const outfile = path.join(output, name + '.mjs')
  await build({ stdin: { contents: 'export * from "./src/evidence-support.ts"; export {beginMemoryRun,memoryFor} from "./src/memory-host.ts"; export * as memoryPlugin from "./src/memory-plugin.ts"', resolveDir: process.cwd() }, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'pinned-native-sdk', setup(build) { build.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: pathToFileURL(selectedRequire.resolve(args.path)).href, external: true })) } }],
  })
  return import(pathToFileURL(outfile).href)
}
const first = await bundle('first'), second = await bundle('second')
test.after(() => fs.rmSync(output, { recursive: true, force: true }))

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-support-'))
  const ctx = new Context(), agents = new Map(), durable = new Map()
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
  await ctx.plugin(ToolRuntime, { mode: 'native' }).await()
  ctx.provide('agents', { get: id => agents.get(id) })
  ctx.on('session/flush', session => durable.set(session.id, { header: session.header, events: session.snapshotEvents() }))
  ctx.provide('sessionPersistence', { async open(id) {
    const value = durable.get(id)
    if (!value) throw new Error('missing persisted session')
    return { header: value.header, async read(offset = 0, length = 128) { return { events: value.events.slice(offset, offset + length) } }, async close() {} }
  } })
  function agent(id, parentSession) {
    const session = ctx.get('sessions').create(SessionId(id), { meta: { cwd: directory, ...(parentSession ? { parentSession } : {}) } })
    const a = { id, session, ctx, status: 'running' }; agents.set(id, a); return a
  }
  const parent = agent('root')
  t.after(async () => { await ctx.fiber.dispose(); fs.rmSync(directory, { recursive: true, force: true }) })
  const mount = async (api, owner, config = {}, options = {}) => {
    assert.equal(typeof api.acquireEvidenceSupport, 'function', 'shared evidence factory must exist')
    let lease
    const fork = ctx.plugin({ name: 'fixture-' + owner + '-' + Math.random(), apply(c) {
      lease = api.acquireEvidenceSupport(c, { evidenceEnabled: true, ...config }, { owner, ...options })
      c.effect(() => () => lease.release())
    } })
    await fork.await(); await ctx.get('ultraEvidenceSupport')?.ready?.()
    return { lease, fork }
  }
  return { ctx, parent, agent, agents, directory, mount, schemas: () => ctx.get('tools').schemas(parent).map(tool => tool.name) }
}

test('native leases share tools and survive unloading the first plugin, then fully clean up', async t => {
  const f = await fixture(t), a = await f.mount(first, 'memory'), b = await f.mount(second, 'decision')
  assert.equal(a.lease.memory, b.lease.memory)
  assert.equal(f.schemas().filter(name => name === 'ultra_memory_search').length, 1)
  const run = await second.beginMemoryRun(f.parent, 'cross-bundle')
  assert.ok(run); assert.equal(first.memoryFor(f.parent), run); assert.equal(second.memoryFor(f.parent), run)
  await a.fork.dispose()
  assert.ok(f.schemas().includes('ultra_memory_search'))
  assert.equal(second.memoryFor(f.parent), run)
  await b.fork.dispose()
  assert.equal(run.active, false)
  assert.equal(f.ctx.get('ultraEvidenceSupport'), undefined)
  assert.ok(!f.schemas().includes('ultra_memory_search'))
})

test('configuration authority is memory then ultra then decision in either mounting order', async t => {
  const f = await fixture(t), d = await f.mount(first, 'decision', { memoryGetChars: 1000 }), u = await f.mount(second, 'ultra', { memoryGetChars: 2000 }), m = await f.mount(first, 'memory', { memoryGetChars: 3000 })
  assert.equal(d.lease.memory.config.memoryGetChars, 3000)
  await m.fork.dispose(); assert.equal(d.lease.memory.config.memoryGetChars, 2000)
  await u.fork.dispose(); assert.equal(d.lease.memory.config.memoryGetChars, 1000)
  await d.fork.dispose()
})

test('cross-bundle lookup rejects forged callers and incompatible service versions', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory')
  const run = await first.beginMemoryRun(f.parent, 'real')
  assert.ok(run)
  assert.equal(second.memoryFor({ ...f.parent }), undefined)
  await m.fork.dispose()
  const remove = f.ctx.provide('ultraEvidenceSupport', { protocol: 'wrong' })
  assert.throws(() => first.acquireEvidenceSupport(f.ctx, {}, { owner: 'memory' }), /protocol|incompatible/i)
  assert.equal(second.memoryFor(f.parent), undefined)
  await remove()
})

test('provider feature changes register and dispose global tools through native scopes', async t => {
  const f = await fixture(t), d = await f.mount(first, 'decision', { globalKnowledge: { enabled: false } })
  assert.ok(!f.schemas().includes('ultra_knowledge_search'))
  const m = await f.mount(second, 'memory', { globalKnowledge: { enabled: true, projects: [] } })
  assert.ok(f.schemas().includes('ultra_knowledge_search'))
  await m.fork.dispose(); await f.ctx.get('ultraEvidenceSupport').ready()
  assert.ok(!f.schemas().includes('ultra_knowledge_search'))
  assert.ok(f.schemas().includes('ultra_memory_search'))
  await d.fork.dispose()
})

test('memory-only ordinary assembly creates one evidence run with global knowledge disabled', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory', { globalKnowledge: { enabled: false } })
  // Native assembly dispatch executes the real integration bootstrap middleware.
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  const run = second.memoryFor(f.parent)
  assert.ok(run)
  const decision = await f.ctx.waterfall('agent/pre-step', { agent: f.parent, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  assert.match(decision.messages[0].content[0].text, /项目证据入口/)
  const child = f.agent('child', f.parent.id)
  await f.ctx.serial('agent/created', { agent: child })
  assert.equal(second.memoryFor(child), run)
  await f.ctx.serial('session/event', f.parent.session, { type: 'turn/end' })
  await m.fork.dispose()
  assert.equal(run.active, false)
})

test('shared fallback observes each request once and yields to the active orchestration owner', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory')
  const run = await second.beginMemoryRun(f.parent, 'request-counts')
  async function request() {
    for await (const _ of f.ctx.waterfall('llm/stream', { sessionId: f.parent.id, messages: [] }, async function* () { yield { type: 'fixture' } })) {}
  }
  await request()
  assert.equal(run.status().resources.attemptedCalls, 1)
  const d = await f.mount(second, 'decision')
  await request()
  assert.equal(run.status().resources.attemptedCalls, 1, 'orchestration actor owns request counting now')
  await d.fork.dispose(); await request()
  assert.equal(run.status().resources.attemptedCalls, 2)
  await m.fork.dispose()
})

test('shared pretruncation capture remains exactly once across bundle leases and unload', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory'), d = await f.mount(second, 'decision')
  const run = await first.beginMemoryRun(f.parent, 'tool-captures')
  f.ctx.get('tools').register(defineContentToolFixture({ name: 'read_fixture', description: 'Offline public output', parameters: {}, async execute() { return [{ type: 'text', text: 'Unique test evidence' }] } }))
  async function execute(callId) { return f.ctx.get('tools').execute({ agent: f.parent, name: 'read_fixture', arguments: {}, callId, signal: new AbortController().signal }) }
  await execute('first-call')
  assert.equal(m.lease.captureStatus().capturedResults, 1)
  assert.equal((await run.host.search(f.parent, { query: 'Unique test evidence' })).items.length, 1)
  await m.fork.dispose(); await execute('second-call')
  assert.equal(d.lease.captureStatus().capturedResults, 2)
  await d.fork.dispose()
})

test('standalone Memory plugin defaults expose evidence without any coordination tools', async t => {
  const f = await fixture(t), fork = f.ctx.plugin(first.memoryPlugin, {})
  await fork.await()
  assert.deepEqual(f.schemas().filter(name => name.startsWith('ultra_')).sort(), ['ultra_memory_get', 'ultra_memory_search'])
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  assert.ok(second.memoryFor(f.parent))
  assert.equal(f.ctx.get('ultraEvidenceSupport').memory.config.contextCompression, false)
  await fork.dispose()
  assert.equal(f.ctx.get('ultraEvidenceSupport'), undefined)
})

test('publication uses active provider predicates across bundles and native read-only always denies', async t => {
  const f = await fixture(t)
  f.ctx.provide('profileContext', { dir: f.directory })
  const config = { globalKnowledge: { enabled: true, projects: [{ id: 'project', root: f.directory, read: true, publish: true, shareWith: ['project'] }] } }
  const m = await f.mount(first, 'memory', config, { canPublish: a => a === f.parent })
  const run = await first.beginMemoryRun(f.parent, 'publishing')
  const child = f.agent('decision', f.parent.id); run.bind(child, 'decision')
  const d = await f.mount(second, 'decision', {}, { canPublish: a => a === child })
  const [sourceId] = run.captureTool(child, 'read-source', 'read', { content: [{ type: 'text', text: 'A stable public source quote.' }] })
  const input = { key: 'test', title: 'Title', summary: 'Summary', applicability: 'fixture', sources: [{ sourceId, quote: 'A stable public source quote.' }] }
  const exec = { agent: child, signal: new AbortController().signal }
  const tool = () => f.ctx.get('tools').get('ultra_knowledge_publish')
  const result = await tool().execute(input, exec)
  assert.equal(typeof JSON.parse(result.text).id, 'string')
  const deny = f.ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
  await assert.rejects(tool().execute(input, exec), /publication.*not allowed/i)
  await deny(); await d.fork.dispose()
  await assert.rejects(tool().execute(input, exec), /publication.*not allowed/i)
  await m.fork.dispose()
})

test('retained read tool definitions cannot access evidence after the last lease closes', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory')
  const run = await first.beginMemoryRun(f.parent, 'stale-tool')
  run.captureTool(f.parent, 'read', 'read', { content: [{ type: 'text', text: 'Secret for the current lease' }] })
  const tool = f.ctx.get('tools').get('ultra_memory_search')
  await m.fork.dispose()
  await assert.rejects(tool.execute({ query: 'Secret' }, { agent: f.parent, signal: new AbortController().signal }), /active|disabled|closed|authorized/i)
})

test('a conflicting global tool rolls back all partially installed evidence hooks', async t => {
  const f = await fixture(t)
  f.ctx.get('tools').register(defineContentToolFixture({ name: 'ultra_knowledge_search', description: 'External owner', parameters: {}, async execute() { return [] } }))
  const beforeEffects = f.ctx.fiber.getEffects().length
  assert.throws(() => first.acquireEvidenceSupport(f.ctx, { globalKnowledge: { enabled: true } }, { owner: 'memory' }), /already registered/i)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.ctx.get('ultraEvidenceSupport'), undefined)
  assert.ok(!f.schemas().includes('ultra_memory_search'))
  assert.equal(f.ctx.fiber.getEffects().length, beforeEffects, 'failed setup returns every native effect to its prior owner')
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  assert.equal(first.memoryFor(f.parent), undefined, 'failed setup must not leave an ordinary-turn bootstrap hook')
})

test('a failed higher-priority feature switch does not poison the retained lease refresh queue', async t => {
  const f = await fixture(t), d = await f.mount(first, 'decision', { globalKnowledge: { enabled: false } })
  const beforeEffects = f.ctx.fiber.getEffects().length
  const removeConflict = f.ctx.get('tools').register(defineContentToolFixture({ name: 'ultra_knowledge_search', description: 'External owner', parameters: {}, async execute() { return [] } }))
  const m = second.acquireEvidenceSupport(f.ctx, { evidenceEnabled: true, globalKnowledge: { enabled: true, projects: [] } }, { owner: 'memory' })
  await assert.rejects(m.ready(), /already registered/i, 'the failed acquisition itself must report failure')
  const release = m.release()
  removeConflict()
  await release
  await d.lease.ready()
  assert.equal(f.ctx.get('ultraEvidenceSupport').status().owner, 'decision')
  assert.equal(f.ctx.get('ultraEvidenceSupport').status().transitioning, false)
  assert.equal(f.ctx.fiber.getEffects().length, beforeEffects, 'failed setup must not retain a lifecycle hook or write guard')
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  const run = await first.beginMemoryRun(f.parent, 'retained-after-failure')
  assert.ok(run)
  run.captureTool(f.parent, 'recovered-read', 'read', { content: [{ type: 'text', text: 'Retained lease recovery evidence' }] })
  const result = await f.ctx.get('tools').get('ultra_memory_search').execute({ query: 'Retained lease recovery evidence' }, { agent: f.parent, signal: new AbortController().signal })
  assert.equal(JSON.parse(result.text).items.length, 1)
  await run.dispose()
  const recovered = await f.mount(second, 'memory', { globalKnowledge: { enabled: false } })
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  const ordinaryRun = first.memoryFor(f.parent)
  assert.ok(ordinaryRun?.active, 'a later Memory lease can bootstrap an ordinary turn again')
  await recovered.fork.dispose()
  assert.equal(ordinaryRun.active, false)
  await d.fork.dispose()
})

test('injected factory contexts without get preserve absent-host and local-host fallback', async t => {
  assert.equal(await first.beginMemoryRun({ ctx: {} }, 'no-host'), undefined)
  const f = await fixture(t), m = await f.mount(first, 'memory')
  f.parent.ctx = { root: f.ctx }
  const run = await first.beginMemoryRun(f.parent, 'local-fallback')
  assert.ok(run, 'legacy local-host lookup still finds the host through the root')
  assert.equal(first.memoryFor(f.parent), run)
  await m.fork.dispose()
})
