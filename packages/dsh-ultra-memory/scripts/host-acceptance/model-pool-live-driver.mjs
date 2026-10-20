/** Offline helpers for ordinary-collaboration model-pool acceptance. No execution
 * entrypoint, provider adapter, credential access, network or filesystem access.
 * Defaults remain two concurrent agents and 24 requests; explicit experiments
 * allow at most 32 concurrent agents and 1,000 requests.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

const nonempty = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
function requiredText(value, name) {
  if (!nonempty(value)) throw new TypeError(`Invalid ${name}`)
  return value
}
function positiveInteger(value, limit, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > limit) throw new TypeError(`Invalid ${name} limit`)
  return value
}

export function normalizeLiveConfig(config) {
  if (!object(config)) throw new TypeError('Live configuration must be an object')
  const normalized = {}
  for (const name of ['runtimeRoot', 'ultraRoot', 'projectDir', 'resultFile', 'provider', 'model']) normalized[name] = requiredText(config[name], name)
  const maxRequests = positiveInteger(config.maxRequests ?? 24, 1000, 'request')
  const maxConcurrent = positiveInteger(config.maxConcurrent ?? 2, 32, 'concurrency')
  if (config.distinctModels !== undefined && typeof config.distinctModels !== 'boolean') throw new TypeError('distinctModels must be boolean')
  if (!Array.isArray(config.routes) || config.routes.length !== 2) throw new TypeError('Two unique code/review route kinds are required')
  const ids = new Set(), kinds = new Set()
  const routes = config.routes.map(route => {
    if (!object(route)) throw new TypeError('Invalid model route')
    const id = requiredText(route.id, 'route id'), provider = requiredText(route.provider, 'route provider'), model = requiredText(route.model, 'route model')
    if (ids.has(id) || kinds.has(route.kind)) throw new TypeError('Route ids and kinds must be unique; duplicate route')
    if (route.kind !== 'code' && route.kind !== 'review') throw new TypeError('Invalid route kind')
    if (!efforts.has(route.reasoningEffort)) throw new TypeError('Invalid reasoningEffort')
    const maxTokens = positiveInteger(route.maxTokens, 32768, 'maxTokens')
    ids.add(id); kinds.add(route.kind)
    return Object.freeze({ id, provider, model, kind: route.kind, reasoningEffort: route.reasoningEffort, maxTokens })
  })
  const actualModels = new Set(routes.map(route => JSON.stringify([route.provider, route.model])))
  if (config.distinctModels === true && actualModels.size < 2) throw new TypeError('distinctModels requires different actual provider/model identities')
  const differentSettings = new Set(routes.map(route => JSON.stringify([route.reasoningEffort, route.maxTokens]))).size > 1
  const routeClassification = actualModels.size > 1 ? 'distinct-models' : differentSettings ? 'same-model-different-config' : 'same-model-same-config'
  return Object.freeze({ ...normalized, maxRequests, maxConcurrent, distinctModels: config.distinctModels ?? false, routes: Object.freeze(routes), routeClassification })
}

/** fixtureText is the tool-visible payload; answer is host-only grading material. */
export function createLiveChallenges() {
  const make = phase => {
    const id = `fixture-${phase}-${randomUUID()}`, nonce = randomBytes(24).toString('hex')
    const values = Array.from({ length: 6 }, () => randomInt(1, 30))
    const answer = phase === 'code' ? values.filter(value => value % 2 === 0).reduce((sum, value) => sum + value * value, 0) : values.length
    const problem = phase === 'code'
      ? { task: 'Compute the sum of the squares of the even integers in values.', values }
      : { task: 'Review this zero-based loop: for (let i = 0; i <= values.length; i++) read(values[i]). Return the first out-of-bounds index.', values }
    return Object.freeze({ id, nonce, answer, fixtureText: JSON.stringify({ fixtureId: id, nonce, ...problem }) })
  }
  return Object.freeze({ code: make('code'), review: make('review') })
}

/** Deliberately exposes only phase and public fixture ID, never pool candidate IDs. */
export function livePhasePrompt(phase, challenge) {
  if ((phase !== 'code' && phase !== 'review') || !object(challenge)) throw new TypeError('Invalid live phase or challenge')
  const fixtureId = requiredText(challenge.id, 'fixture id')
  return `Complete this ${phase === 'code' ? 'code computation' : 'code review'} task using ordinary collaboration. ` +
    'Select an appropriate available model by capability and call ultra_spawn_agent with your selection and a brief task-fit reason. ' +
    `The child must call fixture_read with id=${JSON.stringify(fixtureId)} itself, solve the returned task, and return JSON {"fixtureId":"the read ID","nonce":"the read nonce","answer":"the computed answer, preserving its JSON type"}. ` +
    'Wait for that child to complete and report its same JSON result publicly. Do not invent tool results or fill in unread fields. Do not access credentials, use the network, write files, or invoke any other task.'
}

function readback(text, challenge) {
  if (typeof text !== 'string' || text.length > 32768) return false
  try {
    const value = JSON.parse(text)
    return object(value) && Object.hasOwn(value, 'answer') && value.fixtureId === challenge.id && value.nonce === challenge.nonce && value.answer === challenge.answer
  } catch { return false }
}

/** Input records must be captured by the host; model claims never substitute for them.
 * The result attests only this bounded phase and does not imply a live run occurred.
 */
export function judgeLivePhase(observation) {
  const fail = reason => ({ passed: false, reason })
  if (!object(observation)) return fail('invalid-observation')
  const { challenge, route, rootId } = observation
  if (!object(challenge) || !nonempty(challenge.id) || !nonempty(challenge.nonce) || !(nonempty(challenge.answer) || typeof challenge.answer === 'number' && Number.isFinite(challenge.answer)) || !object(route) || !nonempty(route.id) || !nonempty(route.provider) || !nonempty(route.model) || !efforts.has(route.reasoningEffort) || !Number.isSafeInteger(route.maxTokens) || route.maxTokens < 1 || route.maxTokens > 32768 || !nonempty(rootId)) return fail('invalid-challenge-or-route')
  for (const field of ['spawns', 'toolCalls', 'requests', 'records', 'nativeToolReceipts', 'childAnswers']) {
    if (!Array.isArray(observation[field]) || observation[field].length > 10000 || observation[field].some(value => !object(value))) return fail(`invalid-${field}`)
  }
  if (!readback(observation.publicText, challenge)) return fail('public-readback-missing')
  const spawns = observation.spawns.filter(spawn => spawn.parentId === rootId && spawn.requestedModelId === route.id && spawn.isError === false && nonempty(spawn.id) && nonempty(spawn.reason))
  for (const spawn of spawns) {
    const sessionId = spawn.id
    if (sessionId === rootId) continue
    const record = observation.records.find(record => record.id === sessionId && record.status === 'completed' && record.model?.requestedId === route.id && record.model?.actual?.provider === route.provider && record.model?.actual?.model === route.model && record.model?.compatibility?.tools === 'observed-native-tool-result')
    if (!record) continue
    const requests = observation.requests.filter(request => request.sessionId === sessionId)
    if (requests.length < 2 || requests.some(request => request.provider !== route.provider || request.model !== route.model || request.reasoningEffort !== route.reasoningEffort || request.maxTokens !== route.maxTokens || !Array.isArray(request.tools) || !request.tools.includes('fixture_read') || !Array.isArray(request.toolResultNonces))) continue
    const firstReadback = requests.findIndex(request => request.toolResultNonces.includes(challenge.nonce))
    if (firstReadback < 1 || !requests.slice(0, firstReadback).some(request => !request.toolResultNonces.includes(challenge.nonce))) continue
    const toolCalls = observation.toolCalls.filter(call => call.sessionId === sessionId && call.id === challenge.id && call.nonce === challenge.nonce && call.isError === false && nonempty(call.callId))
    const paired = toolCalls.some(call => observation.nativeToolReceipts.some(receipt => receipt.sessionId === sessionId && receipt.id === call.id && receipt.nonce === call.nonce && receipt.callId === call.callId && Number.isSafeInteger(receipt.callSeq) && receipt.callSeq >= 0 && Number.isSafeInteger(receipt.resultSeq) && receipt.resultSeq > receipt.callSeq))
    if (!paired) continue
    const childReadback = observation.childAnswers.some(answer => answer.sessionId === sessionId && answer.completed === true && readback(answer.text, challenge))
    if (childReadback) return { passed: true, sessionId, routeId: route.id, observedNativeToolResult: true }
  }
  return fail('complete-native-child-evidence-chain-missing')
}
