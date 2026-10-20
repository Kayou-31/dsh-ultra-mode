/** Explicit, finite OCG online acceptance; never reads the daily profile. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { claimFreshWork, assertArchiveEntry } from './run-decision-loop-profile.mjs'
import { normalizeLiveConfig } from './model-pool-live-driver.mjs'
import { collectOcgPoolPhase } from './ocg-pool-plugin.mjs'
import { judgeOcgKnowledge } from './ocg-knowledge-plugin.mjs'

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const slash = value => value.replaceAll('\\', '/')
/** Exact local dependency closure frozen beside an isolated runner. */
export function ocgSupportFiles(scenario) {
  const common = ['real-model-global-limit.mjs', 'ocg-network-guard.cjs']
  if (scenario === 'workflow') return [...common, 'ocg-workflow-plugin.mjs', 'workflow-fixture.mjs', 'archive-proof.mjs', 'recovery-policy.mjs']
  if (scenario === 's0') return [...common, 'real-model/driver.mjs', 'real-model/fixture.mjs', 'real-model/read-completed-recovery.mjs']
  if (scenario === 'pool' || scenario === 'knowledge') return [...common, 'ocg-pool-plugin.mjs', 'companion-decision-plugin.mjs', 'model-pool-live-driver.mjs', ...(scenario === 'knowledge' ? ['ocg-knowledge-plugin.mjs', 'knowledge-profile-plugin.mjs'] : [])]
  throw new Error('Unsupported exact acceptance scenario')
}
function workflowCompressionProfile(value = 'baseline') {
  if (!['baseline', 'efficient', 'archive-130k'].includes(value)) throw new Error('Workflow compression profile must be baseline, efficient or archive-130k')
  return value
}
export function ocgScenarioSettings(scenario, settingsId, timeoutMs, compressionProfile = 'baseline') {
  const profile = workflowCompressionProfile(compressionProfile)
  if (scenario !== 'workflow' && profile !== 'baseline') throw new Error('Workflow compression profile requires the exact workflow scenario')
  return { ...(settingsId === 'ultra-memory' ? {} : { decisionAssistEnabled: false, collaborationEnabled: false, timeoutMs, researchTools: ['fixture_read', 'ultra_memory_search', 'ultra_memory_get'] }), evidenceEnabled: true,
    contextCompression: scenario === 'workflow', ...(scenario === 'workflow' ? { contextTargetTokens: 420000, contextRetainRecentMessages: 2, contextOutputReserveTokens: 8192, contextToolReserveTokens: 2048, ...(profile === 'efficient' ? { contextTriggerTokens: 420000, contextTargetTokens: 30000, contextMinResultChars: 64, contextMaxPrunes: 256, contextPreviewChars: 0, contextCompactLocators: true, contextRetrievalReceipts: true } : profile === 'archive-130k' ? { contextTriggerTokens: 420000, contextTargetTokens: 30000, contextMinResultChars: 4096, contextMaxPrunes: 16, contextPreviewChars: 0, contextCompactLocators: true, contextRetrievalReceipts: true, contextArchiveCompletedTurns: true } : {}) } : {}) }
}
export function verifyOcgNativeSessions(sessions, result, scenario) {
  const byId = new Map(sessions.map(session => [session.rows.find(row => row.type === 'session')?.id, session.rows]))
  if (scenario === 'knowledge') {
    const eventsA = byId.get(result.roots?.A) ?? [], eventsB = byId.get(result.roots?.B) ?? []
    if ([eventsA, eventsB].some(events => events.findLast(row => row.type === 'turn/end')?.data?.reason?.kind !== 'completed')) return { passed: false, reason: 'native-A-B-completion-required' }
    return judgeOcgKnowledge({ A: { id: result.roots.A, events: eventsA }, B: { id: result.roots.B, events: eventsB }, expected: result.expected, requests: result.requests, deniedC: result.deniedC })
  }
  if (scenario === 'pool') {
    if (!Array.isArray(result.phaseProofs) || result.phaseProofs.length !== 3) return { passed: false, reason: 'three-native-phases-required' }
    const checks = result.phaseProofs.map(proof => {
      const rootEvents = byId.get(proof.rootId) ?? []
      const completed = rootEvents.findLast(row => row.type === 'turn/end')?.data?.reason?.kind === 'completed'
      const collected = collectOcgPoolPhase({ rootId: proof.rootId, rootEvents, children: byId, route: proof.route, expectedSelectedRoute: proof.expectedSelectedRoute, challenge: proof.challenge, requests: result.requests, toolCalls: result.toolCalls })
      return { rootId: proof.rootId, passed: completed && collected.audit.passed, audit: collected.audit }
    })
    return { passed: checks.every(check => check.passed), checks }
  }
  const ids = [...new Set((result.requests ?? []).map(row => row.sessionId))]
  if (ids.length !== 1) return { passed: false, reason: 'one-native-root-required' }
  const rows = byId.get(ids[0]) ?? [], calls = new Map(rows.filter(row => row.type === 'tool/call' && row.data?.name === 'fixture_read').map(row => [row.data.callId, row]))
  const paired = rows.some(row => {
    const message = row.data?.message, call = calls.get(message?.toolCallId)
    return row.type === 'tool/result' && message?.role === 'tool' && message.isError === false && call && row.seq > call.seq && message.source?.kind === 'tool' && message.source.callId === message.toolCallId
  })
  return { passed: paired && rows.findLast(row => row.type === 'turn/end')?.data?.reason?.kind === 'completed', rootId: ids[0] }
}
function integer(value, maximum, name) {
  const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error('Invalid finite ' + name)
  return number
}
function workflowTransportRetries(value = 0) {
  const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(number) || number < 0 || number > 2) throw new Error('Workflow transport retries must be an integer within 0..2')
  return number
}
/** Explicitly bounded full-workflow run; other experiments keep their existing cap. */
export function ocgTimeoutMs(value, scenario) {
  const deadline = integer(value, scenario === 'workflow' ? 10800000 : 3600000, 'deadline')
  if (deadline < 1000) throw new Error('Acceptance deadline must be at least 1000ms')
  return deadline
}
export function normalizeOcgBootstrap(input) {
  if (!input || typeof input !== 'object' || input.provider !== 'opencode-go' || !input.providerConfig || !Array.isArray(input.allowedOrigins) || input.allowedOrigins.length !== 1 || input.allowedOrigins[0] !== 'https://opencode.ai') throw new Error('Only the explicitly authorized OCG origin/provider is permitted')
  if (input.providerConfig.apiKeyEnv !== 'OPENCODE_GO_API_KEY' || typeof input.credentialFile !== 'string' || !input.credentialFile || typeof input.mainModel !== 'string' || !input.mainModel) throw new Error('Selected credential reference, private credential file and model are required')
  const inspect = value => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(inspect); return }
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:apiKey|token|authorization|headers|password|secret)$/iu.test(key)) throw new Error('Inline credential/authentication fields are forbidden in provider metadata')
      if (/^(?:url|baseURL|baseUrl)$/u.test(key) && (typeof item !== 'string' || new URL(item).origin !== 'https://opencode.ai')) throw new Error('Provider endpoint is outside the explicit OCG origin')
      inspect(item)
    }
  }
  inspect(input.providerConfig)
  const models = input.providerConfig.models
  if (!Array.isArray(models) || !models.length || models.some(model => !model || typeof model.id !== 'string' || !model.id)) throw new Error('Exact configured native models are required')
  const ids = new Set(models.map(model => model.id))
  if (ids.size !== models.length || !ids.has(input.mainModel)) throw new Error('Duplicate or unavailable main model')
  if (input.routes !== undefined && (!Array.isArray(input.routes) || input.routes.some(route => route.provider !== input.provider || !ids.has(route.model)))) throw new Error('Candidate identity is outside selected native provider models')
  return structuredClone(input)
}
export function makeOcgEnvironment(work, original = process.env) {
  const env = {}
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'TZ']) if (original[key]) env[key] = original[key]
  for (const key of ['HOME', 'USERPROFILE']) env[key] = path.join(work, 'os-home')
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME']) env[key] = path.join(work, 'os-home', key.toLowerCase())
  for (const key of ['TEMP', 'TMP', 'TMPDIR']) env[key] = path.join(work, 'temp')
  return { ...env, DSH_HOME: path.join(work, 'dsh-home'), DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', ULTRA_ACCEPTANCE_NETWORK_LOG: path.join(work, 'network-denials.jsonl'), ULTRA_ACCEPTANCE_ALLOWED_ORIGINS: '["https://opencode.ai"]' }
}
export function ocgProfileRows({ runtime, work, installed, support, bootstrap, scenario, concurrency, maxRequests, timeoutMs, bundleName, workflow }) {
  const home = path.join(work, 'dsh-home'), projectDir = path.join(work, 'project'), presetId = 'ocg'
  const providerConfig = structuredClone(bootstrap.providerConfig)
  if (scenario !== 'workflow' && workflow && Object.hasOwn(workflow, 'transportRetries')) throw new Error('Workflow transport retries require the exact workflow scenario')
  const { transportRetries: retryControl, ...workflowConfig } = workflow ?? {}
  if (scenario !== 'workflow' && workflow && Object.hasOwn(workflow, 'compressionProfile')) throw new Error('Workflow compression profile requires the exact workflow scenario')
  if (scenario === 'workflow') workflowConfig.compressionProfile = workflowCompressionProfile(workflowConfig.compressionProfile)
  if (scenario === 'workflow') workflowConfig.reportTargetInputTokens = workflowConfig.compressionProfile === 'efficient' || workflowConfig.compressionProfile === 'archive-130k' ? 445000 : 430000
  if (scenario === 'workflow' && workflowConfig.compressionProfile === 'archive-130k') { if (concurrency !== 1 || maxRequests > 900) throw new Error('C requires one Flash route and at most 900 streams'); workflowConfig.postCompressionCapTokens = 130000 }
  const transportRetries = scenario === 'workflow' ? workflowTransportRetries(retryControl) : 0
  if (scenario === 'workflow') {
    const selected = providerConfig.models.find(model => model.id === bootstrap.mainModel)
    if (!selected) throw new Error('Workflow selected model is not configured')
    selected.contextWindow = 500000
    if (transportRetries > 0) providerConfig.retryPolicy = { mode: 'normal', maxRetries: transportRetries, retryableCodes: ['TRANSPORT'], backoff: { initialDelayMs: 1000, maxDelayMs: 3000, jitterRatio: 0 } }
    workflowConfig.fixtureSeed ??= 'workflow-' + crypto.randomUUID()
  }
  const routes = [...new Map([{ provider: bootstrap.provider, model: bootstrap.mainModel }, ...(scenario === 'pool' ? bootstrap.routes : [])].map(route => [JSON.stringify([route.provider, route.model]), { provider: route.provider, model: route.model }])).values()]
  const driver = scenario === 'workflow' ? ['ocg-workflow-plugin.mjs', { runtimeRoot: runtime, ultraRoot: installed, projectDir, resultFile: path.join(work, 'result.json'), stateFile: path.join(work, 'state.json'), provider: bootstrap.provider, model: bootstrap.mainModel, mainEffort: 'low', maxTokens: 8192, maxRequests, timeoutMs, presetId, sessionId: 'ocg-workflow-' + crypto.randomUUID(), contextWindowTokens: 500000, compressionTriggerTokens: 420000, ...workflowConfig }]
    : scenario === 'pool' || scenario === 'knowledge' ? [scenario === 'pool' ? 'ocg-pool-plugin.mjs' : 'ocg-knowledge-plugin.mjs', { runtimeRoot: runtime, ultraRoot: installed, configFile: path.join(work, scenario + '-config.json'), resultFile: path.join(work, 'result.json') }]
    : ['real-model/driver.mjs', { runtimeRoot: runtime, ultraRoot: installed, projectDir, resultFile: path.join(work, 'result.json'), stateFile: path.join(work, 'state.json'), mode: 's0', presetId, provider: bootstrap.provider, model: bootstrap.mainModel, mainEffort: bootstrap.mainEffort ?? 'high', sessionId: 'ocg-' + crypto.randomUUID(), maxTokens: 8192, maxRequests, timeoutMs, streamConcurrency: concurrency }]
  return [
    ['timer', '@deepseek-ai/cordis-plugin-timer'], ['llm', '@deepseek-ai/dsh-llm'], ['session', '@deepseek-ai/dsh-session'], ['system-prompt', '@deepseek-ai/dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }],
    ['tools', '@deepseek-ai/dsh-tools', { mode: 'native' }], ['agent', '@deepseek-ai/dsh-agent'], ['session-projection', '@deepseek-ai/dsh-session-projection'], ['token-meter', '@deepseek-ai/dsh-token-meter'],
    ['agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry', { default: presetId }], ['ocg-preset', '@deepseek-ai/dsh-agent-preset', { id: presetId, plugins: [] }], ['agent-loop', '@deepseek-ai/dsh-agent-loop', { agents: [] }],
    ['sessions', '@deepseek-ai/dsh-session-persistence-jsonl', { root: path.join(home, 'sessions'), compression: 'none' }], ['session-query', '@deepseek-ai/dsh-session-query'], ['commands', '@deepseek-ai/dsh-commands'],
    ['config-editor', '@deepseek-ai/dsh-config-editor'], ['settings', '@deepseek-ai/dsh-settings'], ['fs-local', '@deepseek-ai/dsh-fs-local'], ['working-directory', '@deepseek-ai/dsh-working-directory', { defaultDirectory: projectDir }],
    ['subagents', '@deepseek-ai/dsh-subagent', { maxDepth: 1, maxActiveSubagents: concurrency }], ['spawn', '@deepseek-ai/dsh-subagent-spawn-in-process', { providerName: 'spawn' }],
    ['credentials', '@deepseek-ai/dsh-credentials-local', { dshHome: home }], ...(transportRetries > 0 ? [['llm-retry', '@deepseek-ai/dsh-llm-retry']] : []), ['ocg-provider', '@deepseek-ai/dsh-llm-pi-ai', { providers: { [bootstrap.provider]: providerConfig } }],
    ['model-stream-gate', slash(path.join(support, 'real-model-global-limit.mjs')), { testRoot: work, logFile: path.join(work, 'model-streams.jsonl'), ...(scenario === 's0' ? { allowedProvider: bootstrap.provider, allowedModel: bootstrap.mainModel } : {}), allowedRoutes: routes, concurrency, maxRequests, syntheticUsage: false }],
    ['experiment', slash(path.join(support, driver[0])), driver[1]],
  ]
}

/** Record the actual assembled provider policy and project seed, rather than just CLI intent. */
export function ocgWorkflowLaunchReceipt(rows) {
  const driver = rows.find(row => row[0] === 'experiment')?.[2]
  const provider = rows.find(row => row[0] === 'ocg-provider')?.[2]?.providers?.[driver?.provider]
  if (!driver?.fixtureSeed || !provider) throw new Error('Workflow launch receipt requires the assembled driver and provider')
  const retryPluginEnabled = rows.some(row => row[1] === '@deepseek-ai/dsh-llm-retry')
  return { fixtureSeed: driver.fixtureSeed, compressionProfile: driver.compressionProfile ?? 'baseline', compressionSettings: ocgScenarioSettings('workflow', 'ultra-mode', driver.timeoutMs, driver.compressionProfile), reportTargetInputTokens: driver.reportTargetInputTokens ?? 430000, transportRetries: retryPluginEnabled ? provider.retryPolicy.maxRetries : 0, retryPluginEnabled, retryPolicy: structuredClone(provider.retryPolicy ?? null) }
}

function privateDirectory(work) {
  if (process.platform !== 'win32') { fs.chmodSync(work, 0o700); return }
  const user = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).stdout?.match(/S-1-\d+(?:-\d+)+/u)?.[0]
  if (!user) throw new Error('Cannot determine current Windows identity for private acceptance ACL')
  const response = spawnSync('icacls', [work, '/inheritance:r', '/grant:r', '*' + user + ':(OI)(CI)F', '/T', '/Q'], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  if (response.status !== 0) throw new Error('Cannot establish private acceptance directory ACL')
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: { runtime: { type: 'string' }, candidate: { type: 'string' }, 'candidate-sha256': { type: 'string' }, work: { type: 'string' }, bootstrap: { type: 'string' }, node: { type: 'string' }, scenario: { type: 'string', default: 'pool' }, concurrency: { type: 'string' }, 'max-requests': { type: 'string' }, 'timeout-ms': { type: 'string' }, 'workflow-cycles': { type: 'string' }, 'workflow-report-rows': { type: 'string' }, 'workflow-segment-cycles': { type: 'string' }, 'workflow-calibration-file': { type: 'string' }, 'workflow-seed': { type: 'string' }, 'workflow-transport-retries': { type: 'string' }, 'workflow-compression-profile': { type: 'string' }, 'workflow-calibrate-only': { type: 'boolean' }, help: { type: 'boolean' } } })
  if (values.help) { console.log('Usage: node run-ocg-profile.mjs --runtime <official-0.2.1-rc.2> --candidate <tgz> --candidate-sha256 <sha256> --work <NEW-empty-short-path> --bootstrap <private-json> --scenario pool|s0|knowledge|workflow --concurrency <1..32> --max-requests <1..1000> --timeout-ms <1000..3600000; workflow up to 10800000> [--node <executable>] [--workflow-cycles <1..30> --workflow-report-rows <8..12000> --workflow-segment-cycles <1..30> --workflow-seed <stable-id> --workflow-compression-profile <baseline|efficient|archive-130k> (default baseline) --workflow-transport-retries <0..2> (default 0; TRANSPORT only) --workflow-calibrate-only | --workflow-calibration-file <prior-private-result.json>]'); return }
  for (const key of ['runtime', 'candidate', 'candidate-sha256', 'work', 'bootstrap', 'concurrency', 'max-requests', 'timeout-ms']) if (!values[key]) throw new Error('Missing --' + key)
  if (!['pool', 's0', 'knowledge', 'workflow'].includes(values.scenario)) throw new Error('Unsupported exact acceptance scenario')
  const workflow = values.scenario === 'workflow' ? { compressionProfile: workflowCompressionProfile(values['workflow-compression-profile']), transportRetries: workflowTransportRetries(values['workflow-transport-retries'] ?? 0), cycles: integer(values['workflow-cycles'] ?? 30, 30, 'workflow cycles'), reportRows: integer(values['workflow-report-rows'] ?? 12000, 12000, 'workflow report rows'), segmentCycles: integer(values['workflow-segment-cycles'] ?? (values['workflow-calibrate-only'] ? 1 : 30), 30, 'workflow segment cycles'), calibrateOnly: values['workflow-calibrate-only'] === true, ...(values['workflow-calibration-file'] ? { calibrationFile: fs.realpathSync(path.resolve(values['workflow-calibration-file'])) } : {}), ...(values['workflow-seed'] ? { fixtureSeed: values['workflow-seed'] } : {}) } : undefined
  if (workflow && workflow.reportRows < 8) throw new Error('Workflow reports need at least 8 cases')
  if (values.scenario !== 'workflow' && Object.keys(values).some(key => key.startsWith('workflow-'))) throw new Error('Workflow controls require the exact workflow scenario')
  const concurrency = integer(values.concurrency, 32, 'concurrency'), maxRequests = integer(values['max-requests'], 1000, 'request budget'), timeoutMs = ocgTimeoutMs(values['timeout-ms'], values.scenario)
  if (!/^[a-f0-9]{64}$/u.test(values['candidate-sha256'])) throw new Error('Exact lowercase candidate SHA256 is required')
  const runtime = fs.realpathSync(path.resolve(values.runtime)), candidate = fs.realpathSync(path.resolve(values.candidate)), bootstrapPath = fs.realpathSync(path.resolve(values.bootstrap)), executable = values.node ? fs.realpathSync(values.node) : process.execPath
  if (hash(candidate) !== values['candidate-sha256']) throw new Error('Frozen candidate SHA256 mismatch')
  const bootstrap = normalizeOcgBootstrap(readJson(bootstrapPath)), credentialFile = fs.realpathSync(path.resolve(bootstrap.credentialFile)), requireRuntime = createRequire(path.join(runtime, 'package.json'))
  const pinned = ['dsh', 'dsh-app-boot', 'dsh-agent', 'dsh-agent-loop', 'dsh-session', 'dsh-scope', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-preset-registry', 'dsh-agent-preset', 'dsh-session-persistence-jsonl', 'dsh-session-query', 'dsh-commands', 'dsh-config-editor', 'dsh-settings', 'dsh-fs-local', 'dsh-working-directory', 'dsh-subagent', 'dsh-subagent-spawn-in-process', 'dsh-llm-pi-ai', 'dsh-credentials-local', ...(workflow?.transportRetries > 0 ? ['dsh-llm-retry'] : [])]
  const versions = {}
  for (const name of pinned) { const file = path.join(runtime, 'node_modules/@deepseek-ai', name, 'package.json'), manifest = readJson(file); if (manifest.version !== '0.2.1-rc.2' || manifest.name !== '@deepseek-ai/' + name) throw new Error('Official pinned native runtime is required: ' + name); versions[name] = { version: manifest.version, manifestSha256: hash(file) } }
  const { work } = claimFreshWork(values.work, [runtime, candidate, bootstrapPath, credentialFile, os.homedir(), process.env.DSH_HOME]); privateDirectory(work)
  const mkdir = relative => { const file = path.join(work, relative); fs.mkdirSync(file, { recursive: true, mode: 0o700 }); return file }
  const write = (relative, value) => fs.writeFileSync(path.join(work, relative), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  const started = Date.now(); let child
  try {
    const home = mkdir('dsh-home'), projectDir = mkdir('project'), profileName = 'ocg-independent', profileDir = mkdir('dsh-home/profiles/' + profileName), support = mkdir('support')
    const env = makeOcgEnvironment(work)
    for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TEMP', 'TMP', 'TMPDIR']) fs.mkdirSync(env[key], { recursive: true, mode: 0o700 })
    const nodeVersion = spawnSync(executable, ['--version'], { env, windowsHide: true, encoding: 'utf8', timeout: 10000 }), version = /^v(\d+)\.(\d+)\./u.exec(nodeVersion.stdout?.trim() ?? '')
    if (nodeVersion.status !== 0 || !version || !(+version[1] >= 24 || +version[1] === 22 && +version[2] >= 19)) throw new Error('Node >=24 or >=22.19 is required')
    const tar = args => { const response = spawnSync('tar', args, { env, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 }); if (response.status !== 0 || response.error) throw new Error('Candidate archive operation failed'); return response.stdout }
    const snapshot = path.join(work, 'candidate.tgz'); fs.copyFileSync(candidate, snapshot, fs.constants.COPYFILE_EXCL)
    if (hash(snapshot) !== values['candidate-sha256']) throw new Error('Copied candidate SHA256 changed')
    const entries = tar(['-tzf', snapshot]).split(/\r?\n/u).filter(Boolean); entries.forEach(assertArchiveEntry)
    if (!entries.length || tar(['-tvzf', snapshot]).split(/\r?\n/u).filter(Boolean).some(line => !/^[d-]/u.test(line))) throw new Error('Candidate archive links/special files are forbidden')
    // Read the package identity without trusting it as a destination path.
    const probe = mkdir('candidate-unpack'); tar(['-xzf', snapshot, '--strip-components=1', '-C', probe])
    const manifest = readJson(path.join(probe, 'package.json'))
    if (!['@dsh-external/dsh-ultra-mode', '@dsh-external/dsh-ultra-decision', ...(values.scenario === 'knowledge' ? ['@dsh-external/dsh-ultra-memory'] : [])].includes(manifest.name) || manifest.main !== './lib/index.js' || manifest.dsh?.bundle?.patch !== './cordis.patch.yml' || ['s0', 'workflow'].includes(values.scenario) && manifest.name !== '@dsh-external/dsh-ultra-mode') throw new Error('Unsupported exact candidate identity/entry for the selected scenario')
    const installed = path.join(profileDir, 'node_modules', ...manifest.name.split('/')); fs.mkdirSync(path.dirname(installed), { recursive: true }); fs.renameSync(probe, installed)
    const yaml = requireRuntime('js-yaml'); let selectedCredentials
    try { selectedCredentials = yaml.load(fs.readFileSync(credentialFile, 'utf8')) } catch { throw new Error('Cannot parse selected private credential document') }
    const refs = selectedCredentials?.refs, ref = bootstrap.providerConfig.apiKeyEnv
    if (selectedCredentials?.version !== 1 || !refs || Object.keys(refs).length !== 1 || typeof refs[ref] !== 'string' || !refs[ref].trim() || Object.keys(selectedCredentials).some(key => !['version', 'refs'].includes(key))) throw new Error('Credential input must contain exactly the one selected reference, not a daily credential store')
    fs.writeFileSync(path.join(home, '.credentials.yaml'), yaml.dump({ version: 1, refs: { [ref]: refs[ref] } }), { mode: 0o600 })
    selectedCredentials = undefined
    const source = path.dirname(fileURLToPath(import.meta.url)), supportFiles = ocgSupportFiles(values.scenario)
    for (const relative of supportFiles) { const target = path.join(support, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(source, relative), target, fs.constants.COPYFILE_EXCL) }
    const settingsId = manifest.name.endsWith('-decision') ? 'ultra-decision' : manifest.name.endsWith('-memory') ? 'ultra-memory' : 'ultra-mode'
    if (values.scenario === 'pool') write('pool-config.json', { ...normalizeLiveConfig({ runtimeRoot: runtime, ultraRoot: installed, projectDir, resultFile: path.join(work, 'result.json'), provider: bootstrap.provider, model: bootstrap.mainModel, routes: bootstrap.routes, maxConcurrent: concurrency, maxRequests }), presetId: 'ocg', sessionId: 'ocg-pool-' + crypto.randomUUID(), mainEffort: bootstrap.mainEffort ?? 'high', mainMaxTokens: 8192, timeoutMs, bundleName: manifest.name, settingsId })
    const projects = values.scenario === 'knowledge' ? Object.fromEntries(['A', 'B', 'C'].map(id => [id, mkdir('project' + id)])) : undefined
    const globalKnowledge = projects ? { enabled: true, projects: [{ id: 'A', root: projects.A, read: true, publish: true, shareWith: ['B'] }, { id: 'B', root: projects.B, read: true, publish: false, shareWith: [] }], maxSearchChars: 6000, maxGetChars: 12000 } : undefined
    if (projects) write('knowledge-config.json', { projects, provider: bootstrap.provider, model: bootstrap.mainModel, mainEffort: bootstrap.mainEffort ?? 'high', maxConcurrent: concurrency, maxRequests, timeoutMs, bundleName: manifest.name, settingsId })
    const rows = ocgProfileRows({ runtime, work, installed, support, bootstrap, scenario: values.scenario, concurrency, maxRequests, timeoutMs, bundleName: manifest.name, workflow })
    write('dsh-home/profiles/' + profileName + '/package.json', { name: 'ocg-explicit-independent-acceptance', private: true, type: 'module', dependencies: { [manifest.name]: manifest.version }, dsh: { profile: { bundles: [manifest.name] } } })
    write('dsh-home/profiles/' + profileName + '/cordis.patch.yml', [{ insert: rows.map(([id, name, config]) => ({ id, name, ...(config ? { config } : {}) })) }, { id: settingsId, config: { ...ocgScenarioSettings(values.scenario, settingsId, timeoutMs, workflow?.compressionProfile), ...(globalKnowledge ? { globalKnowledge } : {}) } }])
    const cli = path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), cliArgs = ['--expose-internals', '--require', path.join(support, 'ocg-network-guard.cjs'), cli, '--profile', profileName]
    const receipt = { scenario: values.scenario, ...(workflow ? { workflow: { cycles: workflow.cycles, maxReportRows: workflow.reportRows, segmentCycles: workflow.segmentCycles, calibrateOnly: workflow.calibrateOnly, contextCapTokens: 500000, compressionTriggerEnvelopeTokens: 420000, calibrationSha256: workflow.calibrationFile ? hash(workflow.calibrationFile) : null, ...ocgWorkflowLaunchReceipt(rows) } } : {}), candidate: { name: manifest.name, version: manifest.version, sha256: hash(snapshot) }, sdk: '0.2.1-rc.2', versions, cliSha256: hash(cli), runnerSha256: hash(fileURLToPath(import.meta.url)), support: supportFiles.map(file => ({ path: file, sha256: hash(path.join(support, file)) })), allowedOrigins: bootstrap.allowedOrigins, concurrency, maxRequests, timeoutMs, dailyWrites: false, credentialHandling: 'Selected reference copied only to the isolated private home; never exported', environmentNames: Object.keys(env).sort(), startedAt: new Date().toISOString() }
    write('launch.json', receipt)
    const stdout = fs.openSync(path.join(work, 'stdout-private.log'), 'wx'), stderr = fs.openSync(path.join(work, 'stderr-private.log'), 'wx')
    try { child = spawn(executable, cliArgs, { cwd: projectDir, env, windowsHide: true, stdio: ['ignore', stdout, stderr] }) } finally { fs.closeSync(stdout); fs.closeSync(stderr) }
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs + 30000)
    let termination; try { termination = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) }) } finally { clearTimeout(timer) }
    const result = fs.existsSync(path.join(work, 'result.json')) ? readJson(path.join(work, 'result.json')) : undefined
    const sessions = []
    const scan = directory => {
      if (!fs.existsSync(directory)) return
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name)
        if (item.isSymbolicLink()) throw new Error('Native session inventory refuses links')
        if (item.isDirectory()) scan(file)
        else if (item.isFile() && item.name.endsWith('.jsonl')) sessions.push({ path: slash(path.relative(work, file)), sha256: hash(file), rows: fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)) })
      }
    }
    scan(path.join(home, 'sessions'))
    const assembledWorkflow = values.scenario === 'workflow' ? (await import('./ocg-workflow-plugin.mjs')).normalizeWorkflowConfig(rows.find(row => row[0] === 'experiment')[2]) : null
    const expectedRequestBudget = assembledWorkflow ? { maxTokens: assembledWorkflow.maxTokens, outputReserveTokens: assembledWorkflow.outputReserveTokens, toolReserveTokens: assembledWorkflow.toolReserveTokens } : undefined
    const nativeDiskVerification = values.scenario === 'workflow' ? await (await import('./ocg-workflow-plugin.mjs')).judgeOcgWorkflowWithArchives({ compressionProfile: assembledWorkflow.compressionProfile, expectedRequestBudget, projectDir, ultraRoot: installed, runtimeRoot: runtime, events: sessions.flatMap(session => session.rows.find(row => row.type === 'session')?.id === result?.sessionId ? session.rows : []), result: result ?? {} }) : verifyOcgNativeSessions(sessions, result ?? {}, values.scenario)
    write('native-session-inventory.json', { verification: nativeDiskVerification, sessions: sessions.map(session => ({ path: session.path, sha256: session.sha256, sessionId: session.rows.find(row => row.type === 'session')?.id, records: session.rows.length })) })
    const denials = fs.existsSync(env.ULTRA_ACCEPTANCE_NETWORK_LOG) ? fs.readFileSync(env.ULTRA_ACCEPTANCE_NETWORK_LOG, 'utf8').split(/\r?\n/u).filter(Boolean).length : 0
    const calibration = values.scenario === 'workflow' && workflow.calibrateOnly
    const passed = !timedOut && termination.code === 0 && result?.status === (calibration ? 'calibrated' : 'passed') && nativeDiskVerification.passed && denials === 0 && hash(snapshot) === values['candidate-sha256']
    const outcome = { passed, ...(values.scenario === 'workflow' ? { calibration, acceptancePassed: !calibration && passed && result?.completedIndependentCycles >= 30 } : {}), scenario: values.scenario, ...termination, timedOut, networkDenials: denials, nativeDiskVerified: nativeDiskVerification.passed, resultStatus: result?.status ?? 'missing', observedRequests: result?.requests?.length ?? null, candidateSha256: hash(snapshot), elapsedMs: Date.now() - started, concurrency, maxRequests }
    write('outcome.json', outcome); write('launch.json', { ...receipt, ...termination, timedOut, finishedAt: new Date().toISOString() }); console.log(JSON.stringify({ work, ...outcome }, null, 2)); if (!outcome.passed) process.exitCode = 1
    return outcome
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    write('runner-error.json', { errorName: error?.name ?? 'Error', code: error?.code ?? null, elapsedMs: Date.now() - started }); throw error
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch(error => { console.error('OCG_PROFILE_RUNNER_FAILED', error?.name ?? 'Error', error?.code ?? ''); process.exitCode = 1 })
