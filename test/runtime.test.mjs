/** Real DSH tool/scope SDK checks with a small offline agent lifecycle fixture. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const names = ['cordis', 'dsh-scope', 'dsh-tools', 'dsh-system-prompt', 'dsh-agent', 'dsh-llm', 'dsh-session']
let sdk, unavailable
try {
  sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(
    process.env.DSH_ULTRA_TEST_SDK
      ? pathToFileURL(resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai', name, 'lib', 'index.js')).href
      : `@deepseek-ai/${name}`,
  )])))
} catch (error) {
  if (process.env.DSH_ULTRA_TEST_SDK || error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  unavailable = 'Actual DSH SDK peers are unavailable; set DSH_ULTRA_TEST_SDK to an installed SDK node_modules directory.'
}
const compiled = ts.transpileModule(readFileSync(new URL('../src/runtime.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText

/** Exercise ownership and failure ordering without optional SDK peers or a model. */
function lifecycleFixture({ drain, handleDispose, unpublishedFailure, memory } = {}) {
  const runtime = {}, agents = new Map(), hooks = new Map(), record = []
  const subscribe = (name, callback) => {
    const listeners = hooks.get(name) ?? new Set()
    hooks.set(name, listeners)
    listeners.add(callback)
    return () => { record.push(`off:${name}`); listeners.delete(callback) }
  }
  const root = { on: subscribe }
  const registry = { get: id => agents.get(id) }
  const services = {
    agentPresets: { composeFrom() {} },
    subagents: { async drainContinuableDescendants(parents) {
      record.push('drain:start')
      assert.equal(parents.length, 1)
      assert.equal(agents.get(parents[0].id), parents[0], 'drain receives the exact published route')
      if (drain) await drain({ route: parents[0], agents, record, disposeAgent })
      else for (const agent of [...agents.values()]) {
        if (agent.session.header.parentSession === parents[0].id) await disposeAgent(agent)
      }
      record.push('drain:end')
    } },
  }
  function makeAgent(id, header = {}) {
    const effects = []
    const tools = {
      schemas: () => ['read', 'write', 'ultra_task'].map(name => ({ name })),
      get: () => undefined,
      modeFor: () => 'native',
      restrict(filter) {
        let released = false
        const release = () => {
          if (released) return
          released = true
          record.push(`${filter.allow ? 'restriction' : 'deny'}:release:${id}`)
        }
        effects.push(release)
        return release
      },
    }
    const agent = {
      id, options: { provider: 'offline', model: 'fixture' }, status: 'idle',
      session: { id, header: { id, ...header }, seq: 0, snapshotEvents: () => [], requestHeader: () => undefined },
      cancel() { record.push(`cancel:${id}`) },
      ctx: { root, agents: registry, get: name => name === 'tools' ? tools : services[name], on: subscribe,
        effect(callback) { const dispose = callback(); effects.push(dispose); return dispose } },
      effects,
    }
    return agent
  }
  async function disposeAgent(agent) {
    for (const dispose of agent.effects) await dispose?.()
    agents.delete(agent.id)
  }
  const parent = makeAgent('visible-root')
  if (memory) parent.memoryRun = memory
  agents.set(parent.id, parent)
  registry.create = async options => {
    const child = makeAgent(options.sessionId, options.meta)
    child.options = { ...options.agentOptions }
    await options.setup(child.ctx, child)
    if (unpublishedFailure) throw unpublishedFailure
    agents.set(child.id, child)
    return { agent: child, async dispose() {
      record.push('handle:dispose')
      if (handleDispose) await handleDispose({ route: child, agents, record, disposeAgent })
      else await disposeAgent(child)
    } }
  }
  const imported = {
    '@deepseek-ai/dsh-agent': { agentCarrier: agent => agent },
    '@deepseek-ai/dsh-llm': { ReasoningEffortId: value => value, createUserMessage: value => value },
    '@deepseek-ai/dsh-session': { SessionId: value => value, SessionLogOffset: value => value },
    '@deepseek-ai/dsh-scope': { scopeParentOf: () => undefined },
    './memory-host.js': { memoryFor: agent => agent.memoryRun },
  }
  vm.runInNewContext(compiled, { exports: runtime, require: name => imported[name], AggregateError, Error, Map, Set, WeakMap, Promise })
  return {
    runtime, record, agents, parent, services, disposeAgent,
    async request(config) { return [...(hooks.get('agent/request') ?? [])][0]({}, async () => config) },
    emit: (name, ...args) => { for (const listener of hooks.get(name) ?? []) listener(...args) },
    create: () => runtime.createRoute(parent, { id: 'ultra-route-lifecycle', label: 'Offline lifecycle',
      readOnly: true, researchTools: ['read'], signal: new AbortController().signal }, { toolName: 'ultra_task' }),
    async descendant(routeId, id = 'native-continuable-child') {
      const child = makeAgent(id, { parentSession: routeId, origin: 'subagent', delegationDepth: 1 })
      agents.set(id, child)
      for (const listener of hooks.get('agent/created') ?? []) await listener({ agent: child })
      return child
    },
  }
}

test('per-run output caps reach every request while Max is preserved and inherited caps return after the turn', async () => {
  const f = lifecycleFixture()
  f.parent.options.maxTokens = 8192
  const route = await f.create(), agent = f.agents.get(route.id), observed = [], events = []
  let request = { provider: 'offline', model: 'fixture', reasoningEffort: 'low', maxTokens: 8192 }
  agent.session.snapshotEvents = () => events
  agent.followup = () => {}
  agent.whenIdle = async () => {
    for (let step = 0; step < 2; step++) { request = await f.request(request); observed.push({ ...request }) }
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'public report' }] } } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  }
  await route.run([{ type: 'text', text: 'planning' }], { maxTokens: 16384 })
  await route.run([{ type: 'text', text: 'next phase inherits' }], { maxTokens: 0 })
  assert.deepEqual(observed.map(value => value.maxTokens), [16384, 16384, 8192, 8192])
  assert.ok(observed.every(value => value.reasoningEffort === 'max'))
  await route.dispose()
})

test('per-run cap validation precedes native followup and max-token endings are never counted as completed reports', async () => {
  const f = lifecycleFixture(), route = await f.create(), agent = f.agents.get(route.id), events = []
  let followups = 0
  agent.session.snapshotEvents = () => events
  agent.followup = () => { followups++ }
  agent.whenIdle = async () => { events.push({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }) }
  for (const maxTokens of [-1, 1.5, Infinity, NaN]) await assert.rejects(route.run([], { maxTokens }), /maxTokens.*positive|positive.*maxTokens/i)
  assert.equal(followups, 0)
  const outcome = await route.run([], { maxTokens: 32768 })
  assert.equal(outcome.ok, false)
  assert.match(outcome.error, /max-tokens/)
  assert.equal(followups, 1, 'a budget failure must not silently add another model turn')
  await route.dispose()
})

test('an explicit turn cap does not become the default when the parent had no cap', async () => {
  const f = lifecycleFixture(), route = await f.create(), agent = f.agents.get(route.id), events = [], observed = []
  let request = { provider: 'offline', model: 'fixture' }
  agent.session.snapshotEvents = () => events
  agent.followup = () => {}
  agent.whenIdle = async () => {
    request = await f.request(request); observed.push({ ...request })
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'public answer' }] } } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  }
  await route.run([], { maxTokens: 16000 })
  await route.run([], { maxTokens: 0 })
  assert.equal(observed[0].maxTokens, 16000)
  assert.equal(Object.hasOwn(observed[1], 'maxTokens'), false)
  assert.equal(observed[1].reasoningEffort, 'max')
  await route.dispose()
})

test('runtime binds research descendants and captures complete evidence before progress truncation', async () => {
  const captured = [], bound = [], steering = [], deliveries = []
  const memory = {
    bind: (agent, routeId) => bound.push({ agent, routeId }),
    captureEvent: (session, event) => { captured.push({ session, event }); return ['event-full'] },
    captureTool: (agent, callId, name, result) => { captured.push({ agent, callId, name, result }); return ['tool-full'] },
    recordReport: (_id, text) => { captured.push({ report: text }); return ['report-full'] },
    refs: () => ['event-full', 'tool-full'],
    recordDelivery: (...args) => deliveries.push(args),
  }
  const f = lifecycleFixture({ memory })
  const route = await f.create()
  const agent = f.agents.get(route.id)
  assert.ok(bound.some(value => value.agent === agent && value.routeId === route.id))
  const child = await f.descendant(route.id)
  assert.ok(bound.some(value => value.agent === child && value.routeId === route.id))
  const progress = []
  route.subscribeProgress(value => progress.push(value))
  const events = []
  agent.session.snapshotEvents = () => events
  agent.followup = () => { agent.status = 'running' }
  agent.steer = message => steering.push(message)
  agent.whenIdle = async () => {
    assert.equal(route.steer('Model feedback stays evidence, never human authorization'), true)
    const toolResult = { content: [{ type: 'text', text: 'T'.repeat(2500) + 'TOOL_TAIL' }] }
    f.emit('tools/result', { agent: child, name: 'read', callId: 'call-real' }, toolResult)
    const message = { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'A'.repeat(2500) + 'ASSISTANT_TAIL' }] } } }
    events.push(message, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    f.emit('session/event', agent.session, message)
    agent.status = 'idle'
  }
  const outcome = await route.run([{ type: 'text', text: 'Research' }])
  assert.ok(captured.some(value => value.result?.content[0].text.endsWith('TOOL_TAIL')))
  assert.ok(captured.some(value => value.event?.data.message.content[0].text.endsWith('ASSISTANT_TAIL')))
  assert.ok(progress.every(value => value.text.length <= 2000 && value.evidenceIds.length > 0))
  assert.ok(progress.some(value => value.evidenceIds.includes('tool-full')))
  assert.ok(outcome.evidenceIds.includes('report-full'))
  assert.equal(outcome.text.endsWith('ASSISTANT_TAIL'), true)
  assert.equal(steering[0].source.kind, 'ultra-steering')
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0][1], agent.id)
  assert.equal(deliveries[0][2], 'queued')
  await route.dispose()
})

test('route teardown drains native continuations before releasing the route and its research guard', async () => {
  let releaseDrain
  const held = new Promise(resolve => { releaseDrain = resolve })
  const f = lifecycleFixture({ drain: async ({ route, agents, disposeAgent }) => {
    await held
    for (const agent of [...agents.values()]) if (agent.session.header.parentSession === route.id) await disposeAgent(agent)
  } })
  const route = await f.create()
  const child = await f.descendant(route.id)
  const disposal = route.dispose()
  assert.deepEqual(f.record, ['drain:start'])
  assert.equal(f.runtime.isUltraRoute(route.id), true)
  assert.match(f.runtime.researchToolDenial(child, 'write'), /cannot execute/)
  releaseDrain()
  await disposal
  assert.ok(f.record.indexOf('drain:end') < f.record.indexOf('handle:dispose'))
  assert.ok(f.record.indexOf('drain:end') < f.record.indexOf(`restriction:release:${route.id}`))
  assert.equal(f.agents.has(child.id), false)
  assert.equal(f.runtime.isUltraRoute(route.id), false)
  await route.dispose()
  assert.equal(f.record.filter(entry => entry === 'drain:start').length, 1, 'disposal is idempotent')
})

test('native drain and route failures are both preserved and still stop observers', async () => {
  const drainFailure = new Error('native descendant teardown failed')
  const routeFailure = new Error('route handle teardown failed')
  const f = lifecycleFixture({ drain: async () => { throw drainFailure }, handleDispose: async () => { throw routeFailure } })
  const route = await f.create()
  const child = await f.descendant(route.id)
  await assert.rejects(route.dispose(), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [drainFailure, routeFailure])
    return true
  })
  assert.ok(f.record.includes('handle:dispose'), 'route disposal is attempted after native failure')
  assert.ok(f.record.includes('off:agent/created'))
  assert.ok(f.record.includes('off:session/event'))
  assert.match(f.runtime.researchToolDenial(child, 'write'), /cannot execute/)
  assert.equal(f.record.includes(`restriction:release:${child.id}`), false, 'live failed child remains guarded')
  await f.disposeAgent(child)
  assert.equal(f.record.includes(`restriction:release:${child.id}`), true)
  await f.disposeAgent(f.agents.get(route.id))
  assert.equal(f.runtime.isUltraRoute(route.id), false)
})

test('orphan research guard survives route removal when native descendant draining fails', async () => {
  const f = lifecycleFixture({ drain: async () => { throw new Error('native child still live') } })
  const route = await f.create()
  const child = await f.descendant(route.id)
  await assert.rejects(route.dispose(), /teardown failed/)
  assert.equal(f.agents.has(route.id), false)
  assert.equal(f.runtime.isUltraRoute(route.id), false)
  assert.match(f.runtime.researchToolDenial(child, 'write'), /cannot execute/)
  assert.equal(f.record.includes(`restriction:release:${child.id}`), false)
  await f.disposeAgent(child)
  assert.equal(f.record.includes(`restriction:release:${child.id}`), true)
})

test('creation failure does not drain an unpublished setup object', async () => {
  const original = new Error('unpublished creation failed')
  const f = lifecycleFixture({ unpublishedFailure: original })
  await assert.rejects(f.create(), error => error === original)
  assert.equal(f.record.includes('drain:start'), false)
  assert.equal(f.runtime.isUltraRoute('ultra-route-lifecycle'), false)
  assert.equal(f.record.includes('restriction:release:ultra-route-lifecycle'), true)
})

test('route teardown remains available without the optional native subagent service', async () => {
  const f = lifecycleFixture()
  delete f.services.subagents
  const route = await f.create()
  await route.dispose()
  assert.equal(f.record.includes('drain:start'), false)
  assert.equal(f.record.includes('handle:dispose'), true)
  assert.equal(f.runtime.isUltraRoute(route.id), false)
})

async function loadSdk(name) {
  return import(process.env.DSH_ULTRA_TEST_SDK
    ? pathToFileURL(resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai', name, 'lib', 'index.js')).href
    : `@deepseek-ai/${name}`)
}

async function fixture(presentation = 'native') {
  const { Context } = sdk.cordis
  const { createScope, scopeOf, scopeParentOf, bindScopeParent } = sdk['dsh-scope']
  const ctx = new Context()
  await ctx.plugin(sdk['dsh-session'].SessionStore).await()
  await ctx.plugin(sdk['dsh-system-prompt'].SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
  await ctx.plugin(sdk['dsh-tools'].ToolRuntime, { mode: 'native' }).await()
  const runtime = {}
  vm.runInNewContext(compiled, {
    exports: runtime,
    require: name => name === './memory-host.js' ? { memoryFor: () => undefined } : sdk[name.replace('@deepseek-ai/', '')],
    Map, Set, Error, String, Promise,
  })
  const agents = new Map(), identities = [], questions = []
  let callNumber = 0, mutations = 0, turn, failCreation = false
  const tool = (name, execute = async () => [{ type: 'text', text: name }], parameters = {}) => sdk['dsh-tools'].defineContentToolFixture({
    name, description: `Offline ${name}`, parameters, execute,
  })
  for (const name of ['global_read', 'pwsh', 'workflow', 'ultra_task']) ctx.get('tools').register(tool(name))
  ctx.get('tools').register(tool('ask_user_question', async (args, exec) => {
    questions.push({ args, agent: exec.agent })
    return [{ type: 'text', text: 'Fixture answer' }]
  }, { timeout: { type: 'number' } }))
  const presetKey = {}
  const preset = createScope(ctx, presetKey)
  for (const name of ['read', 'subagent', 'preset_write']) preset.ctx.get('tools').register(tool(name))
  if (presentation !== 'native') preset.ctx.get('tools').presentAs(presentation)
  ctx.provide('agentPresets', {
    composeFrom(childCtx, parentCtx) {
      const inherited = scopeParentOf(scopeOf(parentCtx))
      if (inherited !== undefined) bindScopeParent(scopeOf(childCtx), inherited)
    },
  })
  function agent(id, header = {}) {
    const value = {
      id, options: { provider: 'offline', model: 'fixture' },
      session: ctx.get('sessions').create(sdk['dsh-session'].SessionId(id), { meta: header }),
      status: 'idle',
      inbox: { nextStep: [] },
      steer(message) { value.inbox.nextStep.push(message) },
      cancel(reason) { value.cancelled = reason; value.inbox.nextStep.length = 0 },
      followup(message) {
        value.followupMessage = message
        value.status = 'running'
        value.pending = Promise.resolve().then(async () => {
          await turn?.(value)
          value.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: sdk['dsh-llm'].createAssistantMessage({ content: [{ type: 'text', text: 'Fixture report' }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
          value.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        })
      },
      async whenIdle() { await value.pending; value.status = 'idle' },
    }
    agents.set(id, value)
    return value
  }
  ctx.provide('agents', {
    get: id => agents.get(id),
    async create(options) {
      const child = agent(options.sessionId, options.meta)
      const scope = createScope(ctx, child)
      child.ctx = scope.ctx
      await options.setup(scope.ctx, child)
      if (failCreation) {
        await scope.dispose()
        agents.delete(child.id)
        throw new Error('Fixture creation failed after setup')
      }
      await ctx.serial('agent/created', { agent: child })
      return { agent: child, async dispose() { await scope.dispose(); agents.delete(child.id) } }
    },
  })
  ctx.get('tools').guard(exec => runtime.researchToolDenial(exec.agent, exec.name))
  const parent = agent('visible-root')
  const parentScope = createScope(ctx, parent, { parent: presetKey })
  parent.ctx = parentScope.ctx
  async function childOf(route, id, ownName = 'own_mutation', origin = 'subagent') {
    const child = agent(id, { parentSession: route.id, ...(origin == null ? {} : { origin }), delegationDepth: 1 })
    // Native child composition joins the preset rather than the parent's own layer.
    const scope = createScope(ctx, child, { parent: presetKey })
    child.ctx = scope.ctx
    child.fixtureScope = scope
    if (ownName) child.ctx.get('tools').register(tool(ownName, async () => { mutations++; return [{ type: 'text', text: 'mutated' }] }))
    await ctx.serial('agent/created', { agent: child })
    identities.push(child)
    return child
  }
  // The native continuation manager owns background handles independently of
  // the route handle. Model that public drain contract in this offline fixture.
  ctx.provide('subagents', {
    async drainContinuableDescendants(parents) {
      const ids = new Set(parents.map(parent => parent.id))
      for (const child of identities) {
        if (!ids.has(child.session.header.parentSession)) continue
        await child.fixtureScope.dispose()
        agents.delete(child.id)
      }
    },
  })
  return {
    ctx, runtime, parent, agents, identities, questions,
    get mutations() { return mutations },
    setTurn(fn) { turn = fn },
    failCreation() { failCreation = true },
    childOf,
    schemas: agent => ctx.get('tools').schemas(agent).map(schema => schema.name).sort(),
    async execute(agent, name, args = {}, signal = new AbortController().signal) {
      return ctx.get('tools').execute({ agent, name, arguments: args, signal, callId: sdk['dsh-llm'].ToolCallId(`fixture-${++callNumber}`) })
    },
    async create(id = 'ultra-route-fixture', signal = new AbortController().signal, researchTools = ['read', 'global_read', 'subagent', 'ask_user_question', 'own_mutation', 'missing-tool', 'run_code'], extra = {}) {
      const route = await runtime.createRoute(parent, { id, label: 'Fixture research', signal, readOnly: true, researchTools, ...extra }, { toolName: 'ultra_task', reportChars: 2000 })
      return { route, agent: agents.get(id) }
    },
    close: () => ctx.fiber.dispose(),
  }
}

test('worker-only report tool concludes through the real SDK result and preserves source gaps', { skip: unavailable }, async () => {
  const f = await fixture()
  const memory = { access: () => ({ projectId: 'fixture', sessionIds: ['root', 'report-worker'] }), store: { recordsFor: () => [{ id: 'src_real', chunks: [{ id: 'chunk_real' }] }] },
    bind() {}, refs: () => [], recordReport: () => [], captureTool: () => [], captureEvent: () => [] }
  const { route, agent } = await f.create('report-worker', new AbortController().signal, ['read'], { memory })
  try {
    assert.equal(f.schemas(agent).includes('ultra_submit_report'), false, 'planning/ordinary turns have no generic report terminal')
    let returned
    f.setTurn(async current => {
      assert.equal(f.schemas(current).includes('ultra_submit_report'), true)
      assert.equal(f.schemas(f.parent).includes('ultra_submit_report'), false)
      const child = await f.childOf(current, 'report-worker-child', undefined)
      assert.equal((await f.execute(child, 'ultra_submit_report', { report: 'forged child report' })).isError, true)
      const invalid = await f.execute(current, 'ultra_submit_report', { report: 'bad citation', evidenceIds: ['src_forged'] })
      assert.equal(invalid.isError, true)
      assert.equal(invalid.concludesTurn, undefined)
      returned = await f.execute(current, 'ultra_submit_report', { report: 'A short public research report.', evidenceIds: ['src_real', 'chunk_real'], unknowns: ['Effect has not been verified.'], conflicts: ['Two sources disagree.'] })
      assert.equal(returned.isError, false)
      assert.equal(returned.concludesTurn, true, 'native success marker ends the turn after this result, without another model answer')
      assert.equal((await f.execute(current, 'read')).isError, true, 'accepted handoff closes further research dispatch')
    })
    const outcome = await route.run([{ type: 'text', text: 'Collect existing facts then submit.' }], { reportSubmission: true })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.text, 'A short public research report.')
    assert.deepEqual([...outcome.evidenceIds], ['src_real', 'chunk_real'])
    assert.deepEqual([...outcome.uncertainties], ['Effect has not been verified.'])
    assert.deepEqual([...outcome.conflicts], ['Two sources disagree.'])
    assert.equal(f.schemas(agent).includes('ultra_submit_report'), false, 'terminal tool is released with the worker turn')
    assert.equal((await f.execute(agent, 'ultra_submit_report', { report: 'after run' })).isError, true)
  } finally { await route.dispose(); await f.close() }
})

test('approval bridge reaches the visible root before actual global Remote forwarding and keeps caller audit/policy', { skip: unavailable, timeout: 5000 }, async () => {
  const f = await fixture()
  const [{ ApprovalService, setApprovalPolicy }, remotes] = await Promise.all([
    loadSdk('dsh-user-approval'), loadSdk('dsh-api-remotes'),
  ])
  let source
  f.ctx.provide('typertGateway', { registerRemoteEvents(value) { source = value; return () => {} } })
  await f.ctx.plugin(ApprovalService, { policy: 'ask' }).await()
  await f.ctx.plugin(remotes).await()
  const remoteAbort = new AbortController()
  // The real Host global answerer is already listening when route setup runs.
  const remote = source(remoteAbort.signal)
  const firstFrame = remote.next()
  let route
  const approvalEvents = agent => agent.session.snapshotEvents().filter(event => event.type === 'approval/asked' || event.type === 'approval/decided')
  try {
    const created = await f.create('approval-decision')
    route = created.route
    route.setReadOnly(false)
    const decision = created.agent
    decision.session.append('turn/start', { turn: 1 })
    const requestSignal = new AbortController().signal
    const request = { agent: decision, toolName: 'write', callId: 'decision-write', reason: 'Outside sandbox', displayReason: 'Fixture rejection only', signal: requestSignal }
    const pending = f.ctx.get('approval').request(request)
    const { value: frame } = await firstFrame
    assert.equal(frame.event, 'approval/request')
    assert.equal(frame.context.subject, f.parent)
    assert.equal(frame.context.agentId, f.parent.id)
    assert.equal(frame.context.value, f.parent.ctx)
    assert.equal(frame.request.agent, f.parent, 'Remote identity contract matches the visible carrier')
    assert.equal(frame.request.signal, requestSignal)
    assert.equal(frame.request.callId, request.callId)
    assert.equal(frame.request.reason, request.reason)
    assert.equal(frame.request.displayReason, request.displayReason)
    assert.equal(request.agent, decision, 'answerer projection never mutates the original caller')
    frame.resolve({ kind: 'result', value: 'rejected' })
    assert.equal(await pending, 'rejected')
    assert.deepEqual(approvalEvents(decision).map(event => event.type), ['approval/asked', 'approval/decided'])
    assert.equal(approvalEvents(decision)[1].data.id, approvalEvents(decision)[0].data.id)
    assert.equal(approvalEvents(decision)[1].data.outcome, 'rejected')
    assert.equal(approvalEvents(f.parent).length, 0, 'visible root does not acquire caller audit')

    const child = await f.childOf(decision, 'approval-native-child', null)
    child.session.append('turn/start', { turn: 1 })
    const cancel = new AbortController()
    const nextFrame = remote.next()
    const childPending = f.ctx.get('approval').request({ agent: child, toolName: 'pwsh', callId: 'child-write', reason: 'Fixture cancellation only', signal: cancel.signal })
    const { value: childFrame } = await nextFrame
    assert.equal(childFrame.context.subject, f.parent, 'ordinary descendant is presented in the same visible root')
    assert.equal(childFrame.request.agent, f.parent)
    cancel.abort(new Error('Fixture cancelled'))
    assert.equal(await childPending, 'cancelled')
    childFrame.reject(cancel.signal.reason)
    assert.equal(approvalEvents(child).at(-1).data.outcome, 'cancelled')
    assert.equal(approvalEvents(f.parent).length, 0)

    // Policy is evaluated on the actual descendant before any UI bridge runs.
    setApprovalPolicy(child.session, 'never')
    assert.equal(await f.ctx.get('approval').request({ agent: child, toolName: 'pwsh' }), 'rejected')
    assert.equal(f.ctx.get('approval').effectivePolicy(f.parent.session), 'ask')
    assert.equal(approvalEvents(child).at(-1).data.outcome, 'rejected')

    const ended = remote.next()
    remoteAbort.abort(new Error('Fixture Remote disconnected'))
    assert.equal((await ended).done, true)
    assert.equal(await f.ctx.get('approval').request({ agent: decision, toolName: 'write' }), 'unavailable', 'no Remote answerer still fails closed')
    assert.equal(approvalEvents(decision).at(-1).data.outcome, 'unavailable')
    assert.equal(approvalEvents(f.parent).length, 0)
    await route.dispose()
    route = undefined
    assert.equal(f.runtime.isUltraRoute(decision.id), false)
  } finally {
    remoteAbort.abort(new Error('Fixture cleanup'))
    await remote.return()
    await route?.dispose()
    await f.close()
  }
})

test('actual SDK masks inherited research tools, preserves own tools, and restores decision access', { skip: unavailable }, async () => {
  for (const presentation of ['native', 'ptc', 'both']) {
    const f = await fixture(presentation)
    try {
      const original = f.schemas(f.parent)
      const { route, agent } = await f.create()
      const child = await f.childOf(agent, 'native-child')
      for (const research of [agent, child]) {
        assert.ok(f.schemas(research).includes('read'), 'preset research tool retained')
        assert.ok(f.schemas(research).includes('global_read'), 'global research tool retained')
        assert.ok(f.schemas(research).includes('subagent'), 'native child capability retained')
        for (const hidden of ['pwsh', 'workflow', 'preset_write', 'run_code', 'ultra_task']) assert.equal(f.schemas(research).includes(hidden), false, hidden)
      }
      assert.ok(f.schemas(child).includes('own_mutation'), 'own scoped registration is not passed as an unknown inherited name')
      const deniedChild = await f.childOf(agent, 'denied-child', 'unapproved_own_tool')
      assert.equal((await f.execute(deniedChild, 'unapproved_own_tool')).isError, true)
      assert.equal(f.mutations, 0, 'guard rejects unapproved own tool even though SDK preserves its schema')
      assert.match(f.runtime.researchToolDenial(child, 'run_code'), /cannot execute/)
      await agent.ctx.get('tools').get('ask_user_question', agent).execute({ timeout: 8 }, { agent })
      assert.equal(f.questions[0].agent, f.parent)
      assert.equal(f.questions[0].args.timeout, -1)
      route.setReadOnly(false)
      for (const restored of [agent, child]) {
        for (const allowed of ['pwsh', 'workflow', 'preset_write']) assert.ok(f.schemas(restored).includes(allowed), allowed)
        assert.equal(f.schemas(restored).includes('run_code'), presentation !== 'native')
        assert.equal(f.runtime.researchToolDenial(restored, 'pwsh'), undefined)
        assert.equal(f.schemas(restored).includes('ultra_task'), false, 'recursive Ultra restriction remains')
      }
      assert.deepEqual(f.schemas(f.parent), original, 'visible root never acquires route filters')
      route.setReadOnly(true)
      assert.equal(f.schemas(child).includes('pwsh'), false, 're-entering research reapplies filtering')
      await route.dispose()
      for (const restored of [agent, child]) assert.ok(f.schemas(restored).includes('pwsh'), 'exact restriction disposers release retained scope views')
    } finally { await f.close() }
  }
})

test('actual SDK bridge survives a research allowlist without questions and cancellation releases filters', { skip: unavailable }, async () => {
  const f = await fixture('both')
  try {
    const controller = new AbortController()
    const { route, agent } = await f.create('ultra-route-cancel', controller.signal, ['read'])
    assert.equal(f.schemas(agent).includes('ask_user_question'), false, 'unapproved research question schema is hidden')
    assert.match(f.runtime.researchToolDenial(agent, 'ask_user_question'), /cannot execute/)
    route.setReadOnly(false)
    await agent.ctx.get('tools').get('ask_user_question', agent).execute({ timeout: 3 }, { agent })
    assert.equal(f.questions[0].agent, f.parent, 'question bridge was captured before the inherited tool was hidden')
    route.setReadOnly(true)
    controller.abort()
    assert.deepEqual(JSON.parse(JSON.stringify(agent.cancelled)), { kind: 'parent' })
    await route.dispose()
    assert.ok(f.schemas(agent).includes('pwsh'))
    assert.ok(f.schemas(agent).includes('run_code'))
    assert.equal(f.runtime.isUltraRoute(agent.id), false)
  } finally { await f.close() }
})

test('host-observed child identities are scoped to a turn, copied, and never labelled completed', { skip: unavailable }, async () => {
  const f = await fixture()
  try {
    const { route, agent } = await f.create()
    f.setTurn(async current => {
      await f.childOf(current, 'observed-native-child', null)
      await f.childOf(current, 'other-internal-loop', null, null)
    })
    const first = await route.run([{ type: 'text', text: 'Research' }])
    assert.equal(first.ok, true)
    assert.deepEqual(JSON.parse(JSON.stringify(first.subagents)), [{ sessionId: 'observed-native-child', parentSession: agent.id, origin: 'subagent', delegationDepth: 1 }])
    assert.equal('completed' in first.subagents[0], false)
    first.subagents[0].sessionId = 'consumer-change'
    f.setTurn(undefined)
    const second = await route.run([{ type: 'text', text: 'Final review' }])
    assert.equal(second.subagents, undefined, 'old child creations are not replayed as current-turn evidence')
    await route.dispose()
    f.failCreation()
    await assert.rejects(f.create('ultra-route-failed'), /creation failed/)
    assert.equal(f.runtime.isUltraRoute('ultra-route-failed'), false)
    assert.ok(f.schemas(f.agents.get('ultra-route-failed')).includes('pwsh'), 'failed creation releases applied policy layers')
  } finally { await f.close() }
})

test('real SDK tool progress routes child evidence to its worker and steering respects live turn boundaries', { skip: unavailable }, async () => {
  const f = await fixture()
  try {
    const { route, agent } = await f.create('ultra-route-progress')
    const progress = []
    const stop = route.subscribeProgress(value => progress.push(value))
    const original = [{ type: 'text', text: 'Research' }, { type: 'image', data: 'offline-fixture-image' }]
    assert.equal(route.steer('too early'), false)
    f.setTurn(async current => {
      assert.equal(route.steer('Check the alternate evidence'), true)
      assert.equal(current.inbox.nextStep.length, 1, 'the public agent method receives a native next-step message')
      assert.match(current.inbox.nextStep[0].content[0].text, /Ultra 决策研究改向：不扩权、原任务优先/)
      assert.match(current.inbox.nextStep[0].content[0].text, /Check the alternate evidence/)
      assert.deepEqual(current.followupMessage.content, original, 'steering preserves the original image/context prompt')
      const child = await f.childOf(current, 'progress-native-child', null)
      await f.execute(child, 'read')
      child.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: sdk['dsh-llm'].createAssistantMessage({ content: [
        { type: 'reasoning', text: 'PRIVATE_THINKING_MARKER' },
        { type: 'text', text: 'CHILD_EVIDENCE ' + 'x'.repeat(3000) },
      ], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
      const unrelated = await f.childOf(f.parent, 'unrelated-native-child', null)
      unrelated.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: sdk['dsh-llm'].createAssistantMessage({ content: [{ type: 'text', text: 'UNRELATED_MARKER' }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
      assert.equal(route.steer('Unused late feedback'), true)
      current.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      assert.equal(route.steer('after completion'), false, 'turn/end closes steering before the driver reaches idle')
    })
    const result = await route.run(original)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(progress.some(value => value.kind === 'tool' && value.text.includes('read')))
    assert.ok(progress.some(value => value.kind === 'assistant' && value.text.includes('CHILD_EVIDENCE')))
    assert.ok(progress.some(value => value.text.includes('原生子代理 progress-native-child 的已提交进展')))
    assert.ok(progress.every(value => value.sessionId === agent.id && value.text.length <= 2000))
    assert.deepEqual(progress.map(value => value.sequence), progress.map((_, i) => i + 1))
    assert.ok(progress.every(value => !value.text.includes('PRIVATE_THINKING_MARKER') && !value.text.includes('UNRELATED_MARKER')))
    assert.equal(route.steer('idle feedback'), false)
    stop()
    const count = progress.length
    f.setTurn(undefined)
    await route.run([{ type: 'text', text: 'A fresh turn' }])
    assert.equal(progress.length, count, 'unsubscription releases progress delivery')
    await route.dispose()
    assert.equal(route.steer('disposed feedback'), false)
  } finally { await f.close() }
})
