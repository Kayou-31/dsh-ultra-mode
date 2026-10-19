import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function fixture({ enabled = true, holdBegin, holdDispose } = {}) {
  const record = { tools: [], guards: [], sections: [], begins: 0, disposed: 0, calls: [], bindings: [], assemblies: 0 }
  const hooks = new Map(), agents = new Map(), bound = new Map()
  const root = { id: 'root', status: 'running', session: { id: 'root', header: {} } }
  const child = { id: 'child', status: 'running', session: { id: 'child', header: { parentSession: 'root' } } }
  agents.set(root.id, root); agents.set(child.id, child)
  const config = { globalKnowledge: { enabled } }
  const memory = { async begin(agent) {
    record.begins++
    const run = { active: true, host: memory, parent: agent, bind(a) { bound.set(a, run); record.bindings.push(a.id) },
      async dispose() { await holdDispose; if (run.active) { run.active = false; record.disposed++ } } }
    bound.set(agent, run); await holdBegin; return run
  } }
  class GlobalKnowledgeHost {
    constructor(_ctx, _memory, source) { this.source = source }
    authorized() { return this.source()?.enabled === true }
    entry() { return this.authorized() ? 'COMPACT_KNOWLEDGE_ENTRY_NOT_FULL_HISTORY' : undefined }
    status() { return { enabled: this.authorized() } }
    async search(...args) { record.calls.push(['search', ...args]); return { items: [] } }
    async get(...args) { record.calls.push(['get', ...args]); return { id: 'knowledge-id', text: 'bounded' } }
    async publish(...args) { record.calls.push(['publish', ...args]); return { id: 'knowledge-id', hostVerified: false } }
    revoke(...args) { record.calls.push(['revoke', ...args]); return { status: 'revoked' } }
  }
  const ctx = { get(name) { return ({ tools: { register(def) { record.tools.push(def) }, guard(fn) { record.guards.push(fn) } },
    agents: { get: id => agents.get(id), roots: () => [root] }, systemPrompt: { section(section) { record.sections.push(section) } } })[name] },
    on(name, fn) { const set = hooks.get(name) ?? new Set(); hooks.set(name, set); set.add(fn); return () => set.delete(fn) },
    inject(_names, fn) { fn(ctx) } }
  root.ctx = ctx; child.ctx = ctx
  const api = {}
  const url = new URL('../src/knowledge-integration.ts', import.meta.url)
  if (fs.existsSync(url)) {
    const compiled = ts.transpileModule(fs.readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText
    const imported = { 'node:crypto': { randomUUID: () => 'fixture-run' }, '@deepseek-ai/dsh-tools': { defineTool: value => value },
      './knowledge-host.js': { GlobalKnowledgeHost }, './runtime.js': { routeParentOf: () => undefined,
        canPublishKnowledge: agent => agent === root && agent.status === 'running' }, './memory-host.js': { memoryFor: agent => { const run = bound.get(agent); return run?.active ? run : undefined } } }
    vm.runInNewContext(compiled, { exports: api, require(name) { assert.ok(imported[name], name); return imported[name] }, AbortController, AbortSignal, Promise, Map, Set })
  }
  const shutdown = new AbortController()
  const integration = api.installKnowledgeIntegration?.(ctx, config, memory, { isUltraEnabled: () => false, signal: shutdown.signal })
  const emit = (name, ...args) => Promise.all([...(hooks.get(name) ?? [])].map(fn => fn(...args)))
  return { api, record, root, child, config, integration, emit, shutdown, bound,
    assemble: () => emit('system-prompt/assemble', {}, { agent: root, signal: shutdown.signal }, async () => { record.assemblies++; return { complete: true } }) }
}

test('knowledge integration defaults leave tools, prompts and memory lifecycle untouched', async () => {
  const f = fixture({ enabled: false })
  assert.equal(typeof f.api.installKnowledgeIntegration, 'function')
  assert.equal(f.record.tools.length, 0)
  assert.equal(f.record.guards.length, 0)
  assert.equal(f.record.sections.length, 0)
  await f.assemble()
  assert.equal(f.record.begins, 0)
  await f.integration.close()
})

test('four native tool definitions pass actual arguments and preserve explicit write boundaries', async () => {
  const f = fixture()
  assert.deepEqual(f.record.tools.map(tool => tool.name), ['ultra_knowledge_search', 'ultra_knowledge_get', 'ultra_knowledge_publish', 'ultra_knowledge_revoke'])
  const exec = { agent: f.root, signal: new AbortController().signal }
  for (const [name, args] of [['search', { query: 'receipt' }], ['get', { id: 'knowledge-id', offset: 4 }],
    ['publish', { key: 'a', title: 'A', summary: 'A', applicability: 'fixture', sources: [{ sourceId: 'source-id', quote: 'exact' }] }], ['revoke', { id: 'knowledge-id', reason: 'old' }]]) {
    const result = await f.record.tools.find(tool => tool.name === 'ultra_knowledge_' + name).execute(args, exec)
    assert.equal(typeof result.text, 'string')
    assert.equal(f.record.calls.at(-1)[1], f.root)
    assert.equal(f.record.calls.at(-1)[2], args)
  }
  const publish = f.record.tools.find(tool => tool.name === 'ultra_knowledge_publish')
  await assert.rejects(publish.execute({}, { ...exec, agent: f.child }), /publish|publication|发布/i)
  assert.match(f.record.guards[0]({ agent: f.child, name: 'ultra_knowledge_revoke' }), /publish|publication|发布/i)
  assert.equal(f.record.guards[0]({ agent: f.child, name: 'ultra_knowledge_get' }), undefined)
  const aborted = new AbortController(); aborted.abort(new Error('fixture cancelled'))
  const before = f.record.calls.length
  await assert.rejects(publish.execute({}, { ...exec, signal: aborted.signal }), /cancelled/)
  assert.equal(f.record.calls.length, before)
  await f.integration.close()
})

test('ordinary mode initializes before assembly, binds read-only children, and drains on turn end', async () => {
  const f = fixture()
  await Promise.all([f.assemble(), f.assemble()])
  assert.equal(f.record.begins, 1)
  assert.match(f.record.sections[0].text({ agent: f.root }), /COMPACT_KNOWLEDGE_ENTRY/)
  await f.emit('agent/created', { agent: f.child })
  assert.deepEqual(f.record.bindings, ['child'])
  await f.emit('session/event', f.root.session, { type: 'turn/end' })
  await f.integration.close()
  assert.equal(f.record.disposed, 1)
})

test('ending while ordinary memory initializes cannot leave a late live run after cancellation', async () => {
  const gate = Promise.withResolvers(), f = fixture({ holdBegin: gate.promise })
  const assembling = f.assemble()
  await Promise.resolve()
  await f.emit('session/event', f.root.session, { type: 'turn/end' })
  gate.resolve()
  await assembling; await f.integration.close()
  assert.equal(f.record.disposed, 1)
  assert.equal(f.bound.get(f.root)?.active, false)
})

test('parallel assembly awaits the same initialization even after the live binding is visible', async () => {
  const gate = Promise.withResolvers(), f = fixture({ holdBegin: gate.promise })
  const first = f.assemble(), second = f.assemble()
  for (let i = 0; i < 4; i++) await Promise.resolve()
  assert.equal(f.record.assemblies, 0)
  gate.resolve(); await Promise.all([first, second])
  assert.equal(f.record.begins, 1)
  assert.equal(f.record.assemblies, 2)
  await f.integration.close()
})

test('closing after abort joins the already-started ordinary run cleanup', async () => {
  const gate = Promise.withResolvers(), f = fixture({ holdDispose: gate.promise })
  await f.assemble()
  f.shutdown.abort()
  let settled = false
  const closed = f.integration.close().then(() => { settled = true })
  for (let i = 0; i < 8; i++) await Promise.resolve()
  assert.equal(settled, false, 'release must not return while abort cleanup is still active')
  gate.resolve(); await closed
  assert.equal(f.record.disposed, 1)
})
