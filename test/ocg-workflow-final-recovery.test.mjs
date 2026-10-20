import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { recoveryLimits, assertReadOnlyFinalRecovery, recoveryFinalPrompt, assertRecoveryOnlyTool, businessSnapshot, assertReadOnlyFinalNative } from '../scripts/host-acceptance/recovery-policy.mjs'
import { parseWorkflowAnswer, normalizeWorkflowConfig } from '../scripts/host-acceptance/ocg-workflow-plugin.mjs'
function fixture() {
  const answer = '```json\n{"phase":3}\n```\nExtra explanation', commit = { committed: true, receiptId: 'receipt-3', treeSha256: 'a'.repeat(64), testId: 'test-3' }
  const phase = { phase: 3, status: 'committed-awaiting-verification', verification: { boundary: 10, endSeq: 21 }, commit, publicAnswer: answer, reportSource: { callId: 'report-call', sourceSha256: 'b'.repeat(64) }, preCommitRetrieval: { resultSeq: 16, callId: 'get-call', sourceId: 'src_' + 'c'.repeat(64), sourceSha256: 'b'.repeat(64) } }
  const events = [
    { seq: 15, type: 'tool/call', data: { callId: 'get-call', name: 'ultra_memory_get', arguments: '{}' } },
    { seq: 16, type: 'tool/result', surfaceOp: 'append', data: { message: { role: 'tool', toolCallId: 'get-call', isError: false, source: { kind: 'tool', callId: 'get-call' }, content: [{ type: 'text', text: JSON.stringify({ citation: { sourceId: phase.preCommitRetrieval.sourceId, sha256: phase.reportSource.sourceSha256, quote: 'whole raw row' } }) }] } } },
    { seq: 17, type: 'tool/call', data: { callId: 'commit-call', name: 'workflow_commit', arguments: '{"phase":3}' } },
    { seq: 18, type: 'tool/result', surfaceOp: 'append', data: { message: { role: 'tool', toolCallId: 'commit-call', isError: false, source: { kind: 'tool', callId: 'commit-call' }, content: [{ type: 'text', text: JSON.stringify(commit) }] } } },
    { seq: 20, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: answer }] } } },
    { seq: 21, type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ]
  return { phase, durable: { commit, lastTest: { passed: true, treeSha256: commit.treeSha256 } }, events, priorStatus: 'failed', failureCode: 'WORKFLOW_INVALID_JSON', parseAnswer: parseWorkflowAnswer }
}
test('explicit recovery deducts previous admitted calls and wrapper elapsed time from one finite budget', () => {
  assert.deepEqual(recoveryLimits({ priorRequests: 44, priorElapsedMs: 268422 }), { maxNewRequests: 856, timeoutMs: 10531578, combinedRequestCap: 900, combinedTimeoutMs: 10800000 })
  for (const patch of [{ priorRequests: 900 }, { priorElapsedMs: 10800000 }, { priorRequests: -1 }, { priorElapsedMs: NaN }]) assert.throws(() => recoveryLimits({ priorRequests: 44, priorElapsedMs: 268422, ...patch }))
})
test('format recovery never accepts the rejected answer, cannot run without explicit committed resume', () => {
  const input = fixture(), plan = assertReadOnlyFinalRecovery(input)
  assert.equal(plan.originalBoundary, 10); assert.equal(plan.failedEndSeq, 21); assert.equal(plan.reason, 'WORKFLOW_INVALID_JSON'); assert.equal(plan.readOnly, true)
  assert.throws(() => parseWorkflowAnswer(input.phase.publicAnswer), { code: 'WORKFLOW_INVALID_JSON' })
  assert.match(recoveryFinalPrompt(), /native turn completed/); assert.match(recoveryFinalPrompt(), /bare JSON object/); assert.doesNotMatch(recoveryFinalPrompt(), /transport connection failure/)
  const cfg = { runtimeRoot: path.resolve('/runtime'), ultraRoot: path.resolve('/ultra'), projectDir: path.resolve('/project'), stateFile: path.resolve('/state.json'), resultFile: path.resolve('/result.json'), provider: 'opencode-go', model: 'deepseek-v4.1-flash', maxRequests: 100, timeoutMs: 60000, reportRows: 8, recoverReadOnlyFinal: true }
  assert.throws(() => normalizeWorkflowConfig(cfg)); assert.throws(() => normalizeWorkflowConfig({ ...cfg, resume: true, recoverCommittedVerification: true, recoveryFailureCode: 'TRANSPORT' }))
  assert.equal(normalizeWorkflowConfig({ ...cfg, resume: true, recoverCommittedVerification: true, recoveryFailureCode: 'WORKFLOW_INVALID_JSON' }).recoverReadOnlyFinal, true)
})
test('format eligibility refuses changed commit, valid old answer, missing source get, unordered provenance and incomplete native tools', () => {
  for (const mutate of [r => { r.priorStatus = 'running' }, r => { r.failureCode = 'UNKNOWN' }, r => { r.phase.status = 'verification-started' }, r => { r.durable.commit = { ...r.durable.commit, treeSha256: 'x' } }, r => { r.phase.publicAnswer = '{}' }, r => { r.events[4].data.message.content[0].text = '{}' }, r => { r.events[5].data.reason.kind = 'error' }, r => { r.events.splice(1, 1) }, r => { r.phase.preCommitRetrieval.resultSeq = 18 }, r => { r.events.push({ seq: 22, type: 'tool/call', data: { callId: 'unfinished' } }) }]) { const row = fixture(); mutate(row); assert.throws(() => assertReadOnlyFinalRecovery(row)) }
})
test('read-only guard blocks mutation tools; native proof rejects even attempted mutation or task replay', () => {
  for (const name of ['workflow_patch', 'workflow_test', 'workflow_commit', 'exec', 'subagent']) assert.throws(() => assertRecoveryOnlyTool(name), /read-only/)
  for (const name of ['workflow_read', 'ultra_memory_search', 'ultra_memory_get']) assert.doesNotThrow(() => assertRecoveryOnlyTool(name))
  const prompt = recoveryFinalPrompt(), user = { seq: 4, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] } }, end = { seq: 6, type: 'turn/end', data: { reason: { kind: 'completed' } } }
  assert.equal(assertReadOnlyFinalNative({ events: [user, end], boundary: 3, prompt }).userAdmissions, 1)
  for (const added of [[{ ...user, seq: 5 }], [{ seq: 5, type: 'tool/call', data: { name: 'workflow_commit' } }]]) assert.throws(() => assertReadOnlyFinalNative({ events: [user, ...added, end], boundary: 3, prompt }))
})
test('business snapshots protect durable operations while allowing evidence-index maintenance', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ocg-recovery-files-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, '.dsh-ultra')); await fs.writeFile(path.join(root, 'status.json'), '{"commits":3}')
  const before = await businessSnapshot(root); await fs.writeFile(path.join(root, '.dsh-ultra/index'), 'new evidence'); assert.deepEqual(await businessSnapshot(root), before)
  await fs.writeFile(path.join(root, 'status.json'), '{"commits":4}'); assert.notDeepEqual(await businessSnapshot(root), before)
})
