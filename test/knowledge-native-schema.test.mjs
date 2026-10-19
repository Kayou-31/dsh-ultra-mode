/** Native DSH schema compilation: mock registrations alone miss DSL incompatibilities. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const sdk = await import(process.env.DSH_ULTRA_TEST_SDK
  ? pathToFileURL(resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai/dsh-tools/lib/index.js')).href
  : '@deepseek-ai/dsh-tools')

function nativeDefinitions() {
  const definitions = [], api = {}
  const ctx = {
    get(name) { return name === 'tools'
      ? { get() {}, register(value) { definitions.push(value) }, guard() {} }
      : { section() {} } },
    on() { return () => {} },
    inject(_names, callback) { callback(ctx) },
  }
  class GlobalKnowledgeHost {}
  const imports = {
    'node:crypto': { randomUUID: () => 'native-schema-fixture' },
    '@deepseek-ai/dsh-tools': sdk,
    './knowledge-host.js': { GlobalKnowledgeHost },
    './runtime.js': { canPublishKnowledge: () => true, routeParentOf() {} },
    './memory-host.js': { memoryFor() {} },
  }
  const compiled = ts.transpileModule(readFileSync(new URL('../src/knowledge-integration.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(compiled, { exports: api, require(name) { assert.ok(imports[name], name); return imports[name] }, AbortController, AbortSignal, Promise, Map, Set })
  const integration = api.installKnowledgeIntegration(ctx, { globalKnowledge: { enabled: true } }, {}, {
    isUltraEnabled: () => false, signal: new AbortController().signal,
  })
  return { definitions, integration }
}

test('all knowledge tools compile with the actual native schema DSL and enforce nested source fields', async () => {
  const { definitions, integration } = nativeDefinitions()
  try {
    assert.equal(definitions.length, 4)
    const publish = definitions.find(value => value.name === 'ultra_knowledge_publish')
    const nested = publish.parameters.properties.sources.items
    assert.deepEqual(nested.required, ['sourceId', 'quote'])
    assert.equal(nested.additionalProperties, false)
    assert.equal(sdk.validateJsonSchemaValue(publish.parameters, {
      key: 'rule', title: 'Rule', summary: 'Assessment', applicability: 'Fixture',
      sources: [{ sourceId: 'source', quote: 'Exact quote' }],
    }, '').length, 0)
    const exec = { signal: new AbortController().signal, agent: {} }
    for (const source of [{ quote: 'Exact quote' }, { sourceId: 'source' }, { sourceId: 'source', quote: 'Exact quote', rawPath: 'forbidden' }]) {
      await assert.rejects(publish.execute({ key: 'rule', title: 'Rule', summary: 'Assessment', applicability: 'Fixture', sources: [source] }, exec), /invalid arguments/)
    }
  } finally { await integration.close() }
})
