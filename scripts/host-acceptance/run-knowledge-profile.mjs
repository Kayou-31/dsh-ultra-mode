/** Fresh-only, finite offline native CLI acceptance; never use a daily profile. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { assertArchiveEntry, claimFreshWork as claimDecisionWork } from './run-decision-loop-profile.mjs'
import { FIXTURE_QUOTE, verifySharedSource } from './knowledge-profile-plugin.mjs'

export { assertArchiveEntry }
/** Settings is abstract unless explicitly composed beside its native editor. */
export const knowledgeSettingsPlugins = () => [['config-editor', '@deepseek-ai/dsh-config-editor'], ['settings', '@deepseek-ai/dsh-settings']]
export function knowledgePackageSelection(values) {
  const target = values.target ?? 'ultra', loadOrder = values['load-order'] ?? 'memory-first'
  if (!['ultra', 'memory'].includes(target)) throw new Error('target must be ultra or memory')
  if (!(target === 'ultra' ? ['memory-first', 'ultra-first'] : ['memory-first', 'decision-first']).includes(loadOrder)) throw new Error('load-order must match target: ultra uses ultra-first|memory-first; memory uses memory-first|decision-first')
  if (!!values.companion !== !!values['companion-sha256']) throw new Error('companion and exact companion-sha256 must be provided together')
  if (values.companion && !/^[a-f0-9]{64}$/u.test(values['companion-sha256'])) throw new Error('companion requires exact lowercase companion-sha256')
  if (values['compression-probe'] && (target !== 'memory' || values.companion)) throw new Error('compression-probe requires standalone target memory')
  const packageName = '@dsh-external/dsh-ultra-' + (target === 'memory' ? 'memory' : 'mode'), leafId = target === 'memory' ? 'ultra-memory' : 'ultra-mode'
  const companionPackage = values.companion ? '@dsh-external/dsh-ultra-' + (target === 'ultra' ? 'memory' : 'decision') : undefined
  const bundles = [packageName, ...(companionPackage ? [companionPackage] : [])]
  if (companionPackage && (loadOrder === 'decision-first' || target === 'ultra' && loadOrder === 'memory-first')) bundles.reverse()
  return { target, packageName, leafId, bundles, loadOrder, ...(companionPackage ? { companionPackage } : {}), ...(values['compression-probe'] ? { compressionProbe: true } : {}) }
}
export function knowledgeTargetConfigurations(selection, globalKnowledge) {
  const pairedUltra = selection.target === 'ultra' && !!selection.companionPackage
  const targetConfig = { ...(selection.target === 'ultra' ? { concurrency: 2, timeoutMs: 60000, jevEnabled: false } : {}), evidenceEnabled: !pairedUltra, contextCompression: false, globalKnowledge: pairedUltra ? { enabled: false } : globalKnowledge }
  if (selection.compressionProbe) Object.assign(targetConfig, { contextCompression: true, contextTargetTokens: 16000, contextOutputReserveTokens: 256, contextToolReserveTokens: 256 })
  return [{ id: selection.leafId, config: targetConfig }, ...(selection.companionPackage ? [{ id: pairedUltra ? 'ultra-memory' : 'ultra-decision', config: { ...(pairedUltra ? {} : { collaborationEnabled: false }), evidenceEnabled: pairedUltra, contextCompression: false, globalKnowledge: pairedUltra ? globalKnowledge : { enabled: false } } }] : [])]
}
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value
function canonical(filename) {
  let current = path.resolve(filename); const tail = []
  while (!fs.existsSync(current)) { tail.unshift(path.basename(current)); current = path.dirname(current) }
  return path.join(fs.realpathSync(current), ...tail)
}
function contains(parent, child) { parent = normalized(canonical(parent)); child = normalized(canonical(child)); return parent === child || child.startsWith(parent + path.sep) }

export function claimFreshWork(filename, forbidden = []) {
  const owner = claimDecisionWork(filename, forbidden)
  const marker = path.join(owner.work, '.knowledge-acceptance.json')
  fs.renameSync(path.join(owner.work, '.decision-loop-acceptance.json'), marker)
  const knowledgeOwner = { ...owner, format: 'dsh-knowledge-isolated-v1' }
  fs.writeFileSync(marker, JSON.stringify(knowledgeOwner, null, 2))
  return knowledgeOwner
}

/** Inventory requires actual matched identities and native result payloads. */
export function inspectSessionJsonl(content) {
  const records = content.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line))
  const header = records.find(row => row.type === 'session'), calls = new Map(), receipts = []
  for (const row of records) {
    if (row.type === 'tool/call' && typeof row.data?.callId === 'string' && typeof row.data?.name === 'string') calls.set(row.data.callId, row)
    if (row.type !== 'tool/result') continue
    const message = row.data?.message, id = message?.toolCallId, call = calls.get(id)
    if (!call || message.role !== 'tool' || message.source?.kind !== 'tool' || message.source?.callId !== id || row.seq <= call.seq || typeof message.isError !== 'boolean') continue
    const text = (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
    receipts.push({ name: call.data.name, callId: id, arguments: typeof call.data.arguments === 'string' ? JSON.parse(call.data.arguments) : call.data.arguments, callSeq: call.seq, resultSeq: row.seq, isError: message.isError, text })
  }
  const events = new Map(records.filter(row => Number.isSafeInteger(row.seq)).map(row => [row.seq, row])), compactions = []
  for (const row of records) {
    if (row.type !== 'tool/result' || row.surfaceOp?.op !== 'replace') continue
    const original = events.get(row.surfaceOp.startSeq), prune = events.get(row.seq - 1), oldMessage = original?.data?.message, replacement = row.data?.message
    if (original?.type !== 'tool/result' || prune?.type !== 'compaction/prune' || !prune.data?.shadowedSeqs?.includes(original.seq) || !row.sourceEventSeqs?.includes(original.seq) || replacement?.toolCallId !== oldMessage?.toolCallId || replacement?.id !== oldMessage?.id) continue
    const text = (oldMessage.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
    compactions.push({ originalSeq: original.seq, replacementSeq: row.seq, callId: oldMessage.toolCallId, rawSha256: crypto.createHash('sha256').update(text).digest('hex') })
  }
  return { sessionId: header?.id, records: records.length, completed: records.some(row => row.type === 'turn/end' && row.data?.reason?.kind === 'completed'), receipts, compactions }
}

export function assertCompressionInventory(sessions, compression) {
  const session = sessions.find(session => session.sessionId === compression?.sessionId)
  if (!session?.completed || compression?.rounds?.length !== 2) throw new Error('Compression probe lacks its actual completed native session and two rounds')
  for (const round of compression.rounds) {
    if (!session.compactions?.some(item => item.originalSeq === round.originalSeq && item.replacementSeq === round.replacementSeq && item.callId === round.callId && item.rawSha256 === round.rawSha256)) throw new Error('Missing exact native prune/replacement receipt for compression round ' + round.round)
    if (!session.receipts.some(item => {
      if (item.name !== 'ultra_memory_get' || item.isError) return false
      const value = JSON.parse(item.text)
      return ['host', 'captured'].includes(value.status) && value.citation?.sourceId === round.sourceId && value.citation.sha256 === round.rawSha256 && value.citation.quote === 'COMPRESSION_RAW_MIDDLE_' + round.round + '_731'
    })) throw new Error('Missing actual source retrieval after compression round ' + round.round)
  }
  return true
}

export function assertNativeInventory(sessions, state, phase) {
  const byId = id => sessions.find(session => session.sessionId === id)
  if (phase === 'foreign') {
    if (!sessions.some(session => session.completed)) throw new Error('Foreign profile has no completed native turn')
    return true
  }
  const root = byId(phase === 'core' ? state.coreRootA : state.resumeRootB)
  if (!root?.completed) throw new Error('Required actual main session has no completed native turn')
  const required = phase === 'core' ? ['knowledge_fixture_read', 'ultra_memory_search', 'ultra_knowledge_publish'] : ['ultra_knowledge_search', 'ultra_knowledge_get']
  for (const name of required) if (!root.receipts.some(receipt => receipt.name === name && receipt.isError === false)) throw new Error('Missing successful native tool receipt: ' + name)
  if (phase === 'core') {
    const published = root.receipts.find(receipt => receipt.name === 'ultra_knowledge_publish' && !receipt.isError)
    if (JSON.parse(published.text).id !== state.publicationId) throw new Error('Native publish receipt ID differs from state')
    if (published.arguments?.sources?.[0]?.sourceId !== state.sourceId || published.arguments.sources[0].quote !== FIXTURE_QUOTE) throw new Error('Native publication did not use the exact source and quote')
    const searched = root.receipts.find(receipt => receipt.name === 'ultra_memory_search' && !receipt.isError)
    if (!JSON.parse(searched.text).items?.some(item => item.sourceId === state.sourceId && item.kind.startsWith('tool/result'))) throw new Error('Source ID was not obtained from native memory search')
    const reader = byId(state.coreRootB)
    if (!reader?.receipts.some(receipt => receipt.name === 'ultra_knowledge_get' && !receipt.isError && JSON.parse(receipt.text).id === state.publicationId && verifySharedSource(JSON.parse(receipt.text), state.sourceId))) throw new Error('B lacks a verified native get receipt for the exact publication')
  }
  return true
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: { runtime: { type: 'string' }, candidate: { type: 'string' }, work: { type: 'string' }, node: { type: 'string' }, 'candidate-sha256': { type: 'string' }, target: { type: 'string' }, companion: { type: 'string' }, 'companion-sha256': { type: 'string' }, 'load-order': { type: 'string' }, 'compression-probe': { type: 'boolean' }, help: { type: 'boolean' } } })
  if (values.help) { console.log('Usage: node run-knowledge-profile.mjs --runtime <0.2.1-rc.2-root> --candidate <tgz> --candidate-sha256 <exact-sha256> --work <NEW-empty-root> [--target ultra|memory] [--companion <memory.tgz for ultra; decision.tgz for memory> --companion-sha256 <exact-sha256> --load-order ultra-first|memory-first|decision-first] [--compression-probe (standalone Memory only)] [--node <node>]'); return }
  const selection = knowledgePackageSelection(values)
  for (const key of ['runtime', 'candidate', 'candidate-sha256', 'work']) if (!values[key]) throw new Error('--' + key + ' is required')
  if (!/^[a-f0-9]{64}$/u.test(values['candidate-sha256'])) throw new Error('candidate-sha256 must be exact lowercase SHA256')
  const runtime = canonical(values.runtime), candidate = canonical(values.candidate), executable = values.node ? canonical(values.node) : process.execPath
  if (!fs.statSync(runtime).isDirectory() || !fs.statSync(candidate).isFile()) throw new Error('Runtime/candidate have wrong file types')
  if (hash(candidate) !== values['candidate-sha256']) throw new Error('Candidate TGZ SHA256 differs from frozen bytes')
  const companion = values.companion ? canonical(values.companion) : undefined
  if (companion && (!fs.statSync(companion).isFile() || hash(companion) !== values['companion-sha256'])) throw new Error('Companion TGZ SHA256 differs from frozen bytes')
  const versions = {}
  for (const name of ['dsh', 'dsh-app-boot', 'dsh-agent', 'dsh-agent-loop', 'dsh-session', 'dsh-scope', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-preset-registry', 'dsh-agent-preset', 'dsh-session-persistence-jsonl', 'dsh-commands', 'dsh-config-editor', 'dsh-settings']) {
    const file = path.join(runtime, 'node_modules', '@deepseek-ai', name, 'package.json'), manifest = readJson(file)
    if (manifest.name !== '@deepseek-ai/' + name || manifest.version !== '0.2.1-rc.2') throw new Error('Runtime requires pinned ' + name + '@0.2.1-rc.2')
    versions[manifest.name] = { version: manifest.version, manifestSha256: hash(file) }
  }
  const cli = path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const owner = claimFreshWork(values.work, [runtime, candidate, companion, os.homedir(), process.env.DSH_HOME]), work = owner.work
  const inside = filename => { const target = path.resolve(work, filename); if (!contains(work, target) || normalized(work) === normalized(target)) throw new Error('Path escaped isolated root'); return target }
  const mkdir = filename => { const target = inside(filename); fs.mkdirSync(target, { recursive: true }); return target }
  const write = (filename, value) => fs.writeFileSync(inside(filename), JSON.stringify(value, null, 2) + '\n')
  const started = Date.now(); let child
  try {
    const home = mkdir('dsh-home'), osHome = mkdir('os-home'), temp = mkdir('temp')
    const projects = Object.fromEntries(['A', 'B', 'C'].map(id => [id, mkdir('project' + id)]))
    fs.writeFileSync(path.join(projects.A, 'fixture.txt'), FIXTURE_QUOTE + '\nDO_NOT_SHARE_RAW_SESSION_TAIL_912\n', { flag: 'wx' })
    const env = {}
    for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key]) env[key] = process.env[key]
    for (const key of ['HOME', 'USERPROFILE']) env[key] = osHome
    for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME']) env[key] = mkdir('os-home/' + key.toLowerCase())
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) env[key] = temp
    Object.assign(env, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ULTRA_ACCEPTANCE_NETWORK_LOG: inside('network-denials.jsonl'), NO_COLOR: '1' })
    const nodeVersion = spawnSync(executable, ['--version'], { env, windowsHide: true, encoding: 'utf8', timeout: 10000 }), match = /^v(\d+)\.(\d+)\./u.exec(nodeVersion.stdout?.trim() ?? '')
    if (nodeVersion.status !== 0 || !match || !(+match[1] >= 24 || +match[1] === 22 && +match[2] >= 19)) throw new Error('Node >=24 or >=22.19 required')
    const tar = args => { const value = spawnSync('tar', args, { env, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 }); if (value.error || value.status !== 0) throw new Error('Candidate archive failed: ' + (value.error ?? value.stderr)); return value.stdout }
    const snapshot = inside('candidate.tgz'); fs.copyFileSync(candidate, snapshot, fs.constants.COPYFILE_EXCL)
    if (hash(snapshot) !== values['candidate-sha256'] || hash(candidate) !== values['candidate-sha256']) throw new Error('Candidate changed while freezing')
    const entries = tar(['-tzf', snapshot]).split(/\r?\n/u).filter(Boolean)
    if (!entries.length) throw new Error('Candidate archive is empty')
    entries.forEach(assertArchiveEntry)
    if (tar(['-tvzf', snapshot]).split(/\r?\n/u).filter(Boolean).some(line => !/^[d-]/u.test(line))) throw new Error('Archive links/special entries forbidden')
    const profileName = 'knowledge-acceptance', profileDir = mkdir('dsh-home/profiles/' + profileName)
    const installed = mkdir('dsh-home/profiles/' + profileName + '/node_modules/' + selection.packageName)
    tar(['-xzf', snapshot, '--strip-components=1', '-C', installed])
    const inventory = (dir, relative = '', base = installed) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => {
      const file = path.join(dir, item.name), rel = relative ? relative + '/' + item.name : item.name
      if (item.isSymbolicLink() || !(item.isFile() || item.isDirectory()) || !contains(base, file)) throw new Error('Unsafe extracted file: ' + rel)
      return item.isDirectory() ? inventory(file, rel, base) : [{ path: rel, bytes: fs.statSync(file).size, sha256: hash(file) }]
    })
    const manifest = readJson(path.join(installed, 'package.json'))
    if (manifest.name !== selection.packageName || !manifest.version || !manifest.dsh?.bundle?.patch) throw new Error('Candidate identity differs from selected target')
    const runtimeRequire = createRequire(path.join(runtime, 'package.json')), satisfies = runtimeRequire('semver/functions/satisfies')
    for (const [name, requirement] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!name.startsWith('@deepseek-ai/')) continue
      const file = path.join(runtime, 'node_modules', ...name.split('/'), 'package.json')
      if (fs.existsSync(file) && !satisfies(readJson(file).version, requirement, { includePrerelease: true })) throw new Error('Candidate host peer incompatible: ' + name)
    }
    const frozenScripts = path.join(installed, 'scripts', 'host-acceptance'), support = ['knowledge-profile-plugin.mjs', 'real-model-global-limit.mjs', 'network-guard.cjs']
    for (const file of support) if (!fs.statSync(path.join(frozenScripts, file)).isFile()) throw new Error('Frozen candidate lacks acceptance support: ' + file)
    if (selection.compressionProbe) {
      const fixture = await import(pathToFileURL(path.join(frozenScripts, 'knowledge-profile-plugin.mjs')).href)
      write('compression-protocol-preflight.json', await fixture.preflightCompressionProtocol(runtime, inside('compression-protocol-preflight-sessions')))
    }
    write('candidate.json', { source: candidate, snapshot, sha256: hash(snapshot), name: manifest.name, version: manifest.version, installed, files: inventory(installed) })
    let companionInstalled, companionManifest, companionSnapshot
    if (companion) {
      companionSnapshot = inside('companion.tgz'); fs.copyFileSync(companion, companionSnapshot, fs.constants.COPYFILE_EXCL)
      if (hash(companionSnapshot) !== values['companion-sha256'] || hash(companion) !== values['companion-sha256']) throw new Error('Companion changed while freezing')
      const companionEntries = tar(['-tzf', companionSnapshot]).split(/\r?\n/u).filter(Boolean)
      if (!companionEntries.length) throw new Error('Companion archive is empty')
      companionEntries.forEach(assertArchiveEntry)
      if (tar(['-tvzf', companionSnapshot]).split(/\r?\n/u).filter(Boolean).some(line => !/^[d-]/u.test(line))) throw new Error('Companion links/special entries forbidden')
      companionInstalled = mkdir('dsh-home/profiles/' + profileName + '/node_modules/' + selection.companionPackage)
      tar(['-xzf', companionSnapshot, '--strip-components=1', '-C', companionInstalled])
      companionManifest = readJson(path.join(companionInstalled, 'package.json'))
      if (companionManifest.name !== selection.companionPackage || !companionManifest.version || !companionManifest.dsh?.bundle?.patch) throw new Error('Companion identity differs from selected target pairing')
      for (const [name, requirement] of Object.entries(companionManifest.peerDependencies ?? {})) {
        if (!name.startsWith('@deepseek-ai/')) continue
        const file = path.join(runtime, 'node_modules', ...name.split('/'), 'package.json')
        if (fs.existsSync(file) && !satisfies(readJson(file).version, requirement, { includePrerelease: true })) throw new Error('Companion host peer incompatible: ' + name)
      }
      write('companion.json', { source: companion, snapshot: companionSnapshot, sha256: hash(companionSnapshot), name: companionManifest.name, version: companionManifest.version, installed: companionInstalled, files: inventory(companionInstalled, '', companionInstalled) })
    }
    const phaseFile = inside('phase.json'), stateFile = inside('state.json'), sessionId = 'knowledge-' + crypto.randomUUID()
    const globalKnowledge = { enabled: true, projects: [{ id: 'A', root: projects.A, read: true, publish: true, shareWith: ['B'] }, { id: 'B', root: projects.B, read: true, publish: false, shareWith: [] }], maxSearchChars: 6000, maxGetChars: 12000 }
    const prepareProfile = (name, directory, ultraRoot) => {
      const rows = [
        ['timer', '@deepseek-ai/cordis-plugin-timer'], ['llm', '@deepseek-ai/dsh-llm'], ['session', '@deepseek-ai/dsh-session'],
        ['system-prompt', '@deepseek-ai/dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }], ['tools', '@deepseek-ai/dsh-tools', { mode: 'native' }], ['agent', '@deepseek-ai/dsh-agent'],
        ['session-projection', '@deepseek-ai/dsh-session-projection'], ['token-meter', '@deepseek-ai/dsh-token-meter'], ['agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry', { default: 'offline' }],
        ['offline-preset', '@deepseek-ai/dsh-agent-preset', { id: 'offline', plugins: [] }], ['agent-loop', '@deepseek-ai/dsh-agent-loop', { agents: [] }],
        ['sessions', '@deepseek-ai/dsh-session-persistence-jsonl', { root: path.join(home, 'sessions-' + name), compression: 'none' }], ['commands', '@deepseek-ai/dsh-commands'],
        ...knowledgeSettingsPlugins(),
        ['global-model-stream-gate', path.join(frozenScripts, 'real-model-global-limit.mjs').replaceAll('\\', '/'), { testRoot: work, logFile: inside('global-model-streams.jsonl'), allowedProvider: 'knowledge-offline', allowedModel: 'scripted', concurrency: 2, maxRequests: 40, syntheticUsage: true }],
        ['knowledge-driver', path.join(frozenScripts, 'knowledge-profile-plugin.mjs').replaceAll('\\', '/'), { runtimeRoot: runtime, ultraRoot, target: selection.target, compressionProbe: selection.compressionProbe === true, targetPackage: selection.packageName, companionPackage: companionManifest?.name, coordinatedPackage: companionManifest ? selection.target === 'ultra' ? selection.packageName : companionManifest.name : undefined, authorityPackage: companionManifest && selection.target === 'ultra' ? companionManifest.name : selection.packageName, loadOrder: selection.loadOrder, projects, profileDir: directory, phaseFile, stateFile, sessionId }],
      ]
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'dsh-knowledge-isolated-' + name, private: true, type: 'module', dependencies: { [manifest.name]: manifest.version, ...(companionManifest ? { [companionManifest.name]: companionManifest.version } : {}) }, dsh: { profile: { bundles: selection.bundles } } }, null, 2))
      fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), JSON.stringify([{ insert: rows.map(([id, name, config]) => ({ id, name, ...(config ? { config } : {}) })) }, ...knowledgeTargetConfigurations(selection, globalKnowledge)], null, 2))
    }
    prepareProfile(profileName, profileDir, installed)
    const outcomes = []
    // Foreign isolation is checked before the resume phase explicitly revokes
    // the publication, while an immutable current record still exists.
    for (const mode of ['core', 'foreign', 'resume']) {
      let selectedProfile = profileName
      if (mode === 'foreign') {
        selectedProfile = 'knowledge-foreign'
        const foreignDir = mkdir('dsh-home/profiles/' + selectedProfile), foreignInstalled = path.join(foreignDir, 'node_modules', selection.packageName)
        fs.cpSync(installed, foreignInstalled, { recursive: true, errorOnExist: true, force: false })
        if (companionInstalled) fs.cpSync(companionInstalled, path.join(foreignDir, 'node_modules', companionManifest.name), { recursive: true, errorOnExist: true, force: false })
        prepareProfile(selectedProfile, foreignDir, foreignInstalled)
      }
      const resultFile = inside(mode + '-result.json'); write('phase.json', { mode, resultFile, ownerId: owner.id })
      const cliArgs = ['--expose-internals', '--require', path.join(frozenScripts, 'network-guard.cjs'), cli, '--profile', selectedProfile]
      const stdout = fs.openSync(inside(mode + '-stdout.log'), 'wx'), stderr = fs.openSync(inside(mode + '-stderr.log'), 'wx')
      try { child = spawn(executable, cliArgs, { cwd: projects.A, env, windowsHide: true, stdio: ['ignore', stdout, stderr] }) } finally { fs.closeSync(stdout); fs.closeSync(stderr) }
      write(mode + '-launch.json', { pid: child.pid, executable, args: cliArgs, cwd: projects.A, profile: selectedProfile, target: selection.target, bundles: selection.bundles, loadOrder: selection.loadOrder, candidateSha256: hash(snapshot), companionSha256: companionSnapshot ? hash(companionSnapshot) : undefined, nodeVersion: nodeVersion.stdout.trim(), runtimeVersions: versions, cliSha256: hash(cli), runnerSha256: hash(fileURLToPath(import.meta.url)), frozenSupport: support.map(file => ({ path: file, sha256: hash(path.join(frozenScripts, file)) })), networkAllowed: false, maximumStreams: 2, maxRequests: 40, timeoutMs: 120000, environmentNames: Object.keys(env).sort() })
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
      let termination
      try { termination = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) }) } finally { clearTimeout(timer) }
      const sessions = []
      const scan = dir => {
        if (!fs.existsSync(dir)) return
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const filename = path.join(dir, item.name)
          if (item.isSymbolicLink()) throw new Error('Session inventory refuses links')
          if (item.isDirectory()) scan(filename)
          else if (item.isFile() && filename.endsWith('.jsonl')) sessions.push({ path: path.relative(work, filename).replaceAll('\\', '/'), sha256: hash(filename), ...inspectSessionJsonl(fs.readFileSync(filename, 'utf8')) })
        }
      }
      scan(path.join(home, 'sessions-' + selectedProfile)); write(mode + '-session-inventory.json', sessions)
      const result = fs.existsSync(resultFile) ? readJson(resultFile) : undefined
      if (mode === 'resume' && result?.status === 'passed') { const state = readJson(stateFile); state.resumeRootB = result.resumeRootB; write('state.json', state) }
      let nativeJsonlVerified = false, inventoryError
      try { assertNativeInventory(sessions, readJson(stateFile), mode); if (mode === 'core' && selection.compressionProbe) assertCompressionInventory(sessions, result?.compression); nativeJsonlVerified = true } catch (error) { inventoryError = String(error) }
      const networkDenials = fs.existsSync(env.ULTRA_ACCEPTANCE_NETWORK_LOG) ? fs.readFileSync(env.ULTRA_ACCEPTANCE_NETWORK_LOG, 'utf8').trim().split(/\r?\n/u).filter(Boolean).length : 0
      const passed = !timedOut && termination.code === 0 && networkDenials === 0 && nativeJsonlVerified && result?.status === 'passed' && hash(snapshot) === values['candidate-sha256'] && (!companionSnapshot || hash(companionSnapshot) === values['companion-sha256'])
      outcomes.push({ phase: mode, passed, ...termination, timedOut, nativeJsonlVerified, inventoryError, networkDenials, resultStatus: result?.status ?? null }); write('phases.json', outcomes)
      if (!passed) break
    }
    const outcome = { passed: outcomes.length === 3 && outcomes.every(value => value.passed), target: selection.target, compressionProbe: selection.compressionProbe === true, loadOrder: selection.loadOrder, phases: outcomes, candidateSha256: hash(snapshot), companionSha256: companionSnapshot ? hash(companionSnapshot) : undefined, elapsedMs: Date.now() - started, work, maximumSimultaneousStreams: 2, maximumRequestsPerProcess: 40, maximumProcesses: 3, networkAllowed: false }
    write('outcome.json', outcome); console.log(JSON.stringify(outcome, null, 2)); if (!outcome.passed) process.exitCode = 1
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    write('runner-error.json', { error: String(error), stack: error.stack, elapsedMs: Date.now() - started }); throw error
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
