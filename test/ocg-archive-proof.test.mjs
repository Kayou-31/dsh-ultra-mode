import test from 'node:test'
import assert from 'node:assert/strict'
import { assessWorkflowCycle130k, verifyNativeArchiveReplacement } from '../scripts/host-acceptance/archive-proof.mjs'
import { assessWorkflowCycle } from '../scripts/host-acceptance/ocg-workflow-plugin.mjs'
import { createHash } from 'node:crypto'
import { verifyArchiveEnvelope } from '../lib/context-archive-store.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url), sdkRoot = process.env.DSH_ULTRA_TEST_SDK
let unavailable, foldSurface, deriveEventMessage, TokenMeter
try {
  const file = sdkRoot ? path.join(sdkRoot, '@deepseek-ai/dsh-session/package.json') : require.resolve('@deepseek-ai/dsh-session/package.json')
  if (JSON.parse(await fs.readFile(file, 'utf8')).version !== '0.2.1-rc.2') unavailable = 'Native template summary proof requires official 0.2.1-rc.2; skipped, not a compatibility pass.'
  else {
    const load = name => sdkRoot ? import(pathToFileURL(path.join(sdkRoot, '@deepseek-ai', name, 'lib/index.js'))) : import('@deepseek-ai/' + name)
    ;({ foldSurface, deriveEventMessage } = await load('dsh-session')); ({ TokenMeter } = await load('dsh-token-meter'))
  }
} catch { unavailable = 'Official 0.2.1-rc.2 proof modules unavailable; skipped, not a compatibility pass.' }
const estimateMessage = message => TokenMeter.prototype.estimateMessage(message)
const assessC = input => assessWorkflowCycle130k(input, assessWorkflowCycle)
const fixture = postInput => ({ phase: 1,
  requests: [
    { sequence: 1, phase: 1, nativeUsageVerified: true, outputReserveTokens: 8192, toolReserveTokens: 2048, fullReportVisible: true, reportCallId: 'report-1', usage: { inputTokens: 445000, cacheReadTokens: 0, outputTokens: 100, totalTokens: 445100 } },
    { sequence: 2, phase: 1, nativeUsageVerified: true, outputReserveTokens: 8192, toolReserveTokens: 2048, fullReportVisible: false, usage: { inputTokens: postInput, cacheReadTokens: 0, outputTokens: 100, totalTokens: postInput + 100 } },
  ], groups: [{ id: 'group-1', phase: 1, beforeGeneration: 0, afterGeneration: 1, pruneSeqs: [10], nextRequestSequence: 2, replacedCallIds: ['report-1'] }],
  retrieval: { verified: true, afterCompression: true, callId: 'report-1', sourceId: 'source-1', sourceSha256: 'a'.repeat(64) }, commit: { committed: true }, grade: { passed: true },
})
test('C 130K includes actual input plus both reserves, accepting the exact boundary', () => {
  const got = assessC(fixture(119760))
  assert.equal(got.qualified, true)
  assert.equal(got.postInputAndReserves, 130000)
  assert.equal(got.postCompressionCapTokens, 130000)
})
test('C rejects 130001 while the immutable B criterion still passes', () => {
  const input = fixture(119761)
  assert.equal(assessWorkflowCycle(input).qualified, true)
  const before = structuredClone(input), got = assessC(input)
  assert.equal(got.qualified, false)
  assert.equal(got.postInputAndReserves, 130001)
  assert.deepEqual(input, before)
})
test('C does not infer a successful post sample from a missing or default-zero failed usage', () => {
  for (const usage of [null, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }]) {
    const input = fixture(10000)
    input.requests[1].usage = usage
    input.requests[1].nativeUsageVerified = false
    assert.equal(assessC(input).qualified, false)
  }
})
test('C keeps the 420K before condition, exact report linkage and raw readback requirements', () => {
  for (const change of [input => { input.requests[0].usage = { inputTokens: 400000, cacheReadTokens: 0, outputTokens: 100, totalTokens: 400100 } },
    input => { input.groups[0].replacedCallIds = ['unrelated-report'] }, input => { input.retrieval.verified = false }]) {
    const input = fixture(10000); change(input)
    assert.equal(assessC(input).qualified, false)
  }
})
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value)
const sha = value => createHash('sha256').update(value).digest('hex')
function archiveFixture() {
  const user = { id: 'u0', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Do not publish. Preserve this exact requirement.' }] }
  const assistant = { id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'offline', model: 'fixture' }, content: [{ type: 'text', text: 'I will run the allowed test.' }, { type: 'tool-call', id: 'c1', name: 'workflow_test', arguments: '{}' }] }
  const tool = { id: 't3', role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'ORIGINAL_SYNTHETIC_REPORT' }] }
  const answer = { id: 'a4', role: 'assistant', source: { kind: 'model', provider: 'offline', model: 'fixture' }, content: [{ type: 'text', text: 'The allowed test completed.' }] }
  const events = [
    { seq: 0, time: 1, type: 'user/message', data: user, surfaceOp: 'append' },
    { seq: 1, time: 2, type: 'assistant/message', data: { message: assistant }, surfaceOp: 'append' },
    { seq: 2, time: 3, type: 'tool/call', data: { callId: 'c1', name: 'workflow_test', arguments: '{}' } },
    { seq: 3, time: 4, type: 'tool/result', data: { message: tool }, surfaceOp: 'append' },
    { seq: 4, time: 5, type: 'assistant/message', data: { message: answer }, surfaceOp: 'append' },
    { seq: 5, time: 6, type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ]
  const projected = events.filter(event => event.surfaceOp).map(event => {
    const original = event.type === 'user/message' ? event.data : event.data.message
    const value = { id: original.id, role: original.role, source: structuredClone(original.source), content: structuredClone(original.content), ...(event.type === 'tool/result' ? { toolCallId: original.toolCallId } : {}) }
    return { seq: event.seq, time: event.time, type: event.type, data: event.type === 'user/message' ? value : { message: value } }
  })
  const core = { projectId: 'project-1', sessionId: 'session-1', sourceSeqs: [0, 1, 3, 4], flatSeqs: [0, 1, 3, 4], priorArchiveIds: [], stateSha256: sha('state'), events: projected.map(event => ({
    seq: event.seq, type: event.type, sha256: sha(JSON.stringify(event)), length: JSON.stringify(event).length, transcriptLength: JSON.stringify({ sourceIds: [], ...event }).length,
    capsuleText: event.type !== 'tool/result', sourceIds: [], toolCalls: (event.data.message?.content ?? []).filter(block => block.type === 'tool-call').map(block => ({ id: block.id, name: block.name, argumentsSha256: sha(block.arguments) })),
    ...(event.type === 'tool/result' ? { resultCallId: 'c1' } : {}),
  })) }
  const capsule = [user.content[0].text, assistant.content[0].text, answer.content[0].text].join('\n')
  const id = 'arc_' + sha(canonical(core)), manifest = { ...core, id, capsuleTextSha256: sha(capsule) }, envelope = { schema: 1, sha256: sha(canonical(manifest)), manifest }
  events.push({ seq: 6, type: 'compaction/start', data: { compactionId: id } },
    { seq: 7, type: 'compaction/summary', data: { shadowedRange: { start: 0, end: 4 }, shadowedSeqs: [0, 1, 3, 4], shadowedTokenCount: [0, 1, 3, 4].reduce((sum, seq) => sum + estimateMessage(deriveEventMessage(events.find(event => event.seq === seq))), 0), compactionId: id, summary: [{type:'text',text:capsule}], provider: 'dsh-ultra-local', model: 'completed-turn-archive-v1' } },
    { seq: 8, type: 'user/message', data: { id: 'checkpoint', role: 'user', source: { kind: 'compact-checkpoint', compactionId: id }, content: [{ type: 'text', text: capsule }] }, sourceEventSeqs: [6, 7, 0, 1, 3, 4], surfaceOp: { op: 'replace', startSeq: 0, endSeq: 4 } },
    { seq: 9, type: 'compaction/end', data: { compactionId: id } })
  return { projectId: 'project-1', sessionId: 'session-1', events, summarySeq: 7, envelope, verifyEnvelope: verifyArchiveEnvelope, foldSurface, deriveEventMessage, estimateMessage }
}
test('archive proof binds the sealed scope, canonical native template summary and exact protected public text', { skip: unavailable }, () => {
  const proof = verifyNativeArchiveReplacement(archiveFixture())
  assert.equal(proof.verified, true)
  assert.deepEqual(proof.replacedCallIds, ['c1'])
  assert.deepEqual(proof.sourceSeqs, [0, 1, 3, 4])
})
test('archive proof rejects marker spoofing, wrong scope, sealed metadata mismatch and incomplete call/result pairing', { skip: unavailable }, () => {
  for (const change of [f => { f.events[8].data.source.kind = 'user' }, f => { f.projectId = 'foreign' }, f => { f.sessionId = 'foreign' },
    f => { f.envelope.sha256 = 'f'.repeat(64) }, f => { f.events[8].data.content[0].text += 'changed' },
    f => { f.events[8].sourceEventSeqs = [0, 1, 4] }, f => { f.events[2].data.name = 'different_tool' }, f => { f.events[9].data.compactionId = 'arc_' + 'f'.repeat(64) }]) {
    const input = archiveFixture(); change(input)
    assert.equal(verifyNativeArchiveReplacement(input).verified, false)
  }
})
test('archive proof follows official surface positions when a later prefix has startSeq greater than endSeq', { skip: unavailable }, () => {
  const input = archiveFixture(), first = input.envelope, firstId = first.manifest.id
  for (const event of input.events.filter(event => event.seq >= 6)) {
    event.seq += 3
    if (event.sourceEventSeqs) event.sourceEventSeqs = event.sourceEventSeqs.map(seq => seq >= 6 ? seq + 3 : seq)
  }
  const human = { seq: 6, time: 7, type: 'user/message', data: { id: 'u6', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Second exact requirement.' }] }, surfaceOp: 'append' }
  const assistant = { seq: 7, time: 8, type: 'assistant/message', data: { message: { id: 'a7', role: 'assistant', source: { kind: 'model', provider: 'offline', model: 'fixture' }, content: [{ type: 'text', text: 'Second public answer.' }] } }, surfaceOp: 'append' }
  input.events.splice(6, 0, human, assistant, { seq: 8, time: 9, type: 'turn/end', data: { reason: { kind: 'completed' } } })
  const metadata = event => { const raw = { seq: event.seq, time: event.time, type: event.type, data: event.data }; const encoded = JSON.stringify(raw); return { seq: event.seq, type: event.type, sha256: sha(encoded), length: encoded.length, transcriptLength: JSON.stringify({ sourceIds: [], ...raw }).length, capsuleText: true, sourceIds: [], toolCalls: [] } }
  const core = { projectId: input.projectId, sessionId: input.sessionId, sourceSeqs: [11, 6, 7], flatSeqs: [0, 1, 3, 4, 6, 7], events: [...first.manifest.events, metadata(human), metadata(assistant)], priorArchiveIds: [firstId], stateSha256: sha('new state') }
  const capsule = [input.events[11].data.content[0].text, human.data.content[0].text, assistant.data.message.content[0].text].join('\n')
  const id = 'arc_' + sha(canonical(core)), manifest = { ...core, id, capsuleTextSha256: sha(capsule) }
  input.events.push({ seq: 13, type: 'compaction/start', data: { compactionId: id } }, { seq: 14, type: 'compaction/summary', data: { shadowedRange: { start: 11, end: 7 }, shadowedSeqs: [11, 6, 7], shadowedTokenCount: [11,6,7].reduce((sum, seq) => sum + estimateMessage(deriveEventMessage(input.events.find(event => event.seq === seq))), 0), compactionId: id, summary: [{type:'text',text:capsule}], provider:'dsh-ultra-local',model:'completed-turn-archive-v1' } },
    { seq: 15, type: 'user/message', data: { id: 'checkpoint2', role: 'user', source: { kind: 'compact-checkpoint', compactionId: id }, content: [{ type: 'text', text: capsule }] }, sourceEventSeqs: [13, 14, 11, 6, 7], surfaceOp: { op: 'replace', startSeq: 11, endSeq: 7 } },
    { seq: 16, type: 'compaction/end', data: { compactionId: id } })
  input.summarySeq = 14; input.envelope = { schema: 1, sha256: sha(canonical(manifest)), manifest }; input.priorEnvelopes = new Map([[firstId, first]])
  assert.equal(verifyNativeArchiveReplacement(input).verified, true)
})

test('archive proof rejects impersonated providers, fictitious usage and summary/body/source/price/owner mismatch', { skip: unavailable }, () => {
  for (const change of [f => { f.events[7].data.provider = 'opencode-go' }, f => { f.events[7].data.model = 'deepseek-v4.1-flash' },
    ...['usage','rawOutput','llmStreamCall','maxTokens'].map(field => f => {f.events[7].data[field] = field === 'usage' ? {totalTokens:0} : 1}),
    f => {f.events[7].data.summary[0].text += 'tampered'}, f => {f.events[7].data.shadowedTokenCount++},
    f => {f.events[7].data.compactionId = 'arc_'+'f'.repeat(64)}, f => {f.events[8].sourceEventSeqs = [0,1,3,4]},
    f => {f.events[9].data.turn=999}]) { const input=archiveFixture();change(input);assert.equal(verifyNativeArchiveReplacement(input).verified,false) }
})
