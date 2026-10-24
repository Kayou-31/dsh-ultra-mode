/** Pinned rc.2 native AgentLoop + subagents + JSONL; local scripted adapters only.
 * This is SDK integration, not an Electron UI, launched profile, or real-model evaluation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const names = ['cordis', 'cordis-plugin-loader', 'dsh-scope', 'dsh-agent', 'dsh-agent-loop', 'dsh-session', 'dsh-session-projection', 'dsh-session-query',
  'dsh-session-persistence-jsonl', 'dsh-system-prompt', 'dsh-tools', 'dsh-llm', 'dsh-agent-preset-registry', 'dsh-agent-preset', 'dsh-subagent', 'dsh-subagent-spawn-in-process']
let sdk, unavailable, sdkVersion
try {
  if (!process.env.DSH_ULTRA_TEST_SDK) unavailable = 'Set DSH_ULTRA_TEST_SDK to a complete pinned rc.2 runtime node_modules; never use a partial peer installation for this integration.'
  else {
    const supported = new Set(['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3'])
    sdkVersion = JSON.parse(readFileSync(path.resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai/dsh-agent/package.json'), 'utf8')).version
    assert.ok(supported.has(sdkVersion), 'native integration supports only the explicitly verified official releases')
    if (sdkVersion !== '0.2.0-rc.2') names.push('dsh-fs-local', 'dsh-working-directory')
    for (const name of names.filter(name => name.startsWith('dsh-'))) {
      const manifest = JSON.parse(readFileSync(path.resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai', name, 'package.json'), 'utf8'))
      assert.equal(manifest.version, sdkVersion, `native integration requires every DSH package at the same pinned release: ${name}`)
    }
    sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(path.resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai', name, 'lib', 'index.js')).href)])))
  }
} catch (failure) { throw new Error('Explicit DSH_ULTRA_TEST_SDK is incomplete or incompatible', { cause: failure }) }

const compiled = ts.transpileModule(readFileSync(new URL('../src/collaboration-host.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText
const pure = sdk ? { pool: await import('../lib/model-pool.js'), team: await import('../lib/collaboration.js'), audit: await import('../lib/model-pool-audit.js') } : undefined
const candidate = (changes = {}) => ({ id: 'alpha-review', name: '审查', enabled: true, provider: 'pool-alpha', model: 'same-name',
  strengths: '边界审查', suitableFor: '审查', avoidFor: '未知输入', isDefault: true, maxConcurrent: 1,
  allowCrossProvider: false, allowUnverifiedTools: true, ...changes })
const config = (changes = {}) => ({ models: [candidate(), candidate({ id: 'beta-write', name: '写作', provider: 'pool-beta', isDefault: false, allowCrossProvider: true })],
  fallback: 'error', maxConcurrent: 2, maxRequests: 0, failureLimit: 3, ...changes })
const textOf = messages => messages.flatMap(message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text)).join('\n')

async function fixture(t, { initial = config(), script, parentOptions, maxDepth = 1 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ultra-pool-sdk-'))
  const project = path.join(root, 'project'), logs = path.join(root, 'jsonl')
  await fs.mkdir(project)
  const ctx = new sdk.cordis.Context(), requests = [], created = [], parentHandles = [], toolExecutions = []
  let collaboration, active = 0, peak = 0, callSequence = 0, current = initial
  // No network-capable provider is registered. Every dispatched model request is asserted below.
  t.after(async () => {
    const failures = []
    for (const cleanup of [() => collaboration?.close(), ...parentHandles.toReversed().map(handle => () => handle.dispose()), () => ctx.fiber.dispose()]) {
      try { await cleanup() } catch (failure) { failures.push(failure) }
    }
    assert.equal(active, 0, 'every scripted stream must be settled before deleting its fixture')
    await fs.rm(root, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, 'Native SDK fixture cleanup failed')
  })
  ctx.baseUrl = pathToFileURL(root + path.sep).href
  for (const [name, options] of [
    ['cordis-plugin-loader'], ['dsh-llm'], ['dsh-session'], ['dsh-session-projection'],
    ['dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }], ['dsh-tools', { mode: 'native' }],
    ['dsh-agent'], ['dsh-agent-loop', { agents: [] }], ['dsh-session-persistence-jsonl', { root: logs, compression: 'none' }], ['dsh-session-query'],
    ['dsh-agent-preset-registry', { default: 'pool-offline' }], ['dsh-agent-preset', { id: 'pool-offline', plugins: [] }],
    ...(sdkVersion !== '0.2.0-rc.2' ? [['dsh-fs-local'], ['dsh-working-directory', { defaultDirectory: project }]] : []),
    ['dsh-subagent', { maxDepth, maxActiveSubagents: 2 }], ['dsh-subagent-spawn-in-process', { providerName: 'spawn' }],
  ]) await ctx.plugin(sdk[name].default ?? sdk[name], options).await()
  class Offline extends sdk['dsh-llm'].LlmAdapter {
    providerInfo(provider) { return { id: provider, name: 'Local model-pool test adapter' } }
    async listModels(provider) { return [{ provider, id: 'same-name', name: 'Same display name', inputModalities: ['text'] }] }
    async resolveModel(provider, model) {
      assert.ok(['pool-alpha', 'pool-beta'].includes(provider), 'no external provider route is allowed')
      assert.ok(['same-name', 'parent-model'].includes(model), 'only synthetic fixture models may resolve')
      return { provider, id: model, name: 'Local synthetic model', inputModalities: ['text'], context: { contextWindow: 32768 },
        ...(provider === 'pool-alpha' ? { defaultMaxTokens: 96, reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }
          : { reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }) }
    }
    async *stream(options) {
      assert.ok(['pool-alpha', 'pool-beta'].includes(options.provider))
      active++; peak = Math.max(peak, active)
      assert.ok(active <= 2, 'local adapter streams obey the explicit double-concurrency ceiling')
      const lastUser = options.messages.findLastIndex(message => message.role === 'user')
      const turnResults = options.messages.slice(lastUser + 1).filter(message => message.role === 'tool')
      const request = { provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, maxTokens: options.maxTokens,
        sessionId: options.sessionId, tools: (options.tools ?? []).map(tool => tool.name), text: textOf(options.messages), toolResults: textOf(turnResults) }
      requests.push(request)
      assert.ok(requests.length <= 20, 'a regression must not dispatch unbounded local calls')
      try {
        const childRequest = String(request.sessionId).startsWith('ultra-child-')
        const action = childRequest ? script?.(request, requests.filter(item => String(item.sessionId).startsWith('ultra-child-')).length) : undefined
        if (action && typeof action.then === 'function') {
          let abort
          const cancelled = new Promise((_resolve, reject) => { abort = () => reject(options.signal.reason ?? new Error('Cancelled local gate')); if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true }) })
          try { await Promise.race([action, cancelled]) } finally { options.signal?.removeEventListener('abort', abort) }
        }
        if (action === 'hang') {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'Local cancellation sentinel.' }
          await new Promise((resolve, reject) => {
            if (options.signal?.aborted) { reject(options.signal.reason); return }
            options.signal?.addEventListener('abort', () => reject(options.signal.reason ?? new Error('Cancelled local fixture')), { once: true })
          })
          return
        }
        const read = childRequest && turnResults.length === 0
        if (read) {
          assert.ok(request.tools.includes('fixture_read'), 'configured children must receive their inherited permitted tool schema')
          const id = sdk['dsh-llm'].ToolCallId('pool-read-' + randomUUID())
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id, name: 'fixture_read', argumentsDelta: '{}' }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'fixture_read', arguments: '{}' } }
        } else {
          if (childRequest) assert.ok(request.toolResults.includes('LOCAL_TOOL_RESULT_' + request.sessionId), 'subsequent native request must contain the actual result from this child tool')
          const text = `Offline completed ${options.provider}/${options.model}`
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        }
        yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }
        yield { type: 'finish', reason: { kind: read ? 'tool-calls' : 'stop' } }
      } finally { active-- }
    }
  }
  ctx.llm.registerAdapter(['pool-alpha', 'pool-beta'], new Offline())
  const { defineContentToolFixture } = sdk['dsh-tools']
  for (const name of ['fixture_read', 'fixture_write']) ctx.tools.register(defineContentToolFixture({ name, description: 'Local permission sentinel; no filesystem operation', parameters: {},
    async execute(_args, exec) { toolExecutions.push({ name, sessionId: exec.agent.id }); return [{ type: 'text', text: 'LOCAL_TOOL_RESULT_' + exec.agent.id }] } }))
  // Native delegation captures these existing boundaries into the child's log.
  ctx.provide('sandboxPolicy', { overrideOf: () => 'read-only' })
  ctx.provide('approval', { effectivePolicy: () => 'ask' })
  const parent = await ctx.agents.create({ sessionId: 'pool-sdk-parent-' + randomUUID(), meta: { cwd: project, agentPreset: 'pool-offline' },
    agentOptions: { provider: 'pool-alpha', model: 'parent-model', reasoningEffort: 'high', maxTokens: 9999, ...parentOptions },
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'pool-offline'); agentCtx.tools.restrict({ deny: ['fixture_write'] }) } })
  parentHandles.push(parent)
  parent.agent.ctx.tools.register(defineContentToolFixture({ name: 'parent_only_probe', description: 'Parent-local capability excluded from native inherited allowlist', parameters: {}, async execute() { assert.fail('Parent-local tool must never execute in a child') } }))
  const exports = {}
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name === 'node:crypto') return { randomUUID }
    if (name === './model-pool.js') return pure.pool
    if (name === './collaboration.js') return pure.team
    if (name === './model-pool-audit.js') return pure.audit
    if (name.startsWith('@deepseek-ai/')) return sdk[name.slice('@deepseek-ai/'.length)] ?? assert.fail(`Unloaded SDK import: ${name}`)
    return assert.fail(`Unmocked collaboration import: ${name}`)
  }, AbortController, AbortSignal, Error, AggregateError, Promise, Map, Set, WeakMap, JSON, structuredClone, queueMicrotask, setTimeout, clearTimeout })
  const source = { get: () => current }
  collaboration = exports.installCollaboration(parent.agent, { collaborationEnabled: true, collaborationProvider: 'spawn', collaborationMaxAgents: 8, collaborationModelPool: source })
  ctx.on('agent/created', ({ agent }) => {
    if (!agent.id.startsWith('ultra-child-')) return
    created.push({ id: agent.id, depth: agent.session.header.delegationDepth,
      model: collaboration.records().find(record => record.id === agent.id)?.model,
      tools: ctx.tools.schemas(agent).map(tool => tool.name), options: { ...agent.options } })
  })
  const execute = (agent, name, args, signal = new AbortController().signal) => ctx.agents.withInitiator(agent, async () => {
    const result = await ctx.tools.execute({ agent, name, arguments: args, signal, callId: sdk['dsh-llm'].ToolCallId('pool-direct-' + ++callSequence) })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (result.isError) throw new Error(text)
    return JSON.parse(text)
  })
  const spawn = (name, modelId, agent = parent.agent) => execute(agent, 'ultra_spawn_agent', { task_name: name, message: 'Inspect a local synthetic fixture without executing any operation.',
    ...(modelId ? { model_config_id: modelId, model_reason: 'This fixture needs the selected configured capability.' } : {}) })
  const wait = async (id, afterCursor) => {
    const result = await execute(parent.agent, 'ultra_wait_agent', { targets: [id], timeout_ms: 3000, ...(afterCursor ? { after_cursor: afterCursor } : {}) })
    assert.equal(result.timedOut, false, `native local child ${id} did not reach a terminal state`)
    return result
  }
  const childRequests = () => requests.filter(request => String(request.sessionId).startsWith('ultra-child-'))
  return { ctx, parent: parent.agent, requests, childRequests, toolExecutions, created, collaboration, source, spawn, wait, execute, project, logs,
    update(value) { current = value }, peak: () => peak,
    async waitRequests(count) { const until = Date.now() + 3000; while (childRequests().length < count && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 2)); assert.ok(childRequests().length >= count, 'local request was never dispatched') },
    async persisted(id) {
      await ctx.sessions.flush(parent.agent.session)
      const handle = await ctx.sessionPersistence.open(parent.agent.id, 'read')
      try {
        const events = (await handle.read()).events
        assert.ok(events.every(event => event.type !== 'ultra/collaboration-model'), 'extension records must not make pinned native JSONL unreadable')
        assert.ok(events.some(event => event.type === 'subagent/catalog'), 'native child catalog remains readable from real JSONL')
      } finally { await handle.close() }
      return (await pure.audit.readCollaborationAudit(parent.agent)).filter(record => record.id === id).at(-1)
    },
  }
}

test('native SDK routes same-name models by configured provider/id and records actual request parameters', { skip: unavailable, timeout: 15000 }, async t => {
  const f = await fixture(t, { initial: config({ models: [candidate({ reasoningEffort: 'high', maxTokens: 321 }), candidate({ id: 'beta-write', provider: 'pool-beta', isDefault: false, allowCrossProvider: true, reasoningEffort: 'low', maxTokens: 654 })] }) })
  const a = await f.spawn('review route', 'alpha-review'); const wa = await f.wait(a.id)
  const b = await f.spawn('write route', 'beta-write'); const wb = await f.wait(b.id)
  assert.deepEqual(f.childRequests().map(request => [request.provider, request.model, request.reasoningEffort, request.maxTokens]), [
    ['pool-alpha', 'same-name', 'high', 321], ['pool-alpha', 'same-name', 'high', 321], ['pool-beta', 'same-name', 'low', 654], ['pool-beta', 'same-name', 'low', 654],
  ])
  assert.equal(wa.agents[0].status, 'completed'); assert.equal(wb.agents[0].status, 'completed')
  assert.ok(f.created.every(child => child.model.requestStatus === 'pending'), 'native creation is observed before any assembled model request')
  const record = f.collaboration.records().find(item => item.id === b.id)
  assert.equal(record.model.requestStatus, 'observed')
  assert.deepEqual(record.model.actual, { provider: 'pool-beta', model: 'same-name', reasoningEffort: 'low', maxTokens: 654, stage: 'native-request' })
  assert.equal(record.usage.requests, 2); assert.equal(record.usage.knownTokens, 10); assert.equal(record.usage.unknownCalls, 0)
  for (const id of [a.id, b.id]) {
    const observed = f.collaboration.records().find(item => item.id === id)
    assert.equal(observed.model.compatibility.tools, 'observed-native-tool-result', 'local result observation must be recorded separately from user capability declarations')
    assert.deepEqual(observed.model.toolCalls, { succeeded: 1, failed: 0 })
  }
  assert.deepEqual(f.toolExecutions.map(item => [item.name, item.sessionId]), [['fixture_read', a.id], ['fixture_read', b.id]])
  assert.ok(f.requests.filter(item => item.sessionId === f.parent.id).every(item => item.provider === 'pool-alpha' && item.model === 'parent-model' && item.reasoningEffort === 'high' && item.maxTokens === 9999), 'native parent completion notices retain the parent route')
  const restored = await f.persisted(b.id)
  assert.equal(restored.status, 'completed', 'project evidence audit must recover the final child state while native JSONL remains readable')
  assert.equal(restored.model.compatibility.tools, 'observed-native-tool-result')
  assert.deepEqual(restored.model.toolCalls, { succeeded: 1, failed: 0 })
  assert.ok(f.peak() <= 2)
})

test('native SDK clears parent effort and output cap when the selected target declares no defaults', { skip: unavailable, timeout: 15000 }, async t => {
  const f = await fixture(t)
  const child = await f.spawn('target defaults', 'beta-write'); await f.wait(child.id)
  const request = f.childRequests()[0]
  assert.equal(request.provider, 'pool-beta'); assert.equal(request.reasoningEffort, undefined); assert.equal(request.maxTokens, undefined)
  assert.equal(f.parent.options.reasoningEffort, 'high'); assert.equal(f.parent.options.maxTokens, 9999)
})

test('native SDK cold-evicted child followup keeps target defaults clear instead of restoring parent effort or cap', { skip: unavailable, timeout: 15000 }, async t => {
  const f = await fixture(t)
  const child = await f.spawn('cold target defaults', 'beta-write'); const first = await f.wait(child.id)
  const original = f.ctx.agents.get(child.id)
  assert.ok(original)
  await f.ctx.sessions.flush(original.session)
  await f.ctx.agents.withInitiator(f.parent, () => sdkVersion !== '0.2.0-rc.2' ? f.ctx.subagents.drainChildren(f.parent, [child.id]) : f.ctx.subagents.drainContinuableChildren(f.parent, [child.id]))
  assert.equal(f.ctx.agents.get(child.id), undefined, 'native activation and Agent must actually be absent before testing cold reconstruction')
  await f.execute(f.parent, 'ultra_followup_task', { target: child.id, message: 'Resume the same child after native eviction and perform another permitted local read.' })
  const resumed = await f.wait(child.id, first.cursor)
  assert.equal(resumed.agents[0].status, 'completed')
  assert.ok(f.ctx.agents.get(child.id))
  assert.notEqual(f.ctx.agents.get(child.id), original, 'the followup must use a newly reconstructed Agent, not the original in-memory object')
  assert.equal(f.created.filter(item => item.id === child.id).length, 2)
  assert.ok(f.created.filter(item => item.id === child.id).every(item => !item.tools.includes('fixture_write') && !item.tools.includes('parent_only_probe')), 'cold restoration must preserve the original inherited tool boundary')
  const requests = f.childRequests().filter(request => request.sessionId === child.id)
  assert.equal(requests.length, 4, 'both original and cold-resumed turns perform a real tool call and a subsequent request with its result')
  for (const request of requests) {
    assert.equal(request.tools.includes('fixture_write'), false, 'cold native requests cannot regain forbidden write tools')
    assert.equal(request.provider, 'pool-beta'); assert.equal(request.model, 'same-name')
    assert.equal(request.reasoningEffort, undefined); assert.equal(request.maxTokens, undefined)
  }
  assert.equal(f.parent.options.reasoningEffort, 'high'); assert.equal(f.parent.options.maxTokens, 9999)
})

test('native SDK fixed user selection wins and new configuration does not mutate an existing child followup', { skip: unavailable, timeout: 15000 }, async t => {
  const gate = Promise.withResolvers()
  const f = await fixture(t, { initial: config({ explicitModelId: 'alpha-review' }), script: (_request, count) => count === 1 ? gate.promise : undefined })
  const child = await f.spawn('fixed user choice', 'beta-write'); await f.waitRequests(1)
  assert.equal(f.childRequests()[0].provider, 'pool-alpha')
  assert.equal(f.collaboration.records().find(item => item.id === child.id).model.source, 'user')
  assert.equal(f.ctx.agents.get(child.id).status, 'running')
  f.update(config({ explicitModelId: 'beta-write', models: [candidate({ provider: 'pool-beta', allowCrossProvider: true }), candidate({ id: 'beta-write', provider: 'pool-beta', isDefault: false, allowCrossProvider: true })] }))
  gate.resolve(); const first = await f.wait(child.id)
  await f.execute(f.parent, 'ultra_followup_task', { target: child.id, message: 'Continue the original synthetic task without changing its model snapshot.' })
  await f.wait(child.id, first.cursor)
  assert.ok(f.childRequests().filter(request => request.sessionId === child.id).every(request => request.provider === 'pool-alpha'), 'followup uses the original instance route')
  const next = await f.spawn('new child snapshot', 'alpha-review'); await f.wait(next.id)
  assert.ok(f.childRequests().filter(request => request.sessionId === next.id).every(request => request.provider === 'pool-beta'), 'new child uses the newly fixed user choice')
})

test('native SDK preserves tool denial/depth and records delegated approval/sandbox metadata', { skip: unavailable, timeout: 15000 }, async t => {
  const f = await fixture(t)
  const child = await f.spawn('permission boundary', 'alpha-review'); await f.wait(child.id)
  const created = f.created.find(item => item.id === child.id)
  assert.equal(created.depth, 1)
  assert.equal(created.tools.includes('fixture_write'), false)
  assert.equal(created.tools.includes('fixture_read'), true)
  assert.equal(created.tools.includes('parent_only_probe'), false)
  assert.equal(f.childRequests()[0].tools.includes('fixture_write'), false)
  assert.equal(f.childRequests()[0].tools.includes('run_code'), false)
  const live = f.ctx.agents.get(child.id)
  assert.ok(live, 'continuable child remains owned for native followup')
  assert.equal((await f.ctx.tools.execute({ agent: live, name: 'fixture_write', arguments: {}, signal: new AbortController().signal })).isError, true)
  assert.ok(live.session.snapshotEvents().some(event => event.type === 'sandbox/mode' && event.data.mode === 'read-only' && event.data.source === 'delegation'))
  assert.ok(live.session.snapshotEvents().some(event => event.type === 'approval/policy' && event.data.policy === 'never' && event.data.source === 'delegation'))
  await assert.rejects(f.spawn('forbidden deeper child', 'alpha-review', live), /depth|maxDepth|深度/)
  assert.equal(f.childRequests().length, 2, 'rejected delegation never enters an adapter; the permitted child used one tool and then finalized')
})

test('native SDK cancellation and completion release the candidate slot without exceeding double concurrency', { skip: unavailable, timeout: 15000 }, async t => {
  const f = await fixture(t, { initial: config({ maxConcurrent: 1 }), script: (_request, count) => count === 1 ? 'hang' : undefined })
  const child = await f.spawn('cancelled child', 'alpha-review'); await f.waitRequests(1)
  await assert.rejects(f.spawn('capacity rejected', 'beta-write'), /并发|额度|capacity/i)
  await f.execute(f.parent, 'ultra_interrupt_agent', { target: child.id })
  const ended = await f.wait(child.id)
  assert.equal(ended.agents[0].status, 'cancelled')
  const next = await f.spawn('released after cancel', 'alpha-review'); await f.wait(next.id)
  const third = await f.spawn('released after completion', 'alpha-review'); await f.wait(third.id)
  assert.equal(f.childRequests().length, 5)
  assert.ok(f.peak() <= 2)
})

test('native SDK collaboration without a pool retains inherited model parameters and real tool execution', { skip: unavailable, timeout: 15000 }, async t => {
  const f = await fixture(t, { initial: config({ models: [] }) })
  const child = await f.spawn('legacy inherited delegation'); const ended = await f.wait(child.id)
  assert.equal(ended.agents[0].status, 'completed')
  assert.equal(f.childRequests().length, 2)
  assert.ok(f.childRequests().every(request => request.provider === 'pool-alpha' && request.model === 'parent-model' && request.reasoningEffort === 'high' && request.maxTokens === 9999))
  assert.deepEqual(f.toolExecutions.map(item => [item.name, item.sessionId]), [['fixture_read', child.id]])
  assert.equal(f.created.find(item => item.id === child.id).tools.includes('fixture_write'), false)
})
