/** Actual CLI Loader/Settings profile persistence proof. No model calls. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
export const name = 'ultra-model-pool-profile-acceptance'
export const inject = ['agents', 'llm', 'settings', 'configEditor', 'loader']
export function apply(ctx, config) {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  const off = ready.onReady(() => run(ctx, config).then(() => exit(0), async e => {
    await fs.writeFile(config.resultFile, JSON.stringify({ status: 'failed', mode: config.mode, error: String(e), stack: e.stack }, null, 2))
    console.error(e); exit(1)
  }))
  ctx.effect(() => off)
}
async function run(ctx, config) {
  const { createModelPoolSettings } = await import(pathToFileURL(path.join(config.ultraRoot, 'lib/model-pool-settings.js')).href)
  const result = { status: 'running', mode: config.mode, level: 'real rc.2 CLI Loader, ConfigEditor and Settings; no model requests', checks: [] }
  const check = (name, condition) => { assert.ok(condition, name); result.checks.push({ name, passed: true }) }
  const entry = [...ctx.loader.entries()].find(e => e.options.name === '@dsh-external/dsh-ultra-mode')
  check('candidate owns an active native profile entry', !!entry?.fiber)
  const fiber = entry.fiber, source = fiber.config.collaborationModelPool
  check('model pool uses a native volatile reference', typeof source?.get === 'function')
  const controller = createModelPoolSettings(fiber.ctx, fiber.config, () => [])
  check('native Settings exposes a writable plugin profile', (await controller.get('profile-proof')).editable)
  const candidate = (id, provider, isDefault = false) => ({ id, provider, model: 'same-model', name: id, strengths: 'Synthetic audit capability', suitableFor: 'offline', avoidFor: 'production', isDefault })
  if (config.mode === 'model-pool-resume') {
    const value = (await controller.get('profile-proof')).config
    check('two provider-qualified configurations survive an actual CLI restart', value.models.length === 2 && value.models[0].provider === 'local-proof-a' && value.models[1].provider === 'local-proof-b')
    check('automatic selection remains restored after restart', value.explicitModelId === undefined && value.models[1].isDefault)
    check('saved limits survive restart', value.maxConcurrent === 2 && value.maxRequests === 7 && value.failureLimit === 2)
  } else {
    const models = [candidate('code', 'local-proof-a', true), candidate('review', 'local-proof-b')]
    await controller.save('profile-proof', { models, explicitModelId: 'code', maxConcurrent: 2, maxRequests: 7, failureLimit: 2 })
    check('native Settings persists multiple candidates', source.get().models.length === 2)
    check('user fixed choice reaches the live config', source.get().explicitModelId === 'code')
    const oldSnapshot = source.get()
    await controller.save('profile-proof', { models: models.map((m, i) => ({ ...m, isDefault: i === 1 })), maxConcurrent: 2, maxRequests: 7, failureLimit: 2 })
    check('volatile update does not remount the plugin', entry.fiber === fiber && entry.fiber.config.collaborationModelPool === source)
    check('an earlier captured config snapshot remains unchanged', oldSnapshot.explicitModelId === 'code' && oldSnapshot.models[0].isDefault)
    check('changing back to auto clears the earlier merged fixed ID', (await controller.get('profile-proof')).config.explicitModelId === undefined)
    check('new config snapshot selects the second default', source.get().models[1].isDefault)
    const profile = ctx.get('profileContext'), disk = await fs.readFile(profile.patchPath, 'utf8')
    check('native ConfigEditor committed the profile file', disk.includes('local-proof-a') && disk.includes('local-proof-b') && disk.includes('maxRequests: 7'))
  }
  const gate = ctx.get('ultraAcceptanceModelGate')?.snapshot()
  check('no model request was admitted', gate?.admitted === 0)
  result.status = 'passed'; result.checksCount = result.checks.length
  await fs.writeFile(config.resultFile, JSON.stringify(result, null, 2))
}
