/** Offline protocol fixture: proves native wiring and ACLs, never model intelligence. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

export const name = 'dsh-global-knowledge-offline-acceptance'
export const inject = ['agents', 'agentLoop', 'tools', 'llm', 'sessions', 'sessionPersistence', 'systemPrompt', 'agentPresets', 'commands', 'settings', 'loader']
export const FIXTURE_QUOTE = 'KNOWLEDGE_NATIVE_SOURCE_731: the acceptance fixture colour is jade.'
export const COMPRESSION_LITERAL = 'MEMORY_COMPRESSION_HUMAN_ONCE_731: stay offline, preserve 协作, and do not repeat a completed operation.'
export const COMPRESSION_COMPLETED = 'MEMORY_COMPLETED_OPERATION_731: the historical tool returned; its real-world effect is not independently verified.'
const textOf = messages => messages.flatMap(message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text)).join('\n')

/** Resolve a real tool message by its assistant call identity, never by quoted text. */
export function nativeToolJson(messages, name) {
  const calls = new Set(messages.flatMap(message => message.role === 'assistant' ? (message.content ?? []).filter(block => block.type === 'tool-call' && block.name === name).map(block => block.id) : []))
  const message = messages.findLast(message => message.role === 'tool' && calls.has(message.toolCallId))
  if (!message || message.isError) return undefined
  return JSON.parse(textOf([message]))
}

/** Kept strict and unit tested; a model's words cannot manufacture verification. */
export function verifySharedSource(value, sourceId, quote = FIXTURE_QUOTE) {
  if (!value || value.hostVerified !== false || value.assessment !== 'model' || value.verification !== 'source-match' || typeof value.text !== 'string' || value.offset !== 0 || value.nextOffset !== undefined) return false
  let document; try { document = JSON.parse(value.text) } catch { return false }
  if (document.hostVerified !== false || document.verification !== 'source-match') return false
  return Array.isArray(document.sources) && document.sources.some(source => source.sourceId === sourceId && source.quote === quote && source.verification === 'source-match' && /^[a-f0-9]{64}$/u.test(source.sha256) && typeof source.sessionId === 'string')
}

export function auditCompressionSurface(messages, callId, rawMarker) {
  const calls = messages.flatMap(message => message.role === 'assistant' ? (message.content ?? []).filter(block => block.type === 'tool-call' && block.id === callId) : [])
  const results = messages.filter(message => message.role === 'tool' && message.toolCallId === callId)
  return calls.length === 1 && results.length === 1 && textOf(results).startsWith('[Ultra stored tool evidence') && !textOf(results).includes(rawMarker)
    && messages.filter(message => message.role === 'user' && textOf([message]) === COMPRESSION_LITERAL).length === 1
    && messages.some(message => message.role === 'assistant' && textOf([message]) === COMPRESSION_COMPLETED)
}

/** Closed protocol setup, never evidence of a real historical operation. */
export function appendCompressionProtocolHistory(session, round, sdk) {
  const { ToolCallId, createUserMessage, createAssistantMessage, createToolResultMessage, createSystemMessage } = sdk
  const rawMarker = 'COMPRESSION_RAW_MIDDLE_' + round + '_731', rawText = 'COMPRESSION_SOURCE_ROUND_' + round + '\n' + 'offline historical source filler '.repeat(3200) + rawMarker + '\n' + 'more historical source filler '.repeat(3200) + '\nEND_OF_RAW_SOURCE_' + round
  const fixture = { callId: ToolCallId('compression-old-call-' + round), rawMarker, rawText, rawSha256: createHash('sha256').update(rawText).digest('hex') }
  const start = Math.max(0, ...session.snapshotEvents().filter(event => event.type === 'turn/start').map(event => event.data.turn)) + 1
  for (let index = 0; index < 9; index++) {
    const number = start + index
    session.append('turn/start', { turn: number }); session.append('step/start', { turn: number, step: 1 })
    if (round === 1 && index === 0) session.append('system/message', { turn: number, step: 1, message: createSystemMessage('Offline standalone Memory protocol fixture. Preserve the exact human requirements.') }, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: round === 1 && index === 0 ? COMPRESSION_LITERAL : 'Explicit closed compression history fixture round ' + round + ' recent instruction ' + index }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    if (index === 0) {
      session.append('assistant/message', { turn: number, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'tool-call', id: fixture.callId, name: 'knowledge_compression_historical_read', arguments: '{}' }], source: { provider: 'knowledge-offline', model: 'scripted' } }) }, { surfaceOp: 'append' })
      session.append('tool/call', { turn: number, step: 1, callId: fixture.callId, name: 'knowledge_compression_historical_read', arguments: '{}' })
      fixture.originalSeq = session.append('tool/result', { turn: number, step: 1, message: createToolResultMessage({ callId: fixture.callId, content: [{ type: 'text', text: rawText }], isError: false }) }, { surfaceOp: 'append' }).seq
      if (round === 1) session.append('assistant/message', { turn: number, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'text', text: COMPRESSION_COMPLETED }], source: { provider: 'knowledge-offline', model: 'scripted' } }) }, { surfaceOp: 'append' })
    } else session.append('assistant/message', { turn: number, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'text', text: 'Closed historical protocol acknowledgement ' + number }], source: { provider: 'knowledge-offline', model: 'scripted' } }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn: number, step: 1 }); session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
  }
  return fixture
}

/** Native SDK format and isolated persistence preflight; no CLI profile or model. */
export async function preflightCompressionProtocol(runtimeRoot, storageRoot = undefined) {
  const requireRuntime = createRequire(path.join(runtimeRoot, 'package.json'))
  const sdk = async name => import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/' + name)).href)
  const [sessionSdk, messages, format, loopSdk] = await Promise.all([sdk('dsh-session'), sdk('dsh-llm'), sdk('dsh-session-format-v3-to-v4'), sdk('dsh-agent-loop')])
  const session = sessionSdk.Session.create(sessionSdk.SessionId('compression-native-sdk-preflight'))
  const rounds = []
  for (const round of [1, 2]) {
    const fixture = appendCompressionProtocolHistory(session, round, messages)
    const boundary = loopSdk.turnBoundaryProjectionDefinition
    const nativeTurnState = session.snapshotEvents().reduce((state, event) => boundary.apply(state, event), boundary.init())
    const turn = nativeTurnState.lastTurn + 1
    assert.equal(turn, Math.max(...session.snapshotEvents().filter(event => event.type === 'turn/start').map(event => event.data.turn)) + 1, 'A rehydrated native loop must continue the prepared fixture turn count')
    session.append('turn/start', { turn }); session.append('step/start', { turn, step: 1 })
    session.append('system/message', { turn, step: 1, message: messages.createSystemMessage('Subsequent native system assembly protocol preflight.') }, { surfaceOp: 'append' })
    session.append('assistant/message', { turn, step: 1, stream: [], message: messages.createAssistantMessage({ content: [{ type: 'text', text: 'Closed native protocol continuation.' }], source: { provider: 'knowledge-offline', model: 'scripted' } }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 }); session.append('turn/end', { turn, reason: { kind: 'completed' } })
    format.assertReleasedV4Relationships({ header: session.header, events: [...session.snapshotEvents()], inheritedEventCount: 0 }, sessionSdk.KNOWN_SESSION_EVENT_TYPES)
    rounds.push({ round, originalSeq: fixture.originalSeq, rawSha256: fixture.rawSha256, resumedNextTurn: turn, events: session.seq })
  }
  if (storageRoot) {
    assert.ok(path.isAbsolute(storageRoot), 'Native protocol preflight requires an explicit isolated storage root')
    await fs.mkdir(storageRoot, { recursive: true })
    const [{ Context }, persistence] = await Promise.all([sdk('cordis'), sdk('dsh-session-persistence-jsonl')])
    const ctx = new Context(), fiber = ctx.plugin(persistence, { root: storageRoot, compression: 'none' })
    try {
      await fiber.await()
      const native = ctx.get('sessionPersistence'), writer = await native.create({ ...session.header, cwd: storageRoot })
      try { await writer.append([...session.snapshotEvents()]); await writer.flush() } finally { await writer.close() }
      const reader = await native.open(session.id, 'read')
      try {
        for (const round of rounds) {
          const event = (await reader.read(round.originalSeq, 1)).events[0]
          assert.equal(createHash('sha256').update(textOf([event.data.message])).digest('hex'), round.rawSha256, 'Native persisted source must remain readable after later system assemblies')
          round.nativePersistedRead = true
        }
      } finally { await reader.close() }
    } finally { await fiber.dispose() }
  }
  return { meaning: 'Native SDK relationships and optional persistence read for both closed fixtures and later system assemblies; no model or production compaction is claimed', rounds }
}

export function apply(ctx, config) {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  if (!ready || !exit) throw new Error('Knowledge acceptance requires native CLI readiness and exit')
  let disposed = false
  const off = ready.onReady(() => {
    if (disposed) return
    run(ctx, config).then(() => exit(0), async error => {
      const phase = JSON.parse(await fs.readFile(config.phaseFile, 'utf8'))
      let partial = {}; try { partial = JSON.parse(await fs.readFile(phase.resultFile, 'utf8')) } catch {}
      await fs.writeFile(phase.resultFile, JSON.stringify({ ...partial, status: 'failed', phase: phase.mode, error: String(error), stack: error.stack }, null, 2))
      console.error('KNOWLEDGE_ACCEPTANCE_FAILED', error); exit(1)
    })
  })
  ctx.effect(() => () => { disposed = true; off() }, 'knowledgeAcceptance.ready')
}

async function run(ctx, config) {
  const phase = JSON.parse(await fs.readFile(config.phaseFile, 'utf8')), started = Date.now()
  const requireRuntime = createRequire(path.join(config.runtimeRoot, 'package.json'))
  const sdk = async name => import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/' + name)).href)
  const [{ LlmAdapter, createUserMessage, createAssistantMessage, createToolResultMessage, createSystemMessage, ToolCallId }, { defineContentToolFixture }] = await Promise.all([sdk('dsh-llm'), sdk('dsh-tools')])
  const ultra = file => import(pathToFileURL(path.join(config.ultraRoot, 'lib', file)).href)
  const result = { status: 'running', phase: phase.mode, target: config.target ?? 'ultra', loadOrder: config.loadOrder, companionPackage: config.companionPackage, host: 'actual DSH 0.2.1-rc.2 CLI Loader + AgentLoop + native ToolRuntime + JSONL', model: 'offline scripted LlmAdapter; not real-model intelligence, quality or billing evidence', requests: [], nativeCalls: [], checks: [] }
  const check = (name, condition, details = {}) => { assert.ok(condition, name + ': ' + JSON.stringify(details)); result.checks.push({ name, passed: true, details }) }
  let callCounter = 0, publicationId, sourceId
  const controls = new Map()
  const compressionFixtures = new Map()
  const call = (name, args) => ({ type: 'tool-call', id: ToolCallId('knowledge-call-' + ++callCounter), name, arguments: JSON.stringify(args) })
  const publication = id => ({ key: 'fixture-jade-731', title: 'Native acceptance fixture', summary: 'The local fixture reports jade.', applicability: 'Offline acceptance only; no conclusion about real-model quality.', topics: ['native-acceptance'], sources: [{ sourceId: id, quote: FIXTURE_QUOTE }] })
  class Offline extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: 'Offline knowledge acceptance' } }
    async listModels(provider) { return [{ provider, id: 'scripted', name: 'Scripted fixture' }] }
    async resolveModel(provider, model) { return { provider, id: model, name: 'Scripted fixture', context: { contextWindow: 1000000 }, reasoning: { efforts: [{ id: 'medium', name: 'Medium' }, { id: 'max', name: 'Max' }], defaultEffort: 'medium' } } }
    async *stream(options) {
      options.signal?.throwIfAborted()
      const text = textOf(options.messages), sequence = result.requests.length + 1
      assert.ok(sequence <= 40, 'Finite offline request budget exceeded')
      const lastUser = options.messages.findLastIndex(message => message.role === 'user' && ['user', 'ultra-route-task'].includes(message.source?.kind))
      const task = textOf(options.messages.slice(lastUser, lastUser + 1)), current = options.messages.slice(lastUser + 1)
      const entry = { sequence, sessionId: options.sessionId, text, tools: (options.tools ?? []).map(tool => tool.name), provider: options.provider, model: options.model, effort: options.reasoningEffort }
      result.requests.push(entry)
      if (task.includes('KNOWLEDGE_A_PUBLISH') || task.includes('KNOWLEDGE_B_READ') || task.includes('KNOWLEDGE_COMPRESSION_ROUND_')) {
        const failed = current.find(message => message.role === 'tool' && message.isError === true)
        assert.ok(!failed, 'Primary native tool chain failed: ' + textOf(failed ? [failed] : []))
      }
      let content
      if (task.includes('KNOWLEDGE_COMPRESSION_ROUND_')) {
        entry.stage = 'compression-probe'
        const round = Number(/KNOWLEDGE_COMPRESSION_ROUND_(\d+)/u.exec(task)?.[1]), fixture = compressionFixtures.get(round)
        assert.ok(fixture, 'Only two explicit bounded compression fixture rounds are allowed')
        const tick = nativeToolJson(current, 'knowledge_compression_tick'), found = nativeToolJson(current, 'ultra_memory_search'), fetched = nativeToolJson(current, 'ultra_memory_get')
        if (!tick) content = [call('knowledge_compression_tick', { round })]
        else {
          if (!fixture.observed) {
            const agent = ctx.agents.get(options.sessionId), native = agent.ctx.get('tokenMeter'), measured = native.measure(agent.session)
            const outcome = ctx.get('ultraEvidenceSupport').memory.status(agent.id)?.compression
            check('standalone Memory production pre-step automatically compacts round ' + round, ['compacted', 'limited'].includes(outcome?.status) && outcome.replacements?.some(item => item.callId === fixture.callId), outcome)
            check('subsequent actual request preserves user and completed-operation markers with intact tool pairing round ' + round, auditCompressionSurface(options.messages, fixture.callId, fixture.rawMarker))
            check('real native token meter observes a smaller replaced surface round ' + round, measured.surfaceTokens < fixture.beforeSurfaceTokens && agent.session.surface.replaceGeneration > fixture.beforeGeneration, { before: fixture.beforeSurfaceTokens, after: measured.surfaceTokens })
            const events = agent.session.snapshotEvents(), original = events[fixture.originalSeq], replacement = events.findLast(event => event.type === 'tool/result' && event.data.message?.toolCallId === fixture.callId && event.surfaceOp?.op === 'replace')
            check('actual session retains full raw original and adjacent native prune/replacement round ' + round, original?.data.message?.content?.[0]?.text === fixture.rawText && events[replacement?.seq - 1]?.type === 'compaction/prune' && replacement?.surfaceOp.startSeq === fixture.originalSeq && replacement?.data.message.id === original.data.message.id && replacement?.sourceEventSeqs?.includes(fixture.originalSeq))
            fixture.observed = true
            result.compression.rounds.push({ round, callId: fixture.callId, originalSeq: fixture.originalSeq, replacementSeq: replacement.seq, rawSha256: fixture.rawSha256, rawChars: fixture.rawText.length, beforeSurfaceTokens: fixture.beforeSurfaceTokens, afterSurfaceTokens: measured.surfaceTokens, outcome })
          }
          if (fetched) {
            check('native evidence tool retrieves exact original source quote after automatic compression round ' + round, ['host', 'captured'].includes(fetched.status) && fetched.citation?.sourceId === fixture.sourceId && fetched.citation.quote === fixture.rawMarker && fetched.citation.sha256 === fixture.rawSha256, fetched)
            result.compression.rounds.find(item => item.round === round).sourceId = fixture.sourceId
            content = [{ type: 'text', text: 'Automatic standalone Memory compaction and original evidence retrieval completed; this is a protocol fixture, not model-quality evidence.' }]
          } else if (found) {
            fixture.sourceId = found.items?.find(item => item.kind.startsWith('tool/result'))?.sourceId
            assert.ok(fixture.sourceId, 'Actual native search must locate the compacted original source')
            content = [call('ultra_memory_get', { id: fixture.sourceId, quote: fixture.rawMarker, maxChars: 2048 })]
          } else content = [call('ultra_memory_search', { query: fixture.rawMarker, kind: 'tool/result', maxChars: 6000 })]
        }
      } else if (task.includes('KNOWLEDGE_CONTROL_WINDOW')) {
        entry.stage = 'fixture-control-window'
        const control = controls.get(options.sessionId)
        assert.ok(control, 'Control stream must be owned by this active native agent')
        control.entered.resolve()
        await control.release.promise
        options.signal?.throwIfAborted()
        content = [{ type: 'text', text: 'Bounded native turn held for fixture-level ToolRuntime assertions; no model ability is inferred.' }]
      } else if (task.includes('KNOWLEDGE_A_PUBLISH')) {
        entry.stage = 'A-publish'
        const found = nativeToolJson(current, 'ultra_memory_search'), published = nativeToolJson(current, 'ultra_knowledge_publish')
        if (published) {
          publicationId = published.id; check('publish returned a real immutable record ID', typeof publicationId === 'string' && publicationId.length > 0)
          if (config.companionPackage && phase.mode === 'core') check('paired A active Memory request observer counts every actual stream exactly once', ctx.get('ultraEvidenceSupport').memory.status(options.sessionId)?.resources?.attemptedCalls === result.requests.filter(request => request.sessionId === options.sessionId).length)
          content = [{ type: 'text', text: 'Native publish completed; source matching does not prove a model conclusion.' }]
        }
        else if (found) {
          sourceId = found.items?.find(item => item.kind.startsWith('tool/result') && item.excerpt.includes(FIXTURE_QUOTE))?.sourceId
          assert.ok(sourceId, 'Real memory search must locate the fixture tool/result source')
          content = [call('ultra_knowledge_publish', publication(sourceId))]
        } else if (nativeToolJson(current, 'knowledge_fixture_read')) content = [call('ultra_memory_search', { query: 'KNOWLEDGE_NATIVE_SOURCE_731', kind: 'tool/result', maxChars: 4000 })]
        else content = [call('knowledge_fixture_read', {})]
      } else if (task.includes('KNOWLEDGE_B_READ')) {
        entry.stage = 'B-read'
        const found = nativeToolJson(current, 'ultra_knowledge_search'), fetched = nativeToolJson(current, 'ultra_knowledge_get')
        if (fetched) {
          check('subsequent actual B request contains the shared quote and exact verified source', verifySharedSource(fetched, sourceId), { fetched })
          check('B shared get does not expose the unshared raw tool tail', !fetched.text.includes('DO_NOT_SHARE_RAW_SESSION_TAIL_912'))
          if (config.companionPackage && phase.mode === 'core') check('paired B active Memory request observer counts every actual stream exactly once', ctx.get('ultraEvidenceSupport').memory.status(options.sessionId)?.resources?.attemptedCalls === result.requests.filter(request => request.sessionId === options.sessionId).length)
          entry.verifiedSharedSource = true
          content = [{ type: 'text', text: 'The shared source quote matched the native host source. The conclusion remains hostVerified:false.' }]
        } else if (found) {
          check('authorized B native search returns the actual publication', found.total === 1 && found.items?.[0]?.id === publicationId, found)
          content = [call('ultra_knowledge_get', { id: found.items[0].id, maxChars: 12000 })]
        } else content = [call('ultra_knowledge_search', { query: 'jade', maxChars: 6000 })]
      } else if (task.includes('KNOWLEDGE_WORKER_WRITE')) {
        entry.stage = 'worker-write'
        if (!current.some(message => message.role === 'tool')) {
          const workerAgent = ctx.agents.get(options.sessionId)
          check('worker execute and guard probes occur while its actual native route is running', workerAgent?.status === 'running')
          check('readonly worker native runtime guard denies a direct publish', denied(await executeTool(workerAgent, 'ultra_knowledge_publish', publication(sourceId))))
          let definitionDenied = false
          try { await ctx.tools.get('ultra_knowledge_publish').execute(publication(sourceId), { agent: workerAgent, signal: new AbortController().signal }) } catch { definitionDenied = true }
          check('write definition independently denies a running worker even bypassing tool guards', definitionDenied)
        }
        content = current.some(message => message.role === 'tool') ? [{ type: 'text', text: 'Worker write attempt finished; inspect the native error receipt.' }] : [call('ultra_knowledge_publish', publication(sourceId))]
      } else {
        entry.stage = 'ordinary-off'
        content = [{ type: 'text', text: 'Ordinary selected offline main turn; no automatic Ultra routing.' }]
      }
      for (const [index, block] of content.entries()) {
        yield { type: 'block-start', index, blockType: block.type }
        if (block.type === 'text') yield { type: 'text-delta', index, text: block.text }
        else yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments }
        yield { type: 'block-end', index, block }
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: content.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' } }
    }
  }
  const handles = [], routes = [], nativeChildren = []
  const releaseAdapter = ctx.llm.registerAdapter(['knowledge-offline'], new Offline())
  const releaseRead = ctx.tools.register(defineContentToolFixture({ name: 'knowledge_fixture_read', description: 'Read the fixed isolated local acceptance fixture; no path or network inputs', parameters: {},
    async execute(_args, exec) { check('fixture is read by project A only', exec.agent.session.header.cwd === config.projects.A); return [{ type: 'text', text: JSON.stringify({ text: await fs.readFile(path.join(config.projects.A, 'fixture.txt'), 'utf8') }) }] } }))
  const releaseTick = config.compressionProbe ? ctx.tools.register(defineContentToolFixture({ name: 'knowledge_compression_tick', description: 'Tiny no-op receipt to reach the next natural native pre-step in the offline compression probe', parameters: { round: { type: 'integer', required: true } }, async execute(args) { assert.ok([1, 2].includes(args.round)); return [{ type: 'text', text: JSON.stringify({ round: args.round, receipt: 'native-next-step-tick' }) }] } })) : () => {}
  const executeTool = async (agent, name, args = {}) => {
    const outcome = await ctx.tools.execute({ agent, name, arguments: args, signal: new AbortController().signal, callId: ToolCallId('knowledge-direct-' + ++callCounter) })
    result.nativeCalls.push({ agentId: agent.id, name, arguments: args, isError: outcome.isError, content: outcome.content })
    return outcome
  }
  const jsonOf = outcome => { assert.equal(outcome.isError, false, textOf([outcome])); return JSON.parse(textOf([outcome])) }
  const denied = outcome => outcome.isError === true && !textOf([outcome]).includes(FIXTURE_QUOTE)
  const createRoot = async (project, suffix = '', seed = undefined) => {
    const handle = await ctx.agents.create({ sessionId: config.sessionId + '-' + phase.mode + '-' + project + suffix, meta: { cwd: config.projects[project], agentPreset: 'offline' }, ...(seed ? { seed } : {}), agentOptions: { provider: 'knowledge-offline', model: 'scripted', reasoningEffort: 'medium', maxTokens: 2048 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } })
    handles.push(handle); return handle.agent
  }
  const turn = async (agent, task) => {
    const boundary = agent.session.seq
    await ctx.agents.withInitiator(agent, async () => { agent.followup(createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } })); await agent.whenIdle() })
    const events = agent.session.snapshotEvents().filter(event => event.seq >= boundary)
    check('native main turn completed ' + task, events.findLast(event => event.type === 'turn/end')?.data.reason.kind === 'completed', { reason: events.findLast(event => event.type === 'turn/end')?.data.reason })
    return events
  }
  // Fixture-only checks still require an actually running ordinary native turn.
  // The primary A→B protocol above is entirely model-emitted native tool calls.
  const withActive = async (agent, label, callback) => {
    assert.ok(!controls.has(agent.id), 'Only one control window per native agent')
    const control = { entered: Promise.withResolvers(), release: Promise.withResolvers() }
    controls.set(agent.id, control)
    const running = turn(agent, 'KNOWLEDGE_CONTROL_WINDOW: ' + label)
    let timer
    try {
      await Promise.race([control.entered.promise, running.then(() => { throw new Error('Native turn ended before entering fixture control window') }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native control window did not start')), 10000) })])
      check('fixture ToolRuntime assertions occur during an actual running native turn ' + label, agent.status === 'running')
      return await callback()
    } finally { clearTimeout(timer); control.release.resolve(); await running; controls.delete(agent.id) }
  }
  const runCompressionProbe = async () => {
    assert.equal(config.target, 'memory'); assert.ok(!config.companionPackage)
    const { Session, SessionId } = await sdk('dsh-session')
    result.compression = { protocolSetup: 'Explicit closed historical protocol fixtures; actual ordinary native turns, production pre-step hooks, native token meter, ToolRuntime and JSONL. Between rounds the actual agent is disposed and resumed after appending the second fixture through native persistence, so the native loop rehydrates its turn counter. No direct beforeStep or compactor calls.', contextTargetTokens: 16000, outputReserveTokens: 256, toolReserveTokens: 256, maximumRounds: 2, rounds: [] }
    const appendHistory = (session, round) => { const fixture = appendCompressionProtocolHistory(session, round, { ToolCallId, createUserMessage, createAssistantMessage, createToolResultMessage, createSystemMessage }); compressionFixtures.set(round, fixture); return fixture }
    const seed = Session.create(SessionId(config.sessionId + '-compression-seed'))
    appendHistory(seed, 1)
    let agent = await createRoot('A', '-compression', [...seed.snapshotEvents()])
    let native = agent.ctx.get('tokenMeter')
    check('standalone compression uses the actual native token meter and sole compaction authority', typeof native?.measure === 'function' && typeof native?.estimateMessage === 'function' && agent.ctx.get('compaction') == null)
    for (const round of [1, 2]) {
      let fixture = compressionFixtures.get(1)
      if (round === 2) {
        const support = ctx.get('ultraEvidenceSupport'), deadline = Date.now() + 10000
        while (support.runFor(agent) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
        check('first ordinary Memory run drained before appending the second explicit historical fixture', !support.runFor(agent))
        const sessionId = agent.id, boundary = agent.session.seq
        const detached = Session.create(sessionId, [...agent.session.snapshotEvents()], agent.session.header)
        fixture = appendHistory(detached, 2)
        const handle = handles.findLast(handle => handle.agent === agent)
        await handle.dispose()
        const writer = await ctx.sessionPersistence.open(sessionId, 'write')
        try { await writer.append(detached.snapshotEvents().filter(event => event.seq >= boundary)); await writer.flush() } finally { await writer.close() }
        const resumed = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: 'knowledge-offline', model: 'scripted', reasoningEffort: 'medium', maxTokens: 2048 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } })
        handles.push(resumed); agent = resumed.agent; native = agent.ctx.get('tokenMeter')
        check('actual native resume restores the same session after the second closed fixture', agent.id === sessionId && agent.session.seq >= detached.seq && agent.session.snapshotEvents().find(event => event.seq === fixture.originalSeq)?.data.message?.toolCallId === fixture.callId)
      }
      fixture.beforeSurfaceTokens = native.measure(agent.session).surfaceTokens; fixture.beforeGeneration = agent.session.surface.replaceGeneration
      await turn(agent, 'KNOWLEDGE_COMPRESSION_ROUND_' + round + ': continue the explicit historical protocol fixture, advance a native step, and retrieve the original source without repeating its operation.')
      check('automatic compression round completed with actual source retrieval ' + round, result.compression.rounds.some(item => item.round === round && item.sourceId))
    }
    check('standalone Memory performs two distinct real native surface compactions', new Set(result.compression.rounds.map(item => item.replacementSeq)).size === 2 && new Set(result.compression.rounds.map(item => item.callId)).size === 2)
    result.compression.sessionId = agent.id
  }
  try {
    const profile = ctx.get('profileContext')
    check('profile directory comes from actual native profileContext', path.resolve(profile?.dir ?? '') === path.resolve(config.profileDir), { dir: profile?.dir })
    const entry = [...ctx.loader.entries()].find(row => row.options.name === (config.targetPackage ?? '@dsh-external/dsh-ultra-mode'))
    check('frozen candidate owns an active native Loader entry', !!entry?.fiber)
    const authorityEntry = [...ctx.loader.entries()].find(row => row.options.name === (config.authorityPackage ?? config.targetPackage ?? '@dsh-external/dsh-ultra-mode'))
    check('knowledge configuration authority has an active native Loader fiber', !!authorityEntry?.fiber)
    if (config.companionPackage) {
      const coordinator = [...ctx.loader.entries()].find(row => row.options.name === config.coordinatedPackage)
      check('paired configuration explicitly tests Memory enabled with coordinator local evidence disabled', authorityEntry.fiber.config.evidenceEnabled === true && coordinator?.fiber?.config.evidenceEnabled === false)
    }
    const fiber = authorityEntry.fiber, source = fiber.config.globalKnowledge
    check('global knowledge uses a native volatile configuration reference', typeof source?.get === 'function')
    const readSettings = async () => source.get()
    const saveSettings = async value => {
      await ctx.settings.update(authorityEntry.options.id, { globalKnowledge: value })
      check('native Settings hot update retains the mounted authority plugin and volatile reference', authorityEntry.fiber === fiber && authorityEntry.fiber.config.globalKnowledge === source)
    }
    const mainA = await createRoot('A'), mainB = await createRoot('B'), mainC = await createRoot('C')
    if (config.target === 'memory') {
      check('standalone Memory registers no Ultra multi-route tool', !ctx.tools.schemas(mainA).some(tool => tool.name === 'ultra_task'))
      check('standalone Memory has the native shared evidence service', !!ctx.get('ultraEvidenceSupport'))
    }
    if (phase.mode === 'core') {
      const events = await turn(mainA, 'KNOWLEDGE_A_PUBLISH: read the isolated fixture, locate its real source, and explicitly publish it.')
      check('A used the real native tool chain while ordinary Ultra mode remained off', ['knowledge_fixture_read', 'ultra_memory_search', 'ultra_knowledge_publish'].every(name => events.some(event => event.type === 'tool/call' && event.data.name === name)))
      check('knowledge tools are available to the authorized ordinary main request', result.requests.filter(request => request.sessionId === mainA.id).every(request => ['ultra_knowledge_publish', 'ultra_knowledge_search', 'ultra_knowledge_get'].every(name => request.tools.includes(name))))
      await turn(mainB, 'KNOWLEDGE_B_READ: search the authorized shared knowledge and verify its source.')
      check('B received source verification in a subsequent native request', result.requests.some(request => request.sessionId === mainB.id && request.verifiedSharedSource === true))
      await withActive(mainB, 'B raw denial and read-only write denial', async () => {
        const raw = await executeTool(mainB, 'ultra_memory_get', { id: sourceId, quote: FIXTURE_QUOTE })
        check('B cannot read A raw project evidence', denied(raw) || (!textOf([raw]).includes(FIXTURE_QUOTE) && ['unavailable', 'reference-only'].includes(jsonOf(raw).status)))
        check('read-only project B cannot publish', denied(await executeTool(mainB, 'ultra_knowledge_publish', publication(sourceId))))
      })
      await withActive(mainC, 'unlisted C', async () => check('unlisted C cannot search', denied(await executeTool(mainC, 'ultra_knowledge_search', { query: 'jade' }))))
      const unrelatedA = await createRoot('A', '-unrelated')
      await withActive(unrelatedA, 'same-project unrelated root', async () => check('same-project unrelated root cannot publish another session source', denied(await executeTool(unrelatedA, 'ultra_knowledge_publish', publication(sourceId)))))
      await withActive(mainA, 'publisher negative cases, idempotence and worker', async () => {
        check('forged source ID cannot publish', denied(await executeTool(mainA, 'ultra_knowledge_publish', publication('src_' + 'f'.repeat(64)))))
        check('rewritten quote cannot publish', denied(await executeTool(mainA, 'ultra_knowledge_publish', { ...publication(sourceId), sources: [{ sourceId, quote: 'forged quote' }] })))
        const again = jsonOf(await executeTool(mainA, 'ultra_knowledge_publish', publication(sourceId)))
        check('same native publication is idempotent', again.id === publicationId)
        if (config.target === 'memory') {
          const child = await ctx.agents.withInitiator(mainA, () => ctx.agents.create({ sessionId: config.sessionId + '-native-child', parentAgent: mainA, meta: { cwd: config.projects.A, parentSession: mainA.id, origin: 'subagent', agentPreset: 'offline' }, agentOptions: { provider: 'knowledge-offline', model: 'scripted', reasoningEffort: 'medium', maxTokens: 2048 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } }))
          nativeChildren.push(child)
          check('standalone Memory tests a real native child and parentSession lineage', child.agent.session.header.parentSession === mainA.id && child.agent.ctx !== mainA.ctx)
          await turn(child.agent, 'KNOWLEDGE_WORKER_WRITE: a native ordinary child attempts the knowledge write tools.')
          check('native ordinary child tool write is denied', child.agent.session.snapshotEvents().some(event => event.type === 'tool/result' && event.data.message?.isError))
          await child.dispose()
        } else {
          const { createRoute } = await ultra('runtime.js')
          const { memoryFor } = await ultra('memory-host.js')
          const worker = await createRoute(mainA, { id: config.sessionId + '-worker', label: 'Knowledge readonly worker', readOnly: true, researchTools: ['ultra_knowledge_publish', 'ultra_knowledge_revoke', 'ultra_knowledge_search'], signal: new AbortController().signal, memory: memoryFor(mainA) }, entry.fiber.config)
          routes.push(worker)
          await ctx.agents.withInitiator(mainA, () => worker.run([{ type: 'text', text: 'KNOWLEDGE_WORKER_WRITE' }]))
          const workerAgent = ctx.agents.get(worker.id)
          check('readonly Ultra worker native write is denied', workerAgent.session.snapshotEvents().some(event => event.type === 'tool/result' && event.data.message?.isError))
          await worker.dispose()
        }
      })
      if (config.companionPackage) {
        await withActive(mainB, 'native coordinator fiber unload retains Memory lease', async () => {
          const support = ctx.get('ultraEvidenceSupport')
          const coordinatedEntry = [...ctx.loader.entries()].find(row => row.options.name === config.coordinatedPackage)
          check('paired coordinator has its own actual active native Loader fiber', !!coordinatedEntry?.fiber && coordinatedEntry.fiber !== authorityEntry.fiber)
          check('paired authoritative Memory configuration can read before unload', verifySharedSource(jsonOf(await executeTool(mainB, 'ultra_knowledge_get', { id: publicationId })), sourceId))
          await coordinatedEntry.fiber.dispose()
          check('native coordinator fiber release retains the same shared evidence service', ctx.get('ultraEvidenceSupport') === support && authorityEntry.fiber === fiber)
          check('remaining Memory lease still reads verified shared data', verifySharedSource(jsonOf(await executeTool(mainB, 'ultra_knowledge_get', { id: publicationId })), sourceId))
          for (const name of ['ultra_memory_search', 'ultra_memory_get', 'ultra_knowledge_search', 'ultra_knowledge_get', 'ultra_knowledge_publish', 'ultra_knowledge_revoke']) check('one shared native tool remains after companion unload ' + name, ctx.tools.schemas(mainB).filter(tool => tool.name === name).length === 1)
        })
      }
      const previous = await readSettings()
      const added = { ...previous, projects: previous.projects.map(project => project.id === 'A' ? { ...project, shareWith: ['B', 'C'] } : project).concat([{ id: 'C', root: config.projects.C, read: true, publish: false, shareWith: [] }]) }
      await saveSettings(added)
      await withActive(mainC, 'new C snapshot grant', async () => {
        const noRetroactive = jsonOf(await executeTool(mainC, 'ultra_knowledge_search', { query: 'jade' }))
        check('new reader cannot enlarge an earlier readers snapshot or its count', noRetroactive.total === 0 && noRetroactive.items.length === 0)
      })
      const retracted = { ...previous, projects: previous.projects.map(project => project.id === 'A' ? { ...project, shareWith: [] } : project) }
      await withActive(mainB, 'hot retraction during an actual running B turn', async () => {
        check('B can get the publication immediately before hot retraction', verifySharedSource(jsonOf(await executeTool(mainB, 'ultra_knowledge_get', { id: publicationId })), sourceId))
        await saveSettings(retracted)
        const hidden = jsonOf(await executeTool(mainB, 'ultra_knowledge_search', { query: 'jade' }))
        check('hot retraction hides search metadata and count', hidden.total === 0 && hidden.items.length === 0 && !JSON.stringify(hidden).includes('Native acceptance fixture'))
        check('hot retraction denies get', denied(await executeTool(mainB, 'ultra_knowledge_get', { id: publicationId })))
      })
      await fs.writeFile(config.stateFile, JSON.stringify({ publicationId, sourceId, originalSettings: previous, coreProfileDir: profile.dir, coreRootA: mainA.id, coreRootB: mainB.id }, null, 2), { flag: 'wx' })
      result.publicationId = publicationId; result.sourceId = sourceId
      if (config.compressionProbe) await runCompressionProbe()
    } else {
      const state = JSON.parse(await fs.readFile(config.stateFile, 'utf8')); publicationId = state.publicationId; sourceId = state.sourceId
      if (phase.mode === 'resume') {
        result.resumeRootB = mainB.id
        const saved = await readSettings()
        check('native Settings revocation survives an actual CLI process restart', saved.projects.find(project => project.id === 'A').shareWith.length === 0)
        await withActive(mainB, 'cold persisted retraction', async () => check('cold retracted B cannot get publication', denied(await executeTool(mainB, 'ultra_knowledge_get', { id: publicationId }))))
        await saveSettings(state.originalSettings)
        await turn(mainB, 'KNOWLEDGE_B_READ: search the restored shared publication after a real cold restart.')
        check('cold native get resolves the original A session source', result.requests.some(request => request.verifiedSharedSource))
        await withActive(mainA, 'publisher explicit revoke', async () => {
          const revoked = jsonOf(await executeTool(mainA, 'ultra_knowledge_revoke', { id: publicationId, reason: 'Explicit offline acceptance cleanup of publication' }))
          check('native fourth tool explicitly revokes the immutable publication', revoked.id === publicationId && revoked.status === 'revoked')
        })
        await withActive(mainB, 'former reader after revoke', async () => {
          const hidden = jsonOf(await executeTool(mainB, 'ultra_knowledge_search', { query: 'jade' }))
          check('revoked publication no longer appears for its former reader', hidden.total === 0 && hidden.items.length === 0)
          check('revoked publication denies former reader get', denied(await executeTool(mainB, 'ultra_knowledge_get', { id: publicationId })))
        })
      } else {
        check('foreign profile uses a distinct actual native profile directory', path.resolve(profile.dir) !== path.resolve(state.coreProfileDir))
        await withActive(mainB, 'foreign profile isolation', async () => {
          const found = jsonOf(await executeTool(mainB, 'ultra_knowledge_search', { query: 'jade' }))
          check('another profile shares no publication metadata or hit count', found.total === 0 && found.items.length === 0)
          check('another profile denies original publication ID', denied(await executeTool(mainB, 'ultra_knowledge_get', { id: publicationId })))
        })
      }
    }
    const rootIds = new Set(handles.map(handle => handle.agent.id)), workerIds = new Set(routes.map(route => route.id)), nativeChildIds = new Set(nativeChildren.map(handle => handle.agent.id))
    check('ordinary off mode never auto-launches paid or extra coordinator routes', result.requests.every(request => (((rootIds.has(request.sessionId) || nativeChildIds.has(request.sessionId)) && request.effort === 'medium') || (workerIds.has(request.sessionId) && request.effort === 'max')) && request.provider === 'knowledge-offline' && request.model === 'scripted'))
    const gate = ctx.get('ultraAcceptanceModelGate')?.snapshot()
    check('reused global offline stream gate accounts all requests and never exceeds two', gate?.activePeak <= 2 && gate?.active === 0 && gate?.admitted === result.requests.length && gate.synthetic === true, gate)
    result.globalGate = gate; result.status = 'passed'
  } finally {
    const cleanupErrors = []
    for (const dispose of [...routes.toReversed().map(route => () => route.dispose()), ...nativeChildren.toReversed().map(handle => () => handle.dispose()), ...handles.toReversed().map(handle => () => handle.dispose()), releaseTick, releaseRead, releaseAdapter]) try { await dispose() } catch (error) { cleanupErrors.push(String(error)) }
    result.cleanupErrors = cleanupErrors; result.elapsedMs = Date.now() - started
    await fs.writeFile(phase.resultFile, JSON.stringify(result, null, 2))
    if (cleanupErrors.length) throw new Error('Native knowledge cleanup failed: ' + cleanupErrors.join('; '))
  }
}
