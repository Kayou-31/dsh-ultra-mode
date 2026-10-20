import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const api = await import('../scripts/host-acceptance/workflow-fixture.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  return {}
})
const ready = { skip: !api.createWorkflowProject }
const sha = value => createHash('sha256').update(value).digest('hex')
function expected(input, phase) {
  const decisionId = 'reconciliation-v' + (1 + [6, 11, 16, 22, 27].filter(start => phase >= start).length)
  if (input.currency !== 'CNY') return { currency: input.currency, itemsCents: null, shippingCents: null, refundCents: null, dueCents: null, balanceCents: null, status: 'rejected-currency', decisionId }
  const itemsCents = input.items.filter(item => phase < 27 || !item.voided).reduce((sum, item) => sum + item.qty * item.unitCents, 0)
  const merchandise = Math.max(0, itemsCents - input.discountCents)
  const shippingCents = phase >= 6 && merchandise >= (phase >= 11 ? 6000 : 5000) ? 0 : input.shippingCents
  const refundCents = phase >= 16 ? Math.min(input.returnedCents, merchandise) : input.returnedCents
  const dueCents = Math.max(0, merchandise + shippingCents - refundCents), balanceCents = input.paidCents - dueCents
  const status = phase >= 22 && input.alternatePaidCents !== undefined && input.alternatePaidCents !== input.paidCents ? 'needs-review' : balanceCents === 0 ? 'settled' : balanceCents > 0 ? 'credit' : 'outstanding'
  return { currency: 'CNY', itemsCents, shippingCents, refundCents, dueCents, balanceCents, status, decisionId }
}
async function fixture(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-project-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const options = { projectDir: path.join(directory, 'orders'), reportRows: 16, seed: 'public-workflow-test', ...extra }
  return { project: await api.createWorkflowProject(options), options }
}
async function implement(project, phase, suffix = '') {
  const entry = project.buildPhaseRequest(phase)
  const specification = JSON.parse((await project.executeWorkflowTool('workflow_read', { id: 'spec-' + phase + suffix, file: entry.files.spec })).text)
  const current = await project.executeWorkflowTool('workflow_read', { id: 'case-' + phase + suffix, file: entry.files.case })
  const cases = specification.requiredCases.map(item => ({ ...item, expected: expected(item.input, phase) }))
  await project.executeWorkflowTool('workflow_patch', { id: 'patch-' + phase + suffix, file: entry.files.case, expectedSha256: current.sha256, content: 'export default ' + JSON.stringify(cases, null, 2) + ';\n' })
  return project.executeWorkflowTool('workflow_test', { id: 'test-' + phase + suffix, phase, verbose: true })
}

test('workflow fixture exposes a real isolated project backend', () => assert.equal(typeof api.createWorkflowProject, 'function'))

test('initialization only reads the two existing base files then ends with a bounded acknowledgement', ready, () => {
  const initial = api.buildInitialRequest()
  assert.match(initial, /初始化确认轮/u)
  assert.match(initial, /只允许workflow_read读取src\/reconcile\.mjs和history\/initial-ledger\.json这两个已存在的基础文件/u)
  assert.match(initial, /不超过100字确认.*立即结束当前轮次.*等待下一条具体阶段任务/u)
  assert.match(initial, /本轮不得.*spec.*case.*workflow_patch.*workflow_test.*workflow_commit/u)
  assert.equal(initial.includes('连续完成30个工程阶段'), false)
  for (const constraint of ['协作', 'CNY', 'seed-reconciled-001', 'bank-vs-ledger', 'unresolved', 'reconciliation-v1', '不联网', '不发布']) assert.ok(initial.includes(constraint))
})

test('thirty meaningful phases span a virtual day and do not repeat initial user constraints in later prompts', ready, async t => {
  const { project } = await fixture(t), initial = project.buildInitialRequest()
  assert.match(initial, /seed-reconciled-001/u)
  assert.match(initial, /CNY/u)
  assert.match(initial, /协作/u)
  const phases = Array.from({ length: 30 }, (_, index) => project.buildPhaseRequest(index + 1))
  assert.ok(Date.parse(phases.at(-1).virtualTimeISO) - Date.parse(phases[0].virtualTimeISO) >= 24 * 60 * 60 * 1000)
  for (const entry of phases) {
    assert.equal(entry.prompt.includes('seed-reconciled-001'), false)
    assert.equal(entry.prompt.includes('"label":"协作"'), false)
    assert.equal(entry.files.case, 'cases/phase-' + String(entry.phase).padStart(2, '0') + '.mjs')
    assert.equal(entry.prompt.includes('用户要求更新：'), [6, 11, 16, 22, 27].includes(entry.phase))
  }
  assert.equal(project.frozenManifest.phaseCount, 30)
  assert.equal(project.frozenManifest.projectKind, 'synthetic-order-reconciliation')
})

test('real Node tests execute distinct order cases and commit only their current tested tree', ready, async t => {
  const { project } = await fixture(t), tested = await implement(project, 1)
  assert.equal(tested.passed, true)
  const lines = tested.text.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(lines.length, 16)
  assert.equal(new Set(lines.map(row => row.input.orderId)).size, 16)
  assert.ok(lines.every(row => row.actualExecution && row.passed))
  assert.equal(sha(tested.text), tested.report.sha256)
  const receipt = await project.executeWorkflowTool('workflow_commit', { id: 'commit-1', phase: 1, expectedSha256: tested.treeSha256, summary: 'Added and tested first reconciliation cases.' })
  assert.equal(receipt.committed, true)
  assert.equal(receipt.duplicate, false)
  assert.equal((await project.inspectPhase(1)).commit.receiptId, receipt.receiptId)
  await assert.rejects(project.executeWorkflowTool('workflow_commit', { id: 'commit-foreign', phase: 2, expectedSha256: tested.treeSha256, summary: 'Untested' }), /test|phase|order/iu)
})

test('guarded writes reject stale hashes, traversal, immutable files and executable case modules', ready, async t => {
  const { project } = await fixture(t)
  const source = await project.executeWorkflowTool('workflow_read', { id: 'read-case', file: 'cases/phase-01.mjs' })
  for (const file of ['../outside.mjs', '/outside.mjs', 'src/reconcile.mjs', 'cases/../cases/phase-01.mjs', 'cases/phase-02.mjs']) await assert.rejects(project.executeWorkflowTool('workflow_patch', { id: 'bad-' + sha(file), file, expectedSha256: source.sha256, content: 'export default [];\n' }), /allow|path|phase|write/iu)
  await assert.rejects(project.executeWorkflowTool('workflow_patch', { id: 'stale', file: 'cases/phase-01.mjs', expectedSha256: 'a'.repeat(64), content: 'export default [];\n' }), /SHA|hash/iu)
  await assert.rejects(project.executeWorkflowTool('workflow_patch', { id: 'executable', file: 'cases/phase-01.mjs', expectedSha256: source.sha256, content: 'import fs from "node:fs"; export default [];' }), /declarative|JSON/iu)
  await assert.rejects(project.executeWorkflowTool('shell', { id: 'shell' }), /unknown|tool/iu)
})

test('model-visible files disclose generic formulas but never future phase policies or private oracle code', ready, async t => {
  const { project } = await fixture(t)
  const core = await project.executeWorkflowTool('workflow_read', { id: 'public-interface', file: 'src/reconcile.mjs' })
  assert.equal(/reconciliation-v[2-6]|phase\s*>=|\[6,\s*11,\s*16/u.test(core.text), false)
  for (const file of ['.workflow/run-tests.mjs', 'scripts/run-tests.mjs', 'specs/phase-06.json', 'cases/phase-11.mjs', 'reports/phase-27.jsonl']) await assert.rejects(project.executeWorkflowTool('workflow_read', { id: 'private-' + sha(file), file }), /allow|private|future|phase/iu)
})

test('patch checkpoint failure is recovered from a durable intent without applying the patch twice', ready, async t => {
  const { project, options } = await fixture(t)
  const read = await project.executeWorkflowTool('workflow_read', { id: 'before-fault', file: 'cases/phase-01.mjs' })
  const args = { id: 'atomic-patch', file: 'cases/phase-01.mjs', expectedSha256: read.sha256, content: 'export default [];\n\n' }
  const rename = fs.rename
  try {
    fs.rename = async (from, to) => { if (to.endsWith(path.join('.workflow', 'state.json'))) { const error = new Error('injected state rename EIO'); error.code = 'EIO'; throw error }; return rename(from, to) }
    await assert.rejects(project.executeWorkflowTool('workflow_patch', args), /injected/u)
  } finally { fs.rename = rename }
  const recovered = await api.createWorkflowProject(options)
  const receipt = await recovered.executeWorkflowTool('workflow_patch', args)
  assert.equal(receipt.duplicate, true)
  assert.equal(receipt.sha256, sha(args.content))
  assert.equal(await fs.readFile(path.join(options.projectDir, args.file), 'utf8'), args.content)
})

test('a completed Node test survives a failed state checkpoint without being executed again', ready, async t => {
  const { project, options } = await fixture(t)
  await implement(project, 1)
  const args = { id: 'test-checkpoint-fault', phase: 1, verbose: true }, rename = fs.rename
  try {
    fs.rename = async (from, to) => { if (to.endsWith(path.join('.workflow', 'state.json'))) throw new Error('injected test state EIO'); return rename(from, to) }
    await assert.rejects(project.executeWorkflowTool('workflow_test', args), /injected/u)
  } finally { fs.rename = rename }
  const recovered = await api.createWorkflowProject(options), receipt = await recovered.executeWorkflowTool('workflow_test', args)
  assert.equal(receipt.duplicate, true)
  assert.equal(receipt.passed, true)
  assert.equal(sha(receipt.text), receipt.report.sha256)
  assert.equal((await recovered.inspectPhase(1)).lastTest.id, args.id)
  const state = JSON.parse(await fs.readFile(path.join(options.projectDir, '.workflow/state.json'), 'utf8')).value
  assert.equal(state.executedTests, 2, 'The second test was completed before EIO and must not become a third execution')
})

test('per-test rows are bounded by the frozen ceiling and preserve the same audited order fact in the middle', ready, async t => {
  const { project } = await fixture(t), first = await implement(project, 1)
  const second = await project.executeWorkflowTool('workflow_test', { id: 'smaller-real-batch', phase: 1, verbose: true, rows: 8 })
  assert.equal(second.report.caseCount, 8)
  const before = first.text.trim().split('\n').map(line => JSON.parse(line)), after = second.text.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(after[4].caseId, 'audit-phase-01')
  assert.deepEqual(after[4].input, before[8].input)
  assert.equal(new Set(after.map(row => row.input.orderId)).size, 8)
  for (const rows of [7, 17, 8.5]) await assert.rejects(project.executeWorkflowTool('workflow_test', { id: 'invalid-rows-' + rows, phase: 1, rows }), /rows|ceiling|budget/iu)
  await assert.rejects(project.executeWorkflowTool('workflow_test', { id: 'test-1', phase: 1, verbose: true }), /report.*superseded|report.*SHA/iu)
})

test('failure to persist a completed test receipt fails closed rather than running the Node test again', ready, async t => {
  const { project, options } = await fixture(t)
  await implement(project, 1)
  const args = { id: 'receipt-completion-fault', phase: 1, verbose: true }, rename = fs.rename
  let pendingWrites = 0
  try {
    fs.rename = async (from, to) => { if (to.endsWith(path.join('.workflow', 'pending-test.json')) && ++pendingWrites === 2) throw new Error('injected completion receipt EIO'); return rename(from, to) }
    await assert.rejects(project.executeWorkflowTool('workflow_test', args), /injected/u)
  } finally { fs.rename = rename }
  await assert.rejects(project.executeWorkflowTool('workflow_test', args), /reopen|checkpoint/iu)
  await assert.rejects(api.createWorkflowProject(options), /unknown|reconciliation/iu)
})

test('failures and a changed post-test tree cannot claim a committed operation', ready, async t => {
  const { project } = await fixture(t)
  const failed = await project.executeWorkflowTool('workflow_test', { id: 'missing-tests', phase: 1, verbose: true })
  assert.equal(failed.passed, false)
  await assert.rejects(project.executeWorkflowTool('workflow_commit', { id: 'failed-commit', phase: 1, expectedSha256: failed.treeSha256, summary: 'Must fail' }), /test/iu)
  const tested = await implement(project, 1)
  const current = await project.executeWorkflowTool('workflow_read', { id: 'read-current', file: 'cases/phase-01.mjs' })
  await project.executeWorkflowTool('workflow_patch', { id: 'changed-after-test', file: 'cases/phase-01.mjs', expectedSha256: current.sha256, content: current.text + '\n' })
  assert.equal((await project.inspectPhase(1)).status, 'pending')
  await assert.rejects(project.executeWorkflowTool('workflow_commit', { id: 'stale-test', phase: 1, expectedSha256: tested.treeSha256, summary: 'Old test' }), /SHA|tree|test/iu)
})

test('restart and duplicate IDs recover receipts without repeating tests, patches or commits', ready, async t => {
  const { project, options } = await fixture(t), tested = await implement(project, 1)
  const args = { id: 'durable-commit', phase: 1, expectedSha256: tested.treeSha256, summary: 'One immutable synthetic commit.' }
  const receipt = await project.executeWorkflowTool('workflow_commit', args)
  const again = await api.createWorkflowProject(options), duplicate = await again.executeWorkflowTool('workflow_commit', args)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.receiptId, receipt.receiptId)
  assert.equal((await again.inspectPhase(1)).commit.receiptId, receipt.receiptId)
  assert.equal((await again.inspectPhase(2)).status, 'pending')
  await assert.rejects(again.executeWorkflowTool('workflow_commit', { ...args, summary: 'Changed same id' }), /idempot|reuse|different/iu)
  await assert.rejects(api.createWorkflowProject({ ...options, seed: 'wrong-seed' }), /frozen|seed|configuration/iu)
})

test('cold recovery reconciles a durable commit receipt after the state checkpoint was interrupted', ready, async t => {
  const { project, options } = await fixture(t), tested = await implement(project, 1)
  const stateFile = path.join(options.projectDir, '.workflow/state.json'), beforeCommit = await fs.readFile(stateFile)
  const args = { id: 'interrupted-checkpoint', phase: 1, expectedSha256: tested.treeSha256, summary: 'Durable receipt, interrupted state checkpoint.' }
  const receipt = await project.executeWorkflowTool('workflow_commit', args)
  await fs.writeFile(stateFile, beforeCommit)
  const recovered = await api.createWorkflowProject(options)
  assert.equal((await recovered.inspectPhase(1)).commit.receiptId, receipt.receiptId)
  const duplicate = await recovered.executeWorkflowTool('workflow_commit', args)
  assert.equal(duplicate.duplicate, true)
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8')).value
  assert.equal(state.executedTests, 1)
  assert.equal(state.committedOperations, 1)
  const inventory = await recovered.executeWorkflowTool('workflow_read', { id: 'status-after-recovery', file: 'status.json' })
  assert.equal(JSON.parse(inventory.text).nextPhase, 2)
})

test('allowlisted relative names cannot follow a directory link outside the synthetic project', ready, async t => {
  const { project, options } = await fixture(t)
  const outside = path.join(path.dirname(options.projectDir), 'outside-cases'), cases = path.join(options.projectDir, 'cases')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'phase-01.mjs'), 'PRIVATE_EXTERNAL_FIXTURE')
  await fs.rename(cases, cases + '-original')
  await fs.symlink(outside, cases, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(project.executeWorkflowTool('workflow_read', { id: 'blocked-link-read', file: 'cases/phase-01.mjs' }), /linked|link/iu)
  assert.equal(await fs.readFile(path.join(outside, 'phase-01.mjs'), 'utf8'), 'PRIVATE_EXTERNAL_FIXTURE')
})

test('final judge needs thirty distinct native compressions as well as completed real project work', ready, async t => {
  const { project } = await fixture(t), answers = [], compressions = []
  for (let phase = 1; phase <= 30; phase++) {
    const tested = await implement(project, phase), receipt = await project.executeWorkflowTool('workflow_commit', { id: 'commit-' + phase, phase, expectedSha256: tested.treeSha256, summary: 'Verified phase ' + phase })
    const target = tested.text.trim().split('\n').map(line => JSON.parse(line)).find(row => row.caseId === project.buildPhaseRequest(phase).targetCaseId)
    const sourceId = 'src_' + sha('native-report-' + phase)
    const revision = 1 + [6, 11, 16, 22, 27].filter(start => phase >= start).length
    const answer = { phase, label: '协作', activeDecisionId: expected(target.input, phase).decisionId, decisionHistory: Array.from({ length: revision }, (_, index) => ({ id: 'reconciliation-v' + (index + 1), status: index + 1 === revision ? 'current' : 'superseded' })), commitReceiptId: receipt.receiptId,
      target: { caseId: target.caseId, dueCents: target.observed.dueCents, balanceCents: target.observed.balanceCents, status: target.observed.status, resultSha256: target.resultSha256 },
      operation: { seedReceiptId: 'seed-reconciled-001', seedRepeated: false }, conflict: { id: 'bank-vs-ledger', status: 'unresolved' }, evidence: { sourceId, quote: JSON.stringify(target) } }
    const retrieval = { sourceId, quote: JSON.stringify(target), text: JSON.stringify(target), sourceSha256: sha('native-wrap-' + phase) }
    const grade = await project.judgePhase({ phase, answer, retrieval })
    assert.equal(grade.passed, true, JSON.stringify(grade))
    const bad = structuredClone(answer); bad.activeDecisionId = 'reconciliation-v1'
    if (phase >= 6) assert.equal((await project.judgePhase({ phase, answer: bad, retrieval })).passed, false)
    answers.push({ phase, answer, retrieval })
    compressions.push({ phase, sessionId: 'native', beforeGeneration: phase - 1, afterGeneration: phase, beforeInputTokens: 420000, afterInputTokens: 30000, beforeTotalTokens: 450000, afterTotalTokens: 60000, rawSourceVerified: true, nativePruneCount: 1 })
  }
  const valid = await project.judgeWorkflow({ phaseAnswers: answers, compressionRecords: compressions })
  assert.equal(valid.qualityPassed, true)
  assert.equal(valid.passed, true)
  assert.equal((await project.judgeWorkflow({ phaseAnswers: answers, compressionRecords: compressions.slice(1) })).passed, false)
  const repeated = compressions.map(value => ({ ...value, afterGeneration: 1 }))
  assert.equal((await project.judgeWorkflow({ phaseAnswers: answers, compressionRecords: repeated })).passed, false)
  const oversized = structuredClone(compressions); oversized[10].beforeTotalTokens = 500001
  assert.equal((await project.judgeWorkflow({ phaseAnswers: answers, compressionRecords: oversized })).passed, false)
  const inclusive = compressions.map(value => ({ ...value, beforeInputTokens: 410000, beforeTotalTokens: 420240 }))
  assert.equal((await project.judgeWorkflow({ phaseAnswers: answers, compressionRecords: inclusive })).passed, true, '420K trigger includes reserves rather than requiring a 420K pure prompt')
  const wrongPhase = structuredClone(compressions); wrongPhase[29].phase = 99
  assert.equal((await project.judgeWorkflow({ phaseAnswers: answers, compressionRecords: wrongPhase })).passed, false)
  const impossible = structuredClone(compressions); impossible[0].beforeInputTokens = 490000; impossible[0].beforeTotalTokens = 450000
  assert.equal((await project.judgeWorkflow({ phaseAnswers: answers, compressionRecords: impossible })).passed, false)
  const wrongHistory = structuredClone(answers); wrongHistory[29].answer.decisionHistory[0].status = 'current'
  assert.equal((await project.judgeWorkflow({ phaseAnswers: wrongHistory, compressionRecords: compressions })).qualityPassed, false)
  await fs.appendFile(path.join(project.frozenManifest.projectDir, 'cases/phase-01.mjs'), '\n// tampered')
  assert.equal((await project.judgeWorkflow({ phaseAnswers: answers, compressionRecords: compressions })).passed, false)
})
