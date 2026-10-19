import test from 'node:test'
import assert from 'node:assert/strict'
import { DecisionGovernance } from '../lib/decision-governance.js'

function plan(controller) {
  const item = { id: 'requested', text: 'Read A; do not publish.', provenance: 'user', quote: 'Read A; do not publish.', sourceId: 'user-source' }
  return JSON.stringify({ assignments: ['Read A', 'Independently verify A'], intent: { goals: [item], constraints: [], acceptance: [{ ...item, id: 'check-A' }], assumptions: [] } })
}
function directive(controller, extra = {}) {
  return { taskRevision: controller.contract.revision, taskHash: controller.contract.sha256, targetRouteId: 'worker', type: 'verify',
    reason: 'The tool returned conflicting evidence', evidenceIds: ['tool-source'], instruction: 'Check A independently', stopCondition: 'Stop after the independent receipt', ttlMs: 60000, ...extra }
}

test('governed planning retains original task and separates model additions without new model calls', () => {
  const controller = new DecisionGovernance('Read A; do not publish.', 'user-source')
  assert.deepEqual(controller.parsePlan(plan(controller), 2), ['Read A', 'Independently verify A'])
  assert.equal(controller.contract.originalTask, 'Read A; do not publish.')
  assert.ok(controller.contract.intent.acceptance.some(item => item.id === 'task-result'))
  assert.match(controller.contractEntry(), /do not publish/)
  assert.equal(controller.parsePlan(JSON.stringify({ assignments: ['a', 'b'], intent: { goals: [] } }), 2), undefined)
  assert.equal(controller.contract.originalTask, 'Read A; do not publish.')
})

test('only host-observed sources and active routes may steer; a duplicate is never sent twice', () => {
  const controller = new DecisionGovernance('Read A; do not publish.', 'user-source')
  let deliveries = 0, metadata
  const send = (_id, _instruction, value) => { deliveries++; metadata = value; return true }
  const json = value => JSON.stringify({ assessment: 'A needs independent verification', directives: [value] })
  assert.throws(() => controller.coordinate(json(directive(controller)), new Set(['worker']), send), /无有效诊断建议/)
  assert.equal(deliveries, 0)
  controller.recordProgress({ sessionId: 'worker', sequence: 1, kind: 'tool', text: 'A original result', evidenceIds: ['tool-source'], at: 1 })
  controller.coordinate(json(directive(controller)), new Set(['worker']), send)
  assert.equal(deliveries, 1)
  assert.equal(controller.snapshot().diagnostics[0].status, 'queued')
  metadata.onDelivery('admitted', 'native-message')
  metadata.onDelivery('request-visible', 'native-request')
  assert.equal(controller.snapshot().diagnostics[0].status, 'request-visible')
  assert.notEqual(controller.snapshot().diagnostics[0].status, 'effect-verified')
  controller.coordinate(json(directive(controller)), new Set(['worker']), send)
  assert.equal(deliveries, 1)
})

test('self-reports and user instructions cannot stand in for actual tool evidence during acceptance', () => {
  const controller = new DecisionGovernance('Read A; do not publish.', 'user-source')
  controller.recordProgress({ sessionId: 'worker', sequence: 1, kind: 'assistant', text: 'I passed', evidenceIds: ['self-report'], at: 1 })
  const review = evidenceIds => JSON.stringify({ output: 'A reviewed.', verification: { criteria: [{ criterionId: 'task-result', status: 'satisfied', evidenceIds, reason: 'Checked the actual receipt' }] } })
  assert.equal(controller.review(review(['self-report'])).valid, false)
  controller.recordProgress({ sessionId: 'worker', sequence: 2, kind: 'tool', text: 'Actual receipt', evidenceIds: ['tool-source'], at: 2 })
  const accepted = controller.review(review(['tool-source']))
  assert.equal(accepted.valid, true)
  assert.equal(accepted.verification.hostVerified, false)
  assert.equal(accepted.verification.assessment, 'model')
})

test('closing the invocation cancels pending directions and late receipts cannot resurrect them', () => {
  const controller = new DecisionGovernance('Read A; do not publish.', 'user-source')
  controller.recordProgress({ sessionId: 'worker', sequence: 1, kind: 'tool', text: 'Actual receipt', evidenceIds: ['tool-source'], at: 1 })
  let metadata
  controller.coordinate(JSON.stringify({ assessment: 'Check', directives: [directive(controller)] }), new Set(['worker']), (_id, _text, value) => { metadata = value; return true })
  controller.close('cancelled')
  metadata.onDelivery('request-visible', 'late-request')
  assert.equal(controller.snapshot().diagnostics[0].status, 'cancelled')
  let delivered = false
  controller.coordinate(JSON.stringify({ assessment: 'Check', directives: [directive(controller)] }), new Set(['worker']), () => { delivered = true; return true })
  assert.equal(delivered, false)
})

test('a duplicate route cannot replace an already dispatched direction in the same response', () => {
  const controller = new DecisionGovernance('Read A; do not publish.', 'user-source')
  controller.recordProgress({ sessionId: 'worker', sequence: 1, kind: 'tool', text: 'Actual receipts', evidenceIds: ['tool-source', 'tool-second'], at: 1 })
  const deliveries = []
  controller.coordinate(JSON.stringify({ assessment: 'Check', directives: [directive(controller), directive(controller, {
    evidenceIds: ['tool-second'], instruction: 'A conflicting same-round direction', replaces: 'directive:1',
  })] }), new Set(['worker']), (_id, _text, meta) => { deliveries.push(meta); return true })
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].isCurrent(), true)
  assert.equal(controller.snapshot().diagnostics.length, 1)
  assert.match(controller.snapshot().errors.join('\n'), /同一轮重复/)
})

test('invalid diagnosis is a failed round, while a valid empty response is a no-op', () => {
  const controller = new DecisionGovernance('Read A; do not publish.', 'user-source')
  for (let i = 0; i < 3; i++) assert.throws(() => controller.coordinate(JSON.stringify({ assessment: 'Legacy response',
    directives: [{ routeId: 'worker', instruction: 'try again' }] }), new Set(['worker']), () => assert.fail('invalid dispatch')), /无有效诊断建议/)
  assert.equal(controller.coordinate(JSON.stringify({ assessment: 'No new evidence', directives: [] }), new Set(['worker']), () => assert.fail('no-op dispatch')).directives.length, 0)
})
