/** Explicit-input public experiment report. No model or credential access. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const fields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const terminals = new Set(['completed', 'failed', 'cancelled'])
const modes = new Set(['pool', 'knowledge', 's0', 's1', 's2', 's1-recover', 's2-resume', 'smoke', 'ultra', 'long', 'resume', 'core', 'foreign', 'disabled', 'baseline', 'compare-common', 'baseline-long', 'baseline-long-resume', 'baseline-long-repair', 'long-repair', 'continue-long', 'cancel-mid'])
const failures = new Set(['TIMEOUT', 'TRANSPORT', 'ABORTED', 'CANCELLED', 'UNKNOWN', 'PI_AI_ERROR', 'INVALID_CONFIG', 'UNSUPPORTED_OPTION', 'UNSUPPORTED_CONTENT', 'NO_ADAPTER', 'INVALID_PREPARED_CALL', 'MODEL_UNAVAILABLE', 'ACCEPTANCE_ABORTED', 'ACCEPTANCE_GATE_CLOSED', 'ACCEPTANCE_REQUEST_LIMIT', 'ACCEPTANCE_ROUTE_NOT_ALLOWED', 'ACCEPTANCE_AUDIT_UNAVAILABLE', 'ACCEPTANCE_CONSUMER_CLOSED', 'ACCEPTANCE_MISSING_TERMINAL_FINISH'])
const reasons = {
  'driver-defect': '验收驱动缺陷；本次不计入任务质量对照。', 'fixture-defect': '测试资料或判分条件有缺陷；本次不计入任务质量对照。',
  'incomplete-ledger': '请求账本不完整；本次不计入任务质量对照。', 'candidate-mismatch': '被测包与预定候选不一致；本次不计入任务质量对照。',
  'invalid-baseline': '基线条件不成立；本次不计入任务质量对照。', 'configuration-mismatch': '两臂配置条件未对齐；本次不计入任务质量对照。',
  'unauthorized-route': '实际模型路线超出登记范围；本次不计入任务质量对照。', 'untrusted-input': '输入来源未经核验；本次不计入任务质量对照。',
  'scripted-evidence': '脚本适配器仅验证原生接线，不计入真实模型质量对照。',
  'supplemental-protocol-omission': '验收驱动遗漏附加协议提示；保留原失败，不计入对齐后的任务质量对照。',
  other: '本次已显式排除质量统计；原始私有原因不导出。',
}
// Unrecognized free-form names are hashed, never copied into the public report.
const checkNames = new Set([
  'final structured JSON', 'literal human label', 'tail batch exact', 'tail checksum exact', 'both conflicting values preserved', 'conflict remains unresolved',
  'conflict left exact source quote', 'conflict right exact source quote', 'execution is distinct from verification', 'latest footer retained', 'valid public source quotations', 'tail values have exact source quotations',
  'real provider tool call executed', 'real provider used public tool answer', 'S0 has only root model route', 'S0 bounded to two model calls',
  'deterministic real model quality checks passed', 'cold resumed real model quality checks passed', 'latest decision survives repeated compression', 'old decision versions remain superseded',
  'real model called evidence search then get', 'decision independently retrieves raw evidence', 'no completed-operation execution attempted',
  'tail facts were actually request-visible from tool material', 'both conflicting sources were actually request-visible',
  'all selected native workers conclude with accepted report tools', 'manual Ultra selected worker count created the exact native worker and decision identities',
  'exact requested bundle has an active native Loader fiber', 'native volatile model-pool settings are available', 'real native root turn completed',
  'main request exposes candidate catalog and all six Team tools', 'running native child retains immutable original route options',
  'native user-fixed selection overrides the requested candidate and performs the actual tool roundtrip',
  'native selection rejects disabled before model work', 'native selection rejects missing before model work',
  'native code autonomous selection has a complete native request/tool/result chain', 'native review autonomous selection has a complete native request/tool/result chain',
  'real code autonomous selection has a complete native request/tool/result chain', 'real review autonomous selection has a complete native request/tool/result chain',
])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const list = value => Array.isArray(value) ? value : []
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const digest = value => createHash('sha256').update(String(value)).digest('hex')
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null
const label = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(value)
  && !/^(?:[a-zA-Z]:|sk[-_]|bearer)/iu.test(value) ? value : null
const gateOf = result => object(result.globalGate?.final) ? result.globalGate.final : object(result.globalGate) ? result.globalGate : null
const selectedStreams = input => {
  const runId = gateOf(input.result ?? {})?.runId
  return list(input.streams).filter(row => object(row) && (typeof runId !== 'string' || row.runId === runId))
}
const normalizedUsage = value => {
  if (!object(value)) return null
  const entries = fields.flatMap(field => numeric(value[field]) === null ? [] : [[field, value[field]]])
  return entries.length ? Object.fromEntries(entries) : null
}
function usageTotals(entries) {
  const reported = Object.fromEntries(fields.map(field => [field, null])), missingFields = Object.fromEntries(fields.map(field => [field, 0]))
  const overflow = new Set(); let knownRequests = 0
  for (const entry of entries) {
    if (!entry.usage) continue
    knownRequests++
    for (const field of fields) {
      if (entry.usage[field] === undefined) { missingFields[field]++; continue }
      if (overflow.has(field)) continue
      const sum = (reported[field] ?? 0) + entry.usage[field]
      if (!Number.isSafeInteger(sum)) { overflow.add(field); reported[field] = null }
      else reported[field] = sum
    }
  }
  return { knownRequests, unknownRequests: entries.length - knownRequests, reported, missingFields, overflowFields: [...overflow],
    interpretation: 'Each field is summed independently from the last terminal provider report. Missing usage is unknown; totalTokens is never reconstructed and reasoning/cache fields are not added to it.' }
}
function analyzeStreams(rows) {
  const admissions = new Map(), seenTerminals = new Map(), lastUsage = new Map(), peaks = new Map(), codes = new Set()
  let duplicateAdmissionRows = 0, duplicateTerminalRows = 0, malformedAdmissionRows = 0, orphanTerminalRows = 0, orphanUsageRows = 0
  for (const row of rows) {
    const run = typeof row.runId === 'string' && row.runId.length <= 256 ? row.runId : 'unspecified'
    const peak = numeric(row.activePeak)
    if (peak !== null) peaks.set(run, Math.max(peaks.get(run) ?? 0, peak))
    const validId = typeof row.requestId === 'string' && row.requestId.length > 0 && row.requestId.length <= 256
    if (!validId) { if (row.event === 'admitted') malformedAdmissionRows++; continue }
    const key = JSON.stringify([run, row.requestId])
    if (row.event === 'admitted') {
      const previous = admissions.get(key), identity = JSON.stringify([row.provider, row.model, row.synthetic])
      if (previous) { duplicateAdmissionRows++; if (previous.identity !== identity) previous.conflict = true }
      else admissions.set(key, { identity, conflict: false, provider: label(row.provider), model: label(row.model), synthetic: row.synthetic })
    } else if (row.event === 'usage') {
      const admitted = admissions.get(key)
      if (!admitted) { orphanUsageRows++; continue }
      if (['provider', 'model', 'synthetic'].some(field => row[field] !== undefined && row[field] !== admitted[field])) { admitted.conflict = true; continue }
      lastUsage.set(key, normalizedUsage(row.usage ?? row.lastUsage ?? row.lastusage))
    }
    else if (terminals.has(row.event)) {
      if (seenTerminals.has(key)) duplicateTerminalRows++
      const admitted = admissions.get(key), validOrder = !!admitted
      if (!admitted) orphanTerminalRows++
      else if (['provider', 'model', 'synthetic'].some(field => row[field] !== undefined && row[field] !== admitted[field])) admitted.conflict = true
      const usage = normalizedUsage(row.usage) ?? normalizedUsage(row.lastUsage) ?? normalizedUsage(row.lastusage) ?? lastUsage.get(key) ?? null
      const failureCode = failures.has(row.failureCode) ? row.failureCode : row.failureCode ? 'OTHER' : null
      if (admitted && failureCode) codes.add(failureCode)
      seenTerminals.set(key, { event: row.event, usage, validOrder, failureCode })
    }
  }
  const entries = [...admissions].map(([key, admission]) => {
    const terminal = seenTerminals.get(key), usage = terminal?.usage
    const measured = !admission.conflict && terminal?.validOrder && usage && (terminal.event === 'completed' || Object.values(usage).some(number => number > 0)) ? usage : null
    if (terminal?.failureCode) codes.add(terminal.failureCode)
    return { key, ...admission, usage: measured, terminal: terminal?.event ?? null }
  })
  return { entries, peaks, codes, ledger: { uniqueAdmitted: entries.length, terminalRequests: entries.filter(entry => entry.terminal).length,
    pendingRequests: entries.filter(entry => !entry.terminal).length, duplicateAdmissionRows, duplicateTerminalRows, malformedAdmissionRows, orphanTerminalRows, orphanUsageRows,
    conflictingIdentities: entries.filter(entry => entry.conflict).length } }
}
function checks(values) {
  return list(values).slice(0, 2000).map((value, index) => {
    const original = typeof value?.name === 'string' ? value.name : ''
    const known = checkNames.has(original) || /^native model turn completed [1-9]\d{0,2}$/u.test(original)
      || /^native (?:Ultra command|command) accepted \/(?:ultra (?:off|assist|[2-5])|team (?:on|off)|decision (?:on|off|assist))$/u.test(original)
      || /^no execution replay through current real-model round [1-9]\d{0,2}$/u.test(original)
      || /^no operation replay in extended native round \d{1,3}$/u.test(original)
    return { name: known ? original : 'check-' + (index + 1), ...(known || !original ? {} : { nameSha256: digest(original) }), passed: typeof value?.passed === 'boolean' ? value.passed : null }
  })
}
function budget(value, native = false) {
  if (!object(value)) return null
  return { inputTokens: numeric(value.inputTokens), totalTokens: numeric(value.totalTokens), targetTokens: numeric(value.targetTokens),
    estimated: native || value.estimated !== false, method: native ? 'native-token-meter' : ['utf8-heuristic', 'supplied-input-count'].includes(value.method) ? value.method : 'unspecified-estimate' }
}
function compression(result) {
  const output = []
  for (const sample of list(result.compressionSamples).slice(0, 1000)) {
    output.push({ index: output.length + 1, beforeGeneration: integer(sample.beforeGeneration), afterGeneration: integer(sample.afterGeneration), elapsedMs: numeric(sample.elapsedMs),
      before: budget(sample.metrics?.before), after: budget(sample.metrics?.after), countsAreProviderUsage: false })
  }
  for (const round of list(result.compression?.rounds).slice(0, 1000)) {
    output.push({ index: output.length + 1, before: budget({ inputTokens: round.beforeSurfaceTokens }, true), after: budget({ inputTokens: round.afterSurfaceTokens }, true), countsAreProviderUsage: false })
  }
  if (!output.length && object(result.memory?.compression)) output.push({ index: 1, before: budget(result.memory.compression.before), after: budget(result.memory.compression.after), countsAreProviderUsage: false })
  return output
}
function pruneKeys(input) {
  const native = input.result?.native
  if (!Array.isArray(native?.prunes)) return null
  const session = typeof native.sessionId === 'string' ? native.sessionId : 'attempt:' + input.attemptId
  return new Set(native.prunes.flatMap(row => integer(row?.seq) === null ? [] : [JSON.stringify([session, row.seq])]))
}

export function summarizeOcgAttempt(input) {
  if (!object(input) || typeof input.attemptId !== 'string' || !input.attemptId || !object(input.launch) || !object(input.result)) throw new TypeError('An explicit attempt identity, launch and result object are required')
  const { launch, result } = input, rows = selectedStreams(input), analysis = analyzeStreams(rows), gate = gateOf(result)
  const observed = Array.isArray(result.requests) ? result.requests.length : null
  const declared = integer(gate?.admitted), declaredCountMatches = declared === null ? null : declared === analysis.ledger.uniqueAdmitted
  const driverCountMatches = observed === null ? null : observed === analysis.ledger.uniqueAdmitted
  const complete = rows.length > 0 && analysis.ledger.pendingRequests === 0 && analysis.ledger.orphanTerminalRows === 0 && analysis.ledger.orphanUsageRows === 0 && analysis.ledger.malformedAdmissionRows === 0
    && analysis.ledger.conflictingIdentities === 0 && declaredCountMatches !== false && driverCountMatches !== false
  const classes = new Set(analysis.entries.map(entry => entry.synthetic === true ? 'scripted-native' : entry.synthetic === false ? 'real-provider' : 'unknown'))
  const evidenceClass = classes.size === 1 ? [...classes][0] : classes.size > 1 ? 'mixed' : gate?.synthetic === true ? 'scripted-native' : 'unknown'
  const invalid = input.invalidReason !== undefined && input.invalidReason !== null
  const reason = typeof input.invalidReason === 'string' ? input.invalidReason : input.invalidReason?.code
  const reasonCode = invalid ? Object.hasOwn(reasons, reason) ? reason : 'other' : !complete ? 'incomplete-ledger' : evidenceClass !== 'real-provider' ? 'scripted-evidence' : null
  const routes = [...analysis.entries, { provider: launch.provider ?? result.provider, model: launch.model ?? result.model },
    ...list(result.requests)].flatMap(row => { const provider = label(row.provider), model = label(row.model); return provider && model ? [{ provider, model }] : [] })
  const uniqueRoutes = [...new Map(routes.map(route => [JSON.stringify(route), route])).values()]
  const nativePrunes = pruneKeys(input)
  const publicGrade = object(result.grade) ? { passed: typeof result.grade.passed === 'boolean' ? result.grade.passed : null, checks: checks(result.grade.checks) } : null
  if (publicGrade) publicGrade.consistent = typeof publicGrade.passed === 'boolean' && publicGrade.checks.length > 0 && publicGrade.checks.every(check => typeof check.passed === 'boolean')
    ? publicGrade.passed === publicGrade.checks.every(check => check.passed) : null
  const driverFile = launch.scenario === 'pool' ? 'ocg-pool-plugin.mjs' : launch.scenario === 'knowledge' ? 'ocg-knowledge-plugin.mjs' : 'real-model/driver.mjs'
  const driverHash = sha(launch.driverSha256) ?? sha(list(launch.support).find(file => file?.path === driverFile)?.sha256)
  for (const code of [result.failure?.code, result.error?.code, ...list(result.failedTurns).map(row => row.code)]) if (code) analysis.codes.add(failures.has(code) ? code : 'OTHER')
  return {
    attemptId: label(input.attemptId) ?? 'attempt-' + digest(input.attemptId).slice(0, 16),
    mode: [launch.mode, launch.scenario, result.mode, result.phase].find(value => modes.has(value)) ?? 'unknown',
    status: ['passed', 'failed', 'running', 'invalid'].includes(result.status) ? result.status : 'unknown', evidenceClass, models: uniqueRoutes,
    provenance: { sdk: typeof launch.sdk === 'string' && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u.test(launch.sdk) ? launch.sdk : null,
      candidateSha256: sha(launch.candidateSha256 ?? launch.candidate?.sha256), driverSha256: driverHash, runnerSha256: sha(launch.runnerSha256) },
    elapsedMs: numeric(result.elapsedMs), checks: checks(result.checks), grade: publicGrade,
    phases: list(result.phaseProofs).slice(0, 100).map((phase, index) => ({ index: index + 1, routeId: label(phase.route?.id), provider: label(phase.route?.provider), model: label(phase.route?.model), passed: typeof phase.audit?.passed === 'boolean' ? phase.audit.passed : null })),
    quality: { included: reasonCode === null, explicitlyExcluded: invalid, exclusion: reasonCode ? { code: reasonCode, description: reasons[reasonCode], ...(reasonCode === 'other' ? { privateReasonSha256: digest(typeof input.invalidReason === 'string' ? input.invalidReason : JSON.stringify(input.invalidReason)) } : {}) } : null },
    ledger: { ...analysis.ledger, available: rows.length > 0, declaredAdmitted: declared, declaredCountMatches, driverObservations: observed, driverCountMatches, complete },
    usage: usageTotals(analysis.entries), cost: null,
    concurrency: { scope: 'per-process gate observations', observedPeak: analysis.peaks.size ? Math.max(...analysis.peaks.values()) : numeric(gate?.activePeak),
      configuredLimit: integer(gate?.concurrency ?? launch.concurrency), observedGateInstances: analysis.peaks.size, provesCrossProcessGlobalLimit: false },
    failureCodes: [...analysis.codes].sort(), nativePrunes: { count: nativePrunes?.size ?? null, scope: 'cumulative native session', basis: nativePrunes === null ? 'not provided; replacements and turn counts are not inferred as prunes' : 'unique native.prunes event sequences' },
    compression: compression(result), completedPublicTurns: list(result.publicAnswers).filter(answer => answer.endReason?.kind === 'completed').length,
  }
}

export function summarizeOcgExperiments(inputs) {
  if (!Array.isArray(inputs) || inputs.length > 1000) throw new TypeError('Explicit attempt list must contain at most 1000 entries')
  const identities = new Set()
  for (const input of inputs) { if (identities.has(input?.attemptId)) throw new TypeError('Duplicate attempt identity'); identities.add(input?.attemptId) }
  const attempts = inputs.map(summarizeOcgAttempt), union = analyzeStreams(inputs.flatMap(selectedStreams)), prunes = new Set()
  for (const input of inputs) for (const key of pruneKeys(input) ?? []) prunes.add(key)
  const knownPrunes = inputs.some(input => pruneKeys(input) !== null)
  return { format: 'dsh-ocg-public-experiments-v1', privacy: { whitelistOnly: true, promptsExported: false, privateReasoningExported: false, credentialsExported: false,
    knownSecretScan: 'Required separately before publication; structural redaction is not a known-secret scan.' }, attempts,
    totals: { attempts: attempts.length, qualityIncludedAttempts: attempts.filter(attempt => attempt.quality.included).length,
      strictGradePassed: attempts.filter(attempt => attempt.quality.included && attempt.grade?.passed === true && attempt.grade.consistent === true).length,
      strictGradeFailed: attempts.filter(attempt => attempt.quality.included && attempt.grade?.passed === false && attempt.grade.consistent === true).length,
      uniqueAdmittedRequests: union.ledger.uniqueAdmitted, realReportedUsage: usageTotals(union.entries.filter(entry => entry.synthetic === false)).reported,
      syntheticReportedUsage: usageTotals(union.entries.filter(entry => entry.synthetic === true)).reported,
      unknownEvidenceClassRequests: union.entries.filter(entry => typeof entry.synthetic !== 'boolean').length,
      unknownUsageRequests: union.entries.filter(entry => !entry.usage).length, uniqueNativePrunes: knownPrunes ? prunes.size : null,
      maximumPerProcessObservedPeak: union.peaks.size ? Math.max(...union.peaks.values()) : null, provesCrossProcessGlobalLimit: false, cost: null },
  }
}

function readExplicitFile(filename) {
  const entry = fs.lstatSync(filename)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 64 * 1024 * 1024) throw new TypeError('An explicit ordinary input file below 64 MiB is required')
  return fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/u, '')
}
export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: { input: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' } } })
  if (values.help) { console.log('Usage: node ocg-report.mjs --input <explicit-private-manifest.json> --output <NEW-public.json>\nManifest: array (or {attempts: array}) of inline {attemptId,launch,result,streams,invalidReason?}; or explicit launchFile/resultFile/streamsFile paths, relative to the manifest. No directory scanning. Known-secret scan remains required.'); return }
  if (!values.input || !values.output) throw new TypeError('Explicit input and new output are required')
  const inputFile = path.resolve(values.input), manifest = JSON.parse(readExplicitFile(inputFile)), entries = Array.isArray(manifest) ? manifest : manifest.attempts
  if (!Array.isArray(entries) || entries.length > 1000) throw new TypeError('Manifest must contain an explicit attempt list of at most 1000 entries')
  const base = path.dirname(inputFile), read = filename => readExplicitFile(path.resolve(base, filename))
  const inputs = entries.map(entry => ({ attemptId: entry.attemptId,
    launch: typeof entry.launchFile === 'string' ? JSON.parse(read(entry.launchFile)) : entry.launch,
    result: typeof entry.resultFile === 'string' ? JSON.parse(read(entry.resultFile)) : entry.result,
    streams: typeof entry.streamsFile === 'string' ? read(entry.streamsFile).split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)) : entry.streams,
    ...(Object.hasOwn(entry, 'invalidReason') ? { invalidReason: entry.invalidReason } : {}),
  }))
  const output = summarizeOcgExperiments(inputs)
  fs.writeFileSync(path.resolve(values.output), JSON.stringify(output, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ attempts: output.attempts.length, publicReportWritten: true }))
  return output
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch { console.error('ocg-report: explicit-input validation or exclusive output creation failed'); process.exitCode = 1 }
}
