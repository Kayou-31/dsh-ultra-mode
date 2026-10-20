/** Independent DSH loops owned by one visible ULTRA conversation. */
import type { Context } from '@deepseek-ai/cordis'
import { agentCarrier, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { RouteProgress } from './coordination.js'
import { installCollaboration, type CollaborationHostConfig, type CollaborationHostHandle } from './collaboration-host.js'
import { memoryFor, type MemoryRun } from './memory-host.js'

export type AgentLike = Agent
export type { ContentBlock, SessionEvent }
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'ultra-steering': { kind: 'ultra-steering'; form: 'feedback'; summary: string; runId?: string }
    'ultra-route-task': { kind: 'ultra-route-task'; summary: string }
  }
}

/** One settled route turn, with the internal log identity retained for diagnostics. */
export interface SubagentIdentity {
  sessionId: string
  parentSession?: string
  origin: 'subagent'
  delegationDepth?: number
}
export interface RouteOutcome {
  ok: boolean
  text: string
  error?: string
  sessionId: string
  evidenceIds?: string[]
  uncertainties?: string[]
  conflicts?: string[]
  /** Observed creation identities only; these do not establish completion. */
  subagents?: SubagentIdentity[]
}

/** Route creation inputs; the signal controls creation and every later turn. */
export interface RouteOptions {
  id: string
  label: string
  seed?: readonly SessionEvent[]
  signal: AbortSignal
  readOnly?: boolean
  researchTools?: readonly string[]
  route?: { provider: string; model: string }
  memory?: MemoryRun
}

export interface RouteRunOptions {
  /** Explicit per-request cap for this turn, including reasoning; 0 inherits. */
  maxTokens?: number
  /** Worker-only public report handoff; never enabled on decision phases. */
  reportSubmission?: boolean
  /** Planning protocol only: no model-visible schemas or executable tools. */
  planningOnly?: boolean
}

export interface SteeringMetadata {
  directiveId: string
  isCurrent?(): boolean
  onDelivery?(status: 'queued' | 'admitted' | 'request-visible', sourceId: string): void
}

/** A persistent decision loop can plan, then receive evidence in a later turn. */
export interface RouteHandle {
  id: string
  run(prompt: ContentBlock[], options?: RouteRunOptions): Promise<RouteOutcome>
  setReadOnly(readOnly: boolean): void
  subscribeProgress?(listener: (progress: RouteProgress) => void): () => void
  steer?(instruction: string, meta?: SteeringMetadata): boolean
  dispose(): Promise<void>
}

interface RouteState {
  parent: Agent
  agent?: Agent
  readOnly: boolean
  researchTools: ReadonlySet<string>
  parentPresentation: ToolPresentation
  attachedAgents: Set<Agent>
  presentations: Map<Agent, { mode: ToolPresentation; dispose: () => void }>
  restrictions: Map<Agent, () => void>
  questionBridges: Map<Agent, { definition: ToolDefinition; dispose?: () => void }>
  subagents: SubagentIdentity[]
  signal: AbortSignal
  running: boolean
  acceptingSteering: boolean
  sequence: number
  progressListeners: Set<(progress: RouteProgress) => void>
  memory?: MemoryRun
  maxTokens?: number
  reportSubmission?: boolean
  planningOnly?: boolean
  steeringDeliveries: Map<string, { text: string; meta?: SteeringMetadata; admitted: boolean; visible: boolean }>
  submittedReport?: { text: string; evidenceIds: string[]; uncertainties: string[]; conflicts: string[] }
  reportClosureFailure?: Error
}

interface PresetService {
  composeFrom(ctx: Context, parentCtx: Context): unknown
}

type ToolPresentation = 'native' | 'ptc' | 'both'
interface ToolService {
  get(name: string, scope?: object): ToolDefinition | undefined
  schemas(scope?: object): { name: string }[]
  register(definition: ToolDefinition): () => void
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
  modeFor(scope?: Agent): ToolPresentation
  presentAs(mode: ToolPresentation): () => void
}

type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
interface SandboxPolicy {
  resolve(request: { session: Agent['session'] }): { mode: SandboxMode }
}
interface ApprovalPolicy {
  effectivePolicy(session: Agent['session']): 'ask' | 'never'
}
/** Continuable children are owned by the native manager, beyond a route's handle. */
interface SubagentLifecycle {
  drainContinuableDescendants?(parents: readonly Agent[]): Promise<void>
  drainDescendants?(parents: readonly Agent[]): Promise<void>
}
/** Optional policy plugins own these known durable events; the loop itself does not type them. */
interface PolicyLog {
  append(name: 'sandbox/mode', data: { mode: SandboxMode; source: 'delegation' }): unknown
  append(name: 'approval/policy', data: { policy: 'ask' | 'never'; source: 'delegation' }): unknown
}

/** Event payloads cross several independently versioned optional capabilities. */
interface RuntimeEvents {
  on(name: string, callback: (payload: Record<string, unknown>, next: () => Promise<unknown>) => unknown, options?: { prepend?: boolean }): () => void
  waterfall(carrier: unknown, name: string, payload: Record<string, unknown>, next: () => Promise<unknown>): Promise<unknown>
}

const routes = new Map<string, RouteState>()
// Retain exact ownership for an orphan whose native teardown failed. Its parent
// may already have left the registry, but its research policy must still apply.
const capabilityOwners = new WeakMap<Agent, RouteState>()
const REPORT_TOOL = 'ultra_submit_report'

/** Whether an identity is a directly owned ULTRA loop rather than its coordinator. */
export function isUltraRoute(id: string): boolean {
  return routes.has(id)
}

/** Follow logged lineage so delegated children retain the route's execution policy. */
function ancestorState(agent: Agent): RouteState | undefined {
  const attached = capabilityOwners.get(agent)
  if (attached !== undefined) return attached
  const visited = new Set<string>()
  let cursor: Agent | undefined = agent
  while (cursor !== undefined && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    const found = routes.get(cursor.id)
    if (found !== undefined) return found
    const parentId: SessionId | undefined = cursor.session.header.parentSession
    cursor = parentId === undefined ? undefined : agent.ctx.agents.get(parentId)
  }
  return undefined
}

/** Global tool guards use this lookup because a subagent joins a preset, not its parent's scope. */
export function isResearchRoute(agent: Agent): boolean {
  return ancestorState(agent)?.readOnly === true
}

/** Return the visible conversation that owns an internal loop or its delegated descendants. */
export function routeParentOf(agent: Agent): Agent | undefined {
  return ancestorState(agent)?.parent
}

/** Knowledge publication is a configured host write, never a delegated research capability. */
export function canPublishKnowledge(agent: Agent): boolean {
  if (agent.status !== 'running') return false
  try {
    const sandbox = agent.ctx.get('sandboxPolicy') as SandboxPolicy | undefined
    if (sandbox?.resolve({ session: agent.session }).mode === 'read-only') return false
  } catch { return false }
  const state = ancestorState(agent)
  return state ? state.agent === agent && state.running && !state.readOnly && !state.planningOnly && !state.signal.aborted
    : agent.session.header.parentSession === undefined
}

/** Apply a route's read-only allow list to every direct or PTC sub-dispatch. */
export function researchToolDenial(agent: Agent | undefined, toolName: string): string | undefined {
  if (agent === undefined) return undefined
  const state = ancestorState(agent)
  if (state?.planningOnly && state.running) return `Ultra planning cannot execute ${toolName}; assign research and user-required actions to the later worker or final decision phase.`
  if (toolName === REPORT_TOOL) return state?.agent === agent && state.readOnly && state.running && state.reportSubmission && !state.signal.aborted && !state.submittedReport
    ? undefined : 'Ultra report submission is available only to the exact active research worker.'
  if (state?.submittedReport) return 'Ultra worker already submitted its public report; no further research dispatch is allowed.'
  if (state?.readOnly !== true) return undefined
  if (toolName === 'ultra_knowledge_publish' || toolName === 'ultra_knowledge_revoke') return 'ULTRA research routes cannot execute knowledge publication or revocation.'
  // PTC can run arbitrary JavaScript, including direct filesystem access outside
  // nested tool dispatch. A tool allow list cannot make that transport read-only.
  // Keep research routes on native tools until confined PTC is verified end to end.
  if (toolName !== 'run_code' && state.researchTools.has(toolName)) return undefined
  return `ULTRA research routes cannot execute ${toolName}; report the proposed change to the decision route.`
}

/** Tools and prompt sections live on preset scopes in DSH 0.2; a fresh loop must join one. */
function composeRoute(childCtx: Context, parent: Agent, child: Agent, toolName: string, state: RouteState): void {
  const presets = childCtx.get('agentPresets') as PresetService | undefined
  if (presets === undefined) throw new Error('ULTRA requires the DSH agent preset registry')
  presets.composeFrom(childCtx, parent.ctx)
  attachRouteCapabilities(childCtx, parent, child, toolName, state)

  const events = childCtx as unknown as RuntimeEvents
  childCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    // restrict({allow: []}) leaves scope-owned tools visible in rc.2. The
    // assembled schema list is the native request/header source of truth.
    return state.planningOnly && state.running ? { ...assembly, tools: [] } : assembly
  }, { prepend: true })
  let previousOverride: number | undefined, originalMaxTokens: unknown
  events.on('agent/request', async (_payload, next) => {
    const resolved = await next() as Record<string, unknown>
    const config: Record<string, unknown> = { ...resolved, reasoningEffort: ReasoningEffortId('max') }
    if (state.maxTokens !== undefined) {
      if (previousOverride === undefined) originalMaxTokens = resolved.maxTokens
      previousOverride = state.maxTokens
      return { ...config, maxTokens: state.maxTokens }
    }
    if (previousOverride !== undefined && resolved.maxTokens === previousOverride) {
      const { maxTokens: _lastOverride, ...withoutOverride } = config
      previousOverride = undefined
      return { ...withoutOverride, ...(originalMaxTokens === undefined ? {} : { maxTokens: originalMaxTokens }) }
    }
    previousOverride = undefined
    return config
  })
}

function outputCap(value: number | undefined): number | undefined {
  if (value === undefined || value === 0) return undefined
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Ultra maxTokens must be a positive safe integer or 0 to inherit')
  return value
}

/** ToolRuntime's successful result carries the native terminal marker. */
function installReportSubmission(state: RouteState, limit: number): () => void {
  const agent = state.agent!, tools = agent.ctx.get('tools') as unknown as ToolService
  if (tools.get(REPORT_TOOL, agent)) throw new Error('Ultra report submission tool conflicts with an existing definition')
  let pending: { callId: string; report: NonNullable<RouteState['submittedReport']> } | undefined
  const releaseResult = agent.ctx.on('tools/result', (exec, result) => {
    if (exec.agent === agent && exec.name === REPORT_TOOL && exec.callId === pending?.callId && !result.isError && result.concludesTurn === true &&
      state.running && state.reportSubmission && !state.signal.aborted) {
      // Native concludesTurn still drains racing next-step input. Retire only
      // this worker's unadmitted feedback before that boundary can claim it.
      state.acceptingSteering = false
      try {
        for (const [sourceId, delivery] of state.steeringDeliveries) {
          if (!delivery.admitted) agent.inbox.remove(sourceId as Parameters<Agent['inbox']['remove']>[0])
        }
        state.submittedReport = pending.report
      } catch (error) {
        // tools/result observers cannot veto the native result. Propagate the
        // failure at pre-step or run settlement rather than hiding it there.
        state.reportClosureFailure = error instanceof Error ? error : new Error(String(error))
      }
    }
    return undefined
  })
  let releaseTool: (() => void) | undefined
  try {
    releaseTool = tools.register(defineTool({
      name: REPORT_TOOL,
      description: `Submit this worker's short public research report (at most ${limit} characters) after collecting the required evidence. This ends only the worker turn; findings remain unverified material for the decision route. Include real accessible original-source/chunk IDs, unresolved unknowns and conflicts. Do not call from planning, coordination, final delivery or descendants.`,
      parameters: { report: { type: 'string', required: true }, evidenceIds: { type: 'array', items: { type: 'string' } }, unknowns: { type: 'array', items: { type: 'string' } }, conflicts: { type: 'array', items: { type: 'string' } } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { accepted: { type: 'boolean', required: true } } }, render: () => [{ type: 'text', text: 'Public research report accepted for decision review. This is not proof of execution or verification.' }] },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        if (exec.agent !== agent || !state.running || !state.readOnly || !state.reportSubmission || state.submittedReport || state.signal.aborted) throw new Error('Ultra report submission requires its exact active research worker')
        exec.signal.throwIfAborted()
        if (typeof args.report !== 'string' || !args.report.trim() || args.report.length > limit) throw new Error(`Ultra public report must contain 1–${limit} characters`)
        const list = (value: readonly string[] | undefined, max: number, chars: number): string[] => {
          if (value === undefined) return []
          if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item.trim() || item.length > chars)) throw new Error('Ultra report metadata must be bounded nonempty strings')
          return [...new Set(value)]
        }
        const evidenceIds = list(args.evidenceIds, 32, 256)
        if (evidenceIds.length) {
          if (!state.memory) throw new Error('Original evidence index unavailable; omit IDs and record the evidence gap')
          const accessible = new Set([...state.memory.store.recordsFor(state.memory.access())].flatMap(record => [record.id, ...record.chunks.map(chunk => chunk.id)]))
          if (evidenceIds.some(id => !accessible.has(id))) throw new Error('Ultra report references an inaccessible or unknown original evidence ID')
        }
        const report = { text: args.report, evidenceIds, uncertainties: list(args.unknowns, 16, 1000), conflicts: list(args.conflicts, 16, 1000) }
        exec.signal.throwIfAborted(); state.signal.throwIfAborted()
        pending = { callId: exec.callId, report }
        exec.concludeTurn()
        return { accepted: true }
      },
    }))
  } catch (error) { releaseResult(); throw error }
  return () => { releaseResult(); releaseTool?.() }
}

/** Publish settled evidence synchronously; listeners cannot interrupt host dispatch. */
function publishProgress(state: RouteState, sessionId: string, kind: RouteProgress['kind'], text: string, evidenceIds?: string[]): void {
  if (!state.running || state.signal.aborted || state.agent === undefined || text.trim() === '') return
  const source = sessionId === state.agent.id ? '' : `${state.subagents.some(identity => identity.sessionId === sessionId) ? '原生子代理' : '内部会话'} ${sessionId} 的已提交进展：\n`
  const progress: RouteProgress = { sessionId: state.agent.id, sequence: ++state.sequence, kind, text: `${source}${text}`.slice(0, 2000), at: Date.now(),
    ...(evidenceIds?.length ? { evidenceIds: [...evidenceIds], originalChars: text.length } : {}) }
  for (const listener of state.progressListeners) {
    try { listener({ ...progress, ...(progress.evidenceIds ? { evidenceIds: [...progress.evidenceIds] } : {}) }) } catch { /* Coordination must not fail tool or session logging. */ }
  }
}

/** A delegated child joins the shared preset but does not inherit route-local hooks. */
function attachRouteCapabilities(childCtx: Context, parent: Agent, child: Agent, toolName: string, state: RouteState): void {
  const tools = childCtx.get('tools') as ToolService | undefined
  if (tools === undefined) throw new Error('ULTRA requires the DSH tools registry')
  // Capture the inherited definition before research visibility masks it. The
  // scoped bridge must remain available when the decision regains its tools.
  const questionTool = tools.get('ask_user_question', child)
  if (inheritedToolNames(tools, child).has(toolName)) tools.restrict({ deny: [toolName] })
  state.attachedAgents.add(child)
  capabilityOwners.set(child, state)
  if (child !== state.agent) state.memory?.bind(child, state.agent!.id)
  childCtx.effect(() => () => {
    state.attachedAgents.delete(child)
    capabilityOwners.delete(child)
    if (child === state.agent) routes.delete(child.id)
    releaseAgentCapabilities(state, child)
  }, 'ultra.routePresentation()')

  const events = childCtx as unknown as RuntimeEvents
  childCtx.on('tools/result', (exec, result) => {
    if (exec.agent?.id !== child.id) return
    const evidenceIds = state.memory?.captureTool(child, exec.callId, exec.name, result)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    publishProgress(state, child.id, 'tool', `${exec.name} (${result.isError ? 'error' : 'result'}):\n${text}`, evidenceIds)
    return undefined
  })
  // Run before the Host's global Remote answerer, which otherwise presents the
  // hidden child scope. Remote forwarding requires request.agent === carrier.
  // Copy only the answerer request: ApprovalService retains the original child
  // for its policy lookup and asked/decided audit, with the same cancellation.
  events.on('approval/request', (request, next) => {
    if (request.agent !== child) return next()
    return (parent.ctx as unknown as RuntimeEvents).waterfall(
      agentCarrier(parent), 'approval/request', { ...request, agent: parent }, () => Promise.resolve('unavailable'),
    )
  }, { prepend: true })

  // DSH's human-question service accepts only live roots. Keep the child tool-call
  // audit, and execute its public question tool with the visible root identity.
  if (questionTool !== undefined) {
    const schema = questionTool.parameters as { properties?: Record<string, unknown> }
    const timed = schema.properties?.timeout !== undefined
    state.questionBridges.set(child, { definition: {
      ...questionTool,
      execute: (args, exec) => questionTool.execute(
        timed && typeof args === 'object' && args !== null ? { ...args, timeout: -1 } : args,
        { ...exec, agent: parent },
      ),
    } })
  }
  updatePresentation(state, child)
}

/** Public parent-scope schemas exclude agent-owned output machinery and bridges. */
function inheritedToolNames(tools: ToolService, agent: Agent): Set<string> {
  const names = new Set(tools.schemas().map(tool => tool.name))
  const parentScope = scopeParentOf(agent)
  if (parentScope !== undefined) for (const tool of tools.schemas(parentScope)) names.add(tool.name)
  // PTC is a reserved presentation transport and cannot appear in restrict().
  names.delete('run_code')
  return names
}

/** Align inherited research schemas with execution policy and restore exact layers. */
function updatePresentation(state: RouteState, agent: Agent): void {
  const tools = agent.ctx.get('tools') as unknown as ToolService
  if (state.readOnly && !state.restrictions.has(agent)) {
    const inherited = inheritedToolNames(tools, agent)
    const allow = [...state.researchTools].filter(name => name !== 'run_code' && inherited.has(name))
    state.restrictions.set(agent, tools.restrict({ allow }))
  } else if (!state.readOnly) {
    const restriction = state.restrictions.get(agent)
    state.restrictions.delete(agent)
    restriction?.()
  }
  const question = state.questionBridges.get(agent)
  if (question !== undefined) {
    if (!state.readOnly || state.researchTools.has('ask_user_question')) {
      question.dispose ??= tools.register(question.definition)
    } else {
      question.dispose?.()
      question.dispose = undefined
    }
  }
  const desired = state.readOnly ? 'native' : state.parentPresentation
  const previous = state.presentations.get(agent)
  if (previous?.mode === desired) return
  previous?.dispose()
  state.presentations.delete(agent)
  // A scoped override is necessary only when the retained preset differs.
  // Its exact disposer removes both mode and any owned PTC prompt sections.
  if (tools.modeFor(agent) !== desired) state.presentations.set(agent, { mode: desired, dispose: tools.presentAs(desired) })
}

/** Attempt every layer even when an individual scoped disposer rejects. */
function releaseAgentCapabilities(state: RouteState, agent: Agent): void {
  const restriction = state.restrictions.get(agent)
  const presentation = state.presentations.get(agent)
  const question = state.questionBridges.get(agent)
  state.restrictions.delete(agent)
  state.presentations.delete(agent)
  state.questionBridges.delete(agent)
  const errors: unknown[] = []
  for (const dispose of [restriction, presentation?.dispose, question?.dispose]) {
    try { dispose?.() } catch (error) { errors.push(error) }
  }
  if (errors.length > 0) throw new AggregateError(errors, `ULTRA capability cleanup failed for ${agent.id}`)
}

/** Keep surviving live agents guarded until their own scoped disposal settles. */
function releaseRouteCapabilities(state: RouteState): void {
  state.running = false
  state.acceptingSteering = false
  state.progressListeners.clear()
  state.steeringDeliveries.clear()
  const errors: unknown[] = []
  for (const agent of [...state.attachedAgents]) {
    if (state.parent.ctx.agents.get(agent.id) === agent) continue
    state.attachedAgents.delete(agent)
    capabilityOwners.delete(agent)
    try { releaseAgentCapabilities(state, agent) } catch (error) { errors.push(error) }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'ULTRA route capability cleanup failed')
}

/** Creation rollback may expose an unpublished setup object; never drain that object. */
async function drainRouteDescendants(state: RouteState): Promise<void> {
  if (state.agent === undefined || state.parent.ctx.agents.get(state.agent.id) !== state.agent) return
  const subagents = state.parent.ctx.get('subagents') as SubagentLifecycle | undefined
  if (subagents?.drainDescendants) await subagents.drainDescendants([state.agent])
  else await subagents?.drainContinuableDescendants?.([state.agent])
}

/** Release observers after native children and the route have settled. */
function finishRouteCleanup(state: RouteState, id: string, disposers: readonly (() => void)[]): void {
  const errors: unknown[] = []
  for (const dispose of [...disposers, () => releaseRouteCapabilities(state)]) {
    try { dispose() } catch (error) { errors.push(error) }
  }
  if (state.agent === undefined || state.parent.ctx.agents.get(SessionId(id)) !== state.agent) routes.delete(id)
  if (errors.length > 0) throw new AggregateError(errors, `ULTRA route ${id} observer cleanup failed`)
}

/** Read only this run's settled log suffix, never inherited answers or earlier decision turns. */
function outcomeOf(agent: Agent, boundary: number, label: string, aborted: boolean, submitted?: RouteState['submittedReport']): RouteOutcome {
  const events = agent.session.snapshotEvents().slice(boundary)
  let text = ''
  let ending: { kind?: string; message?: string } | undefined
  for (const event of events) {
    if (event.type === 'assistant/message') {
      const message = event as SessionEvent<'assistant/message'>
      const candidate = message.data.message.content
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text).join('')
      if (candidate.length > 0) text = candidate
    } else if (event.type === 'turn/end') {
      ending = (event as SessionEvent<'turn/end'>).data.reason
    }
  }
  if (!aborted && ending?.kind === 'completed' && submitted) {
    return { ok: true, text: submitted.text, sessionId: agent.id, evidenceIds: submitted.evidenceIds, uncertainties: submitted.uncertainties, conflicts: submitted.conflicts }
  }
  if (!aborted && ending?.kind === 'completed' && text.length > 0) {
    return { ok: true, text, sessionId: agent.id }
  }
  const reason = aborted ? 'cancelled' : ending?.kind ?? 'no completed turn'
  return {
    ok: false, text, sessionId: agent.id,
    error: `${label}: ${reason}${ending?.message === undefined ? '' : `: ${ending.message}`}`,
  }
}

/** Create a loop without subagent origin or additional delegation depth. */
export async function createRoute(parent: Agent, options: RouteOptions, config: { toolName: string; reportChars?: number } & CollaborationHostConfig): Promise<RouteHandle> {
  options.signal.throwIfAborted()
  if (routes.has(options.id)) throw new Error(`ULTRA route ${options.id} already exists`)
  const inherited = parent.session.requestHeader()?.config ?? parent.options
  const selected = options.route ?? inherited
  if (!selected.provider || !selected.model) throw new Error('ULTRA cannot create a route before provider and model are selected')
  const sandbox = parent.ctx.get('sandboxPolicy') as SandboxPolicy | undefined
  const inheritedMode = sandbox?.resolve({ session: parent.session }).mode
  const approval = parent.ctx.get('approval') as ApprovalPolicy | undefined
  const inheritedApproval = approval?.effectivePolicy(parent.session)
  const parentTools = parent.ctx.get('tools') as ToolService | undefined
  if (parentTools === undefined) throw new Error('ULTRA requires the DSH tools registry')
  const state: RouteState = {
    parent,
    readOnly: options.readOnly === true,
    researchTools: new Set(options.researchTools ?? []),
    parentPresentation: parentTools.modeFor(parent),
    attachedAgents: new Set(),
    presentations: new Map(),
    restrictions: new Map(),
    questionBridges: new Map(),
    subagents: [],
    signal: options.signal,
    running: false,
    acceptingSteering: false,
    sequence: 0,
    progressListeners: new Set(),
    steeringDeliveries: new Map(),
    memory: options.memory ?? memoryFor(parent),
  }
  routes.set(options.id, state)
  const stopSessionEvents = parent.ctx.root.on('session/event', (session, event) => {
    if (session.id === options.id && event.type === 'user/message') {
      const delivery = state.steeringDeliveries.get(event.data.id)
      if (delivery && !delivery.admitted) {
        delivery.admitted = true
        try { delivery.meta?.onDelivery?.('admitted', event.data.id) } catch { /* Observers cannot fail native admission. */ }
      }
    }
    if (session.id === options.id && event.type === 'turn/end') {
      // The loop may still report running at turn/end. Never let late feedback
      // survive completion and wake an extra turn.
      state.acceptingSteering = false
    }
    const observed = parent.ctx.agents.get(session.id)
    if (observed === undefined || !state.attachedAgents.has(observed)) return
    const evidenceIds = state.memory?.captureEvent(session, event)
    if (event.type !== 'assistant/message') return
    const message = event as SessionEvent<'assistant/message'>
    publishProgress(state, session.id, 'assistant', message.data.message.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text).join(''), evidenceIds)
  })
  const stopDeliveryRequests = (parent.ctx.root as unknown as { on(name: string, callback: unknown, options?: unknown): () => void }).on('llm/stream', async function* (request: { sessionId?: string; messages?: { content?: unknown }[] }, next: () => AsyncIterable<unknown>) {
    if (request.sessionId === options.id && Array.isArray(request.messages)) {
      for (const [sourceId, delivery] of state.steeringDeliveries) {
        const visible = request.messages.some(message => Array.isArray(message.content) && message.content.some((block: { type?: string; text?: string }) => block.type === 'text' && block.text === delivery.text))
        if (visible && !delivery.visible && delivery.meta?.isCurrent?.() === false) {
          throw new Error(`Ultra expired or superseded steering ${sourceId} was already admitted; refusing the model request without rewriting its recorded history`)
        }
        if (!delivery.visible && delivery.admitted && visible) {
          delivery.visible = true
          try { delivery.meta?.onDelivery?.('request-visible', sourceId) } catch { /* Observer only. */ }
        }
      }
    }
    yield* next()
  }, { prepend: true })
  const stopExpiredSteering = (parent.ctx.root as unknown as RuntimeEvents).on('agent/pre-step', async (payload, next) => {
    if (payload.agent === state.agent) {
      if (state.reportClosureFailure) throw state.reportClosureFailure
      for (const [sourceId, delivery] of state.steeringDeliveries) {
        if (!delivery.visible && delivery.meta?.isCurrent?.() === false) state.agent?.inbox.remove(sourceId as Parameters<Agent['inbox']['remove']>[0])
      }
    }
    return next()
  })
  // The registry's serial creation notification precedes the child's first turn.
  // Listen at deployment scope: lifecycle ownership is independent of preset scopes.
  const stopDescendants = (parent.ctx.root as unknown as RuntimeEvents).on('agent/created', payload => {
    const descendant = payload.agent as Agent
    if (descendant.id !== options.id && ancestorState(descendant) === state) {
      const header = descendant.session.header
      if (header.origin === 'subagent') state.subagents.push({
        sessionId: descendant.id,
        ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
        origin: header.origin,
        ...(header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth }),
      })
      attachRouteCapabilities(descendant.ctx, parent, descendant, config.toolName, state)
    }
  })
  let handle: Awaited<ReturnType<typeof parent.ctx.agents.create>>
  try {
    handle = await parent.ctx.agents.create({
      sessionId: SessionId(options.id),
      parentAgent: parent,
      meta: {
        ...(parent.session.header.cwd === undefined ? {} : { cwd: parent.session.header.cwd }),
        parentSession: parent.id,
        isSeeded: (options.seed?.length ?? 0) > 0,
      },
      ...(options.seed === undefined ? {} : {
        seed: options.seed,
        inheritedEventCount: SessionLogOffset(options.seed.length),
      }),
      agentOptions: {
        provider: selected.provider,
        model: selected.model,
        reasoningEffort: ReasoningEffortId('max'),
        ...(parent.options.maxTokens === undefined ? {} : { maxTokens: parent.options.maxTokens }),
      },
      signal: options.signal,
      setup: (childCtx, child) => {
        state.agent = child
        composeRoute(childCtx, parent, child, config.toolName, state)
        const policyLog = child.session as unknown as PolicyLog
        if (inheritedMode !== undefined) policyLog.append('sandbox/mode', {
          mode: state.readOnly ? 'read-only' : inheritedMode, source: 'delegation',
        })
        if (inheritedApproval !== undefined) policyLog.append('approval/policy', {
          policy: inheritedApproval, source: 'delegation',
        })
      },
    })
  } catch (error) {
    const failures: unknown[] = [error]
    try { await drainRouteDescendants(state) } catch (failure) { failures.push(failure) }
    try { finishRouteCleanup(state, options.id, [stopDescendants, stopSessionEvents, stopDeliveryRequests, stopExpiredSteering]) } catch (failure) { failures.push(failure) }
    if (failures.length > 1) throw new AggregateError(failures, `ULTRA route ${options.id} creation and rollback failed`)
    throw error
  }
  const child = handle.agent
  let collaboration: CollaborationHostHandle | undefined
  try {
    state.memory?.bind(child, options.id)
    // The ordinary model pool must not reroute Ultra workers/decision or their delegates.
    if (config.collaborationEnabled) collaboration = installCollaboration(child, { ...config, collaborationModelPool: undefined })
  } catch (error) {
    const failures: unknown[] = [error]
    try { await drainRouteDescendants(state) } catch (failure) { failures.push(failure) }
    try { await handle.dispose() } catch (failure) { failures.push(failure) }
    try { finishRouteCleanup(state, options.id, [stopDescendants, stopSessionEvents, stopDeliveryRequests, stopExpiredSteering]) } catch (failure) { failures.push(failure) }
    throw failures.length > 1 ? new AggregateError(failures, 'Ultra collaboration installation and rollback failed') : error
  }
  let active = false
  let disposal: Promise<void> | undefined
  const onAbort = (): void => {
    state.acceptingSteering = false
    child.cancel({ kind: 'parent' })
  }
  options.signal.addEventListener('abort', onAbort, { once: true })
  if (options.signal.aborted) onAbort()
  return {
    id: options.id,
    subscribeProgress(listener) {
      if (disposal !== undefined) return () => {}
      state.progressListeners.add(listener)
      return () => { state.progressListeners.delete(listener) }
    },
    steer(instruction, meta) {
      if (!active || !state.acceptingSteering || state.submittedReport || options.signal.aborted || disposal !== undefined ||
        child.status !== 'running' || typeof instruction !== 'string' || instruction.trim() === '') return false
      // Public native next-step delivery keeps the same driver/turn and is
      // durably recorded by the loop even when the current request ends in text.
      // A governed envelope carries up to 2000 instruction + 1000 stop-condition
      // characters and its separator; preserve it within a bounded transport.
      const feedback = createUserMessage({
        content: [{ type: 'text', text: `Ultra 决策研究改向：不扩权、原任务优先。以下仅为下一步研究反馈，继续遵守现有工具、权限和委派深度限制。\n${instruction.trim().slice(0, meta ? 4000 : 2000)}` }],
        source: { kind: 'ultra-steering', form: 'feedback', summary: 'Ultra 运行中研究方向反馈' },
      })
      state.steeringDeliveries.set(feedback.id, { text: feedback.content.filter(block => block.type === 'text').map(block => block.text).join(''), ...(meta ? { meta } : {}), admitted: false, visible: false })
      try { child.steer(feedback) } catch (error) { state.steeringDeliveries.delete(feedback.id); throw error }
      try { meta?.onDelivery?.('queued', feedback.id) } catch { /* Observer only. */ }
      state.memory?.recordDelivery?.(feedback.id, child.id, 'queued')
      return true
    },
    setReadOnly(readOnly) {
      if (active) throw new Error('ULTRA cannot change route access while a turn is running')
      if (disposal !== undefined) throw new Error('ULTRA route is disposed')
      const mode = readOnly ? 'read-only' : inheritedMode
      if (mode !== undefined) (child.session as unknown as PolicyLog).append('sandbox/mode', { mode, source: 'delegation' })
      state.readOnly = readOnly
      for (const attached of state.attachedAgents) updatePresentation(state, attached)
    },
    async run(prompt, runOptions = {}) {
      if (active) throw new Error('ULTRA route already has an active turn')
      if (disposal !== undefined) throw new Error('ULTRA route is disposed')
      state.maxTokens = outputCap(runOptions.maxTokens) ?? outputCap(parent.options.maxTokens)
      if (runOptions.planningOnly && runOptions.reportSubmission) throw new Error('Ultra planning cannot enable a worker report terminal')
      if (runOptions.reportSubmission && !state.readOnly) throw new Error('Ultra report submission is restricted to read-only worker turns')
      const boundary = child.session.seq
      const subagentBoundary = state.subagents.length
      const identities = (outcome: RouteOutcome): RouteOutcome => {
        if (state.memory) {
          const captured = state.memory.recordReport(child.id, outcome.text, outcome.ok ? 'completed' : 'failed')
          const evidenceIds = [...new Set([...(outcome.evidenceIds ?? []), ...captured, ...state.memory.refs(child.id)])]
          if (evidenceIds.length) outcome = { ...outcome, evidenceIds }
        }
        const observed = state.subagents.slice(subagentBoundary)
        return observed.length === 0 ? outcome : { ...outcome, subagents: observed.map(identity => ({ ...identity })) }
      }
      if (options.signal.aborted) return identities(outcomeOf(child, boundary, options.label, true))
      active = true
      state.running = true
      state.reportSubmission = runOptions.reportSubmission === true
      state.planningOnly = runOptions.planningOnly === true
      state.submittedReport = undefined
      state.reportClosureFailure = undefined
      state.acceptingSteering = true
      state.sequence = 0
      let releaseReport: (() => void) | undefined
      try {
        if (state.reportSubmission) releaseReport = installReportSubmission(state, Math.min(12000, Math.max(1000, config.reportChars ?? 12000)))
        child.followup(createUserMessage({ content: prompt, source: { kind: 'ultra-route-task', summary: options.label } }))
        await child.whenIdle()
        if (state.reportClosureFailure) throw state.reportClosureFailure
        return identities(outcomeOf(child, boundary, options.label, options.signal.aborted, state.submittedReport))
      } catch (error) {
        return identities({ ok: false, text: '', sessionId: child.id, error: `${options.label}: ${error instanceof Error ? error.message : String(error)}` })
      } finally {
        releaseReport?.()
        active = false
        state.running = false
        state.reportSubmission = false
        state.planningOnly = false
        state.submittedReport = undefined
        state.reportClosureFailure = undefined
        state.acceptingSteering = false
      }
    },
    dispose() {
      return disposal ??= (async () => {
        state.acceptingSteering = false
        const failures: unknown[] = []
        if (collaboration) try { await collaboration.close() } catch (error) { failures.push(error) }
        try { await drainRouteDescendants(state) } catch (error) { failures.push(error) }
        try { await handle.dispose() } catch (error) { failures.push(error) }
        options.signal.removeEventListener('abort', onAbort)
        try { finishRouteCleanup(state, options.id, [stopDescendants, stopSessionEvents, stopDeliveryRequests, stopExpiredSteering]) } catch (error) { failures.push(error) }
        if (failures.length > 0) throw new AggregateError(failures, `ULTRA route ${options.id} teardown failed`)
      })()
    },
  }
}

/** Execute a single route turn and drain its owned loop even after cancellation or failure. */
export async function runRoute(
  parent: Agent,
  options: RouteOptions & { prompt: ContentBlock[] },
  config: { toolName: string },
): Promise<RouteOutcome> {
  const route = await createRoute(parent, options, config)
  try { return await route.run(options.prompt) } finally { await route.dispose() }
}
