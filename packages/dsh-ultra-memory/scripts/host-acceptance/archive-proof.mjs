/** Sealed native archive acceptance proof. Never starts a provider or mutates a profile. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const sha = value => createHash('sha256').update(value).digest('hex')
const body = event => event.type === 'user/message' ? event.data : event.data?.message
const text = event => (body(event)?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const knowledge = name => /(?:^|[_:/.-])knowledge(?:[_:/.-]|$)/iu.test(name)
function project(event) {
  if (event.type === 'tool/call') return { seq: event.seq, time: event.time, type: event.type, data: { callId: event.data.callId, name: event.data.name, arguments: event.data.arguments } }
  assert.ok(['user/message', 'assistant/message', 'tool/result', 'developer/message', 'system/message'].includes(event.type))
  const original = body(event), source = { kind: original.source.kind }, content = []
  for (const key of ['provider', 'model', 'callId', 'compactionId', 'form', 'summary']) if (typeof original.source[key] === 'string') source[key] = original.source[key]
  for (const block of original.content) {
    if (event.type === 'assistant/message' && ['reasoning', 'thinking'].includes(block.type)) continue
    if (block.type === 'text') { assert.equal(typeof block.text, 'string'); content.push({ type: 'text', text: block.text }) }
    else if (event.type === 'assistant/message' && block.type === 'tool-call') content.push({ type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments })
    else throw new Error('Protected rich content cannot be archived')
  }
  const message = { id: original.id, role: original.role, source, content }
  if (event.type === 'tool/result') {
    assert.equal(original.source.kind, 'tool'); assert.equal(original.source.callId, original.toolCallId)
    message.toolCallId = original.toolCallId; if (original.isError === true) message.isError = true
  }
  return { seq: event.seq, time: event.time, type: event.type, data: event.type === 'user/message' ? message : { message } }
}
/** Pure native evidence check. The caller supplies the sealed-envelope verifier and official surface fold. */
export function verifyNativeArchiveReplacement({ events, summarySeq, envelope, projectId, sessionId, verifyEnvelope, foldSurface, deriveEventMessage, estimateMessage, priorEnvelopes = new Map() }) {
  try {
    assert.equal(typeof verifyEnvelope, 'function'); assert.equal(typeof foldSurface, 'function'); assert.equal(typeof deriveEventMessage, 'function'); assert.equal(typeof estimateMessage, 'function')
    const summary = events.find(event => event.seq === summarySeq), replacement = events.find(event => event.seq === summarySeq + 1)
    assert.equal(summary?.type, 'compaction/summary'); assert.equal(replacement?.type, 'user/message')
    const source = replacement.data.source, arcId = source?.compactionId
    assert.deepEqual(Object.keys(summary.data).sort(), ['compactionId','summary','shadowedRange','shadowedSeqs','shadowedTokenCount','provider','model'].sort())
    assert.equal(summary.data.provider, 'dsh-ultra-local'); assert.equal(summary.data.model, 'completed-turn-archive-v1')
    assert.equal(summary.data.compactionId, arcId); assert.deepEqual(summary.data.summary, replacement.data.content)
    assert.equal(source?.kind, 'compact-checkpoint'); assert.match(arcId, /^arc_[a-f0-9]{64}$/u)
    const sealed = verifyEnvelope(JSON.stringify(envelope), arcId), manifest = sealed.manifest
    assert.equal(manifest.projectId, projectId); assert.equal(manifest.sessionId, sessionId)
    assert.equal(sha(text(replacement)), manifest.capsuleTextSha256)
    assert.deepEqual(manifest.sourceSeqs, summary.data.shadowedSeqs)
    assert.equal(replacement.surfaceOp?.op, 'replace')
    assert.equal(replacement.surfaceOp.startSeq, summary.data.shadowedRange.start); assert.equal(replacement.surfaceOp.endSeq, summary.data.shadowedRange.end)
    assert.ok(manifest.sourceSeqs.every(seq => replacement.sourceEventSeqs?.includes(seq)))
    const start = events.findLast(event => event.seq < summarySeq && event.type === 'compaction/start')
    const end = events.find(event => event.seq > replacement.seq && event.type === 'compaction/end')
    assert.equal(start?.data.compactionId, arcId); assert.equal(end?.data.compactionId, arcId)
    assert.equal(start.seq + 1, summarySeq); assert.equal(replacement.seq + 1, end.seq)
    assert.equal(start.data.turn, end.data.turn); assert.equal(end.data.error, undefined)
    assert.deepEqual(replacement.sourceEventSeqs, [start.seq, summarySeq, ...manifest.sourceSeqs])
    const visible = foldSurface(events.filter(event => event.seq < summarySeq)).nodes
    const startIndex = visible.indexOf(replacement.surfaceOp.startSeq), endIndex = visible.indexOf(replacement.surfaceOp.endSeq)
    assert.ok(startIndex >= 0 && endIndex >= startIndex)
    assert.deepEqual(visible.slice(startIndex, endIndex + 1), manifest.sourceSeqs)
    const shadowPrice = manifest.sourceSeqs.reduce((sum, seq) => sum + estimateMessage(deriveEventMessage(events.find(event => event.seq === seq))), 0)
    assert.ok(Number.isSafeInteger(shadowPrice) && shadowPrice >= 0); assert.equal(summary.data.shadowedTokenCount, shadowPrice)
    assert.ok(estimateMessage(replacement.data) < shadowPrice, 'Deterministic archive must reduce the official estimated public surface')
    foldSurface(events.filter(event => event.seq <= replacement.seq))
    const expectedFlat = new Set(), expectedPrior = new Set()
    const originalSeq = (event, visited = new Set()) => {
      assert.ok(event && !visited.has(event.seq)); visited.add(event.seq)
      if (event.type !== 'tool/result' || event.surfaceOp?.op !== 'replace') return event.seq
      const refs = event.originalSourceEventSeqs ?? event.sourceEventSeqs
      const originals = [...new Set(refs)].map(seq => events.find(node => node.seq === seq)).filter(node => node?.type === 'tool/result' && body(node)?.toolCallId === body(event)?.toolCallId)
      assert.ok(originals.length > 0)
      const found = [...new Set(originals.map(node => originalSeq(node, new Set(visited))))]; assert.equal(found.length, 1); return found[0]
    }
    for (const seq of manifest.sourceSeqs) {
      const event = events.find(node => node.seq === seq)
      if (event?.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint') {
        const id = event.data.source.compactionId, previous = verifyEnvelope(JSON.stringify(priorEnvelopes.get(id)), id).manifest
        assert.equal(previous.projectId, projectId); assert.equal(previous.sessionId, sessionId)
        assert.equal(sha(text(event)), previous.capsuleTextSha256); assert.ok(previous.sourceSeqs.every(node => event.sourceEventSeqs?.includes(node)))
        expectedPrior.add(id); previous.flatSeqs.forEach(node => expectedFlat.add(node))
      } else expectedFlat.add(originalSeq(event))
    }
    assert.deepEqual([...expectedFlat].sort((a, b) => a - b), manifest.flatSeqs)
    assert.deepEqual([...expectedPrior].sort(), manifest.priorArchiveIds)
    const calls = new Map(), results = new Set(); let protectedOffset = 0
    for (const entry of manifest.events) {
      const raw = events.find(event => event.seq === entry.seq), projected = project(raw), encoded = JSON.stringify(projected)
      assert.equal(entry.type, raw.type); assert.equal(sha(encoded), entry.sha256); assert.equal(encoded.length, entry.length)
      assert.equal(JSON.stringify({ sourceIds: entry.sourceIds, ...projected }).length, entry.transcriptLength)
      assert.ok(!['system/message', 'developer/message'].includes(raw.type), 'Host instructions stay outside completed-turn archives')
      const message = body(raw), notice = raw.type === 'user/message' && message.source?.kind === 'ultra-mode' && message.source.form === 'notice' && message.source.summary === '项目证据恢复入口'
      assert.equal(entry.capsuleText, raw.type !== 'tool/result' && raw.type !== 'tool/call' && !notice)
      const publicCalls = raw.type === 'tool/call' ? [raw.data] : (message?.content ?? []).filter(block => block.type === 'tool-call').map(block => ({ ...block, callId: block.id }))
      assert.deepEqual(entry.toolCalls, publicCalls.map(call => ({ id: call.callId, name: call.name, argumentsSha256: sha(call.arguments) })))
      for (const call of publicCalls) {
        assert.ok(!knowledge(call.name)); const old = calls.get(call.callId)
        assert.ok(!old || old.name === call.name && old.arguments === call.arguments)
        if (!old || raw.type === 'assistant/message') calls.set(call.callId, { ...call, seq: raw.seq })
      }
      if (raw.type === 'tool/result') {
        assert.equal(entry.resultCallId, message.toolCallId)
        const prior = calls.get(message.toolCallId); assert.ok(prior && prior.seq < raw.seq)
        const nativeCalls = events.filter(event => event.type === 'tool/call' && event.data.callId === message.toolCallId && event.seq > prior.seq && event.seq < raw.seq)
        assert.equal(nativeCalls.length, 1); assert.equal(nativeCalls[0].data.name, prior.name); assert.equal(nativeCalls[0].data.arguments, prior.arguments)
        results.add(message.toolCallId); calls.delete(message.toolCallId)
      }
      const value = entry.capsuleText ? text(raw) : ''
      if (value) { const at = text(replacement).indexOf(value, protectedOffset); assert.ok(at >= protectedOffset); protectedOffset = at + value.length }
    }
    assert.equal(calls.size, 0)
    return { verified: true, arcId, manifestSha256: sealed.sha256, sourceSeqs: [...manifest.sourceSeqs], flatSeqs: [...manifest.flatSeqs], replacedCallIds: [...results], kind: 'native-template-summary', summarySeq, replacementSeq: replacement.seq, endSeq: end.seq }
  } catch { return { verified: false } }
}
/** Explicit local metadata only. No provider, credential, profile or model action. */
export async function loadWorkflowArchiveProofs({ events, projectDir, ultraRoot, runtimeRoot, projectId, sessionId }) {
  events = events.filter(event => Number.isSafeInteger(event.seq))
  const checkpoints = events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint' && /^arc_[a-f0-9]{64}$/u.test(event.data.source.compactionId ?? ''))
  const proofs = new Map()
  if (!checkpoints.length) return proofs
  assert.ok(typeof projectId === 'string' && projectId && typeof sessionId === 'string' && sessionId)
  const { verifyArchiveEnvelope } = await import(pathToFileURL(path.join(ultraRoot, 'lib/context-archive-store.js')).href)
  const requireRuntime = createRequire(path.join(runtimeRoot, 'package.json'))
  const { foldSurface, deriveEventMessage } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-session')).href)
  const { TokenMeter } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-token-meter')).href)
  const estimateMessage = message => TokenMeter.prototype.estimateMessage(message)
  let directory = path.resolve(projectDir)
  assert.ok(!(await fs.lstat(directory)).isSymbolicLink())
  for (const part of ['.dsh-ultra', 'v1', 'archives']) { directory = path.join(directory, part); assert.ok(!(await fs.lstat(directory)).isSymbolicLink()) }
  const envelopes = new Map()
  const load = async id => {
    assert.match(id, /^arc_[a-f0-9]{64}$/u)
    if (envelopes.has(id)) return
    const file = path.join(directory, id + '.json'), stat = await fs.lstat(file)
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 32 * 1024 * 1024)
    const envelope = verifyArchiveEnvelope(await fs.readFile(file, 'utf8'), id)
    assert.equal(envelope.manifest.projectId, projectId); assert.equal(envelope.manifest.sessionId, sessionId)
    envelopes.set(id, envelope)
    for (const previous of envelope.manifest.priorArchiveIds) await load(previous)
  }
  for (const checkpoint of checkpoints) await load(checkpoint.data.source.compactionId)
  for (const checkpoint of checkpoints) {
    const proof = verifyNativeArchiveReplacement({ events, summarySeq: checkpoint.seq - 1, envelope: envelopes.get(checkpoint.data.source.compactionId), projectId, sessionId, verifyEnvelope: verifyArchiveEnvelope, foldSurface, deriveEventMessage, estimateMessage, priorEnvelopes: envelopes })
    assert.equal(proof.verified, true, 'Native archive does not match its sealed scoped source proof')
    proofs.set(checkpoint.seq, proof)
  }
  return proofs
}
export function assessWorkflowCycle130k(input, baseEvaluator) {
  assert.equal(typeof baseEvaluator, 'function')
  const original = baseEvaluator(input), postCompressionCapTokens = 130000
  if (!original.qualified) return { ...original, postCompressionCapTokens }
  const post = input.requests.find(row => row.sequence === original.postRequest)
  const reservesValid = Number.isSafeInteger(post?.outputReserveTokens) && post.outputReserveTokens >= 8192
    && Number.isSafeInteger(post?.toolReserveTokens) && post.toolReserveTokens >= 2048
    && (!Number.isSafeInteger(post.maxTokens) || post.outputReserveTokens >= post.maxTokens)
  const actualInput = Number.isFinite(post?.usage?.totalTokens) && Number.isFinite(post?.usage?.outputTokens) ? post.usage.totalTokens - post.usage.outputTokens : null
  const postInputAndReserves = reservesValid && actualInput !== null ? actualInput + post.outputReserveTokens + post.toolReserveTokens : null
  if (postInputAndReserves === null || postInputAndReserves > postCompressionCapTokens || !(post.usage.totalTokens > 0) || post.finish?.kind === 'error')
    return { ...original, qualified: false, independentCompressions: 0, postCompressionCapTokens, postInputAndReserves,
      reason: 'C requires a positive native post request with actual input plus output/tool reserves <=130000; the original B criterion is unchanged.' }
  return { ...original, postCompressionCapTokens, postInputAndReserves }
}
