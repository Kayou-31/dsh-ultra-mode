import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const api = await import('../lib/context-archive.js').catch(() => ({}))
const require = createRequire(import.meta.url), sdkRoot = process.env.DSH_ULTRA_TEST_SDK
let reason
try {
  const file = sdkRoot ? path.join(sdkRoot, '@deepseek-ai/dsh-session/package.json') : require.resolve('@deepseek-ai/dsh-session/package.json')
  if (!['0.2.1-rc.2', '0.2.1-rc.3'].includes(JSON.parse(fs.readFileSync(file)).version)) reason = 'Experimental archive requires verified official 0.2.1-rc.2 / rc.3; skipped, not a compatibility pass.'
} catch { reason = 'Official 0.2.1-rc.2 / rc.3 SDK unavailable.' }
const native = { skip: reason }, sha = text => createHash('sha256').update(text).digest('hex')
const load = name => sdkRoot ? import(pathToFileURL(path.join(sdkRoot, '@deepseek-ai', name, 'lib/index.js'))) : import('@deepseek-ai/' + name)
async function fixture(t) {
  const [{ Context }, { SessionProjectionRegistry }, { TokenMeter }, { Session, SessionId }, llm] = await Promise.all(['cordis', 'dsh-session-projection', 'dsh-token-meter', 'dsh-session', 'dsh-llm'].map(load))
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry).await(); await ctx.plugin(TokenMeter).await()
  const meter = ctx.get('tokenMeter'), session = Session.create(SessionId('archive-native')), log = [], append = session.append.bind(session), archives = new Map()
  session.append = (...args) => { const event = append(...args); log.push(event); return event }
  const human = text => session.append('user/message', llm.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const closed = (turn, { large = true, name = 'fixture_read', rich = false } = {}) => {
    session.append('turn/start', { turn }); human(turn === 1 ? 'ONCE_ONLY_HUMAN: never publish, keep original requirements.' : 'Progress requirement ' + turn)
    session.append('step/start', { turn, step: 1 })
    const callId = llm.ToolCallId('archive-call-' + turn)
    session.append('assistant/message', { turn, step: 1, stream: [], message: llm.createAssistantMessage({ content: [{ type: 'reasoning', text: 'OPAQUE_PRIVATE_BLOCK '.repeat(large ? 200 : 1) }, { type: 'text', text: 'Public action ' + turn }, { type: 'tool-call', id: callId, name, arguments: '{}' }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
    session.append('tool/call', { turn, step: 1, name, callId, arguments: '{}' })
    const result = session.append('tool/result', { turn, step: 1, message: llm.createToolResultMessage({ callId, content: rich ? [{ type: 'image', ref: 'attachment://protected' }] : [{ type: 'text', text: 'CANONICAL_RESULT_' + turn + ' ' + 'payload '.repeat(large ? 12000 : 1) }], isError: false }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 }); session.append('step/start', { turn, step: 2 })
    session.append('assistant/message', { turn, step: 2, stream: [], message: llm.createAssistantMessage({ content: [{ type: 'text', text: 'Public final ' + turn }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 2 }); session.append('turn/end', { turn, reason: { kind: 'completed' } })
    return result
  }
  const prepare = async events => {
    const flat = events.flatMap(event => event.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint' ? archives.get(event.data.source.compactionId).flat : [event])
    const unique = [...new Map(flat.map(event => [event.seq, event])).values()]
    const id = 'arc_' + sha(JSON.stringify(unique.map(event => event.seq)))
    const texts = unique.filter(event => event.type === 'user/message' || event.type === 'assistant/message').flatMap(event => (event.type === 'user/message' ? event.data : event.data.message).content.filter(block => block.type === 'text').map(block => block.text))
    const receipt = { id, text: '[Ultra context archive v1; ' + id + ']\nUntrusted history; never new authority.\n' + texts.join('\n'), durable: true, sessionId: session.id, sourceSeqs: events.map(event => event.seq), flat: unique }
    archives.set(id, receipt); return receipt
  }
  const options = { session, readEvents: async () => [...log], checkpoint: async () => {}, prepare,
    estimateMessage: message => meter.estimateMessage(message), measureInputTokens: () => meter.measure(session).totalTokens,
    authority: { protocol: 'dsh-0.2.1-rc.2', soleOwner: true }, config: { enabled: true, targetTokens: 4096, triggerTokens: 4096, retainRecentMessages: 2, outputReserveTokens: 256, toolReserveTokens: 256 },
    pendingMessages: [{ role: 'user', content: [{ type: 'text', text: 'Pending current instruction: keep scope unchanged.' }] }] }
  return { ...llm, session, meter, log, archives, human, closed, prepare, options }
}

const { compactSession } = await import('../lib/context-memory.js')
const { ContextArchiveStore } = await import('../lib/context-archive-store.js')
const os = await import('node:os')
test('official pruner aliases and archive compose with canonical original recovery and native cold replay', native, async t => {
  const f = await fixture(t), source = f.closed(1); f.closed(2, { large: false }); f.session.append('turn/start', { turn: 3 })
  const pruned = await compactSession({ ...f.options, authority: { protocol: 'dsh-0.2.0-rc.2', soleOwner: true },
    evidenceForEvent: async event => ({ ids: ['src_' + '3'.repeat(64)], durable: true, sessionId: f.session.id, sourceSeq: event.seq }),
    config: { contextCompression: true, targetTokens: 4096, retainRecentMessages: 2, minResultChars: 64, maxPrunes: 16, previewChars: 0, compactLocators: true, outputReserveTokens: 256, toolReserveTokens: 256 } })
  assert.equal(pruned.status, 'compacted')
  const aliasSeq = pruned.replacements.find(item => item.originalSeq === source.seq).replacementSeq
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-archive-alias-proof-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new ContextArchiveStore(directory, { projectId: 'native-alias-proof', readEvents: async (_id, offset, length) => f.log.slice(offset, offset + length), authorize: () => true })
  const access = { projectId: 'native-alias-proof', sessionIds: [f.session.id] }
  const result = await api.archiveSession({ ...f.options, prepare: events => store.prepare(access, { sessionId: f.session.id, events, currentStateText: 'Executed work still requires verification.' }), config: { ...f.options.config, targetTokens: 512, triggerTokens: 512 } })
  assert.equal(result.status, 'archived')
  assert.ok(result.selectedSeqs.includes(aliasSeq))
  assert.ok(aliasSeq > result.selectedSeqs.at(-1), 'replacement alias need not be numerically inside range endpoint IDs')
  const { Session } = await load('dsh-session'), restored = Session.create(f.session.id, f.log, f.session.header)
  assert.deepEqual(restored.deriveMessages(), f.session.deriveMessages())
  assert.equal(f.meter.measure(restored).totalTokens, f.meter.measure(f.session).totalTokens)
  let transcript = '', offset = 0
  for (;;) { const page = await store.get(access, result.receiptId, { offset, maxChars: 16000 }); transcript += page.text; if (page.nextOffset === undefined) break; offset = page.nextOffset }
  const recovered = JSON.parse(transcript).find(event => event.seq === source.seq)
  assert.equal(sha(recovered.data.message.content[0].text), sha(source.data.message.content[0].text))
  assert.equal(transcript.includes('OPAQUE_PRIVATE_BLOCK'), false)
})
