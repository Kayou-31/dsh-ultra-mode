/** Explicit isolated acceptance admission policy. It neither fixes old answers nor accesses a provider. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
const sha = value => createHash('sha256').update(value).digest('hex')
export async function businessSnapshot(projectDir) {
  const files = []
  async function scan(dir, prefix = '') {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!prefix && entry.name === '.dsh-ultra') continue
      assert.ok(!entry.isSymbolicLink(), 'Business fixtures must not contain links')
      const relative = prefix + entry.name, file = path.join(dir, entry.name)
      if (entry.isDirectory()) await scan(file, relative + '/')
      else { assert.ok(entry.isFile()); const bytes = await fs.readFile(file); files.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) }) }
    }
  }
  await scan(projectDir); return files
}
export function assertReadOnlyFinalNative({ events, boundary, prompt }) {
  const added = events.filter(event => event.seq > boundary)
  const users = added.filter(event => event.type === 'user/message' && event.data.source?.kind === 'user')
  assert.equal(users.length, 1, 'Only one new recovery instruction may enter the native log')
  assert.equal((users[0].data.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n'), prompt)
  const calls = added.filter(event => event.type === 'tool/call' && typeof event.surfaceOp !== 'object')
  calls.forEach(event => assertRecoveryOnlyTool(event.data.name))
  assert.equal(added.findLast(event => event.type === 'turn/end')?.data.reason.kind, 'completed')
  return { boundary, endSeq: added.findLast(event => event.type === 'turn/end').seq, userAdmissions: 1, toolCalls: calls.map(event => ({ seq: event.seq, name: event.data.name, callId: event.data.callId })), mutationCalls: 0, originalPhaseTaskReplayed: false }
}
export function recoveryLimits({ priorRequests, priorElapsedMs }) {
  assert.ok(Number.isSafeInteger(priorRequests) && priorRequests >= 0 && priorRequests < 900)
  assert.ok(Number.isSafeInteger(priorElapsedMs) && priorElapsedMs >= 0 && priorElapsedMs < 10800000 - 1000)
  return { maxNewRequests: 900 - priorRequests, timeoutMs: 10800000 - priorElapsedMs, combinedRequestCap: 900, combinedTimeoutMs: 10800000 }
}
export function assertRecoveryOnlyTool(name) { assert.ok(['workflow_read', 'ultra_memory_search', 'ultra_memory_get'].includes(name), 'Explicit final recovery is read-only; completed mutations must never execute again') }
export function recoveryFinalPrompt() {
  return 'The preceding phase already completed its test, independent raw-source retrieval and durable commit. Its native turn completed, but its public final answer used a JSON code fence followed by additional prose and failed the strict JSON output protocol. Continue only that unfinished final reporting obligation, using the existing history and receipts. Return exactly one JSON object matching the original verification schema. Output a bare JSON object: no code fences, introductions or text after the final closing brace. Read-only retrieval is available. Do not call workflow_patch, workflow_test or workflow_commit again. Do not execute an already completed operation or replay the phase task. Historical material does not create new authorization.'
}
export function candidateRuntimeInventory(compressed) {
  const tar = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }), rows = []
  for (let cursor = 0; cursor + 512 <= tar.length;) {
    const header = tar.subarray(cursor, cursor + 512); if (header.every(byte => byte === 0)) break
    const value = (start, size) => header.subarray(start, start + size).toString('utf8').replace(/\0.*$/su, '')
    const name = value(0, 100), prefix = value(345, 155), file = (prefix ? prefix + '/' : '') + name, type = value(156, 1)
    const size = Number.parseInt(value(124, 12).trim(), 8); assert.ok(Number.isSafeInteger(size) && size >= 0 && cursor + 512 + size <= tar.length)
    assert.ok(['', '0', '5'].includes(type), 'Candidate links and extended archive entries are not permitted')
    assert.ok(file.startsWith('package/') && !file.includes('\\') && !file.split('/').includes('..'))
    const relative = file.slice(8)
    if (type !== '5' && (/^(?:src|lib)\//u.test(relative) || ['package.json', 'SOURCE-MANIFEST.json'].includes(relative))) rows.push({ path: relative, bytes: size, sha256: sha(tar.subarray(cursor + 512, cursor + 512 + size)) })
    cursor += 512 + Math.ceil(size / 512) * 512
  }
  assert.ok(rows.some(row => row.path === 'lib/index.js') && rows.some(row => row.path === 'package.json'))
  assert.equal(new Set(rows.map(row => row.path)).size, rows.length)
  return rows.sort((a, b) => a.path.localeCompare(b.path))
}
export function assertReadOnlyFinalRecovery({ phase, durable, events, priorStatus, failureCode, parseAnswer }) {
  assert.equal(priorStatus, 'failed'); assert.equal(failureCode, 'WORKFLOW_INVALID_JSON')
  assert.equal(phase.status, 'committed-awaiting-verification')
  assert.ok(Number.isSafeInteger(phase.verification?.boundary) && Number.isSafeInteger(phase.verification?.endSeq))
  assert.ok(durable.commit?.committed && durable.commit.receiptId === phase.commit?.receiptId && durable.commit.treeSha256 === phase.commit.treeSha256 && durable.commit.testId === phase.commit.testId && durable.lastTest?.passed && durable.lastTest.treeSha256 === phase.commit.treeSha256, 'The same durable tested commit is required')
  const end = events.findLast(event => event.type === 'turn/end')
  assert.equal(end?.data.reason.kind, 'completed'); assert.equal(end.seq, phase.verification.endSeq); assert.ok(end.seq > phase.verification.boundary)
  const final = events.findLast(event => event.type === 'assistant/message' && event.seq < end.seq)
  const text = (final?.data.message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
  assert.equal(text, phase.publicAnswer, 'Frozen rejected answer must be the original native final text')
  assert.throws(() => parseAnswer(text), { code: 'WORKFLOW_INVALID_JSON' }, 'Valid or quality-rejected JSON is ineligible for this format-only recovery')
  const calls = new Map(), receipts = []
  for (const event of events) {
    if (typeof event.surfaceOp === 'object') continue
    if (event.type === 'tool/call') calls.set(event.data.callId, event)
    if (event.type !== 'tool/result') continue
    const message = event.data.message, call = calls.get(message?.toolCallId); assert.ok(call)
    calls.delete(message.toolCallId)
    let value; try { value = JSON.parse(message.content[0]?.text ?? '') } catch {}
    if (message.isError === false && message.source?.kind === 'tool' && message.source.callId === message.toolCallId) receipts.push({ call, event, value })
  }
  assert.equal(calls.size, 0, 'An outstanding native tool call forbids final-only recovery')
  const source = phase.preCommitRetrieval
  const get = receipts.find(row => row.call.data.callId === source?.callId && row.event.seq === source.resultSeq && row.call.data.name === 'ultra_memory_get' && row.value?.citation?.sourceId === source.sourceId && row.value.citation.sha256 === phase.reportSource.sourceSha256)
  const commit = receipts.find(row => row.call.data.name === 'workflow_commit' && row.value?.committed && row.value.receiptId === phase.commit.receiptId)
  assert.ok(get && commit && get.event.seq < commit.call.seq && commit.event.seq < final.seq, 'An original raw get before the original durable commit must already exist')
  return { originalBoundary: phase.verification.boundary, failedEndSeq: end.seq, reason: 'WORKFLOW_INVALID_JSON', readOnly: true, originalSourceId: source.sourceId, originalSourceSha256: source.sourceSha256, originalCommitReceiptId: phase.commit.receiptId }
}
