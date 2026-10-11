import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { compareReports, exportCase, filesUnder, fixtureDigest, getCases, repoRoot, validateGrade, validateMetrics } from '../benchmarks/lib.mjs'

const parent = path.join(repoRoot, '.benchmark-runs')
await mkdir(parent, { recursive: true })
const scratch = await mkdtemp(path.join(parent, 'framework-'))
const cli = path.join(repoRoot, 'scripts', 'benchmarks.mjs')
const run = (...args) => new Promise((resolve, reject) => execFile(process.execPath, [cli, ...args], {
  encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false,
}, (error, stdout, stderr) => {
  if (error && typeof error.code !== 'number') return reject(error)
  resolve({ status: error?.code ?? 0, stdout, stderr })
}))
const grade = (passed = true) => ({ caseId: 'fixture', passed: Number(passed), total: 1,
  checks: [{ id: 'tenant-isolation', passed, category: 'critical', message: 'isolation check' }],
  criticalFailures: passed ? [] : ['tenant-isolation'] })
const report = (mode, passed = true) => ({ schemaVersion: 1, caseId: 'fixture',
  fixtureSha256: 'a'.repeat(64), variant: 'faulty', provenanceVerified: true, model: 'same-model', mode,
  result: grade(passed), accepted: passed, metrics: null })

test('challenge export excludes organizer answers and preserves frozen provenance', async () => {
  const [fixture] = await getCases()
  assert.ok(fixture, 'At least one committed fixture is required')
  const exported = await exportCase(fixture.id, path.join(scratch, 'challenge'))
  const paths = (await filesUnder(exported.workspace)).map(filename => path.relative(exported.workspace, filename).replaceAll('\\', '/'))
  assert.ok(paths.some(name => name.endsWith('.md')))
  assert.ok(paths.some(name => name.startsWith('src/')))
  assert.ok(paths.every(name => !/(^|\/)(organizer|reference|grade\.mjs|case\.json)(\/|$)/.test(name)))
  const metadata = JSON.parse(await readFile(path.join(exported.workspace, '.ultra-benchmark.json'), 'utf8'))
  assert.equal(metadata.fixtureSha256, await fixtureDigest(fixture.directory))
  assert.equal(metadata.organizerIncluded, false)
  assert.equal(metadata.caseId, fixture.id)
  assert.deepEqual(metadata.exportedFiles.sort(), paths.filter(name => name !== '.ultra-benchmark.json').sort())
})

test('export rejects existing user directories without replacing their contents', async () => {
  const [fixture] = await getCases()
  const directory = path.join(scratch, 'existing')
  await mkdir(directory)
  const original = path.join(directory, 'user-notes.txt')
  await writeFile(original, 'preserve this file')
  await assert.rejects(exportCase(fixture.id, directory), { code: 'EEXIST' })
  assert.equal(await readFile(original, 'utf8'), 'preserve this file')
  await assert.rejects(exportCase(fixture.id, path.join(repoRoot, 'src', 'export-attempt')), /protected repository/)
})

test('fixture fingerprint normalizes Windows line endings and detects content changes', async () => {
  const windows = path.join(scratch, 'windows-text')
  const unix = path.join(scratch, 'unix-text')
  await mkdir(windows)
  await mkdir(unix)
  await writeFile(path.join(windows, 'SPEC.md'), 'rules\r\n14 days\r\n')
  await writeFile(path.join(unix, 'SPEC.md'), 'rules\n14 days\n')
  assert.equal(await fixtureDigest(windows), await fixtureDigest(unix))
  await writeFile(path.join(unix, 'SPEC.md'), 'rules\n7 days\n')
  assert.notEqual(await fixtureDigest(windows), await fixtureDigest(unix))
})

test('fixture traversal refuses directory links instead of copying their targets', async t => {
  const tree = path.join(scratch, 'linked-tree')
  const target = path.join(scratch, 'link-target')
  await mkdir(tree)
  await mkdir(target)
  await writeFile(path.join(target, 'answer.txt'), 'outside fixture')
  try { await symlink(target, path.join(tree, 'linked'), 'dir') }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Environment does not allow creating directory links')
    throw error
  }
  await assert.rejects(filesUnder(tree), /Symbolic links/)
})

test('grader schema rejects false totals, duplicate checks and impossible critical failures', () => {
  assert.equal(validateGrade(grade(false), 'fixture').passed, 0)
  assert.throws(() => validateGrade({ ...grade(), passed: 0 }, 'fixture'), /Invalid grader result/)
  assert.throws(() => validateGrade({ ...grade(), checks: [...grade().checks, ...grade().checks], total: 2, passed: 2 }, 'fixture'), /Invalid check record/)
  assert.throws(() => validateGrade({ ...grade(), criticalFailures: ['tenant-isolation'] }, 'fixture'), /Invalid critical failure/)
})

test('comparison rejects mismatched fixtures, models and same-sized different check sets', () => {
  const left = report('max')
  const right = report('ultra-3')
  assert.throws(() => compareReports({ ...left, provenanceVerified: false }, { ...right, provenanceVerified: false }), /verified provenance/)
  assert.throws(() => compareReports({ ...left, variant: 'unrecorded' }, { ...right, variant: 'unrecorded' }), /verified provenance/)
  assert.throws(() => compareReports(left, { ...right, fixtureSha256: 'b'.repeat(64) }), /same frozen case/)
  assert.throws(() => compareReports(left, { ...right, variant: 'clean' }), /same frozen case/)
  assert.throws(() => compareReports(left, { ...right, model: 'other-model' }), /model labels differ/)
  const altered = structuredClone(right)
  altered.result.checks[0].id = 'unrelated-check'
  assert.throws(() => compareReports(left, altered), /check sets differ/)
})

test('missing telemetry stays unknown and comparison derives acceptance from actual checks', () => {
  const left = report('max', false)
  left.accepted = true
  const result = compareReports(left, report('ultra-3'))
  assert.equal(result.left.accepted, false)
  assert.equal(result.left.metrics, null)
  assert.equal(result.costAndTimeMetricsComplete, false)
  assert.equal(result.modelLabelsIndependentlyVerified, false)
  const metrics = { complete: true, durationMs: 1000, inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 }
  assert.equal(compareReports({ ...left, metrics }, { ...report('ultra-3'), metrics }).costAndTimeMetricsComplete, true)
})

test('telemetry rejects invalid numbers, false completeness and impossible cache counts', () => {
  assert.throws(() => validateMetrics({ complete: 'yes' }), /Invalid metrics object/)
  assert.throws(() => validateMetrics({ inputTokens: -1 }), /Invalid metric/)
  assert.throws(() => validateMetrics({ inputTokens: 5, cachedInputTokens: 6 }), /cannot exceed/)
  assert.throws(() => validateMetrics({ durationMs: Infinity }), /Invalid metric/)
  assert.throws(() => validateMetrics([]), /Invalid metrics object/)
})

test('CLI rejects duplicate and unknown flags and preserves an existing report', async () => {
  const duplicate = await run('export', '--case', 'first', '--case', 'second', '--out', scratch)
  assert.equal(duplicate.status, 1)
  assert.match(duplicate.stderr, /unique --name value pairs/)
  const unknown = await run('list', '--model', 'irrelevant')
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /Unknown option/)
  const leftPath = path.join(scratch, 'left.json')
  const rightPath = path.join(scratch, 'right.json')
  const existing = path.join(scratch, 'existing-report.json')
  await writeFile(leftPath, JSON.stringify(report('max')))
  await writeFile(rightPath, JSON.stringify(report('ultra-3')))
  await writeFile(existing, 'user-owned result')
  const result = await run('compare', '--left', leftPath, '--right', rightPath, '--report', existing)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /EEXIST/)
  assert.equal(await readFile(existing, 'utf8'), 'user-owned result')
})
