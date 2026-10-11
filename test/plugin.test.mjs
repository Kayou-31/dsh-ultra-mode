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
function boot({ runner, config, lateConnection = false } = {}) {
  const record = { tools: [], guards: [], commands: [], sections: [], handlers: new Map(), events: new Map(), calls: [], pending: [], disposers: [], injections: [] }
  const services = {
    systemPrompt: { section: value => record.sections.push(value) },
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
    '@deepseek-ai/schemastery': { __esModule: true, default: schema },
    '@deepseek-ai/dsh-tools': { defineTool: value => value },
    '@deepseek-ai/dsh-llm': { createUserMessage: value => value },
    '@deepseek-ai/dsh-agent': { agentCarrier: agent => ({ agent }) },
    './ultra.js': policy,
    './runtime.js': { routeParentOf: agent => agent.owner, researchToolDenial: (agent, name) => agent?.research && name === 'write' ? 'read-only' : undefined },
    './orchestrator.js': { async runUltra(config, options) {
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
  return { record, tool: record.tools[0], section: record.sections[0], command: record.commands[0],
    rpc: (...args) => record.handlers.get('/dsh-ultra-mode')(...args), mountConnection: () => record.pending.forEach(fn => fn(ctx)) }
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
  assert.deepEqual(Array.from(h.tool.parameters.concurrency.enum), [3, 4, 5])
})
test('RPC strictly accepts 3/4/5 and never mutates on invalid values', () => {
  const h = boot()
  assert.equal(h.rpc('set', { sessionId: 'a', enabled: true, concurrency: 4 }).ok, true)
  for (const concurrency of [2, 6, 3.5, '5', null]) assert.equal(h.rpc('set', { sessionId: 'a', concurrency }).ok, false)
  assert.equal(h.rpc('get', { sessionId: 'a' }).value.concurrency, 4)
  assert.equal(h.rpc('get', { sessionId: 'b' }).value.enabled, false)
  assert.equal(h.rpc('set', { sessionId: 'a', enabled: 'yes' }).ok, false)
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
  assert.equal(h.command.handler({ agent: agent(), rawInput: '2' }).kind, 'error')
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
  const payload = { agent: agent(), step: 1, turn: 1, signal: exec().signal, messages: [] }
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
test('off, later steps, child loops, commands and non-enter decisions skip dispatch', async () => {
  const h = boot()
  const hook = h.record.events.get('agent/pre-step')
  const user = { source: { kind: 'user' }, content: [{ type: 'text', text: 'test' }] }
  const enter = { kind: 'enter', messages: [user] }
  const payload = { agent: agent(), step: 1, signal: exec().signal }
  assert.equal(await hook(payload, async () => enter), enter)
  h.rpc('set', { sessionId: 'root', enabled: true })
  for (const [p, d] of [[{ ...payload, step: 2 }, enter], [{ ...payload, agent: { ...agent(), owner: agent() } }, enter],
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


test('completed Ultra locks all root tools until the next user turn', async () => {
  const h = boot()
  const root = agent()
  await h.tool.execute({ task: 'test' }, exec(root))
  for (const name of ['write', 'run_code', 'ultra_task', 'subagent']) assert.match(h.record.guards[0]({ agent: root, name }), /禁止重复/)
  await assert.rejects(h.tool.execute({ task: 'repeat' }, exec(root)), /已交付/)
  const enter = { kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'next task' }] }] }
  await h.record.events.get('agent/pre-step')({ agent: root, step: 1, signal: exec().signal }, async () => enter)
  assert.equal(h.record.guards[0]({ agent: root, name: 'write' }), undefined)
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
