/** Conflicting configuration across real, independently bundled plugin entrypoints. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const selected = process.env.DSH_ULTRA_TEST_SDK && path.resolve(process.env.DSH_ULTRA_TEST_SDK)
const require = createRequire(selected ? path.join(selected, '.ultra-sdk-selector.cjs') : import.meta.url)
const sdk = Object.fromEntries(await Promise.all(['cordis', 'dsh-tools', 'dsh-session', 'dsh-system-prompt', 'dsh-scope', 'dsh-llm'].map(async name => [name, await import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href)])))
const output = fs.mkdtempSync(path.resolve('node_modules/.evidence-authority-test-'))
test.after(() => fs.rmSync(output, { recursive: true, force: true }))
const plugins = {}
for (const [name, entry] of [['memory', 'src/memory-plugin.ts'], ['ultra', 'src/index.ts'], ['decision', 'src/decision-plugin.ts']]) {
  const outfile = path.join(output, name + '.mjs')
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'same-native-sdk', setup(build) { build.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true })) } }],
  })
  plugins[name] = await import(pathToFileURL(outfile).href)
}

async function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-authority-'))
  const ctx = new sdk.cordis.Context(), agents = new Map(), durable = new Map(), scopes = [], forks = [], commands = new Map(), created = []
  await ctx.plugin(sdk['dsh-session'].SessionStore).await()
  await ctx.plugin(sdk['dsh-system-prompt'].SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
  await ctx.plugin(sdk['dsh-tools'].ToolRuntime, { mode: 'native' }).await()
  ctx.on('session/flush', session => durable.set(session.id, { header: session.header, events: session.snapshotEvents() }))
  ctx.provide('sessionPersistence', { async open(id) {
    const record = durable.get(id)
    if (!record) throw new Error('No durable fixture session')
    return { header: record.header, async read(offset = 0, length = 128) { return { events: record.events.slice(offset, offset + length) } }, async close() {} }
  } })
  ctx.provide('commands', { register(command) { commands.set(command.name, command); return () => commands.delete(command.name) } })
  const { createScope, scopeOf, scopeParentOf, bindScopeParent } = sdk['dsh-scope']
  ctx.provide('agentPresets', { composeFrom(child, parent) { const inherited = scopeParentOf(scopeOf(parent)); if (inherited) bindScopeParent(scopeOf(child), inherited) } })
  function agent(id, meta = {}) {
    const gate = Promise.withResolvers()
    const a = { id, session: ctx.get('sessions').create(sdk['dsh-session'].SessionId(id), { meta: { cwd, ...meta } }), status: 'running', options: { provider: 'offline', model: 'no-provider' },
      inbox: { nextStep: [], remove() {} }, steer() {}, followup() { a.pending = gate.promise }, async whenIdle() { await a.pending }, cancel() { gate.resolve(); a.status = 'idle' } }
    agents.set(id, a)
    const scope = createScope(ctx, a); scopes.push(scope); a.ctx = scope.ctx
    return a
  }
  ctx.provide('agents', { get: id => agents.get(id), roots: () => [...agents.values()].filter(a => !a.session.header.parentSession), async create(options) {
    const child = agent(options.sessionId, options.meta); created.push(child)
    await options.setup(child.ctx, child)
    await ctx.serial('agent/created', { agent: child })
    return { agent: child, async dispose() { child.cancel(); await child.ctx.fiber.dispose(); agents.delete(child.id) } }
  } })
  const parent = agent('root')
  t.after(async () => { for (const fork of forks.toReversed()) await fork.dispose(); for (const scope of scopes.toReversed()) await scope.dispose(); await ctx.fiber.dispose(); fs.rmSync(cwd, { recursive: true, force: true }) })
  const mount = async (variant, config) => { const fork = ctx.plugin(plugins[variant], config); forks.push(fork); await fork.await(); return fork }
  const request = async () => { for await (const _ of ctx.waterfall('llm/stream', { sessionId: parent.id, messages: [] }, async function* () { yield { type: 'fixture' } })) {} }
  const assemble = () => ctx.get('systemPrompt').assemble({ agent: parent, scope: scopeOf(parent.ctx), signal: new AbortController().signal })
  const message = text => sdk['dsh-llm'].createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const append = text => parent.session.append('user/message', message(text), { surfaceOp: 'append' })
  return { ctx, cwd, parent, mount, request, assemble, commands, created, append, message }
}

for (const coordinator of ['ultra', 'decision']) for (const order of ['memory-first', 'coordinator-first']) {
  test(`${coordinator} with local evidence disabled obeys enabled Memory authority (${order})`, async t => {
    const f = await fixture(t)
    const memoryConfig = { evidenceEnabled: true, memoryMaxRequests: 1 }, coordinatorConfig = { evidenceEnabled: false, researchTools: [] }
    if (order === 'memory-first') { await f.mount('memory', memoryConfig); await f.mount(coordinator, coordinatorConfig) }
    else { await f.mount(coordinator, coordinatorConfig); await f.mount('memory', memoryConfig) }
    await f.assemble()
    const service = f.ctx.get('ultraEvidenceSupport'), run = service.runFor(f.parent)
    assert.ok(run)
    await f.request()
    assert.equal(run.status().resources.attemptedCalls, 1)
    await assert.rejects(f.request(), /request budget exhausted/i)
    assert.equal(run.status().resources.attemptedCalls, 1)
    // Start an actual read-only sidecar through the coordinator's public command
    // and pre-step middleware, so its allowlist comes from runConfigFor().
    await run.dispose()
    f.commands.get(coordinator).handler({ agent: f.parent, rawInput: 'assist' })
    const user = f.message('Check this task without executing any provider')
    f.parent.session.append('turn/start', { turn: 1 })
    const admitted = await f.ctx.waterfall('agent/pre-step', { agent: f.parent, step: 1, turn: 1, signal: new AbortController().signal, messages: [user] }, async () => ({ kind: 'enter', messages: [user] }))
    assert.equal(f.created.length, 1, JSON.stringify(admitted))
    const child = f.created[0], schemas = child.ctx.get('tools').schemas(child).map(tool => tool.name)
    assert.ok(schemas.includes('ultra_memory_search'), 'actual sidecar read-only allowlist includes shared project search')
    assert.ok(schemas.includes('ultra_memory_get'), 'actual sidecar read-only allowlist includes shared project get')
  })
}

for (const coordinator of ['ultra', 'decision']) {
  test(`${coordinator} active run suspends every evidence writer while higher-priority Memory is disabled`, async t => {
    const f = await fixture(t)
    await f.mount(coordinator, { evidenceEnabled: true, memoryMaxRequests: 3 })
    const service = f.ctx.get('ultraEvidenceSupport'), run = await service.memory.begin(f.parent, 'orchestrator-owned')
    run.recordTask('Enabled task')
    f.append('Enabled source before suspension')
    await f.request()
    const before = run.status(), records = [...run.store.recordsFor(run.access())].length
    const ledger = () => fs.readdirSync(path.join(run.directory, 'ledger'), { recursive: true }).filter(name => name.endsWith('.json')).map(name => [name, fs.readFileSync(path.join(run.directory, 'ledger', name), 'utf8')])
    const beforeLedger = ledger()
    const disabled = await f.mount('memory', { evidenceEnabled: false, contextCompression: true, contextTargetTokens: 4096 })
    f.append('DISABLED_INTERVAL_SENTINEL')
    await f.request()
    run.observeRequest(f.parent, { messages: [] })
    run.captureTool(f.parent, 'disabled-call', 'read', { content: [{ type: 'text', text: 'DISABLED_TOOL_SENTINEL' }] })
    run.recordTask('DISABLED_TASK_SENTINEL'); run.recordReport(f.parent.id, 'DISABLED_REPORT_SENTINEL', 'done')
    run.recordGovernance({ text: 'DISABLED_GOVERNANCE_SENTINEL' }); run.stage('disabled-stage')
    run.recordDelivery('disabled-delivery', f.parent.id, 'queued')
    const large = [{ content: [{ type: 'text', text: 'x'.repeat(100000) }] }]
    await service.memory.beforeStep(f.parent, large)
    await run.beforeStep(f.parent, large)
    assert.equal(service.memory.mainContext(f.parent), undefined)
    assert.equal(run.mainContext(999), undefined)
    assert.equal(run.entry(), '')
    assert.deepEqual(run.refs(f.parent.id), [])
    assert.equal(run.status().resources.attemptedCalls, before.resources.attemptedCalls)
    assert.equal(run.status().compression, before.compression)
    assert.equal(run.status().phase, before.phase)
    assert.deepEqual(run.status().deliveries, before.deliveries)
    assert.deepEqual(ledger(), beforeLedger, 'disabled direct calls do not write request or usage ledger files')
    assert.equal([...run.store.recordsFor(run.access())].length, records)
    await run.checkpoint()
    assert.equal([...run.store.recordsFor(run.access())].length, records, 'cleanup/checkpoint cannot backfill the disabled interval')
    await disabled.dispose()
    assert.equal(service.runFor(f.parent), run)
    f.append('Enabled source after recovery')
    await f.request()
    assert.equal(run.status().resources.attemptedCalls, 2, 'recovery resumes exactly one observer')
    assert.ok(run.status().coverageGaps.some(gap => /authority was disabled/.test(gap.reason)))
    await run.checkpoint()
    assert.equal((await service.memory.search(f.parent, { query: 'DISABLED_INTERVAL_SENTINEL' })).items.length, 0)
    assert.equal((await service.memory.search(f.parent, { query: 'Enabled source after recovery', kind: 'user/message' })).items.length, 1)
    assert.equal(service.memory.mainContext(f.parent), undefined)
    await service.memory.prepareTaskMemory(f.parent)
    assert.match(service.memory.taskContext(f.parent), /Ultra 工程记忆/)
    await run.dispose()
    const resumed = await service.memory.begin(f.parent, 'next-run-after-suspension')
    assert.ok(resumed)
    assert.equal((await service.memory.search(f.parent, { query: 'DISABLED_INTERVAL_SENTINEL' })).items.length, 0, 'a new run must retain the persisted exclusion rather than backfill it')
  })
}

test('a failed suspension checkpoint cannot leak a provider or reopen a disabled run', async t => {
  const f = await fixture(t)
  await f.mount('ultra', { evidenceEnabled: true })
  const service = f.ctx.get('ultraEvidenceSupport'), run = await service.memory.begin(f.parent, 'authority-write-failure')
  const directory = path.join(run.directory, 'owners')
  const owner = fs.readdirSync(directory).find(name => name.endsWith('.json') && !name.includes('-scan-'))
  const filename = path.join(directory, owner), original = fs.readFileSync(filename)
  fs.unlinkSync(filename); fs.mkdirSync(filename)
  let disabled
  try {
    disabled = await f.mount('memory', { evidenceEnabled: false })
    assert.equal(service.status().leases, 2)
    assert.equal(run.status().available, false)
    f.append('FAILED_CHECKPOINT_DISABLED_SENTINEL')
    await disabled.dispose()
    assert.equal(service.status().leases, 1)
    assert.equal(service.runFor(f.parent), undefined, 'resume remains fail-closed until its boundary can be saved')
    assert.equal(run.entry(), '')
  } finally { fs.rmdirSync(filename); fs.writeFileSync(filename, original) }
  service.memory.refreshAuthority()
  assert.equal(service.runFor(f.parent), run)
  await run.checkpoint()
  assert.equal((await service.memory.search(f.parent, { query: 'FAILED_CHECKPOINT_DISABLED_SENTINEL' })).items.length, 0)
})

for (const resumeBeforeInitialization of [false, true]) test(`authority changes cover a bound run awaiting initialization (resume first: ${resumeBeforeInitialization})`, async t => {
  const f = await fixture(t)
  await f.mount('decision', { evidenceEnabled: true })
  const service = f.ctx.get('ultraEvidenceSupport'), memory = service.memory
  const entered = Promise.withResolvers(), gate = Promise.withResolvers(), flush = memory.flush.bind(memory)
  let held = false
  memory.flush = async session => { if (!held) { held = true; entered.resolve(); await gate.promise } return flush(session) }
  const starting = memory.begin(f.parent, 'held-initialize')
  await entered.promise
  const initializing = service.runFor(f.parent)
  assert.ok(initializing, 'the native registered agent is already bound')
  const disabled = await f.mount('memory', { evidenceEnabled: false })
  f.append('INITIALIZING_DISABLED_SECRET')
  assert.equal(service.runFor(f.parent), undefined)
  if (resumeBeforeInitialization) await disabled.dispose()
  gate.resolve()
  const run = await starting
  assert.equal(run, initializing)
  if (!resumeBeforeInitialization) {
    assert.equal(service.runFor(f.parent), undefined)
    await run.checkpoint()
    await disabled.dispose()
  }
  await run.checkpoint()
  assert.equal((await memory.search(f.parent, { query: 'INITIALIZING_DISABLED_SECRET' })).items.length, 0)
  assert.ok(run.status().coverageGaps.some(gap => /authority was disabled/.test(gap.reason)))
  await run.dispose()
  await memory.begin(f.parent, 'after-held-initialize')
  assert.equal((await memory.search(f.parent, { query: 'INITIALIZING_DISABLED_SECRET' })).items.length, 0)
})

test('last lease disposal drains a bound run still initializing without an orphan', async t => {
  const f = await fixture(t), fork = await f.mount('decision', { evidenceEnabled: true })
  const service = f.ctx.get('ultraEvidenceSupport'), memory = service.memory
  const entered = Promise.withResolvers(), gate = Promise.withResolvers(), flush = memory.flush.bind(memory)
  let held = false
  memory.flush = async session => { if (!held) { held = true; entered.resolve(); await gate.promise } return flush(session) }
  const starting = memory.begin(f.parent, 'closing-initialize')
  await entered.promise
  const run = service.runFor(f.parent)
  const closing = fork.dispose()
  await new Promise(resolve => setImmediate(resolve))
  gate.resolve()
  assert.equal(await starting, undefined, 'shutdown cannot publish a newly initialized run')
  await closing
  assert.equal(run.active, false)
  assert.equal(f.ctx.get('ultraEvidenceSupport'), undefined)
  assert.equal(await memory.begin(f.parent, 'after-close'), undefined)
})

test('failed initialization rolls back its binding and drains its tracked lifecycle', async t => {
  const f = await fixture(t), fork = await f.mount('ultra', { evidenceEnabled: true })
  const service = f.ctx.get('ultraEvidenceSupport'), memory = service.memory
  const entered = Promise.withResolvers(), gate = Promise.withResolvers(), flush = memory.flush.bind(memory)
  memory.flush = async () => { entered.resolve(); await gate.promise }
  const starting = memory.begin(f.parent, 'failed-initialize')
  await entered.promise
  const run = service.runFor(f.parent)
  const disabled = await f.mount('memory', { evidenceEnabled: false })
  f.append('FAILED_INITIALIZE_DISABLED_SECRET')
  gate.reject(new Error('Fixture initial flush failure'))
  assert.equal(await starting, undefined)
  assert.equal(run.active, false)
  await disabled.dispose()
  assert.equal(service.runFor(f.parent), undefined)
  memory.flush = flush
  assert.ok(await memory.begin(f.parent, 'after-failed-initialize'))
  assert.equal((await memory.search(f.parent, { query: 'FAILED_INITIALIZE_DISABLED_SECRET' })).items.length, 0)
  await fork.dispose()
  assert.equal(f.ctx.get('ultraEvidenceSupport'), undefined)
})
