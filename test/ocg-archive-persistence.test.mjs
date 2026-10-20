/** Official persisted JSONL contract, not merely Session/fold replay. No LLM adapter or provider. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url), sdkRoot = process.env.DSH_ULTRA_TEST_SDK
const names = ['cordis', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-llm', 'dsh-session-persistence-jsonl']
let unavailable
try {
  const file = sdkRoot ? path.join(sdkRoot, '@deepseek-ai/dsh-session/package.json') : require.resolve('@deepseek-ai/dsh-session/package.json')
  if (JSON.parse(await fs.readFile(file, 'utf8')).version !== '0.2.1-rc.2') unavailable = 'JSONL archive proof requires official 0.2.1-rc.2; skipped, not a compatibility pass.'
} catch { unavailable = 'Official 0.2.1-rc.2 JSONL modules unavailable; skipped, not a compatibility pass.' }
const load = name => sdkRoot ? import(pathToFileURL(path.join(sdkRoot, '@deepseek-ai', name, 'lib/index.js'))) : import('@deepseek-ai/' + name)
const sha = text => createHash('sha256').update(text).digest('hex')

test('thirty local-template archives survive actual JSONL append/flush/close, cold reopen, raw recovery and meter replay', { skip: unavailable }, async t => {
  const [cordis, sessions, projections, tokens, llm, jsonl, { archiveSession }, { ContextArchiveStore }] = await Promise.all([...names.map(load), import('../lib/context-archive.js'), import('../lib/context-archive-store.js')])
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ultra-archive-jsonl-')), logs = path.join(directory, 'logs'), evidence = path.join(directory, '.dsh-ultra/v1')
  await fs.mkdir(evidence, {recursive:true})
  let ctx, writer, reader, cold
  t.after(async () => { await reader?.close(); await writer?.close(); await cold?.fiber.dispose(); await ctx?.fiber.dispose(); await fs.rm(directory, { recursive: true, force: true }) })
  const backend = async () => {
    const value = new cordis.Context()
    await value.plugin(projections.SessionProjectionRegistry).await(); await value.plugin(tokens.TokenMeter).await()
    await value.plugin(jsonl, { root: logs, compression: 'none' }).await()
    return value
  }
  ctx = await backend()
  const session = sessions.Session.create(sessions.SessionId('persisted-archive-native'), undefined, { version: 4, id: sessions.SessionId('persisted-archive-native'), createdAt: 1, isSeeded: false, cwd: directory })
  const meter = ctx.get('tokenMeter'), events = [], append = session.append.bind(session)
  session.append = (...args) => { const event = append(...args); events.push(event); return event }
  const human = text => session.append('user/message', llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
  const closed = (turn, large) => {
    session.append('turn/start', { turn }); human('Exact original human constraint ' + turn)
    session.append('step/start', { turn, step: 1 })
    const callId = llm.ToolCallId('persisted-call-' + turn), argumentsText = JSON.stringify({ turn })
    session.append('assistant/message', { turn, step: 1, stream: [], message: llm.createAssistantMessage({ source: { provider: 'offline-fixture', model: 'no-model-call' }, content: [{ type: 'text', text: 'Exact public progress ' + turn }, { type: 'reasoning', text: 'SYNTHETIC_PRIVATE_NOT_EXPORTED' }, { type: 'tool-call', id: callId, name: 'fixture_read', arguments: argumentsText }] }) }, { surfaceOp: 'append' })
    session.append('tool/call', { turn, step: 1, callId, name: 'fixture_read', arguments: argumentsText })
    const result = session.append('tool/result', { turn, step: 1, message: llm.createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'ORIGINAL_LONG_RESULT_' + turn + ' ' + 'result '.repeat(large ? 12000 : 1) }] }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } })
    return result
  }
  const original = closed(1, true); closed(2, false); session.append('turn/start', { turn: 3 })
  writer = await ctx.get('sessionPersistence').create(session.header)
  let written = 0
  const checkpoint = async () => { if (events.length > written) { await writer.append(events.slice(written)); written = events.length } await writer.flush(); const check = await ctx.get('sessionPersistence').open(session.id, 'read'); try { await check.read() } finally { await check.close() } }
  await checkpoint() // Prove the fixture prefix is valid before exercising archive lifecycle.
  const prefix = JSON.stringify((await writer.read()).events)
  const access = { projectId: 'jsonl-archive-project', sessionIds: [session.id] }
  const store = new ContextArchiveStore(evidence, { projectId: access.projectId, authorize: () => true, readEvents: async (id, offset, length) => { assert.equal(id, session.id); return (await writer.read(offset, length)).events } })
  const options = { session, readEvents: async () => (await writer.read()).events, checkpoint,
    prepare: selected => store.prepare(access, { sessionId: session.id, events: selected, currentStateText: 'The earlier read executed; completion still requires verification.' }),
    estimateMessage: message => meter.estimateMessage(message), measureInputTokens: () => meter.measure(session).totalTokens,
    authority: { protocol: 'dsh-0.2.1-rc.2', soleOwner: true }, config: { enabled: true, targetTokens: 4096, triggerTokens: 4096, retainRecentMessages: 2, outputReserveTokens: 256, toolReserveTokens: 256 } }
  const outcomes = []; const outcome = await archiveSession(options); outcomes.push(outcome)
  assert.equal(outcome.status, 'archived')
  assert.equal(outcome.pruneSeq, undefined); assert.equal(events[outcome.summarySeq].type, 'compaction/summary')
  const summary = events[outcome.summarySeq].data, replacement = events[outcome.replacementSeq]
  assert.equal(summary.provider, 'dsh-ultra-local'); assert.equal(summary.model, 'completed-turn-archive-v1')
  assert.deepEqual(summary.summary, replacement.data.content)
  for (const key of ['llmStreamCall', 'usage', 'rawOutput', 'maxTokens']) assert.equal(Object.hasOwn(summary, key), false)
  assert.equal(events.some(event => event.type === 'compaction/prune'), false)
  assert.ok(replacement.sourceEventSeqs.includes(outcome.startSeq)); assert.ok(replacement.sourceEventSeqs.includes(outcome.summarySeq))
  assert.ok(JSON.stringify((await writer.read()).events).startsWith(prefix.slice(0, -1)))
  let currentTurn = 3, latest = outcome
  for (let cycle = 2; cycle <= 30; cycle++) {
    session.append('turn/end', { turn: currentTurn, reason: { kind: 'completed' } })
    closed(currentTurn + 1, true); closed(currentTurn + 2, false); currentTurn += 3
    session.append('turn/start', { turn: currentTurn }); await checkpoint()
    latest = await archiveSession(options); outcomes.push(latest); assert.equal(latest.status, 'archived', 'persisted cycle ' + cycle)
    const capsule = events[latest.replacementSeq].data.content[0].text
    assert.equal(capsule.split('[Ultra context archive v1;').length - 1, 1, 'Prior capsules flatten instead of recursively repeating recovery entries')
    assert.equal(capsule.split('Exact original human constraint 1\n').length - 1, 1)
  }
  assert.equal(events.filter(event => event.type === 'compaction/summary').length, 30)
  session.append('turn/end', { turn: currentTurn, reason: { kind: 'completed' } }); await checkpoint()
  const hotMessages = session.deriveMessages(), hotMeter = meter.measure(session).totalTokens
  await writer.close(); writer = undefined; await ctx.fiber.dispose(); ctx = undefined
  cold = await backend(); reader = await cold.get('sessionPersistence').open(session.id, 'read')
  const saved = await reader.read(), restored = sessions.Session.fromRestore(session.id, saved.events, reader.header, reader.inheritedEventCount, saved.eventState)
  assert.deepEqual(restored.deriveMessages(), hotMessages)
  const {loadWorkflowArchiveProofs}=await import('../scripts/host-acceptance/archive-proof.mjs')
  const {workflowPruneEvidence,workflowNativeCompressionAudit}=await import('../scripts/host-acceptance/ocg-workflow-plugin.mjs')
  const ultraRoot=path.resolve(import.meta.dirname,'..'), runtimeRoot=sdkRoot?path.dirname(sdkRoot):ultraRoot
  const proofs=await loadWorkflowArchiveProofs({events:saved.events,projectDir:directory,ultraRoot,runtimeRoot,projectId:access.projectId,sessionId:session.id})
  assert.equal(proofs.size,30);assert.ok([...proofs.values()].every(proof=>proof.kind==='native-template-summary'))
  const groups=outcomes.map((outcome,index)=>({nativeBoundary:outcome.startSeq,beforeGeneration:index,afterGeneration:index+1,nextRequestSequence:index+1,...workflowPruneEvidence({events:saved.events.filter(event=>event.seq<=outcome.endSeq),beforeSeq:outcome.startSeq,archiveProofs:proofs})}))
  assert.ok(groups.every(group=>group.pruneSeqs.length===0&&group.summarySeqs.length===1),'No summary is disguised as a prune')
  const requests=outcomes.map((outcome,index)=>({sequence:index+1,nativeBoundary:outcome.endSeq+1}))
  assert.equal(workflowNativeCompressionAudit({events:saved.events,groups,requests,archiveProofs:proofs}),true)
  assert.equal(workflowNativeCompressionAudit({events:saved.events,groups,requests}),false)
  const forged=structuredClone(saved.events);forged.find(event=>event.type==='compaction/summary').data.provider='opencode-go'
  await assert.rejects(loadWorkflowArchiveProofs({events:forged,projectDir:directory,ultraRoot,runtimeRoot,projectId:access.projectId,sessionId:session.id}))
  assert.equal(cold.get('tokenMeter').measure(restored).totalTokens, hotMeter)
  assert.equal(sha(saved.events[original.seq].data.message.content[0].text), sha(original.data.message.content[0].text))
  const recovered = new ContextArchiveStore(evidence, { projectId: access.projectId, authorize: () => true, readEvents: async (_id, offset, length) => (await reader.read(offset, length)).events })
  let publicTranscript = '', offset = 0
  for (;;) { const page = await recovered.get(access, latest.receiptId, { offset, maxChars: 64000 }); publicTranscript += page.text; if (page.nextOffset === undefined) break; offset = page.nextOffset }
  assert.equal(publicTranscript.includes('SYNTHETIC_PRIVATE_NOT_EXPORTED'), false)
  assert.equal(sha(JSON.parse(publicTranscript).find(event => event.seq === original.seq).data.message.content[0].text), sha(original.data.message.content[0].text))
  await reader.close();reader=undefined;writer=await cold.get('sessionPersistence').open(session.id,'write')
  const beforeTail=restored.seq;restored.append('turn/start',{turn:currentTurn+1});restored.append('user/message',llm.createUserMessage({source:{kind:'user'},content:[{type:'text',text:'A later read-only continuation after the exact cold archive prefix.'}]}),{surfaceOp:'append'});restored.append('turn/end',{turn:currentTurn+1,reason:{kind:'completed'}})
  const tail=restored.snapshotEvents().slice(saved.events.length)
  assert.ok(tail.slice(0,beforeTail-saved.events.length).every(event=>event.type!=='tool/call'),'Preserve native restore metadata without repeating any operation')
  await writer.append(tail);await writer.flush();await writer.close();writer=undefined
  reader=await cold.get('sessionPersistence').open(session.id,'read');const rolled=(await reader.read()).events
  assert.deepEqual(rolled.slice(0,saved.events.length),saved.events);assert.equal(rolled.length,saved.events.length+tail.length)
  t.diagnostic('Thirty actual JSONL reopenable template summaries + exact sealed metadata proofs; one cold append without any model or workflow-operation replay. Not real-model acceptance.')
})
