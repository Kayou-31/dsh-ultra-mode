/** Fresh-only offline native DSH companion acceptance. Never installs a daily profile. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { assertArchiveEntry, claimFreshWork as claimDecisionWork } from './run-decision-loop-profile.mjs'
import { judgeLivePhase } from './model-pool-live-driver.mjs'
import { modelPoolJudgeRecords } from './companion-decision-plugin.mjs'

export { assertArchiveEntry }
export const companionSettingsPlugins = () => [['config-editor', '@deepseek-ai/dsh-config-editor'], ['settings', '@deepseek-ai/dsh-settings']]
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value
function canonical(filename) {
  let current = path.resolve(filename); const tail = []
  while (!fs.existsSync(current)) { tail.unshift(path.basename(current)); current = path.dirname(current) }
  return path.join(fs.realpathSync(current), ...tail)
}
function contains(parent, child) { parent = normalized(canonical(parent)); child = normalized(canonical(child)); return parent === child || child.startsWith(parent + path.sep) }
export function claimFreshWork(filename, forbidden = []) {
  const owner = claimDecisionWork(filename, forbidden), marker = path.join(owner.work, '.companion-decision-acceptance.json')
  fs.renameSync(path.join(owner.work, '.decision-loop-acceptance.json'), marker)
  const next = { ...owner, format: 'dsh-companion-decision-isolated-v1' }
  fs.writeFileSync(marker, JSON.stringify(next, null, 2)); return next
}
export function assertDecisionManifest(manifest) {
  if (manifest.name !== '@dsh-external/dsh-ultra-decision' || !['0.1.0-dev.1', '0.1.0-dev.2', '0.1.0'].includes(manifest.version) || manifest.main !== './lib/index.js' || manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('Exact Decision companion identity/entry is required')
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) if (name.startsWith('@dsh-external/') || /^(?:file:|link:|workspace:|\.\.?[/\\]|[/\\])/u.test(version)) throw new Error('Decision must be self contained without repository or companion dependencies')
}
/** Successful native tool results must match an earlier native call and source. */
export function inspectSessionJsonl(content) {
  const rows = content.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)), calls = new Map(), receipts = []
  for (const row of rows) {
    if (row.type === 'tool/call' && typeof row.data?.callId === 'string') calls.set(row.data.callId, row)
    if (row.type !== 'tool/result') continue
    const message = row.data?.message, call = calls.get(message?.toolCallId)
    if (!call || message.role !== 'tool' || message.source?.kind !== 'tool' || message.source.callId !== message.toolCallId || row.seq <= call.seq || typeof message.isError !== 'boolean') continue
    receipts.push({ name: call.data.name, callId: message.toolCallId, arguments: typeof call.data.arguments === 'string' ? JSON.parse(call.data.arguments) : call.data.arguments, callSeq: call.seq, resultSeq: row.seq, isError: message.isError, text: (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n') })
  }
  const assistant = rows.findLast(row => row.type === 'assistant/message')?.data?.message
  return { sessionId: rows.find(row => row.type === 'session')?.id, records: rows.length, completed: rows.some(row => row.type === 'turn/end' && row.data?.reason?.kind === 'completed'), receipts, finalText: (assistant?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('') }
}
export function assertCompanionInventory(sessions, result, mode) {
  if (mode === 'resume') {
    const root = sessions.find(row => row.sessionId === result.rootId)
    if (!root?.completed || !root.receipts.some(row => row.name === 'fixture_read' && !row.isError)) throw new Error('Cold native resume lacks a successful fixture receipt')
    return true
  }
  if (!Array.isArray(result.phaseProofs) || result.phaseProofs.length !== 2) throw new Error('Two native phase proofs are required')
  if (new Set(result.phaseProofs.map(row => row.rootId)).size !== 2 || new Set(result.phaseProofs.map(row => JSON.stringify([row.route?.provider, row.route?.model]))).size !== 2) throw new Error('Native phase proofs require two distinct roots and provider/model identities')
  for (const proof of result.phaseProofs) {
    const parent = sessions.find(row => row.sessionId === proof.rootId)
    if (!parent?.completed) throw new Error('Required actual native parent completion is missing')
    const spawns = parent.receipts.filter(row => row.name === 'ultra_spawn_agent' && !row.isError).map(row => ({ ...JSON.parse(row.text), parentId: proof.rootId, requestedModelId: row.arguments.model_config_id, reason: row.arguments.model_reason, isError: false }))
    const records = modelPoolJudgeRecords(parent.receipts.filter(row => row.name === 'ultra_wait_agent' && !row.isError).flatMap(row => JSON.parse(row.text).agents ?? []))
    const childIds = spawns.map(row => row.id), children = sessions.filter(row => childIds.includes(row.sessionId))
    const nativeToolReceipts = children.flatMap(child => child.receipts.filter(row => row.name === 'fixture_read' && !row.isError).map(row => ({ sessionId: child.sessionId, id: row.arguments.id, nonce: JSON.parse(row.text).nonce, callId: row.callId, callSeq: row.callSeq, resultSeq: row.resultSeq })))
    const audit = judgeLivePhase({ ...proof, requests: result.requests, spawns, records, toolCalls: result.toolExecutions.filter(row => row.name === 'fixture_read'), nativeToolReceipts, childAnswers: children.map(child => ({ sessionId: child.sessionId, text: child.finalText, completed: child.completed })), publicText: parent.finalText })
    if (!audit.passed) throw new Error('Actual native JSONL delegation chain failed: ' + JSON.stringify(audit))
  }
  return true
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: { runtime: { type: 'string' }, candidate: { type: 'string' }, 'candidate-sha256': { type: 'string' }, work: { type: 'string' }, node: { type: 'string' }, help: { type: 'boolean' } } })
  if (values.help) { console.log('Usage: node run-companion-decision-profile.mjs --runtime <0.2.1-rc.2-root> --candidate <decision.tgz> --candidate-sha256 <exact-sha256> --work <NEW-empty-root> [--node <node>]'); return }
  for (const name of ['runtime', 'candidate', 'candidate-sha256', 'work']) if (!values[name]) throw new Error('--' + name + ' is required')
  if (!/^[a-f0-9]{64}$/u.test(values['candidate-sha256'])) throw new Error('Exact lowercase candidate-sha256 is required')
  const runtime = canonical(values.runtime), candidate = canonical(values.candidate), executable = values.node ? canonical(values.node) : process.execPath
  if (!fs.statSync(runtime).isDirectory() || !fs.statSync(candidate).isFile() || hash(candidate) !== values['candidate-sha256']) throw new Error('Runtime/candidate invalid or frozen SHA256 mismatch')
  const versions = {}
  const nativeNames = ['dsh', 'dsh-app-boot', 'dsh-agent', 'dsh-agent-loop', 'dsh-session', 'dsh-scope', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-preset-registry', 'dsh-agent-preset', 'dsh-session-persistence-jsonl', 'dsh-session-query', 'dsh-commands', 'dsh-config-editor', 'dsh-settings', 'dsh-fs-local', 'dsh-working-directory', 'dsh-subagent', 'dsh-subagent-spawn-in-process']
  for (const name of nativeNames) { const file = path.join(runtime, 'node_modules/@deepseek-ai', name, 'package.json'), manifest = readJson(file); if (manifest.name !== '@deepseek-ai/' + name || manifest.version !== '0.2.1-rc.2') throw new Error('Pinned native runtime required: ' + name); versions[manifest.name] = { version: manifest.version, manifestSha256: hash(file) } }
  const cli = path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), { work } = claimFreshWork(values.work, [runtime, candidate, os.homedir(), process.env.DSH_HOME])
  const inside = filename => { const value = path.resolve(work, filename); if (!contains(work, value) || normalized(value) === normalized(work)) throw new Error('Path escaped fresh work'); return value }
  const mkdir = filename => { const value = inside(filename); fs.mkdirSync(value, { recursive: true }); return value }
  const write = (filename, value) => fs.writeFileSync(inside(filename), JSON.stringify(value, null, 2) + '\n')
  const started = Date.now(); let child
  try {
    const home = mkdir('dsh-home'), osHome = mkdir('os-home'), projectDir = mkdir('project'), temp = mkdir('temp'), profileName = 'companion-decision-acceptance', profileDir = mkdir('dsh-home/profiles/' + profileName)
    const env = {}
    for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key]) env[key] = process.env[key]
    for (const key of ['HOME', 'USERPROFILE']) env[key] = osHome
    for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME']) env[key] = mkdir('os-home/' + key.toLowerCase())
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) env[key] = temp
    Object.assign(env, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ULTRA_ACCEPTANCE_NETWORK_LOG: inside('network-denials.jsonl'), NO_COLOR: '1' })
    const nodeVersion = spawnSync(executable, ['--version'], { env, windowsHide: true, encoding: 'utf8', timeout: 10000 }), match = /^v(\d+)\.(\d+)\./u.exec(nodeVersion.stdout?.trim() ?? '')
    if (nodeVersion.status !== 0 || !match || !(+match[1] >= 24 || +match[1] === 22 && +match[2] >= 19)) throw new Error('Node >=24 or >=22.19 required')
    const tar = args => { const response = spawnSync('tar', args, { env, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 }); if (response.error || response.status !== 0) throw new Error('Archive failed: ' + (response.error ?? response.stderr)); return response.stdout }
    const snapshot = inside('candidate.tgz'); fs.copyFileSync(candidate, snapshot, fs.constants.COPYFILE_EXCL)
    if (hash(snapshot) !== values['candidate-sha256'] || hash(candidate) !== values['candidate-sha256']) throw new Error('Frozen bytes changed')
    const entries = tar(['-tzf', snapshot]).split(/\r?\n/u).filter(Boolean); if (!entries.length) throw new Error('Empty candidate archive'); entries.forEach(assertArchiveEntry)
    if (tar(['-tvzf', snapshot]).split(/\r?\n/u).filter(Boolean).some(line => !/^[d-]/u.test(line))) throw new Error('Archive links and special entries forbidden')
    const installed = mkdir('dsh-home/profiles/' + profileName + '/node_modules/@dsh-external/dsh-ultra-decision')
    tar(['-xzf', snapshot, '--strip-components=1', '-C', installed])
    const manifest = readJson(path.join(installed, 'package.json')); assertDecisionManifest(manifest)
    const inventory = (dir, relative = '') => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => { const file = path.join(dir, item.name), rel = relative ? relative + '/' + item.name : item.name; if (item.isSymbolicLink() || !(item.isDirectory() || item.isFile()) || !contains(installed, file)) throw new Error('Unsafe extracted candidate file'); return item.isDirectory() ? inventory(file, rel) : [{ path: rel, bytes: fs.statSync(file).size, sha256: hash(file) }] })
    const requireRuntime = createRequire(path.join(runtime, 'package.json')), satisfies = requireRuntime('semver/functions/satisfies')
    for (const [name, requirement] of Object.entries(manifest.peerDependencies ?? {})) { const file = path.join(runtime, 'node_modules', ...name.split('/'), 'package.json'); if (name.startsWith('@deepseek-ai/') && fs.existsSync(file) && !satisfies(readJson(file).version, requirement, { includePrerelease: true })) throw new Error('Incompatible native peer: ' + name) }
    write('candidate.json', { source: candidate, snapshot, sha256: hash(snapshot), installed, name: manifest.name, version: manifest.version, files: inventory(installed) })
    const frozen = path.join(installed, 'scripts/host-acceptance'), support = ['companion-decision-plugin.mjs', 'model-pool-live-driver.mjs', 'real-model-global-limit.mjs', 'network-guard.cjs']
    for (const file of support) if (!fs.statSync(path.join(frozen, file)).isFile()) throw new Error('Missing frozen support: ' + file)
    const phaseFile = inside('phase.json'), stateFile = inside('state.json'), sessionId = 'companion-' + crypto.randomUUID()
    const routes = [{ provider: 'companion-main', model: 'scripted-main' }, { provider: 'companion-code', model: 'scripted-code' }, { provider: 'companion-review', model: 'scripted-review' }]
    const rows = [
      ['timer', '@deepseek-ai/cordis-plugin-timer'], ['llm', '@deepseek-ai/dsh-llm'], ['session', '@deepseek-ai/dsh-session'], ['system-prompt', '@deepseek-ai/dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }], ['tools', '@deepseek-ai/dsh-tools', { mode: 'native' }], ['agent', '@deepseek-ai/dsh-agent'], ['session-projection', '@deepseek-ai/dsh-session-projection'], ['token-meter', '@deepseek-ai/dsh-token-meter'], ['agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry', { default: 'offline' }], ['offline-preset', '@deepseek-ai/dsh-agent-preset', { id: 'offline', plugins: [] }], ['agent-loop', '@deepseek-ai/dsh-agent-loop', { agents: [] }], ['sessions', '@deepseek-ai/dsh-session-persistence-jsonl', { root: path.join(home, 'sessions'), compression: 'none' }], ['session-query', '@deepseek-ai/dsh-session-query'], ['commands', '@deepseek-ai/dsh-commands'], ...companionSettingsPlugins(), ['fs-local', '@deepseek-ai/dsh-fs-local'], ['working-directory', '@deepseek-ai/dsh-working-directory', { defaultDirectory: projectDir }], ['subagents', '@deepseek-ai/dsh-subagent', { maxDepth: 1, maxActiveSubagents: 2 }], ['spawn', '@deepseek-ai/dsh-subagent-spawn-in-process', { providerName: 'spawn' }],
      ['global-model-stream-gate', path.join(frozen, 'real-model-global-limit.mjs').replaceAll('\\', '/'), { testRoot: work, logFile: inside('global-model-streams.jsonl'), allowedRoutes: routes, concurrency: 2, maxRequests: 40, syntheticUsage: true }], ['companion-decision-driver', path.join(frozen, 'companion-decision-plugin.mjs').replaceAll('\\', '/'), { runtimeRoot: runtime, projectDir, phaseFile, stateFile, sessionId }],
    ]
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-decision-companion-isolated', private: true, type: 'module', dependencies: { [manifest.name]: manifest.version }, dsh: { profile: { bundles: [manifest.name] } } }, null, 2))
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), JSON.stringify([{ insert: rows.map(([id, name, config]) => ({ id, name, ...(config ? { config } : {}) })) }, { id: 'ultra-decision', config: { decisionAssistEnabled: false, collaborationEnabled: false, timeoutMs: 30000, coordinationIntervalMs: 100, coordinationMaxRounds: 1, decisionGovernance: true, evidenceEnabled: true, contextCompression: false, researchTools: ['fixture_read', 'ultra_memory_search', 'ultra_memory_get'] } }], null, 2))
    const outcomes = []
    for (const mode of ['core', 'resume']) {
      const resultFile = inside(mode + '-result.json'); write('phase.json', { mode, resultFile })
      const cliArgs = ['--expose-internals', '--require', path.join(frozen, 'network-guard.cjs'), cli, '--profile', profileName], stdout = fs.openSync(inside(mode + '-stdout.log'), 'wx'), stderr = fs.openSync(inside(mode + '-stderr.log'), 'wx')
      try { child = spawn(executable, cliArgs, { cwd: projectDir, env, windowsHide: true, stdio: ['ignore', stdout, stderr] }) } finally { fs.closeSync(stdout); fs.closeSync(stderr) }
      write(mode + '-launch.json', { pid: child.pid, executable, args: cliArgs, nodeVersion: nodeVersion.stdout.trim(), cwd: projectDir, profileDir, candidateSha256: hash(snapshot), runtimeVersions: versions, cliSha256: hash(cli), runnerSha256: hash(fileURLToPath(import.meta.url)), frozenSupport: support.map(file => ({ path: file, sha256: hash(path.join(frozen, file)) })), networkAllowed: false, maximumStreams: 2, maxRequests: 40, timeoutMs: 120000, environmentNames: Object.keys(env).sort() })
      let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000); let termination
      try { termination = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) }) } finally { clearTimeout(timer) }
      const sessions = [], scan = dir => { if (!fs.existsSync(dir)) return; for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); if (item.isSymbolicLink()) throw new Error('Session inventory refuses links'); if (item.isDirectory()) scan(file); else if (item.isFile() && file.endsWith('.jsonl')) sessions.push({ path: path.relative(work, file).replaceAll('\\', '/'), sha256: hash(file), ...inspectSessionJsonl(fs.readFileSync(file, 'utf8')) }) } }
      scan(path.join(home, 'sessions')); write(mode + '-session-inventory.json', sessions)
      const result = fs.existsSync(resultFile) ? readJson(resultFile) : undefined; let nativeJsonlVerified = false, inventoryError
      try { assertCompanionInventory(sessions, result ?? {}, mode); nativeJsonlVerified = true } catch (error) { inventoryError = String(error) }
      const networkDenials = fs.existsSync(env.ULTRA_ACCEPTANCE_NETWORK_LOG) ? fs.readFileSync(env.ULTRA_ACCEPTANCE_NETWORK_LOG, 'utf8').split(/\r?\n/u).filter(Boolean).length : 0
      const passed = !timedOut && termination.code === 0 && networkDenials === 0 && nativeJsonlVerified && result?.status === 'passed' && hash(snapshot) === values['candidate-sha256']
      outcomes.push({ phase: mode, passed, ...termination, timedOut, networkDenials, nativeJsonlVerified, inventoryError, resultStatus: result?.status ?? null }); write('phases.json', outcomes)
      if (!passed) break
    }
    const outcome = { passed: outcomes.length === 2 && outcomes.every(row => row.passed), phases: outcomes, candidateSha256: hash(snapshot), elapsedMs: Date.now() - started, work, maximumStreams: 2, maximumRequestsPerProcess: 40, maximumProcesses: 2, networkAllowed: false }
    write('outcome.json', outcome); console.log(JSON.stringify(outcome, null, 2)); if (!outcome.passed) process.exitCode = 1
  } catch (error) { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); write('runner-error.json', { error: String(error), stack: error.stack, elapsedMs: Date.now() - started }); throw error }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
