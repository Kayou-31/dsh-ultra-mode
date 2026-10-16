/** Real public rc.2 SDK composition. No provider, Loader/profile, UI, or network. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const names = ['cordis', 'dsh-scope', 'dsh-tools', 'dsh-system-prompt', 'dsh-session', 'dsh-llm']
let sdk, unavailable
try { sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(`@deepseek-ai/${name}`)]))) }
catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  unavailable = 'Public DSH SDK peers are unavailable; this SDK composition smoke is not a Loader or UI verification.'
}
const plugin = sdk && await import('../lib/index.js')
const memoryApi = sdk && await import('../lib/memory-host.js')
const runtime = sdk && await import('../lib/runtime.js')
const captureApi = sdk && await import('../lib/capture-memory.js')
const config = { toolName: 'ultra_task', concurrency: 3, sectionOrder: 117.5, maxSessions: 64,
  timeoutMs: 5000, reportChars: 2000, researchTools: ['read', 'ultra_memory_search', 'ultra_memory_get'],
  evidenceEnabled: true, contextCompression: false, jevEnabled: false }

async function fixture(t, enabled = true) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-memory-sdk-'))
  const ctx = new sdk.cordis.Context(), agents = new Map(), sessions = new Map(), durable = new Map(), scopes = [], cleanups = []
  let modelCalls = 0, writes = 0, callNumber = 0
  await ctx.plugin(sdk['dsh-session'].SessionStore).await()
  await ctx.plugin(sdk['dsh-system-prompt'].SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
  await ctx.plugin(sdk['dsh-tools'].ToolRuntime, { mode: 'both' }).await()
  ctx.on('session/flush', session => durable.set(session.id, { header: structuredClone(session.header), events: structuredClone(session.snapshotEvents()) }))
  ctx.provide('sessionPersistence', { async open(id, access) {
    assert.equal(access, 'read')
    const stored = durable.get(id)
    if (!stored) throw new Error('Fixture durability checkpoint missing')
    return { header: stored.header, async read(from = 0, length = 128) { return { events: stored.events.slice(from, from + length) } }, async close() {} }
  } })
  const { createScope, scopeParentOf, scopeOf, bindScopeParent } = sdk['dsh-scope']
  const preset = createScope(ctx, {})
  scopes.push(preset)
  ctx.provide('agentPresets', { composeFrom(childCtx, parentCtx) { const inherited = scopeParentOf(scopeOf(parentCtx)); if (inherited) bindScopeParent(scopeOf(childCtx), inherited) } })
  const makeAgent = (id, header = {}) => {
    const session = ctx.get('sessions').create(sdk['dsh-session'].SessionId(id), { meta: { cwd, ...header } })
    const agent = { id, session, status: 'idle', options: { provider: 'offline-no-provider', model: 'no-model' },
      cancel() {}, followup() { modelCalls++; throw new Error('This composition smoke must not invoke a model') }, async whenIdle() {} }
    agents.set(id, agent); sessions.set(id, session)
    return agent
  }
  ctx.provide('agents', { get: id => agents.get(id), roots: () => [...agents.values()].filter(agent => !agent.session.header.parentSession),
    async create(options) {
      const agent = makeAgent(options.sessionId, options.meta)
      const scope = createScope(ctx, agent); scopes.push(scope); agent.ctx = scope.ctx
      await options.setup(scope.ctx, agent)
      await ctx.serial('agent/created', { agent })
      return { agent, async dispose() { await scope.dispose(); agents.delete(agent.id) } }
    } })
  const parent = makeAgent('memory-sdk-root')
  const parentScope = createScope(ctx, parent, { parent: sdk['dsh-scope'].scopeOf(preset.ctx) }); scopes.push(parentScope); parent.ctx = parentScope.ctx
  // Register actual defineTool schemas before mounting the real plugin.
  const full = 'prefix '.repeat(1200) + 'SDK_PROJECTED_TAIL_42'
  ctx.get('tools').register(sdk['dsh-tools'].defineTool({ name: 'read', description: 'Fixture read with a model projection', parameters: {},
    output: { schema: { type: 'object', properties: { text: { type: 'string', required: true } }, additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    async execute() { return { text: full } }, projectContent() { return [{ type: 'text', text: 'MODEL_PREVIEW_ONLY' }] } }))
  ctx.get('tools').register(sdk['dsh-tools'].defineContentToolFixture({ name: 'write', description: 'Must stay denied to researchers', parameters: {}, async execute() { writes++; return [{ type: 'text', text: 'changed' }] } }))
  const mounted = ctx.plugin(plugin, { ...config, evidenceEnabled: enabled }); await mounted.await()
  t.after(async () => {
    const failures = []
    for (const cleanup of [...cleanups.toReversed(), () => mounted.dispose(), ...scopes.toReversed().map(scope => () => scope.dispose()), () => ctx.fiber.dispose()]) {
      try { await cleanup() } catch (error) { failures.push(error) }
    }
    fs.rmSync(cwd, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, 'SDK fixture cleanup failed')
  })
  return { ctx, parent, agents, cwd, full, get modelCalls() { return modelCalls }, get writes() { return writes },
    cleanup: fn => cleanups.push(fn),
    async execute(agent, name, args = {}, callId) { return ctx.get('tools').execute({ agent, name, arguments: args, signal: new AbortController().signal, callId: callId ?? sdk['dsh-llm'].ToolCallId('memory-sdk-' + ++callNumber) }) },
    schemas: agent => ctx.get('tools').schemas(agent).map(tool => tool.name) }
}

test('actual SDK composition keeps memory tools visible and research execution constrained', { skip: unavailable }, async t => {
  const f = await fixture(t)
  assert.ok(f.schemas(f.parent).includes('ultra_memory_search'))
  assert.ok(f.schemas(f.parent).includes('ultra_memory_get'))
  const memory = await memoryApi.beginMemoryRun(f.parent, 'sdk-composition-run')
  if (!memory) {
    const diagnostic = new memoryApi.UltraMemoryHost(f.ctx, config)
    const attempt = await diagnostic.begin(f.parent, 'sdk-diagnostic')
    t.diagnostic(JSON.stringify(diagnostic.status(f.parent.id)))
    await attempt?.dispose()
  }
  assert.ok(memory, 'host evidence begins against the explicit read-only persistence fixture')
  const worker = await runtime.createRoute(f.parent, { id: 'ultra-route-sdk-worker', label: 'Worker', readOnly: true,
    researchTools: config.researchTools, signal: new AbortController().signal, memory }, config)
  const decision = await runtime.createRoute(f.parent, { id: 'ultra-route-sdk-decision', label: 'Decision', readOnly: true,
    researchTools: config.researchTools, signal: new AbortController().signal, memory }, config)
  f.cleanup(async () => { await worker.dispose(); await decision.dispose(); await memory.dispose() })
  const w = f.agents.get(worker.id), d = f.agents.get(decision.id)
  for (const agent of [w, d]) {
    assert.ok(f.schemas(agent).includes('ultra_memory_search'))
    assert.ok(f.schemas(agent).includes('ultra_memory_get'))
    assert.equal(f.schemas(agent).includes('write'), false)
    assert.equal(f.schemas(agent).includes('run_code'), false)
  }
  assert.equal((await f.execute(w, 'write')).isError, true)
  assert.equal((await f.execute(w, 'run_code', { code: 'return 1' })).isError, true)
  assert.equal(f.writes, 0)
  const capture = captureApi.installPreTruncationCapture(f.ctx, memory.host)
  f.cleanup(() => capture.dispose())
  const callId = sdk['dsh-llm'].ToolCallId('sdk-read-projected')
  w.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: sdk['dsh-llm'].createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{}' }], source: { provider: 'offline-no-provider', model: 'no-model' } }) }, { surfaceOp: 'append' })
  const projected = await f.execute(w, 'read', {}, callId)
  assert.equal(projected.isError, false)
  assert.equal(projected.content[0].text, 'MODEL_PREVIEW_ONLY')
  assert.equal(projected.content.some(block => block.type === 'text' && block.text.includes('SDK_PROJECTED_TAIL_42')), false)
  w.session.append('tool/result', { turn: 1, step: 1, message: sdk['dsh-llm'].createToolResultMessage({ callId, content: projected.content, isError: false }) }, { surfaceOp: 'append' })
  await memory.checkpoint()
  const search = await f.execute(d, 'ultra_memory_search', { query: 'SDK_PROJECTED_TAIL_42' })
  assert.equal(search.isError, false)
  const found = JSON.parse(search.content[0].text)
  assert.ok(found.items.length, 'actual SDK memory search finds text omitted by model projection')
  const fetched = await f.execute(d, 'ultra_memory_get', { id: found.items[0].sourceId, offset: f.full.length - 64, maxChars: 256 })
  assert.equal(fetched.isError, false)
  const original = JSON.parse(fetched.content[0].text)
  assert.ok(original.text.includes('SDK_PROJECTED_TAIL_42'))
  assert.equal(original.status, 'captured', 'different retained host preview cannot claim original host coverage')
  assert.ok(capture.status().capturedResults >= 1)
  assert.equal(f.modelCalls, 0)
})

test('disabled evidence adds no SDK memory schemas, store, or model calls', { skip: unavailable }, async t => {
  const f = await fixture(t, false)
  assert.equal(f.schemas(f.parent).some(name => name.startsWith('ultra_memory_')), false)
  assert.equal(await memoryApi.beginMemoryRun(f.parent, 'disabled'), undefined)
  assert.equal(fs.existsSync(path.join(f.cwd, '.dsh-ultra')), false)
  assert.equal(f.modelCalls, 0)
})
