import test from 'node:test'
import assert from 'node:assert/strict'
import { longRepairPrompt, hasMeasuredUsage } from './driver.mjs'
import { expected, fixtures, judgeFinal } from './fixture.mjs'

test('interrupted all-zero local usage is unknown, completed or positive provider usage remains measured', () => {
  const zero = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  assert.equal(hasMeasuredUsage({ usage: zero, finish: null }), false)
  assert.equal(hasMeasuredUsage({ usage: zero, finish: { kind: 'error' } }), false)
  assert.equal(hasMeasuredUsage({ usage: null, finish: { kind: 'stop' } }), false)
  assert.equal(hasMeasuredUsage({ usage: zero, finish: { kind: 'stop' } }), true)
  assert.equal(hasMeasuredUsage({ usage: { ...zero, totalTokens: 2 }, finish: null }), true)
})

test('one-turn repair asks for strict original citations without disclosing expected facts', () => {
  assert.equal(typeof longRepairPrompt, 'string')
  for (const value of Object.values(expected)) assert.equal(longRepairPrompt.includes(value), false, 'repair must not supply expected value ' + value)
  assert.match(longRepairPrompt, /一个 JSON 对象/)
  assert.match(longRepairPrompt, /逐字/)
  assert.match(longRepairPrompt, /sourceId/)
  assert.match(longRepairPrompt, /省略/)
})

test('the existing exact quality judge still rejects reformatted citations and trailing prose', () => {
  const answer = { label: expected.label, batch: expected.batch, checksum: expected.checksum,
    conflict: { status: '待确认', left: { id: 'vendor-a', value: expected.left, quote: '发布窗口 = ' + expected.left }, right: { id: 'vendor-b', value: expected.right, quote: '发布窗口 = ' + expected.right } },
    operation: { id: 'fixture-complete-731', execution: 'executed', acceptance: '未验证', repeated: false },
    sources: [{ id: 'payload-alpha', quote: 'MODEL_TAIL_RECORD: batch=' + expected.batch }, { id: 'payload-beta', quote: 'MODEL_TAIL_RECORD: checksum=' + expected.checksum }], footer: expected.footer }
  assert.ok(fixtures[answer.sources[0].id].includes(answer.sources[0].quote))
  assert.equal(judgeFinal(JSON.stringify(answer)).passed, true)
  assert.equal(judgeFinal(JSON.stringify(answer) + '\n已完成。').passed, false)
  answer.conflict.left.quote = answer.conflict.left.quote.replace(' = ', '：')
  assert.equal(judgeFinal(JSON.stringify(answer)).passed, false)
})
