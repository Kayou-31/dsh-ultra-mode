import test from 'node:test'
import assert from 'node:assert/strict'
let api = {}
try { api = await import('../lib/model-pool.js') } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e }
const model = (id, provider = 'a', extra = {}) => ({ id, name: id, enabled: true, provider, model: 'same', strengths: 'code', suitableFor: 'tests', avoidFor: 'images', isDefault: false, maxConcurrent: 1, allowCrossProvider: false, allowUnverifiedTools: true, ...extra })
const context = (extra = {}) => ({ parentProvider: 'a', requiredInputs: ['text'], requiresTools: true, scopeId: 'run', signal: new AbortController().signal, ...extra })
function fixture(models = [model('code', 'a', { isDefault: true }), model('review', 'b', { allowCrossProvider: true, reasoningEffort: 'high', maxTokens: 500 })], options = {}) {
  assert.equal(typeof api.ModelPool, 'function', 'ModelPool must implement actual candidate resolution')
  let config = { models, fallback: 'error', maxConcurrent: 2, maxRequests: 0, failureLimit: 2, ...options }
  const calls = []
  const host = { listProviders: () => [{ id: 'a' }, { id: 'b' }], async listModels(provider) { return [{ provider, id: 'same', name: 'Same display' }] },
    async resolveModelInfo(provider, id) { calls.push([provider, id]); return { provider, id, inputModalities: ['text'], reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } } },
    async resolveCallConfig(c) { if (c.reasoningEffort && !['low', 'high'].includes(c.reasoningEffort)) throw Error('unsupported effort'); return { ...c, reasoningEffort: c.reasoningEffort ?? 'low' } } }
  const pool = new api.ModelPool(() => config, host)
  return { pool, calls, host, get config() { return config }, set config(v) { config = v } }
}
test('unconfigured pool returns native inheritance without resolving a model', async () => {
  const f = fixture([])
  assert.equal(await f.pool.select({}, context()), undefined)
  assert.equal(f.calls.length, 0)
})
test('model pool configuration roundtrips stable IDs and rejects keys that could bypass native routing', () => {
  const f = fixture()
  const value = api.readModelPool(JSON.parse(JSON.stringify(f.config)))
  assert.deepEqual(value.models.map(m => [m.id, m.provider, m.model]), [['code', 'a', 'same'], ['review', 'b', 'same']])
  assert.throws(() => api.readModelPool({ ...f.config, models: [model('x', 'a', { apiKey: 'forbidden' })] }), /apiKey|未知|unknown/i)
  assert.throws(() => api.readModelPool({ ...f.config, models: [model('x'), model('x')] }), /重复|duplicate/i)
})
test('agent chooses exact configured model by ID and host resolves same-named providers independently', async () => {
  const f = fixture()
  const selected = await f.pool.select({ modelConfigId: 'review', reason: 'Independent review fits this task' }, context())
  assert.equal(selected.provider, 'b'); assert.equal(selected.model, 'same')
  assert.equal(selected.source, 'agent'); assert.equal(selected.selectedConfigId, 'review')
  assert.deepEqual(selected.agentOptions, { provider: 'b', model: 'same', reasoningEffort: 'high', maxTokens: 500 })
  assert.ok(f.calls.some(([p, m]) => p === 'b' && m === 'same'))
})
test('trusted user fixed ID overrides an agent choice and cannot silently fall back', async () => {
  const f = fixture(undefined, { explicitModelId: 'code' })
  const selected = await f.pool.select({ modelConfigId: 'review', reason: 'review' }, context())
  assert.equal(selected.selectedConfigId, 'code'); assert.equal(selected.requestedConfigId, 'review'); assert.equal(selected.source, 'user')
  f.config = { ...f.config, explicitModelId: 'missing', fallback: 'inherit' }
  await assert.rejects(() => f.pool.select({}, context()), /missing|不存在/)
})
test('disabled and nonexistent IDs fail before dispatch; missing reasoning compatibility is not invented', async () => {
  const f = fixture([model('off', 'a', { enabled: false }), model('bad', 'a', { reasoningEffort: 'max' })])
  await assert.rejects(() => f.pool.select({ modelConfigId: 'off', reason: 'x' }, context()), /禁用|disabled/i)
  await assert.rejects(() => f.pool.select({ modelConfigId: 'missing', reason: 'x' }, context()), /不存在|unknown|missing/i)
  await assert.rejects(() => f.pool.select({ modelConfigId: 'bad', reason: 'x' }, context()), /effort|思考/)
})
test('cross-provider and unknown tool or image compatibility need host-enforced permission', async () => {
  const f = fixture([model('remote', 'b'), model('unknown', 'a', { allowUnverifiedTools: false })])
  await assert.rejects(() => f.pool.select({ modelConfigId: 'remote', reason: 'x' }, context()), /provider|授权/)
  await assert.rejects(() => f.pool.select({ modelConfigId: 'unknown', reason: 'x' }, context()), /工具|tool/i)
  f.config = { ...f.config, models: [model('text')] }
  await assert.rejects(() => f.pool.select({ modelConfigId: 'text', reason: 'x' }, context({ requiredInputs: ['text', 'image'] })), /image|输入/)
  f.host.resolveModelInfo = async () => ({ provider: 'a', id: 'same' })
  await assert.rejects(() => f.pool.select({ modelConfigId: 'text', reason: 'x' }, context()), /未知|input|输入/)
})
test('unsupported sampling parameters fail instead of being dropped', () => {
  fixture()
  assert.throws(() => api.readModelPool({ models: [model('x', 'a', { temperature: .4 })] }), /temperature|未知|unknown/i)
})
test('concurrency reservation is atomic and completion frees a slot; followup uses original snapshot', async () => {
  const f = fixture()
  const original = await f.pool.select({}, context())
  f.pool.reserve('one', original)
  assert.throws(() => f.pool.reserve('two', original), /并发|capacity/i)
  f.config = { ...f.config, models: [model('code', 'b', { isDefault: true, allowCrossProvider: true })] }
  assert.equal(original.provider, 'a')
  const changed = await f.pool.select({}, context())
  assert.equal(changed.provider, 'b')
  f.pool.release('one', 'completed')
  f.pool.activate('one')
  assert.equal(f.pool.selection('one').provider, 'a')
  f.pool.release('one', 'cancelled')
})
test('actual request guards detect route drift, tool/input violations and request-budget exhaustion', async () => {
  const f = fixture(undefined, { maxRequests: 1 })
  const selected = await f.pool.select({}, context())
  f.pool.reserve('one', selected)
  const request = { provider: 'a', model: 'same', reasoningEffort: 'low', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [{ name: 'read' }] }
  assert.throws(() => f.pool.beginRequest('one', { ...request, provider: 'b' }), /路由|route/i)
  assert.throws(() => f.pool.beginRequest('one', { ...request, messages: [{ role: 'user', content: [{ type: 'image' }] }] }), /image|输入/)
  const ticket = f.pool.beginRequest('one', request)
  f.pool.finishRequest(ticket, { totalTokens: 42 }, true)
  assert.equal(f.pool.usage('one').knownTokens, 42)
  f.pool.observeTool('one', true)
  assert.equal(f.pool.selection('one').compatibility.tools, 'observed-native-tool-result')
  assert.equal(f.pool.selection('one').toolCalls.succeeded, 1)
  assert.throws(() => f.pool.beginRequest('one', request), /预算|budget/i)
})
test('repeated failures stop redispatch and configured fallback is explicit in selection record', async () => {
  const f = fixture()
  for (const id of ['one', 'two']) { const s = await f.pool.select({}, context()); f.pool.reserve(id, s); f.pool.release(id, 'failed') }
  await assert.rejects(() => f.pool.select({}, context()), /失败|failure/i)
  f.config = { ...f.config, fallback: 'inherit' }
  const fallback = await f.pool.select({}, context())
  assert.equal(fallback.source, 'inherit'); assert.ok(fallback.fallbackReason)
})
test('repeated failed host preflight stops before another compatibility lookup', async () => {
  const f = fixture()
  let checks = 0
  f.host.resolveModelInfo = async () => { checks++; throw Error('local unavailable') }
  await assert.rejects(() => f.pool.select({}, context()), /unavailable/)
  await assert.rejects(() => f.pool.select({}, context()), /unavailable/)
  await assert.rejects(() => f.pool.select({}, context()), /失败|failure/i)
  assert.equal(checks, 2)
})
test('a new inherited reservation never claims its parent tool or request observations', async () => {
  const f = fixture(), selected = await f.pool.select({}, context())
  f.pool.reserve('parent', selected)
  f.pool.observeTool('parent', true)
  f.pool.beginRequest('parent', { provider: 'a', model: 'same', reasoningEffort: 'low' })
  const inherited = f.pool.selection('parent')
  f.pool.release('parent', 'completed')
  f.pool.reserve('descendant', inherited)
  const child = f.pool.selection('descendant')
  assert.equal(child.requestStatus, 'pending'); assert.equal(child.actual, undefined)
  assert.equal(child.toolCalls.succeeded, 0)
  assert.equal(child.compatibility.tools, 'unknown-user-allowed')
})
