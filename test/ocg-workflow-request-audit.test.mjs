import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as workflow from '../scripts/host-acceptance/ocg-workflow-plugin.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')
const budget = { maxTokens: 8192, outputReserveTokens: 8192, toolReserveTokens: 2048 }
function calibration(inputTokens) {
  const target = JSON.stringify({ caseId: 'audit-phase-01', observed: { dueCents: 123 }, resultSha256: 'b'.repeat(64) }), tm = { id: 'test-1', phase: 1, passed: true, treeSha256: 'a'.repeat(64) }, sourceSha = sha(JSON.stringify(tm) + '\n' + target), sourceId = 'src_' + 'c'.repeat(64)
  const answer = { phase: 1, commitReceiptId: 'commit-1', target: { resultSha256: 'b'.repeat(64) }, evidence: { sourceId, quote: target } }
  const pair = (name, args, meta, seq, id, body) => [{ seq, type: 'tool/call', data: { name, callId: id, arguments: JSON.stringify(args) } }, { seq: seq + 1, type: 'tool/result', surfaceOp: 'append', data: { message: { role: 'tool', toolCallId: id, source: { kind: 'tool', callId: id }, isError: false, content: [{ type: 'text', text: JSON.stringify(meta) }, ...(body ? [{ type: 'text', text: body }] : [])] } } }]
  const usage = { inputTokens, cacheReadTokens: 0, outputTokens: 5, totalTokens: inputTokens + 5 }
  const events = [{ seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Initial task' }] } }, { seq: 1, type: 'turn/end', data: { reason: { kind: 'completed' } } }, ...pair('workflow_test', { phase: 1 }, tm, 2, 'test-call', target), ...pair('ultra_memory_get', { id: sourceId, quote: target }, { citation: { sourceId, quote: target, sha256: sourceSha } }, 4, 'get-call'), ...pair('workflow_commit', { phase: 1, expectedSha256: 'a'.repeat(64) }, { committed: true, receiptId: 'commit-1', testId: 'test-1', treeSha256: 'a'.repeat(64) }, 6, 'commit-call'), { seq: 8, type: 'assistant/message', data: { usage, message: { content: [{ type: 'text', text: JSON.stringify(answer) }] } } }, { seq: 9, type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  const result = { compressionProfile: 'baseline', acceptanceClass: 'calibration', sessionId: 'root', initialTaskSha256: sha('Initial task'), phases: [{ phase: 1, status: 'completed', grade: { passed: true }, reportSource: { callId: 'test-call', sourceSha256: sourceSha }, verification: { boundary: 1 }, targetCaseId: 'audit-phase-01', publicAnswer: JSON.stringify(answer) }], requests: [{ sequence: 1, nativeBoundary: 7, usage, ...budget }], compressionGroups: [] }
  return { events, result, compressionProfile: 'baseline', expectedRequestBudget: budget }
}
test('strict async disk audit checks the 500K actual cap for calibration and non-qualified requests', async () => {
  assert.equal((await workflow.judgeOcgWorkflowWithArchives(calibration(489760))).passed, true)
  const input = calibration(489761), before = structuredClone(input)
  assert.equal(workflow.judgeOcgWorkflow(input).passed, true, 'Old synchronous protocol API remains compatible')
  const disk = await workflow.judgeOcgWorkflowWithArchives(input)
  assert.equal(disk.passed, false); assert.equal(disk.actualRequestAudit.violations[0].actualInputAndReserves, 500001)
  assert.deepEqual(input, before)
})
test('actual native cap uses assembled reserves, refuses row understatements and keeps missing cache buckets distinct', async () => {
  const input = calibration(489760); input.result.requests[0].toolReserveTokens = 1
  const disk = await workflow.judgeOcgWorkflowWithArchives(input)
  assert.equal(disk.passed, false); assert.equal(disk.actualRequestAudit.budgetMismatches.length, 1)
  const missingCache = calibration(100000); delete missingCache.events.find(row => row.type === 'assistant/message').data.usage.cacheReadTokens
  delete missingCache.result.requests[0].usage.cacheReadTokens
  const checked = workflow.workflowActualRequestAudit({ events: missingCache.events, requests: missingCache.result.requests, expectedRequestBudget: budget })
  assert.equal(checked.passed, true); assert.equal(checked.measured[0].actualInputAndReserves, 110240); assert.equal(checked.measured[0].cacheBucketsConsistent, null)
  for (const fields of [{ outputReserveTokens: 0 }, { toolReserveTokens: 0 }, { outputReserveTokens: 0, toolReserveTokens: 0 }]) { const forged = calibration(489761); Object.assign(forged.result.requests[0], fields); const failed = await workflow.judgeOcgWorkflowWithArchives(forged); assert.equal(failed.passed, false); assert.equal(failed.actualRequestAudit.violations[0].actualInputAndReserves, 500001) }
  const forgedProfile = calibration(489761); forgedProfile.expectedRequestBudget = { maxTokens: 1, outputReserveTokens: 1, toolReserveTokens: 1 }; Object.assign(forgedProfile.result.requests[0], forgedProfile.expectedRequestBudget)
  assert.equal((await workflow.judgeOcgWorkflowWithArchives(forgedProfile)).passed, false, 'A claimed budget cannot redefine this fixed OCG launch profile')
})
test('unknown and failed default-zero attempts are retained without manufacturing a zero actual input', () => {
  const requests = [{ sequence: 1, nativeBoundary: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, finish: { kind: 'error' }, ...budget }, { sequence: 2, nativeBoundary: 3, usage: null, ...budget }]
  const events = [{ seq: 2, type: 'assistant/attempt', data: { usage: requests[0].usage } }, { seq: 4, type: 'assistant/message', data: {} }]
  const audit = workflow.workflowActualRequestAudit({ events, requests, expectedRequestBudget: budget })
  assert.equal(audit.measured.length, 0); assert.equal(audit.unknown.length, 2); assert.equal(audit.failed.length, 1)
  assert.equal(audit.passed, false); assert.equal(audit.allRequestUsageKnown, false, 'Successful unknown usage cannot prove the actual request cap')
  assert.deepEqual(audit.unknownSuccessful.map(row => row.sequence), [2])
  assert.ok(audit.unknown.every(row => row.actualInputTokens === null && row.actualInputAndReserves === null))
})
test('strict asynchronous calibration cannot pass a successful native message with unknown usage', async () => {
  const input = calibration(10000); input.result.requests[0].usage = null
  input.events.find(row => row.type === 'assistant/message').data.usage = null
  assert.equal(workflow.judgeOcgWorkflow(input).passed, true, 'The legacy protocol-only API remains unchanged')
  const checked = await workflow.judgeOcgWorkflowWithArchives(input)
  assert.equal(checked.passed, false); assert.equal(checked.actualRequestAudit.unknownSuccessful.length, 1)
  assert.equal(checked.actualRequestAudit.unknownSuccessful[0].actualInputTokens, null)
})
test('unknown failed usage remains explicitly partial and never fabricates measured input zero', () => {
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const checked = workflow.workflowActualRequestAudit({ events: [{ seq: 2, type: 'assistant/attempt', data: { usage } }], requests: [{ sequence: 1, nativeBoundary: 1, usage, ...budget }], expectedRequestBudget: budget })
  assert.equal(checked.passed, true); assert.equal(checked.allRequestUsageKnown, false)
  assert.equal(checked.unknown[0].actualInputTokens, null); assert.equal(checked.failed[0].usageKnown, false)
  assert.deepEqual(checked.unknownSuccessful, [])
})
test('a known native total over 500K is rejected even when output usage is missing', async () => {
  const input = calibration(600000); delete input.result.requests[0].usage.outputTokens
  const audit = await workflow.judgeOcgWorkflowWithArchives(input)
  assert.equal(audit.passed, false); assert.equal(audit.actualRequestAudit.unknown.length, 1)
  assert.equal(audit.actualRequestAudit.violations[0].totalTokens, 600005)
  assert.equal(audit.actualRequestAudit.violations[0].actualInputAndReserves, null)
})
function postFixture() {
  const usage = (input, cache = true) => ({ inputTokens: input, ...(cache ? { cacheReadTokens: 0 } : {}), outputTokens: 100, totalTokens: input + 100 })
  const requests = [{ sequence: 1, phase: 1, nativeBoundary: 1, fullReportVisible: true, reportCallId: 'report', usage: usage(445000), ...budget }, { sequence: 2, phase: 1, nativeBoundary: 5, fullReportVisible: false, usage: usage(119761, false), ...budget }, { sequence: 3, phase: 1, nativeBoundary: 7, fullReportVisible: false, usage: usage(10000), ...budget }]
  const events = [{ seq: 3, type: 'compaction/prune', data: {} }, { seq: 4, type: 'tool/result', surfaceOp: { op: 'replace' }, data: {} }, ...requests.map(row => ({ seq: row.nativeBoundary + 1, type: 'assistant/message', data: { usage: row.usage } }))].sort((a,b)=>a.seq-b.seq)
  const group = { id: 'g', phase: 1, nativeBoundary: 3, nextRequestSequence: 2, beforeGeneration: 0, afterGeneration: 1, pruneSeqs: [3], replacedCallIds: ['report'] }
  const phase = { phase: 1, status: 'completed', grade: { passed: true }, retrieval: { verified: true, afterCompression: true, callId: 'report' }, commit: { committed: true } }
  return { events, result: { compressionProfile: 'archive-130k', phases: [phase], requests, compressionGroups: [group] }, expectedRequestBudget: budget }
}
test('archive audit cannot skip the first successful post request when cache components are missing', () => {
  const input = postFixture(), checked = workflow.workflowFirstPostCompressionAudit(input)
  assert.equal(checked.passed, false); assert.equal(checked.groups[0].firstPostRequest, 2); assert.equal(checked.groups[0].selectedPostRequest, 3)
  assert.equal(checked.groups[0].firstInputAndReserves, 130001); assert.equal(checked.groups[0].firstCacheBucketsConsistent, null)
  input.result.requests[1].usage.inputTokens--; input.result.requests[1].usage.totalTokens--
  assert.equal(workflow.workflowFirstPostCompressionAudit(input).passed, true)
})
test('first actual post selection follows the native replacement end rather than a mutable nextRequestSequence claim', () => {
  const input = postFixture(); input.result.compressionGroups[0].nextRequestSequence = 3
  const checked = workflow.workflowFirstPostCompressionAudit(input)
  assert.equal(checked.passed, false); assert.equal(checked.groups[0].firstPostRequest, 2)
})
test('unsorted or repeated request/native ordering cannot hide the first successful oversized post sample', () => {
  for (const mutate of [row => { row.result.requests.reverse() }, row => { row.result.requests[1].sequence = 1 }, row => { row.result.requests[2].nativeBoundary = row.result.requests[1].nativeBoundary }, row => { row.events.reverse() }, row => { row.events.push(structuredClone(row.events.at(-1))) }]) { const input = postFixture(); mutate(input); assert.equal(workflow.workflowFirstPostCompressionAudit(input).passed, false); assert.equal(workflow.workflowActualRequestAudit({ events: input.events, requests: input.result.requests, expectedRequestBudget: budget }).passed, false) }
})
test('a first admitted unknown post cannot be skipped even when a smaller successful request follows', () => {
  const unknown = postFixture(); unknown.result.requests[1].usage = null; unknown.events.find(row => row.seq === 6).data.usage = null
  const checked = workflow.workflowFirstPostCompressionAudit(unknown)
  assert.equal(checked.passed, false); assert.equal(checked.groups[0].firstPostRequest, 2); assert.equal(checked.groups[0].firstInputTokens, null)
  const failed = postFixture(), usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  failed.result.requests[1].usage = usage; const attempt = failed.events.find(row => row.seq === 6); attempt.type = 'assistant/attempt'; attempt.data.usage = usage
  const resumed = workflow.workflowFirstPostCompressionAudit(failed)
  assert.equal(resumed.passed, false); assert.equal(resumed.groups[0].firstPostRequest, 2)
  assert.equal(resumed.groups[0].firstSuccessfulPostRequest, 3)
  assert.equal(resumed.groups[0].firstInputTokens, null)
  const global = workflow.workflowActualRequestAudit({ events: failed.events, requests: failed.result.requests, expectedRequestBudget: budget })
  assert.equal(global.unknown[0].kind, 'failed-default-zero'); assert.equal(global.failed.length, 1)
})
test('known oversized failed post attempts cannot be skipped for a later small successful sample', () => {
  const input = postFixture(), failed = input.events.find(row => row.seq === 6)
  failed.type = 'assistant/attempt'; failed.data.usage = { inputTokens: 200000, outputTokens: 100, totalTokens: 200100 }
  input.result.requests[1].usage = failed.data.usage
  const checked = workflow.workflowFirstPostCompressionAudit(input)
  assert.equal(checked.passed, false); assert.equal(checked.groups[0].firstPostRequest, 2)
  assert.equal(checked.groups[0].firstInputAndReserves, 210240)
  assert.equal(checked.groups[0].firstSuccessfulPostRequest, 3)
})
test('a small failed admitted request does not hide the first successful oversized response', () => {
  const input = postFixture(), failed = input.events.find(row => row.seq === 6)
  failed.type = 'assistant/attempt'; failed.data.usage = { inputTokens: 10000, outputTokens: 100, totalTokens: 10100 }; input.result.requests[1].usage = failed.data.usage
  const last = input.result.requests[2]; last.usage = { inputTokens: 119761, outputTokens: 100, totalTokens: 119861 }; input.events.find(row => row.seq === 8).data.usage = last.usage
  const selected = structuredClone(last); selected.sequence = 4; selected.nativeBoundary = 9; selected.usage = { inputTokens: 10000, cacheReadTokens: 0, outputTokens: 100, totalTokens: 10100 }
  input.result.requests.push(selected); input.events.push({ seq: 10, type: 'assistant/message', data: { usage: selected.usage } })
  const checked = workflow.workflowFirstPostCompressionAudit(input)
  assert.equal(checked.passed, false); assert.equal(checked.groups[0].firstPostRequest, 2)
  assert.equal(checked.groups[0].firstSuccessfulPostRequest, 3)
  assert.equal(checked.groups[0].firstSuccessfulInputAndReserves, 130001)
})
test('summary-backed first post is anchored after its actual matching native end, and missing end fails closed', () => {
  const input = postFixture(), group = input.result.compressionGroups[0]
  group.pruneSeqs = []; group.summarySeqs = [4]
  input.result.requests[1].nativeBoundary += 2; input.result.requests[2].nativeBoundary += 2
  input.events = input.events.filter(row => row.type === 'assistant/message').map(row => ({ ...row, seq: row.seq === 2 ? 2 : row.seq + 2 }))
  input.events.push({ seq: 3, type: 'compaction/start', data: { compactionId: 'arc' } }, { seq: 4, type: 'compaction/summary', data: { compactionId: 'arc' } }, { seq: 5, type: 'user/message', data: {} }, { seq: 6, type: 'compaction/end', data: { compactionId: 'arc' } }); input.events.sort((a,b)=>a.seq-b.seq)
  const checked = workflow.workflowFirstPostCompressionAudit(input)
  assert.equal(checked.passed, false); assert.equal(checked.groups[0].nativeGroupEnd, 6); assert.equal(checked.groups[0].firstPostRequest, 2)
  input.events = input.events.filter(row => row.seq !== 6)
  assert.equal(workflow.workflowFirstPostCompressionAudit(input).groups[0].nativeGroupEnd, null)
})
