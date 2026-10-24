/** Distribution checks: copied source is auditable; runtime bundles stand alone. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')

test('Decision native schema defaults to no sidecar and has no route-count or ultra tool controls', async () => {
  const decision = await import('../lib/decision-plugin.js')
  const full = await import('../lib/index.js')
  const ordinary = decision.Config({})
  assert.equal(ordinary.decisionAssistEnabled, false)
  assert.equal(ordinary.collaborationEnabled, false)
  assert.equal(ordinary.decisionGovernance, false)
  assert.equal('concurrency' in decision.Config.dict, false)
  assert.equal('toolName' in decision.Config.dict, false)
  assert.equal(full.Config({}).concurrency, 3)
  assert.equal(full.Config({}).toolName, 'ultra_task')
})

test('both companion distributions contain only native external imports and match their shared core inventory', async t => {
  const inventories = []
  const isolated = await mkdtemp(path.join(root, 'node_modules', '.companion-package-test-'))
  t.after(() => rm(isolated, { recursive: true, force: true }))
  for (const variant of ['memory', 'decision']) {
    const directory = path.join(root, 'packages', `dsh-ultra-${variant}`)
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
    assert.equal(manifest.name, `@dsh-external/dsh-ultra-${variant}`)
    assert.equal(manifest.version, '0.1.1')
    assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0)
    const bundle = await readFile(path.join(directory, 'lib/index.js'), 'utf8')
    const externals = [...bundle.matchAll(/(?:from\s*|import\s*\()(["'])([^"']+)\1/gu)].map(match => match[2])
    assert.ok(externals.length > 0)
    assert.ok(externals.every(name => name.startsWith('@deepseek-ai/') || name.startsWith('node:')), externals.join(', '))
    assert.ok(!bundle.includes('require('), 'ESM distribution cannot need a hidden CommonJS loader')
    const isolatedEntry = path.join(isolated, variant + '.mjs')
    await copyFile(path.join(directory, 'lib/index.js'), isolatedEntry)
    const standalone = await import(pathToFileURL(isolatedEntry).href)
    assert.equal(standalone.name, manifest.name, 'only the bundled entry and native host peers are needed to load')
    const inventory = JSON.parse(await readFile(path.join(directory, 'SOURCE-MANIFEST.json'), 'utf8'))
    assert.equal(inventory.package.name, manifest.name)
    assert.equal(inventory.root.version, '0.6.1')
    assert.equal(inventory.runtime.sha256, sha256(Buffer.from(bundle)))
    assert.ok(inventory.coreSources.length > 25)
    for (const source of inventory.coreSources) {
      assert.equal(source.sha256, sha256(await readFile(path.join(root, source.path))), source.path)
      assert.equal(source.sha256, sha256(await readFile(path.join(directory, 'core-src', source.path.slice(4)))), source.path)
    }
    inventories.push(inventory.coreSources)
    for (const script of ['knowledge-profile-plugin.mjs', 'real-model-global-limit.mjs', 'network-guard.cjs',
      'run-ocg-profile.mjs', 'ocg-network-guard.cjs', 'ocg-pool-plugin.mjs', 'ocg-knowledge-plugin.mjs', 'ocg-report.mjs',
      ...(variant === 'decision' ? ['companion-decision-plugin.mjs', 'run-companion-decision-profile.mjs', 'model-pool-live-driver.mjs', 'run-decision-loop-profile.mjs'] : [])]) {
      const source = path.join('scripts', 'host-acceptance', script)
      assert.equal(sha256(await readFile(path.join(directory, source))), sha256(await readFile(path.join(root, source))), script)
    }
    for (const source of inventory.buildSources) assert.equal(source.sha256, sha256(await readFile(path.join(root, source.path))), source.path)
  }
  assert.deepEqual(inventories[0], inventories[1], 'both companion snapshots use the same root source revision')
})
