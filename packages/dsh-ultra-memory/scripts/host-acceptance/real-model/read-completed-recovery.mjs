/** Dedicated synthetic-read recovery protocol; not a general operation retry. */
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
const sha = value => createHash('sha256').update(value).digest('hex')
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const textOf = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
const messageOf = event => event.data.message ?? event.data
const parse = value => typeof value === 'string' ? JSON.parse(value) : value
const route = value => assert.ok(value?.provider === 'opencode-go' && value.model === 'deepseek-v4.1-flash' && Object.keys(value).length === 2, 'Only the separately trusted OCG Flash route is supported by this recovery')
const sourceKeys = ['launch', 'result', 'manifest', 'native', 'candidate']
function inspect(events, manifest) {
  const calls = new Map(), pending = new Set(), receipts = [], users = [], ends = [], fingerprint = []
  let previous = -1
  for (const event of events) {
    assert.ok(Number.isSafeInteger(event.seq) && event.seq > previous, 'Native event sequences must be strictly ordered'); previous = event.seq
    if (!['tool/call', 'tool/result', 'user/message', 'turn/end'].includes(event.type) || typeof event.surfaceOp === 'object') continue
    if (event.type === 'turn/end') { const row = { seq: event.seq, turn: event.data.turn, kind: event.data.reason.kind, code: event.data.reason.error?.code ?? null }; ends.push(row); fingerprint.push(row); continue }
    if (event.type === 'user/message') { const message = messageOf(event), text = textOf(message), row = { seq: event.seq, id: message.id, sourceKind: message.source?.kind, sha256: sha(text) }; users.push({ ...row, text }); fingerprint.push(row); continue }
    if (event.type === 'tool/call') {
      assert.ok(['fixture_read', 'ultra_memory_search', 'ultra_memory_get'].includes(event.data.name), 'Recovery accepts only the synthetic read-only tool lineage')
      assert.ok(typeof event.data.callId === 'string' && !calls.has(event.data.callId), 'Duplicate native tool call ID')
      const call = { seq: event.seq, turn: event.data.turn, name: event.data.name, callId: event.data.callId, args: parse(event.data.arguments) }
      calls.set(call.callId, call); pending.add(call.callId); fingerprint.push(call); continue
    }
    const message = event.data.message, call = calls.get(message?.toolCallId)
    assert.ok(call && pending.has(message.toolCallId) && message.role === 'tool' && typeof message.isError === 'boolean'
      && message.source?.kind === 'tool' && message.source.callId === message.toolCallId && event.seq > call.seq, 'Unpaired or non-native tool result')
    pending.delete(message.toolCallId)
    const text = textOf(message); fingerprint.push({ seq: event.seq, callId: message.toolCallId, isError: message.isError, sha256: sha(text) })
    if (call.name !== 'fixture_read' || message.isError) continue
    const id = call.args?.id, item = manifest[id], newline = text.indexOf('\n'), body = text.slice(newline + 1)
    assert.ok(item && (call.args.offset ?? 0) === 0 && (call.args.maxChars ?? item.chars) >= item.chars, 'Only complete synthetic reads can be resumed')
    assert.equal(text.slice(0, newline), `PUBLIC_FIXTURE id=${id}; totalChars=${item.chars}; offset=0; returnedChars=${item.chars}`, 'Original full-read wrapper differs')
    assert.equal(body.length, item.chars, 'Original full-read length differs'); assert.equal(sha(body), item.sha256, 'Original full-read SHA differs')
    receipts.push({ name: call.name, id, callId: call.callId, callSeq: call.seq, resultSeq: event.seq, turn: event.data.turn, offset: 0, chars: item.chars, sourceHash: item.sha256 })
  }
  assert.equal(pending.size, 0, 'Pending tools forbid read-completed recovery')
  return { calls: [...calls.values()], receipts, users, ends, fingerprint: sha(JSON.stringify(fingerprint)) }
}
function boundary(events, manifest) {
  const observed = inspect(events, manifest), { ends, users, receipts } = observed
  assert.equal(ends.length, 9, 'Exactly eight completed turns and one terminal failure are required')
  assert.equal(ends.filter(end => end.kind === 'completed').length, 8)
  const failed = ends.at(-1), previous = ends.at(-2)
  assert.equal(failed.kind, 'error'); assert.equal(failed.code, 'TRANSPORT'); assert.equal(failed.turn, 9)
  const failedUsers = users.filter(user => user.sourceKind === 'user' && user.seq > previous.seq && user.seq < failed.seq)
  assert.equal(failedUsers.length, 1, 'One original failed-round instruction is required')
  assert.ok(failedUsers[0].text.includes('load-5') && failedUsers[0].text.includes('当前决定ID=decision-current-953'), 'The already admitted failed load/update differs')
  const updates = users.filter(user => user.sourceKind === 'user' && user.text.includes('一次性用户决定更新'))
  assert.equal(updates.length, 2)
  for (const id of ['decision-revised-842', 'decision-current-953']) assert.equal(updates.filter(user => user.text.includes('当前决定ID=' + id)).length, 1, 'Original decision update must occur once')
  const required = ['payload-alpha', 'payload-beta', ...Array.from({ length: 6 }, (_, index) => 'load-' + index)]
  for (const id of required) assert.equal(receipts.filter(receipt => receipt.id === id).length, 1, 'Exactly one original full receipt is required: ' + id)
  assert.ok(receipts.filter(receipt => receipt.id.startsWith('load-')).every(receipt => required.includes(receipt.id)), 'Extra loads cannot be silently credited')
  const failedCalls = observed.calls.filter(call => call.seq > previous.seq)
  assert.equal(failedCalls.length, 1, 'Only one synthetic read is permitted in the failed round')
  assert.equal(failedCalls[0].name, 'fixture_read'); assert.equal(failedCalls[0].args.id, 'load-5')
  const failedRead = receipts.find(receipt => receipt.id === 'load-5')
  assert.ok(failedRead.resultSeq > previous.seq && failedRead.resultSeq < failed.seq && failedRead.turn === failed.turn)
  return { ...observed, failed, failedRead, previous, failedUser: failedUsers[0], updates }
}
export function buildReadCompletedRecoveryReceipt(input) {
  route(input.trustedRoute)
  const { launch, result, manifest, events, sourceFiles } = input
  assert.ok(hash(input.candidateSha256) && input.candidateSha256 === launch.candidateSha256, 'Frozen candidate SHA differs')
  assert.ok(result.status === 'failed' && result.mode === 's2' && result.fixtureId === input.fixtureId, 'Original failed result identity differs')
  for (const row of [launch, result]) { assert.equal(row.provider, input.trustedRoute.provider); assert.equal(row.model, input.trustedRoute.model) }
  assert.equal(result.native?.sessionId, input.sessionId)
  assert.ok(path.isAbsolute(input.projectDir) && typeof input.sessionId === 'string' && input.sessionId)
  assert.ok(result.totalExecuteAttempts === 0 && result.sentinelBodyCalls === 0 && !(result.executeAttempts?.length), 'Any business operation attempt forbids this recovery')
  for (const key of sourceKeys) assert.ok(sourceFiles?.[key] && path.isAbsolute(sourceFiles[key].path) && hash(sourceFiles[key].sha256), 'Missing frozen source file: ' + key)
  assert.equal(sourceFiles.candidate.sha256, input.candidateSha256, 'Candidate source file differs')
  const observed = boundary(events, manifest), failedAnswer = result.publicAnswers?.at(-1)
  assert.ok(result.publicAnswers.length === 9 && result.publicAnswers.slice(0, 8).every(answer => answer.sessionId === input.sessionId && answer.endReason?.kind === 'completed'))
  assert.ok(failedAnswer?.sessionId === input.sessionId && failedAnswer.endReason?.kind === 'error' && failedAnswer.endReason.error?.code === observed.failed.code
    && failedAnswer.boundary >= observed.previous.seq && failedAnswer.boundary < observed.failedUser.seq, 'Original failed-turn boundary differs')
  return structuredClone({ format: 'read-completed-recovery-v1', readCompletedPartial: true, partial: false, fixtureId: input.fixtureId, sessionId: input.sessionId,
    projectDir: input.projectDir, provider: input.trustedRoute.provider, model: input.trustedRoute.model, presetId: input.presetId ?? 'test',
    candidateSha256: input.candidateSha256, trustedRoute: input.trustedRoute, sourceFiles, manifest, nativeEvidenceSha256: observed.fingerprint,
    originalLastSeq: events.at(-1).seq, completedRounds: 8, failedCycle: 5, nextStressCycle: 6, remainingLoadIds: Array.from({ length: 14 }, (_, index) => 'load-' + (index + 6)),
    failedRead: observed.failedRead, priorReadReceipts: observed.receipts, priorFailure: { seq: observed.failed.seq, turn: observed.failed.turn, code: observed.failed.code, boundary: failedAnswer.boundary },
    originalUserUpdateProofs: observed.updates.map(user => ({ seq: user.seq, id: user.id, sha256: user.sha256 })), executeAttempts: 0, reworkCount: 1,
    originalResultOverwritten: false, earlierRoundsRepeated: false, decisionUpdatesRepeated: false, recoveryNativeTurnIsNew: true })
}
export function assertResumedReadCompletedBoundary(receipt, events, { manifest, trustedRoute }) {
  route(trustedRoute); assert.equal(receipt.format, 'read-completed-recovery-v1'); assert.deepEqual(receipt.trustedRoute, trustedRoute); assert.deepEqual(receipt.manifest, manifest)
  const prefix = events.filter(event => event.seq <= receipt.originalLastSeq), observed = boundary(prefix, manifest)
  assert.equal(observed.fingerprint, receipt.nativeEvidenceSha256, 'The resumed native evidence differs from the frozen original')
  assert.deepEqual(observed.failedRead, receipt.failedRead); assert.equal(observed.failed.seq, receipt.priorFailure.seq)
  assert.equal(receipt.completedRounds, 8); assert.equal(receipt.failedCycle, 5); assert.equal(receipt.nextStressCycle, 6)
  assert.ok(events.filter(event => event.seq > receipt.originalLastSeq).every(event => !['user/message', 'tool/call', 'tool/result', 'turn/end'].includes(event.type)), 'Resume must not automatically replay native work')
  return observed
}
export async function verifyReadCompletedRecoveryFiles(receipt) {
  for (const key of sourceKeys) { const file = receipt.sourceFiles?.[key]; assert.ok(file && path.isAbsolute(file.path) && hash(file.sha256)); assert.equal(sha(await fs.readFile(file.path)), file.sha256, 'Frozen recovery source changed: ' + key) }
  assert.equal(receipt.sourceFiles.candidate.sha256, receipt.candidateSha256)
}
export function readCompletedRecoveryPrompt(receipt) {
  assert.equal(receipt.format, 'read-completed-recovery-v1')
  return '这是同一原生会话中对上一失败逻辑轮的一次显式续接；原错误记录必须保留。上一轮唯一的合成只读资料已完整成功读回，只有最后进度答复因传输错误缺失。根据已有回执只补少于100字的读取状态与缺口，不再调用fixture_read，不重复已经存在的用户决定更新，不重做任何操作，不给最终答案，不复述早期目标字段值。此追加原生轮次计作恢复返工，不代表上一错误轮次成功。'
}
