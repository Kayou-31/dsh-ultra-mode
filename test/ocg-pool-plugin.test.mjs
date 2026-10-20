import test from 'node:test'
import assert from 'node:assert/strict'
import { createOcgPool, observeOcgPoolRequest, recordOcgPoolChunk, collectOcgPoolPhase, ocgFailedTurnMetadata } from '../scripts/host-acceptance/ocg-pool-plugin.mjs'

const routes = [
  { id: 'compute', kind: 'code', provider: 'opencode-go', model: 'flash', reasoningEffort: 'low', maxTokens: 2048 },
  { id: 'inspect', kind: 'review', provider: 'opencode-go', model: 'other', reasoningEffort: 'high', maxTokens: 4096 },
]
test('native pool assembly preserves qualified identity, settings and explicit selection without grading fields', () => {
  const pool = createOcgPool(routes, { maxConcurrent: 4, maxRequests: 80 }, 'inspect')
  assert.equal(pool.explicitModelId, 'inspect')
  assert.deepEqual(pool.models.map(row => [row.id, row.provider, row.model, row.reasoningEffort, row.maxTokens]), [
    ['compute', 'opencode-go', 'flash', 'low', 2048], ['inspect', 'opencode-go', 'other', 'high', 4096],
  ])
  assert.equal(pool.models[0].strengths, 'Code computation, precise integer arithmetic and implementation tasks')
  assert.equal(pool.models[1].strengths, 'Code review, boundary conditions, defect diagnosis and independent checking')
  assert.equal(pool.models[0].allowCrossProvider, false)
  assert.equal(pool.models[0].allowUnverifiedTools, true)
  assert.equal(pool.models[0].kind, undefined)
  assert.equal(pool.maxConcurrent, 4)
  assert.equal(pool.fallback, 'error')
  pool.models[0].maxTokens = 100
  assert.equal(routes[0].maxTokens, 2048)
})

test('request observer exposes actual call route and correlated tool result while withholding private text and reasoning', () => {
  const row = observeOcgPoolRequest({ sessionId: 'child', provider: 'opencode-go', model: 'flash', reasoningEffort: 'low', maxTokens: 2048,
    system: 'PRIVATE_SYSTEM', tools: [{ name: 'fixture_read' }], messages: [
      { role: 'user', content: [{ type: 'text', text: 'PRIVATE_USER' }] },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'PRIVATE_REASONING' }, { type: 'tool-call', id: 'read-1', name: 'fixture_read' }] },
      { role: 'tool', toolCallId: 'forged', content: [{ type: 'text', text: '{"nonce":"unpaired"}' }] },
      { role: 'tool', toolCallId: 'read-1', content: [{ type: 'text', text: '{"nonce":"real-nonce"}' }] },
    ] }, 2)
  assert.equal(row.provider, 'opencode-go')
  assert.equal(row.maxTokens, 2048)
  assert.deepEqual(row.toolResultNonces, ['real-nonce'])
  assert.deepEqual(row.tools, ['fixture_read'])
  assert.equal(row.sequence, 2)
  assert.ok(!JSON.stringify(row).includes('PRIVATE'))
})

test('stream observation exports only numeric reported usage and the public finish kind', () => {
  const row = {}
  recordOcgPoolChunk(row, { type: 'usage', usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16, reasoningTokens: 2, cacheReadTokens: 0, privateRaw: 'PRIVATE', cost: 2, invalid: NaN } })
  recordOcgPoolChunk(row, { type: 'finish', reason: { kind: 'error', raw: 'PRIVATE', message: 'PRIVATE' } })
  assert.deepEqual(row, { usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16, cacheReadTokens: 0, reasoningTokens: 2 }, finish: { kind: 'error' } })
  recordOcgPoolChunk(row, { type: 'reasoning-delta', text: 'PRIVATE' })
  assert.ok(!JSON.stringify(row).includes('PRIVATE'))
})

function evidence() {
  const challenge = { id: 'read-x', nonce: 'nonce-x', answer: 20 }, answer = JSON.stringify({ fixtureId: 'read-x', nonce: 'nonce-x', answer: 20 })
  const child = 'ultra-child-x', route = routes[0]
  const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] })
  const rootEvents = [
    { type: 'tool/call', seq: 1, data: { callId: 's', name: 'ultra_spawn_agent', arguments: { model_config_id: 'compute', model_reason: 'The task requires computation.' } } },
    { type: 'tool/result', seq: 2, data: { message: { role: 'tool', isError: false, toolCallId: 's', source: { kind: 'tool', callId: 's' }, ...text({ id: child }) } } },
    { type: 'tool/call', seq: 3, data: { callId: 'w', name: 'ultra_wait_agent', arguments: { targets: [child] } } },
    { type: 'tool/result', seq: 4, data: { message: { role: 'tool', isError: false, toolCallId: 'w', source: { kind: 'tool', callId: 'w' }, ...text({ agents: [{ id: child, status: 'completed', model: { requestedConfigId: 'compute', actual: { provider: 'opencode-go', model: 'flash' }, compatibility: { tools: 'observed-native-tool-result' } } }] }) } } },
    { type: 'assistant/message', seq: 5, data: { message: text(answer) } },
  ]
  const childEvents = [
    { type: 'tool/call', seq: 1, data: { callId: 'r', name: 'fixture_read', arguments: { id: 'read-x' } } },
    { type: 'tool/result', seq: 2, data: { message: { role: 'tool', isError: false, toolCallId: 'r', source: { kind: 'tool', callId: 'r' }, ...text({ nonce: 'nonce-x' }) } } },
    { type: 'assistant/message', seq: 3, data: { message: text(answer) } },
    { type: 'turn/end', seq: 4, data: { reason: { kind: 'completed' } } },
  ]
  return { rootId: 'parent', route, challenge, rootEvents, children: new Map([[child, childEvents]]),
    requests: [[], ['nonce-x']].map(toolResultNonces => ({ sessionId: child, provider: 'opencode-go', model: 'flash', reasoningEffort: 'low', maxTokens: 2048, tools: ['fixture_read'], toolResultNonces })),
    toolCalls: [{ sessionId: child, id: 'read-x', nonce: 'nonce-x', callId: 'r', isError: false }] }
}
test('native event collector proves complete delegation and refuses unpaired or mismatched actual request evidence', () => {
  assert.equal(collectOcgPoolPhase(evidence()).audit.passed, true)
  for (const mutate of [
    value => { value.requests[1].model = 'other' },
    value => { value.children.get('ultra-child-x')[1].data.message.source.callId = 'forged' },
    value => { value.children.get('ultra-child-x')[1].seq = 0 },
    value => { value.rootEvents[3].data.message.isError = true },
  ]) {
    const value = evidence(); mutate(value)
    assert.equal(collectOcgPoolPhase(value).audit.passed, false)
  }
})

test('every parent and child receipt requires a successful native tool role, source identity and ordered sequence', () => {
  for (const select of [value => value.rootEvents[1], value => value.rootEvents[3], value => value.children.get('ultra-child-x')[1]]) {
    for (const mutate of [
      row => { row.data.message.role = 'user' },
      row => { row.data.message.source.kind = 'user' },
      row => { row.data.message.source.callId = 'forged' },
      row => { delete row.data.message.source },
      row => { delete row.data.message.isError },
      row => { row.data.message.isError = 'false' },
      row => { row.seq = 0 },
      row => { row.seq = NaN },
    ]) {
      const value = evidence(); mutate(select(value))
      assert.equal(collectOcgPoolPhase(value).audit.passed, false)
    }
  }
})

test('explicit selection audit keeps the requested ID while requiring the user-selected actual route', () => {
  const value = evidence()
  value.expectedSelectedRoute = routes[1]
  for (const request of value.requests) Object.assign(request, { model: 'other', reasoningEffort: 'high', maxTokens: 4096 })
  const record = JSON.parse(value.rootEvents[3].data.message.content[0].text).agents[0]
  record.model.selectedConfigId = 'inspect'; record.model.source = 'user'; record.model.actual.model = 'other'
  value.rootEvents[3].data.message.content[0].text = JSON.stringify({ agents: [record] })
  const collected = collectOcgPoolPhase(value)
  assert.equal(collected.audit.passed, true)
  assert.equal(collected.spawns[0].requestedModelId, 'compute')
  assert.equal(collected.records[0].model.requestedId, 'compute')
  assert.equal(collected.records[0].model.selectedConfigId, 'inspect')
  assert.equal(collected.expectedSelectedRoute.id, 'inspect')
  value.requests[0].model = 'flash'
  assert.equal(collectOcgPoolPhase(value).audit.passed, false)
})
test('a correct child JSON followed by explanatory prose remains a protocol failure and has a precise diagnostic', () => {
  const value = evidence(), rows = value.children.get('ultra-child-x')
  rows[2].data.message.content[0].text += '\nEvidence: the arithmetic was checked.'
  const proof = collectOcgPoolPhase(value)
  assert.equal(proof.audit.passed, false)
  assert.deepEqual(proof.protocolDiagnostics, [{ sessionId: 'ultra-child-x', publicAnswerIsSingleJsonObject: false }])
})
test('failed-turn metadata preserves transport classification without exporting error bodies', () => {
  assert.deepEqual(ocgFailedTurnMetadata([{ seq: 5, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'TIMEOUT', message: 'PRIVATE', body: 'PRIVATE' } } } }]), [{ seq: 5, kind: 'error', code: 'TIMEOUT' }])
})
