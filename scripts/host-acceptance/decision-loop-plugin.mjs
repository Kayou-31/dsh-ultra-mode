/** Native-host fixture only. Scripted protocol responses prove wiring, never model intelligence. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const name = 'dsh-decision-loop-offline-acceptance'
export const inject = ['agents', 'agentLoop', 'tools', 'llm', 'sessions', 'sessionPersistence', 'systemPrompt', 'agentPresets', 'commands']
const REDIRECT = 'DECISION_REDIRECT_VERIFY_42'
const HISTORY = 'HISTORY_CONSTRAINT_CANARY_42'
const TASK = 'DECISION_LOOP_TASK：核对两个互斥记录。验收甲：两路都有原生只读回执。验收乙：两个初始记录完全一致。验收丙：外部结论存在原始证据。两路各自读取 duplicate.txt；不得联网、发布、付费或修改文件；必须保留标签“协作”。'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** A queue/send receipt cannot prove the requested behavior happened. */
export function auditRedirectEffect({ targetId, canary, expectedFile, expectedReceipt, diagnosticRequestSequence, requests, tools }) {
  const visible = requests.find(request => request.sessionId === targetId && request.sequence > diagnosticRequestSequence && request.text.includes(canary))
  if (!visible) return { stage: 'unverified', reason: 'No subsequent native request contained the directive' }
  const effect = tools.find(tool => tool.sessionId === targetId && tool.requestSequence >= visible.sequence && tool.file === expectedFile && tool.receipt === expectedReceipt && tool.isError === false)
  return effect ? { stage: 'effect-verified', requestSequence: visible.sequence, tool: effect, meaning: 'Only this deterministic read-only fixture behavior was independently verified' }
    : { stage: 'request-visible', requestSequence: visible.sequence, reason: 'Directive visibility alone does not prove behavior changed' }
}

export function apply(ctx, config) {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  if (!ready || !exit) throw new Error('Decision driver requires native CLI readiness and bounded exit')
  let cancelled = false
  const cancel = ready.onReady(() => {
    if (cancelled) return
    run(ctx, config).then(() => exit(0), async error => {
      let partial = {}; try { partial = JSON.parse(await fs.readFile(config.resultFile, 'utf8')) } catch {}
      await fs.writeFile(config.resultFile, JSON.stringify({ ...partial, status: 'failed', mode: config.mode, error: String(error), stack: error.stack }, null, 2))
      console.error('DECISION_LOOP_ACCEPTANCE_FAILED', error); exit(1)
    })
  })
  ctx.effect(() => () => { cancelled = true; cancel() }, 'decisionLoopAcceptance.ready')
}

async function run(ctx, config) {
  const started = Date.now(), requireRuntime = createRequire(path.join(config.runtimeRoot, 'package.json'))
  const sdk = async name => import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/' + name)).href)
  const [{ LlmAdapter, createUserMessage, ToolCallId }, { defineContentToolFixture }] = await Promise.all([sdk('dsh-llm'), sdk('dsh-tools')])
  const result = { status: 'running', mode: config.mode, host: 'actual DSH 0.2.1-rc.2 CLI Loader + AgentLoop + ToolRuntime + JSONL', model: 'offline scripted LlmAdapter; does not measure real-model intelligence, quality or provider billing', requests: [], toolExecutions: [], checks: [] }
  const check = (name, condition, details = {}) => { assert.ok(condition, name + ': ' + JSON.stringify(details)); result.checks.push({ name, passed: true, details }) }
  const textOf = messages => messages.flatMap(message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text)).join('\n')
  let callCounter = 0, redirectIssued = false
  const call = (name, args) => ({ type: 'tool-call', id: ToolCallId('decision-call-' + ++callCounter), name, arguments: JSON.stringify(args) })
  class Offline extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: 'Offline scripted decision acceptance' } }
    async listModels(provider) { return [{ provider, id: 'scripted', name: 'Offline scripted fixture' }] }
    async resolveModel(provider, model) { return { provider, id: model, name: 'Offline scripted fixture', context: { contextWindow: 1000000 }, reasoning: { efforts: [{ id: 'medium', name: 'Medium' }, { id: 'max', name: 'Max' }], defaultEffort: 'medium' } } }
    async *stream(options) {
      options.signal?.throwIfAborted()
      const text = textOf(options.messages), sequence = result.requests.length + 1
      const entry = { sequence, at: Date.now(), sessionId: options.sessionId, text, tools: (options.tools ?? []).map(tool => tool.name), provider: options.provider, model: options.model, effort: options.reasoningEffort }
      result.requests.push(entry)
      assert.ok(sequence <= 40, 'Fixture request budget exceeded')
      const lastUser = options.messages.findLastIndex(message => message.role === 'user'), lastUserText = textOf(options.messages.slice(lastUser, lastUser + 1))
      const toolMessages = options.messages.slice(lastUser + 1).filter(message => message.role === 'tool')
      const allTools = options.messages.filter(message => message.role === 'tool')
      let content
      if (lastUserText.includes('当前阶段只做规划。')) {
        entry.stage = 'planning'
        const header = [...lastUserText.matchAll(/revision=(\d+) sha256=([a-f0-9]{64}) sourceId="([^"]+)"/gu)].at(-1)
        assert.ok(header, 'Governed planning must expose the real host task revision, hash and source')
        const userItem = (id, quote) => ({ id, text: quote, provenance: 'user', quote, sourceId: header[3] })
        content = [{ type: 'text', text: JSON.stringify({ assignments: ['Independently read duplicate.txt; retain every original user restriction.', 'Independently read duplicate.txt; investigate contrary evidence without changing files.'], intent: {
          goals: [userItem('goal', '核对两个互斥记录。')], constraints: [userItem('constraint', '不得联网、发布、付费或修改文件；必须保留标签“协作”。')],
          acceptance: [userItem('read-receipts', '验收甲：两路都有原生只读回执。'), userItem('consistent', '验收乙：两个初始记录完全一致。'), userItem('external-proof', '验收丙：外部结论存在原始证据。')],
          assumptions: [{ id: 'fixture-scope', text: 'This acceptance fixture is scripted; model intelligence is not measured.', provenance: 'machine' }],
        } }) }]
      } else if (lastUserText.includes('次跨路协调')) {
        entry.stage = 'coordination'
        const match = /【宿主观察到的路线快照，仅作证据】\n([^\n]+)\n/u.exec(lastUserText)
        assert.ok(match, 'Native coordination exposes host snapshots')
        const snapshots = JSON.parse(match[1]), active = snapshots.filter(row => row.status === 'running')
        const evidenceIds = [...new Set(snapshots.flatMap(row => [...(row.evidenceIds ?? []), ...(row.progress?.evidenceIds ?? [])]))]
        if (!redirectIssued && active.length && evidenceIds.length) {
          const header = [...lastUserText.matchAll(/revision=(\d+) sha256=([a-f0-9]{64}) sourceId="([^"]+)"/gu)].at(-1)
          assert.ok(header, 'Diagnostic must quote the host contract')
          const target = active.at(-1).routeId
          const directive = { taskRevision: +header[1], taskHash: header[2], targetRouteId: target, type: 'verify', reason: 'Observed duplicate reads and contradictory initial records require a distinct verification fixture.', evidenceIds,
            instruction: REDIRECT + ': read verify.txt next using the existing read-only fixture tool; retain all original restrictions.', stopCondition: 'Stop after one verify.txt native receipt; do not repeat duplicate.txt.', ttlMs: 10000 }
          content = [{ type: 'text', text: JSON.stringify({ assessment: 'Contrary fixture evidence needs a distinct verification read.', directives: [directive] }) }]
          redirectIssued = true; entry.producedDirective = { ...directive, diagnosticRequestSequence: sequence }
        } else content = [{ type: 'text', text: JSON.stringify({ assessment: 'No new direction is justified by new evidence.', directives: [] }) }]
      } else if (text.includes('你是 Ultra 执行路线 ')) {
        entry.stage = 'worker'
        entry.redirectVisible = text.includes(REDIRECT)
        const prior = result.requests.filter(request => request.sessionId === options.sessionId).length
        const verified = textOf(allTools).includes('verify.txt')
        if (entry.redirectVisible && !verified) content = [call('fixture_read', { file_path: 'verify.txt' })]
        else if (verified || prior >= 5) content = [call('ultra_submit_report', { report: verified ? 'A distinct verification receipt was obtained after the native diagnostic; initial records remain contrary.' : 'Initial contrary fixture read completed; no external conclusion is verified.', unknowns: ['No external original source is available.'], conflicts: ['The initial records disagree.'] })]
        else {
          if (prior > 1) { await sleep(250); options.signal?.throwIfAborted() }
          content = [call('fixture_read', { file_path: prior === 1 ? 'duplicate.txt' : 'pacing.txt' })]
        }
      } else if (lastUserText.includes('进入最终审查与交付阶段。')) {
        entry.stage = 'verification'
        const sourceList = /【可用于本轮验收引用的实际工具结果来源ID；不是结论正确性的证明】\n([^\n]+)/u.exec(lastUserText)
        assert.ok(sourceList, 'Final protocol exposes the actual tool-result source allowlist')
        const ids = JSON.parse(sourceList[1])
        assert.ok(ids.length, 'Final model assessment must cite actual prompt-visible original evidence')
        content = [{ type: 'text', text: JSON.stringify({ output: '协作：两路完成原生只读检查；初始记录冲突，外部结论缺少原始证据。仅验证了脚本化闭环接线。', verification: { criteria: [
          { criterionId: 'task-result', status: 'unverified', evidenceIds: [], reason: 'The complete original task includes a contradictory criterion and an external-evidence gap.' },
          { criterionId: 'read-receipts', status: 'satisfied', evidenceIds: ids.slice(0, 2), reason: 'Both native worker fixture reads are present.' },
          { criterionId: 'consistent', status: 'failed', evidenceIds: ids.slice(0, 2), reason: 'The two initial fixture records remain contradictory.' },
          { criterionId: 'external-proof', status: 'unverified', evidenceIds: [], reason: 'No external original evidence was collected.' },
        ] } }) }]
      } else if (lastUserText.includes('自动决策辅助旁路') || lastUserText.includes('只修复响应格式')) {
        entry.stage = 'assist-decision'; await sleep(25)
        content = [{ type: 'text', text: JSON.stringify({ assessment: 'Offline compatibility probe needs no extra direction.', directives: [] }) }]
      } else if (String(options.sessionId).endsWith('-assist') && text.includes('DECISION_ASSIST_MAIN')) {
        entry.stage = 'assist-main'; await sleep(75)
        content = toolMessages.length ? [{ type: 'text', text: 'Main retained its own native fixture execution.' }] : [call('write', {})]
      } else if (lastUserText.includes('DECISION_LOOP_TASK') || lastUserText.includes(HISTORY)) {
        entry.stage = 'original-task'; content = [{ type: 'text', text: 'Original once-only task retained for the native fixture run.' }]
      } else {
        entry.stage = 'ordinary-main'
        content = toolMessages.length ? [{ type: 'text', text: 'Native offline probe completed.' }] : [call('fixture_read', { file_path: 'probe.txt' })]
      }
      for (const [index, block] of content.entries()) {
        yield { type: 'block-start', index, blockType: block.type }
        if (block.type === 'text') yield { type: 'text-delta', index, text: block.text }
        else yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments }
        yield { type: 'block-end', index, block }
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: content.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' } }
    }
  }
  const handles = [], releaseAdapter = ctx.llm.registerAdapter(['decision-offline'], new Offline())
  const releaseRead = ctx.tools.register(defineContentToolFixture({ name: 'fixture_read', description: 'Read-only local deterministic acceptance fixture', parameters: { file_path: { type: 'string', required: true } },
    async execute(args, exec) {
      const worker = result.requests.find(request => request.sessionId === exec.agent.id && request.stage === 'worker'), index = /执行路线 (\d+)\//u.exec(worker?.text ?? '')?.[1]
      const receipt = { sessionId: exec.agent.id, requestSequence: result.requests.findLast(request => request.sessionId === exec.agent.id)?.sequence, file: args.file_path,
        receipt: args.file_path === 'verify.txt' ? 'distinct-verification-42' : 'native-read-probe-42', initialRecord: index === '1' ? 'jade-731' : 'amber-912', isError: false }
      result.toolExecutions.push(receipt); return [{ type: 'text', text: JSON.stringify(receipt) }]
    } }))
  const releaseWrite = ctx.tools.register(defineContentToolFixture({ name: 'write', description: 'Permission sentinel only; performs no filesystem change', parameters: {}, async execute(_args, exec) { result.toolExecutions.push({ sessionId: exec.agent.id, name: 'write', receipt: 'permission-sentinel', isError: false }); return [{ type: 'text', text: 'Main native permission sentinel reached without mutating files.' }] } }))
  try {
    const handle = await ctx.agents.create({ sessionId: config.sessionId, meta: { cwd: config.projectDir, agentPreset: 'offline' }, agentOptions: { provider: 'decision-offline', model: 'scripted', reasoningEffort: 'medium', maxTokens: 2048 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } })
    handles.push(handle)
    await ctx.agents.withInitiator(handle.agent, async () => {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'DECISION_NATIVE_PROBE: read only probe.txt, no network, no publication, no paid providers.' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
    })
    const events = handle.agent.session.snapshotEvents()
    check('native AgentLoop settled completed', events.findLast(event => event.type === 'turn/end')?.data.reason.kind === 'completed')
    check('native ToolRuntime executed one read-only fixture', result.toolExecutions.length === 1 && events.some(event => event.type === 'tool/result'))
    check('mode off uses only the original main identity', result.requests.length === 2 && result.requests.every(request => request.sessionId === handle.agent.id))
    if (config.mode !== 'probe') {
      const ultraImport = file => import(pathToFileURL(path.join(config.ultraRoot, 'lib', file)).href)
      const { runUltra } = await ultraImport('orchestrator.js')
      const entry = [...ctx.get('loader').entries()].find(row => row.options.name === '@dsh-external/dsh-ultra-mode')
      check('actual Loader mounted the frozen candidate bundle', !!entry?.fiber)
      const runConfig = { ...entry.fiber.config, researchTools: ['fixture_read', 'ultra_memory_search', 'ultra_memory_get'], coordinationIntervalMs: 100, coordinationMaxRounds: 4, concurrency: 2, decisionGovernance: true }
      const root = await ctx.agents.create({ sessionId: config.sessionId + '-governance', meta: { cwd: config.projectDir, agentPreset: 'offline' }, agentOptions: { provider: 'decision-offline', model: 'scripted', reasoningEffort: 'medium', maxTokens: 4096 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } })
      handles.push(root)
      await ctx.agents.withInitiator(root.agent, async () => { root.agent.followup(createUserMessage({ content: [{ type: 'text', text: HISTORY + ': retain this earlier user requirement in native history; do not publish.' }], source: { kind: 'user' } })); await root.agent.whenIdle() })
      await ctx.agents.withInitiator(root.agent, async () => { root.agent.followup(createUserMessage({ content: [{ type: 'text', text: TASK }], source: { kind: 'user' } })); await root.agent.whenIdle() })
      const phases = []
      const ultra = await ctx.agents.withInitiator(root.agent, () => runUltra(runConfig, { parent: root.agent, task: TASK, content: [{ type: 'text', text: TASK }], concurrency: 2, signal: new AbortController().signal, phase: phase => phases.push(phase) }))
      result.ultra = ultra; result.phases = phases
      check('same native decision identity plans, diagnoses and verifies', ['planning', 'coordination', 'verification'].every(stage => result.requests.some(request => request.stage === stage && request.sessionId === ultra.decisionId)))
      check('two actual native workers independently performed the user-required fixture read', ultra.routeIds.length === 2 && ultra.routeIds.every(id => result.toolExecutions.some(tool => tool.sessionId === id && tool.file === 'duplicate.txt')))
      check('once-only original task remains immutable and user-attributed', ultra.governance?.contract.originalTask === TASK && ultra.governance.contract.intent.constraints.some(item => item.provenance === 'user' && item.text.includes('协作')))
      check('earlier once-only user requirement remains visible through native seed or memory without pretending it is the latest-task contract', result.requests.filter(request => request.sessionId === ultra.decisionId || ultra.routeIds.includes(request.sessionId)).every(request => request.text.includes(HISTORY)) && !ultra.governance.contract.originalTask.includes(HISTORY))
      const originalEvents = root.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && textOf([event.data.message ?? event.data]).includes('DECISION_LOOP_TASK'))
      check('human original task entered the actual root session only once', originalEvents.length === 1, { userMessages: originalEvents.length })
      const produced = result.requests.find(request => request.producedDirective)?.producedDirective
      check('scripted model produced the governed diagnostic before product routing', !!produced)
      const effect = auditRedirectEffect({ targetId: produced.targetRouteId, canary: REDIRECT, expectedFile: 'verify.txt', expectedReceipt: 'distinct-verification-42', diagnosticRequestSequence: produced.diagnosticRequestSequence, requests: result.requests, tools: result.toolExecutions })
      result.redirectEffect = effect
      check('subsequent native request and distinct tool receipt independently verify this fixture redirect effect', effect.stage === 'effect-verified', effect)
      const exportedStatuses = []
      const scanExports = async dir => {
        let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
        for (const item of entries) {
          const file = path.join(dir, item.name)
          if (item.isSymbolicLink()) throw new Error('Fixture export scan refuses symbolic links')
          if (item.isDirectory()) await scanExports(file)
          else if (item.isFile() && /^run-.*\.json$/u.test(item.name)) { const status = JSON.parse(await fs.readFile(file, 'utf8')); if (status.runId === ultra.runId) exportedStatuses.push(status) }
        }
      }
      await scanExports(path.join(config.projectDir, '.dsh-ultra', 'v1', 'exports'))
      const nativeDelivery = exportedStatuses.flatMap(status => status.deliveries ?? []).find(delivery => delivery.targetId === produced.targetRouteId)
      const stages = nativeDelivery?.stages.map(stage => stage.stage) ?? []
      check('native memory distinguishes queued, admitted and request-visible receipts', ['queued', 'admitted', 'request-visible'].every(stage => stages.includes(stage)), { nativeDelivery })
      const verification = ultra.governance?.verification
      check('final model verification covers satisfied, failed and unverified without a false pass', verification?.criteria.some(item => item.status === 'satisfied') && verification.criteria.some(item => item.status === 'failed') && verification.criteria.some(item => item.status === 'unverified' && item.evidenceIds.length === 0) && verification.allSatisfied === false && verification.hostVerified === false, verification)
      result.deliveryStages = { native: nativeDelivery, diagnostics: ultra.governance?.diagnostics, effectVerified: effect, meaning: 'Host-native queue/admission/visibility receipts remain distinct from this independent fixture-effect audit.' }
      const closedDecisionRequests = result.requests.filter(request => request.sessionId === ultra.decisionId).length
      await sleep(150)
      check('closed governance never dispatches another native decision request', ultra.governance.closed === true && result.requests.filter(request => request.sessionId === ultra.decisionId).length === closedDecisionRequests)

      const createRoot = async suffix => {
        const value = await ctx.agents.create({ sessionId: config.sessionId + suffix, meta: { cwd: config.projectDir, agentPreset: 'offline' }, agentOptions: { provider: 'decision-offline', model: 'scripted', reasoningEffort: 'medium', maxTokens: 4096 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } })
        handles.push(value); return value.agent
      }
      const turn = async (agent, text) => {
        await ctx.agents.withInitiator(agent, async () => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent.whenIdle() })
        check('ordinary native turn settled completed', agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind === 'completed', { agent: agent.id })
      }
      const command = async (agent, text) => {
        const execution = await ctx.commands.execute(agent, text, [], new AbortController().signal)
        check('manual mode command succeeds ' + text, execution?.result.kind === 'success')
      }
      const assist = await createRoot('-assist')
      await command(assist, '/ultra assist')
      const assistStart = result.requests.length
      await turn(assist, 'DECISION_ASSIST_MAIN: retain the selected main model and exercise its native permission sentinel.')
      await sleep(100)
      const assistRequests = result.requests.slice(assistStart), sidecars = assistRequests.filter(request => request.stage === 'assist-decision')
      check('assist keeps the main selected model, effort and write capability', assistRequests.filter(request => request.sessionId === assist.id).every(request => request.provider === 'decision-offline' && request.model === 'scripted' && request.effort === 'medium' && request.tools.includes('write')) && result.toolExecutions.some(tool => tool.sessionId === assist.id && tool.name === 'write'))
      check('manual assist creates one read-only decision sidecar identity', sidecars.length >= 1 && new Set(sidecars.map(request => request.sessionId)).size === 1 && sidecars.every(request => request.effort === 'max' && !request.tools.includes('write')), { sidecarRequests: sidecars.length })
      await command(assist, '/ultra off')
      const offStart = result.requests.length
      await turn(assist, 'DECISION_OFF_MAIN: read the local probe and finish normally.')
      await sleep(150)
      check('off mode launches no extra decision and manual multi-route selection remains required', result.requests.slice(offStart).every(request => request.sessionId === assist.id), { additionalRequests: result.requests.length - offStart })

      const cancelRoot = await createRoot('-cancel')
      const controller = new AbortController(), cancelStart = result.requests.length
      const cancellation = ctx.agents.withInitiator(cancelRoot, () => runUltra(runConfig, { parent: cancelRoot, task: TASK, content: [{ type: 'text', text: TASK }], concurrency: 2, signal: controller.signal, phase() {} }))
        .then(value => ({ value }), error => ({ error: String(error) }))
      const cancellationDeadline = Date.now() + 5000
      while (!result.requests.slice(cancelStart).some(request => request.stage === 'worker') && Date.now() < cancellationDeadline) await sleep(5)
      const cancelledAfterNativeWorkStarted = result.requests.slice(cancelStart).some(request => request.stage === 'worker')
      controller.abort(new Error('offline acceptance cancellation'))
      const cancellationResult = await cancellation
      const settledRequests = result.requests.length
      await sleep(250)
      check('cancelled native work settles and never calls decision again', cancelledAfterNativeWorkStarted && controller.signal.aborted && settledRequests === result.requests.length && result.requests.slice(cancelStart).some(request => request.stage === 'planning'), { cancellationResult, requests: result.requests.length - cancelStart })
      result.compatibility = { assistRequests: assistRequests.map(({ text, ...request }) => request), offRequests: result.requests.slice(offStart, cancelStart).map(({ text, ...request }) => request), cancellation: cancellationResult }
    }
    const gate = ctx.get('ultraAcceptanceModelGate')?.snapshot()
    check('global native stream gate never exceeds two and accounts all adapter requests', gate?.activePeak <= 2 && gate?.active === 0 && gate?.admitted === result.requests.length && gate.synthetic === true, gate)
    result.globalGate = gate; result.status = 'passed'
  } finally {
    const errors = []
    for (const dispose of [...handles.toReversed().map(handle => () => handle.dispose()), releaseWrite, releaseRead, releaseAdapter]) { try { await dispose() } catch (error) { errors.push(String(error)) } }
    result.cleanupErrors = errors; result.elapsedMs = Date.now() - started
    await fs.writeFile(config.resultFile, JSON.stringify(result, null, 2))
    if (errors.length) throw new Error('Decision fixture cleanup failed: ' + errors.join('; '))
  }
}
