import test from 'node:test'
import assert from 'node:assert/strict'
import * as driver from '../scripts/host-acceptance/acceptance-plugin.mjs'

// Mirrors EvidenceSupport's getter-only view; writes to that view must never
// replace the native Loader owner's authoritative configuration.
function nativeConfigFixture() {
  const config = { memoryMaxRequests: 0 }
  const entry = { options: { name: '@dsh-external/dsh-ultra-mode' }, fiber: { config } }
  const memory = { host: { config: new Proxy({}, { get: (_target, key) => config[key] }) } }
  const ctx = { get: name => name === 'loader' ? { entries: () => [entry].values() } : undefined }
  return { config, memory, ctx }
}

test('native budget probe changes Loader authority and restores the getter-only evidence view', async () => {
  assert.equal(typeof driver.withNativeRequestBudget, 'function', 'native budget probe must use the active Loader owner')
  const { config, memory, ctx } = nativeConfigFixture()
  const value = await driver.withNativeRequestBudget(ctx, memory, 13, async () => {
    assert.equal(config.memoryMaxRequests, 13)
    assert.equal(memory.host.config.memoryMaxRequests, 13)
    assert.equal(Object.hasOwn(memory.host.config, 'memoryMaxRequests'), false)
    return 'request observed'
  })
  assert.equal(value, 'request observed')
  assert.equal(config.memoryMaxRequests, 0)
  assert.equal(memory.host.config.memoryMaxRequests, 0)
})

test('native budget probe restores authority when the native request fails', async () => {
  assert.equal(typeof driver.withNativeRequestBudget, 'function')
  const { config, memory, ctx } = nativeConfigFixture()
  await assert.rejects(driver.withNativeRequestBudget(ctx, memory, 13, async () => { throw new Error('native failure') }), /native failure/)
  assert.equal(config.memoryMaxRequests, 0)
  assert.equal(memory.host.config.memoryMaxRequests, 0)
})

test('native budget probe refuses a missing or ambiguous active Ultra owner', async () => {
  assert.equal(typeof driver.withNativeRequestBudget, 'function')
  const { memory } = nativeConfigFixture()
  for (const entries of [[], [{ options: { name: '@dsh-external/dsh-ultra-memory' }, fiber: { config: {} } }],
    [1, 2].map(() => ({ options: { name: '@dsh-external/dsh-ultra-mode' }, fiber: { config: {} } }))]) {
    let called = false
    await assert.rejects(driver.withNativeRequestBudget({ get: () => ({ entries: () => entries.values() }) }, memory, 13, async () => { called = true }), /one active native Ultra Loader owner/)
    assert.equal(called, false)
  }
})

test('native budget probe fails before dispatch when the effective getter is not updated', async () => {
  assert.equal(typeof driver.withNativeRequestBudget, 'function')
  const { config, ctx } = nativeConfigFixture()
  let called = false
  await assert.rejects(driver.withNativeRequestBudget(ctx, { host: { config: { memoryMaxRequests: 0 } } }, 13, async () => { called = true }), /effective request budget/)
  assert.equal(called, false)
  assert.equal(config.memoryMaxRequests, 0)
})

test('native budget probe rejects an invalid finite request limit before changing authority', async () => {
  assert.equal(typeof driver.withNativeRequestBudget, 'function')
  const { config, memory, ctx } = nativeConfigFixture()
  for (const limit of [0, -1, 1.5, Infinity, NaN]) await assert.rejects(driver.withNativeRequestBudget(ctx, memory, limit, async () => {}), /positive safe integer/)
  assert.equal(config.memoryMaxRequests, 0)
})
