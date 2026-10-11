import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_CONCURRENCY, MAX_CONCURRENCY, routeCount, modeCount, resolveSessionKey, snapshotOf,
  planMerge, tryParseAssignments, parseAssignments, ULTRA_DECISION_INSTRUCTIONS, buildPlanPrompt, buildPlanRepairPrompt, buildWorkerBrief,
  buildDecisionPrompt, fallbackJoin, renderUltraSection,
} from '../lib/ultra.js'

const state = extra => ({ enabled: true, concurrency: 3, activeRuns: 0, phase: 'idle', error: null, lastRun: null, ...extra })
const ok = (text, sessionId = 'route-1') => ({ ok: true, text, sessionId })
const bad = (error, sessionId = 'route-2') => ({ ok: false, text: '', error, sessionId })

test('execution count accepts only 2/3/4/5 and excludes the extra decision route', () => {
  assert.equal(MIN_CONCURRENCY, 2)
  assert.equal(MAX_CONCURRENCY, 5)
  for (const value of [2, 3, 4, 5]) assert.equal(routeCount(value), value)
  for (const value of [1, 6, 3.5, '3', undefined, null, false, NaN, Infinity]) assert.throws(() => routeCount(value), /2、3、4 或 5/)
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

test('planner accepts one strict JSON protocol; invalid plans keep every route original obligations', () => {
  const assignments = ['First concrete task', 'Second concrete task', 'Third concrete task']
  assert.deepEqual(tryParseAssignments(`\n${JSON.stringify({ assignments })}\n`, 3), assignments)
  assert.deepEqual(parseAssignments(JSON.stringify({ assignments }), 3), assignments)
  for (const response of ['plain prose', `Plan:\n${JSON.stringify({ assignments })}`, '```json\n' + JSON.stringify({ assignments }) + '\n```', '{"assignments":["only one"]}', '{"assignments":["a","","c"]}', '{"assignments":["a",42,"c"]}', '{"assignments":"route1, route2"}', JSON.stringify({ assignments, extra: true }), JSON.stringify({ assignments }) + JSON.stringify({ assignments })]) {
    assert.equal(tryParseAssignments(response, 3), undefined)
    const fallback = parseAssignments(response, 5)
    assert.equal(fallback.length, 5)
    assert.equal(new Set(fallback).size, 5)
    assert.ok(fallback.every(text => text.trim()))
    fallback.forEach((text, index) => {
      assert.match(text, new RegExp(`稳定编号 i=${index + 1}`))
      for (const phrase of ['原用户任务', '每条路线的全部动作', '原任务明确要求的普通子代理调用', '不得让给其他路线', '避免重复', '完成自身义务后再补充']) assert.ok(text.includes(phrase), phrase)
    })
  }
})

test('one formatting repair preserves fixed per-route duties and bounds invalid response evidence', () => {
  const prompt = buildPlanRepairPrompt('每路自己派一个普通子代理计算对应 i', 2, 'B'.repeat(9000), 3000)
  for (const phrase of ['最多这一次', '固定 i=1..2', '每路必须自己调用', '不能分配成只核对位', '子代理可以直接推理或心算', '恰好 2 个非空字符串的数组', '只有 assignments 字段', '不执行任务或调用工具']) assert.ok(prompt.includes(phrase), phrase)
  assert.ok(prompt.includes('B'.repeat(3000)))
  assert.equal(prompt.includes('B'.repeat(3001)), false)
})

test('planning/worker briefs preserve task, descendant research limits, and subagent ability', () => {
  const plan = buildPlanPrompt('Original user task', 4)
  assert.match(plan, /Original user task/)
  assert.match(plan, /4 条并发执行路线/)
  assert.match(plan, /可以派子代理/)
  assert.match(plan, /不能修改共享文件/)
  const worker = buildWorkerBrief('Original user task', 'Check the evidence', 1, 4, 'Planner context')
  for (const phrase of ['Original user task', 'Check the evidence', 'Planner context', '2/4', '稳定编号 i=2', '优先于规划和改向', '这些动作必须由你自己完成', '你自己的心算或其他路线的子代理不能替代该调用', '后代', '不要写共享文件', '不要调用 ultra_task', '直接推理、心算', '命令被拒绝不等于不能思考', '禁止为替代受限命令继续套子代理', '委派深度限制', '无法恢复就报告证据缺失']) assert.ok(worker.includes(phrase), phrase)
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
  for (const count of [2, 3, 4, 5]) {
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
  assert.equal(modeCount(1), 1)
  assert.equal(modeCount(2), 2)
  assert.throws(() => modeCount(0))
  const assistance = renderUltraSection(state({ concurrency: 1 }))
  assert.match(assistance, /正常的主 Agent/)
  assert.match(assistance, /最终交付职责/)
  assert.doesNotMatch(assistance, /收到 Ultra 决策结果后直接交付/)
})
