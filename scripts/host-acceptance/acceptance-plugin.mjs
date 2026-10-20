/** Test-only driver mounted by the actual rc.2 CLI Loader. Never registers an HTTP provider. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const name = 'ultra-real-host-acceptance'
export const inject = ['agents', 'agentLoop', 'tools', 'llm', 'sessions', 'sessionPersistence', 'systemPrompt', 'agentPresets', 'commands', 'loader']

/** Test-only, temporary budget probe against the actual native Loader owner. */
export async function withNativeRequestBudget(ctx, memory, limit, action) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0, 'Native request limit must be a positive safe integer')
  const entries = [...(ctx.get('loader')?.entries() ?? [])]
    .filter(entry => entry.options.name === '@dsh-external/dsh-ultra-mode' && entry.fiber?.config)
  assert.equal(entries.length, 1, 'Budget probe requires one active native Ultra Loader owner')
  const config = entries[0].fiber.config
  const previous = config.memoryMaxRequests
  try {
    config.memoryMaxRequests = limit
    assert.equal(memory.host.config.memoryMaxRequests, limit, 'Native Loader update must reach the effective request budget before dispatch')
    return await action()
  } finally {
    config.memoryMaxRequests = previous
    assert.equal(memory.host.config.memoryMaxRequests, previous, 'Native Loader must restore the effective request budget')
  }
}

export function apply(ctx, config) {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  if (!ready || !exit) throw new Error('Acceptance driver requires the real CLI launcher readiness and bounded exit')
  let cancelled = false
  const cancelReady = ready.onReady(() => {
    if (cancelled) return
    run(ctx, config).then(() => exit(0), async error => {
      let partial = {}
      try { partial = JSON.parse(await fs.readFile(config.resultFile, 'utf8')) } catch {}
      const failure = { ...partial, status: 'failed', mode: config.mode, error: String(error), stack: error?.stack, at: new Date().toISOString() }
      await fs.mkdir(path.dirname(config.resultFile), { recursive: true })
      await fs.writeFile(config.resultFile, JSON.stringify(failure, null, 2))
      console.error('ULTRA_HOST_ACCEPTANCE_FAILED', error)
      exit(1)
    })
  })
  ctx.effect(() => () => { cancelled = true; cancelReady() }, 'acceptance.ready')
}

async function run(ctx, config) {
  const started = Date.now()
  const requireRuntime = createRequire(path.join(config.runtimeRoot, 'package.json'))
  const sdk = async name => import(pathToFileURL(requireRuntime.resolve(`@deepseek-ai/${name}`)).href)
  const [{ LlmAdapter, createUserMessage, ToolCallId }, { defineTool, defineContentToolFixture }] = await Promise.all([sdk('dsh-llm'), sdk('dsh-tools')])
  const ultraImport = file => import(pathToFileURL(path.join(config.ultraRoot, 'lib', file)).href)
  const [{ beginMemoryRun }, { createRoute }] = await Promise.all([ultraImport('memory-host.js'), ultraImport('runtime.js')])
  const result = { status: 'running', mode: config.mode ?? 'core', startedAt: new Date(started).toISOString(),
    host: 'actual DSH 0.2.0-rc.2 CLI Loader/profile, native AgentLoop and JSONL persistence',
    model: 'local scripted LlmAdapter; no model intelligence or provider billing measured', checks: [], requests: [], toolExecutions: [], sourceIds: {} }
  const check = (name, condition, details) => { assert.ok(condition, `${name}: ${JSON.stringify(details)}`); result.checks.push({ name, passed: true, details }) }
  const handles = [], routes = [], memories = []
  let readExecutions = 0, writeExecutions = 0, callCounter = 0
  const marker = 'HOST_PROJECTED_TAIL_42'
  const fullText = 'local-only fixture line without answer\n'.repeat(1600) + `\n${marker}: durable answer is jade-731\n`
  const conflictMarker = 'HOST_CONFLICT_RIGHT_913'
  const rightText = 'independent contrary fixture line\n'.repeat(1600) + `\n${conflictMarker}: durable answer is amber-912\n`
  const jsonOf = message => {
    try { return JSON.parse(message.content.filter(x => x.type === 'text').map(x => x.text).join('\n')) }
    catch { return undefined }
  }
  const textOf = messages => messages.flatMap(m => (m.content ?? []).filter(b => b.type === 'text').map(b => b.text)).join('\n')
  const blocks = function * (content) {
    for (const [index, block] of content.entries()) {
      yield { type: 'block-start', index, blockType: block.type }
      if (block.type === 'text') yield { type: 'text-delta', index, text: block.text }
      if (block.type === 'tool-call') yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index, block }
    }
  }
  const call = (tool, args) => ({ type: 'tool-call', id: ToolCallId('host-call-' + ++callCounter), name: tool, arguments: JSON.stringify(args) })
  class OfflineAdapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: 'Offline acceptance fixture' } }
    async listModels(provider) { return [{ provider, id: 'fixture', name: 'Scripted acceptance fixture' }] }
    async resolveModel(provider, model) {
      return { provider, id: model, name: 'Scripted acceptance fixture', context: { contextWindow: 1000000 },
        reasoning: { efforts: [{ id: 'medium', name: 'Fixture medium' }, { id: 'max', name: 'Fixture max' }], defaultEffort: 'medium' } }
    }
    async *stream(options) {
      options.signal?.throwIfAborted()
      const text = textOf(options.messages)
      const toolMessages = options.messages.filter(x => x.role === 'tool')
      const lastUserIndex = options.messages.findLastIndex(x => x.role === 'user')
      const lastUserText = textOf(options.messages.slice(lastUserIndex, lastUserIndex + 1))
      const turnTools = options.messages.slice(lastUserIndex + 1).filter(x => x.role === 'tool')
      const lastTool = toolMessages.at(-1), lastJson = lastTool && jsonOf(lastTool)
      const entry = { sessionId: options.sessionId ?? null, model: options.model, provider: options.provider,
        reasoningEffort: options.reasoningEffort ?? null, messageCount: options.messages.length,
        inputChars: JSON.stringify(options.messages).length, tools: (options.tools ?? []).map(t => t.name),
        purpose: options.purpose ?? null, at: Date.now() }
      result.requests.push(entry)
      let content
      if (lastUserText.includes('当前阶段只做规划。')) {
        content = [{ type: 'text', text: '{"assignments":["Independently inspect the given local fixture without changing files","Independently check the given local fixture and retain all user constraints"]}' }]
        entry.stage = 'parallel-planning'
      } else if (lastUserText.includes('你是 Ultra 执行路线 ')) {
        content = [{ type: 'text', text: 'Offline route report: independent fixture check; no files changed and no business result claimed.' }]
        entry.stage = 'parallel-worker'
      } else if (lastUserText.includes('进入最终审查与交付阶段。')) {
        content = turnTools.length === 0 ? [call('write', {})] : [{ type: 'text', text: 'Offline final decision: native execution boundary sentinel completed.' }]
        entry.stage = 'parallel-final'
      } else if (text.includes('HARNESS_ASSIST_MAIN') && String(options.sessionId).endsWith('-assist')) {
        await new Promise(resolve => setTimeout(resolve, 50))
        content = turnTools.length === 0 ? [call('write', {})] : [{ type: 'text', text: 'Ordinary main Agent completed its own fixture sentinel.' }]
        entry.stage = 'assist-main'
      } else if (text.includes('HARNESS_CANCEL')) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 10_000)
          const onAbort = () => { clearTimeout(timeout); reject(options.signal.reason ?? new Error('aborted')) }
          options.signal?.addEventListener('abort', onAbort, { once: true })
        })
        options.signal?.throwIfAborted()
        content = [{ type: 'text', text: 'unexpected cancellation timeout' }]
      } else if (text.includes('HARNESS_STEER_ROUTE')) {
        entry.steeringCanaryPresent = text.includes('HOST_STEERING_CANARY')
        if (toolMessages.length === 0) {
          entry.stage = 'steer-first'
          await new Promise(resolve => setTimeout(resolve, 50))
          options.signal?.throwIfAborted()
          content = [call('read', { file_path: 'steering-fixture.txt' })]
        } else {
          entry.stage = 'steer-next-request'
          assert.ok(entry.steeringCanaryPresent, 'queued steering must enter a subsequent real native request')
          content = [{ type: 'text', text: 'Scripted observable result: HOST_STEERING_CANARY appeared in the subsequent native request.' }]
        }
      } else if (text.includes('HARNESS_CONFLICT_WORKER')) {
        content = toolMessages.length === 0 ? [call('read', { file_path: 'conflict-right.txt' })] : [{ type: 'text', text: 'Independent contrary evidence report; answer deliberately omitted, disagreement remains unresolved.' }]
      } else if (text.includes('HARNESS_CONFLICT_DECISION')) {
        if (turnTools.length === 0) content = [call('ultra_memory_get', { id: result.sourceIds.projected, offset: fullText.length - 160, maxChars: 512 })]
        else if (turnTools.length === 1) {
          assert.ok(lastJson?.text?.includes('jade-731'))
          content = [call('ultra_memory_search', { query: conflictMarker, routeId: result.conflictWorkerId, maxChars: 2048 })]
        } else if (turnTools.length === 2) {
          const evidence = lastJson?.items?.find(x => x.kind === 'tool/result:read' && x.sessionId === result.conflictWorkerId)
          assert.ok(evidence, 'contrary raw source must be independently located')
          result.sourceIds.conflictRight = evidence.sourceId
          content = [call('ultra_memory_get', { id: evidence.sourceId, offset: rightText.length - 160, maxChars: 512 })]
        } else {
          assert.ok(lastJson?.text?.includes('amber-912'))
          const first = jsonOf(turnTools[0])
          assert.ok(first.text.includes('jade-731'))
          content = [{ type: 'text', text: 'Conflict remains unresolved: jade-731 versus amber-912. Both original sources were read.\n```ultra_evidence\n' + JSON.stringify({ facts: [{ kind: 'question', text: 'HOST_CONFLICT_UNRESOLVED: jade-731 conflicts with amber-912; independent verification required.', sourceIds: [result.sourceIds.projected, result.sourceIds.conflictRight], topics: ['host-conflict'], status: 'unresolved' }] }) + '\n```' }]
        }
        entry.stage = 'two-source-conflict'
      } else if (text.includes('HARNESS_WORKER')) {
        content = toolMessages.length === 0 ? [call('read', { file_path: 'fixture-long.txt' })] : [{ type: 'text', text: 'Research completed. The projected preview was inspected; answer intentionally omitted from this report.' }]
      } else if (text.includes('HARNESS_DECISION')) {
        if (toolMessages.length === 0) content = [call('ultra_memory_search', { query: marker, routeId: result.workerId, maxChars: 2048 })]
        else if (lastJson?.items) {
          const evidence = lastJson.items.find(x => x.kind === 'tool/result:read' && x.sessionId === result.workerId)
          assert.ok(evidence, 'decision must locate worker raw evidence rather than a repeated query')
          result.sourceIds.projected = evidence.sourceId
          content = [call('ultra_memory_get', { id: evidence.sourceId, offset: fullText.length - 160, maxChars: 512 })]
        } else {
          assert.ok(lastJson?.text?.includes('jade-731'), 'decision must read raw evidence omitted by report and projection')
          content = [{ type: 'text', text: 'Decision independently retrieved jade-731 from ' + result.sourceIds.projected }]
        }
      } else if (text.includes('HARNESS_OFF_READ')) {
        content = toolMessages.length === 0 ? [call('read', { file_path: 'ordinary-root.txt' })] : [{ type: 'text', text: 'Ordinary root read done' }]
      } else if (text.includes('自动决策辅助旁路') || text.includes('只修复响应格式')) {
        content = [{ type: 'text', text: '{"assessment":"Offline protocol acceptance","directives":[]}' }]
        entry.stage = 'assist-sidecar'
      } else content = [{ type: 'text', text: 'offline fixture acknowledgement' }]
      yield *blocks(content)
      // These are synthetic fixture counters, not provider usage or paid-token evidence.
      yield { type: 'usage', usage: { inputTokens: 101, outputTokens: 17, cacheReadTokens: 3, totalTokens: 121 } }
      yield { type: 'finish', reason: { kind: content.some(b => b.type === 'tool-call') ? 'tool-calls' : 'stop' } }
    }
  }
  const releaseAdapter = ctx.llm.registerAdapter(['acceptance-offline'], new OfflineAdapter())
  const releaseRead = ctx.tools.register(defineTool({ name: 'read', description: 'Local acceptance fixture with full rendered output and clipped model projection',
    parameters: { file_path: { type: 'string', required: true } },
    output: { schema: { type: 'object', properties: { text: { type: 'string', required: true } }, additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    async execute(args, exec) { readExecutions++; result.toolExecutions.push({ name: 'read', sessionId: exec.agent.id, file: args.file_path }); return { text: args.file_path === 'conflict-right.txt' ? rightText : fullText } },
    projectContent() { return [{ type: 'text', text: 'MODEL_PREVIEW_ONLY: answer absent here' }] } }))
  const releaseWrite = ctx.tools.register(defineContentToolFixture({ name: 'write', description: 'Local acceptance permission sentinel; never writes files', parameters: {},
    async execute(_args, exec) { writeExecutions++; result.toolExecutions.push({ name: 'write', sessionId: exec.agent.id }); return [{ type: 'text', text: 'write sentinel reached' }] } }))
  const executeTool = (agent, name, args = {}) => ctx.tools.execute({ agent, name, arguments: args, signal: new AbortController().signal, callId: ToolCallId('harness-direct-' + ++callCounter) })
  const createRoot = async (id, cwd = config.projectDir, seed = undefined) => {
    await fs.mkdir(cwd, { recursive: true })
    const handle = await ctx.agents.create({ sessionId: id, meta: { cwd, agentPreset: 'offline' }, ...(seed ? { seed } : {}), agentOptions: { provider: 'acceptance-offline', model: 'fixture', reasoningEffort: 'medium', maxTokens: 1024 },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'offline') } })
    handles.push(handle); return handle
  }
  const resumeRoot = async id => {
    const handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'acceptance-offline', model: 'fixture', reasoningEffort: 'medium', maxTokens: 1024 },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'offline') } })
    handles.push(handle); return handle
  }
  const turn = async (agent, text) => {
    const boundary = agent.session.seq
    await ctx.agents.withInitiator(agent, async () => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    })
    const events = agent.session.snapshotEvents().slice(boundary)
    const end = events.findLast(e => e.type === 'turn/end')
    assert.equal(end?.data.reason.kind, 'completed', `native turn failed: ${JSON.stringify(end?.data.reason)}`)
    return events
  }
  try {
    if (config.mode === 'disabled') {
      const disabledProject = path.join(config.projectDir, '..', 'evidence-disabled-project-' + config.sessionId)
      const root = await createRoot(config.sessionId, disabledProject)
      await turn(root.agent, 'Evidence-disabled acceptance: perform one normal local fixture acknowledgement.')
      check('disabled evidence registers no retrieval tools', !ctx.tools.schemas(root.agent).some(x => x.name.startsWith('ultra_memory_')), {})
      check('disabled evidence starts no memory run', await beginMemoryRun(root.agent, 'should-be-disabled') === undefined, {})
      let storageExists = true
      try { await fs.access(path.join(disabledProject, '.dsh-ultra')) } catch (error) { if (error.code === 'ENOENT') storageExists = false; else throw error }
      check('disabled evidence creates no project index', storageExists === false, { disabledProject })
      check('disabled off mode uses one actual local request', result.requests.length === 1, { requests: result.requests.length })
    } else if (config.mode === 'resume') {
      const previous = JSON.parse(await fs.readFile(config.receiptFile, 'utf8'))
      const handle = await resumeRoot(previous.rootId)
      const memory = await beginMemoryRun(handle.agent, 'host-cold-restart'); assert.ok(memory); memories.push(memory)
      const found = JSON.parse((await executeTool(handle.agent, 'ultra_memory_search', { query: marker, routeId: previous.workerId, maxChars: 2048 })).content[0].text)
      check('cold-process raw evidence search', found.items.some(x => x.sourceId === previous.sourceIds.projected), { sourceId: previous.sourceIds.projected, hits: found.total })
      const fetched = JSON.parse((await executeTool(handle.agent, 'ultra_memory_get', { id: previous.sourceIds.projected, offset: fullText.length - 160, maxChars: 512 })).content[0].text)
      check('cold-process get of original projected output', fetched.text.includes('jade-731') && fetched.status === 'captured', { status: fetched.status })
      const constraint = await memory.host.search(handle.agent, { query: 'HOST_EARLY_CONSTRAINT' })
      check('cold-process early one-time constraint', constraint.items.length > 0, { hits: constraint.total })
      if (previous.sourceIds.conflictRight) {
        const contrary = JSON.parse((await executeTool(handle.agent, 'ultra_memory_get', { id: previous.sourceIds.conflictRight, offset: rightText.length - 160, maxChars: 512 })).content[0].text)
        check('cold-process contrary evidence remains independently retrievable', contrary.text.includes('amber-912') && contrary.status === 'captured', { sourceId: previous.sourceIds.conflictRight })
        const unresolved = await memory.host.search(handle.agent, { query: 'HOST_CONFLICT_UNRESOLVED', topic: 'host-conflict' })
        check('cold-process conflict retains unresolved semantic status', unresolved.items.some(x => x.semanticStatus === 'unresolved'), { items: unresolved.items })
      }
      if (previous.sourceIds.retry) {
        const recovered = JSON.parse((await executeTool(handle.agent, 'ultra_memory_get', { id: previous.sourceIds.retry, maxChars: 1024 })).content[0].text)
        check('cold-process retry evidence keeps its original stable ID', recovered.status === 'host' && recovered.text.includes('HOST_TRANSIENT_INDEX_WRITE') && recovered.sourceIds.includes(previous.sourceIds.retry), { sourceId: previous.sourceIds.retry })
      }
      await turn(handle.agent, 'Resume without rerunning the completed read operation')
      check('completed operation not automatically replayed on resume', readExecutions === 0, { readExecutions })
      result.memory = memory.status()
    } else {
      const root = await createRoot(config.sessionId)
      check('actual root joins a retained native preset revision', ctx.agentPresets.composedPreset(root.agent.ctx) === 'offline', {})
      await turn(root.agent, 'HOST_EARLY_CONSTRAINT: preserve the literal label 协作 and do not publish or use paid providers.')
      check('off mode does not launch additional agents', ctx.agents.roots().length === 1 && result.requests.length === 1, { requests: result.requests.length })
      await turn(root.agent, 'HARNESS_OFF_READ ordinary main Agent retains native read access.')
      check('off mode retains normal main tool access', readExecutions === 1 && ctx.tools.schemas(root.agent).some(x => x.name === 'write'), { readExecutions })
      const memory = await beginMemoryRun(root.agent, 'host-core-run'); assert.ok(memory, 'actual persistent memory run initialized'); memories.push(memory)
      const routeConfig = { toolName: 'ultra_task', collaborationEnabled: false }
      const common = { readOnly: true, researchTools: ['read', 'ultra_memory_search', 'ultra_memory_get'], memory }
      const worker = await createRoute(root.agent, { ...common, id: 'ultra-route-' + config.sessionId + '-worker', label: 'actual worker', signal: new AbortController().signal }, routeConfig); routes.push(worker)
      result.workerId = worker.id
      const decision = await createRoute(root.agent, { ...common, id: 'ultra-route-' + config.sessionId + '-decision', label: 'actual decision', signal: new AbortController().signal }, routeConfig); routes.push(decision)
      const w = ctx.agents.get(worker.id), d = ctx.agents.get(decision.id)
      check('actual Ultra routes retain their parent native preset revision', ctx.agentPresets.composedPreset(w.ctx) === 'offline' && ctx.agentPresets.composedPreset(d.ctx) === 'offline', {})
      const progress = []; worker.subscribeProgress(value => progress.push(value))
      for (const agent of [w, d]) {
        const names = ctx.tools.schemas(agent).map(x => x.name)
        check('research route schemas exclude write and run_code ' + agent.id, !names.includes('write') && !names.includes('run_code') && names.includes('ultra_memory_get'), { names })
        check('research route execution rejects write ' + agent.id, (await executeTool(agent, 'write')).isError === true, {})
      }
      const workerOutcome = await worker.run([{ type: 'text', text: 'HARNESS_WORKER: inspect fixture file and provide a short report omitting its answer.' }])
      check('native worker AgentLoop completes and supplies evidence IDs', workerOutcome.ok && workerOutcome.evidenceIds?.length > 0 && !workerOutcome.text.includes('jade-731'), workerOutcome)
      check('progress bounded before answer tail', progress.some(x => x.kind === 'tool' && x.text.length <= 2000) && progress.every(x => !x.text.includes(marker)), progress.map(x => ({ kind: x.kind, chars: x.text.length, evidenceIds: x.evidenceIds })))
      await memory.checkpoint()
      const decisionOutcome = await decision.run([{ type: 'text', text: 'HARNESS_DECISION: independently find HOST_PROJECTED_TAIL_42 by memory search, then get original and conclude.' }])
      check('worker to decision search/get through native AgentLoop', decisionOutcome.ok && decisionOutcome.text.includes('jade-731'), decisionOutcome)
      check('bounded worker progress carries the exact recoverable original source ID', progress.some(x => x.kind === 'tool' && x.evidenceIds?.includes(result.sourceIds.projected)), { sourceId: result.sourceIds.projected })
      const rightWorker = await createRoute(root.agent, { ...common, id: 'ultra-route-' + config.sessionId + '-conflict-worker', label: 'contrary worker', signal: new AbortController().signal }, routeConfig); routes.push(rightWorker)
      result.conflictWorkerId = rightWorker.id
      const rightOutcome = await rightWorker.run([{ type: 'text', text: 'HARNESS_CONFLICT_WORKER: independently inspect a contrary local fixture and omit the answer from the final report.' }])
      check('second native worker produces source-backed contrary evidence', rightOutcome.ok && rightOutcome.evidenceIds?.length > 0 && !rightOutcome.text.includes('amber-912'), rightOutcome)
      const conflictDecision = await createRoute(root.agent, { ...common, id: 'ultra-route-' + config.sessionId + '-conflict-decision', label: 'conflict decision', signal: new AbortController().signal }, routeConfig); routes.push(conflictDecision)
      const conflictOutcome = await conflictDecision.run([{ type: 'text', text: 'HARNESS_CONFLICT_DECISION: read left evidence ' + result.sourceIds.projected + ' and independently retrieve contrary route ' + rightWorker.id + ' originals; retain uncertainty and both source IDs.' }])
      check('native decision retrieves both sides of a two-worker conflict', conflictOutcome.ok && conflictOutcome.text.includes('jade-731') && conflictOutcome.text.includes('amber-912') && conflictOutcome.text.includes(result.sourceIds.projected) && conflictOutcome.text.includes(result.sourceIds.conflictRight), conflictOutcome)
      check('source-backed conflict remains an unresolved semantic candidate', memory.store.semantics(memory.access()).some(x => x.kind === 'question' && x.status === 'unresolved' && x.sourceIds.includes(result.sourceIds.projected) && x.sourceIds.includes(result.sourceIds.conflictRight)), { sourceIds: [result.sourceIds.projected, result.sourceIds.conflictRight] })
      const retryId = 'ultra-route-' + config.sessionId + '-retry-worker'
      const retryChild = await ctx.agents.create({ sessionId: retryId, parentAgent: root.agent,
        meta: { cwd: config.projectDir, parentSession: root.agent.id },
        agentOptions: { provider: 'acceptance-offline', model: 'fixture', reasoningEffort: 'max', maxTokens: 1024 },
        setup: agentCtx => { ctx.agentPresets.composeFrom(agentCtx, root.agent.ctx); agentCtx.get('tools').restrict({ allow: ['read', 'ultra_memory_search', 'ultra_memory_get'] }) } })
      handles.push(retryChild); memory.bind(retryChild.agent, retryId)
      const originalCapture = memory.store.capture.bind(memory.store)
      let captureFailures = 0, failedInput
      memory.store.capture = input => {
        if (captureFailures === 0 && input.sessionId === retryId && input.kind === 'user/message') {
          captureFailures++; failedInput = { ...input }; throw new Error('TEST_ONLY transient native child evidence capture failure')
        }
        return originalCapture(input)
      }
      try { await turn(retryChild.agent, 'HOST_TRANSIENT_INDEX_WRITE: keep this once-only native child evidence despite one index write rejection.') }
      finally { memory.store.capture = originalCapture }
      check('real child event survives one rejected index write in native log', captureFailures === 1 && failedInput && memory.store.idsFor(retryId, failedInput.eventId).length === 0, { captureFailures, failedEventId: failedInput?.eventId })
      await memory.checkpoint()
      const retrySources = memory.store.idsFor(retryId, failedInput.eventId)
      result.sourceIds.retry = retrySources[0]
      const retryScan = memory.status().scan.find(x => x.sessionId === retryId)
      check('checkpoint audits native child and repairs its missing evidence', retrySources.length === 1 && retryScan?.availableEvents === retryScan?.indexedThrough, { retrySources, retryScan })
      await memory.checkpoint()
      check('repeated native checkpoint does not duplicate recovered evidence', memory.store.idsFor(retryId, failedInput.eventId).length === 1, { sourceId: retrySources[0] })
      const attemptsBeforeBudget = memory.status().resources.attemptedCalls
      const requestsBeforeBudget = result.requests.length
      await withNativeRequestBudget(ctx, memory, attemptsBeforeBudget + 1, async () => {
        check('native Loader request budget is effective before dispatch', memory.host.config.memoryMaxRequests === attemptsBeforeBudget + 1, { requestLimit: memory.host.config.memoryMaxRequests })
        await turn(retryChild.agent, 'Use the final allowed local request in this bounded native budget probe.')
        check('actual request budget admits the last allowed native request', memory.status().resources.attemptedCalls === attemptsBeforeBudget + 1 && result.requests.length === requestsBeforeBudget + 1, { attemptedCalls: memory.status().resources.attemptedCalls, requestLimit: memory.host.config.memoryMaxRequests })
        const budgetBoundary = retryChild.agent.session.seq
        await ctx.agents.withInitiator(retryChild.agent, async () => {
          retryChild.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'This request must be refused before adapter dispatch.' }], source: { kind: 'user' } }))
          await retryChild.agent.whenIdle()
        })
        const budgetEnd = retryChild.agent.session.snapshotEvents().slice(budgetBoundary).findLast(x => x.type === 'turn/end')
        check('actual request budget rejects the next step before adapter dispatch', budgetEnd?.data.reason.kind === 'error' && JSON.stringify(budgetEnd.data.reason).includes('budget exhausted') && result.requests.length === requestsBeforeBudget + 1, { end: budgetEnd?.data.reason, adapterRequests: result.requests.length - requestsBeforeBudget })
      })
      const steerRoute = await createRoute(root.agent, { ...common, id: 'ultra-route-' + config.sessionId + '-steering', label: 'steering admission', signal: new AbortController().signal }, routeConfig); routes.push(steerRoute)
      const steeringTurn = steerRoute.run([{ type: 'text', text: 'HARNESS_STEER_ROUTE: run a local fixture tool, then inspect any native later-step feedback.' }])
      const steeringDeadline = Date.now() + 3000
      while (!result.requests.some(x => x.sessionId === steerRoute.id && x.stage === 'steer-first') && Date.now() < steeringDeadline) await new Promise(resolve => setTimeout(resolve, 5))
      check('steering queues while the first real native request is in flight', steerRoute.steer('HOST_STEERING_CANARY: preserve all original constraints; this is test evidence, not new authorization.'), {})
      const steeringOutcome = await steeringTurn
      const steeringRequests = result.requests.filter(x => x.sessionId === steerRoute.id)
      const delivery = memory.status().deliveries.find(x => x.targetId === steerRoute.id)
      const deliveryStages = delivery?.stages.map(x => x.stage) ?? []
      check('queued steering enters only a subsequent actual native request', steeringOutcome.ok && steeringRequests.length === 2 && !steeringRequests[0].steeringCanaryPresent && steeringRequests[1].steeringCanaryPresent, { requests: steeringRequests })
      check('native delivery records queue admission and actual request visibility separately', ['queued', 'admitted', 'request-visible'].every(stage => deliveryStages.includes(stage)), { delivery, observedResult: 'scripted fixture acknowledgment; not evidence of real model adoption' })
      const workerResults = w.session.snapshotEvents().filter(x => x.type === 'tool/result')
      check('native persisted worker view records projection not full raw tail', workerResults.length === 1 && !JSON.stringify(workerResults[0]).includes(marker), { resultChars: JSON.stringify(workerResults[0]).length })
      const budgeted = await executeTool(d, 'ultra_memory_search', { query: 'fixture', maxChars: 2048, limit: 1000 })
      check('actual memory tool serialized return budget', budgeted.content[0].text.length <= 2048, { chars: budgeted.content[0].text.length })
      const unrelated = await createRoot(config.sessionId + '-unrelated')
      const unrelatedMemory = await beginMemoryRun(unrelated.agent, 'host-unrelated'); assert.ok(unrelatedMemory); memories.push(unrelatedMemory)
      const denied = await executeTool(unrelated.agent, 'ultra_memory_get', { id: result.sourceIds.projected, offset: fullText.length - 160, maxChars: 512 })
      check('same-project unrelated root cannot retrieve route evidence', denied.isError === true, { isError: denied.isError })
      const foreign = await createRoot(config.sessionId + '-other-project', path.join(config.projectDir, '..', 'other-project'))
      const foreignMemory = await beginMemoryRun(foreign.agent, 'host-other-project-run'); assert.ok(foreignMemory); memories.push(foreignMemory)
      const foreignFound = await executeTool(foreign.agent, 'ultra_memory_search', { query: marker })
      check('different-project search cannot leak evidence', foreignFound.isError === false && JSON.parse(foreignFound.content[0].text).items.length === 0, { found: JSON.parse(foreignFound.content[0].text) })
      const forged = await executeTool({ ...d, id: d.id, ctx: d.ctx, session: d.session, options: d.options, status: d.status }, 'ultra_memory_get', { id: result.sourceIds.projected })
      check('copied Agent identity rejected by actual tool execution', forged.isError === true, {})
      const controller = new AbortController()
      const cancelRoute = await createRoute(root.agent, { ...common, id: 'ultra-route-' + config.sessionId + '-cancel', label: 'cancel', signal: controller.signal }, routeConfig); routes.push(cancelRoute)
      const cancelPromise = cancelRoute.run([{ type: 'text', text: 'HARNESS_CANCEL' }]); setTimeout(() => controller.abort(new Error('acceptance cancellation')), 30)
      const cancelled = await cancelPromise
      check('actual native cancellation settles route and index checkpoint', !cancelled.ok, cancelled)
      await cancelRoute.dispose(); routes.splice(routes.indexOf(cancelRoute), 1)
      check('no write sentinel reached by research worker/decision', writeExecutions === 0, { writeExecutions })
      await memory.checkpoint()
      result.memory = memory.status()
      result.receipt = { rootId: root.agent.id, workerId: worker.id, sourceIds: result.sourceIds, fullTextChars: fullText.length }
      await fs.writeFile(config.receiptFile, JSON.stringify(result.receipt, null, 2))
      if (config.modeChecks) {
        const command = async (agent, input) => {
          const execution = await ctx.commands.execute(agent, input, [], new AbortController().signal)
          assert.equal(execution?.result.kind, 'success', 'actual native command failed: ' + input)
          return execution.result
        }
        const assist = await createRoot(config.sessionId + '-assist')
        await command(assist.agent, '/ultra assist')
        const assistStart = result.requests.length, writesBeforeAssist = writeExecutions
        await turn(assist.agent, 'HARNESS_ASSIST_MAIN: exercise normal main Agent execution ownership without any real file mutation.')
        // Sidecar cleanup is async to the turn/end observer; native lifecycle must settle.
        await new Promise(resolve => setTimeout(resolve, 100))
        const assistRequests = result.requests.slice(assistStart)
        const assistSidecars = assistRequests.filter(x => x.stage === 'assist-sidecar')
        check('manual assist mode uses exactly one read-only sidecar identity', new Set(assistSidecars.map(x => x.sessionId)).size === 1 && assistSidecars.every(x => !x.tools.includes('write') && x.reasoningEffort === 'max'), assistRequests)
        check('assist mode preserves main execution and reasoning choice', assistRequests.filter(x => x.sessionId === assist.agent.id).every(x => x.reasoningEffort === 'medium' && x.tools.includes('write')) && writeExecutions === writesBeforeAssist + 1, { writes: writeExecutions - writesBeforeAssist })
        await command(assist.agent, '/ultra off')
        const offStart = result.requests.length
        await turn(assist.agent, 'After manually switching off, acknowledge without creating routes.')
        check('manual off mode stops extra sidecar dispatch', result.requests.slice(offStart).every(x => x.sessionId === assist.agent.id), { requests: result.requests.slice(offStart).length })
        const parallel = await createRoot(config.sessionId + '-parallel')
        await command(parallel.agent, '/ultra 2')
        const parallelStart = result.requests.length, writesBeforeParallel = writeExecutions
        await turn(parallel.agent, 'HARNESS_PARALLEL: preserve the explicit two-route selection and test local permission sentinels only.')
        const parallelRequests = result.requests.slice(parallelStart)
        const workers = parallelRequests.filter(x => x.stage === 'parallel-worker')
        const planner = parallelRequests.filter(x => x.stage === 'parallel-planning')
        const final = parallelRequests.filter(x => x.stage === 'parallel-final')
        check('manual two-route selection preserved by actual host dispatch', new Set(workers.map(x => x.sessionId)).size === 2 && planner.length === 1, parallelRequests)
        check('parallel worker boundaries and sole decision execution preserved', workers.every(x => !x.tools.includes('write') && !x.tools.includes('run_code') && x.reasoningEffort === 'max') && final.some(x => x.tools.includes('write')) && writeExecutions === writesBeforeParallel + 1, { writes: writeExecutions - writesBeforeParallel, workerIds: workers.map(x => x.sessionId) })
      }
    }
    if (config.compressionChecks && config.mode !== 'disabled') {
      const { runCompressionChecks } = await import('./compression-checks.mjs')
      const compression = await runCompressionChecks(ctx, { ...config, createRoot, resumeRoot, turn })
      for (const row of compression.checks ?? []) check(row.name, row.passed, row.details)
      result.compression = compression
    }
    for (const memory of memories) await memory.checkpoint()
    if (config.requireGlobalGate) {
      const globalGate = ctx.get('ultraAcceptanceModelGate')?.snapshot()
      check('deployment gate enforces global maximum two native streams and accounts every fixture request', globalGate && globalGate.activePeak <= 2 && globalGate.active === 0 && globalGate.queueDepth === 0 && globalGate.admitted === result.requests.length && globalGate.synthetic === true,
        { ...globalGate, fixtureAdapterRequests: result.requests.length })
      result.globalGate = globalGate
    }
    result.status = 'passed'; result.syntheticUsage = true
  } finally {
    const cleanupErrors = []
    for (const dispose of [...routes.toReversed().map(route => () => route.dispose()), ...memories.toReversed().map(memory => () => memory.dispose()), ...handles.toReversed().map(handle => () => handle.dispose()), releaseWrite, releaseRead, releaseAdapter]) {
      try { await dispose() } catch (error) { cleanupErrors.push(String(error)) }
    }
    result.cleanupErrors = cleanupErrors
    result.elapsedMs = Date.now() - started
    await fs.mkdir(path.dirname(config.resultFile), { recursive: true })
    await fs.writeFile(config.resultFile, JSON.stringify(result, null, 2))
    if (cleanupErrors.length) throw new Error('Native acceptance cleanup failed: ' + cleanupErrors.join('; '))
  }
}
