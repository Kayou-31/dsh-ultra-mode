import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createTaskContract, parseTaskIntent, withTaskIntent, buildIntentInstruction, renderContractEntry, parseVerificationReport, DiagnosticLedger } from '../lib/decision-contract.js'

const task = 'Build the offline report. Preserve all files. Do not publish.'
const contract = () => createTaskContract(task, 'human:original')
const item = (id, text = 'Do not publish.') => ({ id, text, provenance: 'user', quote: text, sourceId: 'human:original' })
const intent = () => ({ goals: [item('goal', 'Build the offline report.')], constraints: [item('no-publish')], acceptance: [item('offline', 'offline report')], assumptions: [{ id: 'guess', text: 'CSV could help.', provenance: 'machine' }] })
const ctx = () => ({ activeIds: new Set(['route:1']), sourceIds: new Set(['e:1', 'e:2']) })
const diagnostic = (c, extra = {}) => ({ taskRevision: c.revision, taskHash: c.sha256, targetRouteId: 'route:1', type: 'verify', reason: 'Check offline evidence.', evidenceIds: ['e:1'], instruction: 'Test without networking.', stopCondition: 'Stop when the offline result is observed.', ttlMs: 100, ...extra })
const taskCheck = (status = 'satisfied', evidenceIds = ['e:1']) => ({ criterionId: 'task-result', status, evidenceIds, reason: 'Whole original task checked against actual result.' })

test('partial extracted acceptance never replaces the whole-original obligation', () => {
  const c = withTaskIntent(contract(), intent())
  assert.equal(c.intent.acceptance[0].id, 'task-result')
  assert.equal(c.intent.acceptance[0].quote, task)
  assert.throws(() => parseVerificationReport({ criteria: [{ criterionId: 'offline', status: 'satisfied', evidenceIds: ['e:1'], reason: 'One partial condition.' }] }, c, new Set(['e:1'])))
})

test('task contract preserves full immutable original, source, and SHA regardless of length', () => {
  const original = `${task}\n${'long context '.repeat(6000)}`
  const c = createTaskContract(original, 'human:original')
  assert.equal(c.originalTask, original)
  assert.equal(c.sha256, createHash('sha256').update(original).digest('hex'))
  assert.equal(c.revision, 1)
  assert.equal(c.intent.acceptance[0].quote, original)
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.intent.acceptance[0]))
  assert.throws(() => { c.originalTask = 'replaced' }, TypeError)
  assert.ok(renderContractEntry(c).includes(original))
})

test('intent is a bounded strict provenance protocol, machine additions do not authorize', () => {
  const c = contract()
  const parsed = parseTaskIntent(JSON.stringify(intent()), c)
  assert.equal(parsed.assumptions[0].provenance, 'machine')
  for (const bad of [
    { ...intent(), summary: 'override task' },
    { ...intent(), constraints: [item('fake', 'Publish now.')] },
    { ...intent(), constraints: [{ ...item('wrong-source'), sourceId: 'model:1' }] },
    { ...intent(), assumptions: [{ ...item('fake-machine'), provenance: 'machine' }] },
    { ...intent(), goals: [{ ...item('goal'), authorized: true }] },
    { ...intent(), goals: [item('same')], acceptance: [item('same')] },
    { ...intent(), goals: [{ ...item('bad-quote'), quote: '' }] },
    { ...intent(), goals: [{ ...item('inverted'), text: 'Publish now.' }] },
    { ...intent(), acceptance: [item('task-result', 'offline report')] },
    { ...intent(), acceptance: [{ id: 'task-result', text: 'CSV is compulsory', provenance: 'machine' }] },
  ]) assert.throws(() => parseTaskIntent(bad, c))
  assert.throws(() => parseTaskIntent({ ...intent(), goals: Array.from({ length: 33 }, (_, n) => item(`g${n}`)) }, c))
})

test('parsed intent adds context without replacing original task or granting machine authorization', () => {
  const c = withTaskIntent(contract(), intent())
  assert.equal(c.originalTask, task)
  assert.equal(c.sha256, contract().sha256)
  assert.equal(c.revision, 1)
  assert.ok(Object.isFrozen(c.intent.constraints))
  assert.match(buildIntentInstruction(c), /machine/)
  assert.ok(renderContractEntry(c).includes('Do not publish.'))
  assert.throws(() => withTaskIntent(c, { ...intent(), acceptance: [] }))
})

test('verification requires complete criteria coverage and real known evidence for claims', () => {
  const c = withTaskIntent(contract(), intent())
  const raw = { criteria: [taskCheck(), { criterionId: 'offline', status: 'satisfied', evidenceIds: ['e:1'], reason: 'Offline execution log.' }] }
  const report = parseVerificationReport(raw, c, new Set(['e:1']))
  assert.equal(report.allSatisfied, true)
  assert.equal(report.hostVerified, false)
  assert.equal(report.assessment, 'model')
  for (const bad of [
    { criteria: [] },
    { ...raw, hostVerified: true },
    { criteria: [taskCheck(), { ...raw.criteria[1], evidenceIds: [] }] },
    { criteria: [taskCheck(), { ...raw.criteria[1], evidenceIds: ['fake'] }] },
    { criteria: [taskCheck(), { ...raw.criteria[1], criterionId: 'not-a-criterion' }] },
    { criteria: [taskCheck(), raw.criteria[1], raw.criteria[1]] },
    { criteria: [taskCheck(), { ...raw.criteria[1], status: 'failed', evidenceIds: [] }] },
  ]) assert.throws(() => parseVerificationReport(bad, c, new Set(['e:1'])))
  assert.equal(parseVerificationReport({ criteria: [taskCheck('unverified', []), { ...raw.criteria[1], status: 'unverified', evidenceIds: [] }] }, c, new Set()).allSatisfied, false)
})

test('machine acceptance checks never become required coverage or block user completion', () => {
  const c = withTaskIntent(contract(), { ...intent(), acceptance: [item('offline', 'offline report'), { id: 'optional-csv', text: 'CSV export', provenance: 'machine' }] })
  const userCheck = { criterionId: 'offline', status: 'satisfied', evidenceIds: ['e:1'], reason: 'Observed offline result.' }
  assert.equal(parseVerificationReport({ criteria: [taskCheck(), userCheck] }, c, new Set(['e:1'])).allSatisfied, true)
  assert.equal(parseVerificationReport({ criteria: [taskCheck(), userCheck, { criterionId: 'optional-csv', status: 'failed', evidenceIds: ['e:1'], reason: 'No CSV; optional suggestion.' }] }, c, new Set(['e:1'])).allSatisfied, true)
  const fallback = withTaskIntent(contract(), { ...intent(), acceptance: [{ id: 'optional-only', text: 'CSV export', provenance: 'machine' }] })
  assert.equal(fallback.intent.acceptance[0].id, 'task-result')
  assert.equal(fallback.intent.acceptance[0].quote, task)
})

test('diagnostic envelopes reject forged lifecycle, old tasks, missing evidence, limits and inactive routes', () => {
  const c = contract(), ledger = new DiagnosticLedger(c, { now: () => 1 })
  for (const extra of [
    { taskRevision: 2 }, { taskHash: 'other-task' }, { targetRouteId: 'route:other' },
    { evidenceIds: ['fake'] }, { evidenceIds: [] }, { status: 'effect-verified' },
    { ttlMs: 600001 }, { ttlMs: 0 }, { ttlMs: NaN }, { instruction: 'x'.repeat(2001) },
    { stopCondition: '' }, { type: 'execute' },
  ]) assert.throws(() => ledger.propose(diagnostic(c, extra), ctx()))
  assert.equal(ledger.records().length, 0)
})

test('diagnostic lifecycle distinguishes queued, admitted, request-visible and host observed effect', () => {
  const c = contract(), ledger = new DiagnosticLedger(c, { now: () => 1 })
  const d = ledger.propose(diagnostic(c), ctx())
  assert.equal(d.status, 'queued')
  assert.throws(() => ledger.recordObservedEffect(d.id, 'effect:1'))
  assert.throws(() => ledger.markRequestVisible(d.id, 'request:1'))
  assert.equal(ledger.admit(d.id).status, 'admitted')
  assert.equal(ledger.markRequestVisible(d.id, 'request:1').status, 'request-visible')
  const effect = ledger.recordObservedEffect(d.id, 'effect:1')
  assert.equal(effect.status, 'effect-verified')
  assert.equal(effect.effectSourceId, 'effect:1')
  assert.equal(effect.requestSourceId, 'request:1')
  assert.ok(Object.isFrozen(effect))
})

test('diagnostic dedup persists across rounds and same-evidence changes cannot oscillate', () => {
  const c = contract(), ledger = new DiagnosticLedger(c, { now: () => 1 })
  const d = ledger.propose(diagnostic(c), ctx())
  assert.equal(ledger.propose(diagnostic(c), ctx()).id, d.id)
  ledger.cancel(d.id, 'route ended')
  assert.equal(ledger.propose(diagnostic(c), ctx()).id, d.id)
  assert.throws(() => ledger.propose(diagnostic(c, { instruction: 'Use networking instead.' }), ctx()))
  assert.equal(ledger.records().length, 1)
})

test('only an explicit valid replacement can supersede pending and needs new evidence', () => {
  const c = contract(), ledger = new DiagnosticLedger(c, { now: () => 1 })
  const d = ledger.propose(diagnostic(c), ctx())
  const update = diagnostic(c, { instruction: 'Inspect the new failure log.', evidenceIds: ['e:1', 'e:2'] })
  assert.throws(() => ledger.propose(update, ctx()))
  assert.throws(() => ledger.propose({ ...update, replaces: 'missing' }, ctx()))
  const replacement = ledger.propose({ ...update, replaces: d.id }, ctx())
  assert.equal(replacement.status, 'queued')
  assert.equal(ledger.records()[0].status, 'cancelled')
  assert.equal(ledger.records()[0].closeReason, 'superseded')
})

test('expiry and cancellation preserve that a directive was already visible and never claim retraction', () => {
  let time = 1
  const c = contract(), ledger = new DiagnosticLedger(c, { now: () => time })
  const d = ledger.propose(diagnostic(c), ctx())
  ledger.admit(d.id)
  ledger.markRequestVisible(d.id, 'request:1')
  time = 101
  assert.throws(() => ledger.recordObservedEffect(d.id, 'effect:1'))
  const expired = ledger.records()[0]
  assert.equal(expired.status, 'expired')
  assert.equal(expired.requestSourceId, 'request:1')
  assert.equal(expired.wasRequestVisible, true)
  const c2 = new DiagnosticLedger(c, { now: () => 1 })
  const d2 = c2.propose(diagnostic(c), ctx())
  c2.admit(d2.id); c2.markRequestVisible(d2.id, 'request:2')
  assert.equal(c2.cancel(d2.id, 'user cancelled').wasRequestVisible, true)
})

test('bounded ledger stops accepting entries without forgetting dedup and observation history', () => {
  const c = contract(), ledger = new DiagnosticLedger(c, { now: () => 1, maxRecords: 1 })
  const d = ledger.propose(diagnostic(c), ctx())
  ledger.cancel(d.id, 'done')
  assert.throws(() => ledger.propose(diagnostic(c, { evidenceIds: ['e:2'], instruction: 'Check second result.' }), ctx()))
  assert.equal(ledger.propose(diagnostic(c), ctx()).id, d.id)
  assert.throws(() => new DiagnosticLedger(c, { maxRecords: 0 }))
})
