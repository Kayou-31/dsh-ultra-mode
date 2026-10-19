/** Native Loader fixture. Scripted adapters establish wiring, never model intelligence. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createLiveChallenges, judgeLivePhase } from './model-pool-live-driver.mjs'

export const name = 'dsh-companion-decision-offline-acceptance'
export const inject = ['agents', 'agentLoop', 'tools', 'llm', 'sessions', 'sessionPersistence', 'systemPrompt', 'agentPresets', 'commands', 'settings', 'configEditor', 'loader', 'subagents']
const textOf = messages => messages.flatMap(message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text)).join('\n')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const teamTools = ['ultra_spawn_agent', 'ultra_send_message', 'ultra_followup_task', 'ultra_wait_agent', 'ultra_interrupt_agent', 'ultra_list_agents']
/** Grading metadata is never a persisted native model-pool candidate field. */
export function companionPoolConfig(routes, explicitModelId) {
  return { models: routes.map(({ kind, ...route }) => ({ ...route, name: kind, enabled: true, strengths: kind, suitableFor: 'offline native acceptance', avoidFor: 'production', isDefault: kind === 'review', maxConcurrent: 1, allowCrossProvider: true, allowUnverifiedTools: true })), explicitModelId, fallback: 'error', maxConcurrent: 2, maxRequests: 24, failureLimit: 2 }
}
/** Native prompt catalogs intentionally expose selectable IDs rather than routes. */
export function hasNativeTeamCatalog(request, expectedIds) {
  if (!teamTools.every(name => request.tools.includes(name))) return false
  return request.text.split(/\r?\n/u).some(line => {
    let value; try { value = JSON.parse(line) } catch { return false }
    return Array.isArray(value?.models) && expectedIds.every(id => value.models.some(model => model.id === id))
  })
}
/** The older reusable judge calls this field requestedId; current Team uses requestedConfigId. */
export function modelPoolJudgeRecords(records) {
  return records.map(record => ({ ...record, model: record.model ? { ...record.model, requestedId: record.model.requestedConfigId } : undefined }))
}
function nativeToolJson(messages, name) {
  const calls = new Set(messages.flatMap(message => message.role === 'assistant' ? (message.content ?? []).filter(block => block.type === 'tool-call' && block.name === name).map(block => block.id) : []))
  const message = messages.findLast(message => message.role === 'tool' && calls.has(message.toolCallId))
  if (!message || message.isError) return undefined
  return JSON.parse(textOf([message]))
}
/** Shared by the script adapter and the native SDK protocol preflight. */
export function companionTeamStep(messages, plan, challenge) {
  const teamCalls = new Set(messages.flatMap(message => message.role === 'assistant' ? (message.content ?? []).filter(block => block.type === 'tool-call' && teamTools.includes(block.name)).map(block => block.id) : []))
  const failed = messages.findLast(message => message.role === 'tool' && message.isError && teamCalls.has(message.toolCallId))
  if (failed) throw new Error('Native Team tool failed: ' + textOf([failed]))
  const spawn = nativeToolJson(messages, 'ultra_spawn_agent')
  if (!spawn) return { toolName: 'ultra_spawn_agent', args: { task_name: plan.cancel ? 'cancel-native-child' : plan.kind + '-native-child', message: plan.cancel ? 'COMPANION_CANCEL_CHILD: remain in this bounded cancellation fixture.' : 'COMPANION_CHILD ' + plan.kind + ': call fixture_read id=' + challenge.id + ' and independently return JSON fixtureId, nonce and computed answer. Read only; no network or writes.', model_config_id: plan.kind, model_reason: 'Synthetic ' + plan.kind + ' task fits the saved candidate capability.' } }
  if (plan.cancel && !nativeToolJson(messages, 'ultra_interrupt_agent')) return { toolName: 'ultra_interrupt_agent', args: { target: spawn.id }, childId: spawn.id }
  const waited = nativeToolJson(messages, 'ultra_wait_agent'), child = waited?.agents?.find(agent => agent.id === spawn.id)
  if (!child || !['completed', 'cancelled', 'failed'].includes(child.status)) return { toolName: 'ultra_wait_agent', args: { targets: [spawn.id], timeout_ms: 5000 }, childId: spawn.id }
  if (plan.cancel) { assert.equal(child.status, 'cancelled'); return { text: 'Native child cancellation observed.', childId: spawn.id, status: child.status } }
  assert.equal(child.status, 'completed'); return { text: child.text, childId: spawn.id, status: child.status }
}
function nativeReceipts(events, sessionId) {
  const calls = new Map(), receipts = []
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name === 'fixture_read') calls.set(event.data.callId, event)
    if (event.type !== 'tool/result') continue
    const message = event.data.message, call = calls.get(message.toolCallId)
    if (!call || message.isError || message.source?.kind !== 'tool' || message.source.callId !== message.toolCallId || event.seq <= call.seq) continue
    const args = typeof call.data.arguments === 'string' ? JSON.parse(call.data.arguments) : call.data.arguments, value = JSON.parse(textOf([message]))
    receipts.push({ sessionId, id: args.id, nonce: value.nonce, callId: message.toolCallId, callSeq: call.seq, resultSeq: event.seq })
  }
  return receipts
}
export function auditAssistRequests({ requests, rootId, mainProvider, mainModel, allowedSidecarTools }) {
  const main = requests.filter(row => row.sessionId === rootId), sidecars = requests.filter(row => row.stage === 'assist-decision')
  if (!main.length || main.some(row => row.provider !== mainProvider || row.model !== mainModel || row.reasoningEffort !== 'medium' || !row.tools.includes('write'))) return { passed: false, reason: 'main-route-or-permissions-changed' }
  if (!sidecars.length || new Set(sidecars.map(row => row.sessionId)).size !== 1 || sidecars.some(row => row.sessionId === rootId || row.reasoningEffort !== 'max' || row.tools.some(name => !allowedSidecarTools.includes(name)))) return { passed: false, reason: 'sidecar-not-one-readonly-identity' }
  if (requests.some(row => row.sessionId !== rootId && !sidecars.includes(row))) return { passed: false, reason: 'unintended-extra-route' }
  return { passed: true, sidecarId: sidecars[0].sessionId, sidecarRequests: sidecars.length }
}
export function apply(ctx, config) {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  if (!ready || !exit) throw new Error('Companion fixture requires native CLI readiness/exit')
  let disposed = false
  const off = ready.onReady(() => {
    if (disposed) return
    run(ctx, config).then(() => exit(0), async error => {
      const phase = JSON.parse(await fs.readFile(config.phaseFile, 'utf8')); let partial = {}
      try { partial = JSON.parse(await fs.readFile(phase.resultFile, 'utf8')) } catch {}
      await fs.writeFile(phase.resultFile, JSON.stringify({ ...partial, status: 'failed', error: String(error), stack: error.stack }, null, 2))
      console.error('COMPANION_DECISION_ACCEPTANCE_FAILED', error); exit(1)
    })
  })
  ctx.effect(() => () => { disposed = true; off() }, 'companionDecisionAcceptance.ready')
}
async function run(ctx, config) {
  const phase = JSON.parse(await fs.readFile(config.phaseFile, 'utf8')), started = Date.now(), requireRuntime = createRequire(path.join(config.runtimeRoot, 'package.json'))
  const sdk = async name => import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/' + name)).href)
  const [{ LlmAdapter, createUserMessage, ToolCallId }, { defineContentToolFixture }] = await Promise.all([sdk('dsh-llm'), sdk('dsh-tools')])
  const result = { status: 'running', phase: phase.mode, host: 'actual DSH 0.2.1-rc.2 CLI Loader + Settings/ConfigEditor + AgentLoop + ToolRuntime + JSONL', model: 'offline scripted adapters; does not establish model intelligence, provider availability, quality or paid usage', requests: [], toolExecutions: [], checks: [], phaseProofs: [] }
  const check = (name, condition, details = {}) => { assert.ok(condition, name + ': ' + JSON.stringify(details)); result.checks.push({ name, passed: true, details }) }
  const entry = [...ctx.loader.entries()].find(row => row.options.name === '@dsh-external/dsh-ultra-decision')
  check('standalone exact Decision bundle has an active native Loader fiber', !!entry?.fiber)
  check('standalone profile does not mount the full Ultra bundle', ![...ctx.loader.entries()].some(row => row.options.name === '@dsh-external/dsh-ultra-mode'))
  const fiber = entry.fiber, source = fiber.config.collaborationModelPool
  check('Decision defaults to disabled assist and native volatile model pool', fiber.config.decisionAssistEnabled === false && typeof source?.get === 'function')
  const challenges = createLiveChallenges(), plans = new Map(), handles = [], snapshotRelease = deferred(), nativeSessions = new Map()
  // The ordinary owner drains native child agents after its turn ends. Retain
  // the actual Session objects for the fixture audit, never a reconstructed log.
  const releaseSessions = ctx.on('session/event', session => { nativeSessions.set(session.id, session) })
  let snapshotReleased = false, callCounter = 0
  const routes = { code: { id: 'code', kind: 'code', provider: 'companion-code', model: 'scripted-code', reasoningEffort: 'high', maxTokens: 256 }, review: { id: 'review', kind: 'review', provider: 'companion-review', model: 'scripted-review', reasoningEffort: 'low', maxTokens: 384 } }
  const pool = explicitModelId => companionPoolConfig(Object.values(routes), explicitModelId)
  const call = (name, args) => ({ type: 'tool-call', id: ToolCallId('companion-call-' + ++callCounter), name, arguments: JSON.stringify(args) })
  const waitUntil = async (predicate, name, timeoutMs = 5000) => { const deadline = Date.now() + timeoutMs; while (!predicate() && Date.now() < deadline) await sleep(5); assert.ok(predicate(), name) }
  class Offline extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: 'Offline companion fixture' } }
    async listModels(provider) { return [{ provider, id: provider === 'companion-main' ? 'scripted-main' : provider === 'companion-code' ? 'scripted-code' : 'scripted-review', name: provider, inputModalities: ['text'] }] }
    async resolveModel(provider, model) { return { provider, id: model, name: 'Offline synthetic model', inputModalities: ['text'], context: { contextWindow: 1000000 }, reasoning: { efforts: ['low', 'medium', 'high', 'max'].map(id => ({ id, name: id })), defaultEffort: 'medium' } } }
    async *stream(options) {
      options.signal?.throwIfAborted()
      const text = textOf(options.messages), sequence = result.requests.length + 1
      assert.ok(sequence <= 40, 'Finite local adapter request budget')
      const fixture = nativeToolJson(options.messages, 'fixture_read')
      const row = { sequence, sessionId: options.sessionId, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, maxTokens: options.maxTokens, tools: (options.tools ?? []).map(tool => tool.name), toolResultNonces: options.messages.filter(message => message.role === 'tool' && !message.isError).flatMap(message => { try { return [JSON.parse(textOf([message])).nonce].filter(Boolean) } catch { return [] } }), text }
      result.requests.push(row); let content
      if (text.includes('自动决策辅助旁路') || text.includes('只修复响应格式')) {
        row.stage = 'assist-decision'
        content = fixture ? [{ type: 'text', text: JSON.stringify({ assessment: 'The native read-only fixture was checked; no additional authorization or route is required.', directives: [] }) }] : [call('fixture_read', { id: 'assist' })]
      } else if (String(options.sessionId).startsWith('ultra-child-')) {
        if (text.includes('COMPANION_CANCEL_CHILD')) {
          row.stage = 'cancel-child'
          await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 10000); const abort = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(options.signal.reason ?? new Error('Cancelled synthetic child')) }; if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true }) })
          options.signal?.throwIfAborted(); throw new Error('Cancellation sentinel unexpectedly timed out')
        }
        const kind = text.includes('COMPANION_CHILD code') ? 'code' : 'review', challenge = challenges[kind]
        row.stage = 'ordinary-child'; row.kind = kind
        if (kind === 'code' && !fixture && !snapshotReleased) { await snapshotRelease.promise; options.signal?.throwIfAborted() }
        if (!fixture) content = [call('fixture_read', { id: challenge.id })]
        else {
          const answer = kind === 'code' ? fixture.values.filter(value => value % 2 === 0).reduce((sum, value) => sum + value * value, 0) : fixture.values.length
          content = [{ type: 'text', text: JSON.stringify({ fixtureId: fixture.fixtureId, nonce: fixture.nonce, answer }) }]
        }
      } else if (plans.has(options.sessionId)) {
        const plan = plans.get(options.sessionId), step = companionTeamStep(options.messages, plan, challenges[plan.kind])
        row.stage = plan.cancel ? 'cancel-parent' : 'ordinary-parent'
        if (step.toolName === 'ultra_spawn_agent') {
          check('main assembled request exposes the actual six Team tools and candidate catalog', hasNativeTeamCatalog(row, ['code', 'review']))
        } else if (step.toolName === 'ultra_interrupt_agent') {
          await waitUntil(() => result.requests.some(request => request.sessionId === step.childId && request.stage === 'cancel-child'), 'Cancellation waits for actual native model work')
        }
        content = step.toolName ? [call(step.toolName, step.args)] : [{ type: 'text', text: step.text }]
      } else if (text.includes('COMPANION_ASSIST_MAIN')) {
        row.stage = 'assist-main'; await sleep(100); options.signal?.throwIfAborted()
        content = nativeToolJson(options.messages, 'write') ? [{ type: 'text', text: 'Main retained its original model, permissions and delivery.' }] : [call('write', {})]
      } else {
        row.stage = 'ordinary-off'
        content = fixture ? [{ type: 'text', text: 'Native local fixture read completed.' }] : [call('fixture_read', { id: phase.mode === 'resume' ? 'resume' : 'off' })]
      }
      for (const [index, block] of content.entries()) { yield { type: 'block-start', index, blockType: block.type }; if (block.type === 'text') yield { type: 'text-delta', index, text: block.text }; else yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments }; yield { type: 'block-end', index, block } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: content.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' } }
    }
  }
  const releaseAdapter = ctx.llm.registerAdapter(['companion-main', 'companion-code', 'companion-review'], new Offline())
  const releaseRead = ctx.tools.register(defineContentToolFixture({ name: 'fixture_read', description: 'Read only deterministic isolated acceptance data by ID; no filesystem or network access', parameters: { id: { type: 'string', required: true } }, async execute(args, exec) {
    const challenge = Object.values(challenges).find(value => value.id === args.id), value = challenge ? JSON.parse(challenge.fixtureText) : { fixtureId: args.id, nonce: 'native-' + args.id + '-731', readOnly: true }
    result.toolExecutions.push({ name: 'fixture_read', sessionId: exec.agent.id, id: args.id, nonce: value.nonce, callId: exec.callId, isError: false }); return [{ type: 'text', text: JSON.stringify(value) }]
  } }))
  const releaseWrite = ctx.tools.register(defineContentToolFixture({ name: 'write', description: 'Main permission sentinel; returns a receipt and performs no filesystem change', parameters: {}, async execute(_args, exec) { result.toolExecutions.push({ name: 'write', sessionId: exec.agent.id, callId: exec.callId, isError: false }); return [{ type: 'text', text: '{"permissionSentinel":true}' }] } }))
  const createRoot = async suffix => { const handle = await ctx.agents.create({ sessionId: config.sessionId + '-' + phase.mode + suffix, meta: { cwd: config.projectDir, agentPreset: 'offline' }, agentOptions: { provider: 'companion-main', model: 'scripted-main', reasoningEffort: 'medium', maxTokens: 1024 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } }); handles.push(handle); return handle.agent }
  const turn = async (agent, text) => { const boundary = agent.session.seq; await ctx.agents.withInitiator(agent, async () => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent.whenIdle() }); const events = agent.session.snapshotEvents().filter(row => row.seq > boundary); check('native AgentLoop turn completed', events.findLast(row => row.type === 'turn/end')?.data.reason.kind === 'completed', { id: agent.id }); return events }
  const command = async (agent, text, success = true) => { const response = await ctx.commands.execute(agent, text, [], new AbortController().signal); check('native command boundary ' + text, success ? response?.result.kind === 'success' : response?.result.kind !== 'success'); return response }
  const savePool = async value => { await ctx.settings.update('ultra-decision', { collaborationModelPool: value }); check('Settings updates the live native volatile value without remounting', entry.fiber === fiber && fiber.config.collaborationModelPool === source); return source.get() }
  try {
    if (phase.mode === 'resume') {
      const saved = JSON.parse(await fs.readFile(config.stateFile, 'utf8')), current = source.get()
      check('both exact provider/model candidates and limits survive an actual CLI restart', current.models.length === 2 && current.models[0].provider === 'companion-code' && current.models[0].model === 'scripted-code' && current.models[1].provider === 'companion-review' && current.models[1].model === 'scripted-review' && current.maxConcurrent === 2 && current.maxRequests === 24 && current.failureLimit === 2)
      check('explicit return to automatic model selection is persisted', !current.explicitModelId && current.models[1].isDefault && !saved.expectedPool.explicitModelId)
      const root = await createRoot('-off'); result.rootId = root.id; await turn(root, 'COMPANION_COLD_RESUME: execute one existing local fixture read without enabling decision or team.')
      check('cold default remains off and dispatches only the original identity', result.requests.length === 2 && result.requests.every(row => row.sessionId === root.id))
    } else {
      const off = await createRoot('-off'); await turn(off, 'COMPANION_DEFAULT_OFF: read one native fixture and finish.')
      check('default companion adds no decision or multi route request', result.requests.length === 2 && result.requests.every(row => row.sessionId === off.id))
      check('Decision exposes no Ultra task tool', !ctx.tools.schemas(off).some(row => row.name === 'ultra_task'))
      for (const value of ['2', '3', '4', '5']) await command(off, '/decision ' + value, false)
      await command(off, '/ultra 2', false)
      await savePool(pool('code'))
      const codeRoot = await createRoot('-code'); plans.set(codeRoot.id, { kind: 'code' }); await command(codeRoot, '/team on')
      let codeFailure
      const codeTurn = turn(codeRoot, 'COMPANION_PARENT_CODE: delegate one read-only code task via the saved pool, then wait for its actual result.').catch(error => { codeFailure = error })
      await waitUntil(() => codeFailure || result.requests.some(row => row.kind === 'code'), 'First child actual native request starts before Settings update')
      if (codeFailure) throw codeFailure
      const oldSnapshot = source.get(), updated = pool('review'); updated.models[0].maxTokens = 512
      await savePool(updated); snapshotReleased = true; snapshotRelease.resolve()
      check('previous captured settings snapshot remains immutable', oldSnapshot.explicitModelId === 'code' && oldSnapshot.models[0].maxTokens === 256)
      await codeTurn
      if (codeFailure) throw codeFailure
      const reviewRoot = await createRoot('-review'); plans.set(reviewRoot.id, { kind: 'review' }); await command(reviewRoot, '/team on'); await turn(reviewRoot, 'COMPANION_PARENT_REVIEW: delegate one read-only review task via the saved pool, then wait for its actual result.')
      for (const [kind, root] of [['code', codeRoot], ['review', reviewRoot]]) {
        const events = root.session.snapshotEvents(), calls = new Map(events.filter(row => row.type === 'tool/call').map(row => [row.data.callId, row])), receipts = events.filter(row => row.type === 'tool/result' && !row.data.message.isError).map(row => ({ call: calls.get(row.data.message.toolCallId), value: JSON.parse(textOf([row.data.message])) })).filter(row => row.call)
        const spawns = receipts.filter(row => row.call.data.name === 'ultra_spawn_agent').map(row => { const args = typeof row.call.data.arguments === 'string' ? JSON.parse(row.call.data.arguments) : row.call.data.arguments; return { ...row.value, parentId: root.id, requestedModelId: args.model_config_id, reason: args.model_reason, isError: false } })
        const records = modelPoolJudgeRecords(receipts.filter(row => row.call.data.name === 'ultra_wait_agent').flatMap(row => row.value.agents ?? []))
        const children = spawns.map(row => nativeSessions.get(row.id)).filter(Boolean)
        const childAnswers = children.map(session => ({ sessionId: session.id, completed: session.snapshotEvents().findLast(row => row.type === 'turn/end')?.data.reason.kind === 'completed', text: textOf([session.snapshotEvents().findLast(row => row.type === 'assistant/message')?.data.message ?? {}]) }))
        const proof = { rootId: root.id, route: routes[kind], challenge: challenges[kind] }
        const judged = judgeLivePhase({ ...proof, requests: result.requests, spawns, records, toolCalls: result.toolExecutions.filter(row => row.name === 'fixture_read'), nativeToolReceipts: children.flatMap(session => nativeReceipts(session.snapshotEvents(), session.id)), childAnswers, publicText: textOf([events.findLast(row => row.type === 'assistant/message')?.data.message ?? {}]) })
        check('ordinary ' + kind + ' task has a complete native delegation/request/read/result chain', judged.passed, judged)
        result.phaseProofs.push({ ...proof, audit: judged })
      }
      check('two actually selected candidates retain distinct provider/model identities', new Set(result.phaseProofs.map(row => JSON.stringify([row.route.provider, row.route.model]))).size === 2)
      check('the first live child retained its earlier route snapshot after the Settings change', result.requests.filter(row => row.kind === 'code').every(row => row.maxTokens === 256 && row.provider === 'companion-code'))
      const auto = pool(''); auto.models[0].maxTokens = 512; await savePool(auto)
      const disk = await fs.readFile(ctx.get('profileContext').patchPath, 'utf8')
      check('ConfigEditor committed both qualified candidates and explicit automatic-selection reset', disk.includes('companion-code') && disk.includes('companion-review') && disk.includes('maxRequests: 24') && !source.get().explicitModelId)
      const assist = await createRoot('-assist'); await command(assist, '/decision assist'); const assistStart = result.requests.length
      await turn(assist, 'COMPANION_ASSIST_MAIN: retain the original main model and perform its permission sentinel; the decision sidecar may inspect only existing read-only fixtures.')
      await sleep(150)
      const assistRequests = result.requests.slice(assistStart), audit = auditAssistRequests({ requests: assistRequests, rootId: assist.id, mainProvider: 'companion-main', mainModel: 'scripted-main', allowedSidecarTools: ['fixture_read', 'ultra_memory_search', 'ultra_memory_get', 'ultra_submit_report'] })
      check('assist has one read-only sidecar while the original main retains model and permissions', audit.passed && result.toolExecutions.some(row => row.name === 'write' && row.sessionId === assist.id), audit)
      check('read-only sidecar actually invoked its permitted native read tool', result.toolExecutions.some(row => row.name === 'fixture_read' && row.sessionId === audit.sidecarId))
      result.assistAudit = audit
      await command(assist, '/decision off'); const offStart = result.requests.length; await turn(assist, 'COMPANION_AFTER_OFF: finish with the existing native read fixture.'); await sleep(100)
      check('off never adds a sidecar or execution route', result.requests.slice(offStart).every(row => row.sessionId === assist.id))
      const cancelled = await createRoot('-cancel'); plans.set(cancelled.id, { kind: 'review', cancel: true }); await command(cancelled, '/team on'); const cancellationStart = result.requests.length
      await turn(cancelled, 'COMPANION_CANCEL_PARENT: create one bounded native child, interrupt it, and wait for its actual terminal status.')
      const settled = result.requests.length; await sleep(150)
      check('native Team cancellation begins real child work and leaves no later model request', result.requests.slice(cancellationStart).some(row => row.stage === 'cancel-child') && result.requests.length === settled)
      const selectedChildren = result.phaseProofs.map(row => row.audit.sessionId), cancelledChildren = result.requests.filter(row => row.stage === 'cancel-child').map(row => row.sessionId)
      const allowedIdentities = new Set([off.id, codeRoot.id, reviewRoot.id, assist.id, cancelled.id, audit.sidecarId, ...selectedChildren, ...cancelledChildren])
      check('all native request identities belong to explicitly exercised roots, ordinary children or the single assist', new Set(cancelledChildren).size === 1 && result.requests.every(row => allowedIdentities.has(row.sessionId)))
      result.requestIdentities = [...allowedIdentities]
      await fs.writeFile(config.stateFile, JSON.stringify({ expectedPool: source.get(), roots: result.phaseProofs.map(row => row.rootId) }, null, 2))
    }
    const gate = ctx.get('ultraAcceptanceModelGate')?.snapshot()
    check('actual native global gate accounts every scripted request with maximum two active streams', gate?.activePeak <= 2 && gate.active === 0 && gate.admitted === result.requests.length && gate.synthetic === true && gate.admitted <= 40, gate)
    result.globalGate = gate; result.status = 'passed'
  } finally {
    snapshotReleased = true; snapshotRelease.resolve()
    const errors = []
    for (const cleanup of [...handles.toReversed().map(handle => () => handle.dispose()), releaseWrite, releaseRead, releaseAdapter, releaseSessions]) try { await cleanup() } catch (error) { errors.push(String(error)) }
    result.cleanupErrors = errors; result.elapsedMs = Date.now() - started
    await fs.writeFile(phase.resultFile, JSON.stringify(result, null, 2))
    if (errors.length) throw new Error('Companion fixture cleanup failed: ' + errors.join('; '))
  }
}
