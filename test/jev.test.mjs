import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildJevRequest, decideWithJev, parseJevDecision, JEV_TASK_LIMIT, JEV_ROUTE_TEXT_LIMIT } from '../lib/jev.js'

const input = { task: 'Fix the issue and report evidence', routes: [{ id: 'route-1', text: 'Tests passed' }, { id: 'route-2', text: 'Tests failed' }] }
const answer = () => ({ model: 'jev-1.13.0', answers: { best_route: { type: 'choice', choice: 'route-1', confidence: 0.88, probabilities: { 'route-1': 0.8, 'route-2': 0.2 } }, sufficient_evidence: { type: 'noul', noul: 0.73 } }, usage: { input_tokens: 123, output_tokens: 8 } })
const code = expected => error => error.code === expected
const response = json => ({ ok: true, status: 200, json: async () => json })

test('Jev sends the official TypeSafe contract and keeps the API key out of state', async () => {
  let call
  const decision = await decideWithJev(input, { apiKey: 'test-key', fetch: async (url, init) => { call = { url, init }; return response(answer()) } })
  assert.equal(call.url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(call.init.headers.Authorization, 'Bearer test-key')
  assert.equal(call.init.redirect, 'error')
  const body = JSON.parse(call.init.body)
  assert.equal(body.model, 'jev-latest')
  assert.equal(body.questions.best_route.type, 'choice')
  assert.deepEqual(Object.keys(body.questions.best_route.criteria), ['route-1', 'route-2'])
  assert.equal(body.questions.sufficient_evidence.type, 'noul')
  assert.equal(call.init.body.includes('test-key'), false)
  assert.deepEqual(decision, { selectedRouteId: 'route-1', confidence: 0.88, sufficientEvidenceProbability: 0.73, probabilities: { 'route-1': 0.8, 'route-2': 0.2 }, model: 'jev-1.13.0', usage: { inputTokens: 123, outputTokens: 8 } })
})

test('Jev bounds every submitted text and marks truncation', () => {
  const request = buildJevRequest({ task: 'T'.repeat(JEV_TASK_LIMIT + 1), routes: [{ id: 'r1', text: 'R'.repeat(JEV_ROUTE_TEXT_LIMIT + 1) }] })
  assert.equal(request.state.task.length, JEV_TASK_LIMIT)
  assert.equal(request.state.taskTruncated, true)
  assert.equal(request.state.routes[0].text.length, JEV_ROUTE_TEXT_LIMIT)
  assert.equal(request.state.routes[0].truncated, true)
})

test('invalid/duplicate/empty routes and excess routes are refused before network', async () => {
  for (const bad of [[], [{ id: 'route-1', text: '' }], [{ id: '../secret', text: 'text' }], [input.routes[0], input.routes[0]], Array.from({ length: 6 }, (_, index) => ({ id: `r${index}`, text: 'text' }))]) {
    await assert.rejects(decideWithJev({ task: 'Task', routes: bad }, { apiKey: 'test-key', fetch: async () => assert.fail('must not call network') }), code('input'))
  }
})

test('configuration cannot send credentials over remote HTTP or in a URL', async () => {
  for (const config of [{ apiKey: '' }, { apiKey: 'key\nInjected: bad' }, { apiKey: 'key', baseUrl: 'http://example.com' }, { apiKey: 'key', baseUrl: 'https://user:pass@example.com' }, { apiKey: 'key', baseUrl: 'https://example.com?key=x' }, { apiKey: 'key', timeoutMs: 0 }]) {
    await assert.rejects(decideWithJev(input, { ...config, fetch: async () => assert.fail('must not call network') }), code('configuration'))
  }
})

test('response validation rejects invented routes, invalid probabilities, and missing typed answers', () => {
  const mutations = [
    json => { json.answers.best_route.choice = 'other-session' },
    json => { json.answers.best_route.confidence = 2 },
    json => { json.answers.best_route.probabilities['route-1'] = -1 },
    json => { json.answers.best_route.probabilities.extra = 0 },
    json => { json.answers.best_route.probabilities['route-1'] = 0.5 },
    json => { json.answers.best_route.choice = 'route-2' },
    json => { json.answers.sufficient_evidence.noul = NaN },
    json => { json.answers.best_route.type = 'noul' },
    json => { delete json.answers.sufficient_evidence },
    json => { json.usage.input_tokens = -1 },
  ]
  for (const mutate of mutations) {
    const json = answer(); mutate(json)
    assert.throws(() => parseJevDecision(json, input.routes.map(route => route.id)), code('response'))
  }
})

test('HTTP and network errors never echo upstream bodies or API keys', async () => {
  await assert.rejects(decideWithJev(input, { apiKey: 'private-key', fetch: async () => ({ ok: false, status: 401, json: async () => { throw new Error('private-key') } }) }), error => error.code === 'http' && error.status === 401 && !error.message.includes('private-key'))
  await assert.rejects(decideWithJev(input, { apiKey: 'private-key', fetch: async () => { throw new Error('private-key') } }), error => error.code === 'network' && !error.message.includes('private-key'))
  await assert.rejects(decideWithJev(input, { apiKey: 'private-key', fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('private-key') } }) }), code('response'))
})

test('pre-cancelled requests do not call the upstream', async () => {
  const controller = new AbortController(); controller.abort()
  await assert.rejects(decideWithJev(input, { apiKey: 'key', signal: controller.signal, fetch: async () => assert.fail('must not call network') }), code('aborted'))
})

const abortableFetch = async (_url, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
})

test('request deadline aborts the upstream and returns an explicit timeout', async () => {
  await assert.rejects(decideWithJev(input, { apiKey: 'key', timeoutMs: 10, fetch: abortableFetch }), code('timeout'))
})

test('parent cancellation aborts the in-flight Jev request', async () => {
  const controller = new AbortController()
  const pending = decideWithJev(input, { apiKey: 'key', signal: controller.signal, fetch: abortableFetch })
  controller.abort()
  await assert.rejects(pending, code('aborted'))
})

test('loopback adapter is allowed for explicit offline integration tests', async () => {
  let url
  await decideWithJev(input, { apiKey: 'key', baseUrl: 'http://127.0.0.1:4545', fetch: async endpoint => { url = endpoint; return response(answer()) } })
  assert.equal(url, 'http://127.0.0.1:4545/v1/systemone')
})
