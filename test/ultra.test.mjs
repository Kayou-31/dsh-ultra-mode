import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_CONCURRENCY, MAX_CONCURRENCY, routeCount, resolveSessionKey, snapshotOf,
  planMerge, parseAssignments, ULTRA_DECISION_INSTRUCTIONS, buildPlanPrompt, buildWorkerBrief,
  buildDecisionPrompt, fallbackJoin, renderUltraSection,
} from '../lib/ultra.js'

const state = extra => ({ enabled: true, concurrency: 3, activeRuns: 0, phase: 'idle', error: null, lastRun: null, ...extra })
const ok = (text, sessionId = 'route-1') => ({ ok: true, text, sessionId })
const bad = (error, sessionId = 'route-2') => ({ ok: false, text: '', error, sessionId })

test('execution count accepts only 3/4/5 and excludes the extra decision route', () => {
  assert.equal(MIN_CONCURRENCY, 3)
  assert.equal(MAX_CONCURRENCY, 5)
  for (const value of [3, 4, 5]) assert.equal(routeCount(value), value)
  for (const value of [2, 6, 3.5, '3', undefined, null, false, NaN, Infinity]) assert.throws(() => routeCount(value), /3、4 或 5/)
})

test('blank/non-string sessions never collapse into one shared identity', () => {
  assert.equal(resolveSessionKey('  session-a  '), 'session-a')
  for (const value of ['', '   ', undefined, null, 42, {}]) assert.equal(resolveSessionKey(value), undefined)
})

test('snapshot owns its run metadata and reports actual active runs', () => {
  const live = state({ activeRuns: 1, phase: 'researching', lastRun: { at: 10, ms: 20, requested: 3, succeeded: 3, runId: 'r' } })
  const snapshot = snapshotOf(live)
  assert.equal(snapshot.running, true)
  live.activeRuns = 0
  live.lastRun.succeeded = 0
  assert.equal(snapshot.activeRuns, 1)
  assert.equal(snapshot.lastRun.succeeded, 3)
  assert.equal(snapshotOf(state()).running, false)
})

test('completed but blank reports do not satisfy the two-report minimum', () => {
  assert.deepEqual(planMerge([ok('one'), ok('   '), bad('failed')], 3), { requested: 3, succeeded: 1, failed: 2, strategy: 'insufficient' })
  assert.deepEqual(planMerge([ok('one'), ok('two'), bad('failed')], 3), { requested: 3, succeeded: 2, failed: 1, strategy: 'degraded' })
  assert.equal(planMerge([ok('one'), ok('two'), ok('three')], 3).strategy, 'full')
})

test('planner JSON preserves exact assignments; invalid prose gets distinct useful fallbacks', () => {
  const assignments = ['First concrete task', 'Second concrete task', 'Third concrete task']
  assert.deepEqual(parseAssignments(`Plan:\n${JSON.stringify({ assignments })}\n`, 3), assignments)
  for (const response of ['plain prose', '{"assignments":["only one"]}', '{"assignments":["a","","c"]}', '{"assignments":["a",42,"c"]}']) {
    const fallback = parseAssignments(response, 5)
    assert.equal(fallback.length, 5)
    assert.equal(new Set(fallback).size, 5)
    assert.ok(fallback.every(text => text.trim()))
  }
})

test('planning/worker briefs preserve task, descendant research limits, and subagent ability', () => {
  const plan = buildPlanPrompt('Original user task', 4)
  assert.match(plan, /Original user task/)
  assert.match(plan, /4 条并发执行路线/)
  assert.match(plan, /可以派子代理/)
  assert.match(plan, /不能修改共享文件/)
  const worker = buildWorkerBrief('Original user task', 'Check the evidence', 1, 4, 'Planner context')
  for (const phrase of ['Original user task', 'Check the evidence', 'Planner context', '2/4', '后代', '不要写共享文件', '不要调用 ultra_task', '直接推理、心算', '命令被拒绝不等于不能思考', '禁止为替代受限命令继续套子代理', '委派深度限制', '无法恢复就报告证据缺失']) assert.ok(worker.includes(phrase), phrase)
})

test('decision brief names partial outcomes and does not expand authorization', () => {
  const outcomes = [ok('A'.repeat(100), 'r1'), bad('creation failed', 'r2'), ok('third evidence', 'r3')]
  outcomes[0].subagents = [{ sessionId: 'observed-child', parentSession: 'r1', origin: 'subagent', delegationDepth: 1 }]
  const prompt = buildDecisionPrompt('User task', outcomes, planMerge(outcomes, 3), 'Jev advisory', 12)
  for (const phrase of ['请求 3 条执行路线，完成报告 2，未取得有效完成报告 1', '不代表业务任务成功数或验证通过数', '完成报告（待核对）', 'r1', 'r2', 'creation failed', 'Jev advisory', '唯一提交者', '不具备新的用户授权', '不要停在研究报告']) assert.ok(prompt.includes(phrase), phrase)
  assert.doesNotMatch(prompt, /成功 2/)
  assert.ok(prompt.includes('A'.repeat(12)))
  assert.equal(prompt.includes('A'.repeat(13)), false)
  assert.match(prompt, /observed-child/)
  assert.match(prompt, /只证明宿主观察到创建/)
  assert.match(prompt, /不能据此计为成功/)
})

test('built-in decision policy governs planning and final review with or without Jev', () => {
  for (const count of [3, 4, 5]) {
    const outcomes = Array.from({ length: count }, (_, i) => ok('Could not verify the requested task', `r${i}`))
    const plan = buildPlanPrompt('Unspecified task', count)
    const decision = buildDecisionPrompt('Unspecified task', outcomes, planMerge(outcomes, count), '', 100)
    assert.ok(plan.startsWith(ULTRA_DECISION_INSTRUCTIONS))
    assert.ok(decision.startsWith(ULTRA_DECISION_INSTRUCTIONS))
    for (const phrase of ['不依赖 Jev', '独立的 Max agent loop', '不计入执行并发数', '不能通过继续套子代理', '不等于用户任务成功', '不得猜造 ID、输出或成功状态', '唯一提交者', '不得擅自增加原任务没有的命令执行条件', '直接心算是有效的独立计算']) assert.ok(plan.includes(phrase), phrase)
    assert.match(decision, new RegExp(`完成报告 ${count}，未取得有效完成报告 0`))
    assert.doesNotMatch(decision, /【可选 Jev 辅助意见/)
  }
  const blank = buildDecisionPrompt('Task', [ok('   ', 'blank')], planMerge([ok('   ')], 3), 'Jev advisory', 10)
  assert.match(blank, /【可选 Jev 辅助意见，待核对】/)
  assert.match(blank, /未取得有效完成报告：无有效输出/)
  assert.doesNotMatch(blank, /完成报告（待核对）/)
})

test('decision failure fallback discloses incomplete delivery and retains useful evidence', () => {
  const fallback = fallbackJoin([ok('first report'), bad('private failure text'), ok('   '), ok('second report')])
  assert.match(fallback, /决策路线失败/)
  assert.match(fallback, /尚未完成统一决策或交付/)
  assert.match(fallback, /first report/)
  assert.match(fallback, /second report/)
  assert.doesNotMatch(fallback, /private failure text/)
})

test('enabled prompt states N Max executions plus one Max decision without recursion', () => {
  assert.equal(renderUltraSection(undefined), '')
  assert.equal(renderUltraSection(state({ enabled: false })), '')
  const prompt = renderUltraSection(state({ concurrency: 5 }))
  assert.match(prompt, /5 条 Max 执行路线 \+ 1 条 Max 决策路线/)
  assert.match(prompt, /不要重做或再次调用 ultra_task/)
})
