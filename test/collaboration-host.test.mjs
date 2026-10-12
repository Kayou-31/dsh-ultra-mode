/** Source-level host contract checks; no installed DSH host or model is driven. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

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
function fixture({ maxDepth = 2, providerMissing = false, serviceMissing = false, conflict, childConflict, onSpawn, failDrain } = {}) {
  const agents = new Map(), handlers = new Map(), prompts = new Map()
  const record = { starts: [], deliveries: [], contexts: [], interrupts: [], drains: [], firstTurns: [], released: [], removedMessages: [] }
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
  function makeAgent(id, parent, inheritedAllow) {
    const own = new Map(), effects = []
    const inherited = new Map([...globalTools, ...native].filter(([name]) => !inheritedAllow || inheritedAllow.includes(name)))
    const options = Object.freeze({ ...(parent?.options ?? {
      provider: 'parent-provider', model: 'normal-model', reasoningEffort: 'medium', maxTokens: 321,
    }) })
    const session = {
      id, header: { id, cwd: 'E:/offline-fixture', ...(parent ? { parentSession: parent.id, origin: 'subagent', delegationDepth: (parent.session.header.delegationDepth ?? 0) + 1 } : {}) },
      events: [], snapshotEvents() { return [...this.events] },
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
    agent.ctx = { root, agents: registry, get: name => name === 'tools' ? tools : name === 'systemPrompt' ? systemPrompt : name === 'subagents' ? (serviceMissing ? undefined : service) : undefined }
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
        if (name === 'run_code' || !(native.has(name) || globalTools.has(name))) throw new Error(`Native unknown inherited tool ${name}`)
      }
      const child = makeAgent(spec.childId, spec.request.parent, spec.request.toolFilter.allow)
      if (childConflict) child.own.set('ultra_wait_agent', { name: 'ultra_wait_agent', marker: 'unrelated extension' })
      try {
        await emit('agent/created', { agent: child, source: 'fresh', signal: spec.signal })
        record.firstTurns.push({ child, names: Array.from(child.own.keys()) })
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
    parent, agents, record, native, handlers, prompts, service, exports, emit, event, remove,
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
