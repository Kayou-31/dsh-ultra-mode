import test from 'node:test'
import assert from 'node:assert/strict'
let api = {}
try { api = await import('../lib/model-pool-settings.js') } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e }
test('model pool settings use native persistence and recover multiple provider-qualified entries', async () => {
  assert.equal(typeof api.createModelPoolSettings, 'function', 'native Settings controller must be implemented')
  const disk = new Map(), models = [{ provider: 'a', id: 'same', name: 'Same' }, { provider: 'b', id: 'same', name: 'Same' }]
  let current = { models: [] }, writes = 0
  const llm = { listProviders: () => [{ id: 'a' }, { id: 'b' }], listModels: async p => models.filter(m => m.provider === p) }
  const ctx = { fiber: { entry: { options: { id: 'ultra-mode' } } }, get: name => name === 'llm' ? llm : name === 'settings' ? { async update(ns, patch) { assert.equal(ns, 'ultra-mode'); assert.deepEqual(Object.keys(patch), ['collaborationModelPool']); disk.set(ns, JSON.stringify(patch)); current = patch.collaborationModelPool; writes++ } } : undefined }
  const config = { collaborationModelPool: { get: () => current } }
  const controller = api.createModelPoolSettings(ctx, config, () => [])
  const entry = (id, provider) => ({ id, name: id, provider, model: 'same' })
  await controller.save('root', { models: [entry('a-code', 'a'), entry('b-review', 'b')] })
  assert.equal(writes, 1)
  const afterRestart = JSON.parse(disk.get('ultra-mode')).collaborationModelPool
  const restored = api.createModelPoolSettings(ctx, { collaborationModelPool: afterRestart }, () => [])
  const view = await restored.get('root')
  assert.deepEqual(view.config.models.map(m => [m.id, m.provider]), [['a-code', 'a'], ['b-review', 'b']])
  assert.deepEqual(view.hostModels.map(m => [m.provider, m.model]), [['a', 'same'], ['b', 'same']])
  assert.equal(view.editable, true)
  await assert.rejects(() => controller.save('root', { models: [entry('x', 'a')], apiKey: 'forbidden' }), /apiKey|未知/)
  assert.equal(writes, 1)
})
test('settings without a native profile entry cannot claim a saved configuration', async () => {
  assert.equal(typeof api.createModelPoolSettings, 'function')
  const controller = api.createModelPoolSettings({ get: () => undefined }, {}, () => [])
  assert.equal((await controller.get('root')).editable, false)
  await assert.rejects(() => controller.save('root', { models: [] }), /Settings|持久化/)
})
test('switching the user fixed model back to auto explicitly clears a native merged setting', async () => {
  let current = { models: [{ id: 'a', provider: 'p', model: 'm' }], explicitModelId: 'a' }
  const ctx = { fiber: { entry: { options: { id: 'ultra-mode' } } }, get: name => name === 'settings' ? { async update(_ns, patch) { current = { ...current, ...patch.collaborationModelPool } } } : undefined }
  const controller = api.createModelPoolSettings(ctx, { collaborationModelPool: { get: () => current } }, () => [])
  await controller.save('root', { models: [{ id: 'a', provider: 'p', model: 'm' }] })
  assert.equal((await controller.get('root')).config.explicitModelId, undefined)
})
test('a host provider with more than 256 configured models keeps later candidates selectable', async () => {
  const models = Array.from({ length: 300 }, (_, i) => ({ provider: 'large', id: 'm' + i, name: 'Model ' + i }))
  const ctx = { get: name => name === 'llm' ? { listProviders: () => [{ id: 'large' }], async listModels() { return models } } : undefined }
  const controller = api.createModelPoolSettings(ctx, {}, () => [])
  const view = await controller.get('root')
  assert.equal(view.hostModels.length, 300)
  assert.equal(view.hostModels.at(-1).model, 'm299')
})
