/** Native workflow controller: no model adapter or credential access. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { assessWorkflowCycle130k, loadWorkflowArchiveProofs } from './archive-proof.mjs'
import { pathToFileURL } from 'node:url'
import { assertReadOnlyFinalRecovery, assertRecoveryOnlyTool, recoveryFinalPrompt, businessSnapshot, assertReadOnlyFinalNative } from './recovery-policy.mjs'
export const name = 'dsh-ocg-workflow-real-acceptance'
export const inject = ['agents', 'agentLoop', 'tools', 'llm', 'sessions', 'sessionPersistence', 'systemPrompt', 'agentPresets', 'commands', 'tokenMeter']
export const WORKFLOW_TOOLS = Object.freeze(['workflow_read', 'workflow_patch', 'workflow_test', 'workflow_commit', 'ultra_memory_search', 'ultra_memory_get'])
const sha = value => createHash('sha256').update(value).digest('hex')
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const textOf = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
const json = text => { try { return JSON.parse(text) } catch { return undefined } }
export function parseWorkflowAnswer(text) {
  try {
    assert.ok(typeof text === 'string' && text.length <= 64000)
    const trimmed = text.trim(), fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed)
    const value = JSON.parse(fence ? fence[1] : trimmed)
    assert.ok(value && typeof value === 'object' && !Array.isArray(value))
    return value
  } catch { throw Object.assign(new Error('Expected one JSON object, optionally in a sole json code fence, without surrounding prose'), { code: 'WORKFLOW_INVALID_JSON' }) }
}
export function workflowReportQuoteValid({ source, quote, targetCaseId }) {
  if (typeof source !== 'string' || typeof quote !== 'string') return false
  const line = source.split(/\r?\n/u).find(line => { const value = json(line); return value?.caseId === targetCaseId && value.observed && typeof value.resultSha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.resultSha256) })
  return typeof line === 'string' && quote === line
}
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/u.test(error.code) ? error.code : 'UNKNOWN'
const usageFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const numericUsage = usage => usage && typeof usage === 'object' ? Object.fromEntries(usageFields.filter(field => number(usage[field]) !== null).map(field => [field, usage[field]])) : null
const nativeUsage = event => numericUsage(event.data.usage ?? event.data.stream?.map(item => item.type === 'chunk' ? item.chunk : item).findLast(chunk => chunk.type === 'usage')?.usage)
function positive(value, name) { assert.ok(Number.isSafeInteger(value) && value > 0, 'Positive finite ' + name + ' is required'); return value }
export function assertWorkflowToolBoundary(name, args, phase) {
  if (phase === null) { assert.ok(name === 'workflow_read' && ['src/reconcile.mjs', 'history/initial-ledger.json'].includes(args.file), 'Initial turn only reads the two named base files, then stops'); return }
  if (name === 'workflow_read' || name === 'workflow_patch') {
    const match = /^(specs|cases|reports|commits)\/phase-(\d{2})\./u.exec(args.file ?? '')
    if (name === 'workflow_patch') assert.ok(match?.[1] === 'cases' && Number(match[2]) === phase, 'Patch must address the current admitted phase case file')
    else assert.ok(match ? Number(match[2]) <= phase : ['src/reconcile.mjs', 'history/initial-ledger.json', 'status.json'].includes(args.file), 'Read exceeds the current admitted phase')
  } else assert.equal(args.phase, phase, 'Tool phase differs from the current admitted phase')
}
export function workflowInitialReceipt(events, taskSha256) {
  const users = events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'user' && sha(textOf(event.data)) === taskSha256)
  const end = users.length === 1 && events.find(event => event.seq > users[0].seq && event.type === 'turn/end')
  return { verified: users.length === 1 && end?.data.reason.kind === 'completed', userSeq: users.length === 1 ? users[0].seq : null, endSeq: end?.seq ?? null, occurrences: users.length }
}
export function workflowNativeUsageAudit({ events, requests }) {
  const settlements = events.filter(event => ['assistant/message', 'assistant/attempt'].includes(event.type) && typeof event.surfaceOp !== 'object'), used = new Set()
  const items = requests.map((row, index) => {
    const matches = row.nativeBoundary === undefined ? settlements.length === requests.length ? [settlements[index]] : [] : settlements.filter(event => event.seq >= row.nativeBoundary && event.seq < (requests[index + 1]?.nativeBoundary ?? Infinity))
    const event = matches.length === 1 ? matches[0] : null, actual = event ? nativeUsage(event) : null, observed = numericUsage(row.usage)
    if (event) used.add(event.seq)
    const verified = !!event && actual !== null && observed !== null && JSON.stringify(actual) === JSON.stringify(observed)
    return { sequence: row.sequence, nativeSeq: event?.seq ?? null, verified, completedProviderUsage: verified && event.type === 'assistant/message' && number(actual.totalTokens) > 0, unknown: !!event && actual === null && observed === null, identityValid: row.sequence === index + 1 }
  })
  return { passed: used.size === settlements.length && items.every(item => item.identityValid && (item.verified || item.unknown)), items, nativeSettlements: settlements.length }
}
export function normalizeWorkflowConfig(input) {
  assert.ok(input && input.provider === 'opencode-go' && input.model === 'deepseek-v4.1-flash', 'Only the selected OCG Flash route is permitted')
  const cfg = { ...input }
  for (const field of ['runtimeRoot', 'ultraRoot', 'projectDir', 'resultFile', 'stateFile']) assert.ok(typeof cfg[field] === 'string' && path.isAbsolute(cfg[field]), 'Absolute ' + field + ' required')
  for (const field of ['maxRequests', 'timeoutMs', 'reportRows']) positive(cfg[field], field)
  assert.ok(cfg.reportRows >= 8 && cfg.reportRows <= 12000, 'reportRows must remain within the frozen fixture range 8..12000')
  if (cfg.fixtureSeed !== undefined) assert.ok(typeof cfg.fixtureSeed === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u.test(cfg.fixtureSeed), 'fixtureSeed must be a 1..160 character plain stable identifier')
  cfg.cycles = positive(cfg.cycles ?? 30, 'cycles'); assert.ok(cfg.cycles <= 30, 'This frozen workflow contains at most thirty phases')
  cfg.calibrateOnly = cfg.calibrateOnly ?? false; cfg.resume = cfg.resume ?? false
  assert.ok(typeof cfg.calibrateOnly === 'boolean' && typeof cfg.resume === 'boolean')
  cfg.recoverCommittedVerification = cfg.recoverCommittedVerification ?? false
  assert.ok(typeof cfg.recoverCommittedVerification === 'boolean' && (!cfg.recoverCommittedVerification || cfg.resume), 'Committed verification recovery requires explicit resume')
  cfg.recoverReadOnlyFinal = cfg.recoverReadOnlyFinal ?? false
  assert.ok(typeof cfg.recoverReadOnlyFinal === 'boolean' && (!cfg.recoverReadOnlyFinal || cfg.resume && cfg.recoverCommittedVerification), 'Read-only final recovery requires explicit committed resume')
  if (cfg.recoverReadOnlyFinal) assert.equal(cfg.recoveryFailureCode, 'WORKFLOW_INVALID_JSON', 'An explicit frozen format failure is required')
  cfg.segmentCycles = positive(cfg.segmentCycles ?? (cfg.calibrateOnly ? 1 : 5), 'segmentCycles')
  cfg.mainEffort = cfg.mainEffort ?? 'low'; cfg.maxTokens = positive(cfg.maxTokens ?? 8192, 'maxTokens')
  cfg.outputReserveTokens = positive(cfg.outputReserveTokens ?? cfg.maxTokens, 'output reserve')
  cfg.toolReserveTokens = positive(cfg.toolReserveTokens ?? 2048, 'tool reserve')
  assert.ok(cfg.outputReserveTokens >= cfg.maxTokens, 'Output reserve cannot understate the actual request cap')
  cfg.compressionProfile ??= 'baseline'
  assert.ok(['baseline', 'efficient', 'archive-130k'].includes(cfg.compressionProfile), 'Known explicit workflow compression profile is required')
  if (cfg.compressionProfile === 'archive-130k') {
    assert.ok(cfg.postCompressionCapTokens === undefined || cfg.postCompressionCapTokens === 130000, 'The archive acceptance cap is fixed at 130000')
    assert.ok(cfg.outputReserveTokens >= 8192 && cfg.toolReserveTokens >= 2048, 'Archive acceptance cannot understate the output/tool reserves')
    assert.ok(cfg.maxRequests <= 900 && cfg.timeoutMs <= 10800000, 'Archive acceptance remains within one finite 900 request / 3h segment')
    cfg.postCompressionCapTokens = 130000
  } else assert.equal(cfg.postCompressionCapTokens, undefined, 'The extra post-compression cap requires archive-130k')
  cfg.contextCapTokens = 500000; cfg.contextTriggerTokens = 420000
  cfg.reportTargetInputTokens ??= 430000
  assert.ok(Number.isSafeInteger(cfg.reportTargetInputTokens) && cfg.reportTargetInputTokens >= 430000 && cfg.reportTargetInputTokens <= 450000, 'Report allocation target must remain within 430K..450K; actual 500K guard and cycle criterion remain unchanged')
  return Object.freeze(cfg)
}
export function chooseWorkflowReportRows({ maxRows, pressureTokens, tokensPerRow, calibrateOnly, targetInputTokens = 430000 }) {
  assert.ok(Number.isSafeInteger(maxRows) && maxRows >= 8 && maxRows <= 12000)
  assert.ok(number(pressureTokens) !== null, 'Current native pressure is required')
  assert.ok(Number.isSafeInteger(targetInputTokens) && targetInputTokens >= 430000 && targetInputTokens <= 450000, 'Report allocation target must remain within 430K..450K')
  if (calibrateOnly) return { effectiveRows: maxRows, maximumRows: maxRows, pressureTokens, targetInputTokens, densityMeaning: 'Small calibration, not a compression acceptance cycle' }
  assert.ok(number(tokensPerRow) > 0, 'A measured calibration density or explicit density estimate is required')
  const effectiveRows = Math.min(maxRows, Math.floor((targetInputTokens - pressureTokens) / tokensPerRow))
  assert.ok(effectiveRows >= 8, 'A bounded report cannot fit the current retained context')
  return { effectiveRows, maximumRows: maxRows, pressureTokens, targetInputTokens, tokensPerRow, densityMeaning: 'Provider input delta per report row; an estimate for admission, not measured billing for a row' }
}
export function assertWorkflowAdmission(estimate) { assert.ok(estimate?.withinBudget === true && estimate.totalTokens <= 500000, 'Estimated assembled request exceeds the 500K admission boundary; no dispatch') }
export function workflowPruneEvidence({ events, beforeSeq, archiveProofs = new Map() }) {
  const prunes = events.filter(event => event.seq >= beforeSeq && event.type === 'compaction/prune')
  const summaries = events.filter(event => event.seq >= beforeSeq && event.type === 'compaction/summary')
  const shadowedSeqs = [...new Set([...prunes, ...summaries].sort((a,b) => a.seq-b.seq).flatMap(event => event.data.shadowedSeqs ?? []))]
  const callIds = events.filter(event => shadowedSeqs.includes(event.seq) && event.type === 'tool/result').map(event => event.data.message.toolCallId)
  for (const summary of summaries) { const proof = archiveProofs.get(summary.seq + 1); if (proof?.verified && proof.summarySeq === summary.seq) callIds.push(...proof.replacedCallIds) }
  return { pruneSeqs: prunes.map(event => event.seq), ...(summaries.length ? { summarySeqs: summaries.map(event => event.seq) } : {}), shadowedSeqs, replacedCallIds: [...new Set(callIds)] }
}
export function workflowNativeCompressionAudit({ events, groups, requests, archiveProofs = new Map() }) {
  return groups.every(group => {
    const next = requests.find(row => row.sequence === group.nextRequestSequence)
    if (!Number.isSafeInteger(group.nativeBoundary) || !Number.isSafeInteger(next?.nativeBoundary)) return false
    const window = events.filter(event => event.seq >= group.nativeBoundary && event.seq < next.nativeBoundary)
    const prunes = window.filter(event => event.type === 'compaction/prune'), summaries = window.filter(event => event.type === 'compaction/summary')
    const actual = workflowPruneEvidence({ events: events.filter(event => event.seq < next.nativeBoundary), beforeSeq: group.nativeBoundary, archiveProofs })
    const generations = boundary => events.filter(event => event.seq < boundary && event.surfaceOp?.op === 'replace').length
    return prunes.length + summaries.length > 0 && JSON.stringify(actual.pruneSeqs) === JSON.stringify(group.pruneSeqs) && JSON.stringify(actual.summarySeqs ?? []) === JSON.stringify(group.summarySeqs ?? []) && JSON.stringify(actual.shadowedSeqs) === JSON.stringify(group.shadowedSeqs)
      && JSON.stringify(actual.replacedCallIds) === JSON.stringify(group.replacedCallIds) && generations(group.nativeBoundary) === group.beforeGeneration && generations(next.nativeBoundary) === group.afterGeneration
      && prunes.every(prune => { const replacement = events.find(event => event.seq === prune.seq + 1); return replacement?.type === 'tool/result' && replacement.surfaceOp?.op === 'replace' && prune.data.shadowedSeqs?.every(seq => replacement.sourceEventSeqs?.includes(seq)) })
      && summaries.every(summary => { const proof = archiveProofs.get(summary.seq + 1); return proof?.verified === true && proof.kind === 'native-template-summary' && proof.summarySeq === summary.seq && proof.endSeq < next.nativeBoundary })
  })
}
export function workflowContextUsage(usage) {
  const input = number(usage?.inputTokens), cache = number(usage?.cacheReadTokens), output = number(usage?.outputTokens), total = number(usage?.totalTokens)
  const totalMinusOutput = total !== null && output !== null && total >= output ? total - output : null
  const inputPlusCacheRead = input !== null && cache !== null ? input + cache : null
  return { totalMinusOutput, inputPlusCacheRead, consistent: totalMinusOutput !== null && inputPlusCacheRead !== null ? totalMinusOutput === inputPlusCacheRead : null }
}
function assessWorkflowCycleBase({ phase, requests = [], groups = [], retrieval, commit, grade }) {
  const rows = requests.filter(row => row.phase === phase), eligible = rows.filter(row => {
    const context = workflowContextUsage(row.usage)
    return row.nativeUsageVerified === true && context.consistent === true && context.totalMinusOutput + row.outputReserveTokens + row.toolReserveTokens >= 420000 && context.totalMinusOutput + row.outputReserveTokens + row.toolReserveTokens <= 500000 && number(row.usage?.totalTokens) <= 500000
      && row.fullReportVisible === true && typeof row.reportCallId === 'string' && row.reportCallId === retrieval?.callId
  })
  for (const large of eligible) for (const group of groups.filter(group => group.phase === phase && group.afterGeneration > group.beforeGeneration && (group.pruneSeqs?.length || group.summarySeqs?.length) && group.nextRequestSequence > large.sequence && group.replacedCallIds?.includes(large.reportCallId))) {
    const after = rows.find(row => row.sequence >= group.nextRequestSequence && row.nativeUsageVerified === true && row.fullReportVisible === false && workflowContextUsage(row.usage).consistent === true && workflowContextUsage(row.usage).totalMinusOutput < workflowContextUsage(large.usage).totalMinusOutput)
    if (after && retrieval?.verified && retrieval.afterCompression && commit?.committed && grade?.passed) return { qualified: true, independentCompressions: 1, groupId: group.id, largeRequest: large.sequence, postRequest: after.sequence,
      largeContext: workflowContextUsage(large.usage), postContext: workflowContextUsage(after.usage), sourceId: retrieval.sourceId, sourceSha256: retrieval.sourceSha256 }
  }
  return { qualified: false, independentCompressions: 0, reason: 'Needs a measured input plus reserves >=420K and <=500K, a later distinct native compaction group and request, verified source readback, actual commit and independent fixture checks.' }
}
export function assessWorkflowCycle(input) { return input.compressionProfile === 'archive-130k' ? assessWorkflowCycle130k(input, assessWorkflowCycleBase) : assessWorkflowCycleBase(input) }
export function countWorkflowCycles(phases) {
  const ids = new Set(), groups = new Set()
  for (const phase of phases) if (phase.qualification?.qualified && !ids.has(phase.phase) && !groups.has(phase.qualification.groupId)) { ids.add(phase.phase); groups.add(phase.qualification.groupId) }
  return ids.size
}
function evidenceFingerprint(events) {
  return sha(JSON.stringify(events.filter(event => ['user/message', 'tool/call', 'tool/result', 'turn/end', 'compaction/prune'].includes(event.type)).map(event => ({ seq: event.seq, type: event.type, sha256: sha(JSON.stringify(event.data)) }))))
}
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = file + '.tmp-' + randomUUID(), handle = await fs.open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync() } finally { await handle.close() }
  await fs.rename(temporary, file)
}
export async function readWorkflowState(file) {
  const envelope = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.equal(envelope.sha256, sha(JSON.stringify(envelope.state)), 'Workflow state checksum mismatch')
  assert.equal(envelope.state.format, 'ocg-workflow-state-v1'); return envelope.state
}
export async function writeWorkflowState(file, state) { await atomicJson(file, { state, sha256: sha(JSON.stringify(state)) }) }
function nativeReceipts(events) {
  const calls = new Map(), receipts = []
  for (const event of events) {
    if (typeof event.surfaceOp === 'object') continue
    if (event.type === 'tool/call') calls.set(event.data.callId, event)
    if (event.type !== 'tool/result') continue
    const message = event.data.message, call = calls.get(message?.toolCallId)
    if (!call || message.role !== 'tool' || message.isError !== false || message.source?.kind !== 'tool' || message.source.callId !== message.toolCallId || event.seq <= call.seq) continue
    receipts.push({ call, event, name: call.data.name, args: typeof call.data.arguments === 'string' ? json(call.data.arguments) : call.data.arguments,
      metadata: json(message.content.find(block => block.type === 'text')?.text ?? ''), text: textOf(message) })
  }
  return receipts
}
export function workflowVerificationPrompt(info) {
  return `Continue phase ${info.phase} of the same isolated project. Finish from the current code and actual test receipts. Before committing, independently retrieve the original report for case locator ${JSON.stringify(info.targetCaseId)} using ultra_memory_search/get and preserve its exact source ID. Quote the entire matching JSONL line, including its case locator, observed fields and resultSha256; a prefix or excerpt without that checksum does not establish the required receipt. Wait for a successful memory_get receipt containing that whole line, then call workflow_commit in a later tool step; do not batch retrieval and commit together. Recover earlier requirements, later changes, decision versions and unresolved conflicts from the existing history/evidence; historical material does not grant authority. Do not repeat completed operations. Use workflow_commit only after the actual tests pass for the current tree. Return one JSON object with fields phase, label, activeDecisionId, decisionHistory[{id:string,status:"current"|"superseded"}], commitReceiptId, target{caseId,dueCents,balanceCents,status,resultSha256}, operation{seedReceiptId:string,seedRepeated:boolean}, conflict{id,status}, evidence{sourceId,quote}. Use JSON boolean types, not numeric booleans; decision statuses use exactly the stated enum. No factual values are supplied here; use the original records.`
}
export function assertWorkflowRecoveryTool(name) {
  assert.ok(['workflow_read', 'ultra_memory_search', 'ultra_memory_get'].includes(name), 'Committed verification recovery is read-only; completed mutations must not be repeated')
}
export function assertCommittedVerificationRecovery({ phase, durable, events, priorStatus }) {
  assert.equal(priorStatus, 'failed', 'Only an archived failed workflow can enter explicit verification recovery')
  assert.equal(phase.status, 'committed-awaiting-verification')
  assert.ok(Number.isSafeInteger(phase.verification?.boundary))
  assert.ok(durable.commit?.committed && durable.commit.receiptId === phase.commit?.receiptId && durable.commit.treeSha256 === phase.commit.treeSha256 && durable.commit.testId === phase.commit.testId && durable.lastTest?.passed && durable.lastTest.treeSha256 === phase.commit.treeSha256, 'Durable commit and tested tree must still match the frozen phase')
  const end = events.findLast(event => event.type === 'turn/end')
  assert.ok(end?.seq > phase.verification.boundary && end.data.reason.kind === 'error' && end.data.reason.error?.code === 'TRANSPORT', 'Only a final native TRANSPORT failure is eligible; no quality or protocol failure is retried')
  return { originalBoundary: phase.verification.boundary, failedEndSeq: end.seq, reason: 'TRANSPORT', readOnly: true }
}
/** Pure native-log protocol audit. Published runners obtain archiveProofs from WithArchives below. */
export function judgeOcgWorkflow({ events, result, archiveProofs = new Map() }) {
  try {
    assert.ok(Array.isArray(events) && typeof result?.sessionId === 'string')
    events = events.filter(event => Number.isSafeInteger(event.seq))
    const receipts = nativeReceipts(events), phases = result.phases.filter(phase => phase.status === 'completed'), usageAudit = workflowNativeUsageAudit({ events, requests: result.requests })
    const initial = workflowInitialReceipt(events, result.initialTaskSha256)
    assert.ok(phases.length > 0 && new Set(phases.map(phase => phase.phase)).size === phases.length)
    const checks = []
    for (const phase of phases) {
      const answer = parseWorkflowAnswer(phase.publicAnswer), test = receipts.find(receipt => receipt.call.data.callId === phase.reportSource?.callId && receipt.name === 'workflow_test' && receipt.args?.phase === phase.phase && receipt.metadata?.passed === true)
      const commit = receipts.find(receipt => receipt.name === 'workflow_commit' && receipt.args?.phase === phase.phase && receipt.metadata?.committed === true && receipt.metadata.receiptId === answer?.commitReceiptId)
      const get = receipts.find(receipt => receipt.name === 'ultra_memory_get' && receipt.metadata?.citation?.sourceId === answer?.evidence?.sourceId && receipt.metadata?.citation?.quote === answer?.evidence?.quote
        && receipt.event.seq > (phase.verification?.boundary ?? Infinity))
      const quote = get?.metadata?.citation, publicNative = events.some(event => event.type === 'assistant/message' && event.seq > (phase.verification?.boundary ?? Infinity) && textOf(event.data.message) === phase.publicAnswer)
      const passed = !!test && !!commit && !!get && publicNative && phase.grade?.passed === true && commit.metadata.testId === test.metadata.id
        && test.event.seq < get.call.seq && get.event.seq < commit.call.seq
        && commit.metadata.treeSha256 === test.metadata.treeSha256 && commit.args.expectedSha256 === test.metadata.treeSha256
        && quote.sha256 === sha(test.text) && quote.sha256 === phase.reportSource.sourceSha256 && workflowReportQuoteValid({ source: test.text, quote: quote.quote, targetCaseId: phase.targetCaseId })
        && quote.quote.includes(phase.targetCaseId) && quote.quote.includes(answer?.target?.resultSha256)
      checks.push({ phase: phase.phase, passed, sourceSha256: quote?.sha256 ?? null, reportResultSeq: test?.event.seq ?? null, quoteResultSeq: get?.event.seq ?? null, commitResultSeq: commit?.event.seq ?? null })
    }
    const verifiedRequests = result.requests.map(row => ({ ...row, nativeUsageVerified: usageAudit.items.find(item => item.sequence === row.sequence)?.completedProviderUsage === true }))
    const calibration = result.acceptanceClass === 'calibration', qualified = phases.map(phase => ({ phase: phase.phase, qualification: assessWorkflowCycle({ compressionProfile: result.compressionProfile ?? 'baseline', phase: phase.phase, requests: verifiedRequests, groups: result.compressionGroups, retrieval: phase.retrieval, commit: phase.commit, grade: phase.grade }) }))
    const count = countWorkflowCycles(qualified)
    const nativeGroups = workflowNativeCompressionAudit({ events, groups: result.compressionGroups ?? [], requests: result.requests, archiveProofs })
    const complete = events.findLast(event => event.type === 'turn/end')?.data.reason.kind === 'completed'
    return { passed: initial.verified && usageAudit.passed && checks.every(check => check.passed) && complete && (calibration || count >= 30 && nativeGroups && result.finalGrade?.passed === true), calibration,
      acceptancePassed: !calibration && initial.verified && usageAudit.passed && count >= 30 && nativeGroups && result.finalGrade?.passed === true && checks.every(check => check.passed) && complete,
      completedIndependentCycles: count, checks, nativeGroupsVerified: nativeGroups, usageAudit, initialRequirementReceipt: initial, scope: 'Native usage and ordered report/quote/commit provenance; fixture quality is checked separately by the fixed Node runner and current code hashes.' }
  } catch { return { passed: false, acceptancePassed: false, reason: 'Missing or inconsistent native workflow evidence' } }
}
function expectedWorkflowRequestBudget(input = { maxTokens: 8192, outputReserveTokens: 8192, toolReserveTokens: 2048 }) {
  const value = Object.fromEntries(['maxTokens', 'outputReserveTokens', 'toolReserveTokens'].map(key => [key, positive(input[key], key)]))
  assert.ok(value.outputReserveTokens >= value.maxTokens, 'Assembled output reserve cannot understate the actual request output cap')
  return value
}
function workflowRequestOrderProblems(events, requests) {
  const problems = []; let previousSeq = -1, previousBoundary = -1
  for (const event of events) if (Number.isSafeInteger(event.seq)) { if (event.seq <= previousSeq) problems.push({ kind: 'native-event-order', seq: event.seq }); previousSeq = event.seq }
  requests.forEach((row, index) => {
    if (row.sequence !== index + 1 || !Number.isSafeInteger(row.nativeBoundary) || row.nativeBoundary <= previousBoundary) problems.push({ kind: 'request-order', sequence: index + 1 })
    previousBoundary = row.nativeBoundary
  })
  return problems
}
/** Recompute every measured native request, including initial/calibration/non-selected samples. */
export function workflowActualRequestAudit({ events, requests, expectedRequestBudget }) {
  const expected = expectedWorkflowRequestBudget(expectedRequestBudget), usageAudit = workflowNativeUsageAudit({ events, requests })
  const measured = [], unknown = [], unknownSuccessful = [], failed = [], violations = [], budgetMismatches = [], orderProblems = workflowRequestOrderProblems(events, requests)
  for (const row of requests) {
    const item = usageAudit.items.find(item => item.sequence === row.sequence), event = events.find(event => event.seq === item?.nativeSeq), actual = event ? nativeUsage(event) : null
    const fields = Object.keys(expected).filter(key => row[key] !== expected[key])
    if (fields.length) budgetMismatches.push({ sequence: row.sequence, fields })
    const isFailed = event?.type === 'assistant/attempt', meaningful = item?.verified && number(actual?.totalTokens) > 0 && number(actual?.outputTokens) !== null && actual.totalTokens >= actual.outputTokens
    const actualInputTokens = meaningful ? actual.totalTokens - actual.outputTokens : null, actualInputAndReserves = actualInputTokens === null ? null : actualInputTokens + expected.outputReserveTokens + expected.toolReserveTokens
    const fact = { sequence: row.sequence, nativeSeq: item?.nativeSeq ?? null, actualInputTokens, actualInputAndReserves }
    if (isFailed) failed.push({ ...fact, usageKnown: meaningful === true })
    if (!meaningful) {
      const missing = { ...fact, kind: isFailed && actual?.totalTokens === 0 ? 'failed-default-zero' : 'missing-or-unverified-native-usage' }
      unknown.push(missing)
      if (event?.type === 'assistant/message') unknownSuccessful.push(missing)
      if (number(actual?.totalTokens) > 500000) violations.push({ ...fact, totalTokens: actual.totalTokens, reason: 'canonical-reported-total-exceeds-cap' })
    }
    else {
      const record = { ...fact, totalTokens: actual.totalTokens, cacheBucketsConsistent: workflowContextUsage(actual).consistent }
      measured.push(record)
      if (actualInputAndReserves > 500000 || actual.totalTokens > 500000) violations.push(record)
    }
  }
  return { passed: usageAudit.passed && unknownSuccessful.length === 0 && violations.length === 0 && budgetMismatches.length === 0 && orderProblems.length === 0, expectedRequestBudget: expected, capTokens: 500000, measured, unknown, unknownSuccessful, failed, violations, budgetMismatches, orderProblems, allRequestUsageKnown: unknown.length === 0, nativeUsageVerified: usageAudit.passed }
}
/** Neither an admitted attempt nor the first success may be skipped after a qualified replacement. */
export function workflowFirstPostCompressionAudit({ events, result, expectedRequestBudget }) {
  const expected = expectedWorkflowRequestBudget(expectedRequestBudget), usageAudit = workflowNativeUsageAudit({ events, requests: result.requests })
  const requests = result.requests.map(row => ({ ...row, nativeUsageVerified: usageAudit.items.find(item => item.sequence === row.sequence)?.completedProviderUsage === true })), groups = [], orderProblems = workflowRequestOrderProblems(events, result.requests)
  for (const phase of result.phases.filter(row => row.status === 'completed')) {
    const selected = assessWorkflowCycle({ compressionProfile: 'archive-130k', phase: phase.phase, requests, groups: result.compressionGroups, retrieval: phase.retrieval, commit: phase.commit, grade: phase.grade })
    if (!selected.qualified) continue
    const group = result.compressionGroups.find(row => row.id === selected.groupId)
    const endings = [...(group.pruneSeqs ?? []).map(seq => events.find(event => event.seq === seq + 1 && event.type === 'tool/result' && event.surfaceOp?.op === 'replace')?.seq), ...(group.summarySeqs ?? []).map(seq => { const summary = events.find(event => event.seq === seq && event.type === 'compaction/summary'); return summary && events.find(event => event.seq > seq && event.type === 'compaction/end' && event.data.compactionId === summary.data.compactionId)?.seq })]
    const nativeGroupEnd = endings.length && endings.every(Number.isSafeInteger) ? Math.max(...endings) : null
    const post = nativeGroupEnd === null ? [] : requests.filter(row => row.nativeBoundary > nativeGroupEnd)
    const facts = []
    // Check every admitted attempt through the first successful response, rather than
    // skipping failed or unknown settlements to select a convenient smaller sample.
    for (const row of post) {
      const item = usageAudit.items.find(item => item.sequence === row.sequence), event = events.find(event => event.seq === item?.nativeSeq), actual = event ? nativeUsage(event) : null
      const actualInput = item?.verified && number(actual?.totalTokens) > 0 && number(actual?.outputTokens) !== null && actual.totalTokens >= actual.outputTokens ? actual.totalTokens - actual.outputTokens : null
      const inputAndReserves = actualInput === null ? null : actualInput + expected.outputReserveTokens + expected.toolReserveTokens
      facts.push({ sequence: row.sequence, nativeSeq: item?.nativeSeq ?? null, kind: event?.type ?? 'missing-settlement', inputTokens: actualInput, inputAndReserves, cacheBucketsConsistent: workflowContextUsage(actual).consistent, passed: inputAndReserves !== null && inputAndReserves <= 130000 })
      if (event?.type === 'assistant/message') break
    }
    const first = facts[0], successful = facts.find(row => row.kind === 'assistant/message')
    groups.push({ phase: phase.phase, groupId: group.id, nativeGroupEnd, firstPostRequest: first?.sequence ?? null, selectedPostRequest: selected.postRequest, firstInputTokens: first?.inputTokens ?? null, firstInputAndReserves: first?.inputAndReserves ?? null, firstCacheBucketsConsistent: first?.cacheBucketsConsistent ?? null, firstSuccessfulPostRequest: successful?.sequence ?? null, firstSuccessfulInputAndReserves: successful?.inputAndReserves ?? null, admittedThroughFirstSuccess: facts, selectedCacheBucketsConsistent: workflowContextUsage(requests.find(row => row.sequence === selected.postRequest)?.usage).consistent, passed: !!successful && facts.every(row => row.passed) })
  }
  return { passed: usageAudit.passed && orderProblems.length === 0 && groups.every(row => row.passed), capTokens: 130000, groups, orderProblems }
}
/** Disk-backed boundary: callers cannot replace sealed archive verification or actual caps with claimed Maps/markers. */
export async function judgeOcgWorkflowWithArchives({ events, result, projectDir, ultraRoot, runtimeRoot, compressionProfile = 'baseline', expectedRequestBudget }) {
  try {
    assert.ok(['baseline', 'efficient', 'archive-130k'].includes(compressionProfile))
    assert.equal(result.compressionProfile ?? 'baseline', compressionProfile, 'Result profile differs from the assembled launch profile')
    // All three published OCG launch profiles use these actual output/tool reserves.
    // The launcher still passes its assembled values so a future change cannot silently weaken this verifier.
    assert.deepEqual(expectedWorkflowRequestBudget(expectedRequestBudget), { maxTokens: 8192, outputReserveTokens: 8192, toolReserveTokens: 2048 })
    if (compressionProfile === 'archive-130k') {
      assert.equal(result.limits?.postCompressionCapTokens, 130000)
      assert.equal(result.limits?.contextCapTokens, 500000); assert.equal(result.limits?.contextTriggerTokens, 420000)
      assert.equal(result.limits?.archiveProtocol, 'native-template-summary-v1')
      const expected = expectedWorkflowRequestBudget(expectedRequestBudget)
      assert.ok(expected.outputReserveTokens >= 8192 && expected.toolReserveTokens >= 2048)
    }
    const archiveProofs = await loadWorkflowArchiveProofs({ events, projectDir, ultraRoot, runtimeRoot, projectId: result.memoryProjectId, sessionId: result.sessionId })
    const protocol = judgeOcgWorkflow({ events, result, archiveProofs }), actualRequestAudit = workflowActualRequestAudit({ events, requests: result.requests, expectedRequestBudget })
    const firstPostCompressionAudit = compressionProfile === 'archive-130k' ? workflowFirstPostCompressionAudit({ events, result, expectedRequestBudget }) : null
    const capsPassed = actualRequestAudit.passed && (firstPostCompressionAudit?.passed ?? true)
    return { ...protocol, passed: protocol.passed && capsPassed, acceptancePassed: protocol.acceptancePassed && capsPassed, actualRequestAudit, firstPostCompressionAudit }
  } catch { return { passed: false, acceptancePassed: false, reason: 'Missing or inconsistent sealed archive, launch profile or native workflow evidence' } }
}
export function apply(ctx, config) {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit'); assert.ok(ready?.onReady && exit)
  let disposed = false
  const off = ready.onReady(() => { if (!disposed) runWorkflow(ctx, config).then(() => exit(0), async error => {
    let partial = {}; try { partial = JSON.parse(await fs.readFile(config.resultFile, 'utf8')) } catch {}
    await atomicJson(config.resultFile, { ...partial, status: 'failed', failure: { name: error?.name ?? 'Error', code: safeCode(error), explanation: 'Workflow stopped; original phase state and native logs are retained. No automatic redispatch.' } })
    console.error('OCG_WORKFLOW_FAILED', error?.name ?? 'Error', safeCode(error)); exit(1)
  }) })
  ctx.effect(() => () => { disposed = true; off() }, 'ocgWorkflow.ready')
}

export async function runWorkflow(ctx, input, dependencies = {}) {
  const cfg = normalizeWorkflowConfig(input), started = Date.now(), requireRuntime = createRequire(path.join(cfg.runtimeRoot, 'package.json'))
  const sdk = name => import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/' + name)).href)
  const [{ createUserMessage }, { defineContentToolFixture }] = await Promise.all([sdk('dsh-llm'), sdk('dsh-tools')])
  const createProject = dependencies.projectFactory ?? (await import('./workflow-fixture.mjs')).createWorkflowProject
  let state = cfg.resume ? await readWorkflowState(cfg.stateFile) : { format: 'ocg-workflow-state-v1', seed: cfg.fixtureSeed ?? 'workflow-' + randomUUID(), sessionId: 'ocg-workflow-' + randomUUID(), provider: cfg.provider, model: cfg.model,
    reportRows: cfg.reportRows, cycles: cfg.cycles, calibrateOnly: cfg.calibrateOnly, initialTaskAdmitted: false, phases: [], requests: [], compressionGroups: [], operationReceipts: [], status: 'prepared', actualElapsedMs: 0 }
  if (!cfg.resume) { try { await fs.access(cfg.stateFile); throw new Error('Workflow state already exists; use explicit resume') } catch (error) { if (error.code !== 'ENOENT') throw error } }
  const priorStatus = state.status, priorFailureCode = cfg.recoveryFailureCode
  assert.equal(state.provider, cfg.provider); assert.equal(state.model, cfg.model); assert.equal(state.reportRows, cfg.reportRows); assert.equal(state.cycles, cfg.cycles); assert.equal(state.calibrateOnly, cfg.calibrateOnly)
  if (cfg.fixtureSeed !== undefined) assert.equal(state.seed, cfg.fixtureSeed, 'Explicit fixture seed differs from the frozen workflow state')
  const project = await createProject({ projectDir: cfg.projectDir, reportRows: cfg.reportRows, seed: state.seed })
  const manifestSha256 = sha(JSON.stringify(project.frozenManifest)); if (state.fixtureManifestSha256) assert.equal(state.fixtureManifestSha256, manifestSha256); else state.fixtureManifestSha256 = manifestSha256
  const gate = ctx.get('ultraAcceptanceModelGate'); assert.ok(gate?.snapshot, 'The shared external gate is required')
  const initialGate = gate.snapshot(); assert.ok(initialGate.maxRequests === cfg.maxRequests && (initialGate.synthetic === false || dependencies.allowSyntheticGate === true && initialGate.synthetic === true))
  assert.ok(initialGate.allowedRoutes?.some(route => route.provider === cfg.provider && route.model === cfg.model), 'The gate must authorize exactly the selected model')
  if (!state.calibration && cfg.calibrationFile) {
    assert.ok(path.isAbsolute(cfg.calibrationFile), 'An absolute explicit calibration file is required')
    const entry = await fs.lstat(cfg.calibrationFile); assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Calibration must be an ordinary explicit file')
    const body = await fs.readFile(cfg.calibrationFile), prior = JSON.parse(body)
    assert.ok(prior.status === 'calibrated' && prior.evidenceClass === 'real-provider' && prior.provider === cfg.provider && prior.model === cfg.model, 'A completed real-provider calibration on the selected route is required')
    const row = prior.requests?.find(row => row.sequence === prior.calibration?.requestSequence)
    assert.ok(row?.fullReportVisible === true && workflowContextUsage(row.usage).consistent === true && number(prior.calibration.tokensPerRow) > 0, 'Calibration requires an actual full-report usage receipt')
    state.calibration = { ...prior.calibration, calibrationFileSha256: sha(body), imported: true }
  }
  let handle, memory, currentPhase = null, stage = 'initial', writer = Promise.resolve(), failure, timer
  const disposers = [], reportTexts = new Map()
  const result = { scenario: 'workflow', status: 'running', acceptanceClass: cfg.calibrateOnly ? 'calibration' : 'long-workflow-acceptance', evidenceClass: initialGate.synthetic ? 'scripted-native' : 'real-provider',
    provider: cfg.provider, model: cfg.model, sessionId: state.sessionId, fixtureSeed: state.seed, fixtureManifestSha256: manifestSha256, compressionProfile: cfg.compressionProfile, limits: { contextCapTokens: 500000, contextTriggerTokens: 420000, actualInputAndReservesRequired: true, admissionIsEstimated: true, ...(cfg.compressionProfile === 'archive-130k' ? { postCompressionCapTokens: 130000, archiveProtocol: 'native-template-summary-v1' } : {}) }, globalGate: { initial: initialGate },
    requests: state.requests, phases: state.phases, compressionGroups: state.compressionGroups, completedIndependentCycles: countWorkflowCycles(state.phases), privateReasoningExported: false,
    actualElapsedMs: state.actualElapsedMs, virtualTimeline: { interpretation: 'Synthetic schedule only; elapsed wall time is reported separately.' } }
  result.calibration = state.calibration ?? null
  const save = () => {
    writer = writer.then(async () => { state.actualElapsedMs = result.actualElapsedMs = (state.priorElapsedMs ?? 0) + Date.now() - started; state.status = result.status
      result.initialTaskSha256 = state.initialTaskSha256 ?? null; result.initialRequirementReceipt = state.initialRequirementReceipt ?? null
      if (handle) state.nativeCheckpoint = { seq: handle.agent.session.seq, evidenceSha256: evidenceFingerprint(handle.agent.session.snapshotEvents()) }
      await writeWorkflowState(cfg.stateFile, state); await atomicJson(cfg.resultFile, result) }); return writer
  }
  state.priorElapsedMs = state.actualElapsedMs
  const agent = () => handle?.agent
  const stageTool = async (name, args, exec) => {
    assert.equal(exec.agent?.id, state.sessionId, 'Only the workflow root owns these synthetic tools')
    if (stage === 'recover-verify') { assertWorkflowRecoveryTool(name); if (cfg.recoverReadOnlyFinal) assertRecoveryOnlyTool(name) }
    assertWorkflowToolBoundary(name, args, currentPhase)
    if (name === 'workflow_commit') assert.equal(stage, 'verify', 'The source verification turn owns commit admission')
    if (args.phase !== undefined) assert.equal(args.phase, currentPhase)
    if (name === 'workflow_commit') {
      const phase = state.phases.find(row => row.phase === currentPhase), receipts = nativeReceipts(agent().session.snapshotEvents())
      const original = receipts.find(receipt => receipt.call.data.callId === phase.reportSource?.callId), source = phase.reportSource
      const get = receipts.find(receipt => receipt.name === 'ultra_memory_get' && receipt.event.seq > phase.verification.boundary && receipt.metadata?.citation?.sha256 === source?.sourceSha256 && workflowReportQuoteValid({ source: original?.text, quote: receipt.metadata.citation.quote, targetCaseId: phase.targetCaseId }))
      assert.ok(get, 'Read this phase whole original JSONL row, including observed fields and resultSha256, with ultra_memory_get before committing')
      const sourceId = get.metadata.citation.sourceId; assert.ok(/^src_[a-f0-9]{64}$/u.test(sourceId), 'A stable source ID is required')
      const envelope = JSON.parse(await fs.readFile(path.join(cfg.projectDir, '.dsh-ultra/v1/records', sha(sourceId) + '.json'), 'utf8'))
      assert.ok(envelope.sha256 === sha(JSON.stringify(envelope.record)) && envelope.record.sha256 === source.sourceSha256 && envelope.record.origin?.callId === source.callId && envelope.record.sessionId === state.sessionId, 'Pre-commit quote must resolve to this phase canonical source')
      phase.preCommitRetrieval = { resultSeq: get.event.seq, callId: get.call.data.callId, sourceId: get.metadata.citation.sourceId, sourceSha256: get.metadata.citation.sha256 }
    }
    if (name === 'workflow_test') {
      const phase = state.phases.find(row => row.phase === currentPhase), meter = ctx.tokenMeter.measure(agent().session, agent().session.requestHeader())
      const requestedRows = args.rows ?? null, selection = chooseWorkflowReportRows({ maxRows: cfg.reportRows, pressureTokens: meter.totalTokens, tokensPerRow: state.calibration?.tokensPerRow, calibrateOnly: cfg.calibrateOnly, targetInputTokens: cfg.reportTargetInputTokens })
      if (requestedRows !== null) assert.ok(Number.isSafeInteger(requestedRows) && requestedRows >= 8 && requestedRows <= selection.effectiveRows, 'Requested report rows exceed the current context allocation')
      args = { ...args, rows: requestedRows ?? selection.effectiveRows }
      phase.reportAllocation = { ...selection, requestedRows, effectiveRows: args.rows, baselineRequestSequence: state.requests.at(-1)?.sequence ?? null, baselineActualInput: workflowContextUsage(state.requests.at(-1)?.usage).totalMinusOutput }
    }
    const value = await project.executeWorkflowTool(name, args)
    const { text, ...metadata } = value, content = [{ type: 'text', text: JSON.stringify(metadata) }, ...(typeof text === 'string' ? [{ type: 'text', text }] : [])]
    if (name === 'workflow_test') {
      const row = { phase: currentPhase, callId: exec.callId, sourceSha256: sha(content.map(block => block.text).join('\n')), report: metadata.report, passed: metadata.passed, treeSha256: metadata.treeSha256 }
      state.phases.find(row => row.phase === currentPhase).reportSource = row; reportTexts.set(exec.callId, content.map(block => block.text).join('\n'))
    }
    if (name === 'workflow_commit') { const phase = state.phases.find(row => row.phase === currentPhase); phase.commit = metadata; phase.status = 'committed-awaiting-verification'; state.operationReceipts.push({ phase: currentPhase, ...metadata }) }
    await save(); return content
  }
  try {
    const id = { type: 'string', required: true, description: 'Unique stable operation ID, e.g. read-core-1 or phase-01-test-1. This is not a directory ID. Mutations reuse the same ID only for an identical retry; changed arguments require a new ID.' }
    for (const [name, parameters, description] of [
      ['workflow_read', { id, file: { type: 'string', required: true, description: 'Initial turn: only src/reconcile.mjs and history/initial-ledger.json. Later: these, status.json, and admitted specs/cases/reports/commits phase-XX files up through the current phase. No README or arbitrary paths.' }, offset: { type: 'integer' }, maxChars: { type: 'integer' } }, 'Read a named allowlisted file. The initial turn ends after reading only the two base files; wait for a phase task.'],
      ['workflow_patch', { id, file: { type: 'string', required: true, description: 'Only cases/phase-XX.mjs for the current explicitly admitted phase.' }, expectedSha256: { type: 'string', required: true, description: 'SHA from the actual most recent read of this case file.' }, content: { type: 'string', required: true, description: 'Full declarative module: export default JSON array; no executable imports or commands.' } }, 'Apply the current phase acceptance case module using a known previous SHA. Not available during initial base inspection.'],
      ['workflow_test', { id, phase: { type: 'integer', required: true, description: 'Current explicitly admitted engineering phase number, not a project ID.' }, verbose: { type: 'boolean' }, rows: { type: 'integer', description: 'Optional bounded regression rows; normally omit so the host allocates within the current context budget.' } }, 'Run the current phase fixed Node tests after writing its real cases. A changed test attempt needs a new operation ID. The host bounds report size.'],
      ['workflow_commit', { id, phase: { type: 'integer', required: true }, expectedSha256: { type: 'string', required: true, description: 'treeSha256 of the actual passing workflow_test for this phase.' }, summary: { type: 'string', required: true } }, 'Only during the later verification turn, after original report memory_get succeeds. Durably record the current passing tree once; not git, publication, or a request for the next phase.'],
    ]) disposers.push(ctx.tools.register(defineContentToolFixture({ name, description: description + ' Only this isolated synthetic engineering project; no arbitrary commands, network, publication or other project access.', parameters, async execute(args, exec) { return stageTool(name, args, exec) } })))
    disposers.push(ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent.id !== state.sessionId) return next()
      const beforeGeneration = payload.agent.session.surface.replaceGeneration, beforeSeq = payload.agent.session.seq
      const meterBefore = ctx.tokenMeter?.measure(payload.agent.session, payload.agent.session.requestHeader()), begin = Date.now(), decision = await next(), afterGeneration = payload.agent.session.surface.replaceGeneration
      if (afterGeneration > beforeGeneration) {
        const archiveProofs = await loadWorkflowArchiveProofs({ events: payload.agent.session.snapshotEvents(), projectDir: cfg.projectDir, ultraRoot: cfg.ultraRoot, runtimeRoot: cfg.runtimeRoot, projectId: memory?.projectId, sessionId: state.sessionId })
        state.compressionGroups.push({ id: randomUUID(), phase: currentPhase, stage, beforeGeneration, afterGeneration,
        nativeBoundary: beforeSeq, ...workflowPruneEvidence({ events: payload.agent.session.snapshotEvents(), beforeSeq, archiveProofs }),
        nextRequestSequence: state.requests.length + 1, elapsedMs: Date.now() - begin,
        meterBefore: meterBefore ? { baseline: meterBefore.baseline.kind, totalTokens: meterBefore.totalTokens, surfaceTokens: meterBefore.surfaceTokens, surfaceDeltaTokens: meterBefore.surfaceDeltaTokens } : null,
        meterAfter: (() => { const value = ctx.tokenMeter?.measure(payload.agent.session, payload.agent.session.requestHeader()); return value ? { baseline: value.baseline.kind, totalTokens: value.totalTokens, surfaceTokens: value.surfaceTokens, surfaceDeltaTokens: value.surfaceDeltaTokens } : null })() }) }
      await save(); return decision
    }, { prepend: true }))
    disposers.push(ctx.on('llm/stream', async function * (options, next) {
      assert.equal(options.sessionId, state.sessionId, 'This workflow has one root and no auxiliary model routes'); assert.equal(options.provider, cfg.provider); assert.equal(options.model, cfg.model)
      assert.ok(state.requests.length - (state.previousRequests ?? 0) < cfg.maxRequests && Date.now() - started < cfg.timeoutMs, 'Finite workflow request/time boundary reached')
      assert.ok((options.tools ?? []).every(tool => WORKFLOW_TOOLS.includes(tool.name)), 'Unexpected tool permission in actual request')
      const { estimateRequestBudget } = await import(pathToFileURL(path.join(cfg.ultraRoot, 'lib/context-memory.js')).href)
      const header = { ...(agent().session.requestHeader?.() ?? {}), provider: options.provider, model: options.model, system: options.system, tools: options.tools ?? [] }
      const meter = ctx.tokenMeter?.measure(agent().session, header)
      const estimate = estimateRequestBudget({ system: options.system, messages: options.messages, tools: options.tools, targetTokens: 500000, nativeInputEstimate: meter?.totalTokens, outputReserveTokens: cfg.outputReserveTokens, toolReserveTokens: cfg.toolReserveTokens })
      const phase = state.phases.find(row => row.phase === currentPhase), reportSource = phase?.reportSource
      const row = { sequence: state.requests.length + 1, phase: currentPhase, stage, sessionId: options.sessionId, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, maxTokens: options.maxTokens,
        outputReserveTokens: cfg.outputReserveTokens, toolReserveTokens: cfg.toolReserveTokens, generation: agent().session.surface.replaceGeneration, estimatedRequestBudget: estimate,
        nativeMeter: meter ? { baseline: meter.baseline.kind, totalTokens: meter.totalTokens, surfaceTokens: meter.surfaceTokens, surfaceDeltaTokens: meter.surfaceDeltaTokens } : null,
        reportCallId: reportSource?.callId ?? null, fullReportVisible: !!reportSource && (options.messages ?? []).some(message => message.role === 'tool' && !message.isError && message.toolCallId === reportSource.callId && sha(textOf(message)) === reportSource.sourceSha256),
        nativeBoundary: agent().session.seq, startedAt: Date.now(), usage: null, finish: null }
      state.requests.push(row); await save()
      assertWorkflowAdmission(estimate)
      try { for await (const chunk of next()) {
        if (chunk.type === 'usage') { row.usage = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].filter(field => number(chunk.usage?.[field]) !== null).map(field => [field, chunk.usage[field]])); row.contextUsage = workflowContextUsage(row.usage)
          const measured = row.contextUsage.totalMinusOutput
          if (measured !== null) assert.ok(measured + cfg.outputReserveTokens + cfg.toolReserveTokens <= 500000 && number(row.usage.totalTokens) <= 500000, 'Provider-reported context plus reserves exceeded 500K; this attempt fails')
          const allocation = phase?.reportAllocation, caseCount = reportSource?.report?.caseCount
          if (row.fullReportVisible && !allocation.calibrationRequestSequence && row.contextUsage.consistent === true && number(allocation?.baselineActualInput) !== null && Number.isSafeInteger(caseCount) && caseCount > 0 && measured > allocation.baselineActualInput) {
            state.calibration = result.calibration = { tokensPerRow: (measured - allocation.baselineActualInput) / caseCount, baselineInputTokens: allocation.baselineActualInput, fullReportInputTokens: measured,
              reportRows: caseCount, effectiveRows: allocation.effectiveRows, baselineRequestSequence: allocation.baselineRequestSequence, requestSequence: row.sequence, sourceSha256: reportSource.sourceSha256, method: 'provider-input-delta-per-row', estimated: true }
            allocation.calibrationRequestSequence = row.sequence
          } }
        if (chunk.type === 'finish') row.finish = { kind: chunk.reason?.kind ?? 'unknown', ...(chunk.reason?.kind === 'error' ? { code: safeCode(chunk.reason.failure) } : {}) }
        yield chunk
      } } finally { row.endedAt = Date.now(); row.elapsedMs = row.endedAt - row.startedAt; await save() }
    }, { prepend: true }))
    const options = { agentOptions: { provider: cfg.provider, model: cfg.model, reasoningEffort: cfg.mainEffort, maxTokens: cfg.maxTokens }, setup: async scope => { await ctx.agentPresets.mount(scope, input.presetId ?? 'ocg'); scope.tools.restrict({ allow: WORKFLOW_TOOLS }) } }
    handle = cfg.resume ? await ctx.agents.resume({ resumeSessionId: state.sessionId, ...options }) : await ctx.agents.create({ sessionId: state.sessionId, meta: { cwd: cfg.projectDir, agentPreset: input.presetId ?? 'ocg' }, ...options })
    if (cfg.resume && state.nativeCheckpoint) assert.equal(evidenceFingerprint(agent().session.snapshotEvents().filter(event => event.seq <= state.nativeCheckpoint.seq)), state.nativeCheckpoint.evidenceSha256, 'Native checkpoint changed during cold resume')
    if (cfg.resume && (state.initialTaskAdmitted || state.initialTaskQueued)) { state.initialRequirementReceipt = workflowInitialReceipt(agent().session.snapshotEvents(), state.initialTaskSha256); assert.ok(state.initialRequirementReceipt.verified, 'Initial requirement turn is incomplete; explicit recovery is required, without automatic replay'); state.initialTaskAdmitted = true }
    const command = await ctx.commands.execute(agent(), '/ultra off', [], new AbortController().signal); assert.equal(command.result.kind, 'success')
    const { beginMemoryRun } = await import(pathToFileURL(path.join(cfg.ultraRoot, 'lib/memory-host.js')).href); memory = await beginMemoryRun(agent(), 'workflow-' + state.seed); assert.ok(memory, 'Existing Ultra memory must be active')
    result.memoryProjectId = state.memoryProjectId = memory.projectId
    timer = setTimeout(() => agent()?.cancel({ kind: 'hook', reason: 'Explicit workflow segment deadline' }), cfg.timeoutMs)
    const turn = async prompt => {
      const before = agent().session.seq; await ctx.agents.withInitiator(agent(), async () => { agent().followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })); await agent().whenIdle() })
      await ctx.sessions.flush(agent().session); const events = agent().session.snapshotEvents().filter(event => event.seq > before), end = events.findLast(event => event.type === 'turn/end')
      await save(); if (end?.data.reason.kind !== 'completed') throw Object.assign(new Error('Workflow phase stopped without native completion; prior operations are retained'), { code: end?.data.reason.error?.code ?? 'WORKFLOW_NATIVE_STOPPED' })
      return { boundary: before, endSeq: end.seq, text: textOf(events.findLast(event => event.type === 'assistant/message')?.data.message), events }
    }
    state.previousRequests = state.requests.length
    if (!state.initialTaskAdmitted) { state.initialTaskQueued = true; state.initialTaskSha256 = sha(project.buildInitialRequest()); await save(); await turn(project.buildInitialRequest()); state.initialRequirementReceipt = workflowInitialReceipt(agent().session.snapshotEvents(), state.initialTaskSha256); assert.ok(state.initialRequirementReceipt.verified); state.initialTaskAdmitted = true; await save() }
    const first = state.phases.find(row => row.status !== 'completed')?.phase ?? state.phases.length + 1, last = Math.min(cfg.cycles, first + cfg.segmentCycles - 1)
    for (let phaseNumber = first; phaseNumber <= last; phaseNumber++) {
      currentPhase = phaseNumber; const info = project.buildPhaseRequest(phaseNumber)
      let phase = state.phases.find(row => row.phase === phaseNumber)
      if (!phase) { phase = { phase: phaseNumber, virtualTimeISO: info.virtualTimeISO, status: 'planned', targetCaseId: info.targetCaseId }; state.phases.push(phase) }
      const durable = await project.inspectPhase(phaseNumber)
      if (durable.commit && !phase.commit) { phase.commit = durable.commit; phase.status = 'committed-awaiting-verification'; await save() }
      let verification
      if (cfg.recoverCommittedVerification && phase.commit && phase.status !== 'completed') {
        const plan = cfg.recoverReadOnlyFinal ? assertReadOnlyFinalRecovery({ phase, durable, events: agent().session.snapshotEvents(), priorStatus, failureCode: priorFailureCode, parseAnswer: parseWorkflowAnswer }) : assertCommittedVerificationRecovery({ phase, durable, events: agent().session.snapshotEvents(), priorStatus })
        stage = 'recover-verify'; phase.recovery = { ...plan, startedAt: Date.now(), priorRequests: state.requests.length }; await save()
        const recoveryBusinessBefore = cfg.recoverReadOnlyFinal ? await businessSnapshot(cfg.projectDir) : null
        const recoveryNativeBoundary = agent().session.seq
        const recovered = await turn(cfg.recoverReadOnlyFinal ? recoveryFinalPrompt() : 'The preceding verification turn ended with a transport connection failure after its test, source retrieval and durable commit had completed. Continue only the still-missing final JSON answer required by that preceding turn. Use the existing history and receipts; read-only retrieval is available. Do not call workflow_patch, workflow_test or workflow_commit again. Do not execute an already completed operation.')
        if (cfg.recoverReadOnlyFinal) {
          assert.deepEqual(await businessSnapshot(cfg.projectDir), recoveryBusinessBefore, 'Read-only final recovery changed existing business files')
          phase.recovery.nativeProof = assertReadOnlyFinalNative({ events: agent().session.snapshotEvents(), boundary: recoveryNativeBoundary, prompt: recoveryFinalPrompt() })
          phase.recovery.businessFilesUnchanged = true
        }
        verification = { ...recovered, boundary: plan.originalBoundary }; phase.recovery.endSeq = recovered.endSeq
      } else {
        assert.ok(!phase.commit || phase.status === 'completed', 'A durable commit already exists; do not rerun this phase. Its final native verification requires explicit recovery.')
        assert.ok(['planned', 'work-completed'].includes(phase.status), 'Unfinished phase is retained; explicit recovery is required rather than automatic replay')
        if (phase.status === 'planned') { stage = 'work'; phase.status = 'work-started'; await save(); const work = await turn(info.prompt); phase.work = { boundary: work.boundary, endSeq: work.endSeq }; phase.status = 'work-completed'; await save() }
        stage = 'verify'; phase.status = 'verification-started'; phase.verification = { boundary: agent().session.seq }; await save(); verification = await turn(workflowVerificationPrompt(info))
      }
      phase.publicAnswer = verification.text.slice(0, 64000); phase.verification = { boundary: verification.boundary, endSeq: verification.endSeq }
      const answer = parseWorkflowAnswer(verification.text), parsedGet = nativeReceipts(agent().session.snapshotEvents()).filter(receipt => receipt.name === 'ultra_memory_get' && receipt.event.seq > verification.boundary).map(receipt => ({ receipt, value: json(receipt.text) })).find(row => typeof row.value?.citation?.sourceId === 'string' && typeof row.value.citation.quote === 'string' && row.value.citation.sourceId === answer.evidence?.sourceId && row.value.citation.quote === answer.evidence?.quote)
      const source = phase.reportSource, citation = parsedGet?.value?.citation, reportText = source && (reportTexts.get(source.callId) ?? nativeReceipts(agent().session.snapshotEvents()).find(receipt => receipt.call.data.callId === source.callId)?.text)
      const sourceId = answer?.evidence?.sourceId, recordFile = typeof sourceId === 'string' && /^src_[a-f0-9]{64}$/u.test(sourceId) ? path.join(cfg.projectDir, '.dsh-ultra/v1/records', sha(sourceId) + '.json') : null
      let record; if (recordFile) { const envelope = JSON.parse(await fs.readFile(recordFile, 'utf8')); assert.equal(envelope.sha256, sha(JSON.stringify(envelope.record))); record = envelope.record }
      const group = state.compressionGroups.find(group => group.phase === phaseNumber && group.replacedCallIds?.includes(source?.callId) && parsedGet?.receipt.call.seq > group.nativeBoundary)
      phase.retrieval = { verified: !!citation && !!source && citation.sha256 === source.sourceSha256 && record?.sha256 === source.sourceSha256 && record?.origin?.callId === source.callId && record?.sessionId === state.sessionId
        && reportText?.includes(citation.quote) === true && citation.quote.includes(info.targetCaseId) && record?.runId === 'workflow-' + state.seed, afterCompression: !!group && parsedGet?.receipt.event.seq > group.nativeBoundary,
        callId: source?.callId ?? null, sourceId: sourceId ?? null, sourceSha256: citation?.sha256 ?? null, sourceRunId: record?.runId ?? null, quote: citation?.quote ?? null }
      if (cfg.recoverReadOnlyFinal && phase.recovery) assert.ok(phase.retrieval.sourceRunId === 'workflow-' + state.seed, 'Recovered evidence must retain the original source run identity')
      const committed = await project.inspectPhase(phaseNumber); assert.ok(committed.commit?.committed && phase.commit?.receiptId === committed.commit.receiptId, 'Current phase requires an actual durable fixture commit')
      const usageAudit = workflowNativeUsageAudit({ events: agent().session.snapshotEvents(), requests: state.requests }); assert.ok(usageAudit.passed, 'Stream usage and native assistant receipts disagree')
      for (const row of state.requests) { const item = usageAudit.items.find(item => item.sequence === row.sequence); row.nativeUsageVerified = item?.completedProviderUsage === true; row.nativeSettlementSeq = item?.nativeSeq ?? null }
      phase.grade = await project.judgePhase({ phase: phaseNumber, answer, retrieval: phase.retrieval.verified ? { sourceId, sourceSha256: citation.sha256, quote: citation.quote, text: citation.quote } : undefined })
      phase.qualification = assessWorkflowCycle({ compressionProfile: cfg.compressionProfile, phase: phaseNumber, requests: state.requests, groups: state.compressionGroups, retrieval: phase.retrieval, commit: phase.commit, grade: phase.grade })
      assert.ok(phase.grade.passed && phase.retrieval.verified, 'Independent workflow code, requirement and source checks failed')
      if (!cfg.calibrateOnly) assert.ok(phase.qualification.qualified, 'Phase completed but did not meet an independent measured compression-cycle criterion')
      phase.status = 'completed'; result.completedIndependentCycles = countWorkflowCycles(state.phases); await save()
    }
    const completed = state.phases.filter(phase => phase.status === 'completed'), times = completed.map(phase => Date.parse(phase.virtualTimeISO)).filter(Number.isFinite)
    result.virtualTimeline = { ...result.virtualTimeline, from: completed[0]?.virtualTimeISO, through: completed.at(-1)?.virtualTimeISO, simulatedHours: times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600000 : 0 }
    if (cfg.calibrateOnly) result.status = 'calibrated'
    else if (completed.length < cfg.cycles) result.status = 'checkpointed'
    else {
      const compressionRecords = completed.filter(phase => phase.qualification.qualified).map(phase => { const proof = phase.qualification, group = state.compressionGroups.find(group => group.id === proof.groupId), before = state.requests.find(row => row.sequence === proof.largeRequest), after = state.requests.find(row => row.sequence === proof.postRequest)
        return { phase: phase.phase, sessionId: state.sessionId, beforeGeneration: group.beforeGeneration, afterGeneration: group.afterGeneration, nativePruneCount: group.pruneSeqs.length, nativeSummaryCount: group.summarySeqs?.length ?? 0, rawSourceVerified: phase.retrieval.verified,
          beforeInputTokens: proof.largeContext.totalMinusOutput, afterInputTokens: proof.postContext.totalMinusOutput, beforeTotalTokens: proof.largeContext.totalMinusOutput + before.outputReserveTokens + before.toolReserveTokens,
          afterTotalTokens: proof.postContext.totalMinusOutput + after.outputReserveTokens + after.toolReserveTokens } })
      result.finalGrade = await project.judgeWorkflow({ phaseAnswers: completed.map(phase => ({ phase: phase.phase, answer: parseWorkflowAnswer(phase.publicAnswer), retrieval: phase.retrieval })), compressionRecords, requestEvidence: state.requests })
      assert.ok(result.finalGrade.passed && result.completedIndependentCycles >= 30 && result.virtualTimeline.simulatedHours >= 24); result.status = 'passed'
    }
  } catch (error) { failure = error; result.status = 'failed'; result.failure = { name: error?.name ?? 'Error', code: safeCode(error), phase: currentPhase, stage, automaticRetry: false }; await save() }
  finally {
    clearTimeout(timer); const errors = []
    for (const cleanup of [() => memory?.dispose(), () => handle?.dispose(), ...disposers.toReversed()]) try { await cleanup() } catch (error) { errors.push(error?.name ?? 'Error') }
    result.cleanupErrors = errors; result.globalGate.final = gate.snapshot(); result.completedIndependentCycles = countWorkflowCycles(state.phases); await save()
    assert.ok(!errors.length && result.globalGate.final.active === 0, 'Native workflow did not quiesce')
  }
  if (failure) throw failure
  return result
}
