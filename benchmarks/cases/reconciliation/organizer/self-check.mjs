import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { grade } from './grade.mjs'
const home = dirname(fileURLToPath(import.meta.url))
const temporary = await mkdtemp(join(home, '.self-check-'))
try {
  const initial = await grade(fileURLToPath(new URL('../challenge/', import.meta.url)))
  const clean = join(temporary, 'clean'), mutant = join(temporary, 'single-defect')
  await cp(new URL('../challenge/', import.meta.url), clean, { recursive: true })
  await cp(new URL('./reference/', import.meta.url), clean, { recursive: true, force: true })
  const reference = await grade(clean)
  await cp(clean, mutant, { recursive: true })
  const file = join(mutant, 'src', 'reconcile.mjs')
  const correct = await readFile(file, 'utf8')
  const changed = correct.replace('date: time.date', 'date: row.occurredAt.slice(0, 10)')
  assert.notEqual(changed, correct)
  await writeFile(file, changed)
  const singleDefect = await grade(mutant)
  assert.ok(initial.passed < initial.total)
  assert.equal(reference.passed, reference.total)
  assert.ok(singleDefect.passed < singleDefect.total)
  assert.ok(singleDefect.checks.some(check => check.id === 'utc-days' && !check.passed))
  const evidence = { caseId: 'reconciliation', nodeVersion: process.version, result: 'passed', groundtruthSource: 'Independent hand-frozen integer and UTC event blueprints', inputRecords: 96, baseline: initial, reference, singleDefect: { defect: 'UTC business day reverted to local timestamp prefix only', ...singleDefect } }
  await writeFile(new URL('./selfcheck.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ caseId: evidence.caseId, result: evidence.result, baseline: `${initial.passed}/${initial.total}`, reference: `${reference.passed}/${reference.total}`, singleDefect: `${singleDefect.passed}/${singleDefect.total}` }))
} finally {
  if (dirname(temporary) !== home || !basename(temporary).startsWith('.self-check-')) throw new Error('unsafe self-check cleanup path')
  await rm(temporary, { recursive: true, force: true })
}
