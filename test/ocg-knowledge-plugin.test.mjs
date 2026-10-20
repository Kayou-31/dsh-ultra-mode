import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeOcgKnowledge } from '../scripts/host-acceptance/ocg-knowledge-plugin.mjs'
function observation() {
  const sourceId = 'src_test', quote = 'Synthetic shared value is jade-123.', sha256 = 'a'.repeat(64)
  const a = { id: 'A-root', events: [] }, b = { id: 'B-root', events: [] }
  const append = (root, name, args, value) => { const seq = root.events.length + 1, callId = root.id + seq; root.events.push({ type: 'tool/call', seq, data: { name, callId, arguments: args } }, { type: 'tool/result', seq: seq + 1, data: { message: { role: 'tool', isError: false, toolCallId: callId, source: { kind: 'tool', callId }, content: [{ type: 'text', text: JSON.stringify(value) }] } } }) }
  append(a, 'fixture_read', { id: 'fixture' }, { nonce: 'nonce' })
  append(a, 'ultra_memory_search', { query: 'Synthetic' }, { items: [{ sourceId }] })
  append(a, 'ultra_memory_get', { id: sourceId, quote }, { citation: { sourceId, quote, sha256 } })
  append(a, 'ultra_knowledge_publish', { sources: [{ sourceId, quote }] }, { id: 'knowledge-1', hostVerified: false, assessment: 'model', verification: 'source-match' })
  append(b, 'ultra_knowledge_search', { query: 'shared' }, { items: [{ id: 'knowledge-1' }] })
  append(b, 'ultra_knowledge_get', { id: 'knowledge-1' }, { hostVerified: false, assessment: 'model', verification: 'source-match', offset: 0, text: JSON.stringify({ hostVerified: false, verification: 'source-match', sources: [{ sourceId, quote, sha256, sessionId: a.id, verification: 'source-match' }] }) })
  b.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify({ quote, sourceId, verification: 'source-match', hostVerified: false }) }] } } })
  return { A: a, B: b, expected: { quote, sha256, unsharedTail: 'PRIVATE-TAIL' }, requests: [{ sessionId: a.id }, { sessionId: b.id, verifiedSharedSource: true }], deniedC: true }
}
test('real knowledge judge requires actual A publication and independent B readback with exact source identity', () => {
  assert.equal(judgeOcgKnowledge(observation()).passed, true)
  for (const mutate of [
    value => { value.B.events[3].data.message.source.callId = 'forged' },
    value => { value.requests[1].verifiedSharedSource = false },
    value => { value.A.events[5].data.message.isError = true },
    value => { value.expected.sha256 = 'b'.repeat(64) },
    value => { value.deniedC = false },
    value => { value.B.events.at(-1).data.message.content[0].text = '{}' },
  ]) { const value = observation(); mutate(value); assert.equal(judgeOcgKnowledge(value).passed, false) }
})
