/** Fresh-only, offline DSH 0.2.1-rc.2 CLI Loader acceptance. Never use a daily profile. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value
function canonical(filename) {
  let current = path.resolve(filename); const tail = []
  while (!fs.existsSync(current)) { tail.unshift(path.basename(current)); current = path.dirname(current) }
  return path.join(fs.realpathSync(current), ...tail)
}
function contains(parent, child) {
  parent = normalized(canonical(parent)); child = normalized(canonical(child))
  return parent === child || child.startsWith(parent + path.sep)
}
export function assertArchiveEntry(filename) {
  if (!filename.startsWith('package/') || filename.includes('\\') || filename.split('/').some(part => part === '..' || part === '.' || part.includes(':'))) throw new Error('Unsafe candidate archive entry: ' + filename)
}
export function inspectSessionJsonl(content) {
  const records = content.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line))
  return { records: records.length, toolResultPresent: records.some(row => row.type === 'tool/result'), turnEndPresent: records.some(row => row.type === 'turn/end') }
}
export function claimFreshWork(filename, forbidden = []) {
  const work = canonical(filename)
  if (work === path.parse(work).root || work.split(/[\\/]/).some(part => part.toLowerCase() === '.dsh')) throw new Error('Fresh profile cannot overlap a daily home or filesystem root')
  for (const other of forbidden.filter(Boolean)) if (contains(work, other) || contains(other, work)) throw new Error('Fresh work overlaps a forbidden path: ' + other)
  if (fs.existsSync(work) && (!fs.statSync(work).isDirectory() || fs.readdirSync(work).length)) throw new Error('Decision acceptance requires a new empty work root; old profiles are never reused')
  fs.mkdirSync(work, { recursive: true })
  const owner = { format: 'dsh-decision-loop-isolated-v1', id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  fs.writeFileSync(path.join(work, '.decision-loop-acceptance.json'), JSON.stringify(owner, null, 2), { flag: 'wx' })
  return { work: fs.realpathSync(work), ...owner }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: {
    runtime: { type: 'string' }, candidate: { type: 'string' }, work: { type: 'string' }, node: { type: 'string' },
    'candidate-sha256': { type: 'string' }, mode: { type: 'string', default: 'core' }, help: { type: 'boolean' },
  } })
  if (values.help) { console.log('Usage: node run-decision-loop-profile.mjs --runtime <0.2.1-rc.2-root> --candidate <tgz> --candidate-sha256 <exact-sha256> --work <NEW-empty-root> [--mode probe|core] [--node <node>]'); return }
  for (const key of ['runtime', 'candidate', 'candidate-sha256', 'work']) if (!values[key]) throw new Error('--' + key + ' is required')
  if (!['core', 'probe'].includes(values.mode)) throw new Error('Mode must be core or probe; every run requires a new work root')
  if (!/^[a-f0-9]{64}$/u.test(values['candidate-sha256'])) throw new Error('candidate-sha256 must be exact lowercase SHA256')
  const runtime = canonical(values.runtime), candidate = canonical(values.candidate), executable = values.node ? canonical(values.node) : process.execPath
  if (!fs.statSync(runtime).isDirectory() || !fs.statSync(candidate).isFile()) throw new Error('Runtime and candidate have the wrong file types')
  if (hash(candidate) !== values['candidate-sha256']) throw new Error('Candidate TGZ SHA256 does not match frozen expected bytes')
  const versions = {}
  for (const name of ['dsh', 'dsh-app-boot', 'dsh-agent', 'dsh-agent-loop', 'dsh-session', 'dsh-scope', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-preset-registry', 'dsh-agent-preset', 'dsh-session-persistence-jsonl', 'dsh-commands']) {
    const manifestFile = path.join(runtime, 'node_modules', '@deepseek-ai', name, 'package.json'), manifest = readJson(manifestFile)
    if (manifest.name !== '@deepseek-ai/' + name || manifest.version !== '0.2.1-rc.2') throw new Error('Runtime must use pinned ' + name + '@0.2.1-rc.2')
    versions[manifest.name] = { version: manifest.version, manifestSha256: hash(manifestFile) }
  }
  const cli = path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!fs.statSync(cli).isFile()) throw new Error('Native CLI missing')
  const { work } = claimFreshWork(values.work, [runtime, candidate, os.homedir(), process.env.DSH_HOME])
  const inside = filename => {
    const target = path.resolve(work, filename)
    if (!contains(work, target) || normalized(work) === normalized(target)) throw new Error('Path escaped fresh work root: ' + target)
    return target
  }
  const mkdir = filename => { const target = inside(filename); fs.mkdirSync(target, { recursive: true }); return target }
  const write = (filename, value) => fs.writeFileSync(inside(filename), JSON.stringify(value, null, 2) + '\n')
  const started = Date.now(); let child
  try {
    const home = mkdir('dsh-home'), osHome = mkdir('os-home'), projectDir = mkdir('project'), temp = mkdir('temp')
    const profileDir = mkdir('dsh-home/profiles/decision-loop-acceptance'), installed = mkdir('dsh-home/profiles/decision-loop-acceptance/node_modules/@dsh-external/dsh-ultra-mode')
    const env = {}
    for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key]) env[key] = process.env[key]
    for (const key of ['HOME', 'USERPROFILE']) env[key] = osHome
    for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME']) env[key] = mkdir('os-home/' + key.toLowerCase())
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) env[key] = temp
    Object.assign(env, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ULTRA_ACCEPTANCE_NETWORK_LOG: inside('network-denials.jsonl'), NO_COLOR: '1' })
    const nodeVersion = spawnSync(executable, ['--version'], { env, windowsHide: true, encoding: 'utf8', timeout: 10000 })
    const match = /^v(\d+)\.(\d+)\./u.exec(nodeVersion.stdout?.trim() ?? '')
    if (nodeVersion.status !== 0 || !match || !(+match[1] >= 24 || +match[1] === 22 && +match[2] >= 19)) throw new Error('Node >=24 or >=22.19 is required')
    const tar = args => {
      const response = spawnSync('tar', args, { env, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 })
      if (response.error || response.status !== 0) throw new Error('Candidate archive failed: ' + (response.error ?? response.stderr))
      return response.stdout
    }
    const snapshot = inside('candidate.tgz'); fs.copyFileSync(candidate, snapshot, fs.constants.COPYFILE_EXCL)
    if (hash(snapshot) !== values['candidate-sha256'] || hash(candidate) !== values['candidate-sha256']) throw new Error('Candidate bytes changed while freezing')
    const entries = tar(['-tzf', snapshot]).split(/\r?\n/u).filter(Boolean)
    if (!entries.length) throw new Error('Candidate archive is empty')
    entries.forEach(assertArchiveEntry)
    if (tar(['-tvzf', snapshot]).split(/\r?\n/u).filter(Boolean).some(line => !/^[d-]/u.test(line))) throw new Error('Archive links and special entries are forbidden')
    tar(['-xzf', snapshot, '--strip-components=1', '-C', installed])
    const inventory = (dir, relative = '') => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => {
      const file = path.join(dir, item.name), rel = relative ? relative + '/' + item.name : item.name
      if (item.isSymbolicLink() || !(item.isFile() || item.isDirectory()) || !contains(installed, file)) throw new Error('Unsafe extracted file: ' + rel)
      return item.isDirectory() ? inventory(file, rel) : [{ path: rel, bytes: fs.statSync(file).size, sha256: hash(file) }]
    })
    const manifest = readJson(path.join(installed, 'package.json'))
    if (manifest.name !== '@dsh-external/dsh-ultra-mode' || !manifest.version || !manifest.dsh?.bundle?.patch) throw new Error('Candidate is not a DSH Ultra bundle')
    const runtimeRequire = createRequire(path.join(runtime, 'package.json')), satisfies = runtimeRequire('semver/functions/satisfies')
    for (const [name, requirement] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!name.startsWith('@deepseek-ai/')) continue
      const dependencyFile = path.join(runtime, 'node_modules', ...name.split('/'), 'package.json')
      if (fs.existsSync(dependencyFile) && !satisfies(readJson(dependencyFile).version, requirement, { includePrerelease: true })) throw new Error('Candidate host peer is incompatible before CLI launch: ' + name + ' ' + requirement)
    }
    write('candidate.json', { source: candidate, snapshot, sha256: hash(snapshot), name: manifest.name, version: manifest.version, installed, files: inventory(installed) })
    const frozenScripts = path.join(installed, 'scripts', 'host-acceptance')
    for (const file of ['decision-loop-plugin.mjs', 'real-model-global-limit.mjs', 'network-guard.cjs']) if (!fs.statSync(path.join(frozenScripts, file)).isFile()) throw new Error('Frozen candidate lacks acceptance support: ' + file)
    const config = { runtimeRoot: runtime, ultraRoot: installed, projectDir, resultFile: inside('result.json'), mode: values.mode, sessionId: 'decision-loop-' + crypto.randomUUID() }
    const rows = [
      ['timer', '@deepseek-ai/cordis-plugin-timer'], ['llm', '@deepseek-ai/dsh-llm'], ['session', '@deepseek-ai/dsh-session'],
      ['system-prompt', '@deepseek-ai/dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }], ['tools', '@deepseek-ai/dsh-tools', { mode: 'native' }], ['agent', '@deepseek-ai/dsh-agent'],
      ['session-projection', '@deepseek-ai/dsh-session-projection'], ['token-meter', '@deepseek-ai/dsh-token-meter'],
      ['agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry', { default: 'offline' }], ['offline-preset', '@deepseek-ai/dsh-agent-preset', { id: 'offline', plugins: [] }], ['agent-loop', '@deepseek-ai/dsh-agent-loop', { agents: [] }],
      ['sessions', '@deepseek-ai/dsh-session-persistence-jsonl', { root: path.join(home, 'sessions'), compression: 'none' }], ['commands', '@deepseek-ai/dsh-commands'],
      ['global-model-stream-gate', path.join(frozenScripts, 'real-model-global-limit.mjs').replaceAll('\\', '/'), { testRoot: work, logFile: inside('global-model-streams.jsonl'), allowedProvider: 'decision-offline', allowedModel: 'scripted', concurrency: 2, maxRequests: 40, syntheticUsage: true }],
      ['decision-loop-driver', path.join(frozenScripts, 'decision-loop-plugin.mjs').replaceAll('\\', '/'), config],
    ]
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-decision-loop-isolated', private: true, type: 'module', dependencies: { [manifest.name]: manifest.version }, dsh: { profile: { bundles: [manifest.name] } } }, null, 2))
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), JSON.stringify([{ insert: rows.map(([id, name, config]) => ({ id, name, ...(config ? { config } : {}) })) }, { id: 'ultra-mode', config: { concurrency: 2, coordinationIntervalMs: 100, coordinationMaxRounds: 4, timeoutMs: 60000, jevEnabled: false, evidenceEnabled: true, contextCompression: false, decisionGovernance: true, researchTools: ['fixture_read', 'ultra_memory_search', 'ultra_memory_get'] } }], null, 2))
    const cliArgs = ['--expose-internals', '--require', path.join(frozenScripts, 'network-guard.cjs'), cli, '--profile', 'decision-loop-acceptance']
    const stdout = fs.openSync(inside('stdout.log'), 'wx'), stderr = fs.openSync(inside('stderr.log'), 'wx')
    try { child = spawn(executable, cliArgs, { cwd: projectDir, env, windowsHide: true, stdio: ['ignore', stdout, stderr] }) }
    finally { fs.closeSync(stdout); fs.closeSync(stderr) }
    write('launch.json', { pid: child.pid, executable, args: cliArgs, nodeVersion: nodeVersion.stdout.trim(), cwd: projectDir, home, osHome, profileDir, runtimeVersions: versions, cliSha256: hash(cli), runnerSha256: hash(fileURLToPath(import.meta.url)), frozenSupport: ['decision-loop-plugin.mjs', 'real-model-global-limit.mjs', 'network-guard.cjs'].map(file => ({ path: file, sha256: hash(path.join(frozenScripts, file)) })), networkAllowed: false, maximumStreams: 2, maxRequests: 40, timeoutMs: 120000, environmentNames: Object.keys(env).sort() })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
    let termination
    try { termination = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) }) }
    finally { clearTimeout(timer) }
    const networkDenials = fs.existsSync(env.ULTRA_ACCEPTANCE_NETWORK_LOG) ? fs.readFileSync(env.ULTRA_ACCEPTANCE_NETWORK_LOG, 'utf8').trim().split(/\r?\n/u).filter(Boolean).length : 0
    const sessionFiles = []
    const scanSessions = dir => {
      if (!fs.existsSync(dir)) return
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const filename = path.join(dir, item.name)
        if (item.isSymbolicLink()) throw new Error('Session JSONL inventory refuses links')
        if (item.isDirectory()) scanSessions(filename)
        else if (item.isFile() && item.name.endsWith('.jsonl')) {
          const content = fs.readFileSync(filename, 'utf8')
          sessionFiles.push({ path: path.relative(work, filename).replaceAll('\\', '/'), sha256: hash(filename), bytes: Buffer.byteLength(content), ...inspectSessionJsonl(content) })
        }
      }
    }
    scanSessions(path.join(home, 'sessions'))
    write('session-inventory.json', sessionFiles)
    const result = fs.existsSync(config.resultFile) ? readJson(config.resultFile) : undefined
    const nativeJsonlVerified = sessionFiles.some(file => file.toolResultPresent && file.turnEndPresent)
    const passed = !timedOut && termination.code === 0 && networkDenials === 0 && nativeJsonlVerified && result?.status === 'passed'
    const outcome = { passed, mode: values.mode, ...termination, timedOut, networkDenials, nativeJsonlVerified, elapsedMs: Date.now() - started, resultStatus: result?.status ?? null, candidateSha256: hash(snapshot), work }
    write('outcome.json', outcome); console.log(JSON.stringify(outcome, null, 2))
    if (!passed) process.exitCode = 1
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    write('runner-error.json', { error: String(error), stack: error.stack, elapsedMs: Date.now() - started })
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
