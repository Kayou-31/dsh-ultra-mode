/** Deterministic fixture export and grading. This is not a security sandbox. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const repoRoot = fileURLToPath(new URL('../', import.meta.url))
export const casesRoot = path.join(repoRoot, 'benchmarks', 'cases')
const workerPath = fileURLToPath(new URL('./grade-worker.mjs', import.meta.url))
const textExtensions = new Set(['.mjs', '.js', '.json', '.md', '.csv', '.yml', '.txt'])
const marker = '@@ULTRA_BENCHMARK_RESULT@@'
export const within = (parent, target) => {
  const relative = path.relative(parent, target)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}
export async function filesUnder(directory) {
  const output = []
  async function walk(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const filename = path.join(current, entry.name)
      const stat = await lstat(filename)
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in fixture trees: ' + entry.name)
      if (stat.isDirectory()) await walk(filename)
      else if (stat.isFile()) output.push(filename)
      else throw new Error('Unsupported fixture entry: ' + entry.name)
    }
  }
  await walk(directory)
  return output
}
export async function fixtureDigest(directory) {
  const hash = createHash('sha256')
  for (const filename of await filesUnder(directory)) {
    const relative = path.relative(directory, filename).split(path.sep).join('/')
    let content = await readFile(filename)
    if (textExtensions.has(path.extname(filename))) content = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'))
    hash.update(relative + '\0' + content.length + '\0').update(content).update('\0')
  }
  return hash.digest('hex')
}
export async function getCases() {
  const output = []
  for (const entry of (await readdir(casesRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (!entry.isDirectory()) continue
    const directory = path.join(casesRoot, entry.name)
    const manifest = JSON.parse(await readFile(path.join(directory, 'case.json'), 'utf8'))
    if (manifest.schemaVersion !== 1 || manifest.id !== entry.name || !/^[a-z][a-z0-9-]+$/.test(manifest.id)) {
      throw new Error('Invalid case manifest: ' + entry.name)
    }
    for (const key of ['challengeDir', 'referenceDir', 'grader']) {
      if (typeof manifest[key] !== 'string' || !manifest[key] || path.isAbsolute(manifest[key]) ||
          !within(directory, path.resolve(directory, manifest[key]))) throw new Error('Unsafe manifest path: ' + key)
    }
    output.push({ ...manifest, directory })
  }
  return output
}
export async function getCase(id) {
  const found = (await getCases()).find(item => item.id === id)
  if (!found) throw new Error('Unknown case: ' + id)
  return found
}
function assertExportTarget(target) {
  if (path.dirname(target) === target) throw new Error('Cannot export into a filesystem root')
  for (const name of ['benchmarks', 'src', 'lib', 'test', 'scripts', 'docs', '.github', '.git']) {
    if (within(path.join(repoRoot, name), target)) throw new Error('Cannot export into a protected repository directory')
  }
}
async function copyTree(source, target, overlay) {
  for (const filename of await filesUnder(source)) {
    const destination = path.join(target, path.relative(source, filename))
    if (!within(target, destination)) throw new Error('Copy destination escaped export')
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, await readFile(filename), { flag: overlay ? 'w' : 'wx' })
  }
}
export async function exportCase(id, out, variant = 'faulty') {
  if (!['faulty', 'clean'].includes(variant)) throw new Error('Variant must be faulty or clean')
  const item = await getCase(id)
  const target = path.resolve(out)
  assertExportTarget(target)
  // Never replace a user's existing directory, even when it is empty.
  await mkdir(target, { recursive: false })
  const challenge = path.resolve(item.directory, item.challengeDir)
  await copyTree(challenge, target, false)
  if (variant === 'clean') await copyTree(path.resolve(item.directory, item.referenceDir), target, true)
  const relativeFiles = (await filesUnder(target)).map(filename => path.relative(target, filename).split(path.sep).join('/'))
  if (relativeFiles.some(name => /(^|\/)(organizer|reference|grade\.mjs|case\.json)(\/|$)/.test(name))) {
    throw new Error('Organizer material leaked into exported challenge')
  }
  const metadata = { schemaVersion: 1, caseId: id, variant,
    fixtureSha256: await fixtureDigest(item.directory), hashNormalization: 'UTF-8 text CRLF normalized to LF',
    exportedFiles: relativeFiles, organizerIncluded: false }
  await writeFile(path.join(target, '.ultra-benchmark.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' })
  return { ...metadata, workspace: target }
}
export function validateGrade(value, id) {
  if (!value || value.caseId !== id || !Array.isArray(value.checks) || value.checks.length === 0 ||
      !Number.isInteger(value.passed) || value.total !== value.checks.length ||
      value.passed !== value.checks.filter(item => item.passed === true).length ||
      !Array.isArray(value.criticalFailures)) throw new Error('Invalid grader result')
  const ids = new Set()
  for (const check of value.checks) {
    if (typeof check.id !== 'string' || !check.id || ids.has(check.id) || typeof check.passed !== 'boolean' ||
        typeof check.category !== 'string' || typeof check.message !== 'string') throw new Error('Invalid check record')
    ids.add(check.id)
  }
  if (value.criticalFailures.some(checkId => !ids.has(checkId) || value.checks.find(check => check.id === checkId).passed)) {
    throw new Error('Invalid critical failure record')
  }
  return value
}
export function validateMetrics(metrics) {
  if (metrics == null) return
  if (typeof metrics !== 'object' || Array.isArray(metrics) ||
      (metrics.complete != null && typeof metrics.complete !== 'boolean')) throw new Error('Invalid metrics object')
  for (const key of ['durationMs', 'inputTokens', 'outputTokens', 'cachedInputTokens']) {
    if (metrics[key] != null && (!Number.isFinite(metrics[key]) || metrics[key] < 0)) throw new Error('Invalid metric: ' + key)
  }
  if (metrics.cachedInputTokens != null && metrics.inputTokens != null && metrics.cachedInputTokens > metrics.inputTokens) {
    throw new Error('Cached input tokens cannot exceed input tokens')
  }
}
export async function gradeCase(id, workspace, { timeoutMs = 45000, mode, model, metrics } = {}) {
  const item = await getCase(id)
  const candidate = path.resolve(workspace)
  if (!(await lstat(candidate)).isDirectory()) throw new Error('Workspace must be a directory')
  let metadata
  try { metadata = JSON.parse(await readFile(path.join(candidate, '.ultra-benchmark.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const digest = await fixtureDigest(item.directory)
  if (metadata && (metadata.caseId !== id || metadata.fixtureSha256 !== digest)) throw new Error('Export provenance does not match frozen fixture')
  const processResult = spawnSync(process.execPath, [workerPath, path.resolve(item.directory, item.grader), candidate], {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false,
  })
  if (processResult.error || processResult.status !== 0) {
    throw new Error('Grader process failed or timed out: ' + (processResult.error?.code ?? processResult.status))
  }
  const lines = processResult.stdout.split(/\r?\n/).filter(line => line.startsWith(marker))
  if (lines.length !== 1) throw new Error('Missing or ambiguous grader result')
  const result = validateGrade(JSON.parse(lines[0].slice(marker.length)), id)
  validateMetrics(metrics)
  return { schemaVersion: 1, caseId: id, fixtureSha256: digest, variant: metadata?.variant ?? 'unrecorded',
    provenanceVerified: Boolean(metadata), model: model ?? null, mode: mode ?? null,
    modeAndModelLabelsAreUserSupplied: true, metrics: metrics ?? null, metricsIndependentlyAuditedByGrader: false,
    result, accepted: result.passed === result.total && result.criticalFailures.length === 0,
    executionScope: 'Candidate code executed locally; process timeout is not a security sandbox',
    modelRequestsIssuedByGrader: 0 }
}
export function compareReports(left, right) {
  if (left.provenanceVerified !== true || right.provenanceVerified !== true ||
      !['faulty', 'clean'].includes(left.variant) || !['faulty', 'clean'].includes(right.variant)) {
    throw new Error('Comparison requires recorded exports with verified provenance')
  }
  if (left.caseId !== right.caseId || left.fixtureSha256 !== right.fixtureSha256 || left.variant !== right.variant) {
    throw new Error('Comparison needs the same frozen case and input variant')
  }
  if (left.model && right.model && left.model !== right.model) throw new Error('Comparison model labels differ')
  validateGrade(left.result, left.caseId)
  validateGrade(right.result, right.caseId)
  const checkIds = value => JSON.stringify(value.result.checks.map(check => check.id).sort())
  if (checkIds(left) !== checkIds(right)) throw new Error('Comparison check sets differ')
  validateMetrics(left.metrics)
  validateMetrics(right.metrics)
  const summarize = value => ({ mode: value.mode, passed: value.result.passed, total: value.result.total,
    criticalFailures: value.result.criticalFailures.length,
    accepted: value.result.passed === value.result.total && value.result.criticalFailures.length === 0, metrics: value.metrics ?? null })
  const modelMatched = Boolean(left.model && left.model === right.model)
  const costComplete = Boolean(left.metrics?.complete === true && right.metrics?.complete === true &&
    ['inputTokens', 'outputTokens', 'durationMs'].every(key => Number.isFinite(left.metrics[key]) && Number.isFinite(right.metrics[key])))
  return { schemaVersion: 1, caseId: left.caseId, frozenFixtureMatched: true, inputVariantMatched: true,
    modelLabelsMatched: modelMatched, modelLabelsIndependentlyVerified: false, left: summarize(left), right: summarize(right),
    costAndTimeMetricsComplete: costComplete, costAndTimeMetricsIndependentlyVerified: false,
    inference: 'A paired result is descriptive evidence, not a general quality advantage or statistical significance claim' }
}
export async function selftest() {
  const base = path.join(repoRoot, '.benchmark-runs', 'selftest-' + randomUUID())
  await mkdir(base, { recursive: true })
  const results = []
  for (const item of await getCases()) {
    const faulty = await exportCase(item.id, path.join(base, item.id + '-faulty'))
    const clean = await exportCase(item.id, path.join(base, item.id + '-clean'), 'clean')
    const baseline = await gradeCase(item.id, faulty.workspace)
    const reference = await gradeCase(item.id, clean.workspace)
    if (baseline.accepted || !reference.accepted) throw new Error('Fixture selftest failed: ' + item.id)
    results.push({ caseId: item.id, checks: reference.result.total, baselinePassed: baseline.result.passed,
      baselineCriticalFailures: baseline.result.criticalFailures, referencePassed: reference.result.passed,
      referenceAccepted: reference.accepted, fixtureSha256: reference.fixtureSha256 })
  }
  return { schemaVersion: 1, fixtureSelftestPassed: true, cases: results,
    referenceChecks: results.reduce((total, item) => total + item.checks, 0),
    realModelRequests: 0, ultraVsMaxQualityTested: false,
    temporaryExportsRetained: true, exportsDirectory: base }
}
