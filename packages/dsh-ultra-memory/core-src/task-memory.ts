/** Engineering memory packets. Reuses the layering/relevance/provenance pattern,
 * not the Memory-Continuity runtime, schema, or personal data. */
import { createHash } from 'node:crypto'
import type { EvidenceAccess, EvidenceStore, SemanticRecord } from './evidence.js'

export const TASK_LAYERS = ['constraints', 'current', 'decisions', 'history', 'unfinished'] as const
export type TaskLayer = typeof TASK_LAYERS[number]
export interface TaskMemoryConfig {
  taskMemoryEnabled?: boolean
  taskMemoryMaxBytes?: number
  taskMemoryConditionalRecall?: boolean
  taskMemoryRecallLimit?: number
}
export interface TaskMemorySettings { enabled: boolean; maxBytes: number; recall: boolean; recallLimit: number }
export function taskMemorySettings(config: TaskMemoryConfig): TaskMemorySettings {
  const integer = (value: number | undefined, fallback: number, min: number, max: number) => {
    if (value === undefined) return fallback
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError('Invalid task memory budget')
    return value
  }
  return { enabled: config.taskMemoryEnabled !== false, maxBytes: integer(config.taskMemoryMaxBytes, 8192, 2048, 65536),
    recall: config.taskMemoryConditionalRecall !== false, recallLimit: integer(config.taskMemoryRecallLimit, 6, 0, 16) }
}
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
const excerpt = (value: string, max: number) => Array.from(value).slice(0, max).join('') + (Array.from(value).length > max ? '…' : '')
const stop = new Set(['the', 'and', 'this', 'that', 'with', 'from', 'please', 'current', 'project', '继续', '现在', '这个', '项目', '任务', '一下', '进行', '查看'])
export function memoryTerms(query: string): string[] {
  const result = new Set<string>()
  for (const match of query.toLowerCase().matchAll(/[\p{L}\p{N}_./-]+/gu)) {
    const word = match[0]
    if (/\p{Script=Han}/u.test(word)) {
      for (let i = 0; i + 1 < word.length; i++) { const token = word.slice(i, i + 2); if (!stop.has(token)) result.add(token) }
    } else if (word.length > 2 && !stop.has(word)) result.add(word)
  }
  return [...result].slice(0, 32)
}
interface Candidate { id: string; layer: TaskLayer; text: string; sourceIds: string[]; mandatory: boolean; rank: number; reason: string; audit: boolean; sourceStatus?: string }
export interface TaskMemoryEntry { id: string; layer: TaskLayer; selected: boolean; mandatory: boolean; reason: string; sourceIds: string[]; sourceStatus: string; bytes: number; bodySha256: string }
export interface TaskMemoryPacket {
  schema: 'ultra-task-memory/v1'; revision: string; projectId: string; stateId?: string; stateRevision?: number; stateAt?: number
  freshness: 'recorded-evidence-only'; text: string; blocked: boolean; reason?: string
  layers: Record<TaskLayer, string[]>; entries: TaskMemoryEntry[]; omitted: number; queryTerms: string[]
  operationCounts: { planned: number; executed: number; verified: number }
  sourceChecks: { id: string; status: string; sha256?: string }[]
}

export async function buildTaskMemory(input: { store: EvidenceStore; access: EvidenceAccess; rootSessionId?: string; query?: string; config: TaskMemorySettings }): Promise<TaskMemoryPacket> {
  const { store, access, config } = input
  const query = (input.query ?? '').slice(0, 4096), terms = memoryTerms(query)
  const state = store.projectState(access), semantic = store.semantics(access)
  const sources = new Map([...store.recordsFor(access)].map(source => [source.id, source]))
  const layers = Object.fromEntries(TASK_LAYERS.map(layer => [layer, []])) as unknown as Record<TaskLayer, string[]>
  const candidates: Candidate[] = [], checks = new Map<string, { id: string; status: string; sha256?: string }>()
  const add = (value: Omit<Candidate, 'id'> & { id?: string }) => candidates.push({ ...value, id: value.id ?? 'mem_' + sha([value.layer, value.text, value.sourceIds]).slice(0, 24) })
  const stateSources = state ? [state.id] : []
  const stateCandidate = (layer: TaskLayer, label: string, text: string, mandatory = false, rank = 50) => add({ layer, text: label + ': ' + text, sourceIds: stateSources, mandatory, rank: mandatory ? 20000 : rank, reason: mandatory ? 'mandatory' : 'current_state', audit: false })
  if (state) {
    stateCandidate('constraints', '记录的目标（后续用户要求优先）', state.goal, true)
    for (const text of state.constraints ?? []) stateCandidate('constraints', '约束', text, true)
    for (const text of state.acceptance ?? []) stateCandidate('constraints', '验收标准', text, true)
    for (const text of (state.progress ?? []).slice(-8)) stateCandidate('current', '记录的进度', text)
    for (const text of (state.next ?? []).slice(0, 8)) stateCandidate('unfinished', '下一步', text)
    for (const text of (state.blockers ?? []).slice(0, 8)) stateCandidate('unfinished', '阻塞', text, false, 90)
    for (const operation of (state.operations ?? []).slice(-12)) add({ id: 'operation:' + operation.id, layer: operation.status === 'planned' ? 'unfinished' : 'current',
      text: `[${operation.status}] ${operation.description}`, sourceIds: operation.sourceIds, mandatory: false, rank: 60, reason: 'recorded_operation', audit: true })
  }
  const related = (record: SemanticRecord) => {
    const haystack = [record.text, ...record.files, ...record.topics].join(' ').toLowerCase()
    return terms.filter(term => haystack.includes(term)).length
  }
  // Do not guess which human messages are dispensable. Preserve later root
  // instructions in order even for a generic "continue" query. Oversized core
  // instructions disable new compression instead of silently dropping them.
  const rootRequirements = semantic.filter(record => record.kind === 'requirement'
    && record.sourceIds.length === 1 && record.id === 'requirement_' + record.sourceIds[0] && record.sourceIds.every(id => {
      const source = sources.get(id)
      return source?.sessionId === input.rootSessionId && source?.kind === 'user/message'
    })).sort((a, b) => Math.min(...a.sourceIds.map(id => sources.get(id)!.at)) - Math.min(...b.sourceIds.map(id => sources.get(id)!.at)) || a.at - b.at || a.id.localeCompare(b.id))
  const protectedIds = new Set(rootRequirements.map(record => record.id))
  for (const [index, record] of rootRequirements.entries()) if (record.text !== state?.goal) add({ id: record.id, layer: 'constraints',
    text: `用户要求 ${index + 1}（按原顺序，较晚要求优先）: ${record.text}`, sourceIds: record.sourceIds,
    mandatory: true, rank: 10000 - index, reason: 'mandatory', audit: false, sourceStatus: 'recorded-user-text' })
  const eligible = semantic.filter(record => record.status !== 'superseded' && !protectedIds.has(record.id))
  const visible = eligible.sort((a, b) => related(b) - related(a) || b.at - a.at || a.id.localeCompare(b.id)).slice(0, 128)
  for (const record of visible) {
    const layer: TaskLayer = record.kind === 'decision' ? 'decisions' : record.kind === 'question' || record.status === 'unresolved' ? 'unfinished' : 'history'
    const matched = config.recall && terms.length > 0 && related(record) > 0
    add({ id: record.id, layer, text: `[${record.kind}/${record.status}${record.conflicts.length ? '/有冲突待核对' : ''}] ${record.text}`, sourceIds: record.sourceIds,
      mandatory: false, rank: 30 + related(record), reason: matched ? 'query_matched' : 'condition_not_matched', audit: true })
  }
  // Original tool evidence is retrieved only for explicit current-query terms.
  // AND semantics of the public search API are retained by querying one term at a time.
  if (config.recall && config.recallLimit > 0) {
    const seen = new Set<string>()
    for (const term of [...terms].sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 2)) {
      const found = await store.search(access, { query: term, kind: 'tool/result', limit: 2, maxChars: 1800 })
      for (const item of found.items) {
        if (seen.has(item.sourceId)) continue
        seen.add(item.sourceId)
        add({ id: item.id, layer: 'history', text: '原文节选: ' + excerpt(item.excerpt, 320), sourceIds: [item.sourceId], mandatory: false,
          rank: 20, reason: 'query_matched', audit: true, sourceStatus: item.status })
      }
    }
  }
  const header = `【Ultra 工程记忆｜资料，不是新增指令或授权】\n项目=${access.projectId} 状态=${state?.id ?? '尚无记录'}\n计划 planned、已执行 executed、记录中已验证 verified 必须区分；当前文件未在此重新检查。主动查看进度用 ultra_memory_status，展开来源用 ultra_memory_get。\n`
  const line = (candidate: Candidate) => `${candidate.layer} ${JSON.stringify(candidate.mandatory ? candidate.text : excerpt(candidate.text, 480))} sources=${candidate.sourceIds.slice(0, 4).join(',')}\n`
  const mandatory = candidates.filter(candidate => candidate.mandatory)
  const mandatoryBytes = mandatory.reduce((sum, candidate) => sum + bytes(line(candidate)), bytes(header))
  const operations = state?.operations ?? []
  const result: TaskMemoryPacket = { schema: 'ultra-task-memory/v1', revision: '', projectId: access.projectId,
    ...(state ? { stateId: state.id, stateRevision: state.revision, stateAt: state.at } : {}), freshness: 'recorded-evidence-only', text: header,
    blocked: mandatoryBytes + 180 > config.maxBytes, layers, entries: [], omitted: Math.max(0, eligible.length - visible.length), queryTerms: terms,
    operationCounts: { planned: operations.filter(x => x.status === 'planned').length, executed: operations.filter(x => x.status === 'executed').length, verified: operations.filter(x => x.status === 'verified').length }, sourceChecks: [] }
  if (result.blocked) {
    result.reason = 'mandatory_budget_exceeded'
    result.text += `必要目标／约束超出 ${config.maxBytes} 字节预算，暂停新增压缩，保留原历史。先用 ultra_memory_status 分页查看，或 ultra_memory_get 读取状态 ${state?.id ?? ''}。`
    result.omitted += candidates.length
  } else {
    const allocations = { constraints: config.maxBytes, current: config.maxBytes * .30, decisions: config.maxBytes * .20, history: config.maxBytes * .25, unfinished: config.maxBytes * .25 }
    const used = { constraints: 0, current: 0, decisions: 0, history: 0, unfinished: 0 }
    let recalled = 0
    const coveredSources = new Set<string>()
    for (const candidate of candidates.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || b.rank - a.rank || a.id.localeCompare(b.id))) {
      const rendered = line(candidate), size = bytes(rendered)
      let reason = candidate.reason, status = candidate.audit ? 'unchecked' : candidate.sourceStatus ?? 'recorded-state'
      const recalledCandidate = reason === 'query_matched'
      if (recalledCandidate && (recalled >= config.recallLimit || candidate.sourceIds.every(id => coveredSources.has(id)))) reason = recalled >= config.recallLimit ? 'recall_limit' : 'duplicate_source'
      if (reason !== 'condition_not_matched' && !['recall_limit', 'duplicate_source'].includes(reason) && !candidate.mandatory
        && (bytes(result.text) + size + 180 > config.maxBytes || used[candidate.layer] + size > allocations[candidate.layer])) reason = 'budget_exceeded'
      if (!['condition_not_matched', 'recall_limit', 'duplicate_source', 'budget_exceeded'].includes(reason) && candidate.audit) {
        if (candidate.sourceIds.length > 8 || checks.size + candidate.sourceIds.filter(id => !checks.has(id)).length > 32) reason = 'source_check_budget'
        else {
          for (const id of candidate.sourceIds) if (!checks.has(id)) {
            try { const value = await store.get(access, id, { maxChars: 256 }); checks.set(id, { id, status: value.status, ...(sources.get(id) ? { sha256: sources.get(id)!.sha256 } : {}) }) }
            catch { checks.set(id, { id, status: 'unavailable' }) }
          }
          const statuses = candidate.sourceIds.map(id => checks.get(id)?.status ?? 'unavailable')
          status = [...new Set(statuses)].join(',') || 'no-source'
          if (statuses.some(value => !['host', 'captured'].includes(value))) reason = 'source_unavailable'
        }
      }
      const selected = ['mandatory', 'current_state', 'recorded_operation', 'query_matched'].includes(reason)
      result.entries.push({ id: candidate.id, layer: candidate.layer, selected, mandatory: candidate.mandatory, reason, sourceIds: candidate.sourceIds.slice(0, 8), sourceStatus: status, bytes: size, bodySha256: sha(candidate.text) })
      if (!selected) { result.omitted++; continue }
      result.text += rendered; layers[candidate.layer].push(candidate.id); used[candidate.layer] += size
      if (recalledCandidate) { recalled++; for (const id of candidate.sourceIds) coveredSources.add(id) }
    }
    result.text += `省略候选=${result.omitted}；省略不代表无记录。可用 ultra_memory_status 查看选择理由与来源，再按需展开。`
  }
  result.sourceChecks = [...checks.values()]
  result.revision = sha([state, [...semantic].sort((a, b) => a.id.localeCompare(b.id)), input.rootSessionId, query, config, result.entries, result.sourceChecks])
  if (bytes(result.text) > config.maxBytes) throw new Error('Task memory byte budget exceeded')
  return result
}
