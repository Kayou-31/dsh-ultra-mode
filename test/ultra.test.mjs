/**
 * Policy tests for dsh-ultra-mode (`npm test`).
 *
 * These exercise the pure policy module only — no Cordis runtime, no network,
 * no LLM. Run after `npm run build` (the tests import the compiled `lib/`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMergePrompt,
  buildWorkerBrief,
  clampConcurrency,
  countUsable,
  fallbackJoin,
  isRunning,
  planMerge,
  renderUltraSection,
  resolveSessionKey,
  runBanner,
  snapshotOf,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
} from '../lib/ultra.js'

const state = (over = {}) => ({ enabled: true, concurrency: 3, activeRuns: 0, lastRun: null, ...over })
const ok = (text) => ({ ok: true, text })
const bad = (error) => ({ ok: false, error })

test('clampConcurrency keeps values inside [2,5]', () => {
  assert.equal(clampConcurrency(2), 2)
  assert.equal(clampConcurrency(5), 5)
  assert.equal(clampConcurrency(1), MIN_CONCURRENCY)
  assert.equal(clampConcurrency(99), MAX_CONCURRENCY)
  assert.equal(clampConcurrency('4'), 4)
})

test('clampConcurrency falls back to 3 for junk', () => {
  assert.equal(clampConcurrency(undefined), 3)
  assert.equal(clampConcurrency(null), 3)
  assert.equal(clampConcurrency(3.5), 3)
  assert.equal(clampConcurrency('abc'), 3)
  assert.equal(clampConcurrency(NaN), 3)
})

test('resolveSessionKey rejects blank/non-string instead of sharing a bucket', () => {
  assert.equal(resolveSessionKey('session-a'), 'session-a')
  assert.equal(resolveSessionKey('  session-b  '), 'session-b')
  assert.equal(resolveSessionKey(''), undefined)
  assert.equal(resolveSessionKey('   '), undefined)
  assert.equal(resolveSessionKey(undefined), undefined)
  assert.equal(resolveSessionKey(null), undefined)
  assert.equal(resolveSessionKey(42), undefined)
})

test('isRunning tracks overlapping invocations', () => {
  assert.equal(isRunning(state({ activeRuns: 0 })), false)
  assert.equal(isRunning(state({ activeRuns: 1 })), true)
  assert.equal(isRunning(state({ activeRuns: 2 })), true)
})

test('snapshotOf is a detached plain object', () => {
  const live = state({ activeRuns: 2, lastRun: { at: 1, ms: 2 } })
  const snap = snapshotOf(live)
  assert.deepEqual(snap, { enabled: true, concurrency: 3, running: true, activeRuns: 2, lastRun: { at: 1, ms: 2 } })
  live.activeRuns = 0
  assert.equal(snap.activeRuns, 2, 'snapshot must not follow later mutation')
})

test('countUsable ignores completed-but-empty output', () => {
  assert.equal(countUsable([ok('x'), ok(''), ok('   '), bad('boom')]), 1)
  assert.equal(countUsable([]), 0)
})

test('planMerge: <2 usable workers is insufficient (no silent degradation)', () => {
  const plan = planMerge([ok('only one'), bad('x'), bad('y')], 3)
  assert.deepEqual(plan, { requested: 3, succeeded: 1, failed: 2, strategy: 'insufficient' })
})

test('planMerge: partial success degrades and is reported', () => {
  const plan = planMerge([ok('a'), ok('b'), bad('c')], 3)
  assert.deepEqual(plan, { requested: 3, succeeded: 2, failed: 1, strategy: 'degraded' })
  assert.match(runBanner(plan), /启动 3 路，成功 2 路，失败 1 路/)
})

test('planMerge: full success has no banner', () => {
  const plan = planMerge([ok('a'), ok('b'), ok('c')], 3)
  assert.equal(plan.strategy, 'full')
  assert.equal(runBanner(plan), '')
})

test('planMerge counts empty completions as failures', () => {
  const plan = planMerge([ok('a'), ok(''), ok('b')], 3)
  assert.equal(plan.succeeded, 2)
  assert.equal(plan.failed, 1)
})

test('buildMergePrompt states requested vs succeeded', () => {
  const outcomes = [ok('alpha'), bad('boom'), ok('beta')]
  const prompt = buildMergePrompt('任务原文', outcomes, planMerge(outcomes, 3))
  assert.match(prompt, /2 个独立 agent/)
  assert.match(prompt, /请求 3 路，实际只有 2 路成功/)
  assert.match(prompt, /任务原文/)
  assert.match(prompt, /alpha/)
  assert.doesNotMatch(prompt, /boom/)
})

test('buildMergePrompt truncates each worker at 20000 chars', () => {
  const long = 'x'.repeat(25000)
  const prompt = buildMergePrompt('t', [ok(long), ok('y')], planMerge([ok(long), ok('y')], 2))
  assert.ok(prompt.length < 41000, `prompt too long: ${prompt.length}`)
  assert.match(prompt, /x{20000}/)
})

test('fallbackJoin keeps every usable sample and drops failures', () => {
  const joined = fallbackJoin([ok('one'), bad('nope'), ok('two')])
  assert.match(joined, /分支 1/)
  assert.match(joined, /one/)
  assert.match(joined, /分支 2/)
  assert.match(joined, /two/)
  assert.doesNotMatch(joined, /nope/)
})

test('buildWorkerBrief embeds the task and forbids meta talk', () => {
  const brief = buildWorkerBrief('分析架构')
  assert.match(brief, /分析架构/)
  assert.match(brief, /不要提及/)
})

test('renderUltraSection: no state means no section text', () => {
  assert.equal(renderUltraSection(undefined, 'ultra_task'), '')
})

test('renderUltraSection: disabled state is explicit about being off', () => {
  const text = renderUltraSection(state({ enabled: false }), 'ultra_task')
  assert.match(text, /开关为关闭/)
  assert.match(text, /明确要求/)
})

test('renderUltraSection: enabled state injects the live switch position', () => {
  const text = renderUltraSection(state({ enabled: true, concurrency: 4 }), 'ultra_task')
  assert.match(text, /ULTRA 当前状态：已开启/)
  assert.match(text, /并发数：4/)
  assert.match(text, /本轮必须先调用 ultra_task/)
  assert.match(text, /仅调用一次/)
})

test('renderUltraSection: overlapping runs are surfaced', () => {
  const text = renderUltraSection(state({ activeRuns: 2 }), 'ultra_task')
  assert.match(text, /2 次 ULTRA 正在执行中/)
})
