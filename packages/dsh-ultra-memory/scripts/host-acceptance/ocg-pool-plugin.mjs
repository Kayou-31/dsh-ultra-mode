/** Real native-model acceptance only. No adapter, credential lookup or arbitrary tools. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { normalizeLiveConfig, createLiveChallenges, livePhasePrompt, judgeLivePhase } from './model-pool-live-driver.mjs'
import { hasNativeTeamCatalog, modelPoolJudgeRecords } from './companion-decision-plugin.mjs'

export const name = 'dsh-ocg-pool-real-acceptance'
export const inject = ['agents', 'agentLoop', 'tools', 'llm', 'sessions', 'sessionPersistence', 'systemPrompt', 'agentPresets', 'commands', 'settings', 'configEditor', 'loader', 'subagents']
const textOf = messages => messages.flatMap(message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text)).join('\n')
function json(text) { try { return JSON.parse(text) } catch { return undefined } }
export function ocgFailedTurnMetadata(events) {
  return events.filter(event => event.type === 'turn/end' && event.data?.reason?.kind === 'error').map(event => ({ seq: event.seq, kind: 'error', code: typeof event.data.reason.error?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/u.test(event.data.reason.error.code) ? event.data.reason.error.code : 'UNKNOWN' }))
}
export function recordOcgPoolChunk(row, chunk) {
  if (chunk.type === 'usage') {
    const usage = {}
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) if (Number.isFinite(chunk.usage?.[key]) && chunk.usage[key] >= 0) usage[key] = chunk.usage[key]
    row.usage = Object.keys(usage).length ? usage : null
  }
  if (chunk.type === 'finish') row.finish = { kind: typeof chunk.reason?.kind === 'string' ? chunk.reason.kind : 'unknown' }
}

/** Candidate capabilities are experiment declarations, not observed compatibility. */
export function createOcgPool(routes, limits, explicitModelId = '') {
  return { models: routes.map(({ kind, ...route }) => ({ ...route, name: kind === 'code' ? 'Implementation specialist' : 'Independent reviewer', enabled: true,
    strengths: kind === 'code' ? 'Code computation, precise integer arithmetic and implementation tasks' : 'Code review, boundary conditions, defect diagnosis and independent checking',
    suitableFor: kind === 'code' ? 'Implementing and computing a concrete code task' : 'Reviewing existing code for off-by-one errors',
    avoidFor: kind === 'code' ? 'Independent review when a review specialist is available' : 'Implementation and arithmetic when an implementation specialist is available',
    isDefault: kind === 'review', maxConcurrent: 1, allowCrossProvider: false, allowUnverifiedTools: true,
    costNote: 'Not measured in this synthetic acceptance', costSource: 'user', speedNote: 'Not measured before this run', speedSource: 'user',
  })), explicitModelId, fallback: 'error', maxConcurrent: limits.maxConcurrent, maxRequests: limits.maxRequests, failureLimit: 2 }
}

/** Whitelisted request metadata. Neither request bodies nor reasoning are exported. */
export function observeOcgPoolRequest(options, sequence) {
  const calls = new Set((options.messages ?? []).flatMap(message => message.role === 'assistant' ? (message.content ?? []).filter(block => block.type === 'tool-call' && block.name === 'fixture_read').map(block => block.id) : []))
  const toolResultNonces = (options.messages ?? []).filter(message => message.role === 'tool' && !message.isError && calls.has(message.toolCallId)).map(message => json(textOf([message]))?.nonce).filter(value => typeof value === 'string')
  return { sequence, sessionId: options.sessionId ?? null, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort ?? null, maxTokens: options.maxTokens ?? null,
    tools: (options.tools ?? []).map(tool => tool.name), toolResultNonces, startedAt: Date.now(), usage: null, finish: null }
}

/** Only host tool messages with an earlier matching call form native receipts. */
function pairedNativeToolReceipts(events) {
  const calls = new Map(), receipts = []
  for (const event of events) {
    if (event.type === 'tool/call' && typeof event.data?.callId === 'string' && event.data.callId
      && Number.isSafeInteger(event.seq) && event.seq >= 0) calls.set(event.data.callId, event)
    if (event.type !== 'tool/result') continue
    const message = event.data?.message, call = calls.get(message?.toolCallId)
    if (!call || message.role !== 'tool' || message.isError !== false || message.source?.kind !== 'tool'
      || message.source.callId !== message.toolCallId || !Number.isSafeInteger(event.seq) || event.seq <= call.seq) continue
    const value = json(textOf([message]))
    if (value) receipts.push({ call, event, value })
  }
  return receipts
}

/** Derive evidence from native Session events, never a model's account of its work. */
export function collectOcgPoolPhase({ rootId, rootEvents, children, route, expectedSelectedRoute, challenge, requests, toolCalls }) {
  const receipts = pairedNativeToolReceipts(rootEvents)
  const spawns = receipts.filter(row => row.call.data.name === 'ultra_spawn_agent').map(row => {
    const args = typeof row.call.data.arguments === 'string' ? json(row.call.data.arguments) : row.call.data.arguments
    return { ...row.value, parentId: rootId, requestedModelId: args?.model_config_id, reason: args?.model_reason, isError: false }
  })
  const records = modelPoolJudgeRecords(receipts.filter(row => ['ultra_wait_agent', 'ultra_list_agents'].includes(row.call.data.name)).flatMap(row => row.value.agents ?? []))
  const nativeToolReceipts = [], childAnswers = []
  for (const spawn of spawns) {
    const events = children.get(spawn.id) ?? []
    for (const { call, event, value } of pairedNativeToolReceipts(events)) {
      if (call.data.name !== 'fixture_read') continue
      const args = typeof call.data.arguments === 'string' ? json(call.data.arguments) : call.data.arguments
      nativeToolReceipts.push({ sessionId: spawn.id, id: args?.id, nonce: value.nonce, callId: call.data.callId, callSeq: call.seq, resultSeq: event.seq })
    }
    childAnswers.push({ sessionId: spawn.id, completed: events.findLast(row => row.type === 'turn/end')?.data.reason.kind === 'completed', text: textOf([events.findLast(row => row.type === 'assistant/message')?.data.message]) })
  }
  const publicText = textOf([rootEvents.findLast(row => row.type === 'assistant/message')?.data.message])
  const protocolDiagnostics = childAnswers.map(answer => { const parsed = json(answer.text); return { sessionId: answer.sessionId, publicAnswerIsSingleJsonObject: !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) } })
  const observation = { rootId, route, challenge, requests, spawns, records, toolCalls, nativeToolReceipts, childAnswers, publicText, protocolDiagnostics }
  // The shared judge's route.id denotes the requested ID; its remaining fields
  // denote expected actual identity/options. Preserve both original configs and
  // raw native records so explicit host precedence stays independently auditable.
  const judgeRoute = expectedSelectedRoute ? { ...expectedSelectedRoute, id: route.id } : route
  const audit = judgeLivePhase({ ...observation, route: judgeRoute })
  if (expectedSelectedRoute && !records.some(record => record.id === audit.sessionId && record.model?.selectedConfigId === expectedSelectedRoute.id && record.model?.source === 'user')) return { ...observation, expectedSelectedRoute, audit: { passed: false, reason: 'explicit-user-selection-not-observed' } }
  return { ...observation, ...(expectedSelectedRoute ? { expectedSelectedRoute } : {}), audit }
}

export function apply(ctx, config) {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  assert.ok(ready?.onReady && exit, 'OCG pool acceptance needs native CLI readiness/exit')
  let disposed = false
  const off = ready.onReady(() => {
    if (disposed) return
    run(ctx, config).then(() => exit(0), async error => {
      let partial = {}; try { partial = JSON.parse(await fs.readFile(config.resultFile, 'utf8')) } catch {}
      // Public diagnostic is deliberately allowlisted. Raw provider errors remain local CLI logs.
      await fs.writeFile(config.resultFile, JSON.stringify({ ...partial, status: 'failed', failure: { name: error?.name ?? 'Error', code: error?.code ?? null, message: error instanceof assert.AssertionError ? error.message : 'Native acceptance failed; inspect private CLI diagnostics' } }, null, 2))
      console.error('OCG_POOL_ACCEPTANCE_FAILED', error?.name ?? 'Error'); exit(1)
    })
  })
  ctx.effect(() => () => { disposed = true; off() }, 'ocgPoolAcceptance.ready')
}

async function run(ctx, config) {
  const input = JSON.parse((await fs.readFile(config.configFile, 'utf8')).replace(/^\uFEFF/u, ''))
  const cfg = normalizeLiveConfig({ ...input, runtimeRoot: config.runtimeRoot, ultraRoot: config.ultraRoot, resultFile: config.resultFile })
  assert.equal(cfg.provider, 'opencode-go', 'This experiment permits only the selected OCG subscription provider')
  assert.ok(cfg.routes.every(route => route.provider === cfg.provider), 'Cross-provider routing is outside this experiment')
  const presetId = input.presetId ?? 'ocg', bundleName = input.bundleName ?? '@dsh-external/dsh-ultra-mode', settingsId = input.settingsId ?? 'ultra-mode'
  const timeoutMs = input.timeoutMs ?? 600000
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 3600000, 'Invalid bounded test timeout')
  const started = Date.now(), handles = [], disposers = [], sessions = new Map(), challenges = createLiveChallenges(), explicitChallenge = createLiveChallenges().code
  const result = { status: 'running', host: 'Official DSH 0.2.1-rc.2 native Loader/AgentLoop/ToolRuntime/JSONL', adapter: 'real configured OCG adapter; no scripted model adapter', routeClassification: cfg.routeClassification,
    capabilityProvenance: 'Synthetic experiment candidate descriptions; native tool compatibility is checked separately', requests: [], toolCalls: [], checks: [], phaseProofs: [], privateReasoningExported: false }
  const check = (name, passed, details = {}) => { result.checks.push({ name, passed: !!passed, details }); assert.ok(passed, name) }
  const requireRuntime = createRequire(path.join(cfg.runtimeRoot, 'package.json')), sdk = name => import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/' + name)).href)
  const [{ createUserMessage, ToolCallId }, { defineContentToolFixture }] = await Promise.all([sdk('dsh-llm'), sdk('dsh-tools')])
  const entry = [...ctx.loader.entries()].find(row => row.options.name === bundleName)
  check('exact requested bundle has an active native Loader fiber', !!entry?.fiber)
  const source = entry.fiber.config.collaborationModelPool
  check('native volatile model-pool settings are available', typeof source?.get === 'function')
  const gate = ctx.get('ultraAcceptanceModelGate')
  check('finite external deployment-wide stream gate is installed', typeof gate?.snapshot === 'function')
  const initialGate = gate.snapshot()
  check('external gate has the exact finite experiment limits', initialGate.concurrency === cfg.maxConcurrent && initialGate.maxRequests === cfg.maxRequests && initialGate.synthetic === false)
  result.globalGate = { initial: initialGate }
  const expectedRoutes = new Set([{ provider: cfg.provider, model: cfg.model }, ...cfg.routes].map(row => JSON.stringify([row.provider, row.model])))
  let firstChildId, savedSnapshot, updatedPool, directCounter = 0
  const write = () => fs.writeFile(config.resultFile, JSON.stringify(result, null, 2))
  const save = async pool => { await ctx.settings.update(settingsId, { collaborationModelPool: pool }); assert.equal(entry.fiber.config.collaborationModelPool, source); return source.get() }
  const timer = setTimeout(() => { for (const handle of handles) handle.agent.cancel({ kind: 'hook', reason: 'OCG pool finite acceptance deadline' }) }, timeoutMs)
  try {
    disposers.push(ctx.on('session/event', session => { sessions.set(session.id, session) }))
    disposers.push(ctx.on('llm/stream', async function * (options, next) {
      assert.ok(expectedRoutes.has(JSON.stringify([options.provider, options.model])), 'Actual native request has an unauthorized provider/model identity')
      assert.ok(result.requests.length < cfg.maxRequests && Date.now() - started < timeoutMs, 'Finite OCG pool experiment budget exhausted')
      const row = observeOcgPoolRequest(options, result.requests.length + 1)
      row.hasTeamCatalog = hasNativeTeamCatalog({ tools: row.tools, text: textOf(options.messages ?? []) }, cfg.routes.map(route => route.id))
      result.requests.push(row)
      if (String(options.sessionId).startsWith('ultra-child-') && !firstChildId) {
        firstChildId = options.sessionId; savedSnapshot = source.get(); updatedPool = createOcgPool(cfg.routes, cfg)
        const route = cfg.routes.find(value => value.kind === 'code')
        updatedPool.models.find(value => value.id === route.id).maxTokens = route.maxTokens === 32768 ? 32767 : route.maxTokens + 1
        await save(updatedPool)
      }
      try {
        for await (const chunk of next()) {
          recordOcgPoolChunk(row, chunk)
          yield chunk
        }
      } finally { row.endedAt = Date.now(); row.elapsedMs = row.endedAt - row.startedAt }
    }, { prepend: true }))
    disposers.push(ctx.tools.register(defineContentToolFixture({ name: 'fixture_read', description: 'Read only a synthetic fixture by its exact ID; no filesystem, network or arbitrary paths.', parameters: { id: { type: 'string', required: true } }, async execute(args, exec) {
      const challenge = [...Object.values(challenges), explicitChallenge].find(value => value.id === args.id)
      assert.ok(challenge, 'Unknown synthetic fixture ID')
      result.toolCalls.push({ sessionId: exec.agent.id, id: args.id, nonce: challenge.nonce, callId: exec.callId, isError: false })
      return [{ type: 'text', text: challenge.fixtureText }]
    } })))
    const createRoot = async suffix => {
      const handle = await ctx.agents.create({ sessionId: (input.sessionId ?? 'ocg-pool-' + randomUUID()) + '-' + suffix, meta: { cwd: cfg.projectDir, agentPreset: presetId },
        agentOptions: { provider: cfg.provider, model: cfg.model, reasoningEffort: input.mainEffort ?? 'low', maxTokens: input.mainMaxTokens ?? 4096 }, setup: async scope => { await ctx.agentPresets.mount(scope, presetId) } })
      handles.push(handle); return handle.agent
    }
    const command = async (agent, text) => { const response = await ctx.commands.execute(agent, text, [], new AbortController().signal); check('native command accepted ' + text, response?.result.kind === 'success') }
    const turn = async (agent, text) => {
      await ctx.agents.withInitiator(agent, async () => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent.whenIdle() })
      result.failedTurns ??= []; result.failedTurns.push(...ocgFailedTurnMetadata(agent.session.snapshotEvents()).map(row => ({ ...row, sessionId: agent.id })))
      check('real native root turn completed', agent.session.snapshotEvents().findLast(row => row.type === 'turn/end')?.data.reason.kind === 'completed', { sessionId: agent.id })
    }
    const direct = (agent, name, args) => ctx.agents.withInitiator(agent, () => ctx.tools.execute({ agent, name, arguments: args, callId: ToolCallId('ocg-boundary-' + ++directCounter), signal: new AbortController().signal }))
    await save(createOcgPool(cfg.routes, cfg))
    for (const kind of ['code', 'review']) {
      const route = cfg.routes.find(value => value.kind === kind), root = await createRoot(kind)
      await command(root, '/team on')
      // These two checks are actual native permission/selection dispatches, not model requests.
      if (kind === 'code') {
        const disabled = createOcgPool(cfg.routes, cfg); disabled.models.push({ ...disabled.models[0], id: 'disabled-sentinel', enabled: false, isDefault: false })
        await save(disabled)
        for (const id of ['unknown-sentinel', 'disabled-sentinel']) {
          const before = result.requests.length, outcome = await direct(root, 'ultra_spawn_agent', { task_name: id, message: 'This selection must be rejected before any child model request.', model_config_id: id, model_reason: 'Native boundary sentinel.' })
          check('native selection rejects ' + id + ' before model work', outcome.isError === true && result.requests.length === before)
        }
        await save(createOcgPool(cfg.routes, cfg))
      }
      await turn(root, livePhasePrompt(kind, challenges[kind]) + ' Protocol requirement for the delegated message itself: tell the child to return ONLY one JSON object, with no Markdown fences, explanation, evidence line or reasoning. Do not ask the child to show its reasoning or add any text beside the JSON. The native tool receipt provides the evidence. Your own final response must also be only that exact JSON object.')
      const children = new Map([...sessions].map(([id, session]) => [id, session.snapshotEvents()]))
      const proof = collectOcgPoolPhase({ rootId: root.id, rootEvents: root.session.snapshotEvents(), children, route, challenge: challenges[kind], requests: result.requests, toolCalls: result.toolCalls })
      result.phaseProofs.push(proof)
      check('real ' + kind + ' autonomous selection has a complete native request/tool/result chain', proof.audit.passed, proof.audit)
      check('main request exposes candidate catalog and all six Team tools', result.requests.some(row => row.sessionId === root.id && row.hasTeamCatalog))
    }
    const code = cfg.routes.find(route => route.kind === 'code'), firstRequests = result.requests.filter(row => row.sessionId === firstChildId)
    check('Settings changed while an already selected child was running', !!savedSnapshot && !!updatedPool && source.get().models.find(row => row.id === code.id).maxTokens !== code.maxTokens)
    check('running native child retains immutable original route options', firstRequests.length >= 2 && firstRequests.every(row => row.provider === code.provider && row.model === code.model && row.maxTokens === code.maxTokens && row.reasoningEffort === code.reasoningEffort))
    check('previous settings snapshot remains unchanged', savedSnapshot.models.find(row => row.id === code.id).maxTokens === code.maxTokens)
    const review = cfg.routes.find(route => route.kind === 'review')
    await save(createOcgPool(cfg.routes, cfg, review.id))
    const explicit = await createRoot('explicit-priority'); await command(explicit, '/team on')
    await turn(explicit, livePhasePrompt('code', explicitChallenge) + ` This phase checks host precedence: request model_config_id=${JSON.stringify(code.id)} with a short reason even though the configuration user fixed a different candidate. The host must apply the fixed candidate. Do not change the requested ID to match the fixed choice. In the delegated message explicitly require ONLY one JSON object: no explanation, evidence line, Markdown or reasoning. Do not ask the child for any text beside the JSON. Your final response must also be only the child's exact JSON object.`)
    const explicitProof = collectOcgPoolPhase({ rootId: explicit.id, rootEvents: explicit.session.snapshotEvents(), children: new Map([...sessions].map(([id, session]) => [id, session.snapshotEvents()])), route: code, expectedSelectedRoute: review, challenge: explicitChallenge, requests: result.requests, toolCalls: result.toolCalls })
    result.phaseProofs.push(explicitProof)
    check('native user-fixed selection overrides the requested candidate and performs the actual tool roundtrip', explicitProof.audit.passed, explicitProof.audit)
    await save(updatedPool)
    result.savedPool = source.get()
    result.status = 'passed'
  } finally {
    clearTimeout(timer)
    const errors = []
    for (const cleanup of [...handles.toReversed().map(handle => () => handle.dispose()), ...disposers.toReversed()]) try { await cleanup() } catch (error) { errors.push(error?.name ?? 'Error') }
    result.cleanupErrors = errors; result.elapsedMs = Date.now() - started; result.globalGate.final = gate.snapshot()
    result.requestUsageSummary = { observedRequests: result.requests.length, usageAvailableRequests: result.requests.filter(row => row.usage).length, unknownUsageRequests: result.requests.filter(row => !row.usage).length,
      knownReportedTotalTokens: result.requests.reduce((sum, row) => sum + (typeof row.usage?.totalTokens === 'number' ? row.usage.totalTokens : 0), 0), cost: null, interpretation: 'Adapter-reported totals only; unavailable usage is unknown, not zero. No monetary cost measurement.' }
    await write()
    assert.ok(!errors.length, 'Native pool acceptance cleanup failed')
    assert.ok(result.globalGate.final.activePeak <= cfg.maxConcurrent && result.globalGate.final.active === 0, 'External stream gate did not quiesce')
  }
}
