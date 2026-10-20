import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'
import * as workflow from '../scripts/host-acceptance/ocg-workflow-plugin.mjs'

test('workflow provider receipts separate the two context calculations and never invent missing usage', () => {
  assert.deepEqual(workflow.workflowContextUsage({ inputTokens: 100, cacheReadTokens: 419900, outputTokens: 500, totalTokens: 420500 }), { totalMinusOutput: 420000, inputPlusCacheRead: 420000, consistent: true })
  assert.deepEqual(workflow.workflowContextUsage({ inputTokens: 100, outputTokens: 500, totalTokens: 420500 }), { totalMinusOutput: 420000, inputPlusCacheRead: null, consistent: null })
  assert.equal(workflow.workflowContextUsage({ inputTokens: 10, cacheReadTokens: 10, outputTokens: 5, totalTokens: 500 }).consistent, false)
})

function proof() {
  return { phase: 1, requests: [{ sequence: 1, phase: 1, nativeUsageVerified: true, fullReportVisible: true, reportCallId: 'original-report', usage: { inputTokens: 420000, cacheReadTokens: 0, outputTokens: 100, totalTokens: 420100 }, outputReserveTokens: 8192, toolReserveTokens: 2048 },
    { sequence: 2, phase: 1, nativeUsageVerified: true, fullReportVisible: false, usage: { inputTokens: 5000, cacheReadTokens: 1000, outputTokens: 100, totalTokens: 6100 }, outputReserveTokens: 8192, toolReserveTokens: 2048 }],
    groups: [{ id: 'compression-1', phase: 1, beforeGeneration: 2, afterGeneration: 4, nextRequestSequence: 2, pruneSeqs: [101, 103], replacedCallIds: ['original-report'] }], retrieval: { verified: true, afterCompression: true, callId: 'original-report', sourceId: 'src-real', sourceSha256: 'a'.repeat(64) }, commit: { committed: true, duplicate: false, receiptId: 'commit1' }, grade: { passed: true } }
}
test('one independent cycle needs provider-context evidence, later real compaction, subsequent request, source and actual commit', () => {
  const value = proof(), result = workflow.assessWorkflowCycle(value)
  assert.equal(result.qualified, true)
  assert.equal(result.independentCompressions, 1, 'two prune events and generation +2 remain one cycle')
  assert.equal(result.groupId, 'compression-1')
  for (const mutate of [
    row => { row.groups = [] }, row => { row.requests[1].sequence = 1 }, row => { row.requests[0].usage.totalTokens = 500101 },
    row => { row.requests[0].usage.inputTokens = 0 }, row => { row.retrieval.verified = false }, row => { row.retrieval.afterCompression = false },
    row => { row.commit.committed = false }, row => { row.grade.passed = false },
    row => { row.requests[0].fullReportVisible = undefined }, row => { row.requests[1].fullReportVisible = true },
    row => { row.groups[0].replacedCallIds = ['some-older-report'] }, row => { row.retrieval.callId = 'different-report' },
  ]) { const row = proof(); mutate(row); assert.equal(workflow.assessWorkflowCycle(row).qualified, false) }
})

test('native compression audit includes the event at the pre-step next-seq boundary and links shadowed results', () => {
  const events = [{ seq: 90, type: 'tool/result', data: { message: { toolCallId: 'report-call' } } }, { seq: 100, type: 'compaction/prune', data: { shadowedSeqs: [90] } }]
  assert.deepEqual(workflow.workflowPruneEvidence({ events, beforeSeq: 100 }), { pruneSeqs: [100], shadowedSeqs: [90], replacedCallIds: ['report-call'] })
})

test('estimated request admission fails before dispatch rather than after a provider usage chunk', () => {
  assert.throws(() => workflow.assertWorkflowAdmission({ withinBudget: false, totalTokens: 500001 }), /500K/)
  assert.doesNotThrow(() => workflow.assertWorkflowAdmission({ withinBudget: true, totalTokens: 499999 }))
})

test('disk compaction audit binds group generation and exact replaced source to the subsequent request boundary', () => {
  const events = [{ seq: 90, type: 'tool/result', data: { message: { toolCallId: 'report-call' } } }, { seq: 100, type: 'compaction/prune', data: { shadowedSeqs: [90] } }, { seq: 101, type: 'tool/result', surfaceOp: { op: 'replace', startSeq: 90, endSeq: 90 }, sourceEventSeqs: [90] }]
  const group = { nativeBoundary: 100, nextRequestSequence: 2, beforeGeneration: 0, afterGeneration: 1, pruneSeqs: [100], shadowedSeqs: [90], replacedCallIds: ['report-call'] }, requests = [{ sequence: 2, nativeBoundary: 102 }]
  assert.equal(workflow.workflowNativeCompressionAudit({ events, groups: [group], requests }), true)
  assert.equal(workflow.workflowNativeCompressionAudit({ events, groups: [{ ...group, replacedCallIds: ['other-report'] }], requests }), false)
  assert.equal(workflow.workflowNativeCompressionAudit({ events, groups: [{ ...group, afterGeneration: 2 }], requests }), false)
})
test('workflow cycle counter deduplicates phase and group identities across checkpoints', () => {
  assert.equal(workflow.countWorkflowCycles([{ phase: 1, qualification: { qualified: true, groupId: 'g1' } }, { phase: 1, qualification: { qualified: true, groupId: 'g1' } }, { phase: 2, qualification: { qualified: true, groupId: 'g1' } }]), 1)
})
test('workflow config pins the authorized model and persistent paths, accepts small calibration and finite segments', () => {
  const root = path.resolve('synthetic-workflow-config-unit')
  const input = { runtimeRoot: path.join(root, 'runtime'), ultraRoot: path.join(root, 'candidate'), projectDir: path.join(root, 'project'), resultFile: path.join(root, 'result.json'), stateFile: path.join(root, 'state.json'), provider: 'opencode-go', model: 'deepseek-v4.1-flash', mainEffort: 'low', maxRequests: 200, timeoutMs: 600000, reportRows: 1000, cycles: 30, calibrateOnly: true, segmentCycles: 1 }
  const cfg = workflow.normalizeWorkflowConfig(input)
  assert.equal(cfg.reportRows, 1000); assert.equal(cfg.contextCapTokens, 500000); assert.equal(cfg.contextTriggerTokens, 420000)
  for (const mutate of [row => { row.provider = 'other' }, row => { row.model = 'other' }, row => { row.maxRequests = Infinity }, row => { row.reportRows = 0 }, row => { row.stateFile = 'relative.json' }]) { const row = { ...input }; mutate(row); assert.throws(() => workflow.normalizeWorkflowConfig(row)) }
  for (const key of ['runtimeRoot', 'ultraRoot', 'projectDir', 'resultFile', 'stateFile']) assert.throws(() => workflow.normalizeWorkflowConfig({ ...input, [key]: 'relative-path' }))
  assert.equal(workflow.normalizeWorkflowConfig({ ...input, fixtureSeed: 'workflow-fixed-case:1' }).fixtureSeed, 'workflow-fixed-case:1')
  for (const fixtureSeed of ['', {}, 123, 'x'.repeat(161), '../path', 'seed\nnext']) assert.throws(() => workflow.normalizeWorkflowConfig({ ...input, fixtureSeed }))
})

test('native disk workflow judge rejects result claims without paired report, quote and actual commit receipts', () => {
  assert.equal(typeof workflow.judgeOcgWorkflow, 'function')
  const result = { status: 'calibrated', acceptanceClass: 'calibration', sessionId: 'root', phases: [{ phase: 1, status: 'completed', grade: { passed: true }, reportSource: { callId: 'test' }, publicAnswer: '{}' }], requests: [] }
  assert.equal(workflow.judgeOcgWorkflow({ events: [], result }).passed, false)
})

test('report rows adapt to current pressure and measured density with a fixed maximum and no hidden enlargement', () => {
  assert.deepEqual(workflow.chooseWorkflowReportRows({ maxRows: 12000, pressureTokens: 30000, tokensPerRow: 400, calibrateOnly: false }).effectiveRows, 1000)
  assert.equal(workflow.chooseWorkflowReportRows({ maxRows: 12000, pressureTokens: 350000, tokensPerRow: 400, calibrateOnly: false }).effectiveRows, 200)
  assert.equal(workflow.chooseWorkflowReportRows({ maxRows: 100, pressureTokens: 10000, calibrateOnly: true }).effectiveRows, 100)
  assert.throws(() => workflow.chooseWorkflowReportRows({ maxRows: 12000, pressureTokens: 30000, calibrateOnly: false }), /density/)
  assert.throws(() => workflow.chooseWorkflowReportRows({ maxRows: 12000, pressureTokens: 429000, tokensPerRow: 400, calibrateOnly: false }), /fit/)
})

test('current phase tool boundaries deny initial mutations and future cases after a commit advances backend state', () => {
  assert.doesNotThrow(() => workflow.assertWorkflowToolBoundary('workflow_read', { file: 'src/reconcile.mjs' }, null))
  assert.doesNotThrow(() => workflow.assertWorkflowToolBoundary('workflow_patch', { file: 'cases/phase-01.mjs' }, 1))
  for (const [name, args, phase] of [['workflow_read', { file: 'README.md' }, null], ['workflow_patch', { file: 'cases/phase-01.mjs' }, null], ['workflow_patch', { file: 'cases/phase-02.mjs' }, 1], ['workflow_read', { file: 'specs/phase-02.json' }, 1], ['workflow_test', { phase: 2 }, 1]]) assert.throws(() => workflow.assertWorkflowToolBoundary(name, args, phase))
})

const sha = value => createHash('sha256').update(value).digest('hex')
test('initial requirement receipt must be a single original user message followed by a completed native turn', () => {
  const user = { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Original constraints' }] } }, end = { seq: 2, type: 'turn/end', data: { reason: { kind: 'completed' } } }
  assert.equal(workflow.workflowInitialReceipt([user, end], sha('Original constraints')).verified, true)
  for (const events of [[], [user], [user, { ...end, data: { reason: { kind: 'error' } } }], [user, end, { ...user, seq: 3 }], [{ ...user, data: { ...user.data, source: { kind: 'tool' } } }, end]]) assert.equal(workflow.workflowInitialReceipt(events, sha('Original constraints')).verified, false)
})

test('provider usages are independently paired with native numeric receipts, missing and altered values are not verified', () => {
  const usage = { inputTokens: 50, cacheReadTokens: 20, outputTokens: 2, totalTokens: 72 }, event = { seq: 5, type: 'assistant/message', data: { turn: 1, step: 1, usage } }
  const row = { sequence: 1, nativeBoundary: 3, usage }
  assert.equal(workflow.workflowNativeUsageAudit({ events: [event], requests: [row] }).items[0].verified, true)
  assert.equal(workflow.workflowNativeUsageAudit({ events: [], requests: [row] }).passed, false)
  assert.equal(workflow.workflowNativeUsageAudit({ events: [event], requests: [{ ...row, usage: { ...usage, inputTokens: 51 } }] }).passed, false)
  assert.equal(workflow.workflowNativeUsageAudit({ events: [event, { ...event, seq: 6 }], requests: [row] }).passed, false)
})

function nativeCalibration({ commitFirst = false } = {}) {
  const target = JSON.stringify({ caseId: 'audit-phase-01', observed: { dueCents: 123 }, resultSha256: 'b'.repeat(64) }), tm = { id: 'test-1', phase: 1, passed: true, treeSha256: 'a'.repeat(64) }, sourceSha = sha(JSON.stringify(tm) + '\n' + target), sourceId = 'src_' + 'c'.repeat(64)
  const answer = { phase: 1, commitReceiptId: 'commit-1', target: { resultSha256: 'b'.repeat(64) }, evidence: { sourceId, quote: target } }
  const pair = (name, args, meta, seq, id, body) => [{ seq, type: 'tool/call', data: { name, callId: id, arguments: JSON.stringify(args) } }, { seq: seq + 1, type: 'tool/result', surfaceOp: 'append', data: { message: { role: 'tool', toolCallId: id, source: { kind: 'tool', callId: id }, isError: false, content: [{ type: 'text', text: JSON.stringify(meta) }, ...(body ? [{ type: 'text', text: body }] : [])] } } }]
  const commit = seq => pair('workflow_commit', { phase: 1, expectedSha256: 'a'.repeat(64) }, { committed: true, receiptId: 'commit-1', testId: 'test-1', treeSha256: 'a'.repeat(64) }, seq, 'commit-call')
  const get = seq => pair('ultra_memory_get', { id: sourceId, quote: target }, { citation: { sourceId, quote: target, sha256: sourceSha } }, seq, 'get-call')
  const usage = { inputTokens: 100, cacheReadTokens: 0, outputTokens: 5, totalTokens: 105 }
  const events = [{ seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Initial task' }] } }, { seq: 1, type: 'turn/end', data: { reason: { kind: 'completed' } } }, ...pair('workflow_test', { phase: 1 }, tm, 2, 'test-call', target), ...(commitFirst ? [...commit(4), ...get(6)] : [...get(4), ...commit(6)]), { seq: 8, type: 'assistant/message', data: { usage, message: { content: [{ type: 'text', text: JSON.stringify(answer) }] } } }, { seq: 9, type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  const result = { acceptanceClass: 'calibration', sessionId: 'root', initialTaskSha256: sha('Initial task'), phases: [{ phase: 1, status: 'completed', grade: { passed: true }, reportSource: { callId: 'test-call', sourceSha256: sourceSha }, verification: { boundary: 1 }, targetCaseId: 'audit-phase-01', publicAnswer: JSON.stringify(answer) }], requests: [{ sequence: 1, nativeBoundary: 7, usage }], compressionGroups: [] }
  return { events, result }
}

test('native calibration judge refuses post-commit evidence retrieval even when SHA and final answers match', () => {
  assert.equal(workflow.judgeOcgWorkflow(nativeCalibration()).passed, true)
  assert.equal(workflow.judgeOcgWorkflow(nativeCalibration({ commitFirst: true })).passed, false)
})

test('final answer accepts one JSON object or a sole json fence, refuses prose/multiple blocks, and never coerces enum or boolean values', () => {
  const answer = { decisionHistory: [{ id: 'v1', status: 'active' }], operation: { seedRepeated: 0 } }
  for (const body of [JSON.stringify(answer), '```json\n' + JSON.stringify(answer) + '\n```']) assert.deepEqual(workflow.parseWorkflowAnswer(body), answer)
  for (const body of ['Explanation\n' + JSON.stringify(answer), '```json\n{}\n```\n```json\n{}\n```', 'undefined', '[]']) assert.throws(() => workflow.parseWorkflowAnswer(body), /JSON/)
  const prompt = workflow.workflowVerificationPrompt({ phase: 1, targetCaseId: 'case-locator' })
  assert.match(prompt, /current.*superseded/); assert.match(prompt, /seedRepeated:boolean/)
  assert.match(prompt, /entire.*JSONL.*observed.*resultSha256/)
})

test('commit quote contains the whole actual target JSONL row, not a prefix that omits its result checksum', () => {
  const row = JSON.stringify({ type: 'executed-order-case', caseId: 'audit-locator', observed: { dueCents: 123 }, resultSha256: 'a'.repeat(64) }), source = '{"report":{"id":"metadata"}}\n' + row + '\n'
  assert.equal(workflow.workflowReportQuoteValid({ source, quote: row, targetCaseId: 'audit-locator' }), true)
  assert.equal(workflow.workflowReportQuoteValid({ source, quote: row.slice(0, row.indexOf(',"resultSha256"')), targetCaseId: 'audit-locator' }), false)
  assert.equal(workflow.workflowReportQuoteValid({ source, quote: row, targetCaseId: 'different-case' }), false)
  assert.equal(workflow.workflowReportQuoteValid({ source, quote: row.replace('123', '124'), targetCaseId: 'audit-locator' }), false)
})

test('failed native attempts unwrap terminal chunks but never qualify zero default usage as a completed provider request', () => {
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const event = { seq: 8, type: 'assistant/attempt', data: { stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }, { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', error: { code: 'TRANSPORT' } } } }] } }
  const audit = workflow.workflowNativeUsageAudit({ events: [event], requests: [{ sequence: 1, nativeBoundary: 7, usage }] })
  assert.equal(audit.passed, true)
  assert.equal(audit.items[0].verified, true)
  assert.equal(audit.items[0].completedProviderUsage, false)
})

test('explicit committed verification recovery requires the same durable receipt and a terminal TRANSPORT failure', () => {
  const phase = { phase: 1, status: 'committed-awaiting-verification', verification: { boundary: 20 }, commit: { receiptId: 'commit-1', treeSha256: 'a'.repeat(64), testId: 'test-1' } }
  const durable = { commit: { ...phase.commit, committed: true }, lastTest: { passed: true, treeSha256: 'a'.repeat(64) } }
  const events = [{ seq: 40, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'TRANSPORT' } } } }]
  const plan = workflow.assertCommittedVerificationRecovery({ phase, durable, events, priorStatus: 'failed' })
  assert.equal(plan.originalBoundary, 20); assert.equal(plan.failedEndSeq, 40)
  for (const change of [row => { row.priorStatus = 'running' }, row => { row.phase = { ...phase, status: 'work-started' } }, row => { row.durable = { ...durable, commit: { ...durable.commit, receiptId: 'other' } } }, row => { row.events = [{ ...events[0], data: { reason: { kind: 'error', error: { code: 'INVALID_CONFIG' } } } }] }]) {
    const input = { phase, durable, events, priorStatus: 'failed' }; change(input); assert.throws(() => workflow.assertCommittedVerificationRecovery(input))
  }
  for (const name of ['workflow_patch', 'workflow_test', 'workflow_commit']) assert.throws(() => workflow.assertWorkflowRecoveryTool(name), /read-only/)
  for (const name of ['workflow_read', 'ultra_memory_search', 'ultra_memory_get']) assert.doesNotThrow(() => workflow.assertWorkflowRecoveryTool(name))
})
