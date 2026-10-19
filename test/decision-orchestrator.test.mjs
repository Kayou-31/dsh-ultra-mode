import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { runUltra } from '../lib/orchestrator.js'

test('same decision extracts intent, diagnoses evidence, delivers steering and verifies without a separate optimizer', async () => {
  const task = 'Read A independently; do not publish.'
  const hash = createHash('sha256').update(task).digest('hex')
  const done = Promise.withResolvers()
  let turn = 0, workerCount = 0, directions = 0, latestSource
  const factory = async (_parent, options) => {
    let progress
    return { id: options.id, setReadOnly() {}, dispose: async () => {}, subscribeProgress(fn) { progress = fn; return () => {} },
      steer(_instruction, meta) { directions++; assert.equal(meta.isCurrent(), true); meta.onDelivery('admitted', 'native-message'); meta.onDelivery('request-visible', 'native-request'); done.resolve(); return true },
      async run(prompt) {
        if (options.label === 'Ultra decision') {
          turn++
          const text = prompt.map(item => item.text ?? '').join('\n')
          if (turn === 1) {
            latestSource = JSON.parse(text.match(/sourceId=("[^"]+")/)[1])
            const item = { id: 'goal', text: task, quote: task, provenance: 'user', sourceId: latestSource }
            return { ok: true, sessionId: options.id, text: JSON.stringify({ assignments: ['Inspect A', 'Verify A independently'], intent: { goals: [item], constraints: [], acceptance: [{ ...item, id: 'criterion-A' }], assumptions: [] } }) }
          }
          if (turn === 2) return { ok: true, sessionId: options.id, text: JSON.stringify({ assessment: 'The first two receipts expose duplicate work', directives: [{ taskRevision: 1, taskHash: hash,
            targetRouteId: text.match(/"routeId":"(ultra-route-[^"]+)"/)[1], type: 'verify', reason: 'Observed duplicate receipt', evidenceIds: ['src_tool_A'], instruction: 'Read independent verification receipt', stopCondition: 'Stop after verification', ttlMs: 60000 }] }) }
          assert.equal(turn, 3)
          assert.match(text, /task-result/)
          return { ok: true, sessionId: options.id, text: JSON.stringify({ output: 'Readback complete; publication not performed.', verification: { criteria: [
            { criterionId: 'task-result', status: 'unverified', evidenceIds: [], reason: 'Business success was not independently verified' },
            { criterionId: 'criterion-A', status: 'satisfied', evidenceIds: ['src_tool_A'], reason: 'Actual tool receipt' },
          ] } }) }
        }
        workerCount++
        progress({ sessionId: options.id, sequence: 1, kind: 'tool', text: 'Observed duplicate A receipt', at: Date.now(), evidenceIds: ['src_tool_A'] })
        await done.promise
        return { ok: true, sessionId: options.id, text: 'Public research report', evidenceIds: ['src_tool_A'] }
      },
    }
  }
  const result = await runUltra({ toolName: 'ultra_task', timeoutMs: 3000, reportChars: 2000, researchTools: [], jevEnabled: false,
    coordinationIntervalMs: 100, coordinationMaxRounds: 1, decisionGovernance: true },
  { parent: { ctx: {}, session: { snapshotEvents: () => [] } }, task, content: [], concurrency: 2, signal: new AbortController().signal, phase() {} }, factory)
  assert.equal(workerCount, 2); assert.equal(directions, 1); assert.equal(turn, 3)
  assert.equal(result.governance.contract.originalTask, task)
  assert.equal(result.governance.diagnostics[0].status, 'request-visible')
  assert.equal(result.governance.verification.allSatisfied, false)
  assert.match(result.output, /未验证/)
})

test('invalid governance rounds honor the existing failure limit while workers continue', async () => {
  let phase, rounds = 0
  const task = 'Read A; do not publish.'
  const factory = async (_parent, options) => {
    let progress
    return { id: options.id, setReadOnly() {}, dispose: async () => {},
      subscribeProgress(fn) { progress = fn; return () => {} },
      async run() {
        if (options.label === 'Ultra decision') {
          if (phase === 'planning') return { ok: true, sessionId: options.id, text: JSON.stringify({ assignments: ['Read A', 'Verify A'], intent: { goals: [], constraints: [], acceptance: [], assumptions: [] } }) }
          if (phase === 'coordinating') { rounds++; return { ok: true, sessionId: options.id, text: JSON.stringify({ assessment: 'Old incompatible response', directives: [{ routeId: 'wrong', instruction: 'repeat' }] }) } }
          return { ok: true, sessionId: options.id, text: JSON.stringify({ output: 'Workers finished.', verification: { criteria: [{ criterionId: 'task-result', status: 'unverified', evidenceIds: [], reason: 'No independent acceptance' }] } }) }
        }
        for (let sequence = 1; sequence <= 22; sequence++) {
          progress({ sessionId: options.id, sequence, kind: 'tool', text: 'Fresh progress', at: Date.now(), evidenceIds: ['tool-source'] })
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        return { ok: true, sessionId: options.id, text: 'Worker finished normally' }
      },
    }
  }
  const result = await runUltra({ toolName: 'ultra_task', timeoutMs: 3000, reportChars: 2000, researchTools: [], jevEnabled: false,
    coordinationIntervalMs: 100, coordinationMaxRounds: -1, coordinationFailureLimit: 2, decisionGovernance: true },
  { parent: { ctx: {}, session: { snapshotEvents: () => [] } }, task, content: [], concurrency: 2, signal: new AbortController().signal, phase(value) { phase = value } }, factory)
  assert.equal(rounds, 2)
  assert.equal(result.succeeded, 2)
  assert.match(result.coordination.errors.join('\n'), /连续 2 轮跨路协调失败/)
})
