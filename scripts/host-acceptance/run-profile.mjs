/**
 * Isolated, offline acceptance through the native DSH 0.2.0-rc.2 CLI Loader.
 *
 * node scripts/host-acceptance/run-profile.mjs --runtime /extracted/dsh \
 *   --candidate /packages/candidate.tgz --work /new/acceptance-root [core]
 * Optional: --node /path/to/node[.exe], --mode core|resume|disabled|dump|model-pool|model-pool-resume.
 * Run core before resume, using the same --work and candidate bytes. The work
 * root must be new/empty or previously owned by this runner. Every invocation
 * re-extracts the TGZ and keeps its attempt, package hashes, logs and outcome.
 * No installed application path, daily profile, provider or credentials is used.
 * Requires Node >=24 (or a compatible Node >=22.19), and tar on PATH.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const format = 'dsh-ultra-isolated-host-acceptance-v1'
const modes = new Set(['core', 'resume', 'disabled', 'dump', 'model-pool', 'model-pool-resume'])
const { values, positionals } = parseArgs({
  options: {
    runtime: { type: 'string' }, candidate: { type: 'string' }, work: { type: 'string' },
    node: { type: 'string' }, mode: { type: 'string' }, help: { type: 'boolean' },
  }, allowPositionals: true, strict: true,
})
if (values.help) {
  console.log('Usage: node run-profile.mjs --runtime <extracted-rc.2-root> --candidate <tgz> --work <dedicated-root> [--node <node>] [--mode <core|resume|disabled|dump|model-pool|model-pool-resume>]')
  process.exit(0)
}
if (positionals.length > 1 || (positionals.length && values.mode)) throw new Error('Select one acceptance mode')
const mode = values.mode ?? positionals[0] ?? 'core'
if (!modes.has(mode)) throw new Error('Mode must be core, resume, disabled, dump, model-pool or model-pool-resume')
for (const name of ['runtime', 'candidate', 'work']) if (!values[name]) throw new Error('--' + name + ' is required')

const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''))
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value
function canonical(filename) {
  let current = path.resolve(filename)
  const tail = []
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) throw new Error('Cannot resolve filesystem root: ' + filename)
    tail.unshift(path.basename(current)); current = parent
  }
  return path.join(fs.realpathSync(current), ...tail)
}
function contains(parent, child) {
  parent = normalized(canonical(parent)); child = normalized(canonical(child))
  return child === parent || child.startsWith(parent + path.sep)
}
function assertWithin(parent, child) {
  if (!contains(parent, child) || normalized(canonical(parent)) === normalized(canonical(child))) throw new Error('Path must remain strictly inside ' + parent + ': ' + child)
  return child
}
const runtime = canonical(values.runtime)
const candidate = canonical(values.candidate)
const work = canonical(values.work)
const nodeExecutable = values.node ? canonical(values.node) : process.execPath
if (!fs.statSync(runtime).isDirectory() || !fs.statSync(candidate).isFile() || !fs.statSync(nodeExecutable).isFile()) throw new Error('Runtime, candidate or Node path has the wrong file type')
if (work === path.parse(work).root || contains(work, runtime) || contains(runtime, work) || contains(work, candidate)) throw new Error('Work must be independent of the runtime and candidate')
if (work.split(/[\\/]/).some(part => part.toLowerCase() === '.dsh')) throw new Error('Work cannot be in a daily .dsh directory')
if (normalized(work) === normalized(canonical(os.homedir())) || contains(work, os.homedir())) throw new Error('Work cannot replace or contain the operating-system home')
for (const daily of [path.join(os.homedir(), '.dsh'), process.env.DSH_HOME].filter(Boolean)) {
  if (contains(daily, work) || contains(work, daily)) throw new Error('Work overlaps an existing/default DSH home')
}

const expected = {
  dsh: '0.2.0-rc.2', 'dsh-app-boot': '0.2.0-rc.2', 'dsh-agent': '0.2.0-rc.2',
  'dsh-agent-loop': '0.2.0-rc.2', 'dsh-session': '0.2.0-rc.2', 'dsh-scope': '0.2.0-rc.2',
  'dsh-llm': '0.2.0-rc.2', 'dsh-tools': '0.2.0-rc.2', 'dsh-system-prompt': '0.2.0-rc.2',
  'dsh-session-projection': '0.2.0-rc.2', 'dsh-token-meter': '0.2.0-rc.2',
  'dsh-agent-preset-registry': '0.2.0-rc.2', 'dsh-agent-preset': '0.2.0-rc.2',
  'dsh-session-persistence-jsonl': '0.2.0-rc.2', 'dsh-session-query-sqlite': '0.2.0-rc.2',
  'dsh-compaction-basic': '0.2.0-rc.2', 'dsh-commands': '0.2.0-rc.2',
  cordis: '4.0.4', 'cordis-plugin-loader': '1.0.5', 'cordis-plugin-include': '1.0.9',
  'cordis-plugin-timer': '1.1.6', schemastery: '3.18.4',
}
const runtimeVersions = {}
for (const [name, version] of Object.entries(expected)) {
  const filename = path.join(runtime, 'node_modules', '@deepseek-ai', name, 'package.json')
  const manifest = readJson(filename)
  if (manifest.name !== '@deepseek-ai/' + name || manifest.version !== version) throw new Error('Runtime must use pinned ' + name + '@' + version)
  runtimeVersions[manifest.name] = { version: manifest.version, manifestSha256: hash(filename) }
}
const cli = path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!fs.statSync(cli).isFile()) throw new Error('Extracted native CLI entry is missing')
for (const file of ['acceptance-plugin.mjs', 'compression-checks.mjs', 'network-guard.cjs', 'real-model-global-limit.mjs']) if (!fs.statSync(path.join(scriptDir, file)).isFile()) throw new Error('Acceptance support file missing: ' + file)

const ownerFile = path.join(work, '.ultra-host-acceptance.json')
if (fs.existsSync(work)) {
  if (!fs.statSync(work).isDirectory()) throw new Error('Work is not a directory')
  const entries = fs.readdirSync(work)
  if (entries.length && (!entries.includes(path.basename(ownerFile)) || readJson(ownerFile).format !== format)) throw new Error('Refusing a nonempty work root not owned by this runner')
} else fs.mkdirSync(work, { recursive: true })
if (!fs.existsSync(ownerFile)) fs.writeFileSync(ownerFile, JSON.stringify({ format, createdAt: new Date().toISOString(), id: crypto.randomUUID() }, null, 2), { flag: 'wx' })
function mkdir(dir) {
  assertWithin(work, dir); fs.mkdirSync(dir, { recursive: true }); assertWithin(work, dir)
  return dir
}
const attemptId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8)
const attemptDir = mkdir(path.join(work, 'attempts', attemptId))
const lockFile = assertWithin(work, path.join(work, '.running.lock'))
const lock = fs.openSync(lockFile, 'wx')
fs.writeFileSync(lock, JSON.stringify({ attemptId, pid: process.pid, startedAt: new Date().toISOString() }))
fs.closeSync(lock)
const attemptsFile = assertWithin(work, path.join(work, 'attempts.jsonl'))
const appendAttempt = event => fs.appendFileSync(attemptsFile, JSON.stringify({ attemptId, mode, at: new Date().toISOString(), ...event }) + '\n')
const writeAttempt = (name, value) => fs.writeFileSync(assertWithin(attemptDir, path.join(attemptDir, name)), JSON.stringify(value, null, 2) + '\n')
const started = Date.now()
appendAttempt({ event: 'started', candidate, candidateSha256: hash(candidate), runtime })

let child
try {
  const home = mkdir(path.join(work, 'home'))
  const profileDir = mkdir(path.join(home, 'profiles', 'ultra-acceptance'))
  const installed = assertWithin(profileDir, path.join(profileDir, 'node_modules', '@dsh-external', 'dsh-ultra-mode'))
  const networkLog = assertWithin(attemptDir, path.join(attemptDir, 'network-denials.jsonl'))
  const childEnv = {}
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key]) childEnv[key] = process.env[key]
  const isolatedOsHome = mkdir(path.join(home, 'os-home'))
  for (const key of ['USERPROFILE', 'HOME']) childEnv[key] = isolatedOsHome
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME']) childEnv[key] = mkdir(path.join(isolatedOsHome, key.toLowerCase()))
  for (const key of ['TEMP', 'TMP', 'TMPDIR']) childEnv[key] = mkdir(path.join(work, 'temp'))
  Object.assign(childEnv, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ULTRA_ACCEPTANCE_NETWORK_LOG: networkLog, NO_COLOR: '1' })
  const nodeVersion = spawnSync(nodeExecutable, ['--version'], { windowsHide: true, encoding: 'utf8', env: childEnv, timeout: 10000 })
  if (nodeVersion.error || nodeVersion.status !== 0) throw new Error('Selected Node cannot run: ' + (nodeVersion.error?.message ?? nodeVersion.stderr))
  const versionMatch = /^v(\d+)\.(\d+)\./.exec(nodeVersion.stdout.trim())
  if (!versionMatch || !(Number(versionMatch[1]) >= 24 || Number(versionMatch[1]) === 22 && Number(versionMatch[2]) >= 19)) throw new Error('Selected Node must support the pinned runtime engines: ^22.19 || >=24')
  const tar = args => {
    const result = spawnSync('tar', args, { windowsHide: true, encoding: 'utf8', env: childEnv, timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
    if (result.error || result.status !== 0) throw new Error('Candidate tar operation failed: ' + (result.error?.message ?? result.stderr))
    return result.stdout
  }
  const candidateSnapshot = assertWithin(attemptDir, path.join(attemptDir, 'candidate.tgz'))
  fs.copyFileSync(candidate, candidateSnapshot, fs.constants.COPYFILE_EXCL)
  const candidateSha256 = hash(candidateSnapshot)
  const archivePaths = tar(['-tzf', candidateSnapshot]).split(/\r?\n/).filter(Boolean)
  if (!archivePaths.length) throw new Error('Candidate archive is empty')
  for (const filename of archivePaths) {
    if (!filename.startsWith('package/') || filename.includes('\\') || filename.split('/').some(part => part === '..' || part === '.' || part.includes(':'))) throw new Error('Unsafe candidate archive entry: ' + filename)
  }
  if (tar(['-tvzf', candidateSnapshot]).split(/\r?\n/).filter(Boolean).some(line => !/^[d-]/.test(line))) throw new Error('Candidate archive may contain links or special entries')
  const staging = mkdir(path.join(attemptDir, 'candidate-staging'))
  tar(['-xzf', candidateSnapshot, '--strip-components=1', '-C', staging])
  function fileInventory(dir, relative = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => {
      const filename = assertWithin(staging, path.join(dir, item.name)), rel = relative ? relative + '/' + item.name : item.name
      if (item.isSymbolicLink() || !(item.isDirectory() || item.isFile())) throw new Error('Candidate contains a link or special file: ' + rel)
      return item.isDirectory() ? fileInventory(filename, rel) : [{ path: rel, bytes: fs.statSync(filename).size, sha256: hash(filename) }]
    })
  }
  const files = fileInventory(staging)
  const manifest = readJson(path.join(staging, 'package.json'))
  if (manifest.name !== '@dsh-external/dsh-ultra-mode' || typeof manifest.version !== 'string' || !manifest.dsh?.bundle?.patch) throw new Error('Candidate must be a versioned dsh-ultra-mode bundle')
  const latestCoreFile = assertWithin(work, path.join(work, 'latest-core.json'))
  let core
  if (mode === 'resume') {
    if (!fs.existsSync(latestCoreFile)) throw new Error('Run a successful core attempt with this --work before resume')
    core = readJson(latestCoreFile)
    if (core.candidateSha256 !== candidateSha256 || core.version !== manifest.version) throw new Error('Resume must use the exact TGZ bytes from the successful core attempt')
    assertWithin(work, core.projectDir); assertWithin(work, core.receiptFile)
    if (!fs.existsSync(core.receiptFile)) throw new Error('Core receipt is missing')
  }
  mkdir(path.dirname(installed))
  if (fs.existsSync(installed)) fs.renameSync(installed, assertWithin(attemptDir, path.join(attemptDir, 'previous-candidate')))
  fs.renameSync(staging, installed)
  const candidateRecord = { filename: path.basename(candidate), name: manifest.name, version: manifest.version, candidateSha256, installed, files }
  writeAttempt('candidate.json', candidateRecord)
  const projectDir = core?.projectDir ?? mkdir(path.join(work, 'projects', attemptId))
  const resultFile = path.join(attemptDir, 'result.json')
  const receiptFile = core?.receiptFile ?? path.join(attemptDir, 'core-receipt.json')
  const config = { runtimeRoot: runtime, ultraRoot: installed, projectDir, resultFile, receiptFile, mode, sessionId: 'host-acceptance-root-' + crypto.randomUUID(), modeChecks: true, compressionChecks: true, requireGlobalGate: true }
  const modelPoolMode = mode === 'model-pool' || mode === 'model-pool-resume'
  const latestPoolFile = assertWithin(work, path.join(work, 'latest-model-pool.json'))
  let restoredPool
  if (mode === 'model-pool-resume') {
    if (!fs.existsSync(latestPoolFile) || readJson(latestPoolFile).candidateSha256 !== candidateSha256) throw new Error('Model pool resume requires a successful model-pool run with the exact candidate TGZ bytes')
    const loadYaml = createRequire(path.join(runtime, 'package.json'))('js-yaml').load
    const saved = loadYaml(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'))
    restoredPool = saved.findLast(row => row.id === 'ultra-mode')?.config?.collaborationModelPool
    if (!restoredPool) throw new Error('Run successful model-pool mode before model-pool-resume')
  }
  const rows = [
    ['timer', '@deepseek-ai/cordis-plugin-timer'], ['llm', '@deepseek-ai/dsh-llm'], ['session', '@deepseek-ai/dsh-session'],
    ['system-prompt', '@deepseek-ai/dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }],
    ['tools', '@deepseek-ai/dsh-tools', { mode: 'native' }], ['agent', '@deepseek-ai/dsh-agent'],
    ['session-projection', '@deepseek-ai/dsh-session-projection'], ['token-meter', '@deepseek-ai/dsh-token-meter'],
    ['agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry', { default: 'offline' }],
    ['offline-preset', '@deepseek-ai/dsh-agent-preset', { id: 'offline', plugins: [] }],
    ['agent-loop', '@deepseek-ai/dsh-agent-loop', { agents: [] }],
    ['sessions', '@deepseek-ai/dsh-session-persistence-jsonl', { root: path.join(home, 'sessions'), compression: 'none' }],
    ['commands', '@deepseek-ai/dsh-commands'],
    ['global-model-stream-gate', path.join(scriptDir, 'real-model-global-limit.mjs').replaceAll('\\', '/'), { testRoot: attemptDir, logFile: path.join(attemptDir, 'global-model-streams.jsonl'), allowedProvider: 'acceptance-offline', allowedModel: 'fixture', concurrency: 2, maxRequests: 60, syntheticUsage: true }],
    ...(modelPoolMode ? [['config-editor', '@deepseek-ai/dsh-config-editor'], ['settings', '@deepseek-ai/dsh-settings']] : []),
    ['acceptance-driver', path.join(scriptDir, modelPoolMode ? 'model-pool-profile-plugin.mjs' : 'acceptance-plugin.mjs').replaceAll('\\', '/'), config],
  ]
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'ultra-isolated-host-acceptance', private: true, type: 'module', dependencies: { [manifest.name]: manifest.version }, dsh: { profile: { bundles: [manifest.name] } } }, null, 2))
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), JSON.stringify([
    { insert: rows.map(([id, name, config]) => ({ id, name, ...(config ? { config } : {}) })) },
    { id: 'ultra-mode', config: { concurrency: 2, coordinationMaxRounds: 0, timeoutMs: 30000, jevEnabled: false, evidenceEnabled: mode !== 'disabled', contextCompression: false, ...(restoredPool ? { collaborationModelPool: restoredPool } : {}) } },
  ], null, 2))
  const args = ['--expose-internals', '--require', path.join(scriptDir, 'network-guard.cjs'), cli, '--profile', 'ultra-acceptance']
  if (mode === 'dump') args.push('--dump-config')
  const stdoutFile = fs.openSync(path.join(attemptDir, 'stdout.log'), 'wx')
  const stderrFile = fs.openSync(path.join(attemptDir, 'stderr.log'), 'wx')
  try { child = spawn(nodeExecutable, args, { cwd: projectDir, env: childEnv, windowsHide: true, stdio: ['ignore', stdoutFile, stderrFile] }) }
  finally { fs.closeSync(stdoutFile); fs.closeSync(stderrFile) }
  writeAttempt('launch.json', { pid: child.pid, executable: nodeExecutable, nodeVersion: nodeVersion.stdout.trim(), args, cwd: projectDir, home, profileDir, candidate: candidateRecord.filename, candidateSha256, networkAllowed: false, environmentNames: Object.keys(childEnv).sort(), startedAt: new Date(started).toISOString(), runtimeVersions, cliSha256: hash(cli) })
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
  let termination
  try { termination = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) }) }
  finally { clearTimeout(timeout) }
  const networkDenials = fs.existsSync(networkLog) ? fs.readFileSync(networkLog, 'utf8').split(/\r?\n/).filter(Boolean).length : 0
  const result = fs.existsSync(resultFile) ? readJson(resultFile) : undefined
  const passed = !timedOut && termination.code === 0 && networkDenials === 0 && (mode === 'dump' || result?.status === 'passed')
  const outcome = { mode, passed, ...termination, timedOut, elapsedMs: Date.now() - started, resultFile, resultStatus: result?.status ?? null, networkDenials, candidateSha256, version: manifest.version }
  writeAttempt('outcome.json', outcome)
  if (passed && mode === 'core') fs.writeFileSync(latestCoreFile, JSON.stringify({ attemptId, candidateSha256, version: manifest.version, projectDir, receiptFile }, null, 2) + '\n')
  if (passed && mode === 'model-pool') fs.writeFileSync(latestPoolFile, JSON.stringify({ attemptId, candidateSha256, version: manifest.version }, null, 2) + '\n')
  appendAttempt({ event: 'finished', ...outcome })
  console.log(JSON.stringify({ attemptId, attemptDir, ...outcome }, null, 2))
  if (!passed) process.exitCode = 1
} catch (error) {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  const failure = { event: 'runner-failed', elapsedMs: Date.now() - started, error: String(error), stack: error?.stack }
  appendAttempt(failure); writeAttempt('runner-error.json', failure)
  console.error(JSON.stringify({ attemptId, attemptDir, ...failure }, null, 2))
  process.exitCode = 1
} finally {
  if (fs.existsSync(lockFile) && readJson(lockFile).attemptId === attemptId) fs.unlinkSync(lockFile)
}
