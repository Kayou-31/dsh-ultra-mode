/** Verify packed bytes in a fresh directory against one explicitly selected native SDK.
 * Native Cordis Loader/service integration; agents are an inert fixture. No CLI, UI or model proof.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { sdk: { type: 'string' }, packages: { type: 'string' }, work: { type: 'string' } } })
for (const key of ['sdk', 'packages', 'work']) assert.ok(values[key], `--${key} is required`)
const sdk = path.resolve(values.sdk), packages = path.resolve(values.packages), work = path.resolve(values.work)
await fs.mkdir(work, { recursive: true })
assert.deepEqual(await fs.readdir(work), [], 'Use a fresh verification directory')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const req = createRequire(path.join(sdk, '.ultra-package-check.cjs'))
const load = name => import(pathToFileURL(req.resolve('@deepseek-ai/' + name)).href)
const read = file => fs.readFile(file, 'utf8').then(JSON.parse)
const sdkVersion = (await read(path.join(sdk, '@deepseek-ai/dsh-agent/package.json'))).version
assert.ok(['0.2.1-rc.2', '0.2.1-rc.3'].includes(sdkVersion))
const sdkInventory = []
for (const name of (await fs.readdir(path.join(sdk, '@deepseek-ai'))).filter(n => n.startsWith('dsh-'))) {
  const file = path.join(sdk, '@deepseek-ai', name, 'package.json'), bytes = await fs.readFile(file), manifest = JSON.parse(bytes)
  assert.equal(manifest.version, sdkVersion, `Mixed SDK: ${name}`)
  sdkInventory.push({ name: manifest.name, version: manifest.version, manifestSha256: sha(bytes) })
}
const entries = {}, inventories = []
for (const [variant, version] of [['mode', '0.7.0'], ['memory', '0.2.0'], ['decision', '0.2.0']]) {
  const filename = `dsh-external-dsh-ultra-${variant}-${version}.tgz`, archive = path.join(packages, filename)
  const list = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8', windowsHide: true })
  assert.equal(list.status, 0, list.stderr)
  const members = list.stdout.trim().split(/\r?\n/)
  for (const name of members) assert.ok(name.startsWith('package/') && !name.includes('\\') && !name.split('/').some(p => p === '..' || p.includes(':')), name)
  assert.equal(new Set(members).size, members.length, 'Duplicate archive entry')
  const directory = path.join(work, variant); await fs.mkdir(directory)
  const unpack = spawnSync('tar', ['-xzf', archive, '-C', directory], { encoding: 'utf8', windowsHide: true })
  assert.equal(unpack.status, 0, unpack.stderr)
  const root = path.join(directory, 'package'), manifest = await read(path.join(root, 'package.json'))
  assert.equal(manifest.name, `@dsh-external/dsh-ultra-${variant}`); assert.equal(manifest.version, version)
  await fs.symlink(sdk, path.join(root, 'node_modules'), 'junction')
  for (const file of [manifest.main, manifest.types, manifest.dsh.bundle.patch, 'README.md', 'LICENSE']) await fs.access(path.join(root, file))
  const provenance = await read(path.join(root, 'SOURCE-MANIFEST.json'))
  assert.equal(provenance.package.version, version); assert.equal(provenance.root.version, '0.7.0')
  for (const source of provenance.coreSources) {
    const file = variant === 'mode' ? source.path : 'core-src/' + source.path.slice(4)
    assert.equal(sha(await fs.readFile(path.join(root, file))), source.sha256, file)
  }
  const entry = path.join(root, manifest.main), entrySha256 = sha(await fs.readFile(entry))
  if (variant !== 'mode') assert.equal(entrySha256, provenance.runtime.sha256)
  entries[variant] = pathToFileURL(entry).href
  inventories.push({ variant, filename, version, bytes: (await fs.stat(archive)).size, sha256: sha(await fs.readFile(archive)), members: members.length, entrySha256, coreSources: provenance.coreSources.length })
}
const [{ Context }, { default: Loader }, { SessionStore }, { SystemPrompt }, { ToolRuntime }] = await Promise.all(['cordis','cordis-plugin-loader','dsh-session','dsh-system-prompt','dsh-tools'].map(load))
const checks = []
const expectedOwner = variants => variants.includes('memory') ? 'memory' : variants.includes('mode') ? 'ultra' : 'decision'
async function checkAuthority(service, variants) {
  await service.ready()
  const status = service.status()
  assert.equal(status.leases, variants.length)
  assert.equal(status.owner, expectedOwner(variants))
  assert.equal(status.transitioning, false)
  assert.deepEqual(status.errors, [])
}
let modelRequests = 0, createdAgents = 0
let stage = 'native setup'
process.on('uncaughtExceptionMonitor', () => console.error(`Package verification failed during: ${stage}`))
for (const order of [['mode'], ['memory'], ['decision'], ['memory','mode'], ['mode','memory'], ['memory','decision'], ['decision','memory']]) {
  const ctx = new Context(), mounted = []
  try {
    await ctx.plugin(SessionStore).await()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
    await ctx.plugin(ToolRuntime, { mode: 'native' }).await()
    ctx.provide('agents', { get() {}, roots: () => [] })
    ctx.on('llm/stream', async function* () { modelRequests++; throw new Error('Unexpected model request') })
    ctx.on('agent/created', () => { createdAgents++ })
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(work + path.sep).href }).await()
    const loader = ctx.get('loader')
    const baseline = ctx.get('tools').schemas().map(t => t.name).sort()
    for (const variant of order) {
      stage = `${sdkVersion}: ${order.join('+')}: load ${variant}`
      const id = await loader.create({ name: entries[variant], config: {} })
      await loader.await(); await loader.resolve(id).fiber.await(); mounted.push({ id, variant })
      await checkAuthority(ctx.get('ultraEvidenceSupport'), mounted.map(item => item.variant))
    }
    const service = ctx.get('ultraEvidenceSupport'), names = ctx.get('tools').schemas().map(t => t.name)
    assert.equal(names.filter(n => n === 'ultra_memory_search').length, 1)
    assert.equal(names.filter(n => n === 'ultra_memory_get').length, 1)
    assert.equal(names.filter(n => n === 'ultra_memory_status').length, 1)
    assert.equal(names.includes('ultra_task'), order.includes('mode'))
    assert.equal(service.status().owner, expectedOwner(order))
    // Remove in installation order: verify surviving authority and registration.
    for (const [index, { id }] of mounted.entries()) {
      stage = `${sdkVersion}: ${order.join('+')}: remove ${id}`
      // Removed entries leave the Loader tree immediately, so loader.await()
      // alone does not include their asynchronous disposal task.
      const fiber = loader.resolve(id).fiber
      loader.remove(id); await fiber.await(); await loader.await()
      if (index + 1 < mounted.length) {
        assert.equal(ctx.get('ultraEvidenceSupport'), service)
        await checkAuthority(service, mounted.slice(index + 1).map(item => item.variant))
        assert.equal(ctx.get('tools').schemas().filter(t => t.name === 'ultra_memory_get').length, 1)
      }
    }
    stage = `${sdkVersion}: ${order.join('+')}: verify final cleanup`
    assert.ok(ctx.get('ultraEvidenceSupport') === undefined, 'Evidence service must be removed after the final lease')
    assert.ok(ctx.get('ultraCoordinationOwner') === undefined, 'Coordination owner must be removed after unload')
    assert.equal(service.status().leases, 0)
    assert.deepEqual(service.status().errors, [])
    assert.deepEqual(ctx.get('tools').schemas().map(t => t.name).sort(), baseline)
    checks.push({ order, nativeLoader: true, defaultModelRequests: 0, uniqueEvidenceTools: true, remainingLeaseAuthorityAndRegistration: true, finalCleanup: true })
  } catch (error) {
    console.error(`Failure at ${stage}: ${error.message}`)
    throw error
  } finally { await ctx.fiber.dispose() }
}
assert.equal(modelRequests, 0); assert.equal(createdAgents, 0)
const result = { sdkVersion, node: process.version, scope: 'actual TGZ bytes; native Cordis Loader, SessionStore, ToolRuntime, SystemPrompt; inert agents fixture; not CLI/Desktop or model evaluation', inventories, sdkInventory, checks, modelRequests, createdAgents, passed: true }
await fs.writeFile(path.join(work, 'package-verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ sdkVersion, packages: inventories.length, scenarios: checks.length, modelRequests, passed: true }))
