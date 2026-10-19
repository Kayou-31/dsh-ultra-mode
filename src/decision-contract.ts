/**
 * Independent implementation inspired by dsh-prompt-optimizer's source attribution,
 * diagnostic stopping conditions and evidence-based three-state review protocol.
 * Reference: https://github.com/WestFox-AwA/dsh-prompt-optimizer/tree/main/po06/lib
 * No upstream implementation, runtime, shell hooks or configuration is included.
 */
import { createHash } from 'node:crypto'

export interface IntentItem {
  readonly id: string
  readonly text: string
  readonly provenance: 'user' | 'machine'
  readonly quote?: string
  readonly sourceId?: string
}
export interface TaskIntent {
  readonly goals: readonly IntentItem[]
  readonly constraints: readonly IntentItem[]
  readonly acceptance: readonly IntentItem[]
  readonly assumptions: readonly IntentItem[]
}
export interface TaskContract {
  readonly originalTask: string
  readonly sourceId: string
  readonly sha256: string
  readonly revision: number
  readonly intent: TaskIntent
}

const ITEM_LIMIT = 32
const TEXT_LIMIT = 2000
const PROTOCOL_LIMIT = 64000
const ID_LIMIT = 200

function fail(message: string): never { throw new Error(`decision-contract: ${message}`) }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('expected object')
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return fail('expected plain object')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('unknown field')
}
function text(value: unknown, limit = TEXT_LIMIT): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) return fail('invalid or oversized text')
  return value
}
function id(value: unknown): string { return text(value, ID_LIMIT) }
function decode(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    if (raw.length > PROTOCOL_LIMIT) fail('protocol exceeds size limit')
    return object(JSON.parse(raw))
  }
  return object(raw)
}
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
function originalCriterion(task: string, sourceId: string): IntentItem {
  return { id: 'task-result', text: task, provenance: 'user', quote: task, sourceId }
}

/** Full original input is immutable and never silently shortened or replaced. */
export function createTaskContract(task: string, sourceId = 'user-task'): TaskContract {
  text(task, Number.MAX_SAFE_INTEGER)
  id(sourceId)
  const original = originalCriterion(task, sourceId)
  return freeze({ originalTask: task, sourceId, sha256: createHash('sha256').update(task).digest('hex'), revision: 1,
    intent: { goals: [original], constraints: [], acceptance: [original], assumptions: [] } })
}

/** Models supply quoted excerpts or labelled machine suggestions, never authorization. */
export function parseTaskIntent(raw: unknown, contract: TaskContract): TaskIntent {
  const parsed = decode(raw)
  const groups = ['goals', 'constraints', 'acceptance', 'assumptions'] as const
  keys(parsed, groups)
  const used = new Set<string>()
  const result = {} as Record<typeof groups[number], IntentItem[]>
  for (const group of groups) {
    const items = parsed[group]
    if (!Array.isArray(items) || items.length > ITEM_LIMIT || ((group === 'goals' || group === 'acceptance') && items.length === 0)) fail(`invalid ${group}`)
    result[group] = items.map(rawItem => {
      const item = object(rawItem)
      keys(item, ['id', 'text', 'provenance', 'quote', 'sourceId'])
      const itemId = id(item.id), itemText = text(item.text)
      if (used.has(itemId)) fail('duplicate intent item id')
      used.add(itemId)
      if (itemId === 'task-result' && (group !== 'acceptance' || item.provenance !== 'user' || itemText !== contract.originalTask)) fail('task-result is reserved for the complete original task')
      if (item.provenance === 'user') {
        const quote = text(item.quote)
        if (item.sourceId !== contract.sourceId || !contract.originalTask.includes(quote)) fail('user attribution needs an original excerpt and host source')
        // A paraphrase could invert the excerpt's meaning; user-labelled text stays verbatim.
        if (itemText !== quote) fail('user text must equal its original excerpt; label paraphrases machine')
        return { id: itemId, text: itemText, provenance: 'user' as const, quote, sourceId: contract.sourceId }
      }
      if (item.provenance !== 'machine' || item.quote !== undefined || item.sourceId !== undefined) fail('machine additions cannot claim human provenance')
      return { id: itemId, text: itemText, provenance: 'machine' as const }
    })
  }
  return freeze(result)
}

export function withTaskIntent(contract: TaskContract, raw: unknown): TaskContract {
  const parsed = parseTaskIntent(raw, contract)
  // Extracting an easy sub-condition must never remove the complete original obligation.
  const acceptance = [originalCriterion(contract.originalTask, contract.sourceId), ...parsed.acceptance.filter(item => item.id !== 'task-result')]
  return freeze({ ...contract, intent: { ...parsed, acceptance } })
}

/** Instructions for the existing planning call; this does not add a model invocation. */
export function buildIntentInstruction(contract: TaskContract): string {
  return `任务契约 revision=${contract.revision} sha256=${contract.sha256} sourceId=${JSON.stringify(contract.sourceId)}。可在本次计划 JSON 增加 intent：` +
    '{"goals":[],"constraints":[],"acceptance":[],"assumptions":[]}。每项为 {"id":"唯一ID","text":"原话摘录或模型补充","provenance":"user|machine"}；goals、acceptance 至少一项，每组最多32项。' +
    'user 项必须附 quote 和 sourceId，quote 必须为用户任务的连续原文，text 必须等于 quote，sourceId 必须等于上述宿主来源；转述、推论和建议一律标 machine，且不带 quote/sourceId。' +
    'machine 内容不构成用户授权或新增硬性验收门槛。task-result 为宿主保留的完整原文验收ID，不得挪用；宿主始终保留此整体条件。保留否定、约束和原文；摘要不能替代原始任务。'
}

export function renderContractEntry(contract: TaskContract): string {
  return `【宿主任务契约 revision=${contract.revision} sha256=${contract.sha256} sourceId=${JSON.stringify(contract.sourceId)}】\n` +
    `【用户原始任务全文】\n${contract.originalTask}\n【结构化意图，仅作辅助】\n${JSON.stringify(contract.intent)}\n` +
    'user 为原话摘录；machine 为模型补充，不能增加授权或硬性验收要求。原文始终优先，未列入摘要的要求仍然有效。'
}

export interface VerificationCriterion {
  readonly criterionId: string
  readonly status: 'satisfied' | 'failed' | 'unverified'
  readonly evidenceIds: readonly string[]
  readonly reason: string
}
export interface VerificationReport {
  readonly criteria: readonly VerificationCriterion[]
  readonly assessment: 'model'
  readonly hostVerified: false
  readonly allSatisfied: boolean
}
function evidenceList(raw: unknown, known: ReadonlySet<string>, required: boolean): string[] {
  if (!Array.isArray(raw) || raw.length > ITEM_LIMIT || (required && !raw.length)) return fail('invalid evidence list')
  const result = raw.map(value => id(value))
  if (new Set(result).size !== result.length || result.some(value => !known.has(value))) fail('unknown or duplicate evidence source')
  return result
}

/** Claims remain model assessments even when every cited ID exists in host evidence. */
export function parseVerificationReport(raw: unknown, contract: TaskContract, knownEvidenceIds: ReadonlySet<string>): VerificationReport {
  const parsed = decode(raw)
  keys(parsed, ['criteria'])
  if (!Array.isArray(parsed.criteria) || parsed.criteria.length > ITEM_LIMIT + 1) fail('invalid verification criteria')
  const expected = new Set(contract.intent.acceptance.map(item => item.id)), seen = new Set<string>()
  const criteria: VerificationCriterion[] = parsed.criteria.map(rawCriterion => {
    const criterion = object(rawCriterion)
    keys(criterion, ['criterionId', 'status', 'evidenceIds', 'reason'])
    const criterionId = id(criterion.criterionId)
    if (!expected.has(criterionId) || seen.has(criterionId)) fail('unknown or duplicate criterion')
    seen.add(criterionId)
    const status = criterion.status
    if (status !== 'satisfied' && status !== 'failed' && status !== 'unverified') fail('invalid verification status')
    return { criterionId, status, evidenceIds: evidenceList(criterion.evidenceIds, knownEvidenceIds, status !== 'unverified'), reason: text(criterion.reason) }
  })
  const required = new Set(contract.intent.acceptance.filter(item => item.provenance === 'user').map(item => item.id))
  if ([...required].some(criterionId => !seen.has(criterionId))) fail('verification must cover every user criterion')
  return freeze({ criteria, assessment: 'model', hostVerified: false,
    allSatisfied: required.size > 0 && criteria.filter(item => required.has(item.criterionId)).every(item => item.status === 'satisfied') })
}

export type DiagnosticType = 'redirect' | 'verify' | 'stop'
export type DiagnosticStatus = 'queued' | 'admitted' | 'request-visible' | 'effect-verified' | 'cancelled' | 'expired'
export interface DiagnosticEnvelope {
  readonly taskRevision: number
  readonly taskHash: string
  readonly targetRouteId: string
  readonly type: DiagnosticType
  readonly reason: string
  readonly evidenceIds: readonly string[]
  readonly instruction: string
  readonly stopCondition: string
  readonly ttlMs: number
  readonly replaces?: string
}
export interface DiagnosticContext { activeIds: ReadonlySet<string>; sourceIds: ReadonlySet<string> }
export interface DiagnosticRecord extends DiagnosticEnvelope {
  readonly id: string
  readonly status: DiagnosticStatus
  readonly createdAt: number
  readonly expiresAt: number
  readonly wasRequestVisible: boolean
  readonly requestSourceId?: string
  readonly effectSourceId?: string
  readonly closeReason?: string
}
export interface DiagnosticLedgerOptions { maxTtlMs?: number; maxRecords?: number; now?: () => number }

/**
 * Bounded host-owned state. Model JSON cannot upgrade delivery or observation state.
 * Host callers alone invoke lifecycle methods using their actual observed source IDs.
 * An observed effect is an independently established result, not an arbitrary later tool.
 */
export class DiagnosticLedger {
  private readonly history: DiagnosticRecord[] = []
  private readonly clock: () => number
  private readonly maxTtlMs: number
  private readonly maxRecords: number
  constructor(private readonly contract: TaskContract, options: DiagnosticLedgerOptions = {}) {
    this.clock = options.now ?? Date.now
    this.maxTtlMs = options.maxTtlMs ?? 600000
    this.maxRecords = options.maxRecords ?? 128
    if (!Number.isSafeInteger(this.maxTtlMs) || this.maxTtlMs <= 0 || this.maxTtlMs > 600000 || !Number.isSafeInteger(this.maxRecords) || this.maxRecords <= 0 || this.maxRecords > 4096) fail('invalid ledger limits')
  }
  private time() {
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0) return fail('invalid host clock')
    return now
  }
  private pending(record: DiagnosticRecord) { return record.status === 'queued' || record.status === 'admitted' || record.status === 'request-visible' }
  private replace(record: DiagnosticRecord, change: Partial<DiagnosticRecord>): DiagnosticRecord {
    const updated = freeze({ ...record, ...change })
    this.history[this.history.findIndex(item => item.id === record.id)] = updated
    return updated
  }
  private get(recordId: string): DiagnosticRecord {
    this.expire()
    return this.history.find(item => item.id === recordId) ?? fail('unknown directive id')
  }
  expire(): readonly DiagnosticRecord[] {
    const now = this.time(), closed: DiagnosticRecord[] = []
    for (const record of this.history) if (this.pending(record) && now >= record.expiresAt) closed.push(this.replace(record, { status: 'expired', closeReason: 'ttl-expired' }))
    return freeze(closed)
  }
  records(): readonly DiagnosticRecord[] { this.expire(); return Object.freeze([...this.history]) }
  propose(raw: unknown, context: DiagnosticContext): DiagnosticRecord {
    const parsed = decode(raw)
    keys(parsed, ['taskRevision', 'taskHash', 'targetRouteId', 'type', 'reason', 'evidenceIds', 'instruction', 'stopCondition', 'ttlMs', 'replaces'])
    if (parsed.taskRevision !== this.contract.revision || parsed.taskHash !== this.contract.sha256) fail('stale or foreign task')
    const targetRouteId = id(parsed.targetRouteId)
    if (!context.activeIds.has(targetRouteId)) fail('inactive or foreign route')
    const type = parsed.type
    if (type !== 'redirect' && type !== 'verify' && type !== 'stop') fail('invalid diagnostic type')
    const evidenceIds = evidenceList(parsed.evidenceIds, context.sourceIds, true)
    const reason = text(parsed.reason), instruction = text(parsed.instruction), stopCondition = text(parsed.stopCondition, 1000)
    const ttlMs = parsed.ttlMs
    if (typeof ttlMs !== 'number' || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > this.maxTtlMs) fail('invalid diagnostic ttl')
    const replaces = parsed.replaces === undefined ? undefined : id(parsed.replaces)
    this.expire()
    const routeHistory = this.history.filter(item => item.targetRouteId === targetRouteId)
    const fingerprint = (entry: Pick<DiagnosticEnvelope, 'type' | 'instruction' | 'evidenceIds'>) => JSON.stringify([entry.type, entry.instruction, [...entry.evidenceIds].sort()])
    const candidate: Pick<DiagnosticEnvelope, 'type' | 'instruction' | 'evidenceIds'> = { type, instruction, evidenceIds }
    const duplicate = routeHistory.find(item => fingerprint(item) === fingerprint(candidate))
    if (duplicate) return duplicate // No TTL renewal and no replay of a closed directive.
    const priorSources = new Set(routeHistory.flatMap(item => [...item.evidenceIds]))
    if (routeHistory.length && evidenceIds.every(source => priorSources.has(source))) fail('changed direction requires new evidence')
    const pending = routeHistory.find(item => this.pending(item))
    if (pending ? replaces !== pending.id : replaces !== undefined) fail('replacement must name the current pending directive')
    if (this.history.length >= this.maxRecords) fail('ledger capacity reached')
    const now = this.time()
    if (!Number.isSafeInteger(now + ttlMs)) fail('ttl exceeds host clock range')
    if (pending) this.replace(pending, { status: 'cancelled', closeReason: 'superseded' })
    const record: DiagnosticRecord = freeze({ taskRevision: this.contract.revision, taskHash: this.contract.sha256, targetRouteId, type,
      reason, evidenceIds, instruction, stopCondition, ttlMs, ...(replaces ? { replaces } : {}),
      id: `directive:${this.history.length + 1}`, status: 'queued', createdAt: now, expiresAt: now + ttlMs, wasRequestVisible: false })
    this.history.push(record)
    return record
  }
  admit(recordId: string): DiagnosticRecord {
    const record = this.get(recordId)
    if (record.status !== 'queued') fail('only queued directives can be admitted')
    return this.replace(record, { status: 'admitted' })
  }
  markRequestVisible(recordId: string, sourceId: string): DiagnosticRecord {
    const record = this.get(recordId)
    id(sourceId)
    if (record.status !== 'admitted') fail('only admitted directives can become request-visible')
    return this.replace(record, { status: 'request-visible', wasRequestVisible: true, requestSourceId: sourceId })
  }
  recordObservedEffect(recordId: string, sourceId: string): DiagnosticRecord {
    const record = this.get(recordId)
    id(sourceId)
    if (record.status !== 'request-visible') fail('effect requires a live request-visible directive and independent host observation')
    return this.replace(record, { status: 'effect-verified', effectSourceId: sourceId })
  }
  cancel(recordId: string, reason: string): DiagnosticRecord {
    const record = this.get(recordId)
    text(reason)
    if (!this.pending(record)) fail('only pending directives can be cancelled')
    // requestSourceId and wasRequestVisible survive; cancellation cannot retract a request.
    return this.replace(record, { status: 'cancelled', closeReason: reason })
  }
}
