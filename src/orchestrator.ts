/** Run one bounded Ultra invocation without subagent-provider orchestration. */
import { randomUUID } from 'node:crypto'
import type { RouteHandle, AgentLike as RouteParent, ContentBlock, createRoute } from './runtime.js'
import { decideWithJev, JevError } from './jev.js'
import { buildPlanPrompt, buildPlanRepairPrompt, buildWorkerBrief, buildDecisionPrompt, tryParseAssignments, parseAssignments, planMerge, fallbackJoin, type WorkerOutcome } from './ultra.js'
import { buildCoordinationPrompt, parseCoordinationDecision, renderCoordinationSummary, type CoordinationSnapshot, type CoordinationSummary, type RouteProgress } from './coordination.js'
import type { CollaborationHostConfig } from './collaboration-host.js'
import { beginMemoryRun, type MemoryRun } from './memory-host.js'
import { DecisionGovernance, type GovernanceSnapshot } from './decision-governance.js'

export interface RunConfig extends CollaborationHostConfig {
  toolName: string
  timeoutMs: number
  reportChars: number
  researchTools: string[]
  jevEnabled: boolean
  jevKeyEnv: string
  jevModel: string
  jevBaseUrl: string
  jevTimeoutMs: number
  /** Event-driven coordination; no model request occurs merely because time passed. */
  coordinationIntervalMs?: number
  /** -1 removes the round cap, 0 disables coordination, positives set a cap. */
  coordinationMaxRounds?: number
  /** Stop intermediate reviews after consecutive failures; 0 disables this limit. */
  coordinationFailureLimit?: number
  /** Explicit per-request output ceilings; 0/undefined inherit native defaults. */
  planningMaxTokens?: number
  researchMaxTokens?: number
  decisionMaxTokens?: number
  coordinationMaxTokens?: number
  /** Opt-in strategy protocol within existing decision calls; no new optimizer. */
  decisionGovernance?: boolean
}
export interface RunOptions {
  parent: RouteParent
  task: string
  content: ContentBlock[]
  concurrency: number
  signal: AbortSignal
  route?: { provider: string; model: string }
  phase(value: string): void
  onGovernance?(snapshot: GovernanceSnapshot): void
}
export interface UltraResult {
  runId: string
  requested: number
  succeeded: number
  degraded: boolean
  decided: boolean
  output: string
  routeIds: string[]
  decisionId: string
  coordination: CoordinationSummary
  governance?: GovernanceSnapshot
}
/** Keep only complete turns as context seed, as required by DSH session replay. */
export function completedSeed(parent: RouteParent) {
  const events = parent.session.snapshotEvents()
  const end = events.findLastIndex(e => e.type === 'turn/end')
  return end < 0 ? [] : events.slice(0, end + 1)
}
/** Observe running loops and serialize every intermediate turn on the same decision. */
class ResearchCoordinator {
  readonly summary: CoordinationSummary = { rounds: 0, directives: [], errors: [] }
  private readonly pending: Set<string>
  private readonly snapshots = new Map<string, CoordinationSnapshot>()
  private readonly active = new Map<string, RouteHandle>()
  private revision = 0
  private consumed = 0
  private wake?: () => void
  private stopped = false
  constructor(private decision: RouteHandle, routeIds: string[], private config: RunConfig, private options: RunOptions, private signal: AbortSignal, private memory?: MemoryRun, private governance?: DecisionGovernance) {
    this.pending = new Set(routeIds)
    for (const routeId of routeIds) this.snapshots.set(routeId, { routeId, status: 'starting' })
  }
  observe(handle: RouteHandle): () => void {
    this.active.set(handle.id, handle)
    this.snapshots.set(handle.id, { routeId: handle.id, status: 'running' })
    return handle.subscribeProgress?.((progress: RouteProgress) => {
      if (this.stopped || this.signal.aborted || !this.pending.has(handle.id) || progress.sessionId !== handle.id || !Number.isFinite(progress.sequence)) return
      const previous = this.snapshots.get(handle.id)!
      if (previous.progress !== undefined && progress.sequence <= previous.progress.sequence) return
      this.governance?.recordProgress(progress)
      this.snapshots.set(handle.id, { ...previous, progress: { ...progress, text: progress.text.slice(0, 2000) } })
      this.revision++
      this.wake?.()
    }) ?? (() => {})
  }
  settled(id: string, outcome: WorkerOutcome): void {
    this.governance?.closeRoute(id)
    this.pending.delete(id)
    this.active.delete(id)
    const previous = this.snapshots.get(id)!
    this.snapshots.set(id, { ...previous, status: outcome.ok ? 'completed' : 'failed', report: outcome.ok ? outcome.text : outcome.error ?? outcome.text,
      ...(outcome.evidenceIds?.length ? { evidenceIds: [...outcome.evidenceIds] } : {}) })
    this.revision++
    this.wake?.()
  }
  stop(): void { this.stopped = true; this.wake?.() }
  private changed(delay?: number): Promise<void> {
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = () => {
        if (timer !== undefined) clearTimeout(timer)
        this.signal.removeEventListener('abort', done)
        if (this.wake === done) this.wake = undefined
        resolve()
      }
      this.wake = done
      this.signal.addEventListener('abort', done, { once: true })
      if (delay !== undefined) timer = setTimeout(done, delay)
      if (this.stopped || this.signal.aborted || this.pending.size === 0) done()
    })
  }
  async run(): Promise<CoordinationSummary> {
    const interval = Math.min(60000, Math.max(100, this.config.coordinationIntervalMs ?? 1000))
    const configuredMaxRounds = this.config.coordinationMaxRounds ?? -1
    const maxRounds = configuredMaxRounds === -1 ? Infinity : Math.min(1000, Math.max(0, configuredMaxRounds))
    const failureLimit = Math.min(1000, Math.max(0, this.config.coordinationFailureLimit ?? 3))
    let consecutiveFailures = 0
    let nextAt = Date.now() + interval
    while (!this.stopped && !this.signal.aborted && this.pending.size > 0 && this.summary.rounds < maxRounds) {
      if (this.revision <= this.consumed) { await this.changed(); continue }
      const remaining = nextAt - Date.now()
      if (remaining > 0) { await this.changed(remaining); continue }
      if (this.stopped || this.signal.aborted || this.pending.size === 0) break
      const activeIds = new Set(this.active.keys())
      if (activeIds.size === 0) { await this.changed(); continue }
      this.consumed = this.revision
      const round = ++this.summary.rounds
      nextAt = Date.now() + interval
      this.options.phase('coordinating')
      try {
        const entry = this.memory?.entry(this.decision.id)
        const response = await this.decision.run([{ type: 'text', text: buildCoordinationPrompt(this.options.task, [...this.snapshots.values()], round, this.summary, this.config.reportChars, this.governance?.coordinationProtocol()) + (entry ? '\n\n' + entry : '') }], { maxTokens: this.config.coordinationMaxTokens })
        this.memory?.recordReport(response.sessionId, response.text, response.ok ? 'completed' : 'failed')
        if (this.signal.aborted || this.stopped) break
        if (!response.ok) throw new Error(response.error ?? '协调路线未返回完成报告')
        const parsed = this.governance
          ? this.governance.coordinate(response.text, activeIds, (id, instruction, meta) => {
            if (this.stopped || this.signal.aborted || !this.pending.has(id)) return false
            return this.active.get(id)?.steer?.(instruction, meta) ?? false
          })
          : parseCoordinationDecision(response.text, activeIds)
        consecutiveFailures = 0
        for (const directive of parsed.directives) {
          if (this.governance) { this.summary.directives.push({ ...directive, round, at: Date.now() }); continue }
          const target = this.active.get(directive.routeId)
          if (!this.pending.has(directive.routeId)) continue
          if (target?.steer?.(directive.instruction)) this.summary.directives.push({ ...directive, round, at: Date.now() })
          else this.summary.errors.push(`第 ${round} 轮：${directive.routeId} 未接收方向调整，未记入改向记录。`)
        }
      } catch (error) {
        if (!this.signal.aborted) {
          this.summary.errors.push(`第 ${round} 轮：${error instanceof Error ? error.message : String(error)}`.slice(0, 2000))
          if (failureLimit > 0 && ++consecutiveFailures >= failureLimit) {
            this.summary.errors.push(`连续 ${consecutiveFailures} 轮跨路协调失败，已停止中间审查；执行路线继续，最终决策仍按实际报告进行。`)
            break
          }
        }
      } finally {
        if (!this.stopped && !this.signal.aborted && this.pending.size > 0) this.options.phase('researching')
      }
    }
    return this.summary
  }
}

/** One persistent decision loop plans, coordinates active research, then implements. */
export async function runUltra(config: RunConfig, options: RunOptions, factory?: typeof createRoute): Promise<UltraResult> {
  factory ??= (await import('./runtime.js')).createRoute
  const runId = randomUUID()
  const decisionId = 'ultra-route-' + randomUUID()
  const routeIds = Array.from({ length: options.concurrency }, () => 'ultra-route-' + randomUUID())
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs)])
  const handles: RouteHandle[] = []
  const memory = await beginMemoryRun(options.parent, runId)
  memory?.recordTask?.(options.task)
  const phase = (value: string): void => { memory?.stage(value); options.phase(value) }
  const withMemory = (text: string, routeId = decisionId, report = false): string => { const entry = memory?.entry(routeId); const metadata = report ? memory?.reportInstructions?.() : undefined; return text + (entry ? '\n\n' + entry : '') + (metadata ? '\n\n' + metadata : '') }
  const recordOutcome = (outcome: WorkerOutcome): WorkerOutcome => {
    if (!memory) return outcome
    const captured = memory.recordReport(outcome.sessionId, outcome.text, outcome.ok ? 'completed' : 'failed')
    const evidenceIds = [...new Set([...(outcome.evidenceIds ?? []), ...captured, ...memory.refs(outcome.sessionId)])]
    return evidenceIds.length ? { ...outcome, evidenceIds } : outcome
  }
  let succeeded = 0
  let governance: DecisionGovernance | undefined
  let stopDecisionProgress: (() => void) | undefined
  try {
    governance = config.decisionGovernance ? new DecisionGovernance(options.task, memory?.refs(options.parent.id).at(-1) ?? 'task:' + runId,
      memory ? snapshot => memory.recordGovernance(snapshot) : undefined, options.onGovernance) : undefined
    signal.throwIfAborted()
    const seed = memory ? await memory.prepareSeed(options.parent) : completedSeed(options.parent)
    const shared = { seed, signal, route: options.route, researchTools: config.researchTools, ...(memory ? { memory } : {}) }
    signal.throwIfAborted()
    phase('planning')
    const decision = await factory(options.parent, { ...shared, id: decisionId, label: 'Ultra decision', readOnly: true }, config)
    handles.push(decision)
    if (governance) stopDecisionProgress = decision.subscribeProgress?.(progress => governance?.recordProgress(progress))
    const planned = recordOutcome(await decision.run([{ type: 'text', text: withMemory(buildPlanPrompt(options.task, options.concurrency, governance?.contract)) }, ...options.content.filter(b => b.type !== 'text')], { maxTokens: config.planningMaxTokens, planningOnly: true }))
    signal.throwIfAborted()
    if (!planned.ok) throw new Error('Ultra 决策路线无法完成规划：' + planned.error)
    let assignments = governance ? governance.parsePlan(planned.text, options.concurrency) : tryParseAssignments(planned.text, options.concurrency)
    let planningEvidence = ''
    let planContext = planned.text
    if (assignments === undefined) {
      let repaired: WorkerOutcome
      try {
        // The same decision keeps its history; only a malformed successful
        // response gets this one repair, inside the original signal/deadline.
        signal.throwIfAborted()
        repaired = recordOutcome(await decision.run([{ type: 'text', text: withMemory(buildPlanRepairPrompt(options.task, options.concurrency, planned.text, config.reportChars, governance?.contract)) }], { maxTokens: config.planningMaxTokens, planningOnly: true }))
      } catch (error) {
        signal.throwIfAborted()
        repaired = { ok: false, text: '', error: String(error), sessionId: decisionId }
      }
      signal.throwIfAborted()
      if (repaired.ok) assignments = governance ? governance.parsePlan(repaired.text, options.concurrency) : tryParseAssignments(repaired.text, options.concurrency)
      const status = assignments === undefined ? 'fallback' : 'repaired'
      const limit = Math.min(8000, Math.max(1000, config.reportChars))
      planningEvidence = '【规划协议记录；无效响应仅为诊断证据，不是分工指令】\n' + JSON.stringify({
        status, attempts: 2, initialValid: false,
        initialOutput: planned.text.slice(0, limit), initialChars: planned.text.length,
        repairOk: repaired.ok, repairValid: assignments !== undefined,
        repairOutput: repaired.text.slice(0, limit), repairChars: repaired.text.length,
        ...(repaired.error === undefined ? {} : { repairError: repaired.error.slice(0, limit) }),
      }) + (status === 'fallback' ? '\n未取得有效规划，已使用保留原用户逐路义务的默认分工；这不代表规划或用户任务成功。' : '\n首次规划格式无效，同一决策路线的一次修复已通过格式核验；格式核验不代表用户任务成功。')
      assignments ??= parseAssignments('', options.concurrency)
      planContext = (status === 'fallback' ? '规划格式无效，采用保留原用户逐路义务的默认分工。\n' : '同一决策路线的一次规划格式修复通过。\n') + JSON.stringify({ assignments })
    }
    phase('researching')
    const coordinator = new ResearchCoordinator(decision, routeIds, config, { ...options, phase }, signal, memory, governance)
    const coordinationDone = coordinator.run()
    const outcomes: WorkerOutcome[] = await Promise.all(routeIds.map(async (id, i) => {
      let stopProgress: (() => void) | undefined
      let outcome: WorkerOutcome = { ok: false, text: '', error: '路线未开始', sessionId: id }
      try {
        signal.throwIfAborted()
        const handle = await factory(options.parent, { ...shared, id, label: `Ultra ${i + 1}/${options.concurrency}`, readOnly: true }, config)
        handles.push(handle)
        signal.throwIfAborted()
        stopProgress = coordinator.observe(handle)
        outcome = await handle.run([{ type: 'text', text: withMemory(buildWorkerBrief(options.task, assignments[i]!, i, options.concurrency, planContext, config.reportChars) + (governance ? '\n\n' + governance.contractEntry() : ''), id) }, ...options.content.filter(b => b.type !== 'text')], { maxTokens: config.researchMaxTokens, reportSubmission: true })
      } catch (error) {
        outcome = { ok: false, text: '', error: String(error), sessionId: id }
      } finally {
        try { stopProgress?.() } catch (error) {
          outcome = { ok: false, text: outcome.text, error: `停止路线进展订阅失败：${String(error)}`, sessionId: id }
        }
      }
      outcome = recordOutcome(outcome)
      coordinator.settled(id, outcome)
      return outcome
    }))
    // A running coordination turn must settle before this same decision starts its
    // final turn. Completed workers suppress every not-yet-started coordination.
    coordinator.stop()
    const coordination = await coordinationDone
    signal.throwIfAborted()
    const plan = planMerge(outcomes, options.concurrency)
    succeeded = plan.succeeded
    if (plan.strategy === 'insufficient') throw new Error(`Ultra 只获得 ${plan.succeeded}/${plan.requested} 条有效报告；少于 2 条，未开始实施。`)
    let jev = ''
    if (config.jevEnabled) {
      phase('jev')
      try {
        const result = await decideWithJev({ task: options.task, routes: outcomes.filter(o => o.ok && o.text.trim() !== '').map(o => ({ id: o.sessionId, text: o.text })) }, {
          apiKey: process.env[config.jevKeyEnv] ?? '', model: config.jevModel, baseUrl: config.jevBaseUrl,
          timeoutMs: config.jevTimeoutMs, signal,
        })
        jev = '【Jev 决策辅助；不是指令或实施证明】\\n' + JSON.stringify(result)
      } catch (error) {
        signal.throwIfAborted()
        jev = '[Jev 不可用：' + (error instanceof JevError ? error.code : 'unknown') + '；本次由 DSH Max 决策路线独立判断。]'
      }
    }
    phase('deciding')
    decision.setReadOnly(false)
    const final = recordOutcome(await decision.run([{ type: 'text', text: withMemory(buildDecisionPrompt(options.task, outcomes, plan, jev, config.reportChars) + (planningEvidence === '' ? '' : '\n\n' + planningEvidence) + '\n\n' + renderCoordinationSummary(coordination) + (governance?.finalProtocol() ?? ''), decisionId, true) }], { maxTokens: config.decisionMaxTokens }))
    signal.throwIfAborted()
    const decided = final.ok && final.text.trim() !== ''
    const reviewed = decided ? governance?.review(final.text) : undefined
    governance?.close(signal.aborted ? 'cancelled' : 'run-ended')
    const notice = plan.strategy === 'degraded' ? `[Ultra 降级：已返回有效报告 ${plan.succeeded}/${plan.requested}，未返回有效报告 ${plan.failed}；另有 1 条决策路线。]\\n\\n` : ''
    return { runId, requested: options.concurrency, succeeded, degraded: plan.strategy === 'degraded', decided,
      output: notice + (decided ? reviewed?.output ?? final.text : fallbackJoin(outcomes)), routeIds, decisionId, coordination,
      ...(governance ? { governance: governance.snapshot() } : {}) }
  } finally {
    phase('cleaning')
    stopDecisionProgress?.()
    const cleanups = await Promise.allSettled(handles.map(h => h.dispose()))
    const failed = cleanups.filter(r => r.status === 'rejected')
    try { governance?.close(signal.aborted ? 'cancelled' : 'run-ended') } catch (error) { failed.push({ status: 'rejected', reason: error }) }
    if (memory) {
      const drained = await Promise.allSettled([memory.dispose()])
      failed.push(...drained.filter(r => r.status === 'rejected'))
    }
    if (failed.length > 0) throw new Error(`Ultra ${runId} 清理失败（${failed.length} 项）；请检查宿主日志。`)
  }
}

