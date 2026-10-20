/** Actual rc.2 AgentLoop + ToolRuntime with a local scripted adapter; no host/profile/network. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const names = ['cordis', 'dsh-scope', 'dsh-agent', 'dsh-agent-loop', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-llm']
let sdk, unavailable
try { sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(process.env.DSH_ULTRA_TEST_SDK
  ? pathToFileURL(resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai', name, 'lib', 'index.js')).href : `@deepseek-ai/${name}`)]))) }
catch (error) { if (process.env.DSH_ULTRA_TEST_SDK || error.code !== 'ERR_MODULE_NOT_FOUND') throw error; unavailable = 'Set DSH_ULTRA_TEST_SDK to the complete rc.2 runtime node_modules for the native AgentLoop proof.' }
const compiled = ts.transpileModule(readFileSync(new URL('../src/runtime.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText

async function fixture(t, { cancelReport = false, rejectReport = false, script, maxCalls = 3 } = {}) {
  const ctx = new sdk.cordis.Context(), requests = [], toolResults = [], controller = new AbortController(), executions = { global: 0, own: 0 }
  for (const [name, config] of [['dsh-llm'], ['dsh-session'], ['dsh-session-projection'], ['dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }], ['dsh-tools', { mode: 'native' }], ['dsh-agent'], ['dsh-agent-loop', { agents: [] }]]) await ctx.plugin(sdk[name].default, config).await()
  ctx.provide('agentPresets', { composeFrom() {} })
  const runtime = {}
  vm.runInNewContext(compiled, { exports: runtime, require: name => name === './memory-host.js' ? { memoryFor: () => undefined } : sdk[name.replace('@deepseek-ai/', '')], Map, Set, Error, TypeError, String, Promise })
  ctx.get('tools').guard(exec => runtime.researchToolDenial(exec.agent, exec.name))
  let number = 0
  class Offline extends sdk['dsh-llm'].LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: 'Offline script', context: { contextWindow: 1000000 }, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } } }
    async *stream(options) {
      requests.push({ maxTokens: options.maxTokens, effort: options.reasoningEffort, tools: (options.tools ?? []).map(tool => tool.name) })
      assert.ok(requests.length <= maxCalls, 'native fixture exceeded the expected request count')
      const submission = requests.length === 1 ? { report: 'invalid original ID', evidenceIds: ['src_forged'] } : { report: 'Existing evidence is insufficient for verification.', unknowns: ['No independent verification.'], conflicts: ['Sources disagree.'] }
      const content = script ? script({ options, count: requests.length }) : !(options.tools ?? []).some(tool => tool.name === 'ultra_submit_report')
        ? { type: 'text', text: 'Ordinary non-report phase.' }
        : rejectReport && requests.length === 3
        ? { type: 'text', text: 'Native fallback after rejected tool.' }
        : { type: 'tool-call', id: sdk['dsh-llm'].ToolCallId('native-submit-' + ++number), name: 'ultra_submit_report', arguments: JSON.stringify(submission) }
      yield { type: 'block-start', index: 0, blockType: content.type }
      if (content.type === 'tool-call') yield { type: 'tool-call-delta', index: 0, id: content.id, name: content.name, argumentsDelta: content.arguments }
      else yield { type: 'text-delta', index: 0, text: content.text }
      yield { type: 'block-end', index: 0, block: content }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: content.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  const releaseAdapter = ctx.get('llm').registerAdapter(['offline-submit'], new Offline())
  ctx.get('tools').register(sdk['dsh-tools'].defineContentToolFixture({ name: 'fixture_read', description: 'Offline read-only native fixture', parameters: {}, async execute() { executions.global++; return [{ type: 'text', text: 'public fixture evidence' }] } }))
  if (rejectReport) ctx.on('tools/post-execute', async (exec, result, next) => exec.name === 'ultra_submit_report' && !result.isError
    ? { kind: 'block', feedback: [{ type: 'text', text: 'Report rejected by host policy.' }] } : next())
  ctx.on('tools/result', (exec, value) => {
    if (exec.name === 'ultra_submit_report') {
      toolResults.push({ isError: value.isError, concludesTurn: value.concludesTurn === true })
      if (cancelReport && !value.isError) controller.abort()
    }
    return undefined
  })
  const parent = await ctx.agents.create({ sessionId: 'native-submit-root', agentOptions: { provider: 'offline-submit', model: 'script', reasoningEffort: 'max', maxTokens: 8192 } })
  const route = await runtime.createRoute(parent.agent, { id: 'native-submit-worker', label: 'Native worker', readOnly: true, researchTools: ['fixture_read', 'own_probe'], signal: controller.signal }, { toolName: 'ultra_task', reportChars: 2000 })
  const agent = ctx.agents.get(route.id)
  agent.ctx.get('tools').register(sdk['dsh-tools'].defineContentToolFixture({ name: 'own_probe', description: 'Scoped read-only fixture, intentionally bypasses inherited masks', parameters: {}, async execute() { executions.own++; return [{ type: 'text', text: 'own fixture evidence' }] } }))
  t.after(async () => { await route.dispose(); await parent.dispose(); releaseAdapter(); await ctx.fiber.dispose() })
  return { ctx, route, agent, requests, toolResults, executions }
}

test('native planning has no advertised tools and denies invented global or own calls, then restores research and final tools', { skip: unavailable }, async t => {
  const f = await fixture(t, { maxCalls: 7, script: ({ count }) => [1, 2, 4, 6].includes(count)
    ? { type: 'tool-call', id: sdk['dsh-llm'].ToolCallId('phase-call-' + count), name: [2, 6].includes(count) ? 'own_probe' : 'fixture_read', arguments: '{}' }
    : { type: 'text', text: count === 3 ? '{"assignments":["Research first","Research second"]}' : 'Actual non-planning result.' } })
  const run = options => f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Phase fixture without network.' }], options))
  const planning = await run({ planningOnly: true, maxTokens: 12000 })
  assert.equal(planning.ok, true)
  assert.deepEqual(f.requests.slice(0, 3).map(request => request.tools), [[], [], []], 'global and scope-owned schemas must be absent from every native planning request')
  assert.deepEqual(f.executions, { global: 0, own: 0 }, 'hallucinated calls cannot execute even without advertised schemas')
  const refused = f.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  assert.equal(refused.length, 2)
  assert.ok(refused.every(event => event.data.message.isError))
  const research = await run({ maxTokens: 24000 })
  assert.equal(research.ok, true)
  assert.equal(f.executions.global, 1)
  assert.ok(f.requests[3].tools.includes('fixture_read'))
  f.route.setReadOnly(false)
  const final = await run({ maxTokens: 28000 })
  assert.equal(final.ok, true)
  assert.equal(f.executions.own, 1)
  assert.ok(f.requests[5].tools.includes('own_probe'))
  assert.ok(f.requests.every(request => request.effort === 'max'))
})

test('native AgentLoop ends on accepted worker report after logging its result, without a final model answer', { skip: unavailable }, async t => {
  const f = await fixture(t)
  const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Inspect synthetic evidence and submit a report.' }], { maxTokens: 24000, reportSubmission: true }))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.text, 'Existing evidence is insufficient for verification.')
  assert.equal(f.requests.length, 2, 'one rejected ID then one valid handoff; no extra final generation')
  assert.ok(f.requests.every(request => request.maxTokens === 24000 && request.effort === 'max' && request.tools.includes('ultra_submit_report')))
  assert.deepEqual(f.toolResults, [{ isError: true, concludesTurn: false }, { isError: false, concludesTurn: true }])
  const events = f.agent.session.snapshotEvents()
  assert.equal(events.findLast(event => event.type === 'turn/end').data.reason.kind, 'completed')
  assert.equal(events.filter(event => event.type === 'tool/result').length, 2)
  assert.ok(events.filter(event => event.type === 'assistant/message').every(event => event.data.message.content.every(block => block.type !== 'text')))
  const next = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Continue without a worker terminal.' }], { maxTokens: 0 }))
  assert.equal(next.text, 'Ordinary non-report phase.')
  assert.equal(f.requests.length, 3)
  assert.equal(f.requests[2].maxTokens, 8192, 'the original inherited cap returns in the actual prepared request')
  assert.equal(f.requests[2].effort, 'max')
  assert.equal(f.requests[2].tools.includes('ultra_submit_report'), false)
})

test('native cancellation wins over an accepted report result', { skip: unavailable }, async t => {
  const f = await fixture(t, { cancelReport: true })
  const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Submit then cancel at the final tool result.' }], { reportSubmission: true }))
  assert.equal(outcome.ok, false)
  assert.match(outcome.error, /cancelled/)
  assert.equal(f.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'aborted')
  assert.equal(f.requests.length, 2)
})

test('native post-execute rejection cannot turn an unaccepted submitted report into the route answer', { skip: unavailable }, async t => {
  const f = await fixture(t, { rejectReport: true })
  const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Policy rejects the submission.' }], { reportSubmission: true }))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.text, 'Native fallback after rejected tool.')
  assert.ok(f.toolResults.every(result => result.isError && !result.concludesTurn))
  assert.equal(f.requests.length, 3)
})


test('native steering exposes only real queue admission and actual next-request visibility', { skip: unavailable }, async t => {
  const observed = []
  let f
  f = await fixture(t, { maxCalls: 2, script: ({ count }) => {
    if (count === 1) assert.equal(f.route.steer('Check the synthetic alternative', { directiveId: 'native-directive', isCurrent: () => true, onDelivery: (status, sourceId) => observed.push({ status, sourceId }) }), true)
    return { type: 'text', text: count === 1 ? 'Initial observation.' : 'Checked the synthetic alternative.' }
  } })
  const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Offline steering proof.' }]))
  assert.equal(outcome.ok, true, outcome.error)
  assert.deepEqual(observed.map(item => item.status), ['queued', 'admitted', 'request-visible'])
  assert.equal(new Set(observed.map(item => item.sourceId)).size, 1)
  assert.equal(typeof observed[0].sourceId, 'string')
  assert.equal(f.requests.length, 2)
})

const workerReport = id => ({ type: 'tool-call', id: sdk['dsh-llm'].ToolCallId(id), name: 'ultra_submit_report', arguments: JSON.stringify({ report: 'Settled public worker evidence; verification remains pending.' }) })

test('native accepted report withdraws pending owned legacy and governed steering before another step', { skip: unavailable }, async t => {
  const deliveries = [], late = []
  let f
  f = await fixture(t, { maxCalls: 1, script: ({ count }) => {
    assert.equal(count, 1, 'An accepted report must not trigger another native request')
    assert.equal(f.route.steer('Legacy follow-up queued during the report request'), true)
    assert.equal(f.route.steer('Governed follow-up queued during the report request', { directiveId: 'pending-after-report', isCurrent: () => true, onDelivery: status => deliveries.push(status) }), true)
    return workerReport('native-racing-report')
  } })
  f.ctx.on('session/event', (session, event) => {
    if (session.id === f.agent.id && event.type === 'tool/result' && event.data.message.toolCallId === 'native-racing-report') late.push(f.route.steer('Late feedback after the accepted durable report'))
  })
  const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Finish the public report while coordination is in flight.' }], { reportSubmission: true }))
  assert.equal(outcome.ok, true, outcome.error)
  assert.equal(outcome.text, 'Settled public worker evidence; verification remains pending.')
  assert.equal(f.requests.length, 1)
  assert.deepEqual(deliveries, ['queued'], 'Withdrawn feedback is never called admitted or used')
  assert.deepEqual(late, [false])
  const events = f.agent.session.snapshotEvents()
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'ultra-steering').length, 0)
  assert.equal(events.filter(event => event.type === 'tool/call' && event.data.name === 'ultra_submit_report').length, 1)
  assert.equal(events.findLast(event => event.type === 'turn/end').data.reason.kind, 'completed')
  assert.equal(f.agent.inbox.nextStep.length, 0)
})

test('native report closure retains admitted history and withdraws only its not-yet-admitted feedback', { skip: unavailable }, async t => {
  const delivered = [], pending = []
  let f, admittedPrefix
  f = await fixture(t, { maxCalls: 2, script: ({ count }) => {
    if (count === 1) {
      assert.equal(f.route.steer('Earlier valid feedback', { directiveId: 'already-visible', isCurrent: () => true, onDelivery: status => delivered.push(status) }), true)
      return { type: 'text', text: 'Initial research observation.' }
    }
    assert.equal(count, 2)
    admittedPrefix = f.agent.session.snapshotEvents()
    assert.ok(admittedPrefix.some(event => event.type === 'user/message' && event.data.source.kind === 'ultra-steering'))
    assert.equal(f.route.steer('Not-yet-admitted feedback', { directiveId: 'withdrawn-at-report', isCurrent: () => true, onDelivery: status => pending.push(status) }), true)
    return workerReport('native-report-after-admission')
  } })
  const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Use the earlier direction, then finish.' }], { reportSubmission: true }))
  assert.equal(outcome.ok, true, outcome.error)
  assert.equal(f.requests.length, 2)
  assert.deepEqual(delivered, ['queued', 'admitted', 'request-visible'])
  assert.deepEqual(pending, ['queued'])
  const events = f.agent.session.snapshotEvents()
  assert.deepEqual(events.slice(0, admittedPrefix.length), admittedPrefix, 'The complete already-admitted native prefix stays byte-for-byte equivalent')
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'ultra-steering').length, 1)
})

test('native report withdrawal leaves independently queued human input intact', { skip: unavailable }, async t => {
  let f, current = true
  f = await fixture(t, { maxCalls: 2, script: ({ count }) => {
    if (count === 1) {
      assert.equal(f.route.steer('Withdraw only this owned feedback', { directiveId: 'owned-not-human', isCurrent: () => current }), true)
      f.agent.steer(sdk['dsh-llm'].createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'HUMAN_INPUT_MUST_SURVIVE' }] }))
      return workerReport('native-report-with-human')
    }
    return { type: 'text', text: 'The independent human input remains visible.' }
  } })
  f.ctx.on('session/event', (session, event) => { if (session.id === f.agent.id && event.type === 'tool/result' && event.data.message.toolCallId === 'native-report-with-human') current = false })
  const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Conclude only the worker-owned research.' }], { reportSubmission: true }))
  assert.equal(outcome.ok, true, outcome.error)
  assert.equal(f.requests.length, 2, 'Independent human work, unlike owned feedback, may enter its supported next step')
  const users = f.agent.session.snapshotEvents().filter(event => event.type === 'user/message')
  assert.ok(users.some(event => event.data.source.kind === 'user' && event.data.content.some(block => block.type === 'text' && block.text === 'HUMAN_INPUT_MUST_SURVIVE')))
  assert.equal(users.filter(event => event.data.source.kind === 'ultra-steering').length, 0)
})

test('native host rejection of a report preserves its pending research steering', { skip: unavailable }, async t => {
  let f
  f = await fixture(t, { rejectReport: true, maxCalls: 2, script: ({ count }) => {
    if (count === 1) { assert.equal(f.route.steer('Still needed because the report may be rejected'), true); return workerReport('native-rejected-report') }
    return { type: 'text', text: 'Continuing after host rejection.' }
  } })
  const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Policy will reject this report.' }], { reportSubmission: true }))
  assert.equal(outcome.ok, true, outcome.error)
  assert.equal(outcome.text, 'Continuing after host rejection.')
  assert.equal(f.requests.length, 2)
  assert.ok(f.toolResults.every(result => result.isError && !result.concludesTurn))
  assert.equal(f.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'ultra-steering').length, 1)
})

test('native owned-steering withdrawal failure is surfaced rather than swallowed by the result observer', { skip: unavailable }, async t => {
  let f
  f = await fixture(t, { maxCalls: 1, script: ({ count }) => {
    assert.equal(count, 1)
    f.route.steer('Pending feedback whose durable withdrawal fails')
    return workerReport('native-withdrawal-fails')
  } })
  const original = f.agent.inbox.remove
  f.agent.inbox.remove = () => { throw new Error('Owned steering withdrawal failure') }
  try {
    const outcome = await f.ctx.agents.withInitiator(f.agent, () => f.route.run([{ type: 'text', text: 'Surface a real inbox persistence failure.' }], { reportSubmission: true }))
    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /Owned steering withdrawal failure/)
    assert.equal(f.requests.length, 1, 'No invalid post-report request enters the adapter')
  } finally { f.agent.inbox.remove = original }
})
