import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'
import * as recovery from './read-completed-recovery.mjs'
const sha = text => createHash('sha256').update(text).digest('hex')
const texts = Object.fromEntries(['payload-alpha', 'payload-beta', ...Array.from({ length: 20 }, (_, index) => 'load-' + index)].map(id => [id, id + ' public synthetic body']))
const manifest = Object.fromEntries(Object.entries(texts).map(([id, text]) => [id, { chars: text.length, bytes: Buffer.byteLength(text), sha256: sha(text) }]))
function fixture() {
  const root = path.resolve('synthetic-read-completed-recovery-unit')
  const events = [], sessionId = 'native-existing', source = { kind: 'user' }; let seq = 0, turn = 0
  const append = (type, data) => events.push({ type, seq: ++seq, data })
  const read = id => { const callId = 'read-' + id; append('tool/call', { turn, callId, name: 'fixture_read', arguments: JSON.stringify({ id }) }); append('tool/result', { turn, message: { role: 'tool', isError: false, toolCallId: callId, source: { kind: 'tool', callId }, content: [{ type: 'text', text: `PUBLIC_FIXTURE id=${id}; totalChars=${manifest[id].chars}; offset=0; returnedChars=${manifest[id].chars}\n` + texts[id] }] } }) }
  for (let round = 0; round < 3; round++) { turn++; append('user/message', { id: 'user-' + turn, source, content: [{ type: 'text', text: 'Initial ' + round }] }); if (round < 2) read(round ? 'payload-beta' : 'payload-alpha'); append('turn/end', { turn, reason: { kind: 'completed' } }) }
  for (let cycle = 0; cycle <= 5; cycle++) {
    turn++; append('user/message', { id: 'user-' + turn, source, content: [{ type: 'text', text: 'Read load-' + cycle + (cycle === 2 ? '\n一次性用户决定更新：old已被替代，当前决定ID=decision-revised-842。' : cycle === 5 ? '\n一次性用户决定更新：older已被替代，当前决定ID=decision-current-953。' : '') }] })
    const boundary = seq - 1; read('load-' + cycle)
    append('turn/end', { turn, reason: cycle === 5 ? { kind: 'error', error: { code: 'TRANSPORT' } } : { kind: 'completed' } })
    if (cycle === 5) return { events, manifest, fixtureId: 'synthetic-drift-diverse', sessionId, projectDir: path.join(root, 'project'), trustedRoute: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, candidateSha256: 'a'.repeat(64),
      launch: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', candidateSha256: 'a'.repeat(64) },
      result: { status: 'failed', mode: 's2', fixtureId: 'synthetic-drift-diverse', provider: 'opencode-go', model: 'deepseek-v4.1-flash', native: { sessionId }, totalExecuteAttempts: 0, sentinelBodyCalls: 0, publicAnswers: [...Array.from({ length: 8 }, () => ({ sessionId, endReason: { kind: 'completed' } })), { sessionId, boundary, endReason: { kind: 'error', error: { code: 'TRANSPORT' } } }] },
      sourceFiles: Object.fromEntries(['launch', 'result', 'manifest', 'native', 'candidate'].map(key => [key, { path: path.join(root, 'frozen', key), sha256: (key === 'candidate' ? 'a' : 'b').repeat(64) }])) }
  }
}

test('already-read failed round has a distinct strict receipt and only untouched later loads remain', () => {
  const value = fixture(), state = recovery.buildReadCompletedRecoveryReceipt(value)
  assert.equal(state.readCompletedPartial, true)
  assert.equal(state.completedRounds, 8)
  assert.equal(state.failedCycle, 5)
  assert.equal(state.nextStressCycle, 6)
  assert.deepEqual(state.remainingLoadIds, Array.from({ length: 14 }, (_, index) => 'load-' + (index + 6)))
  assert.equal(state.failedRead.id, 'load-5')
  assert.equal(state.originalResultOverwritten, false)
  assert.equal(state.reworkCount, 1)
  assert.doesNotThrow(() => recovery.assertResumedReadCompletedBoundary(state, value.events, { manifest, trustedRoute: value.trustedRoute }))
})

test('read-completed recovery rejects altered route, failure, bytes, updates, pending tools and extra operations', () => {
  for (const mutate of [
    value => { value.trustedRoute.provider = 'other' },
    value => { value.candidateSha256 = 'f'.repeat(64) },
    value => { value.result.totalExecuteAttempts = 1 },
    value => { value.result.publicAnswers.at(-1).boundary = 0 },
    value => { value.events.at(-1).data.reason.kind = 'completed' },
    value => { value.events.at(-1).data.reason.error.code = 'UNKNOWN' },
    value => { value.events.at(-2).data.message.content[0].text += 'changed' },
    value => { value.events.at(-2).data.message.role = 'user' },
    value => { value.events.at(-2).data.message.isError = true },
    value => { value.events.at(-2).data.message.source.callId = 'forged' },
    value => { value.events = value.events.filter(event => !(event.type === 'user/message' && event.data.content[0].text.includes('decision-current-953'))) },
    value => { const user = value.events.find(event => event.type === 'user/message' && event.data.content[0].text.includes('decision-current-953')), seq = value.events.at(-1).seq++; value.events.splice(-1, 0, { ...structuredClone(user), seq }) },
    value => { const seq = value.events.at(-1).seq++; value.events.splice(-1, 0, { type: 'tool/call', seq, data: { callId: 'pending', name: 'fixture_read', arguments: '{"id":"load-6"}' } }) },
    value => { value.events.find(event => event.type === 'tool/call').data.name = 'fixture_execute' },
    value => { delete value.sourceFiles.native },
    value => { value.projectDir = 'relative-project' },
    ...['launch', 'result', 'manifest', 'native', 'candidate'].map(key => value => { value.sourceFiles[key].path = 'relative-source' }),
  ]) { const value = fixture(); mutate(value); assert.throws(() => recovery.buildReadCompletedRecoveryReceipt(value)) }
})

test('resume proof cannot substitute a new native log or replay the original latest user update', () => {
  const value = fixture(), state = recovery.buildReadCompletedRecoveryReceipt(value)
  const changed = structuredClone(value.events); changed.find(event => event.type === 'user/message').data.content[0].text += 'changed'
  assert.throws(() => recovery.assertResumedReadCompletedBoundary(state, changed, { manifest, trustedRoute: value.trustedRoute }))
  assert.match(recovery.readCompletedRecoveryPrompt(state), /不再调用fixture_read/)
  assert.ok(!recovery.readCompletedRecoveryPrompt(state).includes('decision-current-953'))
  assert.ok(!recovery.readCompletedRecoveryPrompt(state).includes('一次性用户决定更新'))
})
