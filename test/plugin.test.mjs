/** Host registration/state/automatic-entry checks; actual loop contracts have a separate installed-host smoke. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as policy from '../lib/ultra.js'

const compiled = ts.transpileModule(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText
const CONFIG = { toolName: 'ultra_task', concurrency: 3, sectionOrder: 117.5, maxSessions: 64,
  timeoutMs: 10000, reportChars: 20000, researchTools: ['read', 'subagent'], jevEnabled: false }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const cooperationToolNames = ['ultra_spawn_agent', 'ultra_send_message', 'ultra_followup_task', 'ultra_wait_agent', 'ultra_interrupt_agent', 'ultra_list_agents']
function boot({ runner, assistRunner, config, lateConnection = false, collaborationClose, beforeAssemblyWaterfall, memoryBeforeStep } = {}) {
  const record = { tools: [], guards: [], commands: [], sections: [], handlers: new Map(), events: new Map(), calls: [], assists: [], pending: [], disposers: [], injections: [],
    agents: new Map(), cooperationMounts: new Map(), assemblies: [] }
  const services = {
    agents: { get: id => record.agents.get(id), roots: () => [...record.agents.values()].filter(a => !a.runtimeOwner) },
    systemPrompt: { section: value => record.sections.push(value), async assemble(context) {
      // Installed SDK SystemPrompt collects schemas BEFORE its assembly
      // waterfall; AgentLoop awaits this assembly BEFORE agent/pre-step.
      const mounted = record.cooperationMounts.get(context.agent)
      const assembly = { sections: [{ name: 'original-complete-prompt', text: 'Keep the original complete prompt' }], contexts: [],
        tools: ['read', 'subagent', ...(mounted ? cooperationToolNames : [])].map(name => ({ name })),
        variables: { original: 'unchanged', fixtureGeneration: mounted?.generation ?? null } }
      record.assemblies.push(assembly)
      await beforeAssemblyWaterfall?.({ assembly, index: record.assemblies.length, context })
      const hook = record.events.get('system-prompt/assemble')
      return hook ? hook(assembly, context, async () => assembly) : assembly
    } },
    commands: { register: value => record.commands.push(value) },
    connection: { register: (owner, channel, handler) => { assert.equal(owner, ctx); record.handlers.set(channel, handler); return () => record.handlers.delete(channel) } },
  }
  const ctx = {
    connection: services.connection,
    tools: { register: value => record.tools.push(value), guard: value => record.guards.push(value) },
    get: name => services[name],
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') record.disposers.push(dispose); return dispose },
    on: (name, fn) => record.events.set(name, fn),
    inject(names, callback) {
      record.injections.push([...names])
      if (lateConnection && names.includes('connection')) record.pending.push(callback)
      else callback(ctx)
    },
  }
  const schema = new Proxy({}, { get: () => () => schema })
  const imported = {
    './capture-memory.js': { installPreTruncationCapture() { return { dispose() {}, status() { return {} } } } },
    './memory-host.js': { installMemoryHost() { return { capture() {}, async beforeStep(...args) { return memoryBeforeStep?.(...args) }, observeRequest() {}, status() {}, async close() {} } }, uninstallMemoryHost() {} },
    '@deepseek-ai/schemastery': { __esModule: true, default: schema },
    '@deepseek-ai/dsh-tools': { defineTool: value => value },
    '@deepseek-ai/dsh-llm': { createUserMessage: value => value },
    '@deepseek-ai/dsh-agent': { agentCarrier: agent => ({ agent }) },
    './ultra.js': policy,
    './collaboration-host.js': { COLLABORATION_TOOLS: cooperationToolNames, installCollaboration(agent) {
      record.collaborationStarts = (record.collaborationStarts ?? 0) + 1
      const mounted = { generation: record.collaborationStarts }
      record.cooperationMounts.set(agent, mounted)
      return { async close() {
        record.collaborationStops = (record.collaborationStops ?? 0) + 1
        await collaborationClose?.({ agent, generation: mounted.generation })
        if (record.cooperationMounts.get(agent) === mounted) record.cooperationMounts.delete(agent)
      } }
    } },
    './assist.js': { async startDecisionAssist(config, options) {
      record.assists.push(options)
      if (assistRunner) return assistRunner(config, options)
      const gate = deferred()
      const stop = () => gate.resolve({ reason: options.signal.aborted ? 'cancelled' : 'stopped', warnings: [], error: null })
      options.signal.addEventListener('abort', stop, { once: true })
      return { runId: 'assist-run', decisionId: 'assist-decision', coordination: { rounds: 0, directives: [], errors: [] }, done: gate.promise, stop }
    } },
    './runtime.js': { routeParentOf: agent => agent.owner, researchToolDenial: (agent, name) => agent?.research && name === 'write' ? 'read-only' : undefined },
    './orchestrator.js': { async runUltra(config, options) {
      record.runtimeConfigs = [...(record.runtimeConfigs ?? []), config]
      record.calls.push(options)
      options.phase('researching')
      if (runner) return runner(config, options)
      return { runId: 'run-1', requested: options.concurrency, succeeded: options.concurrency, decided: true,
        output: 'Verified decision output', routeIds: ['internal-worker'], decisionId: 'internal-decision' }
    } },
  }
  const exports = {}
  vm.runInNewContext(compiled, { exports, require: name => { if (!(name in imported)) throw new Error(name); return imported[name] }, Date, Map, Set, Error, String, Number, AbortController, AbortSignal })
  exports.apply(ctx, { ...CONFIG, ...config })
  return { record, tool: record.tools[0], section: record.sections[0], command: record.commands.find(value => value.name === 'ultra'), teamCommand: record.commands.find(value => value.name === 'team'),
    rpc: (...args) => record.handlers.get('/dsh-ultra-mode')(...args), mountConnection: () => record.pending.forEach(fn => fn(ctx)),
    startTurn(root, turn = 1) {
      root.session ??= { id: root.id }
      record.agents.set(root.id, root)
      record.events.get('session/event')(root.session, { type: 'turn/start', data: { turn } })
    },
    endTurn(root, turn = 1) { record.events.get('session/event')(root.session, { type: 'turn/end', data: { turn } }) },
    assemble: context => services.systemPrompt.assemble(context) }
}
const agent = (id = 'root') => ({ id, ctx: { waterfall: async (_carrier, event, _payload, next) => {
  assert.equal(event, 'agent/request'); return { ...await next(), provider: 'selected-provider', model: 'selected-model' }
} }, options: { provider: 'fallback', model: 'fallback' } })
const exec = a => ({ agent: a, signal: new AbortController().signal })

test('registers automatic observer, tool, guard, command, prompt and RPC', () => {
  const h = boot()
  assert.equal(h.tool.name, 'ultra_task')
  assert.equal(h.command.name, 'ultra')
  assert.equal(h.section.name, 'ultra-mode')
  assert.equal(typeof h.record.events.get('agent/pre-step'), 'function')
  assert.equal(h.record.guards.length, 1)
  assert.equal(h.record.injections.some(names => names.includes('connection') && names.includes('webServer')), true, 'actual HostConnection RPC registration needs owner.webServer injection')
  assert.deepEqual(Array.from(h.tool.parameters.concurrency.enum), [2, 3, 4, 5])
})
test('native pre-step cancellation signal reaches context memory before admission', async () => {
  const abort = new AbortController(), root = agent(), messages = []
  let received
  const h = boot({ memoryBeforeStep(...args) { received = args } })
  await h.record.events.get('agent/pre-step')({ agent: root, step: 1, turn: 1, signal: abort.signal, messages }, async () => ({ kind: 'enter', messages }))
  assert.equal(received[0], root)
  assert.equal(received[1], messages)
  assert.equal(received[2], abort.signal)
})
test('RPC accepts normal-agent assistance and 2/3/4/5 without invalid mutation', () => {
  const h = boot()
  assert.equal(h.rpc('set', { sessionId: 'a', enabled: true, concurrency: 4 }).ok, true)
  for (const concurrency of [0, 6, 3.5, '5', null]) assert.equal(h.rpc('set', { sessionId: 'a', concurrency }).ok, false)
  assert.equal(h.rpc('get', { sessionId: 'a' }).value.concurrency, 4)
  assert.equal(h.rpc('get', { sessionId: 'b' }).value.enabled, false)
  assert.equal(h.rpc('set', { sessionId: 'a', enabled: 'yes' }).ok, false)
  for (const concurrency of [1, 2]) assert.equal(h.rpc('set', { sessionId: 'b', concurrency }).ok, true)
})
test('RPC requires an identity and rejects unknown endpoints', () => {
  const h = boot()
  assert.equal(h.rpc('get', {}).error.code, 'missing-session-id')
  assert.equal(h.rpc('set', { sessionId: ' ' }).ok, false)
  assert.equal(h.rpc('delete', { sessionId: 'a' }).error.code, 'not-found')
})
test('snapshots are detached from live state and session prompt updates', () => {
  const h = boot()
  assert.equal(h.section.text({ agent: agent() }), '')
  h.rpc('set', { sessionId: 'root', enabled: true, concurrency: 5 })
  const snapshot = h.rpc('get', { sessionId: 'root' }).value
  snapshot.concurrency = 3
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.concurrency, 5)
  assert.match(h.section.text({ agent: agent() }), /5/)
  assert.equal(h.section.text({ agent: { ...agent(), owner: agent('other') } }), '')
})
test('command and button use the same state; invalid/child commands fail', () => {
  const h = boot()
  assert.equal(h.command.handler({ rawInput: 'on' }).kind, 'error')
  assert.equal(h.command.handler({ agent: agent(), rawInput: '4' }).kind, 'success')
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.concurrency, 4)
  assert.equal(h.command.handler({ agent: agent(), rawInput: '2' }).kind, 'success')
  assert.equal(h.command.handler({ agent: agent(), rawInput: 'assist' }).kind, 'success')
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.concurrency, 1)
  assert.equal(h.command.handler({ agent: { ...agent(), owner: agent() }, rawInput: 'off' }).kind, 'error')
  h.command.handler({ agent: agent(), rawInput: 'off' })
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.enabled, false)
})
test('RPC waits for late connection service', () => {
  const h = boot({ lateConnection: true })
  assert.equal(h.record.handlers.size, 0)
  h.mountConnection()
  assert.equal(h.rpc('get', { sessionId: 'a' }).ok, true)
})
test('automatic dispatch follows actual enter contract and selected model', async () => {
  const h = boot()
  h.rpc('set', { sessionId: 'root', enabled: true, concurrency: 4 })
  const user = { source: { kind: 'user' }, content: [{ type: 'text', text: 'do authorized task' }] }
  const decision = { kind: 'enter', messages: [user], keep: true }
  const payload = { agent: agent(), step: 1, turn: 1, signal: exec().signal, messages: [user] }
  const result = await h.record.events.get('agent/pre-step')(payload, async () => decision)
  assert.equal(h.record.calls.length, 1)
  assert.equal(h.record.calls[0].concurrency, 4)
  assert.equal(h.record.calls[0].route.provider, 'selected-provider')
  assert.equal(h.record.calls[0].route.model, 'selected-model')
  assert.equal(result.keep, true)
  assert.equal(result.messages[0], user)
  assert.equal(result.messages[1].source.kind, 'ultra-mode')
  assert.match(result.messages[1].content[0].text, /Verified decision output/)
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.activeRuns, 0)
})
test('normal-agent mode starts one assistant without Ultra takeover or delivery tool lock', async () => {
  const h = boot()
  const root = agent()
  h.rpc('set', { sessionId: 'root', enabled: true, concurrency: 1 })
  const user = { id: 'human-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'implement normally' }] }
  const input = { kind: 'enter', messages: [user] }
  const signal = exec().signal
  const hook = h.record.events.get('agent/pre-step')
  const result = await hook({ agent: root, step: 1, turn: 1, signal, messages: [user] }, async () => input)
  assert.equal(h.record.calls.length, 0)
  assert.equal(h.record.assists.length, 1)
  assert.equal(h.record.assists[0].parent, root)
  assert.equal(result.messages[0], user)
  assert.match(result.messages[1].content[0].text, /正常主 Agent/)
  assert.equal(h.record.guards[0]({ agent: root, name: 'write' }), undefined)
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.running, true)
  const feedback = { id: 'feedback', source: { kind: 'ultra-assist' }, content: [{ type: 'text', text: 'verify claim' }] }
  const feedbackInput = { kind: 'enter', messages: [feedback] }
  assert.equal(await hook({ agent: root, step: 2, turn: 1, signal, messages: [feedback] }, async () => feedbackInput), feedbackInput)
  assert.equal(h.record.assists.length, 1, 'decision feedback is not a new human task')
  const snapshotRpc = h.record.handlers.get('/dsh-ultra-mode')
  for (const dispose of h.record.disposers) await dispose()
  assert.equal(snapshotRpc('get', { sessionId: 'root' }).value.running, false)
  assert.equal(h.record.handlers.size, 0)
})

test('assistant creation failure leaves the normal task and tools usable with a visible warning', async () => {
  const h = boot({ assistRunner: async () => { throw new Error('assistant unavailable') } })
  const root = agent()
  h.rpc('set', { sessionId: 'root', enabled: true, concurrency: 1 })
  const user = { source: { kind: 'user' }, content: [{ type: 'text', text: 'normal task' }] }
  const output = await h.record.events.get('agent/pre-step')({ agent: root, step: 1, turn: 1, signal: exec().signal, messages: [user] }, async () => ({ kind: 'enter', messages: [user] }))
  assert.equal(output.messages[0], user)
  assert.match(output.messages[1].content[0].text, /未启动.*assistant unavailable/)
  assert.equal(h.record.guards[0]({ agent: root, name: 'write' }), undefined)
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.running, false)
  assert.equal(h.record.calls.length, 0)
})

test('assistant terminal outcomes separate recovered warnings, timeout, cancellation and unresolved failure', async () => {
  for (const [reason, expectedPhase, error] of [
    ['turn-ended', 'completed', null],
    ['timeout', 'timed-out', 'Ultra 决策辅助已超时，主 Agent 保持正常运行。'],
    ['cancelled', 'cancelled', null],
    ['stopped', 'stopped', null],
    ['failed', 'failed', '未恢复的协议错误'],
  ]) {
    const gate = deferred()
    const warnings = ['第 1 轮：已保留的格式诊断']
    const h = boot({ assistRunner: async () => ({ runId: 'assist-outcome', decisionId: 'decision-outcome',
      coordination: { rounds: 1, directives: [], errors: warnings }, done: gate.promise,
      stop: () => gate.resolve({ reason: 'stopped', warnings, error: null }) }) })
    const root = agent()
    h.rpc('set', { sessionId: root.id, enabled: true, concurrency: 1 })
    const user = { id: 'human-outcome', source: { kind: 'user' }, content: [{ type: 'text', text: 'normal parent task' }] }
    const signal = exec().signal
    await h.record.events.get('agent/pre-step')({ agent: root, step: 1, turn: 1, signal, messages: [user] },
      async () => ({ kind: 'enter', messages: [user] }))
    gate.resolve({ reason, warnings, error })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    const snapshot = h.rpc('get', { sessionId: root.id }).value
    assert.equal(signal.aborted, false, 'the assist outcome cannot cancel the normal parent')
    assert.equal(snapshot.phase, expectedPhase)
    assert.equal(snapshot.error, error)
    assert.equal(snapshot.running, false)
    assert.equal(snapshot.warnings[0], warnings[0])
    assert.equal(snapshot.lastRun.succeeded, 0, 'sidecar completion is not a task-success claim')
    assert.equal(h.record.guards[0]({ agent: root, name: 'write' }), undefined)
    warnings.push('later mutation')
    assert.equal(h.rpc('get', { sessionId: root.id }).value.warnings.length, 1)
    for (const dispose of h.record.disposers) await dispose()
  }
})

test('assistant startup deadline remains a timeout while the normal parent task proceeds', async () => {
  const timeout = new Error('Ultra assistant creation exceeded its deadline')
  timeout.name = 'TimeoutError'
  const h = boot({ assistRunner: async () => { throw timeout } })
  const root = agent()
  const signal = exec().signal
  h.rpc('set', { sessionId: root.id, enabled: true, concurrency: 1 })
  const user = { id: 'timeout-startup', source: { kind: 'user' }, content: [{ type: 'text', text: 'keep the main task running' }] }
  const output = await h.record.events.get('agent/pre-step')({ agent: root, step: 1, turn: 1, signal, messages: [user] },
    async () => ({ kind: 'enter', messages: [user] }))
  assert.equal(output.messages[0], user)
  assert.equal(signal.aborted, false)
  assert.equal(h.rpc('get', { sessionId: root.id }).value.phase, 'timed-out')
  assert.equal(h.rpc('get', { sessionId: root.id }).value.running, false)
  assert.equal(h.record.guards[0]({ agent: root, name: 'write' }), undefined)
})

test('fresh same-turn human tasks replace assistance only after prior cleanup', async () => {
  const h = boot()
  const root = agent()
  h.rpc('set', { sessionId: 'root', enabled: true, concurrency: 1 })
  const hook = h.record.events.get('agent/pre-step')
  const signal = exec().signal
  for (const [index, text] of ['first task', 'second task'].entries()) {
    const user = { id: `human-${index}`, source: { kind: 'user' }, content: [{ type: 'text', text }] }
    await hook({ agent: root, step: index + 1, turn: 1, signal, messages: [user] }, async () => ({ kind: 'enter', messages: [user] }))
  }
  assert.equal(h.record.assists.length, 2)
  assert.deepEqual(h.record.assists.map(options => options.task), ['first task', 'second task'])
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.running, true)
  h.rpc('set', { sessionId: 'root', enabled: false })
  const user = { id: 'off-task', source: { kind: 'user' }, content: [{ type: 'text', text: 'ordinary' }] }
  await hook({ agent: root, step: 3, turn: 1, signal, messages: [user] }, async () => ({ kind: 'enter', messages: [user] }))
  assert.equal(h.record.assists.length, 2)
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.running, false)
  assert.equal(h.record.guards[0]({ agent: root, name: 'write' }), undefined)
})

test('off, steps without fresh user input, child loops, commands and non-enter decisions skip dispatch', async () => {
  const h = boot()
  const hook = h.record.events.get('agent/pre-step')
  const user = { source: { kind: 'user' }, content: [{ type: 'text', text: 'test' }] }
  const enter = { kind: 'enter', messages: [user] }
  const payload = { agent: agent(), step: 1, signal: exec().signal, messages: [user] }
  assert.equal(await hook(payload, async () => enter), enter)
  h.rpc('set', { sessionId: 'root', enabled: true })
  for (const [p, d] of [[{ ...payload, step: 2, messages: [] }, enter], [{ ...payload, agent: { ...agent(), owner: agent() } }, enter],
    [payload, { kind: 'stop', messages: [user] }], [payload, { kind: 'enter', messages: [{ source: { kind: 'command' }, content: [] }] }]]) {
    assert.equal(await hook(p, async () => d), d)
  }
  assert.equal(h.record.calls.length, 0)
})
test('manual tool uses state concurrency and records final outcome', async () => {
  const h = boot()
  h.rpc('set', { sessionId: 'root', concurrency: 5 })
  const result = await h.tool.execute({ task: 'test' }, exec(agent()))
  assert.equal(result.succeeded, 5)
  assert.equal(result.text, 'Verified decision output')
  const snapshot = h.rpc('get', { sessionId: 'root' }).value
  assert.equal(snapshot.phase, 'completed')
  assert.equal(snapshot.lastRun.requested, 5)
  assert.equal(snapshot.lastRun.succeeded, 5)
})
test('same-session overlap is refused; active states cannot be LRU evicted', async () => {
  const gate = deferred()
  const h = boot({ config: { maxSessions: 1 }, runner: async () => gate.promise })
  const first = h.tool.execute({ task: 'first' }, exec(agent()))
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.running, true)
  await assert.rejects(h.tool.execute({ task: 'second' }, exec(agent())), /已有 Ultra/)
  assert.equal(h.rpc('set', { sessionId: 'b', enabled: true }).ok, false)
  gate.resolve({ runId: '1', requested: 3, succeeded: 3, decided: true, output: 'done', routeIds: [], decisionId: 'd' })
  await first
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.activeRuns, 0)
})
test('failure and cancellation clear running state and expose status', async () => {
  for (const aborted of [false, true]) {
    const h = boot({ runner: async () => { throw new Error('scripted fail') } })
    const controller = new AbortController()
    if (aborted) controller.abort()
    await assert.rejects(h.tool.execute({ task: 'test' }, { agent: agent(), signal: controller.signal }), /scripted fail/)
    const snapshot = h.rpc('get', { sessionId: 'root' }).value
    assert.equal(snapshot.running, false)
    assert.equal(snapshot.phase, aborted ? 'cancelled' : 'failed')
    assert.match(snapshot.error, /scripted fail/)
  }
})
test('decision failure is visibly marked and guard forbids recursion', async () => {
  const h = boot({ runner: async () => ({ runId: '1', requested: 3, succeeded: 2, decided: false, output: 'reports only' }) })
  await h.tool.execute({ task: 'test' }, exec(agent()))
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.phase, 'failed')
  const child = { ...agent('child'), owner: agent() }
  assert.match(h.record.guards[0]({ agent: child, name: 'ultra_task' }), /递归/)
  assert.equal(h.record.guards[0]({ agent: { ...child, research: true }, name: 'write' }), 'read-only')
  await assert.rejects(h.tool.execute({ task: 'test' }, exec(child)), /递归/)
})


test('completed Ultra locks all root tools until fresh admitted user input', async () => {
  const h = boot()
  const root = agent()
  await h.tool.execute({ task: 'test' }, exec(root))
  for (const name of ['write', 'run_code', 'ultra_task', 'subagent']) assert.match(h.record.guards[0]({ agent: root, name }), /禁止重复/)
  await assert.rejects(h.tool.execute({ task: 'repeat' }, exec(root)), /已交付/)
  const enter = { kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'next task' }] }] }
  await h.record.events.get('agent/pre-step')({ agent: root, step: 1, signal: exec().signal, messages: enter.messages }, async () => enter)
  assert.equal(h.record.guards[0]({ agent: root, name: 'write' }), undefined)
})

test('a fresh next-step user task in the same turn starts its own Ultra and retains delivery protection', async () => {
  let runs = 0
  const h = boot({ runner: async (_config, options) => ({
    runId: `run-${++runs}`, requested: options.concurrency, succeeded: options.concurrency, decided: true,
    output: `Decision ${runs}: ${options.task}`, routeIds: [`worker-${runs}`], decisionId: `decision-${runs}`,
  }) })
  const root = agent()
  h.rpc('set', { sessionId: root.id, enabled: true, concurrency: 5 })
  const hook = h.record.events.get('agent/pre-step')
  const input = (id, text) => ({ id, source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const first = input('math-input', 'first arithmetic task')
  const second = input('review-input', 'second read-only review')
  const signal = exec().signal
  const firstDecision = await hook({ agent: root, turn: 1, step: 1, messages: [first], signal }, async () => ({ kind: 'enter', messages: [first] }))
  assert.equal(firstDecision.messages.at(-1).source.runId, 'run-1')
  assert.match(h.record.guards[0]({ agent: root, name: 'read' }), /禁止重复/)
  const secondDecision = await hook({ agent: root, turn: 1, step: 2, messages: [second], signal }, async () => ({ kind: 'enter', messages: [second] }))
  assert.equal(h.record.calls.length, 2)
  assert.deepEqual(h.record.calls.map(call => call.task), ['first arithmetic task', 'second read-only review'])
  assert.equal(secondDecision.messages[0], second)
  assert.equal(secondDecision.messages.at(-1).source.runId, 'run-2')
  assert.match(secondDecision.messages.at(-1).content[0].text, /Decision 2: second read-only review/)
  assert.match(h.record.guards[0]({ agent: root, name: 'ultra_task' }), /禁止重复/)
  const delivery = { kind: 'enter', messages: [first, firstDecision.messages.at(-1)] }
  assert.equal(await hook({ agent: root, turn: 1, step: 3, messages: [], signal }, async () => delivery), delivery)
  assert.equal(h.record.calls.length, 2, 'old decision/context cannot trigger a third run')
  assert.match(h.record.guards[0]({ agent: root, name: 'subagent' }), /禁止重复/)
})

test('a fresh same-turn task with Ultra off releases the old lock without dispatching', async () => {
  const h = boot()
  const root = agent()
  await h.tool.execute({ task: 'completed task' }, exec(root))
  const user = { id: 'new-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'ordinary next task' }] }
  const enter = { kind: 'enter', messages: [user] }
  assert.equal(await h.record.events.get('agent/pre-step')({ agent: root, turn: 1, step: 2, signal: exec().signal, messages: [user] }, async () => enter), enter)
  assert.equal(h.record.calls.length, 1)
  assert.equal(h.record.guards[0]({ agent: root, name: 'read' }), undefined)
})

test('step reset, non-user feedback and filtered-out user input cannot unlock or replay a delivered task', async () => {
  const h = boot()
  const root = agent()
  h.rpc('set', { sessionId: root.id, enabled: true })
  await h.tool.execute({ task: 'completed task' }, exec(root))
  const hook = h.record.events.get('agent/pre-step')
  const user = { id: 'unclaimed-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'historical task' }] }
  const notice = { id: 'feedback', source: { kind: 'ultra-mode' }, content: [{ type: 'text', text: 'delivery feedback' }] }
  for (const [step, claimed, decision] of [
    [1, [], { kind: 'enter', messages: [user] }],
    [2, [notice], { kind: 'enter', messages: [user, notice] }],
    [3, [user], { kind: 'enter', messages: [notice] }],
    [4, [user], { kind: 'reject', messages: [user] }],
  ]) {
    assert.equal(await hook({ agent: root, turn: 2, step, signal: exec().signal, messages: claimed }, async () => decision), decision)
    assert.match(h.record.guards[0]({ agent: root, name: 'read' }), /禁止重复/)
  }
  assert.equal(h.record.calls.length, 1)
})

test('admitted user copies retain identity while unrelated user messages cannot enlarge the new task', async () => {
  const h = boot()
  const root = agent()
  h.rpc('set', { sessionId: root.id, enabled: true })
  const user = { id: 'claimed-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'authorized read-only task' }] }
  const admitted = { ...user }
  const history = { id: 'historical-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'unrelated write request' }] }
  const enter = { kind: 'enter', messages: [history, admitted] }
  await h.record.events.get('agent/pre-step')({ agent: root, turn: 1, step: 2, signal: exec().signal, messages: [user] }, async () => enter)
  assert.equal(h.record.calls.length, 1)
  assert.equal(h.record.calls[0].task, 'authorized read-only task')
})
test('collaboration toggle and command are independent from Ultra mode and isolate sessions', () => {
  const h = boot()
  const root = agent()
  h.rpc('set', { sessionId: root.id, enabled: true, concurrency: 5 })
  h.teamCommand.handler({ agent: root, rawInput: 'on' })
  let snapshot = h.rpc('get', { sessionId: root.id }).value
  assert.equal(snapshot.collaborationEnabled, true)
  assert.equal(snapshot.enabled, true)
  assert.equal(snapshot.concurrency, 5)
  h.command.handler({ agent: root, rawInput: 'off' })
  snapshot = h.rpc('get', { sessionId: root.id }).value
  assert.equal(snapshot.collaborationEnabled, true)
  assert.equal(snapshot.enabled, false)
  assert.equal(snapshot.concurrency, 5)
  assert.equal(h.rpc('get', { sessionId: 'another' }).value.collaborationEnabled, false)
  assert.equal(h.rpc('set', { sessionId: root.id, enabled: true, collaborationEnabled: 'yes' }).ok, false)
  assert.equal(h.rpc('get', { sessionId: root.id }).value.enabled, false, 'invalid mixed mutation is atomic')
})

test('collaboration alone keeps normal parent settings and tools without starting any Ultra route', async () => {
  const h = boot()
  const root = agent()
  root.session = { id: root.id }
  root.options.reasoningEffort = 'medium'
  const original = { ...root.options }
  h.rpc('set', { sessionId: root.id, collaborationEnabled: true })
  h.startTurn(root)
  const user = { id: 'ordinary-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'normal task' }] }
  const decision = { kind: 'enter', messages: [user] }
  const result = await h.record.events.get('agent/pre-step')({ agent: root, step: 1, turn: 1, signal: exec(root).signal, messages: [user] }, async () => decision)
  assert.equal(result, decision)
  assert.deepEqual(root.options, original)
  assert.equal(h.record.calls.length, 0)
  assert.equal(h.record.assists.length, 0)
  assert.equal(h.record.collaborationStarts, 1)
  assert.equal(h.record.guards[0]({ agent: root, name: 'write' }), undefined)
  h.endTurn(root)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.record.collaborationStops, 1)
})

test('Ultra dispatch inherits the current independent cooperation setting', async () => {
  const h = boot()
  const root = agent()
  const user = { id: 'combined-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'parallel task' }] }
  h.rpc('set', { sessionId: root.id, enabled: true, concurrency: 2, collaborationEnabled: true })
  h.startTurn(root)
  await h.record.events.get('agent/pre-step')({ agent: root, step: 1, turn: 1, signal: exec(root).signal, messages: [user] }, async () => ({ kind: 'enter', messages: [user] }))
  assert.equal(h.record.runtimeConfigs[0].collaborationEnabled, true)
  assert.equal(h.record.calls[0].concurrency, 2)
  await h.record.disposers.at(-1)()
})

test('turn-start provisioning puts all cooperation tools in the first assembly before pre-step', async () => {
  const h = boot()
  const root = agent('first-request-root')
  root.options.reasoningEffort = 'medium'
  const original = { ...root.options }
  h.rpc('set', { sessionId: root.id, collaborationEnabled: true })
  h.startTurn(root)
  const assembly = await h.assemble({ agent: root, scope: root, signal: exec(root).signal })
  assert.deepEqual(assembly.tools.map(tool => tool.name).filter(name => name.startsWith('ultra_')), cooperationToolNames)
  assert.equal(h.record.collaborationStarts, 1)
  assert.equal(h.record.assemblies.length, 1, 'normal first-turn installation does not require recursive assembly')
  const user = { id: 'first-request-human', source: { kind: 'user' }, content: [{ type: 'text', text: 'Use the first-request cooperation tools' }] }
  const decision = { kind: 'enter', messages: [user], assembly }
  await h.record.events.get('agent/pre-step')({ agent: root, step: 1, turn: 1, signal: exec(root).signal, messages: [user] }, async () => decision)
  assert.equal(h.record.collaborationStarts, 1, 'pre-step does not install a second team after the snapshot')
  assert.deepEqual(root.options, original)
  assert.equal(h.record.calls.length, 0)
  assert.equal(h.record.assists.length, 0)
  h.endTurn(root)
  await h.record.disposers.at(-1)()
})

test('next turn waits for the old native drain and rebuilds its already-captured assembly exactly once', async () => {
  const gate = deferred()
  const h = boot({ collaborationClose: ({ generation }) => generation === 1 ? gate.promise : Promise.resolve() })
  const root = agent('adjacent-turn-root')
  h.rpc('set', { sessionId: root.id, collaborationEnabled: true })
  h.startTurn(root)
  await h.assemble({ agent: root, scope: root, signal: exec(root).signal })
  h.endTurn(root)
  h.startTurn(root, 2)
  let settled = false
  const next = h.assemble({ agent: root, scope: root, signal: exec(root).signal }).then(value => { settled = true; return value })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false, 'schema publication awaits the native close')
    assert.equal(h.record.collaborationStarts, 1)
    assert.equal(h.record.assemblies.at(-1).variables.fixtureGeneration, 1, 'outer assembly initially captured the old team')
    gate.resolve()
    const assembly = await next
    assert.equal(h.record.collaborationStarts, 2)
    assert.equal(assembly.variables.fixtureGeneration, 2)
    assert.equal(assembly.variables.original, 'unchanged')
    assert.deepEqual(assembly.sections, [{ name: 'original-complete-prompt', text: 'Keep the original complete prompt' }])
    assert.deepEqual(assembly.tools.map(tool => tool.name).filter(name => name.startsWith('ultra_')), cooperationToolNames)
    assert.equal(h.record.assemblies.length, 3, 'first turn + stale outer cut + one fresh public assembly')
  } finally { gate.resolve(); await next; h.endTurn(root, 2); await h.record.disposers.at(-1)() }
})

test('disabled next turn removes captured old schemas even when the native close settles before the assembly hook', async () => {
  const gate = deferred()
  const h = boot({
    collaborationClose: ({ generation }) => generation === 1 ? gate.promise : Promise.resolve(),
    beforeAssemblyWaterfall: async ({ index }) => {
      if (index === 2) { gate.resolve(); await new Promise(resolve => setImmediate(resolve)) }
    },
  })
  const root = agent('disabled-next-turn-root')
  h.rpc('set', { sessionId: root.id, collaborationEnabled: true })
  h.startTurn(root)
  await h.assemble({ agent: root, scope: root, signal: exec(root).signal })
  h.endTurn(root)
  h.rpc('set', { sessionId: root.id, collaborationEnabled: false })
  h.startTurn(root, 2)
  try {
    const assembly = await h.assemble({ agent: root, scope: root, signal: exec(root).signal })
    assert.equal(h.record.assemblies[1].tools.some(tool => tool.name.startsWith('ultra_')), true, 'outer cut really captured stale tools')
    assert.equal(h.record.collaborationStarts, 1)
    assert.equal(assembly.variables.fixtureGeneration, null)
    assert.equal(assembly.variables.original, 'unchanged')
    assert.deepEqual(assembly.tools.map(tool => tool.name), ['read', 'subagent'])
    assert.equal(h.record.assemblies.length, 3, 'turn-start remembers the stale cut after the close promise was removed')
  } finally { gate.resolve(); h.endTurn(root, 2); await h.record.disposers.at(-1)() }
})

test('changing collaboration during a turn changes the next turn without retracting this turn tools', async () => {
  const h = boot()
  const root = agent('turn-snapshot-root')
  h.rpc('set', { sessionId: root.id, collaborationEnabled: true })
  h.startTurn(root)
  h.rpc('set', { sessionId: root.id, collaborationEnabled: false })
  const current = await h.assemble({ agent: root, scope: root, signal: exec(root).signal })
  assert.equal(current.tools.filter(tool => tool.name.startsWith('ultra_')).length, 6)
  assert.equal(h.rpc('get', { sessionId: root.id }).value.collaborationEnabled, false)
  h.endTurn(root)
  await new Promise(resolve => setImmediate(resolve))
  h.startTurn(root, 2)
  const next = await h.assemble({ agent: root, scope: root, signal: exec(root).signal })
  assert.deepEqual(next.tools.map(tool => tool.name), ['read', 'subagent'])
  assert.equal(h.record.collaborationStarts, 1)
  h.endTurn(root, 2)
  await h.record.disposers.at(-1)()
})

test('globally enabled cooperation provisions runtime roots without mounting a second team on their native children', async () => {
  const h = boot({ config: { collaborationEnabled: true } })
  const root = agent('owned-tree-root')
  h.startTurn(root)
  await h.assemble({ agent: root, scope: root, signal: exec(root).signal })
  assert.equal(h.record.collaborationStarts, 1)
  const child = agent('ordinary-native-child')
  child.runtimeOwner = root
  h.startTurn(child)
  const assembly = await h.assemble({ agent: child, scope: child, signal: exec(child).signal })
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['read', 'subagent'])
  assert.equal(h.record.collaborationStarts, 1)
  h.endTurn(child)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.record.collaborationStops ?? 0, 0, 'a native child ending does not close its parent team')
  h.endTurn(root)
  await h.record.disposers.at(-1)()
  assert.equal(h.record.collaborationStops, 1)
})

test('plugin teardown aborts and drains in-flight orchestration', async () => {
  let aborted = false
  const h = boot({ runner: async (_config, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('unloaded')) }, { once: true })
  }) })
  const run = h.tool.execute({ task: 'test' }, exec(agent()))
  const rejected = assert.rejects(run, /unloaded/)
  await h.record.disposers.at(-1)()
  await rejected
  assert.equal(aborted, true)
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.running, false)
  assert.equal(h.rpc('get', { sessionId: 'root' }).value.phase, 'cancelled')
  await assert.rejects(h.tool.execute({ task: 'new' }, exec(agent('new'))), /unloaded/)
})
