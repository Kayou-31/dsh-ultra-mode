import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOcgBootstrap, makeOcgEnvironment, ocgProfileRows, verifyOcgNativeSessions, ocgSupportFiles, ocgScenarioSettings, ocgTimeoutMs } from '../scripts/host-acceptance/run-ocg-profile.mjs'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as runner from '../scripts/host-acceptance/run-ocg-profile.mjs'
const bootstrap = () => ({ provider: 'opencode-go', providerConfig: { apiKeyEnv: 'OPENCODE_GO_API_KEY', models: [{ id: 'flash' }, { id: 'glm' }] }, credentialFile: '/private/selected.yaml', allowedOrigins: ['https://opencode.ai'], mainModel: 'flash', mainEffort: 'high', routes: [
  { id: 'implement', kind: 'code', provider: 'opencode-go', model: 'flash', reasoningEffort: 'high', maxTokens: 8192 },
  { id: 'inspect', kind: 'review', provider: 'opencode-go', model: 'glm', reasoningEffort: 'high', maxTokens: 8192 },
] })
test('S0 support snapshot preserves all local driver import dependencies', async () => {
  const files = ocgSupportFiles('s0')
  for (const item of ['real-model/driver.mjs', 'real-model/fixture.mjs', 'real-model/read-completed-recovery.mjs']) assert.ok(files.includes(item), item)
  for (const item of files) await readFile(new URL('../scripts/host-acceptance/' + item, import.meta.url))
  assert.equal(new Set(files).size, files.length)
  assert.throws(() => ocgSupportFiles('arbitrary-script'))
})
test('workflow can use a measured three hour finite deadline without enlarging smoke or pool deadlines', () => {
  assert.equal(ocgTimeoutMs('10800000', 'workflow'), 10800000)
  assert.equal(ocgTimeoutMs('7200000', 'workflow'), 7200000)
  assert.equal(ocgTimeoutMs('900000', 'workflow'), 900000)
  for (const scenario of ['pool', 's0', 'knowledge']) assert.throws(() => ocgTimeoutMs('7200000', scenario))
  for (const value of ['999', '10800001', 'Infinity']) assert.throws(() => ocgTimeoutMs(value, 'workflow'))
})
test('OCG bootstrap refuses unrelated provider, origin, inline secrets and unconfigured model identities', () => {
  assert.equal(normalizeOcgBootstrap(bootstrap()).providerConfig.apiKeyEnv, 'OPENCODE_GO_API_KEY')
  for (const mutate of [value => { value.provider = 'other' }, value => { value.allowedOrigins = ['https://other.example'] }, value => { value.providerConfig.apiKey = 'secret' }, value => { value.routes[1].model = 'missing' }, value => { value.providerConfig.baseURL = 'https://other.example/v1' }]) {
    const value = bootstrap(); mutate(value); assert.throws(() => normalizeOcgBootstrap(value))
  }
})
test('isolated CLI environment never inherits daily homes, credentials or Node preload options', () => {
  const env = makeOcgEnvironment('/isolated', { PATH: 'path', SystemRoot: 'system', HOME: '/daily', DSH_HOME: '/daily/.dsh', OPENCODE_GO_API_KEY: 'PRIVATE', NODE_OPTIONS: '--require evil', HTTP_PROXY: 'PRIVATE' })
  assert.equal(env.PATH, 'path')
  assert.equal(env.DSH_HOME.replaceAll('\\', '/'), '/isolated/dsh-home')
  assert.equal(env.OPENCODE_GO_API_KEY, undefined)
  assert.equal(env.NODE_OPTIONS, undefined)
  assert.equal(env.HTTP_PROXY, undefined)
  assert.ok(!Object.values(env).some(value => String(value).includes('/daily') || String(value).includes('PRIVATE')))
})
test('native profile assembles the exact multiple model routes, finite gate and real adapter configuration', () => {
  const rows = ocgProfileRows({ runtime: '/runtime', work: '/isolated', installed: '/installed', support: '/support', bootstrap: normalizeOcgBootstrap(bootstrap()), scenario: 'pool', concurrency: 4, maxRequests: 80, timeoutMs: 600000, bundleName: '@dsh-external/dsh-ultra-mode' })
  const adapter = rows.find(row => row[0] === 'ocg-provider')
  assert.equal(adapter[1], '@deepseek-ai/dsh-llm-pi-ai')
  assert.deepEqual(adapter[2].providers['opencode-go'].models, [{ id: 'flash' }, { id: 'glm' }])
  const gate = rows.find(row => row[0] === 'model-stream-gate')[2]
  assert.deepEqual(gate.allowedRoutes, [{ provider: 'opencode-go', model: 'flash' }, { provider: 'opencode-go', model: 'glm' }])
  assert.equal(gate.concurrency, 4); assert.equal(gate.maxRequests, 80); assert.equal(gate.syntheticUsage, false)
  assert.ok(rows.some(row => row[1] === '@deepseek-ai/dsh-subagent-spawn-in-process'))
  assert.ok(rows.some(row => row[1] === '@deepseek-ai/dsh-settings'))
  assert.ok(rows.find(row => row[0] === 'experiment')[1].endsWith('ocg-pool-plugin.mjs'))
})
test('S0 disk verification requires a complete matching native fixture call/result and final turn', () => {
  const sessions = [{ rows: [
    { type: 'session', id: 'root' },
    { type: 'tool/call', seq: 2, data: { name: 'fixture_read', callId: 'read' } },
    { type: 'tool/result', seq: 3, data: { message: { role: 'tool', isError: false, toolCallId: 'read', source: { kind: 'tool', callId: 'read' } } } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ] }]
  assert.equal(verifyOcgNativeSessions(sessions, { requests: [{ sessionId: 'root' }] }, 's0').passed, true)
  sessions[0].rows[2].data.message.source.callId = 'forged'
  assert.equal(verifyOcgNativeSessions(sessions, { requests: [{ sessionId: 'root' }] }, 's0').passed, false)
})
test('S0 launcher keeps the real driver legacy exact-route gate contract', () => {
  const rows = ocgProfileRows({ runtime: '/runtime', work: '/isolated', installed: '/installed', support: '/support', bootstrap: normalizeOcgBootstrap(bootstrap()), scenario: 's0', concurrency: 2, maxRequests: 4, timeoutMs: 180000, bundleName: '@dsh-external/dsh-ultra-mode' })
  const gate = rows.find(row => row[0] === 'model-stream-gate')[2]
  assert.equal(gate.allowedProvider, 'opencode-go')
  assert.equal(gate.allowedModel, 'flash')
  assert.deepEqual(gate.allowedRoutes, [{ provider: 'opencode-go', model: 'flash' }])
  assert.ok(rows.find(row => row[0] === 'experiment')[1].endsWith('real-model/driver.mjs'))
})
test('knowledge launcher uses the single selected real model and a separate thin native plugin', () => {
  const rows = ocgProfileRows({ runtime: '/runtime', work: '/isolated', installed: '/installed', support: '/support', bootstrap: normalizeOcgBootstrap(bootstrap()), scenario: 'knowledge', concurrency: 4, maxRequests: 40, timeoutMs: 600000, bundleName: '@dsh-external/dsh-ultra-memory' })
  assert.ok(rows.find(row => row[0] === 'experiment')[1].endsWith('ocg-knowledge-plugin.mjs'))
  assert.deepEqual(rows.find(row => row[0] === 'model-stream-gate')[2].allowedRoutes, [{ provider: 'opencode-go', model: 'flash' }])
  assert.ok(rows.find(row => row[0] === 'experiment')[2].configFile.endsWith('knowledge-config.json'))
})

test('workflow uses a private 500K catalog window, 420K inclusive soft trigger and preserves the bootstrap snapshot', () => {
  const selected = bootstrap()
  selected.mainModel = 'deepseek-v4.1-flash'
  selected.providerConfig.models.push({ id: selected.mainModel, contextWindow: 1000000 })
  const before = structuredClone(selected)
  const rows = ocgProfileRows({ runtime: '/runtime', work: '/isolated', installed: '/installed', support: '/support', bootstrap: selected, scenario: 'workflow', concurrency: 1, maxRequests: 500, timeoutMs: 3600000, bundleName: '@dsh-external/dsh-ultra-mode', workflow: { cycles: 30, reportRows: 15000, calibrateOnly: false, segmentCycles: 5 } })
  assert.equal(rows.find(row => row[0] === 'ocg-provider')[2].providers['opencode-go'].models.find(model => model.id === selected.mainModel).contextWindow, 500000)
  assert.deepEqual(selected, before)
  const driver = rows.find(row => row[0] === 'experiment')
  assert.ok(driver[1].endsWith('ocg-workflow-plugin.mjs'))
  assert.equal(driver[2].cycles, 30)
  assert.equal(driver[2].reportRows, 15000)
  assert.equal(driver[2].contextWindowTokens, 500000)
  assert.equal(driver[2].compressionTriggerTokens, 420000)
  assert.equal(driver[2].mainEffort, 'low')
  assert.deepEqual(rows.find(row => row[0] === 'model-stream-gate')[2].allowedRoutes, [{ provider: 'opencode-go', model: selected.mainModel }])
  const settings = ocgScenarioSettings('workflow', 'ultra-mode', 3600000)
  assert.equal(settings.contextCompression, true)
  assert.equal(settings.contextTargetTokens, 420000)
  assert.equal(settings.contextRetainRecentMessages, 2)
  assert.equal(settings.contextOutputReserveTokens, 8192)
  assert.equal(settings.contextToolReserveTokens, 2048)
  assert.equal(settings.decisionAssistEnabled, false)
  assert.equal(settings.collaborationEnabled, false)
  assert.equal(settings.memoryMaxTokens, undefined, 'run resource budget must not be mistaken for a context window')
  assert.equal(ocgScenarioSettings('pool', 'ultra-mode', 600000).contextCompression, false)
  assert.deepEqual(ocgSupportFiles('workflow'), ['real-model-global-limit.mjs', 'ocg-network-guard.cjs', 'ocg-workflow-plugin.mjs', 'workflow-fixture.mjs', 'archive-proof.mjs', 'recovery-policy.mjs'])
})

const workflowRows = (selected, workflow = {}, scenario = 'workflow') => ocgProfileRows({ runtime: '/runtime', work: '/isolated', installed: '/installed', support: '/support', bootstrap: selected, scenario, concurrency: 1, maxRequests: 500, timeoutMs: 3600000, bundleName: '@dsh-external/dsh-ultra-mode', workflow: { cycles: 30, reportRows: 12000, calibrateOnly: false, segmentCycles: 5, ...workflow } })

test('explicit workflow transport retries install only the official executor and replace a copied provider policy exactly', () => {
  for (const retries of [1, 2, '1', '2']) {
    const selected = bootstrap()
    selected.providerConfig.retryPolicy = { mode: 'always', retryableCodes: ['SERVER', 'TIMEOUT'], backoff: { initialDelayMs: 5, maxDelayMs: 90000, jitterRatio: 1 } }
    const original = structuredClone(selected)
    const rows = workflowRows(selected, { transportRetries: retries, fixtureSeed: 'transport-explicit-' + retries })
    assert.deepEqual(rows.find(row => row[0] === 'llm-retry'), ['llm-retry', '@deepseek-ai/dsh-llm-retry'])
    assert.deepEqual(rows.find(row => row[0] === 'ocg-provider')[2].providers['opencode-go'].retryPolicy, {
      mode: 'normal', maxRetries: Number(retries), retryableCodes: ['TRANSPORT'], backoff: { initialDelayMs: 1000, maxDelayMs: 3000, jitterRatio: 0 },
    })
    assert.deepEqual(selected, original, 'Frozen bootstrap and its original always policy stay unchanged')
    assert.equal(rows.find(row => row[0] === 'experiment')[2].transportRetries, undefined, 'Launcher policy is not a workflow controller option')
  }
})

test('omitted or zero workflow retries preserve provider policy without installing a retry executor', () => {
  for (const retries of [undefined, 0, '0']) for (const existing of [undefined, { mode: 'normal', maxRetries: 7, retryableCodes: ['SERVER'] }]) {
    const selected = bootstrap()
    if (existing) selected.providerConfig.retryPolicy = structuredClone(existing)
    const rows = workflowRows(selected, retries === undefined ? {} : { transportRetries: retries })
    assert.equal(rows.some(row => row[1] === '@deepseek-ai/dsh-llm-retry'), false)
    assert.deepEqual(rows.find(row => row[0] === 'ocg-provider')[2].providers['opencode-go'].retryPolicy, existing)
  }
  for (const scenario of ['s0', 'pool', 'knowledge']) {
    const rows = workflowRows(bootstrap(), {}, scenario)
    assert.equal(rows.some(row => row[1] === '@deepseek-ai/dsh-llm-retry'), false)
    assert.equal(rows.find(row => row[0] === 'ocg-provider')[2].providers['opencode-go'].retryPolicy, undefined)
  }
})

test('transport retry limits reject invalid values and all non-workflow controls before runtime or credential access', async () => {
  for (const retries of [-1, 3, 0.5, '', 'Infinity', '1e0', null, true]) assert.throws(() => workflowRows(bootstrap(), { transportRetries: retries }), /transport retr/iu)
  for (const scenario of ['s0', 'pool', 'knowledge']) assert.throws(() => workflowRows(bootstrap(), { transportRetries: 0 }, scenario), /workflow/iu)
  const required = ['--runtime', '/missing-runtime', '--candidate', '/missing-tgz', '--candidate-sha256', '0'.repeat(64), '--work', '/unused-work', '--bootstrap', '/missing-private-json', '--concurrency', '1', '--max-requests', '100', '--timeout-ms', '1000']
  await assert.rejects(runner.main([...required, '--scenario', 'pool', '--workflow-transport-retries', '0']), /Workflow controls/u)
  await assert.rejects(runner.main([...required, '--scenario', 'workflow', '--workflow-transport-retries', '3']), /transport retr/iu)
})

test('workflow launch receipt records the exact installed retry policy and the actual frozen fixture seed', () => {
  assert.equal(typeof runner.ocgWorkflowLaunchReceipt, 'function')
  for (const retries of [0, 1, 2]) {
    const rows = workflowRows(bootstrap(), { transportRetries: retries, fixtureSeed: 'transport-receipt-' + retries })
    const receipt = runner.ocgWorkflowLaunchReceipt(rows)
    assert.equal(receipt.fixtureSeed, rows.find(row => row[0] === 'experiment')[2].fixtureSeed)
    assert.equal(receipt.fixtureSeed, 'transport-receipt-' + retries)
    assert.equal(receipt.transportRetries, retries)
    assert.equal(receipt.retryPluginEnabled, retries > 0)
    assert.deepEqual(receipt.retryPolicy, rows.find(row => row[0] === 'ocg-provider')[2].providers['opencode-go'].retryPolicy ?? null)
    if (receipt.retryPolicy) { receipt.retryPolicy.retryableCodes.push('SERVER'); assert.deepEqual(rows.find(row => row[0] === 'ocg-provider')[2].providers['opencode-go'].retryPolicy.retryableCodes, ['TRANSPORT']) }
  }
  const rows = workflowRows(bootstrap())
  assert.match(runner.ocgWorkflowLaunchReceipt(rows).fixtureSeed, /^workflow-[a-f0-9-]+$/u)
})

test('launcher help describes the stable workflow seed and opt-in finite transport retries', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/host-acceptance/run-ocg-profile.mjs', import.meta.url)), '--help'], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /--workflow-seed <[^>]+>/u)
  assert.match(result.stdout, /--workflow-transport-retries <0\.\.2>/u)
  assert.match(result.stdout, /default 0/u)
})
