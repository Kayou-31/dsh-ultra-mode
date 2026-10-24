/** Ultra orchestration for the installed DSH 0.2.0-rc.2 extension API. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createUserMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import { agentCarrier, type Agent } from '@deepseek-ai/dsh-agent'
import { runUltra, type RunConfig, type UltraResult } from './orchestrator.js'
import { startDecisionAssist } from './assist.js'
import { governanceStatus } from './decision-governance.js'
import { researchToolDenial, routeParentOf, canPublishKnowledge } from './runtime.js'
import { routeCount, modeCount, resolveSessionKey, snapshotOf, renderUltraSection, type UltraState } from './ultra.js'
import type { CoordinationSummary } from './coordination.js'
import { installCollaboration, COLLABORATION_TOOLS, type CollaborationHostHandle } from './collaboration-host.js'
import { acquireEvidenceSupport } from './evidence-support.js'
import { TaskMemoryFields } from './task-memory-settings.js'
import type { TaskMemoryConfig } from './task-memory.js'
import { ModelPoolSchema, createModelPoolSettings } from './model-pool-settings.js'
import type { TeamSnapshot } from './collaboration.js'
import { readCollaborationAudit } from './model-pool-audit.js'
import { GlobalKnowledgeSchema } from './knowledge-settings.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'ultra-mode': { kind: 'ultra-mode'; form: 'notice'; summary: string; runId: string; routeIds: string[]; decisionId: string; coordination?: CoordinationSummary }
  }
}
export const name = '@dsh-external/dsh-ultra-mode'
export const inject = ['agents', 'tools', 'systemPrompt']
export const ConfigFields = {
  ...TaskMemoryFields,
  toolName: z.string().default('ultra_task'),
  concurrency: z.number().step(1).min(1).max(5).default(3),
  collaborationEnabled: z.boolean().default(false),
  collaborationProvider: z.string().default('spawn'),
  collaborationMaxAgents: z.number().step(1).min(1).max(32).default(8),
  collaborationModelPool: ModelPoolSchema.description('普通协作子代理模型池；仅影响随后新建实例，独立于Ultra worker/decision'),
  sectionOrder: z.number().default(117.5),
  maxSessions: z.number().step(1).min(1).default(64),
  timeoutMs: z.number().step(1).min(1000).max(86400000).default(900000),
  reportChars: z.number().step(1).min(1000).max(100000).default(20000),
  planningMaxTokens: z.number().step(1).min(0).max(1000000).default(0),
  researchMaxTokens: z.number().step(1).min(0).max(1000000).default(0),
  decisionMaxTokens: z.number().step(1).min(0).max(1000000).default(0),
  coordinationMaxTokens: z.number().step(1).min(0).max(1000000).default(0),
  coordinationIntervalMs: z.number().step(1).min(100).max(60000).default(1000),
  coordinationMaxRounds: z.number().step(1).min(-1).max(1000).default(-1),
  coordinationFailureLimit: z.number().step(1).min(0).max(100).default(3),
  decisionGovernance: z.boolean().default(false).description('在现有decision调用内统一意图、诊断与验收；关闭时沿用旧协议'),
  evidenceEnabled: z.boolean().default(true),
  globalKnowledge: GlobalKnowledgeSchema.description('同一profile显式授权的跨项目知识；不改变原项目证据ACL，不另存密钥'),
  memorySearchChars: z.number().step(1).min(256).max(32000).default(6000),
  memoryGetChars: z.number().step(1).min(256).max(64000).default(12000),
  contextTargetTokens: z.number().step(1).min(4096).max(1000000).default(30000),
  contextTriggerTokens: z.number().step(1).min(4096).max(1000000).required(false).description('启动压缩的含预留空间预算；省略时沿用压后目标，配置时须大于或等于 contextTargetTokens'),
  contextRetainRecentMessages: z.number().step(1).min(2).max(128).default(8).description('保留近期历史窗口；仅压缩窗口外已配对纯文本工具结果，用户要求与附件保持原样'),
  contextMinResultChars: z.number().step(1).min(64).max(1000000).default(4096).description('可压缩纯文本工具结果的最小字符数；须有已校验的持久来源'),
  contextMaxPrunes: z.number().step(1).min(1).max(256).default(16),
  contextPreviewChars: z.number().step(1).min(0).max(4096).default(320),
  contextCompactLocators: z.boolean().default(false).description('用精简恢复定位替代每条结果中重复的状态、来源列表与预览'),
  contextRetrievalReceipts: z.boolean().default(false).description('允许压缩本地 memory 检索返回；仅保存宿主来源与校验元数据，不重复索引正文，不压全局知识返回'),
  contextArchiveCompletedTurns: z.boolean().default(false).description('实验性：归档已完成旧阶段，逐字保留用户要求与公开进展，原文按 arc_ID 分页恢复；提交后持久化失败会停止执行，不伪称已回滚'),
  contextOutputReserveTokens: z.number().step(1).min(256).max(100000).default(4096),
  contextToolReserveTokens: z.number().step(1).min(256).max(100000).default(2048),
  contextCompression: z.boolean().default(false),
  memoryMaxRequests: z.number().step(1).min(0).max(100000).default(0),
  memoryMaxTokens: z.number().step(1).min(0).max(100000000).default(0),
  researchTools: z.array(z.string()).default(['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'subagent', 'subagent_fork', 'wait', 'list_agents', 'send_message', 'interrupt_agent']),
  jevEnabled: z.boolean().default(false),
  jevKeyEnv: z.string().default('TYPESAFE_API_KEY'),
  jevModel: z.string().default('jev-latest'),
  jevBaseUrl: z.string().default('https://api.typesafe.ai'),
  jevTimeoutMs: z.number().step(1).min(100).max(120000).default(15000),
}
export const Config = z.object(ConfigFields)
export interface Config extends RunConfig, TaskMemoryConfig { concurrency: number; sectionOrder: number; maxSessions: number; evidenceEnabled?: boolean; globalKnowledge?: unknown; memorySearchChars?: number; memoryGetChars?: number; contextTargetTokens?: number; contextTriggerTokens?: number; contextRetainRecentMessages?: number; contextMinResultChars?: number; contextMaxPrunes?: number; contextPreviewChars?: number; contextCompactLocators?: boolean; contextRetrievalReceipts?: boolean; contextArchiveCompletedTurns?: boolean; contextOutputReserveTokens?: number; contextToolReserveTokens?: number; contextCompression?: boolean; memoryMaxRequests?: number; memoryMaxTokens?: number }
interface PreStep {
  agent: Agent
  step: number
  turn: number
  signal: AbortSignal
  messages: readonly UserMessage[]
}
interface Decision { kind: string; messages: UserMessage[]; assembly?: { variables?: Record<string, unknown> }; [key: string]: unknown }
interface HostContext {
  tools: { register(def: ToolDefinition): unknown; guard(fn: (exec: { agent?: Agent; name: string }) => string | undefined): unknown }
  connection: { register(owner: Context, channel: string, handler: (endpoint: string, payload?: unknown) => unknown): () => void }
  get(name: string): unknown
  inject(names: string[], mount: (ctx: HostContext) => void): unknown
  on(event: string, listener: (...args: never[]) => unknown): unknown
  effect(fn: () => unknown): unknown
}
/** Registers automatic turn dispatch, the independent button RPC, and manual command/tool entries. */
export function apply(ctx: Context, config: Config, variant: 'ultra' | 'decision' = 'ultra'): Promise<void> {
  const decisionOnly = variant === 'decision'
  const enabledByDefault = decisionOnly && (config as Config & { decisionAssistEnabled?: boolean }).decisionAssistEnabled === true
  if (decisionOnly) config = { ...config, concurrency: 1 }
  modeCount(config.concurrency)
  const host = ctx as unknown as HostContext
  if (ctx.get('ultraCoordinationOwner') !== undefined) throw new Error('Ultra 与 Decision 不能在同一 scope 同时提供协调入口；请选择一个协调插件。')
  ctx.provide('ultraCoordinationOwner', { variant })
  const shutdown = new AbortController()
  const pending = new Set<Promise<void>>()
  const deliveryOnly = new WeakSet<Agent>()
  const sessions = new Map<string, UltraState>()
  const assists = new Map<Agent, { handle: Awaited<ReturnType<typeof startDecisionAssist>>; drained: Promise<void> }>()
  const collaborations = new Map<Agent, CollaborationHostHandle>()
  const collaborationHistory = new Map<string, TeamSnapshot[]>()
  const poolSettings = createModelPoolSettings(ctx as unknown as Parameters<typeof createModelPoolSettings>[0], config, async id => {
    const live = [...collaborations.entries()].find(([agent]) => agent.id === id)?.[1]
    const agent = (host.get('agents') as { get(id: string): Agent | undefined }).get(id)
    const saved = new Map<string, TeamSnapshot>()
    if (agent) for (const record of await readCollaborationAudit(agent)) saved.set(record.id, record)
    for (const record of [...(collaborationHistory.get(id) ?? []), ...(live?.records() ?? [])]) saved.set(record.id, record)
    return [...saved.values()].slice(-128)
  })
  const collaborationTurns = new WeakMap<Agent, boolean>()
  const collaborationFailures = new WeakMap<Agent, string>()
  const collaborationReassembly = new WeakSet<Agent>()
  const assembling = new WeakSet<object>()
  const collaborationAbortListeners = new Map<Agent, () => void>()
  const collaborationClosures = new Map<Agent, Promise<void>>()
  const closeCollaboration = (agent: Agent): Promise<void> => {
    const previous = collaborationClosures.get(agent)
    if (previous) return previous
    const owned = collaborations.get(agent)
    if (!owned) return Promise.resolve()
    collaborationHistory.set(agent.id, [...(collaborationHistory.get(agent.id) ?? []), ...owned.records()].slice(-128))
    while (collaborationHistory.size > config.maxSessions) collaborationHistory.delete(collaborationHistory.keys().next().value!)
    collaborations.delete(agent)
    collaborationAbortListeners.get(agent)?.()
    collaborationAbortListeners.delete(agent)
    // Detach ownership now, but never append native drain events reentrantly
    // from a Session's turn/end publication.
    const closing = Promise.resolve().then(() => owned.close()).finally(() => { collaborationHistory.set(agent.id, owned.records()); pending.delete(closing); collaborationClosures.delete(agent) })
    collaborationClosures.set(agent, closing)
    pending.add(closing)
    return closing
  }
  const runConfigFor = (state: UltraState): RunConfig => ({ ...config, collaborationEnabled: state.collaborationEnabled === true,
    researchTools: [...new Set([...config.researchTools, ...(state.collaborationEnabled ? COLLABORATION_TOOLS : []), ...(memory.config?.evidenceEnabled === false ? [] : ['ultra_memory_search', 'ultra_memory_get', 'ultra_memory_status']), ...evidence.readTools])] })
  const stateFor = (id: string, create = false): UltraState | undefined => {
    const existing = sessions.get(id)
    if (existing !== undefined) { sessions.delete(id); sessions.set(id, existing); return existing }
    if (!create) return undefined
    while (sessions.size >= config.maxSessions) {
      const oldest = [...sessions.entries()].find(([, s]) => s.activeRuns === 0)
      if (oldest === undefined) throw new Error('Ultra 所有状态均在运行中，请稍后再试。')
      sessions.delete(oldest[0])
    }
    const state: UltraState = { enabled: enabledByDefault, collaborationEnabled: config.collaborationEnabled ?? false, concurrency: config.concurrency, activeRuns: 0, phase: 'idle', error: null, lastRun: null }
    sessions.set(id, state)
    return state
  }
  const evidence = acquireEvidenceSupport(ctx, config, { owner: variant, isUltraEnabled: agent => stateFor(agent.id)?.enabled === true, canPublish: canPublishKnowledge })
  const memory = evidence.memory
  const provisionCollaboration = (agent: Agent): boolean => {
    if (shutdown.signal.aborted || collaborations.has(agent) || !collaborationTurns.get(agent) || collaborationFailures.has(agent)) return false
    try {
      collaborations.set(agent, installCollaboration(agent, config, { pool: poolSettings.pool }))
      return true
    } catch (error) {
      const detail = '协作增强未启动：' + String(error) + '。继续使用宿主原有派发能力。'
      collaborationFailures.set(agent, detail)
      const state = stateFor(agent.id, true)!
      state.warnings = [...(state.warnings ?? []), detail]
      return false
    }
  }
  host.on('session/event', ((session: Agent['session'], event: { type: string }) => {
    memory.capture(session, event as Parameters<typeof memory.capture>[1])
    if (event.type !== 'turn/start' && event.type !== 'turn/end') return
    const registry = host.get('agents') as { get(id: Agent['id']): Agent | undefined; roots(): Agent[] }
    const agent = registry.get(session.id)
    if (!agent || agent.session !== session || !registry.roots().includes(agent) || routeParentOf(agent) !== undefined) return
    if (event.type === 'turn/start') {
      collaborationTurns.set(agent, stateFor(agent.id, config.collaborationEnabled === true || enabledByDefault)?.collaborationEnabled === true)
      collaborationFailures.delete(agent)
      // Normal path: tools are present before the SDK snapshots the first
      // assembly. A preceding native drain is awaited by the assembly hook.
      if (collaborationClosures.has(agent)) collaborationReassembly.add(agent)
      else provisionCollaboration(agent)
    } else if (event.type === 'turn/end') {
      collaborationTurns.delete(agent)
      void closeCollaboration(agent).catch(error => {
        const state = sessions.get(agent.id)
        if (state) state.warnings = [...(state.warnings ?? []), '协作收尾失败：' + String(error)]
      })
    }
  }) as never)
  host.on('system-prompt/assemble', (async (_assembly: unknown, context: { agent?: Agent; signal?: AbortSignal }, next: () => Promise<unknown>) => {
    const agent = context.agent
    if (!agent || routeParentOf(agent) !== undefined || assembling.has(context)) return next()
    await collaborationClosures.get(agent)
    context.signal?.throwIfAborted()
    const mounted = provisionCollaboration(agent)
    if (!mounted && !collaborationReassembly.has(agent)) return next()
    collaborationReassembly.delete(agent)
    // Consecutive turns can overlap the previous team's native drain. Rebuild
    // through the public registry once after mounting, preserving toolOrder,
    // PTC presentation and complete prompts instead of editing schema arrays.
    assembling.add(context)
    try { return await (host.get('systemPrompt') as { assemble(context: unknown): Promise<unknown> }).assemble(context) }
    finally { assembling.delete(context) }
  }) as never)
  const execute = async (agent: Agent, task: string, content: ContentBlock[], signal: AbortSignal, count?: number, route?: { provider: string; model: string }): Promise<UltraResult> => {
    if (decisionOnly) throw new Error('Decision 附属包只支持普通 Agent + 单条决策辅助，不提供多路线 Ultra。')
    shutdown.signal.throwIfAborted()
    if (routeParentOf(agent) !== undefined) throw new Error('Ultra 内部路线及其子代理不能递归开启 Ultra。')
    if (deliveryOnly.has(agent)) throw new Error('本轮 Ultra 已交付；下一轮用户消息可开始新任务。')
    const state = stateFor(agent.id, true)!
    if (state.activeRuns > 0) throw new Error('当前会话已有 Ultra 运行；请等待完成或取消。')
    const concurrency = routeCount(count ?? Math.max(2, state.concurrency))
    const startedAt = Date.now()
    state.activeRuns = 1
    state.error = null
    state.warnings = []
    delete state.governance
    let result: UltraResult | undefined
    let drain: Promise<void> | undefined
    try {
      const run = runUltra(runConfigFor(state), { parent: agent, task, content, concurrency, signal: AbortSignal.any([signal, shutdown.signal]), route, phase: phase => { state.phase = phase }, onGovernance: snapshot => { state.governance = governanceStatus(snapshot) } })
      drain = run.then(() => {}, () => {})
      pending.add(drain)
      result = await run
      deliveryOnly.add(agent)
      state.phase = result.decided ? 'completed' : 'failed'
      if (!result.decided) state.error = '决策路线失败；保留报告，但未形成最终交付。'
      return result
    } catch (error) {
      state.phase = signal.aborted || shutdown.signal.aborted ? 'cancelled' : 'failed'
      state.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      state.activeRuns = 0
      if (drain !== undefined) pending.delete(drain)
      state.lastRun = { at: Date.now(), ms: Date.now() - startedAt, requested: concurrency, succeeded: result?.succeeded ?? 0, runId: result?.runId ?? '' }
    }
  }
  const beginAssist = async (agent: Agent, task: string, content: ContentBlock[], signal: AbortSignal, route?: { provider: string; model: string }) => {
    const previous = assists.get(agent)
    if (previous !== undefined) { previous.handle.stop(); await previous.drained }
    const state = stateFor(agent.id, true)!
    const startedAt = Date.now()
    state.activeRuns = 1
    state.phase = 'assisting'
    state.error = null
    state.warnings = []
    delete state.governance
    try {
      const assist = await startDecisionAssist(runConfigFor(state), { parent: agent, task, content, signal: AbortSignal.any([signal, shutdown.signal]), route,
        phase: phase => { state.phase = phase }, onGovernance: snapshot => { state.governance = governanceStatus(snapshot) } })
      if (shutdown.signal.aborted || signal.aborted) {
        assist.stop()
        await assist.done
        throw new Error('决策辅助启动已取消')
      }
      const tracking = { handle: assist, drained: Promise.resolve() }; assists.set(agent, tracking)
      const drain = assist.done.then(outcome => {
        if (assists.get(agent) !== tracking) return
        state.phase = outcome.reason === 'cancelled' ? 'cancelled'
          : outcome.reason === 'timeout' ? 'timed-out' : outcome.reason === 'failed' ? 'failed'
            : outcome.reason === 'stopped' ? 'stopped' : 'completed'
        state.error = outcome.error
        state.warnings = outcome.warnings.slice()
      }, error => {
        if (assists.get(agent) !== tracking) return
        state.phase = signal.aborted || shutdown.signal.aborted ? 'cancelled' : 'failed'
        state.error = error instanceof Error ? error.message : String(error)
      }).finally(() => {
        pending.delete(drain)
        if (assists.get(agent) !== tracking) return
        assists.delete(agent)
        state.activeRuns = 0
        // No independent worker report or task-success claim in normal-agent mode.
        state.lastRun = { at: Date.now(), ms: Date.now() - startedAt, requested: 1, succeeded: 0, runId: assist.runId }
      })
      tracking.drained = drain
      pending.add(drain)
      return assist
    } catch (error) {
      state.activeRuns = 0
      state.phase = signal.aborted || shutdown.signal.aborted ? 'cancelled'
        : error instanceof Error && error.name === 'TimeoutError' ? 'timed-out' : 'failed'
      state.error = error instanceof Error ? error.message : String(error)
      return undefined
    }
  }
  host.tools.guard(exec => {
    if (exec.agent !== undefined && deliveryOnly.has(exec.agent)) return 'Ultra 决策已完成，本轮主会话只负责转述；禁止重复工具操作。'
    if (exec.agent !== undefined && routeParentOf(exec.agent) !== undefined && exec.name === config.toolName) return 'Ultra 内部路线及其子代理不能递归开启 Ultra。'
    return researchToolDenial(exec.agent, exec.name)
  })
  if (!decisionOnly) host.tools.register(defineTool({
    name: config.toolName,
    description: '仅当用户明确请求并行 Ultra 而会话按钮未开启时使用：2–5 条独立 Max 执行路线，加 1 条持续 Max 决策路线规划、实施和收敛。每路保留正常子代理能力。正常 Agent + 决策辅助使用按钮或 /ultra assist，不使用本工具。',
    timeoutMs: config.timeoutMs,
    parameters: { task: { type: 'string', required: true, description: '用户完整任务' }, concurrency: { type: 'integer', enum: [2, 3, 4, 5], description: '独立执行路线数，不含决策路线；不是正常主 Agent 辅助模式' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true }, runId: { type: 'string', required: true }, succeeded: { type: 'integer', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => false,
    async execute(args, exec: ToolRunContext) {
      if (!exec.agent) throw new Error('ultra_task requires a calling agent')
      const task = args.task.trim()
      if (task === '') throw new Error('任务不能为空')
      const result = await execute(exec.agent, task, [{ type: 'text', text: task }], exec.signal, args.concurrency)
      return { text: result.output, runId: result.runId, succeeded: result.succeeded }
    },
  }))
  // This coordinator owns the observer regardless of its lower-priority startup
  // flag. The shared host gates each request against the selected authority.
  host.on('llm/stream', (async function* (options: Parameters<typeof memory.observeRequest>[0], next: () => AsyncIterable<unknown>) {
    memory.observeRequest(options)
    yield* next()
  }) as never)
  host.on('agent/pre-step', (async (payload: PreStep, next: () => Promise<Decision>) => {
    await memory.beforeStep(payload.agent, payload.messages, payload.signal)
    const decision = await next()
    if (decision.kind !== 'enter' || routeParentOf(payload.agent) !== undefined) return decision
    const withRecovery = (value: Decision): Decision => {
      const entry = memory.mainContext?.(payload.agent)
      return !entry ? value : { ...value, messages: [...value.messages, createUserMessage({ content: [{ type: 'text', text: entry }], source: { kind: 'ultra-mode', form: 'notice', summary: 'Ultra 证据恢复入口', runId: '', routeIds: [], decisionId: '' } })] }
    }
    // The SDK claims fresh inbox input at every step, including user steering
    // within the current turn. Step 1 is therefore not the user-task boundary.
    // Only messages actually claimed here and admitted by the remaining hooks
    // can release the prior delivery lock or start another Ultra run. Context
    // notices and historical user messages added by middleware are not input.
    const claimed = payload.messages.filter(m => m.source.kind === 'user')
    const claimedIds = new Set(claimed.map(m => m.id).filter(id => typeof id === 'string' && id !== ''))
    const user = decision.messages.filter(m => m.source.kind === 'user' && (claimed.includes(m) || claimedIds.has(m.id)))
    if (user.length === 0) return withRecovery(decision)
    deliveryOnly.delete(payload.agent)
    const state = stateFor(payload.agent.id, config.collaborationEnabled === true || enabledByDefault)
    if (collaborations.has(payload.agent) && !collaborationAbortListeners.has(payload.agent)) {
      const stop = () => { void closeCollaboration(payload.agent).catch(error => {
        if (state) state.warnings = [...(state.warnings ?? []), '协作收尾失败：' + String(error)]
      }) }
      payload.signal.addEventListener('abort', stop, { once: true })
      collaborationAbortListeners.set(payload.agent, () => payload.signal.removeEventListener('abort', stop))
      if (payload.signal.aborted) stop()
    }
    const detail = collaborationFailures.get(payload.agent)
    if (detail) decision.messages = [...decision.messages, createUserMessage({ content: [{ type: 'text', text: detail }],
      source: { kind: 'ultra-mode', form: 'notice', summary: '协作增强不可用', runId: '', routeIds: [], decisionId: '' } })]
    if (!state?.enabled) {
      const previous = assists.get(payload.agent)
      if (previous !== undefined) { previous.handle.stop(); await previous.drained }
      return decision
    }
    const content = user.flatMap(m => [...m.content])
    const task = content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n')
    const dispatch = payload.agent.ctx as unknown as { waterfall(carrier: unknown, event: string, value: unknown, next: () => Promise<unknown>): Promise<Record<string, unknown>> }
    const selected = await dispatch.waterfall(agentCarrier(payload.agent), 'agent/request', payload, () => Promise.resolve({ ...payload.agent.options }))
    const route = typeof selected.provider === 'string' && typeof selected.model === 'string' ? { provider: selected.provider, model: selected.model } : undefined
    if (state.concurrency === 1) {
      const starting = beginAssist(payload.agent, task || '处理用户附带的材料', content, payload.signal, route)
      const creationDrain = starting.then(() => {}, () => {})
      pending.add(creationDrain)
      let assist: Awaited<ReturnType<typeof beginAssist>>
      try { assist = await starting } finally { pending.delete(creationDrain) }
      return withRecovery({ ...decision, messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text: assist === undefined
          ? '【Ultra 决策辅助未启动】' + state.error + '。继续按正常主 Agent 执行原任务，保留原有工具和权限；没有决策辅助成功的证据。'
          : '【Ultra 决策辅助已启动】你仍是正常主 Agent，照常执行原任务、调用工具和子代理并完成交付；额外只读 Max 决策路线会在后续步骤给出反馈，不会代你实施或交付。' }],
        source: { kind: 'ultra-mode', form: 'notice', summary: '正常 Agent + 1 条自动决策辅助', runId: assist?.runId ?? '', routeIds: [payload.agent.id], decisionId: assist?.decisionId ?? '' },
      })] })
    }
    const previous = assists.get(payload.agent)
    if (previous !== undefined) { previous.handle.stop(); await previous.drained }
    const result = await execute(payload.agent, task || '处理用户附带的材料', content, payload.signal, undefined, route)
    return { ...decision, messages: [...decision.messages, createUserMessage({
      content: [{ type: 'text', text: '【Ultra 决策结果】\n' + result.output + '\n\n以上是本轮决策路线的交付结果。直接转述给用户，保持事实、路径与验证边界。不要调用工具重新实施或再开启 Ultra。' }],
      source: { kind: 'ultra-mode', form: 'notice', summary: `Ultra ${result.requested} + 1：已返回 ${result.succeeded} 条有效路线报告`, runId: result.runId, routeIds: result.routeIds, decisionId: result.decisionId,
        ...(result.coordination === undefined ? {} : { coordination: result.coordination }) },
    })] }
  }) as never)
  host.inject(['systemPrompt'], owner => {
    const service = owner.get('systemPrompt') as { section(value: unknown): unknown }
    service.section({ name: decisionOnly ? 'ultra-decision' : 'ultra-mode', order: config.sectionOrder, text: ({ agent }: { agent?: Agent }) => {
      if (agent === undefined || routeParentOf(agent) !== undefined) return ''
      return renderUltraSection(stateFor(agent.id))
    } })
  })
  host.inject(['commands'], owner => {
    const commands = owner.get('commands') as { register(value: unknown): unknown }
    commands.register({ name: 'team', description: '独立开关：增强子代理协作，不改变 Ultra 模式或主 Agent 思考档位', input: { hint: '[on|off]', attachments: false },
      handler: ({ agent, rawInput }: { agent?: Agent; rawInput?: string }) => {
        const id = resolveSessionKey(agent?.id)
        if (!id || !agent || routeParentOf(agent)) return { kind: 'error', text: '/team 只能用于主会话。' }
        const input = (rawInput ?? '').trim().toLowerCase()
        if (input !== 'on' && input !== 'off' && input !== '') return { kind: 'error', text: '用法：/team on | off' }
        const state = stateFor(id, true)!
        if (input) state.collaborationEnabled = input === 'on'
        return { kind: 'success', text: state.collaborationEnabled ? '子代理协作增强已开启；后续任务生效，Ultra 选项保持原值。' : '子代理协作增强已关闭；后续任务生效，Ultra 选项保持原值。' }
      } })
    commands.register({ name: decisionOnly ? 'decision' : 'ultra', description: decisionOnly ? 'Decision：普通主 Agent + 可选单条只读决策辅助' : 'Ultra：正常 Agent + 自动决策，或 2–5 条 Max 执行路线 + 1 条决策路线', input: { hint: decisionOnly ? '[on|off|assist]' : '[on|off|assist|2|3|4|5]', attachments: false },
      handler: ({ agent, rawInput }: { agent?: Agent; rawInput?: string }) => {
        const id = resolveSessionKey(agent?.id)
        if (id === undefined || (agent !== undefined && routeParentOf(agent) !== undefined)) return { kind: 'error', text: (decisionOnly ? '/decision' : '/ultra') + ' 只能用于主会话。' }
        const state = stateFor(id, true)!
        const input = (rawInput ?? '').trim().toLowerCase()
        if (decisionOnly && !['', 'on', 'off', 'assist'].includes(input)) return { kind: 'error', text: '用法：/decision on | off | assist' }
        if (input === 'off') state.enabled = false
        else if (input === 'on') state.enabled = true
        else if (input === 'assist' || input === '1') { state.concurrency = 1; state.enabled = true }
        else if (['2','3','4','5'].includes(input)) { state.concurrency = Number(input); state.enabled = true }
        else if (input !== '') return { kind: 'error', text: '用法：/ultra on | off | assist | 2 | 3 | 4 | 5' }
        return { kind: 'success', text: decisionOnly ? state.enabled ? 'Decision 辅助已开启：正常主 Agent + 1 条只读 Max 决策路线。' : 'Decision 辅助已关闭。' : state.enabled ? state.concurrency === 1 ? 'Ultra 决策辅助已开启：正常主 Agent + 1 条只读 Max 决策路线。' : `Ultra 已开启：${state.concurrency} 条 Max 执行路线 + 1 条 Max 决策路线。` : 'Ultra 已关闭。' }
      },
    })
  })
  host.inject(['connection', 'webServer'], owner => {
    const connection = owner.connection
    owner.effect(() => connection.register(owner as unknown as Context, '/dsh-ultra-model-pool', async (endpoint, payload) => {
      const data = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
      const id = resolveSessionKey(data.sessionId)
      if (!id) return { ok: false, error: { code: 'missing-session-id', message: 'sessionId is required' } }
      try {
        if (endpoint !== 'get' && endpoint !== 'save') throw new Error('unknown model pool endpoint')
        return { ok: true, value: endpoint === 'save' ? await poolSettings.save(id, data.config) : await poolSettings.get(id) }
      } catch (error) { return { ok: false, error: { code: 'model-pool-setting', message: error instanceof Error ? error.message : String(error) } } }
    }))
    // Explicit owner avoids the installed Cordis RPC getter's shadowed origin.
    owner.effect(() => connection.register(owner as unknown as Context, decisionOnly ? '/dsh-ultra-decision' : '/dsh-ultra-mode', (endpoint, payload) => {
      const data = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
      const id = resolveSessionKey(data.sessionId)
      if (id === undefined) return { ok: false, error: { code: 'missing-session-id', message: 'sessionId is required' } }
      if (endpoint !== 'get' && endpoint !== 'set') return { ok: false, error: { code: 'not-found', message: 'unknown endpoint' } }
      try {
        if (endpoint === 'set') {
          if (data.enabled !== undefined && typeof data.enabled !== 'boolean') throw new Error('enabled must be boolean')
          if (data.collaborationEnabled !== undefined && typeof data.collaborationEnabled !== 'boolean') throw new Error('collaborationEnabled must be boolean')
          if (data.concurrency !== undefined) {
            if (decisionOnly && data.concurrency !== 1) throw new Error('Decision 仅支持 concurrency=1；不提供 2–5 路 Ultra')
            modeCount(data.concurrency)
          }
          const state = stateFor(id, true)!
          if (typeof data.enabled === 'boolean') state.enabled = data.enabled
          if (typeof data.collaborationEnabled === 'boolean') state.collaborationEnabled = data.collaborationEnabled
          if (typeof data.concurrency === 'number') state.concurrency = data.concurrency
        }
        const state = stateFor(id) ?? { enabled: enabledByDefault, collaborationEnabled: config.collaborationEnabled ?? false, concurrency: config.concurrency, activeRuns: 0, phase: 'idle', error: null, lastRun: null }
        const status = memory.status(id)
        return { ok: true, value: { ...snapshotOf(state), ...(status ? { evidence: { ...status, capture: evidence.captureStatus() } } : {}) } }
      } catch (error) {
        return { ok: false, error: { code: 'invalid-setting', message: error instanceof Error ? error.message : String(error) } }
      }
    }))
  })
  // Register last so scoped teardown cancels and drains in-flight routes first.
  host.effect(() => async () => {
    shutdown.abort(new Error('Ultra plugin unloaded'))
    await Promise.allSettled([...collaborations.keys()].map(agent => closeCollaboration(agent)))
    await Promise.allSettled([...pending])
    await evidence.release()
  })
  return evidence.ready()
}
