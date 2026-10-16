/** Secondary acceptance probes. The caller is the real rc.2 Loader driver.
 * Historical messages below are explicit protocol fixtures. Agent creation,
 * one subsequent turn, durability, native token pricing and restart are real.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export async function runCompressionChecks(ctx, config) {
  const requireRuntime = createRequire(path.join(config.runtimeRoot, 'package.json'))
  const sdk = name => import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/' + name)).href)
  const [{ Session, SessionId }, { createUserMessage, createAssistantMessage, createToolResultMessage, createSystemMessage, ToolCallId }, { default: NativeCompaction }] = await Promise.all([
    sdk('dsh-session'), sdk('dsh-llm'), sdk('dsh-compaction-basic'),
  ])
  const { UltraMemoryHost } = await import(pathToFileURL(path.join(config.ultraRoot, 'lib/memory-host.js')).href)
  const checks = []
  const check = (name, passed, details = {}) => { assert.ok(passed, name + ': ' + JSON.stringify(details)); checks.push({ name, passed: true, details }) }
  const digest = text => createHash('sha256').update(text).digest('hex')
  const marker = 'COMPRESSION_MIDDLE_CANARY_731'
  const text = 'Retain complete native evidence.\n' + 'compression fixture filler '.repeat(3200) + marker + ' recovered-middle\n' + 'second half fixture filler '.repeat(3200) + '\nEND_OF_RAW_COMPRESSION_SOURCE'
  const literal = 'EXACT_HUMAN_COMPRESSION_CONSTRAINT: stay offline, preserve 协作, and do not publish.'
  const manifestFile = path.join(config.projectDir, 'acceptance-compression-state.json')
  const memoryConfig = { evidenceEnabled: true, contextCompression: true, contextTargetTokens: 16000,
    contextOutputReserveTokens: 256, contextToolReserveTokens: 256, memorySearchChars: 6000, memoryGetChars: 64000 }
  const readEvents = async sessionId => {
    const session = ctx.sessions.get(sessionId)
    if (session) assert.equal(await ctx.sessions.flush(session), true)
    else await ctx.sessionPersistence.flush()
    const reader = await ctx.sessionPersistence.open(sessionId, 'read')
    try { assert.equal(reader.header.id, sessionId); return [...(await reader.read()).events] }
    finally { await reader.close() }
  }
  const getComplete = async (host, agent, id) => {
    let full = '', offset = 0
    for (;;) {
      const page = await host.get(agent, id, { offset, maxChars: 64000 })
      assert.ok(!['unavailable', 'hash-mismatch'].includes(page.status), 'original native source must remain readable')
      full += page.text
      if (page.nextOffset === undefined) return full
      assert.ok(page.nextOffset > offset, 'evidence paging must advance')
      offset = page.nextOffset
    }
  }
  if (config.mode === 'resume') {
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
    const handle = await config.resumeRoot(manifest.sessionId)
    const agent = handle.agent, host = new UltraMemoryHost(ctx, memoryConfig)
    const run = await host.begin(agent, 'compression-cold-process')
    try {
      check('native cold resume restores compression evidence ownership', !!run, host.status(agent.id))
      const events = await readEvents(agent.id), original = events[manifest.originalSeq], replacement = events[manifest.replacementSeq]
      check('cold native JSONL keeps full original and adjacent prune/replacement', digest(original.data.message.content[0].text) === manifest.rawHash
        && events[manifest.replacementSeq - 1].type === 'compaction/prune'
        && replacement.surfaceOp?.op === 'replace' && replacement.surfaceOp.startSeq === manifest.originalSeq
        && replacement.data.message.toolCallId === manifest.callId,
      { events: events.length, originalSeq: manifest.originalSeq, replacementSeq: manifest.replacementSeq })
      const visible = agent.session.deriveMessages()
      check('cold native surface preserves exact human constraint and bounded replacement', visible.some(message => message.content?.some(block => block.type === 'text' && block.text === literal))
        && visible.some(message => message.role === 'tool' && message.content?.[0]?.text.includes('[Ultra stored tool evidence'))
        && !visible.some(message => message.role === 'tool' && JSON.stringify(message.content).includes(marker)), { visibleMessages: visible.length })
      check('cold process can retrieve full native original by unchanged evidence ID', digest(await getComplete(host, agent, manifest.sourceId)) === manifest.rawHash,
        { sourceId: manifest.sourceId, rawChars: manifest.rawChars })
      const measured = agent.ctx.get('tokenMeter').measure(agent.session)
      check('cold native token meter replays compressed surface', measured.surfaceTokens === manifest.afterSurfaceTokens,
        { surfaceTokens: measured.surfaceTokens, expected: manifest.afterSurfaceTokens })
      await config.turn(agent, 'Continue the compressed session without replaying its historical read tool.')
      check('cold resumed AgentLoop completes after compression replay', agent.status === 'idle', {})
      if (manifest.recoveredCheckpoint) {
        const receipt = manifest.recoveredCheckpoint, recoveredHandle = await config.resumeRoot(receipt.sessionId)
        try {
          const recoveredAgent = recoveredHandle.agent, recoveredEvents = await readEvents(recoveredAgent.id)
          const restored = recoveredAgent.session.deriveMessages().find(message => message.role === 'tool' && message.toolCallId === receipt.callId)
          const compensated = recoveredEvents[receipt.restoredSeq]
          check('cold native resume preserves full surface after compensated checkpoint failure', !!restored
            && digest(restored.content[0].text) === receipt.rawHash
            && recoveredEvents[receipt.restoredSeq - 1].type === 'compaction/prune'
            && compensated.data.message.toolCallId === receipt.callId,
          { sessionId: receipt.sessionId, restoredSeq: receipt.restoredSeq, nativeEvents: recoveredEvents.length })
          await config.turn(recoveredAgent, 'Continue after durable restoration from the simulated checkpoint failure.')
          check('native AgentLoop continues after cold compensated checkpoint recovery', recoveredAgent.status === 'idle', {})
        } finally { await recoveredHandle.dispose() }
      }
      return { checks, protocolSetup: 'Explicit closed historical fixture followed by real native AgentLoop, JSONL storage, token meter and cold resume', manifest }
    } finally { await run?.dispose(); await handle.dispose() }
  }

  function history(id) {
    const session = Session.create(SessionId(id)), callId = ToolCallId(id + '-old-read')
    for (let turn = 1; turn <= 9; turn++) {
      session.append('turn/start', { turn })
      session.append('step/start', { turn, step: 1 })
      if (turn === 1) session.append('system/message', { turn, step: 1, message: createSystemMessage('Offline acceptance protocol fixture. Preserve the literal human requirements.') }, { surfaceOp: 'append' })
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: turn === 1 ? literal : 'Recent exact historical user instruction ' + turn }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      if (turn === 1) {
        session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{"file_path":"compression-fixture.txt"}' }], source: { provider: 'acceptance-offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
        session.append('tool/call', { turn, step: 1, callId, name: 'read', arguments: '{"file_path":"compression-fixture.txt"}' })
        session.append('tool/result', { turn, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError: false }) }, { surfaceOp: 'append' })
      } else session.append('assistant/message', { turn, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'text', text: 'Historical acknowledgement ' + turn }], source: { provider: 'acceptance-offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    return { seed: [...session.snapshotEvents()], callId }
  }
  async function probe(id) {
    const fixture = history(id), handle = await config.createRoot(id, config.projectDir, fixture.seed)
    const agent = handle.agent
    await config.turn(agent, 'Actual native AgentLoop turn after explicit compression protocol history.')
    const host = new UltraMemoryHost(ctx, memoryConfig), run = await host.begin(agent, 'compression-' + id)
    assert.ok(run, JSON.stringify(host.status(agent.id)))
    const native = agent.ctx.get('tokenMeter')
    check('actual rc.2 token-meter service available ' + id, typeof native?.estimateMessage === 'function' && typeof native?.measure === 'function', {})
    const events = await readEvents(agent.id), original = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === fixture.callId)
    assert.ok(original)
    return { handle, agent, host, run, native, original, callId: fixture.callId }
  }
  async function nativeStep(probe, task) {
    let observed
    const release = probe.agent.ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent === probe.agent) {
        await probe.host.beforeStep(payload.agent, payload.messages, payload.signal)
        observed = { visible: JSON.stringify(probe.agent.session.deriveMessages()), surfaceTokens: probe.native.measure(probe.agent.session).surfaceTokens }
      }
      return next()
    }, { prepend: true })
    try { await config.turn(probe.agent, task); assert.ok(observed, 'compression probe must run inside actual native pre-step'); return observed }
    finally { release() }
  }

  const success = await probe(config.sessionId + '-compression-success')
  let manifest
  try {
    check('compression scope has no foreign native engine', success.agent.ctx.get('compaction') == null, {})
    const before = success.native.measure(success.agent.session)
    await nativeStep(success, 'Native pre-step performs deterministic compression before admitting this new task.')
    const outcome = success.run.status().compression
    check('native persistent Session accepts deterministic Ultra pruning', outcome.replacements?.length === 1 && ['compacted', 'limited'].includes(outcome.status), success.run.status())
    const replacementSeq = outcome.replacements[0].replacementSeq, events = await readEvents(success.agent.id)
    const replacement = events[replacementSeq], prior = events[replacementSeq - 1]
    check('native JSONL stores adjacent shadow-price and same-call replacement', prior.type === 'compaction/prune'
      && prior.data.shadowedSeqs.includes(success.original.seq)
      && replacement.type === 'tool/result' && replacement.data.message.id === success.original.data.message.id
      && replacement.data.message.toolCallId === success.callId
      && replacement.surfaceOp?.startSeq === success.original.seq && replacement.sourceEventSeqs?.includes(success.original.seq),
    { originalSeq: success.original.seq, replacementSeq, shadowedTokenCount: prior.data.shadowedTokenCount })
    const sourceId = success.run.store.idsFor(success.agent.id, 'tool:' + success.callId)[0]
    check('same native source remains fully retrievable after pruning', digest(await getComplete(success.host, success.agent, sourceId)) === digest(text), { sourceId, rawChars: text.length })
    const after = success.native.measure(success.agent.session)
    check('real native token meter prices a smaller current surface', after.surfaceTokens < before.surfaceTokens,
      { before: before.surfaceTokens, after: after.surfaceTokens })
    const visible = success.agent.session.deriveMessages()
    check('compression retains human text and removes middle canary only from request surface', visible.some(message => message.content?.some(block => block.type === 'text' && block.text === literal))
      && !visible.some(message => message.role === 'tool' && JSON.stringify(message.content).includes(marker)), {})
    manifest = { sessionId: success.agent.id, originalSeq: success.original.seq, replacementSeq, sourceId, callId: success.callId,
      rawHash: digest(text), rawChars: text.length, afterSurfaceTokens: after.surfaceTokens }
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2))
  } finally { await success.run.dispose(); await success.handle.dispose() }

  const conflict = await probe(config.sessionId + '-compression-native-conflict')
  let nativeFiber
  try {
    nativeFiber = ctx.plugin(NativeCompaction, { auto: true }); await nativeFiber.await()
    const startGeneration = conflict.agent.session.surface.replaceGeneration
    check('actual native compaction-basic service mounted for conflict probe', conflict.agent.ctx.get('compaction') instanceof NativeCompaction, { nativeAuto: true })
    await nativeStep(conflict, 'Native pre-step observes the existing default compaction owner.')
    const outcome = conflict.run.status().compression
    check('Ultra refuses history replacement with actual native compactor present', outcome.status === 'unsupported'
      && conflict.agent.session.surface.replaceGeneration === startGeneration, outcome)
  } finally { await nativeFiber?.dispose(); await conflict.run.dispose(); await conflict.handle.dispose() }

  const dynamic = await probe(config.sessionId + '-compression-dynamic-owner')
  const dynamicCheckpoint = dynamic.run.checkpoint.bind(dynamic.run)
  try {
    const generation = dynamic.agent.session.surface.replaceGeneration
    dynamic.run.checkpoint = async () => {
      await dynamicCheckpoint()
      if (!nativeFiber) { nativeFiber = ctx.plugin(NativeCompaction, { auto: true }); await nativeFiber.await() }
    }
    nativeFiber = undefined
    await nativeStep(dynamic, 'Native pre-step stops compression when a compactor mounts during its checkpoint.')
    const outcome = dynamic.run.status().compression
    check('actual native compactor mounted during checkpoint prevents replacement', outcome.status === 'limited'
      && dynamic.agent.session.surface.replaceGeneration === generation && outcome.replacements.length === 0, outcome)
  } finally {
    dynamic.run.checkpoint = dynamicCheckpoint
    await nativeFiber?.dispose(); nativeFiber = undefined; await dynamic.run.dispose(); await dynamic.handle.dispose()
  }

  const cancellation = await probe(config.sessionId + '-compression-native-cancel')
  const cancellationCheckpoint = cancellation.run.checkpoint.bind(cancellation.run)
  let releaseHook
  try {
    const generation = cancellation.agent.session.surface.replaceGeneration
    let cancellationRequested = false, signalAborted = false
    cancellation.run.checkpoint = async () => {
      await cancellationCheckpoint()
      if (!cancellationRequested) { cancellationRequested = true; cancellation.agent.cancel({ kind: 'user' }) }
    }
    releaseHook = cancellation.agent.ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent === cancellation.agent) {
        await cancellation.host.beforeStep(payload.agent, payload.messages, payload.signal)
        signalAborted = payload.signal.aborted
      }
      return next()
    }, { prepend: true })
    await ctx.agents.withInitiator(cancellation.agent, async () => {
      cancellation.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Native cancellation at the context durability checkpoint.' }], source: { kind: 'user' } }))
      await cancellation.agent.whenIdle()
    })
    const events = await readEvents(cancellation.agent.id), end = events.findLast(event => event.type === 'turn/end')
    check('native AgentLoop cancellation during checkpoint retains original surface', cancellationRequested && signalAborted
      && end?.data.reason.kind === 'aborted' && cancellation.agent.session.surface.replaceGeneration === generation,
    { cancellationRequested, signalAborted, endReason: end?.data.reason, compression: cancellation.run.status().compression })
  } finally { cancellation.run.checkpoint = cancellationCheckpoint; releaseHook?.(); await cancellation.run.dispose(); await cancellation.handle.dispose() }

  const recovery = await probe(config.sessionId + '-compression-checkpoint-recovery')
  const recoveryCheckpoint = recovery.run.checkpoint.bind(recovery.run)
  try {
    const generation = recovery.agent.session.surface.replaceGeneration
    const visibleBefore = JSON.stringify(recovery.agent.session.deriveMessages()), before = recovery.native.measure(recovery.agent.session)
    let injectedFailure = false
    recovery.run.checkpoint = async () => {
      if (!injectedFailure && recovery.agent.session.surface.replaceGeneration > generation) {
        injectedFailure = true
        throw new Error('acceptance injected post-commit durability checkpoint failure')
      }
      return recoveryCheckpoint()
    }
    const afterCheckpoint = await nativeStep(recovery, 'Native pre-step recovers from the injected post-commit checkpoint failure.')
    const outcome = recovery.run.status().compression, events = await readEvents(recovery.agent.id)
    const prunes = events.filter(event => event.type === 'compaction/prune')
    const restored = events.findLast(event => event.type === 'tool/result' && event.data.message.toolCallId === recovery.callId)
    check('post-commit durability failure truthfully reports durable surface recovery', injectedFailure && outcome.status === 'failed'
      && outcome.originalHistoryRetained === true && outcome.surfaceRestored === true && outcome.recoveryCheckpointDurable === true, outcome)
    check('native compensation restores full model-visible messages after checkpoint failure', afterCheckpoint.visible === visibleBefore
      && afterCheckpoint.surfaceTokens === before.surfaceTokens,
    { beforeTokens: before.surfaceTokens, afterTokens: afterCheckpoint.surfaceTokens })
    check('native JSONL commits compensating shadow-price/result with original call identity', prunes.length === 2
      && events[restored.seq - 1].type === 'compaction/prune'
      && restored.surfaceOp?.op === 'replace' && restored.data.message.id === recovery.original.data.message.id
      && restored.data.message.toolCallId === recovery.callId && digest(restored.data.message.content[0].text) === digest(text),
    { originalSeq: recovery.original.seq, restoredSeq: restored.seq, nativePrunes: prunes.length })
    const sourceId = recovery.run.store.idsFor(recovery.agent.id, 'tool:' + recovery.callId)[0]
    check('restored native history still retrieves complete original evidence', digest(await getComplete(recovery.host, recovery.agent, sourceId)) === digest(text), { sourceId })
    manifest.recoveredCheckpoint = { sessionId: recovery.agent.id, originalSeq: recovery.original.seq, restoredSeq: restored.seq,
      sourceId, callId: recovery.callId, rawHash: digest(text) }
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2))
  } finally { recovery.run.checkpoint = recoveryCheckpoint; await recovery.run.dispose(); await recovery.handle.dispose() }
  return { checks, protocolSetup: 'Explicit closed historical fixture followed by real native AgentLoop, JSONL storage, token meter and cold resume', manifest }
}
