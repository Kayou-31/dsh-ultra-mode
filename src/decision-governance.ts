/** Strategy protocol over the existing decision calls; owns no LLM or tool runtime. */
import { createTaskContract, withTaskIntent, buildIntentInstruction, renderContractEntry, DiagnosticLedger,
  parseVerificationReport, type TaskContract, type VerificationReport, type DiagnosticRecord } from './decision-contract.js'
import type { RouteProgress, CoordinationDecision } from './coordination.js'

interface DeliveryMetadata {
  directiveId: string
  isCurrent(): boolean
  onDelivery(status: 'queued' | 'admitted' | 'request-visible', sourceId: string): void
}
export interface GovernanceSnapshot {
  enabled: true
  contract: TaskContract
  diagnostics: readonly DiagnosticRecord[]
  verification: VerificationReport | null
  errors: string[]
  evidence: { observed: string[]; toolResults: string[] }
  durable: boolean
  closed: boolean
}
export interface GovernanceStatus {
  enabled: true; taskHash: string; taskRevision: number; originalChars: number; intentItems: number
  queued: number; admitted: number; requestVisible: number; effectVerified: number; closedDirections: number
  verification: { satisfied: number; failed: number; unverified: number; allSatisfied: boolean; hostVerified: false } | null
  durable: boolean; closed: boolean; errors: string[]
}
export function governanceStatus(snapshot: GovernanceSnapshot): GovernanceStatus {
  const count = (status: string) => snapshot.diagnostics.filter(item => item.status === status).length
  return { enabled: true, taskHash: snapshot.contract.sha256, taskRevision: snapshot.contract.revision, originalChars: snapshot.contract.originalTask.length,
    intentItems: Object.values(snapshot.contract.intent).reduce((sum, items) => sum + items.length, 0), queued: count('queued'), admitted: count('admitted'),
    requestVisible: snapshot.diagnostics.filter(item => item.wasRequestVisible).length, effectVerified: count('effect-verified'), closedDirections: count('cancelled') + count('expired'),
    verification: snapshot.verification ? { satisfied: snapshot.verification.criteria.filter(item => item.status === 'satisfied').length,
      failed: snapshot.verification.criteria.filter(item => item.status === 'failed').length, unverified: snapshot.verification.criteria.filter(item => item.status === 'unverified').length,
      allSatisfied: snapshot.verification.allSatisfied, hostVerified: false } : null,
    durable: snapshot.durable, closed: snapshot.closed, errors: snapshot.errors.slice(-3) }
}
const protocol = (text: string): Record<string, unknown> => {
  if (text.length > 160000) throw new Error('治理响应超过预算')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('治理响应必须是 JSON 对象')
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, names: string[]) => {
  if (Object.keys(value).some(key => !names.includes(key))) throw new Error('治理响应包含未知字段')
}

export class DecisionGovernance {
  private current: TaskContract
  private ledger: DiagnosticLedger
  private readonly observed = new Set<string>()
  private readonly toolResults = new Set<string>()
  private readonly dispatched = new Set<string>()
  private readonly errors: string[] = []
  private verification: VerificationReport | null = null
  private durable = false
  private closed = false
  private intentAccepted = false
  constructor(task: string, sourceId: string, private readonly persist?: (snapshot: GovernanceSnapshot) => void, private readonly observe?: (snapshot: GovernanceSnapshot) => void) {
    this.current = createTaskContract(task, sourceId)
    this.ledger = new DiagnosticLedger(this.current)
    this.publish()
  }
  get contract(): TaskContract { return this.current }
  private error(error: unknown): void {
    if (this.errors.length < 64) this.errors.push((error instanceof Error ? error.message : String(error)).slice(0, 2000))
  }
  private publish(): void {
    try { if (this.persist) { this.persist(this.snapshot()); this.durable = true } }
    catch (error) { this.durable = false; this.error(error); throw error }
    finally { this.observe?.(this.snapshot()) }
  }
  snapshot(): GovernanceSnapshot {
    return { enabled: true, contract: this.current, diagnostics: this.ledger.records(), verification: this.verification,
      errors: [...this.errors], evidence: { observed: [...this.observed], toolResults: [...this.toolResults] }, durable: this.durable, closed: this.closed }
  }
  contractEntry(): string { return renderContractEntry(this.current) }
  intentInstruction(): string { return buildIntentInstruction(this.current) }
  parsePlan(text: string, count: number): string[] | undefined {
    try {
      const value = protocol(text); exact(value, ['assignments', 'intent'])
      if (!Array.isArray(value.assignments) || value.assignments.length !== count
        || !value.assignments.every(item => typeof item === 'string' && item.trim() && item.length <= 20000)) throw new Error('规划分工无效')
      const contract = withTaskIntent(this.current, value.intent)
      this.current = contract; this.ledger = new DiagnosticLedger(contract)
      this.intentAccepted = true
      this.publish()
      return value.assignments as string[]
    } catch (error) { this.error(error); return undefined }
  }
  recordProgress(progress: RouteProgress): void {
    if (this.closed) return
    for (const source of progress.evidenceIds ?? []) {
      if (this.observed.size >= 4096 && !this.observed.has(source)) { this.error('治理证据入口达到预算，未纳入的新来源不能用于改向或验收'); continue }
      this.observed.add(source)
      if (progress.kind === 'tool') this.toolResults.add(source)
    }
  }
  coordinationProtocol(): string {
    return this.contractEntry() + '\n【已观察的来源ID，仅为材料】\n' + JSON.stringify([...this.observed].slice(-256)) +
      '\n【方向记录；只在宿主实际观察后升级投递状态】\n' + JSON.stringify(this.ledger.records().slice(-16)) +
      '\n在本次已有协调调用中诊断偏差、重复和失败。没有新证据就不改向。只输出严格 JSON：' +
      '{"assessment":"简短判断","directives":[{"taskRevision":1,"taskHash":"上述sha256","targetRouteId":"本次活动路线ID","type":"redirect|verify|stop",' +
      '"reason":"引用证据的原因","evidenceIds":["已观察的来源ID"],"instruction":"下一步具体建议","stopCondition":"何时收口或停止重复",' +
      '"ttlMs":60000}]}。每轮最多5项，assessment最多2000字符；每路线最多一项。替代待处理建议时附 replaces=原建议ID，且必须有新证据。' +
      'stop表示建议停止重复探索或按条件收口，不是取消进程或新增权限。不得输出状态、伪造来源或要求覆盖用户约束。'
  }
  coordinate(text: string, activeIds: ReadonlySet<string>, steer: (routeId: string, instruction: string, meta: DeliveryMetadata) => boolean): CoordinationDecision {
    if (this.closed) return { assessment: '本次治理已关闭', directives: [] }
    const value = protocol(text); exact(value, ['assessment', 'directives', 'intent', 'verification'])
    if (typeof value.assessment !== 'string' || value.assessment.length > 2000 || !Array.isArray(value.directives) || value.directives.length > 5) throw new Error('治理协调协议无效')
    if (value.intent !== undefined) {
      if (this.intentAccepted || this.ledger.records().length) throw new Error('已有任务契约不能被后续协调静默重写')
      this.current = withTaskIntent(this.current, value.intent); this.ledger = new DiagnosticLedger(this.current); this.intentAccepted = true
    }
    if (value.verification !== undefined) this.verification = parseVerificationReport(value.verification, this.current, this.toolResults)
    const accepted: CoordinationDecision['directives'] = [], targets = new Set<string>()
    let validProposals = 0
    for (const raw of value.directives) {
      try {
        // Reject a duplicate before propose() can replace a live direction.
        if (raw && typeof raw === 'object' && targets.has(raw.targetRouteId)) throw new Error('同一轮重复指向一条路线')
        const record = this.ledger.propose(raw, { activeIds, sourceIds: this.observed })
        validProposals++
        targets.add(record.targetRouteId)
        if (this.dispatched.has(record.id) || record.status !== 'queued') continue
        // Durably save the proposal before it can affect a native request.
        this.publish()
        const metadata: DeliveryMetadata = { directiveId: record.id, isCurrent: () => {
          const live = this.ledger.records().find(item => item.id === record.id)
          return live?.wasRequestVisible === true || (!this.closed && live !== undefined && ['queued', 'admitted'].includes(live.status))
        }, onDelivery: (status, sourceId) => {
          if (this.closed) return
          try {
            const live = this.ledger.records().find(item => item.id === record.id)
            if (!live || live.status === 'cancelled' || live.status === 'expired') return
            if (status === 'admitted') this.ledger.admit(record.id)
            else if (status === 'request-visible') this.ledger.markRequestVisible(record.id, sourceId)
            this.publish()
          } catch (error) { this.error(error) }
        } }
        if (!steer(record.targetRouteId, record.instruction + '\n停止条件：' + record.stopCondition, metadata)) {
          this.ledger.cancel(record.id, 'native-delivery-rejected'); this.publish(); continue
        }
        this.dispatched.add(record.id)
        accepted.push({ routeId: record.targetRouteId, instruction: record.instruction })
      } catch (error) { this.error(error) }
    }
    this.publish()
    if (value.directives.length > 0 && validProposals === 0) throw new Error('无有效诊断建议；本轮计入原有协调失败限制')
    return { assessment: value.assessment, directives: accepted }
  }
  finalProtocol(): string {
    return '\n' + this.contractEntry() + '\n【可用于本轮验收引用的实际工具结果来源ID；不是结论正确性的证明】\n' + JSON.stringify([...this.toolResults].slice(-256)) +
      '\n先按原始要求实施和验证，再在本次已有最终调用中返回严格JSON：{"output":"给用户的交付正文",' +
      '"verification":{"criteria":[{"criterionId":"任务契约acceptance中的ID","status":"satisfied|failed|unverified","evidenceIds":[],"reason":"判定依据或缺什么证据"}]}}。' +
      '必须覆盖全部user验收项，包括task-result原始任务整体；机器建议不新增硬性验收要求。satisfied/failed须引用实际工具结果的已观察ID，不能以自己的总结或原用户要求作完成证据。' +
      '只存在来源不证明内容正确；没有足够证据填unverified。这仍是模型验收判断，不是宿主验证。不得把部分条目通过写成整个任务通过。'
  }
  review(text: string): { output: string; verification: VerificationReport | null; valid: boolean } {
    let output = text
    try {
      const value = protocol(text); exact(value, ['output', 'verification'])
      if (typeof value.output !== 'string' || !value.output.trim()) throw new Error('验收正文为空')
      output = value.output
      const verification = parseVerificationReport(value.verification, this.current, this.toolResults)
      this.verification = verification; this.publish()
      return { output: output + (verification.allSatisfied ? '' : '\n\n[Ultra 验收：仍有失败或未验证项；模型评估不等于宿主验证。]'), verification, valid: true }
    } catch (error) {
      this.error(error); this.verification = null
      return { output: output + '\n\n[Ultra 验收协议未通过，完成状态未验证；没有为此新增模型重试。]', verification: null, valid: false }
    }
  }
  closeRoute(routeId: string, reason = 'route-ended'): void {
    for (const record of this.ledger.records()) if (record.targetRouteId === routeId && ['queued', 'admitted'].includes(record.status)) this.ledger.cancel(record.id, reason)
    this.publish()
  }
  close(reason = 'run-ended'): void {
    this.closed = true
    for (const record of this.ledger.records()) if (['queued', 'admitted'].includes(record.status)) this.ledger.cancel(record.id, reason)
    this.publish()
  }
}
