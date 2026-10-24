import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

// Run every native class AND each independently bundled core against the same
// selected SDK. Otherwise a nominal new-SDK run silently uses local old peers.
const selectedSdk = process.env.DSH_ULTRA_TEST_SDK && path.resolve(process.env.DSH_ULTRA_TEST_SDK)
const selectedRequire = createRequire(selectedSdk ? path.join(selectedSdk, '.ultra-sdk-selector.cjs') : import.meta.url)
const sdkImport = name => import(pathToFileURL(selectedRequire.resolve('@deepseek-ai/' + name)).href)
const [{ Context }, { ToolRuntime, defineContentToolFixture }, { SystemPrompt }, { SessionStore, SessionId }] =
  await Promise.all(['cordis', 'dsh-tools', 'dsh-system-prompt', 'dsh-session'].map(sdkImport))

// Separate self-contained bundles reproduce independent plugin module registries.
const output = fs.mkdtempSync(path.resolve('node_modules/.evidence-support-test-'))
async function bundle(name) {
  if (!fs.existsSync('src/evidence-support.ts')) return {}
  const outfile = path.join(output, name + '.mjs')
  await build({ stdin: { contents: 'export * from "./src/evidence-support.ts"; export {beginMemoryRun,memoryFor} from "./src/memory-host.ts"; export * as memoryPlugin from "./src/memory-plugin.ts"; export {Config as UltraConfig} from "./src/index.ts"; export {Config as DecisionConfig} from "./src/decision-plugin.ts"', resolveDir: process.cwd() }, outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'pinned-native-sdk', setup(build) { build.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: pathToFileURL(selectedRequire.resolve(args.path)).href, external: true })) } }],
  })
  return import(pathToFileURL(outfile).href)
}
const first = await bundle('first'), second = await bundle('second')
test.after(() => fs.rmSync(output, { recursive: true, force: true }))

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-support-'))
  const ctx = new Context(), agents = new Map(), durable = new Map()
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
  await ctx.plugin(ToolRuntime, { mode: 'native' }).await()
  ctx.provide('agents', { get: id => agents.get(id) })
  ctx.on('session/flush', session => durable.set(session.id, { header: session.header, events: session.snapshotEvents() }))
  ctx.provide('sessionPersistence', { async open(id) {
    const value = durable.get(id)
    if (!value) throw new Error('missing persisted session')
    return { header: value.header, async read(offset = 0, length = 128) { return { events: value.events.slice(offset, offset + length) } }, async close() {} }
  } })
  function agent(id, parentSession) {
    const session = ctx.get('sessions').create(SessionId(id), { meta: { cwd: directory, ...(parentSession ? { parentSession } : {}) } })
    const a = { id, session, ctx, status: 'running' }; agents.set(id, a); return a
  }
  const parent = agent('root')
  t.after(async () => { await ctx.fiber.dispose(); fs.rmSync(directory, { recursive: true, force: true }) })
  const mount = async (api, owner, config = {}, options = {}) => {
    assert.equal(typeof api.acquireEvidenceSupport, 'function', 'shared evidence factory must exist')
    let lease
    const fork = ctx.plugin({ name: 'fixture-' + owner + '-' + Math.random(), apply(c) {
      lease = api.acquireEvidenceSupport(c, { evidenceEnabled: true, ...config }, { owner, ...options })
      c.effect(() => () => lease.release())
    } })
    await fork.await(); await ctx.get('ultraEvidenceSupport')?.ready?.()
    return { lease, fork }
  }
  return { ctx, parent, agent, agents, directory, mount, schemas: () => ctx.get('tools').schemas(parent).map(tool => tool.name) }
}

test('native leases share tools and survive unloading the first plugin, then fully clean up', async t => {
  const f = await fixture(t), a = await f.mount(first, 'memory'), b = await f.mount(second, 'decision')
  assert.equal(a.lease.memory, b.lease.memory)
  assert.equal(f.schemas().filter(name => name === 'ultra_memory_search').length, 1)
  const run = await second.beginMemoryRun(f.parent, 'cross-bundle')
  assert.ok(run); assert.equal(first.memoryFor(f.parent), run); assert.equal(second.memoryFor(f.parent), run)
  await a.fork.dispose()
  assert.ok(f.schemas().includes('ultra_memory_search'))
  assert.equal(second.memoryFor(f.parent), run)
  await b.fork.dispose()
  assert.equal(run.active, false)
  assert.equal(f.ctx.get('ultraEvidenceSupport'), undefined)
  assert.ok(!f.schemas().includes('ultra_memory_search'))
})

test('configuration authority is memory then ultra then decision in either mounting order', async t => {
  const f = await fixture(t), d = await f.mount(first, 'decision', { memoryGetChars: 1000 }), u = await f.mount(second, 'ultra', { memoryGetChars: 2000 }), m = await f.mount(first, 'memory', { memoryGetChars: 3000 })
  assert.equal(d.lease.memory.config.memoryGetChars, 3000)
  await m.fork.dispose(); assert.equal(d.lease.memory.config.memoryGetChars, 2000)
  await u.fork.dispose(); assert.equal(d.lease.memory.config.memoryGetChars, 1000)
  await d.fork.dispose()
})

test('all public memory schemas retain eight recent messages by default and validate the configurable 2..128 range', () => {
  for (const schema of [first.UltraConfig, first.DecisionConfig, first.memoryPlugin.Config]) {
    assert.equal(schema({}).contextRetainRecentMessages, 8)
    assert.equal(schema({ contextRetainRecentMessages: 2 }).contextRetainRecentMessages, 2)
    assert.equal(schema({ contextRetainRecentMessages: 128 }).contextRetainRecentMessages, 128)
    for (const value of [1, 129, 2.5, Number.NaN, Infinity, '2']) assert.throws(() => schema({ contextRetainRecentMessages: value }))
  }
})

test('completed-turn archive is an explicit boolean in every public memory schema and stays disabled by default', () => {
  for (const schema of [first.UltraConfig, first.DecisionConfig, first.memoryPlugin.Config]) {
    assert.equal(schema({}).contextArchiveCompletedTurns, false)
    assert.equal(schema({ contextArchiveCompletedTurns: true }).contextArchiveCompletedTurns, true)
    for (const value of ['true', 1]) assert.throws(() => schema({ contextArchiveCompletedTurns: value }))
    assert.equal(schema({ contextArchiveCompletedTurns: null }).contextArchiveCompletedTurns, false, 'native null/default handling cannot enable the feature')
  }
})

test('native Memory pre-step honors the public recent window while preserving paired tools, rich results, human constraints and raw SHA', async t => {
  const { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } = await sdkImport('dsh-llm')
  for (const retain of [undefined, 2]) {
    const f = await fixture(t)
    f.ctx.provide('tokenMeter', { estimateMessage: message => Math.ceil(JSON.stringify(message).length / 4) })
    const config = { contextCompression: true, contextTargetTokens: 4096, contextOutputReserveTokens: 256, contextToolReserveTokens: 256,
      ...(retain === undefined ? {} : { contextRetainRecentMessages: retain }) }
    const mounted = f.ctx.plugin(first.memoryPlugin, config); await mounted.await()
    const session = f.parent.session, old = 'OLD_NATIVE_TEXT '.repeat(6000) + ' RETAIN_RAW_SHA_TAIL_842', recent = 'LATEST_NATIVE_RESULT_731'
    const human = text => session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const pair = (id, content) => {
      const callId = ToolCallId(id)
      session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{}' }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
      return session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content, isError: false }) }, { surfaceOp: 'append' })
    }
    human('EARLY_ONCE: stay offline, never publish, never repeat completed operations.')
    const oldEvent = pair('old-native-call', [{ type: 'text', text: old }])
    const rich = [{ type: 'text', text: 'Rich original remains.' }, { type: 'image', attachment: { attachmentId: 'native-image-731' } }]
    pair('rich-native-call', rich)
    human('Keep the literal label 协作 and all original permission boundaries.')
    pair('latest-native-call', [{ type: 'text', text: recent }])
    await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
    const run = first.memoryFor(f.parent)
    assert.ok(run)
    assert.equal(run.host.config.contextRetainRecentMessages, retain ?? 8)
    const decision = await f.ctx.waterfall('agent/pre-step', { agent: f.parent, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
    assert.equal(decision.kind, 'enter')
    const projected = session.deriveMessages(), tools = projected.filter(message => message.role === 'tool')
    assert.equal(tools.length, 3)
    assert.equal(projected.filter(message => message.role === 'user').length, 2)
    assert.ok(projected.some(message => message.role === 'user' && message.content[0].text.startsWith('EARLY_ONCE:')))
    assert.ok(projected.some(message => message.role === 'user' && message.content[0].text.includes('literal label 协作')))
    assert.deepEqual(tools.find(message => message.toolCallId === 'rich-native-call').content, rich)
    assert.equal(tools.find(message => message.toolCallId === 'latest-native-call').content[0].text, recent)
    const prunes = session.snapshotEvents().filter(event => event.type === 'compaction/prune')
    assert.equal(prunes.length, retain === 2 ? 1 : 0)
    const oldProjected = tools.find(message => message.toolCallId === 'old-native-call')
    if (retain === 2) {
      assert.match(oldProjected.content[0].text, /^\[Ultra stored tool evidence/u)
      const compression = run.status().compression
      assert.equal(compression.status, 'compacted')
      assert.ok(compression.after.totalTokens < compression.before.totalTokens)
      const found = await run.host.search(f.parent, { query: 'RETAIN_RAW_SHA_TAIL_842', kind: 'tool/result' })
      const original = await run.host.get(f.parent, found.items[0].sourceId, { quote: 'RETAIN_RAW_SHA_TAIL_842', maxChars: 4000 })
      assert.equal(original.citation.sha256, createHash('sha256').update(old).digest('hex'))
      assert.equal(original.text, 'RETAIN_RAW_SHA_TAIL_842')
      assert.equal(session.snapshotEvents()[oldEvent.seq].data.message.content[0].text, old)
    } else assert.equal(oldProjected.content[0].text, old)
    assert.equal(projected.filter(message => message.role === 'assistant').flatMap(message => message.content).filter(block => block.type === 'tool-call').length, 3)
    await mounted.dispose()
  }
})

test('cross-bundle lookup rejects forged callers and incompatible service versions', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory')
  const run = await first.beginMemoryRun(f.parent, 'real')
  assert.ok(run)
  assert.equal(second.memoryFor({ ...f.parent }), undefined)
  await m.fork.dispose()
  const remove = f.ctx.provide('ultraEvidenceSupport', { protocol: 'wrong' })
  assert.throws(() => first.acquireEvidenceSupport(f.ctx, {}, { owner: 'memory' }), /protocol|incompatible/i)
  assert.equal(second.memoryFor(f.parent), undefined)
  await remove()
})

test('provider feature changes register and dispose global tools through native scopes', async t => {
  const f = await fixture(t), d = await f.mount(first, 'decision', { globalKnowledge: { enabled: false } })
  assert.ok(!f.schemas().includes('ultra_knowledge_search'))
  const m = await f.mount(second, 'memory', { globalKnowledge: { enabled: true, projects: [] } })
  assert.ok(f.schemas().includes('ultra_knowledge_search'))
  await m.fork.dispose(); await f.ctx.get('ultraEvidenceSupport').ready()
  assert.ok(!f.schemas().includes('ultra_knowledge_search'))
  assert.ok(f.schemas().includes('ultra_memory_search'))
  await d.fork.dispose()
})

test('memory-only ordinary assembly creates one evidence run with global knowledge disabled', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory', { globalKnowledge: { enabled: false } })
  // Native assembly dispatch executes the real integration bootstrap middleware.
  const assembly = await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  const run = second.memoryFor(f.parent)
  assert.ok(run)
  const decision = await f.ctx.waterfall('agent/pre-step', { agent: f.parent, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(decision.messages.length, 0, 'native runtime context replaces repeated recovery messages')
  assert.match(assembly.contexts.find(context => context.name === 'ultra-task-memory').text, /Ultra 工程记忆/)
  const child = f.agent('child', f.parent.id)
  await f.ctx.serial('agent/created', { agent: child })
  assert.equal(second.memoryFor(child), run)
  await f.ctx.serial('session/event', f.parent.session, { type: 'turn/end' })
  await m.fork.dispose()
  assert.equal(run.active, false)
})

test('shared fallback observes each request once and yields to the active orchestration owner', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory')
  const run = await second.beginMemoryRun(f.parent, 'request-counts')
  async function request() {
    for await (const _ of f.ctx.waterfall('llm/stream', { sessionId: f.parent.id, messages: [] }, async function* () { yield { type: 'fixture' } })) {}
  }
  await request()
  assert.equal(run.status().resources.attemptedCalls, 1)
  const d = await f.mount(second, 'decision')
  await request()
  assert.equal(run.status().resources.attemptedCalls, 1, 'orchestration actor owns request counting now')
  await d.fork.dispose(); await request()
  assert.equal(run.status().resources.attemptedCalls, 2)
  await m.fork.dispose()
})

test('native task context refresh and typed progress query share one scoped state without recapturing the reply', async t => {
  const f = await fixture(t), mounted = await f.mount(first, 'memory')
  const request = { agent: f.parent, signal: new AbortController().signal }
  const prompt = f.ctx.get('systemPrompt')
  const { createUserMessage } = await sdkImport('dsh-llm')
  f.parent.session.append('user/message', createUserMessage({ content: [{type:'text',text:'Implement payment retry; preserve original API'}], source: {kind:'user'} }), {surfaceOp:'append'})
  await prompt.assemble(request)
  const run = first.memoryFor(f.parent)
  assert.ok(run)
  const before = run.store.stats(run.access()).raw.sources
  const assembly = await prompt.assemble(request)
  const contexts = assembly.contexts.filter(context => context.name === 'ultra-task-memory')
  assert.equal(contexts.length, 1)
  assert.match(contexts[0].text, /Implement payment retry/)
  assert.ok(Buffer.byteLength(contexts[0].text) <= 8192)
  const response = await f.ctx.get('tools').execute({ agent: f.parent, name: 'ultra_memory_status', arguments: {depth:'association',maxChars:6000}, callId:'progress-native', signal:new AbortController().signal })
  assert.equal(response.isError, false)
  const page = JSON.parse(response.content[0].text)
  assert.equal(page.freshness, 'recorded-evidence-only')
  assert.match(page.text, /Implement payment retry/)
  assert.equal(JSON.parse(page.text).state.goal, 'Implement payment retry; preserve original API')
  assert.equal(run.store.stats(run.access()).raw.sources, before)
  run.store.updateProjectState(run.access(), {...run.store.projectState(run.access()),next:['Recheck edited retry code']})
  const changed = await prompt.assemble(request)
  assert.match(changed.contexts.find(context => context.name === 'ultra-task-memory').text, /Recheck edited retry code/)
  await mounted.fork.dispose()
  assert.equal(f.schemas().includes('ultra_memory_status'), false)
  assert.equal((await prompt.assemble(request)).contexts.some(context => context.name === 'ultra-task-memory'), false)
})

test('native assistant tool calls can page a stable progress document without invalidating themselves', async t => {
  const f = await fixture(t), mounted = await f.mount(first, 'memory')
  const {createUserMessage,createAssistantMessage,createToolResultMessage,ToolCallId}=await sdkImport('dsh-llm')
  const session=f.parent.session, signal=new AbortController().signal
  session.append('user/message',createUserMessage({content:[{type:'text',text:'Implement payment retry'}],source:{kind:'user'}}),{surfaceOp:'append'})
  await f.ctx.get('systemPrompt').assemble({agent:f.parent,signal})
  let index=0
  const execute=async args=>{
    const id=ToolCallId('status-page-'+index++)
    session.append('assistant/message',{turn:1,step:index,stream:[],message:createAssistantMessage({content:[{type:'tool-call',id,name:'ultra_memory_status',arguments:JSON.stringify(args)}],source:{provider:'offline',model:'fixture'}})},{surfaceOp:'append'})
    session.append('tool/call',{turn:1,step:index,name:'ultra_memory_status',callId:id,arguments:JSON.stringify(args)})
    await f.ctx.get('systemPrompt').assemble({agent:f.parent,signal})
    const result=await f.ctx.get('tools').execute({agent:f.parent,name:'ultra_memory_status',arguments:args,callId:id,signal})
    assert.equal(result.isError,false,JSON.stringify(result))
    session.append('tool/result',{turn:1,step:index,message:createToolResultMessage({callId:id,content:result.content,isError:false})},{surfaceOp:'append'})
    return JSON.parse(result.content[0].text)
  }
  let page=await execute({depth:'association',maxChars:256}), text=page.text, revision=page.revision
  while(page.nextOffset!==undefined){page=await execute({depth:'association',maxChars:256,offset:page.nextOffset,revision});text+=page.text}
  assert.equal(JSON.parse(text).state.goal,'Implement payment retry')
  assert.equal((await execute({sinceRevision:revision})).unchanged,true)
  await mounted.fork.dispose()
})

test('mandatory user instructions over budget retain original native history',async t=>{
  const f=await fixture(t),mounted=await f.mount(first,'memory',{contextCompression:true,taskMemoryMaxBytes:2048})
  const {createUserMessage}=await sdkImport('dsh-llm')
  f.parent.session.append('user/message',createUserMessage({content:[{type:'text',text:'Never remove originals. '.repeat(240)}],source:{kind:'user'}}),{surfaceOp:'append'})
  const request={agent:f.parent,signal:new AbortController().signal}
  await f.ctx.get('systemPrompt').assemble(request)
  const run=first.memoryFor(f.parent), generation=f.parent.session.surface.replaceGeneration, nodes=[...f.parent.session.surface.nodes]
  const result=await run.host.taskStatus(f.parent,{depth:'association',maxChars:12000})
  assert.equal(JSON.parse(result.text).blocked,true)
  await run.host.beforeStep(f.parent)
  assert.equal(f.parent.session.surface.replaceGeneration,generation)
  assert.deepEqual(f.parent.session.surface.nodes,nodes)
  assert.match(run.host.taskContext(f.parent),/暂停新增压缩/)
  await mounted.fork.dispose()
})

test('shared pretruncation capture remains exactly once across bundle leases and unload', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory'), d = await f.mount(second, 'decision')
  const run = await first.beginMemoryRun(f.parent, 'tool-captures')
  f.ctx.get('tools').register(defineContentToolFixture({ name: 'read_fixture', description: 'Offline public output', parameters: {}, async execute() { return [{ type: 'text', text: 'Unique test evidence' }] } }))
  async function execute(callId) { return f.ctx.get('tools').execute({ agent: f.parent, name: 'read_fixture', arguments: {}, callId, signal: new AbortController().signal }) }
  await execute('first-call')
  assert.equal(m.lease.captureStatus().capturedResults, 1)
  assert.equal((await run.host.search(f.parent, { query: 'Unique test evidence' })).items.length, 1)
  await m.fork.dispose(); await execute('second-call')
  assert.equal(d.lease.captureStatus().capturedResults, 2)
  await d.fork.dispose()
})

test('standalone Memory plugin defaults expose evidence without any coordination tools', async t => {
  const f = await fixture(t), fork = f.ctx.plugin(first.memoryPlugin, {})
  await fork.await()
  assert.deepEqual(f.schemas().filter(name => name.startsWith('ultra_')).sort(), ['ultra_memory_get', 'ultra_memory_search', 'ultra_memory_status'])
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  assert.ok(second.memoryFor(f.parent))
  assert.equal(f.ctx.get('ultraEvidenceSupport').memory.config.contextCompression, false)
  await fork.dispose()
  assert.equal(f.ctx.get('ultraEvidenceSupport'), undefined)
})

test('publication uses active provider predicates across bundles and native read-only always denies', async t => {
  const f = await fixture(t)
  f.ctx.provide('profileContext', { dir: f.directory })
  const config = { globalKnowledge: { enabled: true, projects: [{ id: 'project', root: f.directory, read: true, publish: true, shareWith: ['project'] }] } }
  const m = await f.mount(first, 'memory', config, { canPublish: a => a === f.parent })
  const run = await first.beginMemoryRun(f.parent, 'publishing')
  const child = f.agent('decision', f.parent.id); run.bind(child, 'decision')
  const d = await f.mount(second, 'decision', {}, { canPublish: a => a === child })
  const [sourceId] = run.captureTool(child, 'read-source', 'read', { content: [{ type: 'text', text: 'A stable public source quote.' }] })
  const input = { key: 'test', title: 'Title', summary: 'Summary', applicability: 'fixture', sources: [{ sourceId, quote: 'A stable public source quote.' }] }
  const exec = { agent: child, signal: new AbortController().signal }
  const tool = () => f.ctx.get('tools').get('ultra_knowledge_publish')
  const result = await tool().execute(input, exec)
  assert.equal(typeof JSON.parse(result.text).id, 'string')
  const deny = f.ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
  await assert.rejects(tool().execute(input, exec), /publication.*not allowed/i)
  await deny(); await d.fork.dispose()
  await assert.rejects(tool().execute(input, exec), /publication.*not allowed/i)
  await m.fork.dispose()
})

test('retained read tool definitions cannot access evidence after the last lease closes', async t => {
  const f = await fixture(t), m = await f.mount(first, 'memory')
  const run = await first.beginMemoryRun(f.parent, 'stale-tool')
  run.captureTool(f.parent, 'read', 'read', { content: [{ type: 'text', text: 'Secret for the current lease' }] })
  const tool = f.ctx.get('tools').get('ultra_memory_search')
  await m.fork.dispose()
  await assert.rejects(tool.execute({ query: 'Secret' }, { agent: f.parent, signal: new AbortController().signal }), /active|disabled|closed|authorized/i)
})

test('a conflicting global tool rolls back all partially installed evidence hooks', async t => {
  const f = await fixture(t)
  f.ctx.get('tools').register(defineContentToolFixture({ name: 'ultra_knowledge_search', description: 'External owner', parameters: {}, async execute() { return [] } }))
  const beforeEffects = f.ctx.fiber.getEffects().length
  assert.throws(() => first.acquireEvidenceSupport(f.ctx, { globalKnowledge: { enabled: true } }, { owner: 'memory' }), /already registered/i)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.ctx.get('ultraEvidenceSupport'), undefined)
  assert.ok(!f.schemas().includes('ultra_memory_search'))
  assert.equal(f.ctx.fiber.getEffects().length, beforeEffects, 'failed setup returns every native effect to its prior owner')
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  assert.equal(first.memoryFor(f.parent), undefined, 'failed setup must not leave an ordinary-turn bootstrap hook')
})

test('a failed higher-priority feature switch does not poison the retained lease refresh queue', async t => {
  const f = await fixture(t), d = await f.mount(first, 'decision', { globalKnowledge: { enabled: false } })
  const beforeEffects = f.ctx.fiber.getEffects().length
  const removeConflict = f.ctx.get('tools').register(defineContentToolFixture({ name: 'ultra_knowledge_search', description: 'External owner', parameters: {}, async execute() { return [] } }))
  const m = second.acquireEvidenceSupport(f.ctx, { evidenceEnabled: true, globalKnowledge: { enabled: true, projects: [] } }, { owner: 'memory' })
  await assert.rejects(m.ready(), /already registered/i, 'the failed acquisition itself must report failure')
  const release = m.release()
  removeConflict()
  await release
  await d.lease.ready()
  assert.equal(f.ctx.get('ultraEvidenceSupport').status().owner, 'decision')
  assert.equal(f.ctx.get('ultraEvidenceSupport').status().transitioning, false)
  assert.equal(f.ctx.fiber.getEffects().length, beforeEffects, 'failed setup must not retain a lifecycle hook or write guard')
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  const run = await first.beginMemoryRun(f.parent, 'retained-after-failure')
  assert.ok(run)
  run.captureTool(f.parent, 'recovered-read', 'read', { content: [{ type: 'text', text: 'Retained lease recovery evidence' }] })
  const result = await f.ctx.get('tools').get('ultra_memory_search').execute({ query: 'Retained lease recovery evidence' }, { agent: f.parent, signal: new AbortController().signal })
  assert.equal(JSON.parse(result.text).items.length, 1)
  await run.dispose()
  const recovered = await f.mount(second, 'memory', { globalKnowledge: { enabled: false } })
  await f.ctx.get('systemPrompt').assemble({ agent: f.parent, signal: new AbortController().signal })
  const ordinaryRun = first.memoryFor(f.parent)
  assert.ok(ordinaryRun?.active, 'a later Memory lease can bootstrap an ordinary turn again')
  await recovered.fork.dispose()
  assert.equal(ordinaryRun.active, false)
  await d.fork.dispose()
})

test('injected factory contexts without get preserve absent-host and local-host fallback', async t => {
  assert.equal(await first.beginMemoryRun({ ctx: {} }, 'no-host'), undefined)
  const f = await fixture(t), m = await f.mount(first, 'memory')
  f.parent.ctx = { root: f.ctx }
  const run = await first.beginMemoryRun(f.parent, 'local-fallback')
  assert.ok(run, 'legacy local-host lookup still finds the host through the root')
  assert.equal(first.memoryFor(f.parent), run)
  await m.fork.dispose()
})
