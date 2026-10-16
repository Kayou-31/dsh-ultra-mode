import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = new URL('../src/capture-memory.ts', import.meta.url)
function fixture() {
  const hooks = new Map(), grants = new WeakMap(), captures = [], order = []
  const ctx = { on(name, fn, options) { assert.equal(options?.prepend, true); hooks.set(name, fn); return () => hooks.delete(name) } }
  const host = { access: agent => {
    const run = grants.get(agent)
    if (!run || agent.forged) throw new Error('caller denied')
    return run
  } }
  const exports = {}
  if (existsSync(source)) {
    const compiled = ts.transpileModule(readFileSync(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText
    vm.runInNewContext(compiled, { exports, require: name => {
      assert.equal(name, './memory-host.js')
      return { memoryFor: agent => grants.get(agent) }
    } })
  }
  function agent(options = {}) {
    const agent = { id: options.id ?? 'a', forged: options.forged }
    const run = { host: options.host ?? host, active: options.active ?? true,
      captureTool(a, callId, name, result) {
        if (options.throwCapture) throw new Error('evidence disk unavailable')
        order.push(`captured:${callId}`)
        captures.push({ a, callId, name, result: structuredClone(result) })
        return options.empty ? [] : [`src_${callId}`]
      },
    }
    if (!options.unbound) grants.set(agent, run)
    return agent
  }
  return { exports, ctx, host, hooks, captures, order, grants, agent }
}
const api = fixture().exports
const ready = { skip: typeof api.installPreTruncationCapture !== 'function' }

test('exports opt-in pre-retention capture wiring', () => assert.equal(typeof api.installPreTruncationCapture, 'function'))

test('captures normalized public output before later retention and preserves exact returned object', ready, async () => {
  const f = fixture(), caller = f.agent(), handle = f.exports.installPreTruncationCapture(f.ctx, f.host)
  const full = 'retained prefix '.repeat(100) + ' RARE_FULL_TAIL'
  const raw = Object.freeze({ content: Object.freeze([{ type: 'text', text: full }]), isError: false, value: 'PRIVATE_CANONICAL_VALUE', meta: { secret: true } })
  const result = await f.hooks.get('tools/execute')({ agent: caller, callId: 'call', name: 'read' }, async () => raw)
  f.order.push('project-and-retain')
  assert.equal(result, raw)
  assert.match(f.captures[0].result.content[0].text, /RARE_FULL_TAIL/)
  assert.equal('value' in f.captures[0].result, false)
  assert.equal('meta' in f.captures[0].result, false)
  assert.deepEqual(f.order, ['captured:call', 'project-and-retain'])
  assert.equal(handle.status().capturedResults, 1)
  assert.match(handle.status().coverage, /normalized|retention/)
  assert.ok(handle.status().limitations.some(text => /body|render/.test(text)))
})

test('unbound, inactive, foreign-host and forged agents do not gain capture grants', ready, async () => {
  const f = fixture(), handle = f.exports.installPreTruncationCapture(f.ctx, f.host)
  for (const caller of [undefined, f.agent({ unbound: true }), f.agent({ active: false }), f.agent({ host: {} }), f.agent({ forged: true })]) {
    const raw = { content: [{ type: 'text', text: 'outside-project-secret' }] }
    assert.equal(await f.hooks.get('tools/execute')({ agent: caller, callId: 'call', name: 'read' }, async () => raw), raw)
  }
  assert.equal(f.captures.length, 0)
  assert.ok(handle.status().ignoredResults + handle.status().captureFailures >= 5)
})

test('capture failures are visible in status and never turn successful tools into errors', ready, async () => {
  const f = fixture(), caller = f.agent({ throwCapture: true }), handle = f.exports.installPreTruncationCapture(f.ctx, f.host)
  const raw = { content: [{ type: 'text', text: 'tool-result' }] }
  assert.equal(await f.hooks.get('tools/execute')({ agent: caller, callId: 'call', name: 'read' }, async () => raw), raw)
  assert.equal(handle.status().captureFailures, 1)
  const failure = new Error('original dispatch error')
  await assert.rejects(f.hooks.get('tools/execute')({ agent: caller, callId: 'call', name: 'read' }, async () => { throw failure }), error => error === failure)
})

test('PTC log capture precedes downstream log-only retention and returns its projected blocks unchanged', ready, async () => {
  const f = fixture(), caller = f.agent(), handle = f.exports.installPreTruncationCapture(f.ctx, f.host)
  const projected = [{ type: 'text', text: 'PTC retained preview' }]
  const output = await f.hooks.get('tools/ptc-dispatch-log')({ exec: { agent: caller }, subCallId: 'outer:ptc:1', name: 'read', isError: false, content: [{ type: 'text', text: 'PTC FULL ORIGINAL TAIL' }] }, async () => {
    f.order.push('ptc-log-retention'); return projected
  })
  assert.equal(output, projected)
  assert.match(f.captures[0].result.content[0].text, /PTC FULL ORIGINAL TAIL/)
  assert.deepEqual(f.order, ['captured:outer:ptc:1', 'ptc-log-retention'])
  assert.equal(handle.status().capturedPtcLogs, 1)
})

test('empty capture IDs expose a coverage gap and disposal removes both observers idempotently', ready, async () => {
  const f = fixture(), caller = f.agent({ empty: true }), handle = f.exports.installPreTruncationCapture(f.ctx, f.host)
  await f.hooks.get('tools/execute')({ agent: caller, callId: 'call', name: 'read' }, async () => ({ content: [{ type: 'text', text: 'value' }] }))
  assert.equal(handle.status().unavailableCaptures, 1)
  const status = handle.status(); status.limitations.push('mutated snapshot')
  assert.equal(handle.status().limitations.includes('mutated snapshot'), false)
  handle.dispose(); handle.dispose()
  assert.equal(f.hooks.size, 0)
})

test('real rc.2 ToolRuntime captures renderer output before project, post-policy and final transforms', ready, async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
  const { SessionStore } = await import('@deepseek-ai/dsh-session')
  const { SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const f = fixture(), ctx = new Context(), caller = f.agent()
  caller.ctx = ctx
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
  await ctx.plugin(ToolRuntime, { mode: 'native' }).await()
  const handle = f.exports.installPreTruncationCapture(ctx, f.host)
  const tools = ctx.get('tools')
  tools.register({ name: 'capture_fixture', description: 'Offline retention ordering fixture', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'FULL_RENDERED_OUTPUT_WITH_RARE_TAIL',
    projectContent: () => { f.order.push('tool-project'); return [{ type: 'text', text: 'projected' }] },
    finalizeContent: () => { f.order.push('tool-finalize'); return [{ type: 'text', text: 'final preview' }] },
  })
  const off = ctx.on('tools/post-execute', async (_exec, _result, next) => { f.order.push('post-policy'); return next() })
  try {
    const result = await tools.execute({ agent: caller, callId: ToolCallId('real-call'), name: 'capture_fixture', arguments: {}, signal: new AbortController().signal })
    assert.equal(result.content[0].text, 'final preview')
    assert.equal(f.captures[0].result.content[0].text, 'FULL_RENDERED_OUTPUT_WITH_RARE_TAIL')
    assert.deepEqual(f.order, ['captured:real-call', 'tool-project', 'post-policy', 'tool-finalize'])
  } finally { off(); handle.dispose(); await ctx.fiber.dispose() }
})
