/** Real Cordis scope/lifecycle checks across independently bundled entry modules. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const selectedSdk = process.env.DSH_ULTRA_TEST_SDK && path.resolve(process.env.DSH_ULTRA_TEST_SDK)
const selectedRequire = createRequire(selectedSdk ? path.join(selectedSdk, '.ultra-sdk-selector.cjs') : import.meta.url)
const sdkImport = name => import(pathToFileURL(selectedRequire.resolve('@deepseek-ai/' + name)).href)
const [{ Context }, { ToolRuntime }, { SystemPrompt }, { SessionStore }] = await Promise.all(
  ['cordis', 'dsh-tools', 'dsh-system-prompt', 'dsh-session'].map(sdkImport),
)
const output = fs.mkdtempSync(path.resolve('node_modules/.companion-native-owner-test-'))
test.after(() => fs.rmSync(output, { recursive: true, force: true }))

async function independentBundle(variant, entry) {
  const outfile = path.join(output, variant + '.mjs')
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'pinned-native-sdk', setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: pathToFileURL(selectedRequire.resolve(args.path)).href, external: true }))
    } }],
  })
  return import(pathToFileURL(outfile).href)
}
const ultra = await independentBundle('ultra', 'src/index.ts')
const decision = await independentBundle('decision', 'src/decision-plugin.ts')

for (const [firstName, first, secondName, second] of [['ultra', ultra, 'decision', decision], ['decision', decision, 'ultra', ultra]]) {
  test(`native ${firstName} owner rejects independently bundled ${secondName} then permits it after unload`, async t => {
    const ctx = new Context()
    t.after(() => ctx.fiber.dispose())
    await ctx.plugin(SessionStore).await()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
    await ctx.plugin(ToolRuntime, { mode: 'native' }).await()
    ctx.provide('agents', { get() {}, roots: () => [] })
    let modelRequests = 0, createdAgents = 0
    ctx.on('llm/stream', async function* (_request, next) { modelRequests++; yield* next() })
    ctx.on('agent/created', () => { createdAgents++ })
    const names = () => ctx.get('tools').schemas().map(tool => tool.name).sort()
    const baseline = names()
    const active = ctx.plugin(first, {})
    await active.await()
    const evidence = ctx.get('ultraEvidenceSupport'), toolNames = names()
    assert.equal(ctx.get('ultraCoordinationOwner').variant, firstName)
    assert.equal(evidence.status().leases, 1)
    assert.equal(toolNames.filter(name => name === 'ultra_memory_search').length, 1)
    assert.equal(toolNames.filter(name => name === 'ultra_memory_get').length, 1)
    assert.equal(toolNames.includes('ultra_task'), firstName === 'ultra')

    const duplicate = ctx.plugin(second, {})
    await assert.rejects(duplicate.await(), /Ultra.*Decision.*同一 scope.*请选择/u)
    assert.equal(ctx.get('ultraCoordinationOwner').variant, firstName)
    assert.equal(ctx.get('ultraEvidenceSupport'), evidence)
    assert.equal(evidence.status().leases, 1, 'rejected coordinator never acquires another evidence lease')
    assert.deepEqual(names(), toolNames, 'rejection leaves the first owner tools intact and registers no second entries')
    assert.equal(modelRequests, 0)
    assert.equal(createdAgents, 0)
    await duplicate.dispose()
    await active.dispose()
    assert.equal(ctx.get('ultraCoordinationOwner'), undefined)
    assert.equal(ctx.get('ultraEvidenceSupport'), undefined)
    assert.deepEqual(names(), baseline)

    const replacement = ctx.plugin(second, {})
    await replacement.await()
    assert.equal(ctx.get('ultraCoordinationOwner').variant, secondName)
    assert.equal(ctx.get('ultraEvidenceSupport').status().leases, 1)
    assert.equal(names().filter(name => name === 'ultra_memory_search').length, 1)
    assert.equal(names().includes('ultra_task'), secondName === 'ultra')
    assert.equal(modelRequests, 0)
    assert.equal(createdAgents, 0)
    await replacement.dispose()
    assert.equal(ctx.get('ultraCoordinationOwner'), undefined)
    assert.equal(ctx.get('ultraEvidenceSupport'), undefined)
    assert.deepEqual(names(), baseline)
  })
}
