/** Source-level host contract checks; no installed DSH host or model is driven. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as modelPool from '../lib/model-pool.js'

function sourceModule(file, imports) {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, { exports, require: name => {
    if (!(name in imports)) throw new Error(`Unmocked host import ${name}`)
    return imports[name]
  }, AbortSignal, AbortController, Error, AggregateError, Map, Set, WeakMap, Promise, setTimeout, clearTimeout })
  return exports
}
const manager = sourceModule('../src/collaboration.ts', { 'node:crypto': { randomUUID } })

/** Mirrors native create -> preset/filter -> serial created -> initial turn order. */
function fixture({ maxDepth = 2, providerMissing = false, serviceMissing = false, conflict, childConflict, onSpawn, failDrain, modern = false } = {}) {
  const agents = new Map(), handlers = new Map(), prompts = new Map()
  const record = { starts: [], deliveries: [], contexts: [], interrupts: [], drains: [], firstTurns: [], released: [], removedMessages: [], audit: [] }
  const native = new Map(['read', 'write', 'subagent', 'send_message', 'interrupt_agent', 'list_agents', 'run_code'].map(name =>
    [name, { name, description: `Original native ${name}`, execute: async () => name }]))
  const globalTools = new Map([['glob', { name: 'glob' }]])
  const on = (name, callback) => {
    const listeners = handlers.get(name) ?? new Set()
    handlers.set(name, listeners); listeners.add(callback)
    return () => { listeners.delete(callback); record.released.push(`observer:${name}`) }
  }
  const emit = async (name, ...args) => {
    for (const callback of [...(handlers.get(name) ?? [])]) await callback(...args)
  }
  const registry = { get: id => agents.get(id) }
  const root = { on }
  let nextMessage = 0, host
  const scope = { inherited: native }
  const llm = {
    listProviders: () => [{ id: 'parent-provider' }, { id: 'other-provider' }],
    async listModels(provider) { return [{ provider, id: 'specialist', name: 'Same name' }] },
    async resolveModelInfo(provider, id) { return { provider, id, inputModalities: ['text'], reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } } },
    async resolveCallConfig(c) { return { ...c, reasoningEffort: c.reasoningEffort ?? 'low' } },
  }
  function makeAgent(id, parent, inheritedAllow, agentOptions) {
    const own = new Map(), effects = []
    const inherited = new Map([...globalTools, ...native].filter(([name]) => !inheritedAllow || inheritedAllow.includes(name)))
    const inheritedOptions = { ...(parent?.options ?? {
      provider: 'parent-provider', model: 'normal-model', reasoningEffort: 'medium', maxTokens: 321,
    }) }
    if (agentOptions && (agentOptions.provider !== inheritedOptions.provider || agentOptions.model !== inheritedOptions.model)) { delete inheritedOptions.reasoningEffort; delete inheritedOptions.maxTokens }
    const options = Object.freeze({ ...inheritedOptions, ...agentOptions })
    const session = {
      id, header: { id, cwd: 'E:/offline-fixture', ...(parent ? { parentSession: parent.id, origin: 'subagent', delegationDepth: (parent.session.header.delegationDepth ?? 0) + 1 } : {}) },
      events: [], snapshotEvents() { return [...this.events] }, requestHeader() { return { config: options } },
      append(type, data) { this.events.push({ type, data }); return this.events.at(-1) },
    }
    const agent = {
      id, options, session, status: 'idle', scope,
      inbox: { nextTurn: [], nextStep: [], remove(messageId) {
        record.removedMessages.push(messageId)
        for (const queue of [this.nextStep, this.nextTurn]) {
          const index = queue.findIndex(item => item.id === messageId)
          if (index >= 0) { queue.splice(index, 1); return true }
        }
        return false
      } }, own, effects, inherited,
      inject(message) { record.contexts.push({ agent: this, message }); this.inbox.nextStep.push(message) },
    }
    const tools = {
      get(name) { return own.get(name) ?? inherited.get(name) },
      schemas(view) {
        const values = view === undefined ? globalTools : view === scope ? native : new Map([...inherited, ...own])
        return [...values.keys()].map(name => ({ name }))
      },
      restrict({ allow }) {
        const saved = new Map(inherited)
        for (const name of inherited.keys()) if (!allow.includes(name)) inherited.delete(name)
        const release = () => { inherited.clear(); for (const [name, tool] of saved) inherited.set(name, tool) }
        effects.push(release); return release
      },
      register(definition) {
        if (own.has(definition.name)) throw new Error(`Duplicate scoped tool ${definition.name}`)
        own.set(definition.name, definition)
        let active = true
        const release = () => {
          if (!active) return
          active = false; own.delete(definition.name); record.released.push(`tool:${id}:${definition.name}`)
        }
        effects.push(release)
        return release
      },
    }
    const systemPrompt = { section(value) {
      const key = `${id}:${value.name}`
      if (prompts.has(key)) throw new Error('Duplicate prompt section')
      prompts.set(key, value)
      const release = () => prompts.delete(key)
      effects.push(release)
      return release
    } }
    agent.ctx = { root, agents: registry, get: name => name === 'llm' ? llm : name === 'tools' ? tools : name === 'systemPrompt' ? systemPrompt : name === 'subagents' ? (serviceMissing ? undefined : service) : undefined }
    agents.set(id, agent)
    return agent
  }
  async function remove(agent) {
    for (const child of [...agents.values()]) if (child.session.header.parentSession === agent.id) await remove(child)
    for (const dispose of agent.effects) dispose()
    agents.delete(agent.id)
  }
  const service = {
    resolveMaxDepth: () => maxDepth,
    getProvider: name => name === 'spawn' && !providerMissing ? { prepareContinuable() {} } : undefined,
    async startContinuable(spec) {
      record.starts.push(spec)
      spec.signal.throwIfAborted()
      assert.equal(agents.get(spec.request.parent.id), spec.request.parent)
      if ((spec.request.parent.session.header.delegationDepth ?? 0) + 1 > spec.request.maxDepth) throw new Error('Native subagent depth exceeded')
      // Native restrictions are validated before publication. Caller-only
      // aliases are not available on a child until its created listener mounts.
      for (const name of spec.request.toolFilter.allow) {
        if (!modern && (name === 'run_code' || !(native.has(name) || globalTools.has(name)))) throw new Error(`Native unknown inherited tool ${name}`)
      }
      const child = makeAgent(spec.childId, spec.request.parent, spec.request.toolFilter.allow, spec.request.agentOptions)
      if (childConflict) child.own.set('ultra_wait_agent', { name: 'ultra_wait_agent', marker: 'unrelated extension' })
      try {
        await emit('agent/created', { agent: child, source: 'fresh', signal: spec.signal })
        record.firstTurns.push({ child, names: Array.from(child.own.keys()), inherited: Array.from(child.inherited.keys()) })
        await onSpawn?.({ child, spec, emit, event, record })
        return { childId: child.id, messageId: `native-start-${record.starts.length}` }
      } catch (error) { await remove(child); throw error }
    },
    async sendMessage(sender, targetId, content, { signal }) {
      signal.throwIfAborted()
      assert.equal(agents.get(sender.id), sender)
      const target = agents.get(targetId)
      if (!target || target.session.header.parentSession !== sender.id && sender.session.header.parentSession !== targetId) throw new Error('Native adjacency refused')
      record.deliveries.push({ sender, targetId, content, signal })
      target.status = 'running'
      return `native-followup-${record.deliveries.length}`
    },
    interrupt(targetId, authority) {
      assert.equal(agents.get(authority.agent.id), authority.agent)
      record.interrupts.push({ targetId, authority })
    },
    async drainContinuableChildren(parent, ids) {
      assert.equal(agents.get(parent.id), parent, 'drain uses the exact live native owner')
      record.drains.push({ parent, ids: Array.from(ids) })
      if (failDrain) throw failDrain
      for (const id of ids) {
        const child = agents.get(id)
        if (child) { assert.equal(child.session.header.parentSession, parent.id); await remove(child) }
      }
    },
  }
  if (modern) {
    const start = service.startContinuable.bind(service)
    service.startActivation = async spec => {
      assert.equal(spec.delivery, 'caller')
      assert.equal(Object.hasOwn(spec.request, 'toolFilter'), false, 'new public API does not accept toolFilter')
      const receipt = await start({ ...spec, request: { ...spec.request, toolFilter: { allow: [...native.keys(), ...globalTools.keys()] } } })
      return { ...receipt, result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} }
    }
    service.drainChildren = service.drainContinuableChildren
    delete service.startContinuable
    delete service.drainContinuableChildren
  }
  const exports = sourceModule('../src/collaboration-host.ts', {
    'node:crypto': { randomUUID },
    '@deepseek-ai/dsh-llm': { createUserMessage: value => ({ id: `relay-${++nextMessage}`, ...value }) },
    '@deepseek-ai/dsh-session': { SessionId: value => value },
    '@deepseek-ai/dsh-scope': { scopeParentOf: agent => agent.scope },
    '@deepseek-ai/dsh-tools': {
      defineTool: value => value,
      parameterSchemaSpecToJsonSchema: value => ({ type: 'object', properties: value }),
    },
    './collaboration.js': manager,
    './model-pool.js': modelPool,
    './model-pool-audit.js': { createCollaborationAudit: () => ({ write(value) { record.audit.push(JSON.parse(JSON.stringify(value))) } }) },
  })
  const parent = makeAgent('normal-parent')
  parent.own.set('parent_only_tool', { name: 'parent_only_tool' })
  if (conflict) parent.own.set(conflict, { name: conflict, marker: 'original competing extension' })
  async function event(agent, type, data) {
    const value = { type, data }
    agent.session.events.push(value)
    await emit('session/event', agent.session, value)
  }
  return {
    parent, agents, record, native, handlers, prompts, service, exports, emit, event, remove, makeAgent,
    install(config = {}) { host = exports.installCollaboration(parent, { collaborationEnabled: true, ...config }); return host },
    async call(agent, name, args = {}, signal = new AbortController().signal) {
      const definition = agent.ctx.get('tools').get(name, agent)
      assert.ok(definition, `${name} exists in its Agent scope`)
      return definition.execute(args, { agent, signal })
    },
    async close() { await host?.close() },
    observerCount: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  }
}

const candidate = (id, provider = 'parent-provider', extra = {}) => ({ id, provider, model: 'specialist', name: id, enabled: true, strengths: 'Review', suitableFor: 'Audit', avoidFor: '', isDefault: false, maxConcurrent: 1, allowUnverifiedTools: true, allowCrossProvider: false, ...extra })
const poolConfig = models => ({ models, fallback: 'error', maxConcurrent: 2, maxRequests: 5, failureLimit: 2 })
test('configured ordinary collaboration sends selected native agentOptions and preserves parent and tool boundary', async () => {
  const f = fixture()
  const original = f.parent.options
  const config = poolConfig([candidate('review', 'other-provider', { allowCrossProvider: true, reasoningEffort: 'high', maxTokens: 650 })])
  f.install({ collaborationModelPool: config })
  try {
    const result = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'review', message: 'Review edge cases', model_config_id: 'review', model_reason: 'This candidate specializes in audit' })
    assert.ok(f.record.starts[0].request.agentOptions, 'selected route must enter native startContinuable request')
    assert.deepEqual(JSON.parse(JSON.stringify(f.record.starts[0].request.agentOptions)), { provider: 'other-provider', model: 'specialist', reasoningEffort: 'high', maxTokens: 650 })
    assert.equal(f.agents.get(result.id).options.provider, 'other-provider')
    assert.equal(f.parent.options, original)
    assert.equal(result.model.selectedConfigId, 'review')
    assert.equal(result.model.provider, 'other-provider')
    assert.ok(!f.record.starts[0].request.toolFilter.allow.includes('run_code'))
    assert.ok(!f.record.starts[0].request.toolFilter.allow.includes('parent_only_tool'))
  } finally { await f.close() }
})
test('volatile config changes affect only later new children and live children keep their snapshot', async () => {
  const f = fixture()
  let current = poolConfig([candidate('default', 'parent-provider', { isDefault: true })])
  f.install({ collaborationModelPool: { get: () => current } })
  try {
    const one = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'one', message: 'First' })
    await f.event(f.agents.get(one.id), 'turn/end', { reason: { kind: 'completed' } })
    current = poolConfig([candidate('default', 'other-provider', { isDefault: true, allowCrossProvider: true })])
    const two = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'two', message: 'Second' })
    assert.equal(f.agents.get(one.id).options.provider, 'parent-provider')
    assert.equal(f.agents.get(two.id).options.provider, 'other-provider')
    assert.equal(f.parent.own.get('ultra_spawn_agent') !== undefined, true)
    await f.event(f.agents.get(two.id), 'turn/end', { reason: { kind: 'completed' } })
    await f.call(f.parent, 'ultra_followup_task', { target: one.id, message: 'Continue first' })
    assert.equal(f.agents.get(one.id).options.provider, 'parent-provider')
    assert.equal(f.record.starts.length, 2)
  } finally { await f.close() }
})

const consume = async iterable => { const chunks = []; for await (const c of iterable) chunks.push(c); return chunks }
test('failed native drain keeps orphan guard and shared model reservation until exact disposal', async () => {
  const f = fixture({ failDrain: Error('native drain failed') })
  const config = poolConfig([candidate('review', 'parent-provider', { isDefault: true })])
  const shared = new modelPool.ModelPool(() => config, f.parent.ctx.get('llm'))
  const host = f.exports.installCollaboration(f.parent, { collaborationModelPool: config }, { pool: shared })
  const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'orphan', message: 'Read only' })
  await assert.rejects(() => host.close(), /收尾/)
  const selected = await shared.select({}, { parentProvider: 'parent-provider', requiredInputs: ['text'], requiresTools: true, scopeId: 'other', signal: new AbortController().signal })
  assert.throws(() => shared.reserve('other', selected), /并发/)
  const guard = [...f.handlers.get('llm/stream')][0]
  let upstream = 0
  await assert.rejects(() => consume(guard({ sessionId: child.id, provider: 'other-provider', model: 'forged' }, async function* () { upstream++; yield { type: 'finish', reason: { kind: 'stop' } } })), /收尾|closed|路由/i)
  assert.equal(upstream, 0)
  await f.emit('agent/disposed', { agent: f.agents.get(child.id) })
  shared.reserve('other', selected)
  assert.equal(f.observerCount(), 0)
})
test('aborted request with synthetic zero usage remains unknown and terminal state is durably recorded', async () => {
  const f = fixture(); const host = f.install({ collaborationModelPool: poolConfig([candidate('review', 'parent-provider', { isDefault: true })]) })
  try {
    const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'abort', message: 'Try' })
    const guard = [...f.handlers.get('llm/stream')][0]
    await consume(guard({ sessionId: child.id, provider: 'parent-provider', model: 'specialist', reasoningEffort: 'low' }, async function* () { yield { type: 'usage', usage: { totalTokens: 0 } }; yield { type: 'finish', reason: { kind: 'aborted' } } }))
    await f.event(f.agents.get(child.id), 'turn/end', { reason: { kind: 'aborted' } })
    const saved = f.record.audit.at(-1).record
    assert.equal(saved.status, 'cancelled'); assert.equal(saved.usage.unknownCalls, 1)
    assert.equal(saved.model.requestStatus, 'observed')
    assert.equal(host.records()[0].status, 'cancelled')
  } finally { await f.close() }
})
test('native continuation reacquires the original model slot without changing the route', async () => {
  const f = fixture(); const host = f.install({ collaborationModelPool: poolConfig([candidate('review', 'parent-provider', { isDefault: true })]) })
  try {
    const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'native-followup', message: 'Try' })
    const agent = f.agents.get(child.id)
    await f.event(agent, 'turn/end', { reason: { kind: 'completed' } })
    await f.event(agent, 'turn/start', { turn: 2 })
    const guard = [...f.handlers.get('llm/stream')][0]
    await consume(guard({ sessionId: child.id, provider: 'parent-provider', model: 'specialist', reasoningEffort: 'low' }, async function* () { yield { type: 'finish', reason: { kind: 'stop' } } }))
    assert.equal(host.records()[0].usage.requests, 1)
  } finally { await f.close() }
})
test('native descendants of a pooled child cannot bypass the pool concurrency boundary', async () => {
  const f = fixture(); f.install({ collaborationModelPool: poolConfig([candidate('review', 'parent-provider', { isDefault: true })]) })
  try {
    const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'owner', message: 'Inspect' })
    const grandchild = f.makeAgent('native-grandchild', f.agents.get(child.id))
    await assert.rejects(() => f.emit('agent/created', { agent: grandchild }), /并发/)
    await f.remove(grandchild)
  } finally { await f.close() }
})
test('failed native admission is recorded as failure and an unquiesced orphan keeps its quota', async () => {
  const f = fixture({ failDrain: Error('native drain failed') })
  const config = poolConfig([candidate('review', 'parent-provider', { isDefault: true })])
  const shared = new modelPool.ModelPool(() => config, f.parent.ctx.get('llm'))
  const host = f.exports.installCollaboration(f.parent, { collaborationModelPool: config }, { pool: shared })
  const original = f.service.startContinuable.bind(f.service)
  f.service.startContinuable = async spec => { await original(spec); throw Error('admission transport failed after creation') }
  await assert.rejects(() => f.call(f.parent, 'ultra_spawn_agent', { task_name: 'failed-create', message: 'Try' }), /admission|cleanup|清理/)
  assert.equal(host.records()[0].status, 'failed')
  assert.equal(f.record.audit.at(-1).record.status, 'failed')
  const selected = await shared.select({}, { parentProvider: 'parent-provider', requiredInputs: ['text'], requiresTools: true, scopeId: 'other', signal: new AbortController().signal })
  assert.throws(() => shared.reserve('replacement', selected), /并发/)
  await host.close().catch(() => {})
  for (const a of [...f.agents.values()]) if (a !== f.parent) await f.emit('agent/disposed', { agent: a })
})
test('failed cold followup preserves its error and releases a newly reserved slot', async () => {
  const f = fixture(); const host = f.install({ collaborationModelPool: poolConfig([candidate('review', 'parent-provider', { isDefault: true })]) })
  try {
    const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'one', message: 'Try' })
    await f.event(f.agents.get(child.id), 'turn/end', { reason: { kind: 'completed' } })
    f.agents.delete(child.id)
    f.service.sendMessage = async () => { throw Error('cold resume unavailable') }
    await assert.rejects(() => f.call(f.parent, 'ultra_followup_task', { target: child.id, message: 'Continue' }), /cold resume unavailable/)
    const replacement = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'replacement', message: 'Different task' })
    assert.equal(replacement.model.selectedConfigId, 'review')
  } finally { await f.close() }
})
test('closing an active child preserves the real cancellation terminal record after team admission closes', async () => {
  const f = fixture(); const host = f.install({ collaborationModelPool: poolConfig([candidate('review', 'parent-provider', { isDefault: true })]) })
  const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'closing', message: 'Active task' })
  const drain = f.service.drainContinuableChildren.bind(f.service)
  f.service.drainContinuableChildren = async (parent, ids) => {
    for (const id of ids) if (f.agents.has(id)) await f.event(f.agents.get(id), 'turn/end', { reason: { kind: 'aborted' } })
    return drain(parent, ids)
  }
  await host.close()
  assert.equal(host.records().find(r => r.id === child.id).status, 'cancelled')
  assert.equal(f.record.audit.at(-1).record.status, 'cancelled')
})
test('request admission is durably recorded before the adapter can run or the process can crash', async () => {
  const f = fixture(); f.install({ collaborationModelPool: poolConfig([candidate('review', 'parent-provider', { isDefault: true })]) })
  let release, enter
  const gate = new Promise(done => { release = done }), entered = new Promise(done => { enter = done })
  let pending
  try {
    const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'durable-request', message: 'Try' })
    const guard = [...f.handlers.get('llm/stream')][0]
    pending = consume(guard({ sessionId: child.id, provider: 'parent-provider', model: 'specialist', reasoningEffort: 'low' }, async function* () { enter(); await gate; yield { type: 'finish', reason: { kind: 'stop' } } }))
    await entered
    const saved = f.record.audit.at(-1).record
    assert.equal(saved.model.requestStatus, 'observed')
    assert.equal(saved.usage.requests, 1)
    assert.equal(saved.usage.inFlightRequests, 1)
  } finally { release(); await pending; await f.close() }
})
test('native creation disposed before a turn end cannot leave a durable starting ghost', async () => {
  const f = fixture(); const host = f.install({ collaborationModelPool: poolConfig([candidate('review', 'parent-provider', { isDefault: true, maxConcurrent: 2 })]) })
  try {
    const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'parent', message: 'Inspect' })
    const grandchild = f.makeAgent('early-disposed', f.agents.get(child.id))
    await f.emit('agent/created', { agent: grandchild })
    await f.emit('agent/disposed', { agent: grandchild })
    await f.remove(grandchild)
    const saved = f.record.audit.filter(r => r.record.id === grandchild.id).at(-1).record
    assert.equal(saved.status, 'cancelled')
    assert.match(saved.error, /结果未知|终态/)
    assert.equal(host.records().find(r => r.id === grandchild.id).status, 'cancelled')
  } finally { await f.close() }
})

test('standalone collaboration inherits native identity, route and host depth with a pre-publication-safe allowlist', async () => {
  const f = fixture({ maxDepth: 2 })
  f.parent.inherited.delete('write') // A parent-visible policy masks this inherited tool.
  const original = f.parent.options
  const originalNative = f.parent.ctx.get('tools').get('subagent')
  f.install()
  try {
    assert.equal(f.parent.options, original, 'install does not replace or mutate normal Agent options')
    const created = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'independent review', message: 'Inspect the specification' })
    const spec = f.record.starts[0]
    assert.match(spec.childId, /^ultra-child-/)
    assert.equal(created.id, spec.childId)
    assert.equal(spec.request.parent, f.parent)
    assert.equal(spec.provider, 'spawn')
    assert.equal(spec.request.maxDepth, 2)
    assert.equal(Object.hasOwn(spec.request, 'agentOptions'), false, 'adapter forces no model, effort, or max-token override')
    const allow = Array.from(spec.request.toolFilter.allow)
    assert.ok(allow.includes('read') && allow.includes('subagent') && allow.includes('glob'))
    assert.equal(allow.includes('run_code'), false)
    assert.equal(allow.includes('parent_only_tool'), false)
    assert.equal(allow.includes('write'), false, 'a hidden inherited tool is not restored for the child')
    assert.equal(allow.some(name => name.startsWith('ultra_')), false)
    const child = f.agents.get(created.id)
    assert.deepEqual(child.options, original)
    assert.equal(child.ctx.get('tools').get('write'), undefined)
    assert.equal(f.record.firstTurns[0].names.filter(name => name.startsWith('ultra_')).length, 6, 'child receives tools before its first turn')
    assert.equal(f.parent.ctx.get('tools').get('subagent'), originalNative, 'native tool is never replaced')
  } finally { await f.close() }
  assert.equal(f.parent.ctx.get('tools').get('subagent'), originalNative)
  assert.equal(f.observerCount(), 0)
})

test('a mounted child can delegate with its own exact identity while preserving the host depth cap', async () => {
  const f = fixture({ maxDepth: 2 })
  const host = f.install()
  try {
    const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'first level', message: 'Inspect' })
    const childAgent = f.agents.get(child.id)
    const grandchild = await f.call(childAgent, 'ultra_spawn_agent', { task_name: 'second level', message: 'Independent check' })
    assert.equal(f.record.starts[1].request.parent, childAgent)
    assert.equal(f.record.starts[1].request.maxDepth, 2)
    assert.equal(f.agents.get(grandchild.id).session.header.delegationDepth, 2)
    await assert.rejects(f.call(f.agents.get(grandchild.id), 'ultra_spawn_agent', { task_name: 'forbidden level', message: 'Inspect' }), /depth/)
    assert.equal(host.team.listAgents(f.parent.id).length, 2, 'rejected deeper delegation releases its reservation')
  } finally { await f.close() }
  assert.equal(f.record.drains[0].parent, f.parent)
  assert.equal(f.agents.has(f.record.starts[0].childId), false)
  assert.equal(f.agents.has(f.record.starts[1].childId), false)
})

test('spawn keeps a real terminal event emitted before native admission returns', async () => {
  const f = fixture({ onSpawn: async ({ child, event }) => {
    await event(child, 'turn/start', { turn: 1 })
    await event(child, 'assistant/message', { message: { content: [{ type: 'text', text: 'Checked early result' }] } })
    await event(child, 'turn/end', { reason: { kind: 'completed' } })
  } })
  f.install()
  try {
    const created = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'early child', message: 'Complete immediately' })
    assert.equal(created.status, 'completed')
    assert.equal(created.text, 'Checked early result')
    const waited = await f.call(f.parent, 'ultra_wait_agent', { targets: [created.id], timeout_ms: 0 })
    assert.equal(waited.timedOut, false)
    assert.equal(waited.agents[0].text, 'Checked early result')
  } finally { await f.close() }
})

test('information stays asleep until target pre-step then injects with exact sender relay provenance', async () => {
  const f = fixture()
  f.install()
  try {
    const created = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'message child', message: 'Investigate' })
    const child = f.agents.get(created.id)
    child.status = 'idle'
    const queued = await f.call(f.parent, 'ultra_send_message', { target: child.id, message: 'Review this observation' })
    assert.equal(queued.wakeup, false)
    assert.equal(child.status, 'idle')
    assert.equal(f.record.deliveries.length, 0)
    assert.equal(f.record.contexts.length, 0)
    let reachedNext = false
    await f.emit('agent/pre-step', { agent: child, messages: [], signal: new AbortController().signal }, async () => {
      reachedNext = true
      assert.equal(f.record.contexts.length, 1)
      return { kind: 'enter', messages: [] }
    })
    assert.equal(reachedNext, true)
    const relay = f.record.contexts[0]
    assert.equal(relay.agent, child)
    assert.equal(relay.message.source.kind, 'ultra-collaboration')
    assert.equal(relay.message.source.senderSessionId, f.parent.id)
    assert.ok(relay.message.source.runId)
    assert.match(relay.message.content[0].text, /Review this observation/)
    assert.equal(child.status, 'idle', 'inject itself does not wake the Agent')
    await f.emit('agent/pre-step', { agent: child, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
    assert.equal(f.record.contexts.length, 1, 'one queued message is injected once')
  } finally { await f.close() }
})

test('explicit followup uses native adjacent delivery and preserves queued context', async () => {
  const f = fixture()
  f.install()
  try {
    const created = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'followup child', message: 'Investigate' })
    const child = f.agents.get(created.id)
    child.status = 'idle'
    await f.call(f.parent, 'ultra_send_message', { target: child.id, message: 'Queued observation' })
    await f.call(f.parent, 'ultra_followup_task', { target: child.id, message: 'Check the revised specification' })
    assert.equal(f.record.deliveries.length, 1)
    const delivered = f.record.deliveries[0]
    assert.equal(delivered.sender, f.parent)
    assert.equal(delivered.targetId, child.id)
    assert.match(delivered.content[0].text, /Queued observation/)
    assert.match(delivered.content[0].text, /Check the revised specification/)
    assert.equal(child.status, 'running')
    assert.equal(f.record.contexts.length, 0, 'combined followup does not also inject its mailbox')
    await f.call(f.parent, 'ultra_interrupt_agent', { target: child.id })
    assert.equal(f.record.interrupts[0].authority.agent, f.parent)
    assert.equal(f.record.interrupts[0].authority.kind, 'ancestor')
    assert.equal(f.agents.has(child.id), true, 'interrupt does not dispose the child')
  } finally { await f.close() }
})

test('close removes only this run pending injected relays from the normal parent and preserves admitted history', async () => {
  const f = fixture()
  f.install()
  const created = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'parent relay child', message: 'Inspect' })
  const child = f.agents.get(created.id)
  const human = { id: 'human-next-task', source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep my next task' }] }
  const foreign = { id: 'foreign-relay', source: { kind: 'ultra-collaboration', form: 'relay', runId: 'another-team' }, content: [] }
  f.parent.inbox.nextStep.push(human, foreign)
  await f.call(child, 'ultra_send_message', { target: f.parent.id, message: 'Already admitted relay' })
  await f.emit('agent/pre-step', { agent: f.parent, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  const admitted = f.record.contexts[0].message
  f.parent.inbox.nextStep.splice(f.parent.inbox.nextStep.indexOf(admitted), 1)
  await f.event(f.parent, 'user/message', admitted)
  await f.call(child, 'ultra_send_message', { target: f.parent.id, message: 'Late unclaimed relay' })
  await f.emit('agent/pre-step', { agent: f.parent, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  const unclaimed = f.record.contexts[1].message
  assert.ok(f.parent.inbox.nextStep.includes(unclaimed))
  await f.close()
  assert.deepEqual(f.parent.inbox.nextStep.map(message => message.id), [human.id, foreign.id])
  assert.ok(f.record.removedMessages.includes(unclaimed.id))
  assert.equal(f.record.removedMessages.includes(human.id), false)
  assert.equal(f.record.removedMessages.includes(foreign.id), false)
  assert.equal(f.record.removedMessages.includes(admitted.id), false, 'durable admission clears pending identity tracking')
  assert.ok(f.parent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data === admitted))
})

test('closing drains only collaboration-owned native child ids and releases tool scopes', async () => {
  const f = fixture()
  const host = f.install()
  const child = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'owned child', message: 'Inspect' })
  const unrelated = { id: 'ordinary-native-child', session: { header: { parentSession: f.parent.id } } }
  f.agents.set(unrelated.id, unrelated)
  await host.close()
  assert.equal(f.record.drains.length, 1)
  assert.equal(f.record.drains[0].parent, f.parent)
  assert.deepEqual(f.record.drains[0].ids, [child.id])
  assert.equal(f.agents.get(unrelated.id), unrelated)
  assert.equal(f.observerCount(), 0)
  assert.equal(f.prompts.size, 0)
  for (const name of f.exports.COLLABORATION_TOOLS) assert.equal(f.parent.ctx.get('tools').get(name), undefined)
  await host.close()
  assert.equal(f.record.drains.length, 1)
})

test('unavailable optional services and provider capabilities fail before changing ordinary tools', () => {
  for (const options of [{ serviceMissing: true }, { providerMissing: true }]) {
    const f = fixture(options)
    const original = f.parent.ctx.get('tools').get('subagent')
    assert.throws(() => f.install(), /continuable/)
    assert.equal(f.parent.ctx.get('tools').get('subagent'), original)
    assert.equal(f.parent.own.size, 1)
    assert.equal(f.observerCount(), 0)
    assert.equal(f.prompts.size, 0)
  }
})

test('reserved tool conflict rolls back partial mount without shadowing the competing definition', () => {
  const f = fixture({ conflict: 'ultra_wait_agent' })
  const competitor = f.parent.ctx.get('tools').get('ultra_wait_agent')
  const original = f.parent.ctx.get('tools').get('subagent')
  assert.throws(() => f.install(), /名称冲突/)
  assert.equal(f.parent.ctx.get('tools').get('ultra_wait_agent'), competitor)
  assert.equal(f.parent.ctx.get('tools').get('subagent'), original)
  assert.deepEqual([...f.parent.own.keys()].sort(), ['parent_only_tool', 'ultra_wait_agent'])
  assert.equal(f.observerCount(), 0)
  assert.equal(f.prompts.size, 0)
})

test('child mount conflict rejects native creation and releases the team reservation', async () => {
  const f = fixture({ childConflict: true })
  const host = f.install()
  try {
    await assert.rejects(f.call(f.parent, 'ultra_spawn_agent', { task_name: 'conflicting child', message: 'Inspect' }), /名称冲突/)
    assert.equal(host.team.listAgents(f.parent.id).length, 0)
    assert.equal([...f.agents.keys()].some(id => id.startsWith('ultra-child-')), false)
    assert.equal(f.parent.ctx.get('tools').get('subagent'), f.native.get('subagent'))
  } finally { await f.close() }
})

test('host depth zero remains forbidden and unavailable depth never becomes unlimited', async () => {
  for (const maxDepth of [0, undefined, NaN]) {
    // Explicit undefined is a real provider-managed/unavailable host response.
    const f = fixture({ maxDepth })
    if (maxDepth === undefined) f.service.resolveMaxDepth = () => undefined
    const host = f.install()
    try {
      await assert.rejects(f.call(f.parent, 'ultra_spawn_agent', { task_name: 'depth limited', message: 'Inspect' }), /depth|深度/)
      assert.equal(host.team.listAgents(f.parent.id).length, 0)
      assert.equal(f.parent.options.reasoningEffort, 'medium')
    } finally { await f.close() }
  }
})

test('a copied or neighboring Agent identity cannot invoke another Agent scoped collaboration tool', async () => {
  const f = fixture()
  f.install()
  try {
    const definition = f.parent.ctx.get('tools').get('ultra_spawn_agent')
    await assert.rejects(definition.execute({ task_name: 'forged caller', message: 'Inspect' }, {
      agent: { ...f.parent }, signal: new AbortController().signal,
    }), /所属 Agent/)
    assert.equal(f.record.starts.length, 0)
  } finally { await f.close() }
})


test('new activation service preserves exact child tool restrictions before its first turn and uses native drain', async () => {
  const f = fixture({ modern: true })
  f.install()
  const result = await f.call(f.parent, 'ultra_spawn_agent', { task_name: 'new-host', message: 'Offline new activation fixture' })
  const child = f.agents.get(result.id)
  assert.ok(child)
  assert.equal(child.inherited.has('run_code'), false)
  assert.ok(!f.record.firstTurns[0].inherited.includes('run_code'), 'restriction must precede initial execution')
  assert.equal(child.inherited.has('ultra_spawn_agent'), false)
  assert.equal(child.inherited.has('read'), true)
  await f.close()
  assert.equal(f.agents.has(result.id), false)
  assert.equal(f.record.drains.length, 1)
})
