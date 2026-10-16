/** Re-evaluate existing public native evidence only. Performs no model/network calls.
 * Never exports assistant streams or reasoning blocks; original result is immutable.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { judgeFinal, expected } from './fixture.mjs'

const args = process.argv.slice(2), options = {}
for (let index = 0; index < args.length; index += 2) {
  if (!['--result', '--launch', '--out', '--session-log'].includes(args[index]) || !args[index + 1]) throw new Error('Use --result FILE --launch FILE --out FILE [--session-log FILE]')
  options[args[index].slice(2)] = path.resolve(args[index + 1])
}
for (const key of ['result', 'launch', 'out']) if (!options[key]) throw new Error('Missing --' + key)
if (options.out === options.result || options.out === options.launch) throw new Error('Regrade must write a separate output file')
try { await fs.access(options.out); throw new Error('Refusing to overwrite an existing re-evaluation') } catch (error) { if (error.code !== 'ENOENT') throw error }
const original = JSON.parse(await fs.readFile(options.result, 'utf8')), launch = JSON.parse(await fs.readFile(options.launch, 'utf8'))
const sessionId = original.recovery?.priorSessionId ?? original.publicAnswers?.at(-1)?.sessionId
if (!sessionId) throw new Error('Original native root session is unavailable')
let sessionLog = options['session-log']
if (!sessionLog) {
  const root = path.join(launch.home, 'sessions')
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(root, entry.name, sessionId, 'session.v4.jsonl')
    try { await fs.access(candidate); sessionLog = candidate; break } catch {}
  }
}
if (!sessionLog) throw new Error('Native session JSONL not found')
const rows = (await fs.readFile(sessionLog, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
const events = rows.filter(row => typeof row.type === 'string' && Number.isSafeInteger(row.seq))
const boundary = original.publicAnswers?.at(-1)?.boundary ?? 0
const relevant = events.filter(event => event.seq >= boundary)
const texts = relevant.filter(event => event.type === 'assistant/message').map(event => ({ seq: event.seq, text: (event.data.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n') })).filter(row => row.text.trim() !== '')
const final = texts.at(-1)
if (!final) throw new Error('No final public assistant message exists')
const calls = new Map(relevant.filter(event => event.type === 'tool/call').map(event => [event.data.callId, event.data]))
const retrieved = [], failures = []
for (const event of relevant.filter(event => event.type === 'tool/result')) {
  const callId = event.data.message.toolCallId ?? event.data.message.source?.callId, call = calls.get(callId)
  if (!call || !['ultra_memory_get', 'ultra_memory_search'].includes(call.name)) continue
  let argumentsValue, resultValue
  try { argumentsValue = JSON.parse(call.arguments) } catch {}
  const publicToolText = (event.data.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
  if (event.data.message.isError) {
    failures.push({ seq: event.seq, name: call.name, suppliedId: argumentsValue?.id ?? null, publicError: publicToolText.slice(0, 500),
      interpretation: typeof argumentsValue?.id === 'string' && argumentsValue.id.startsWith('chunk_') && argumentsValue.id.length < 70 ? 'Model supplied a truncated/non-resolving chunk locator. Failure remains counted; no model retry was performed by regrading.' : 'Original observed tool failure remains counted.' })
    continue
  }
  if (call.name !== 'ultra_memory_get') continue
  try { resultValue = JSON.parse(publicToolText) } catch { continue }
  const canonicalSources = []
  for (const id of resultValue.sourceIds ?? []) {
    if (!/^src_[a-f0-9]{64}$/.test(id)) continue
    const filename = createHash('sha256').update(id).digest('hex') + '.json'
    const envelope = JSON.parse(await fs.readFile(path.join(launch.projectDir, '.dsh-ultra', 'v1', 'records', filename), 'utf8')), record = envelope.record
    if (createHash('sha256').update(JSON.stringify(record)).digest('hex') !== envelope.sha256) throw new Error('Canonical source envelope integrity failure')
    if (record.id !== id || record.type !== 'source' || !['tool/result', 'tool/result:fixture_read'].includes(record.kind)) continue
    canonicalSources.push({ id, kind: record.kind, length: record.length, coverage: record.coverage, sessionId: record.sessionId, host: record.host,
      sha256: record.sha256, fullLargeCapture: record.length >= 50_000, interpretation: record.length >= 50_000 ? 'Canonical large tool result' : 'Canonical original tool slice; does not prove complete large-output capture' })
  }
  retrieved.push({ seq: event.seq, suppliedId: argumentsValue?.id ?? null, resolvedSourceIds: resultValue.sourceIds ?? [], canonicalSources, status: resultValue.status,
    facts: { batch: resultValue.text?.includes(expected.batch) === true, checksum: resultValue.text?.includes(expected.checksum) === true, left: resultValue.text?.includes(expected.left) === true, right: resultValue.text?.includes(expected.right) === true } })
}
const grade = judgeFinal(final.text)
const replayExecuted = relevant.some(event => event.type === 'tool/call' && event.data.name === 'fixture_execute')
const tail = retrieved.some(row => row.canonicalSources.length && row.facts.batch && row.facts.checksum)
const evaluation = { evaluatedAt: new Date().toISOString(), originalResult: options.result, originalVerdictPreserved: { status: original.status, error: original.error, grade: original.grade?.checks ?? null },
  method: 'Offline re-evaluation of final public assistant message and resolved native source IDs. No LLM calls, no stream/thinking exports, original result unchanged.',
  sessionId, boundary, finalPublicMessageSeq: final.seq, finalPublicText: final.text, publicProgress: texts.slice(0, -1), grade,
  mechanism: { canonicalOriginalToolSliceRetrieved: tail, fullLargeCaptureRetrieved: retrieved.some(row => row.canonicalSources.some(source => source.fullLargeCapture) && row.facts.batch && row.facts.checksum), retrieved },
  observedFailuresPreserved: failures, observedFailureCount: failures.length, executionReplayAttempted: replayExecuted,
  correctedVerdict: grade.passed && tail && !replayExecuted ? 'passed-with-observed-tool-failure' : 'failed',
  limitations: ['Original Max worker/report failure and its API usage remain unchanged.', 'Successful raw-slice retrieval is not evidence that the full long source was captured.', 'Regrading corrects harness evaluation only; it does not retry or repair any real model action.'] }
await fs.mkdir(path.dirname(options.out), { recursive: true })
await fs.writeFile(options.out, JSON.stringify(evaluation, null, 2))
process.stdout.write(JSON.stringify({ output: options.out, correctedVerdict: evaluation.correctedVerdict, qualityChecks: grade.checks.length, observedToolFailures: failures.length, privateReasoningExported: false }) + '\n')
