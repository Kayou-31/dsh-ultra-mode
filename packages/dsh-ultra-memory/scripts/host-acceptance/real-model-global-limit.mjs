/** Acceptance-only profile-wide LLM stream gate. Defaults to two streams; explicit
 * experiments may use up to 32 streams and 1,000 admitted requests per process.
 * Mount once at deployment/profile scope; separate processes do not share permits.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const name = 'ultra-acceptance-real-model-global-limit'
export const inject = ['llm']

const usageFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const MAX_CONCURRENCY = 32
const MAX_REQUESTS = 1000
const gateError = (code, message) => Object.assign(new Error(message), { code })
const label = (value, fallback = null) => typeof value === 'string' && /^[\w.:-]{1,256}$/u.test(value)
  ? value : typeof value === 'string' ? 'sha256:' + createHash('sha256').update(value).digest('hex').slice(0, 24) : fallback
const safeCode = error => label(error?.code, 'UNKNOWN')
const abortError = () => gateError('ACCEPTANCE_ABORTED', 'Acceptance request was cancelled before dispatch')
const usageOf = value => {
  if (!value || typeof value !== 'object') return null
  const usage = {}
  for (const key of usageFields) if (Number.isFinite(value[key]) && value[key] >= 0) usage[key] = value[key]
  return Object.keys(usage).length ? usage : null
}

function configuration(config) {
  const routeValue = (value, key) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\r\n\u0000]/u.test(value)) throw new TypeError(key + ' must be one exact nonempty route value')
    return value
  }
  const hasLegacy = config.allowedProvider !== undefined || config.allowedModel !== undefined
  let legacy
  if (hasLegacy) legacy = { provider: routeValue(config.allowedProvider, 'allowedProvider'), model: routeValue(config.allowedModel, 'allowedModel') }
  let allowedRoutes
  if (config.allowedRoutes !== undefined) {
    if (!Array.isArray(config.allowedRoutes) || config.allowedRoutes.length < 1 || config.allowedRoutes.length > 32) throw new TypeError('allowedRoutes must contain 1 to 32 exact routes')
    allowedRoutes = config.allowedRoutes.map(route => {
      if (!route || typeof route !== 'object' || Array.isArray(route) || Object.keys(route).some(key => !['provider', 'model'].includes(key))) throw new TypeError('Each allowed route must contain only provider and model')
      return Object.freeze({ provider: routeValue(route.provider, 'route provider'), model: routeValue(route.model, 'route model') })
    })
    if (new Set(allowedRoutes.map(route => JSON.stringify([route.provider, route.model]))).size !== allowedRoutes.length) throw new TypeError('Duplicate allowed route')
    if (legacy && !allowedRoutes.some(route => route.provider === legacy.provider && route.model === legacy.model)) throw new TypeError('Legacy route must be included in allowedRoutes; ambiguous authorization is rejected')
  } else {
    if (!legacy) throw new TypeError('One exact allowed route or allowedRoutes is required')
    allowedRoutes = [Object.freeze(legacy)]
  }
  Object.freeze(allowedRoutes)
  const concurrency = config.concurrency ?? 2, maxRequests = config.maxRequests ?? 60
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) throw new TypeError('Acceptance concurrency must be an integer from 1 to 32; the hard maximum is 32')
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS) throw new TypeError('Acceptance maxRequests must be a finite positive safe integer from 1 to 1000')
  if (config.syntheticUsage !== undefined && typeof config.syntheticUsage !== 'boolean') throw new TypeError('syntheticUsage must be boolean when testing the gate with a local fixture')
  if (typeof config.testRoot !== 'string' || !path.isAbsolute(config.testRoot)) throw new TypeError('testRoot must be an existing absolute isolated test directory')
  const testRoot = fs.realpathSync.native(config.testRoot)
  if (!fs.statSync(testRoot).isDirectory()) throw new TypeError('testRoot must be a directory')
  if (typeof config.logFile !== 'string' || !config.logFile) throw new TypeError('logFile is required under testRoot')
  const logFile = path.resolve(testRoot, config.logFile), relative = path.relative(testRoot, logFile)
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new TypeError('Acceptance logFile must stay below testRoot')
  let current = testRoot
  const pieces = relative.split(path.sep)
  for (const piece of pieces.slice(0, -1)) {
    current = path.join(current, piece)
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 })
    const entry = fs.lstatSync(current)
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new TypeError('Acceptance log parent must be an ordinary test directory')
  }
  if (fs.existsSync(logFile)) {
    const entry = fs.lstatSync(logFile)
    if (entry.isSymbolicLink() || !entry.isFile()) throw new TypeError('Acceptance log target must be an ordinary file')
  }
  return { allowedProvider: config.allowedProvider, allowedModel: config.allowedModel, allowedRoutes, concurrency, maxRequests, testRoot, logFile, syntheticUsage: config.syntheticUsage ?? false }
}

/** Public only for local unit fixtures and the Loader plugin below; creates no provider. */
export function createGlobalLimit(config) {
  const selected = configuration(config)
  const runId = randomUUID(), pending = []
  const counters = { attempted: 0, queued: 0, admitted: 0, completed: 0, failed: 0, cancelled: 0, rejected: 0, active: 0, activePeak: 0 }
  let closed = false, auditFailed = false
  const snapshot = () => ({ ...counters, queueDepth: pending.length, closed, auditFailed, runId,
    concurrency: selected.concurrency, maxRequests: selected.maxRequests, allowedProvider: selected.allowedProvider,
    allowedModel: selected.allowedModel, allowedRoutes: selected.allowedRoutes.map(route => ({ ...route })), synthetic: selected.syntheticUsage, usageMeaning: selected.syntheticUsage ? 'Synthetic local fixture counters; not real-model or billing evidence' : 'Numeric provider-reported chunks; no estimation or billing-price inference',
    countingMeaning: 'Admitted native LLM streams; provider wire dispatch is not independently observed' })
  const close = () => {
    if (closed) return
    closed = true
    for (const ticket of pending.splice(0)) {
      ticket.removeAbort?.()
      counters.cancelled++
      if (!auditFailed) { try { emit('cancelled-gate-closed', ticket.identity) } catch {} }
      ticket.reject(gateError('ACCEPTANCE_GATE_CLOSED', 'Acceptance global request gate is closed'))
    }
  }
  const emit = (event, details = {}) => {
    try {
      fs.appendFileSync(selected.logFile, JSON.stringify({ at: new Date().toISOString(), runId, event, ...details,
        active: counters.active, activePeak: counters.activePeak, queueDepth: pending.length, admitted: counters.admitted,
        synthetic: selected.syntheticUsage }) + '\n', { mode: 0o600 })
    } catch {
      auditFailed = true; close()
      throw gateError('ACCEPTANCE_AUDIT_UNAVAILABLE', 'Acceptance audit log is unavailable; further model dispatch is disabled')
    }
  }
  const rejectTicket = (ticket, code, message) => {
    ticket.removeAbort?.()
    counters.rejected++
    try { emit('rejected', { ...ticket.identity, code }) }
    catch (error) { ticket.reject(error); return }
    ticket.reject(gateError(code, message))
  }
  const pump = () => {
    while (!closed && pending.length && counters.active < selected.concurrency) {
      const ticket = pending.shift()
      ticket.removeAbort?.()
      if (ticket.signal?.aborted) {
        counters.cancelled++
        try { emit('cancelled-before-dispatch', ticket.identity) } catch (error) { ticket.reject(error); return }
        ticket.reject(abortError()); continue
      }
      if (counters.admitted >= selected.maxRequests) {
        rejectTicket(ticket, 'ACCEPTANCE_REQUEST_LIMIT', 'Acceptance maximum actual request count reached')
        continue
      }
      counters.active++; counters.admitted++; counters.activePeak = Math.max(counters.activePeak, counters.active)
      try { emit('admitted', ticket.identity) }
      catch (error) { counters.active--; ticket.reject(error); return }
      ticket.resolve(ticket.identity)
    }
    if (!closed && counters.admitted >= selected.maxRequests) {
      for (const ticket of pending.splice(0)) rejectTicket(ticket, 'ACCEPTANCE_REQUEST_LIMIT', 'Acceptance maximum actual request count reached')
    }
  }
  const acquire = options => {
    const requestId = randomUUID()
    counters.attempted++
    const identity = { requestId, sessionId: label(options.sessionId), purpose: ['compaction', 'session-title'].includes(options.purpose) ? options.purpose : 'conversation' }
    if (!selected.allowedRoutes.some(route => options.provider === route.provider && options.model === route.model)) {
      counters.rejected++
      emit('rejected-route', { ...identity, provider: '[unexpected-route-redacted]', model: '[unexpected-route-redacted]', code: 'ACCEPTANCE_ROUTE_NOT_ALLOWED' })
      return Promise.reject(gateError('ACCEPTANCE_ROUTE_NOT_ALLOWED', 'Acceptance route is not exactly the authorized provider and model'))
    }
    Object.assign(identity, { provider: options.provider, model: options.model })
    if (closed) {
      counters.rejected++
      if (!auditFailed) emit('rejected', { ...identity, code: 'ACCEPTANCE_GATE_CLOSED' })
      return Promise.reject(gateError('ACCEPTANCE_GATE_CLOSED', 'Acceptance global request gate is closed'))
    }
    if (options.signal?.aborted) {
      counters.cancelled++; emit('cancelled-before-queue', identity)
      return Promise.reject(abortError())
    }
    if (counters.admitted >= selected.maxRequests) {
      counters.rejected++; emit('rejected', { ...identity, code: 'ACCEPTANCE_REQUEST_LIMIT' })
      return Promise.reject(gateError('ACCEPTANCE_REQUEST_LIMIT', 'Acceptance maximum actual request count reached'))
    }
    return new Promise((resolve, reject) => {
      const ticket = { identity, signal: options.signal, resolve, reject }
      const onAbort = () => {
        const index = pending.indexOf(ticket)
        if (index < 0) return
        pending.splice(index, 1); ticket.removeAbort(); counters.cancelled++
        try { emit('cancelled-in-queue', identity) } catch (error) { reject(error); return }
        reject(abortError())
      }
      ticket.removeAbort = () => options.signal?.removeEventListener('abort', onAbort)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      pending.push(ticket); counters.queued++
      try { emit('queued', identity) } catch (error) { reject(error); return }
      pump()
    })
  }
  const stream = async function * (options, next) {
    const identity = await acquire(options)
    const started = Date.now()
    let outcome = 'failed', failureCode = 'ACCEPTANCE_CONSUMER_CLOSED', usage = null, usageEvents = 0, finished = false
    try {
      options.signal?.throwIfAborted()
      // next() uses the original frozen native request. No routing or signal fields are rewritten.
      for await (const chunk of next()) {
        if (chunk.type === 'usage') {
          usage = usageOf(chunk.usage); usageEvents++
          emit('usage', { ...identity, usage, usageEvents, usageInterpretation: 'last-provider-reported-chunk-no-aggregation' })
        }
        if (chunk.type === 'finish') {
          finished = true
          const kind = chunk.reason?.kind
          outcome = kind === 'error' ? 'failed' : kind === 'aborted' ? 'cancelled' : 'completed'
          failureCode = kind === 'error' || kind === 'aborted' ? safeCode(chunk.reason?.failure) : null
        }
        yield chunk
      }
      if (!finished) { outcome = options.signal?.aborted ? 'cancelled' : 'failed'; failureCode = 'ACCEPTANCE_MISSING_TERMINAL_FINISH' }
    } catch (error) {
      outcome = options.signal?.aborted ? 'cancelled' : 'failed'; failureCode = safeCode(error)
      throw error
    } finally {
      // Native cancellation can close the consumer before forwarding finish.
      // That skips normal loop exit and catch; it is still a cancellation.
      if (!finished && options.signal?.aborted) { outcome = 'cancelled'; failureCode = 'ACCEPTANCE_ABORTED' }
      counters.active--
      if (outcome === 'completed') counters.completed++
      else if (outcome === 'cancelled') counters.cancelled++
      else counters.failed++
      try { emit(outcome, { ...identity, elapsedMs: Date.now() - started, failureCode, usage, usageEvents,
        usageInterpretation: 'last-provider-reported-chunk-no-aggregation', consumerFinished: finished }) }
      finally { pump() }
    }
  }
  emit('gate-created', { provider: selected.allowedProvider, model: selected.allowedModel, allowedRoutes: selected.allowedRoutes, concurrency: selected.concurrency,
    hardMaximumConcurrency: MAX_CONCURRENCY, hardMaximumRequests: MAX_REQUESTS, maxRequests: selected.maxRequests, privateContentLogged: false })
  return Object.freeze({ stream, snapshot, close })
}

/** Load as one profile row before any driver starts. Never enable in a daily profile. */
export function apply(ctx, config) {
  const gate = createGlobalLimit(config)
  ctx.provide('ultraAcceptanceModelGate', Object.freeze({ snapshot: gate.snapshot }))
  ctx.on('llm/stream', gate.stream, { prepend: true })
  ctx.effect(() => () => gate.close(), 'acceptance.globalModelGate')
}
