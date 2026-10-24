/** Experimental, model-free completed-turn archival for verified DSH 0.2.1-rc.2.
 * Canonical evidence and a sealed recovery capsule must be durable before commit.
 * A committed cross-role replacement is never disguised as an exact rollback.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { estimateRequestBudget, type RequestBudget } from './context-memory.js'
import { isTaskMemorySnapshot } from './task-memory-context.js'

export interface ContextArchiveReceipt {
  id: string
  text: string
  durable: true
  sessionId: string
  sourceSeqs: readonly number[]
}
export interface ContextArchiveConfig {
  enabled?: boolean
  targetTokens?: number
  triggerTokens?: number
  retainRecentMessages?: number
  outputReserveTokens?: number
  toolReserveTokens?: number
}
export interface ContextArchiveOptions {
  session: Session
  readEvents(): Promise<readonly SessionEvent[]>
  checkpoint(): Promise<void>
  prepare(events: readonly SessionEvent[]): Promise<ContextArchiveReceipt>
  estimateMessage(message: unknown): number
  measureInputTokens?: () => number | undefined
  authority?: { protocol: 'dsh-0.2.1-rc.2'; soleOwner: boolean; owner?: object }
  getCompactionOwner?: () => unknown
  config?: ContextArchiveConfig
  system?: string
  tools?: readonly unknown[]
  pendingMessages?: readonly unknown[]
  signal?: AbortSignal
}
export interface ContextArchiveOutcome {
  status: 'disabled' | 'unsupported' | 'unchanged' | 'limited' | 'archived'
  committed: boolean
  persistenceUncertain: false
  rawHistoryRetained: true
  before: RequestBudget
  after: RequestBudget
  triggerTokens: number
  selectedSeqs: number[]
  receiptId?: string
  startSeq?: number
  /** Deterministic local-template summary; never a provider LLM call. */
  summarySeq?: number
  /** Legacy result compatibility only. The summary protocol never sets this. */
  pruneSeq?: number
  replacementSeq?: number
  endSeq?: number
  limits: string[]
}
export class ContextArchiveFailure extends Error {
  readonly rawHistoryRetained = true
  readonly originalSurfaceRetained: boolean
  constructor(readonly stage: string, readonly committed: boolean, readonly persistenceUncertain: boolean,
    readonly receiptId: string | undefined, readonly replacementSeq: number | undefined, readonly lifecycleClosed: boolean, options?: ErrorOptions) {
    super(`Context archive failed during ${stage}; ${committed ? 'replacement committed; stop further model/business work' : 'original surface retained'}`, options)
    this.name = 'ContextArchiveFailure'
    this.originalSurfaceRetained = !committed
  }
}
type Value = Record<string, any>
const object = (value: unknown): Value | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Value : undefined
const message = (event: SessionEvent): Value | undefined => event.type === 'user/message' ? object(event.data) : object((event.data as any).message)
const blocks = (event: SessionEvent): Value[] => Array.isArray(message(event)?.content) ? message(event)!.content : []
const ownArchive = (event: SessionEvent) => event.type === 'user/message' && message(event)?.source?.kind === 'compact-checkpoint' && /^arc_[a-f0-9]{64}$/u.test(message(event)?.source?.compactionId ?? '')
const ownNotice = (event: SessionEvent) => event.type === 'user/message' && message(event)?.source?.kind === 'ultra-mode' && message(event)?.source?.form === 'notice' && message(event)?.source?.summary === '项目证据恢复入口'
const active = new WeakSet<object>()
function integer(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 0) throw new TypeError(`Invalid archive ${label}`)
  return result
}
function balanced(events: readonly SessionEvent[]): boolean {
  const pending = new Set<string>()
  for (const event of events) {
    if (event.type === 'assistant/message') for (const block of blocks(event)) {
      if (block.type !== 'tool-call') continue
      if (typeof block.id !== 'string' || pending.has(block.id)) return false
      pending.add(block.id)
    }
    if (event.type === 'tool/result') {
      const msg = message(event), id = msg?.toolCallId
      if (typeof id !== 'string' || msg?.source?.kind !== 'tool' || msg.source.callId !== id || !pending.delete(id)) return false
    }
  }
  return pending.size === 0
}
function lifecycle(events: readonly SessionEvent[]) {
  let open: { turn: number; seq: number } | undefined, compaction: string | undefined
  const turns = new Map<number, { start: number; end?: number; completed?: boolean }>(), membership = new Map<number, number>()
  for (const event of events) {
    const data = event.data as any, type: string = event.type
    if (type === 'turn/start') {
      if (open || !Number.isSafeInteger(data.turn)) throw new Error('Invalid native turn boundary')
      open = { turn: data.turn, seq: event.seq }; turns.set(data.turn, { start: event.seq })
    }
    if (open) membership.set(event.seq, open.turn)
    if (type === 'turn/end') {
      if (!open || open.turn !== data.turn) throw new Error('Unmatched native turn end')
      const turn = turns.get(data.turn)!
      turn.end = event.seq; turn.completed = data.reason?.kind === 'completed'; open = undefined
    }
    if (type === 'compaction/start') {
      if (compaction !== undefined) throw new Error('Native compaction lock already active')
      compaction = data.compactionId
    }
    if (type === 'compaction/end') {
      if (compaction !== data.compactionId) throw new Error('Unmatched native compaction close')
      compaction = undefined
    }
    if (type === 'session/end-seed') compaction = undefined
  }
  return { open, compaction, turns, membership }
}
/** Only a completed positional prefix after protected host instructions may move. */
function selectPrefix(visible: readonly SessionEvent[], events: readonly SessionEvent[], retain: number): SessionEvent[] {
  const state = lifecycle(events)
  if (state.compaction !== undefined) throw new Error('Native compaction lock already active')
  const turnOf = (event: SessionEvent): number | undefined => ['assistant/message', 'tool/result'].includes(event.type)
    ? (event.data as any).turn : state.membership.get(event.seq)
  const eligible = (event: SessionEvent) => {
    const turn = state.turns.get(turnOf(event)!)
    return turn?.completed === true && turn.end !== undefined && (state.open === undefined || turn.end < state.open.seq)
  }
  const lastIndex = new Map<number, number>()
  visible.forEach((event, index) => { const turn = turnOf(event); if (turn !== undefined) lastIndex.set(turn, index) })
  let start = 0
  visible.forEach((event, index) => { if (event.type === 'system/message' || event.type === 'developer/message') start = index + 1 })
  const cutoff = Math.max(start, visible.length - retain)
  let end = start - 1
  for (let index = start; index < cutoff; index++) {
    if (!eligible(visible[index])) break
    const turn = turnOf(visible[index])
    if (turn !== undefined && lastIndex.get(turn) === index && balanced(visible.slice(start, index + 1))) end = index
  }
  return end < start ? [] : visible.slice(start, end + 1)
}

/** The caller owns evidence, authorization and sealed-manifest persistence.
 * This module owns one native replacement, never model summarization or raw-log deletion.
 */
export async function archiveSession(context: ContextArchiveOptions): Promise<ContextArchiveOutcome> {
  const config = context.config ?? {}, targetTokens = integer(config.targetTokens, 30000, 'target'), triggerTokens = integer(config.triggerTokens, targetTokens, 'trigger')
  if (!targetTokens || triggerTokens < targetTokens) throw new TypeError('Archive trigger must be greater than or equal to a positive target')
  const settings = { targetTokens, outputReserveTokens: integer(config.outputReserveTokens, 4096, 'output reserve'), toolReserveTokens: integer(config.toolReserveTokens, 2048, 'tool reserve') }
  const empty = estimateRequestBudget({ ...settings, system: context.system, tools: context.tools, messages: context.pendingMessages })
  const result: ContextArchiveOutcome = { status: 'unchanged', committed: false, persistenceUncertain: false, rawHistoryRetained: true, before: empty, after: empty, triggerTokens, selectedSeqs: [], limits: [] }
  const refuse = (status: ContextArchiveOutcome['status'], reason: string) => { result.status = status; result.limits.push(reason); return result }
  if (!config.enabled) return refuse('disabled', 'Completed-turn archival is disabled.')
  const session = context.session
  if (context.authority?.protocol !== 'dsh-0.2.1-rc.2' || context.authority.soleOwner !== true
    || session.header?.version !== 4 || session.header.id !== session.id || !Array.isArray(session.surface?.nodes)
    || typeof session.append !== 'function' || typeof session.deriveEventMessage !== 'function' || typeof context.estimateMessage !== 'function') return refuse('unsupported', 'Verified official 0.2.1-rc.2 sole archive authority is required.')
  const foreign = () => { const owner = context.getCompactionOwner?.(); return owner !== undefined && owner !== null && owner !== context.authority?.owner }
  if (foreign()) return refuse('unsupported', 'A foreign native compaction owner is active.')
  if (active.has(session)) return refuse('limited', 'Another archive transaction is active for this session.')
  active.add(session)
  let stage = 'observe', committed = false, checkpointed = false, closing = false, closed = false, receipt: ContextArchiveReceipt | undefined
  let start: { seq: number } | undefined, owner: number | null = null
  try {
    context.signal?.throwIfAborted()
    const seq = session.seq, generation = session.surface.replaceGeneration, nodes = [...session.surface.nodes]
    const stable = () => session.seq === seq && session.surface.replaceGeneration === generation && session.surface.nodes.length === nodes.length && session.surface.nodes.every((node, index) => node === nodes[index])
    const guard = () => { context.signal?.throwIfAborted(); if (!stable() || foreign()) throw new Error('Archive source surface or authority changed before commit') }
    const events = await context.readEvents()
    guard()
    if (events.length !== seq || events.some((event, index) => event.seq !== index)) return refuse('limited', 'Canonical history is incomplete or noncontiguous.')
    const visible = nodes.map(node => events[node])
    if (visible.some(event => event === undefined) || !balanced(visible)) return refuse('limited', 'Native surface contains incomplete or mismatched tool identities.')
    const budget = () => estimateRequestBudget({ ...settings, system: context.system, tools: context.tools,
      messages: [...session.surface.nodes.map(node => session.deriveEventMessage(node < events.length ? events[node] : appended.get(node)!)).filter(value => value !== null), ...(context.pendingMessages ?? [])], nativeInputEstimate: context.measureInputTokens?.() })
    const appended = new Map<number, SessionEvent>()
    result.before = budget(); result.after = result.before
    if (result.before.totalTokens <= triggerTokens) return result
    const nativeState = lifecycle(events)
    if (nativeState.open && visible.some(event => event.type === 'tool/result' && (event.data as any).turn === nativeState.open!.turn
      && context.estimateMessage(session.deriveEventMessage(event)) > targetTokens)) return refuse('limited', 'A large current-turn tool result is protected until normal pruning safely replaces its visible body.')
    const selected = selectPrefix(visible, events, integer(config.retainRecentMessages, 8, 'recent window'))
    if (!selected.length) return refuse('limited', 'No complete earlier-turn prefix outside the current/recent/protected host context is available.')
    if (selected.some(event => !['user/message', 'assistant/message', 'tool/result'].includes(event.type)
      || blocks(event).some(block => !['text', ...(event.type === 'assistant/message' ? ['reasoning', 'thinking', 'tool-call'] : [])].includes(block.type)))) return refuse('limited', 'Rich or unknown content is protected from archival.')
    if (selected.some(event => event.type === 'assistant/message' && blocks(event).some(block => block.type === 'tool-call' && String(block.name).startsWith('ultra_knowledge_')))) return refuse('limited', 'Global knowledge calls and results are protected from archival.')
    result.selectedSeqs = selected.map(event => event.seq)
    stage = 'checkpoint-before'; await context.checkpoint(); guard()
    stage = 'prepare'; receipt = await context.prepare(selected); guard()
    if (receipt?.durable !== true || receipt.sessionId !== session.id || !/^arc_[a-f0-9]{64}$/u.test(receipt.id)
      || typeof receipt.text !== 'string' || !receipt.text.trim() || !Array.isArray(receipt.sourceSeqs)
      || receipt.sourceSeqs.length !== selected.length || receipt.sourceSeqs.some((node, index) => node !== selected[index].seq)) return refuse('limited', 'Sealed same-session archive receipt is missing or does not match the selected source nodes.')
    for (const event of selected) if ((event.type === 'user/message' || event.type === 'assistant/message') && !ownArchive(event) && !ownNotice(event) && !isTaskMemorySnapshot(event)) {
      for (const block of blocks(event)) if (block.type === 'text' && typeof block.text === 'string' && block.text
        && !receipt.text.includes(block.text) && !receipt.text.includes(JSON.stringify(block.text))) return refuse('limited', 'Archive capsule does not preserve exact human/public assistant text.')
    }
    const replacement = createUserMessage({ content: [{ type: 'text', text: receipt.text }], source: { kind: 'compact-checkpoint', compactionId: receipt.id } as never })
    const prices = selected.map(event => context.estimateMessage(session.deriveEventMessage(event)))
    const replacementPrice = context.estimateMessage(replacement)
    if (prices.some(price => !Number.isSafeInteger(price) || price < 0) || !Number.isSafeInteger(replacementPrice) || replacementPrice < 0) return refuse('unsupported', 'Official shadow-price meter returned an invalid count.')
    const shadowedTokenCount = prices.reduce((sum, price) => sum + price, 0)
    if (!Number.isSafeInteger(shadowedTokenCount) || replacementPrice >= shadowedTokenCount) return refuse('limited', 'The exact recovery capsule is not smaller than the selected prefix.')
    stage = 'checkpoint-precommit'; await context.checkpoint(); guard()
    owner = nativeState.open?.turn ?? null
    const compactionId = receipt.id
    const append = session as unknown as { append(type: string, data: unknown, options?: unknown): SessionEvent }
    // No awaits: one whole balanced span changes at a single surface boundary.
    stage = 'commit'; start = append.append('compaction/start', { compactionId, turn: owner }); result.startSeq = start.seq
    // Native persisted lifecycle requires one summary before a successful end.
    // The official unmarked-template variant records a local backend identity,
    // omitting every LLM-call/usage field. This single event supplies the price.
    const summary = append.append('compaction/summary', { compactionId, summary: replacement.content,
      shadowedRange: { start: selected[0].seq, end: selected.at(-1)!.seq }, shadowedSeqs: [...result.selectedSeqs], shadowedTokenCount,
      provider: 'dsh-ultra-local', model: 'completed-turn-archive-v1' }); result.summarySeq = summary.seq
    const landed = append.append('user/message', replacement, { surfaceOp: { op: 'replace', startSeq: selected[0].seq, endSeq: selected.at(-1)!.seq }, sourceEventSeqs: [start.seq, summary.seq, ...result.selectedSeqs] })
    appended.set(landed.seq, landed); result.replacementSeq = landed.seq; result.receiptId = receipt.id; committed = true; result.committed = true
    closing = true; const end = append.append('compaction/end', { compactionId, turn: owner }); closed = true; result.endSeq = end.seq
    stage = 'checkpoint-after'; await context.checkpoint(); checkpointed = true
    stage = 'measure-after'; result.after = budget(); result.status = 'archived'
    if (!result.after.withinBudget) result.limits.push('Soft target remains exceeded; protected/current content and exact public constraints were retained.')
    return result
  } catch (error) {
    if (start && !closing) {
      closing = true
      try {
        const append = session as unknown as { append(type: string, data: unknown): SessionEvent }
        const end = append.append('compaction/end', { compactionId: receipt!.id, turn: owner, error: 'Archive did not commit cleanly.' })
        closed = true; result.endSeq = end.seq
      } catch { /* An unmatched native lock remains visible; never fabricate a rollback. */ }
    }
    throw new ContextArchiveFailure(stage, committed, committed && !checkpointed, receipt?.id, result.replacementSeq, closed, { cause: error })
  } finally { active.delete(session) }
}
