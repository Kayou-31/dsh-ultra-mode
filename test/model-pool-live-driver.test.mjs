import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLiveConfig, createLiveChallenges, livePhasePrompt, judgeLivePhase } from '../scripts/host-acceptance/model-pool-live-driver.mjs'
const base = () => ({ runtimeRoot: '/runtime', ultraRoot: '/ultra', projectDir: '/project', resultFile: '/results/result.json', provider: 'naizhi', model: 'same', routes: [
  { id: 'coding', provider: 'naizhi', model: 'same', kind: 'code', reasoningEffort: 'low', maxTokens: 2000 },
  { id: 'review', provider: 'naizhi', model: 'same', kind: 'review', reasoningEffort: 'max', maxTokens: 3000 },
] })
test('live driver distinguishes different configuration from actual different models', () => {
  const same = normalizeLiveConfig(base()); assert.equal(same.routeClassification, 'same-model-different-config')
  assert.throws(() => normalizeLiveConfig({ ...base(), distinctModels: true }), /distinct|different/i)
  const value = base(); value.routes[1].model = 'other'; assert.equal(normalizeLiveConfig(value).routeClassification, 'distinct-models')
  assert.throws(() => normalizeLiveConfig({ ...base(), maxRequests: 41 }), /request/i)
  assert.throws(() => normalizeLiveConfig({ ...base(), routes: [base().routes[0], base().routes[0]] }), /kind|unique|duplicate/i)
})
test('fresh challenges are unpredictable and prompts withhold nonce and expected candidate ID', () => {
  const a = createLiveChallenges(), b = createLiveChallenges(); assert.notEqual(a.code.nonce, b.code.nonce); assert.notEqual(a.code.nonce, a.review.nonce)
  const prompt = livePhasePrompt('code', a.code)
  assert.ok(prompt.includes('ultra_spawn_agent')); assert.ok(prompt.includes('fixture_read')); assert.ok(!prompt.includes(a.code.nonce)); assert.ok(!prompt.includes('coding')); assert.ok(!prompt.includes('naizhi'))
})
function observation() {
  const challenge = createLiveChallenges().code, route = base().routes[0], sessionId = 'ultra-child-test'
  return { challenge, route, rootId: 'root', publicText: JSON.stringify({ fixtureId: challenge.id, nonce: challenge.nonce, answer: challenge.answer }),
    spawns: [{ id: sessionId, parentId: 'root', requestedModelId: route.id, reason: 'Task capability fit', isError: false }],
    toolCalls: [{ sessionId, id: challenge.id, nonce: challenge.nonce, callId: 'call-1', isError: false }],
    requests: [{ sessionId, provider: route.provider, model: route.model, reasoningEffort: 'low', maxTokens: 2000, tools: ['fixture_read'], toolResultNonces: [] }, { sessionId, provider: route.provider, model: route.model, reasoningEffort: 'low', maxTokens: 2000, tools: ['fixture_read'], toolResultNonces: [challenge.nonce] }],
    records: [{ id: sessionId, status: 'completed', model: { requestedId: route.id, actual: { provider: route.provider, model: route.model }, compatibility: { tools: 'observed-native-tool-result' } } }],
    nativeToolReceipts: [{ sessionId, id: challenge.id, nonce: challenge.nonce, callId: 'call-1', callSeq: 4, resultSeq: 6 }],
    childAnswers: [{ sessionId, text: JSON.stringify({ fixtureId: challenge.id, nonce: challenge.nonce, answer: challenge.answer }), completed: true }] }
}
test('quality judge requires actual assembled target requests, tool execution, native paired receipt and public child readback', () => {
  assert.equal(judgeLivePhase(observation()).passed, true)
  for (const change of [value => { value.toolCalls = [] }, value => { value.requests[1].toolResultNonces = [] }, value => { value.requests[0].reasoningEffort = 'max' }, value => { value.spawns[0].requestedModelId = 'review' }, value => { value.nativeToolReceipts = [] }, value => { value.childAnswers[0].text = '{}' }, value => { value.publicText = '{}' }]) {
    const value = observation(); change(value); assert.equal(judgeLivePhase(value).passed, false)
  }
})

test('live configuration is copied and rejects unsafe or ambiguous offline test limits', () => {
  const input = base(), normalized = normalizeLiveConfig(input)
  assert.ok(Number.isSafeInteger(normalized.maxRequests) && normalized.maxRequests > 0 && normalized.maxRequests <= 40)
  assert.notEqual(normalized.routes, input.routes)
  assert.notEqual(normalized.routes[0], input.routes[0])
  for (const change of [value => { value.routes = [] }, value => { value.maxRequests = 0 }, value => { value.maxRequests = NaN }, value => { value.routes[0].maxTokens = -1 }, value => { value.routes[0].reasoningEffort = 'invented' }, value => { value.resultFile = '' }]) {
    const value = base(); change(value); assert.throws(() => normalizeLiveConfig(value))
  }
  assert.throws(() => livePhasePrompt('unknown', createLiveChallenges().code))
})

test('quality judge rejects forged, mixed-child, incomplete and unpaired observations', () => {
  assert.equal(judgeLivePhase(null).passed, false)
  for (const change of [
    value => { value.spawns[0].parentId = 'someone-else' },
    value => { value.spawns[0].isError = true },
    value => { value.spawns[0].reason = '' },
    value => { value.toolCalls[0].isError = true },
    value => { value.toolCalls[0].sessionId = 'unrelated-child' },
    value => { value.nativeToolReceipts[0].sessionId = 'unrelated-child' },
    value => { value.nativeToolReceipts[0].callId = 'different-call' },
    value => { value.nativeToolReceipts[0].resultSeq = 3 },
    value => { value.records[0].model.actual.model = 'wrong-model' },
    value => { value.records[0].model.compatibility.tools = 'configured-only' },
    value => { value.records[0].status = 'failed' },
    value => { value.childAnswers[0].completed = false },
    value => { value.childAnswers[0].sessionId = 'unrelated-child' },
    value => { value.requests[0].tools = [] },
    value => { value.requests[1].maxTokens = 999 },
    value => { value.requests[1].provider = 'wrong-provider' },
    value => { value.requests.reverse() },
    value => { value.publicText = JSON.stringify({ fixtureId: value.challenge.id, nonce: value.challenge.nonce, answer: 'wrong' }) },
    value => {
      delete value.route.model; delete value.records[0].model.actual.model
      for (const request of value.requests) delete request.model
    },
    value => {
      value.challenge = { ...value.challenge }; delete value.challenge.answer
      value.publicText = value.childAnswers[0].text = JSON.stringify({ fixtureId: value.challenge.id, nonce: value.challenge.nonce })
    },
  ]) {
    const value = observation(); change(value); assert.equal(judgeLivePhase(value).passed, false)
  }
})
