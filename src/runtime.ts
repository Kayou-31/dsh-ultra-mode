/** Independent DSH loops owned by one visible ULTRA conversation. */
import type { Context } from '@deepseek-ai/cordis'
import { agentCarrier, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { RouteProgress } from './coordination.js'

export type AgentLike = Agent
export type { ContentBlock, SessionEvent }

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
}

/** A persistent decision loop can plan, then receive evidence in a later turn. */
export interface RouteHandle {
  id: string
  run(prompt: ContentBlock[]): Promise<RouteOutcome>
  setReadOnly(readOnly: boolean): void
  subscribeProgress?(listener: (progress: RouteProgress) => void): () => void
  steer?(instruction: string): boolean
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
/** Optional policy plugins own these known durable events; the loop itself does not type them. */
interface PolicyLog {
  append(name: 'sandbox/mode', data: { mode: SandboxMode; source: 'delegation' }): unknown
  append(name: 'approval/policy', data: { policy: 'ask' | 'never'; source: 'delegation' }): unknown
}

/** Event payloads cross several independently versioned optional capabilities. */
interface RuntimeEvents {
  on(name: string, callback: (payload: Record<string, unknown>, next: () => Promise<unknown>) => unknown): () => void
  waterfall(carrier: unknown, name: string, payload: Record<string, unknown>, next: () => Promise<unknown>): Promise<unknown>
}

const routes = new Map<string, RouteState>()

/** Whether an identity is a directly owned ULTRA loop rather than its coordinator. */
export function isUltraRoute(id: string): boolean {
  return routes.has(id)
}

/** Follow logged lineage so delegated children retain the route's execution policy. */
function ancestorState(agent: Agent): RouteState | undefined {
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

/** Apply a route's read-only allow list to every direct or PTC sub-dispatch. */
export function researchToolDenial(agent: Agent | undefined, toolName: string): string | undefined {
  if (agent === undefined) return undefined
  const state = ancestorState(agent)
  if (state?.readOnly !== true) return undefined
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
  events.on('agent/request', async (_payload, next) => ({
    ...(await next() as Record<string, unknown>),
    reasoningEffort: ReasoningEffortId('max'),
  }))
}

/** Publish settled evidence synchronously; listeners cannot interrupt host dispatch. */
function publishProgress(state: RouteState, sessionId: string, kind: RouteProgress['kind'], text: string): void {
  if (!state.running || state.signal.aborted || state.agent === undefined || text.trim() === '') return
  const source = sessionId === state.agent.id ? '' : `${state.subagents.some(identity => identity.sessionId === sessionId) ? '原生子代理' : '内部会话'} ${sessionId} 的已提交进展：\n`
  const progress: RouteProgress = { sessionId: state.agent.id, sequence: ++state.sequence, kind, text: `${source}${text}`.slice(0, 2000), at: Date.now() }
  for (const listener of state.progressListeners) {
    try { listener({ ...progress }) } catch { /* Coordination must not fail tool or session logging. */ }
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
  childCtx.effect(() => () => {
    state.attachedAgents.delete(child)
    const presentation = state.presentations.get(child)
    state.presentations.delete(child)
    presentation?.dispose()
    const restriction = state.restrictions.get(child)
    state.restrictions.delete(child)
    restriction?.()
    const question = state.questionBridges.get(child)
    state.questionBridges.delete(child)
    question?.dispose?.()
  }, 'ultra.routePresentation()')

  const events = childCtx as unknown as RuntimeEvents
  childCtx.on('tools/result', (exec, result) => {
    if (exec.agent?.id !== child.id) return
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    publishProgress(state, child.id, 'tool', `${exec.name} (${result.isError ? 'error' : 'result'}):\n${text}`)
    return undefined
  })
  // The approval audit remains on the calling loop; only the visible answerer scope changes.
  events.on('approval/request', (request) => (parent.ctx as unknown as RuntimeEvents).waterfall(
    agentCarrier(parent), 'approval/request', request, () => Promise.resolve('unavailable'),
  ))

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

/** Teardown also releases child layers if creation or a handle's disposal failed. */
function releaseRouteCapabilities(state: RouteState): void {
  for (const dispose of state.restrictions.values()) dispose()
  state.restrictions.clear()
  for (const presentation of state.presentations.values()) presentation.dispose()
  state.presentations.clear()
  for (const question of state.questionBridges.values()) question.dispose?.()
  state.questionBridges.clear()
  state.attachedAgents.clear()
  state.running = false
  state.acceptingSteering = false
  state.progressListeners.clear()
}

/** Read only this run's settled log suffix, never inherited answers or earlier decision turns. */
function outcomeOf(agent: Agent, boundary: number, label: string, aborted: boolean): RouteOutcome {
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
export async function createRoute(parent: Agent, options: RouteOptions, config: { toolName: string }): Promise<RouteHandle> {
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
  }
  routes.set(options.id, state)
  const stopSessionEvents = parent.ctx.root.on('session/event', (session, event) => {
    if (session.id === options.id && event.type === 'turn/end') {
      // The loop may still report running at turn/end. Never let late feedback
      // survive completion and wake an extra turn.
      state.acceptingSteering = false
    }
    if (event.type !== 'assistant/message') return
    const observed = parent.ctx.agents.get(session.id)
    if (observed === undefined || !state.attachedAgents.has(observed)) return
    const message = event as SessionEvent<'assistant/message'>
    publishProgress(state, session.id, 'assistant', message.data.message.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text).join(''))
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
    stopDescendants()
    stopSessionEvents()
    releaseRouteCapabilities(state)
    routes.delete(options.id)
    throw error
  }
  const child = handle.agent
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
    steer(instruction) {
      if (!active || !state.acceptingSteering || options.signal.aborted || disposal !== undefined ||
        child.status !== 'running' || typeof instruction !== 'string' || instruction.trim() === '') return false
      // Public native next-step delivery keeps the same driver/turn and is
      // durably recorded by the loop even when the current request ends in text.
      child.steer(createUserMessage({
        content: [{ type: 'text', text: `Ultra 决策研究改向：不扩权、原任务优先。以下仅为下一步研究反馈，继续遵守现有工具、权限和委派深度限制。\n${instruction.trim().slice(0, 2000)}` }],
        source: { kind: 'user' },
      }))
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
    async run(prompt) {
      if (active) throw new Error('ULTRA route already has an active turn')
      if (disposal !== undefined) throw new Error('ULTRA route is disposed')
      const boundary = child.session.seq
      const subagentBoundary = state.subagents.length
      const identities = (outcome: RouteOutcome): RouteOutcome => {
        const observed = state.subagents.slice(subagentBoundary)
        return observed.length === 0 ? outcome : { ...outcome, subagents: observed.map(identity => ({ ...identity })) }
      }
      if (options.signal.aborted) return outcomeOf(child, boundary, options.label, true)
      active = true
      state.running = true
      state.acceptingSteering = true
      state.sequence = 0
      try {
        child.followup(createUserMessage({ content: prompt, source: { kind: 'user' } }))
        await child.whenIdle()
        return identities(outcomeOf(child, boundary, options.label, options.signal.aborted))
      } catch (error) {
        return identities({ ok: false, text: '', sessionId: child.id, error: `${options.label}: ${error instanceof Error ? error.message : String(error)}` })
      } finally {
        active = false
        state.running = false
        state.acceptingSteering = false
      }
    },
    dispose() {
      return disposal ??= (async () => {
        options.signal.removeEventListener('abort', onAbort)
        try { await handle.dispose() } finally {
          stopDescendants()
          stopSessionEvents()
          releaseRouteCapabilities(state)
          routes.delete(options.id)
        }
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
