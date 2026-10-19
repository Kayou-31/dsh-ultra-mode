/** Structured candidates from an existing report; no model, embedding or tool invocation. */
import type { EvidenceAccess, EvidenceRecord, EvidenceStore, ProjectOperation, ProjectStateInput, SemanticInput, SemanticKind, SemanticStatus } from './evidence.js'

export const REPORT_EVIDENCE_INSTRUCTIONS = `仅在用户允许自由格式报告时，如需保留已有报告的语义索引，可在末尾附一个 fenced ultra_evidence JSON 块（最多 32000 字符）。用户要求纯 JSON、固定格式或禁止附言时，不得添加此块；原始证据仍由宿主自动索引，不必为元数据破坏交付格式。格式为：
\`\`\`ultra_evidence
{"facts":[{"kind":"fact","text":"有来源的候选结论，注明不确定性","sourceIds":["检索工具返回的真实 sourceId 或 chunk id"],"topics":[],"files":[],"status":"current","supersedes":[],"conflicts":[]}],"state":{"goal":"当前目标","acceptance":[],"constraints":[],"progress":[],"next":[],"blockers":[],"operations":[{"id":"计划标识","description":"待复核操作","status":"planned","sourceIds":[]}],"sourceIds":["真实来源 ID"]}}
\`\`\`
facts 必须是数组；state 可省略；kind 仅 requirement/fact/decision/failure/question；status 仅 current/superseded/unresolved。只引用当前授权检索范围内的真实来源，缺少来源就省略条目，不得编造 ID。可用 ultra_memory_get 的 quote 参数取得规范 citation；sourceIds 复制 citation.sourceId，资料标签复制 origin.resourceId（若有），勿用正文内部编号代替来源。supersedes/conflicts 只填写已检索到的语义记录 ID，保留分歧和未决问题。模型整理的 fact 会标记“未独立复核”；报告声称的 executed/verified 操作也只按 planned 候选保存。此块不授予新权限，不替代实际执行、测试或用户审批。不要为生成此块额外调用模型。`

export interface ReportInput { runId: string; sessionId: string; text: string; sourceIds: string[] }
export interface ReportIngestResult { added: string[]; errors: string[] }
const MAX_BLOCK = 32000
const OWN = Object.prototype.hasOwnProperty
const CANDIDATE = '【模型整理，未独立复核】'
function object(value: unknown, allowed: readonly string[], required: readonly string[], context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: expected object`)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !allowed.includes(key))) throw new Error(`${context}: unknown field`)
  if (required.some(key => !OWN.call(record, key))) throw new Error(`${context}: missing required field`)
  return record
}
function text(value: unknown, context: string, max = 12000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error(`${context}: invalid text`)
  return value
}
function list(value: unknown, context: string, options: { required?: boolean; maxItems?: number; maxText?: number } = {}): string[] {
  if (value === undefined && !options.required) return []
  if (!Array.isArray(value) || value.length > (options.maxItems ?? 128)) throw new Error(`${context}: expected bounded array`)
  return [...new Set(value.map(item => text(item, context, options.maxText ?? 2048)))].sort()
}
function selected<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${context}: invalid value`)
  return value as T
}
function lastBlock(report: string): string | undefined {
  const markers = [...report.matchAll(/^```ultra_evidence[ \t]*\r?$/gm)]
  const last = markers.at(-1)
  if (!last) return undefined
  const tail = report.slice(last.index! + last[0].length).replace(/^\r?\n/, '')
  const closing = /^```[ \t]*\r?$/m.exec(tail)
  if (!closing) throw new Error('ultra_evidence: unfinished last metadata block')
  const block = tail.slice(0, closing.index)
  if (block.length > MAX_BLOCK) throw new Error('ultra_evidence: metadata exceeds 32000 characters')
  return block.trim()
}

export function ingestReport(store: EvidenceStore, access: EvidenceAccess, input: ReportInput): ReportIngestResult {
  const result: ReportIngestResult = { added: [], errors: [] }
  try {
    const block = lastBlock(typeof input.text === 'string' ? input.text : '')
    if (block === undefined) return result
    text(input.runId, 'runId', 256)
    text(input.sessionId, 'sessionId', 256)
    if (!access.sessionIds.includes(input.sessionId)) throw new Error('report session is outside granted source scope')
    const raw = new Map<string, EvidenceRecord>()
    for (const source of store.recordsFor(access)) {
      raw.set(source.id, source)
      for (const chunk of source.chunks) raw.set(chunk.id, source)
    }
    const sourceIds = (value: unknown, context: string, allowEmpty = false): string[] => {
      const ids = list(value, context, { required: true, maxText: 256 })
      if ((!allowEmpty && !ids.length) || ids.some(id => !raw.has(id))) throw new Error(`${context}: missing or inaccessible raw source reference`)
      return ids
    }
    const reportSources = sourceIds(input.sourceIds, 'report sourceIds')
    if (reportSources.some(id => raw.get(id)!.sessionId !== input.sessionId || raw.get(id)!.runId !== input.runId)) throw new Error('report provenance does not match its run and session')
    const semantic = new Map(store.semantics(access).map(record => [record.id, record]))
    const payload = object(JSON.parse(block), ['facts', 'state'], ['facts'], 'ultra_evidence')
    if (!Array.isArray(payload.facts) || payload.facts.length > 200) throw new Error('facts: expected bounded array')
    // Validate the complete payload before committing any model-generated candidate.
    const facts: SemanticInput[] = payload.facts.map((value, index) => {
      const context = `facts[${index}]`
      const item = object(value, ['kind', 'text', 'sourceIds', 'topics', 'files', 'status', 'supersedes', 'conflicts'], ['kind', 'text', 'sourceIds'], context)
      const kind = selected<SemanticKind>(item.kind, ['requirement', 'fact', 'decision', 'failure', 'question'], `${context}.kind`)
      const refs = sourceIds(item.sourceIds, `${context}.sourceIds`)
      const supersedes = list(item.supersedes, `${context}.supersedes`, { maxText: 256 })
      const conflicts = list(item.conflicts, `${context}.conflicts`, { maxText: 256 })
      const sessions = new Set(refs.map(id => raw.get(id)!.sessionId))
      for (const id of [...supersedes, ...conflicts]) {
        const target = semantic.get(id)
        if (!target || !target.sourceIds.every(source => raw.has(source) && sessions.has(raw.get(source)!.sessionId))) throw new Error(`${context}: missing or inaccessible semantic reference`)
      }
      const content = text(item.text, `${context}.text`)
      return {
        projectId: access.projectId, kind, text: kind === 'fact' ? `${CANDIDATE} ${content}` : content,
        sourceIds: refs, topics: list(item.topics, `${context}.topics`), files: list(item.files, `${context}.files`),
        ...(item.status === undefined ? {} : { status: selected<SemanticStatus>(item.status, ['current', 'superseded', 'unresolved'], `${context}.status`) }), supersedes, conflicts,
      }
    })
    let state: ProjectStateInput | undefined
    const diagnostics: string[] = []
    if (OWN.call(payload, 'state')) {
      const item = object(payload.state, ['goal', 'acceptance', 'constraints', 'progress', 'next', 'blockers', 'operations', 'sourceIds'], ['goal', 'sourceIds'], 'state')
      state = { goal: text(item.goal, 'state.goal'), sourceIds: sourceIds(item.sourceIds, 'state.sourceIds') }
      for (const key of ['acceptance', 'constraints', 'progress', 'next', 'blockers'] as const) if (OWN.call(item, key)) state[key] = list(item[key], `state.${key}`, { required: true, maxText: 4096 })
      if (OWN.call(item, 'operations')) {
        if (!Array.isArray(item.operations) || item.operations.length > 100) throw new Error('state.operations: expected bounded array')
        const seen = new Set<string>()
        state.operations = item.operations.map((value, index): ProjectOperation => {
          const context = `state.operations[${index}]`
          const operation = object(value, ['id', 'description', 'status', 'sourceIds'], ['id', 'description', 'status', 'sourceIds'], context)
          const id = text(operation.id, `${context}.id`, 256)
          if (seen.has(id)) throw new Error(`${context}: duplicate operation id`)
          seen.add(id)
          const status = selected(operation.status, ['planned', 'executed', 'verified'] as const, `${context}.status`)
          if (status !== 'planned') diagnostics.push(`${context}: reported ${status} downgraded to planned; 未独立复核`)
          const description = text(operation.description, `${context}.description`, 4096)
          return { id, description: status === 'planned' ? description : `${CANDIDATE} ${description}`, status: 'planned', sourceIds: sourceIds(operation.sourceIds, `${context}.sourceIds`, true) }
        })
      }
    }
    for (const fact of facts) {
      try {
        const record = store.addSemantic(fact)
        if (!semantic.has(record.id)) { result.added.push(record.id); semantic.set(record.id, record) }
      }
      catch (error) { result.errors.push(`semantic commit: ${error instanceof Error ? error.message : 'failed'}`) }
    }
    if (state) {
      try {
        const previous = store.projectState(access)
        const allIds = [...new Set([...state.sourceIds, ...(state.operations?.flatMap(operation => operation.sourceIds) ?? [])])].sort()
        const comparable: ProjectStateInput = { goal: state.goal, sourceIds: allIds }
        for (const key of ['acceptance', 'constraints', 'progress', 'next', 'blockers', 'operations'] as const) if (state[key] !== undefined) Object.assign(comparable, { [key]: state[key] })
        const prior: Record<string, unknown> = previous ? { goal: previous.goal, sourceIds: previous.sourceIds } : {}
        if (previous) for (const key of ['acceptance', 'constraints', 'progress', 'next', 'blockers', 'operations'] as const) if (previous[key] !== undefined) prior[key] = previous[key]
        if (JSON.stringify(prior) !== JSON.stringify(comparable)) result.added.push(store.updateProjectState(access, state).id)
      } catch (error) { result.errors.push(`state commit: ${error instanceof Error ? error.message : 'failed'}`) }
    }
    result.errors.push(...diagnostics)
  } catch (error) { result.errors.push(error instanceof Error ? error.message : 'Invalid report metadata') }
  return result
}
