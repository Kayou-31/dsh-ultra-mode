/** Real DSH tool/scope SDK checks with a small offline agent lifecycle fixture. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const names = ['cordis', 'dsh-scope', 'dsh-tools', 'dsh-system-prompt', 'dsh-agent', 'dsh-llm', 'dsh-session']
let sdk, unavailable
try {
  sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(
    process.env.DSH_ULTRA_TEST_SDK
      ? pathToFileURL(resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai', name, 'lib', 'index.js')).href
      : `@deepseek-ai/${name}`,
  )])))
} catch (error) {
  if (process.env.DSH_ULTRA_TEST_SDK || error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  unavailable = 'Actual DSH SDK peers are unavailable; set DSH_ULTRA_TEST_SDK to an installed SDK node_modules directory.'
}
const compiled = ts.transpileModule(readFileSync(new URL('../src/runtime.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText

async function fixture(presentation = 'native') {
  const { Context } = sdk.cordis
  const { createScope, scopeOf, scopeParentOf, bindScopeParent } = sdk['dsh-scope']
  const ctx = new Context()
  await ctx.plugin(sdk['dsh-session'].SessionStore).await()
  await ctx.plugin(sdk['dsh-system-prompt'].SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }).await()
  await ctx.plugin(sdk['dsh-tools'].ToolRuntime, { mode: 'native' }).await()
  const runtime = {}
  vm.runInNewContext(compiled, {
    exports: runtime,
    require: name => sdk[name.replace('@deepseek-ai/', '')],
    Map, Set, Error, String, Promise,
  })
  const agents = new Map(), identities = [], questions = []
  let callNumber = 0, mutations = 0, turn, failCreation = false
  const tool = (name, execute = async () => [{ type: 'text', text: name }], parameters = {}) => sdk['dsh-tools'].defineContentToolFixture({
    name, description: `Offline ${name}`, parameters, execute,
  })
  for (const name of ['global_read', 'pwsh', 'workflow', 'ultra_task']) ctx.get('tools').register(tool(name))
  ctx.get('tools').register(tool('ask_user_question', async (args, exec) => {
    questions.push({ args, agent: exec.agent })
    return [{ type: 'text', text: 'Fixture answer' }]
  }, { timeout: { type: 'number' } }))
  const presetKey = {}
  const preset = createScope(ctx, presetKey)
  for (const name of ['read', 'subagent', 'preset_write']) preset.ctx.get('tools').register(tool(name))
  if (presentation !== 'native') preset.ctx.get('tools').presentAs(presentation)
  ctx.provide('agentPresets', {
    composeFrom(childCtx, parentCtx) {
      const inherited = scopeParentOf(scopeOf(parentCtx))
      if (inherited !== undefined) bindScopeParent(scopeOf(childCtx), inherited)
    },
  })
  function agent(id, header = {}) {
    const value = {
      id, options: { provider: 'offline', model: 'fixture' },
      session: ctx.get('sessions').create(sdk['dsh-session'].SessionId(id), { meta: header }),
      status: 'idle',
      inbox: { nextStep: [] },
      steer(message) { value.inbox.nextStep.push(message) },
      cancel(reason) { value.cancelled = reason; value.inbox.nextStep.length = 0 },
      followup(message) {
        value.followupMessage = message
        value.status = 'running'
        value.pending = Promise.resolve().then(async () => {
          await turn?.(value)
          value.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: sdk['dsh-llm'].createAssistantMessage({ content: [{ type: 'text', text: 'Fixture report' }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
          value.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        })
      },
      async whenIdle() { await value.pending; value.status = 'idle' },
    }
    agents.set(id, value)
    return value
  }
  ctx.provide('agents', {
    get: id => agents.get(id),
    async create(options) {
      const child = agent(options.sessionId, options.meta)
      const scope = createScope(ctx, child)
      child.ctx = scope.ctx
      await options.setup(scope.ctx, child)
      if (failCreation) {
        await scope.dispose()
        throw new Error('Fixture creation failed after setup')
      }
      await ctx.serial('agent/created', { agent: child })
      return { agent: child, async dispose() { await scope.dispose(); agents.delete(child.id) } }
    },
  })
  ctx.get('tools').guard(exec => runtime.researchToolDenial(exec.agent, exec.name))
  const parent = agent('visible-root')
  const parentScope = createScope(ctx, parent, { parent: presetKey })
  parent.ctx = parentScope.ctx
  async function childOf(route, id, ownName = 'own_mutation', origin = 'subagent') {
    const child = agent(id, { parentSession: route.id, ...(origin == null ? {} : { origin }), delegationDepth: 1 })
    // Native child composition joins the preset rather than the parent's own layer.
    const scope = createScope(ctx, child, { parent: presetKey })
    child.ctx = scope.ctx
    if (ownName) child.ctx.get('tools').register(tool(ownName, async () => { mutations++; return [{ type: 'text', text: 'mutated' }] }))
    await ctx.serial('agent/created', { agent: child })
    identities.push(child)
    return child
  }
  return {
    ctx, runtime, parent, agents, identities, questions,
    get mutations() { return mutations },
    setTurn(fn) { turn = fn },
    failCreation() { failCreation = true },
    childOf,
    schemas: agent => ctx.get('tools').schemas(agent).map(schema => schema.name).sort(),
    async execute(agent, name) {
      return ctx.get('tools').execute({ agent, name, arguments: {}, signal: new AbortController().signal, callId: sdk['dsh-llm'].ToolCallId(`fixture-${++callNumber}`) })
    },
    async create(id = 'ultra-route-fixture', signal = new AbortController().signal, researchTools = ['read', 'global_read', 'subagent', 'ask_user_question', 'own_mutation', 'missing-tool', 'run_code']) {
      const route = await runtime.createRoute(parent, { id, label: 'Fixture research', signal, readOnly: true, researchTools }, { toolName: 'ultra_task' })
      return { route, agent: agents.get(id) }
    },
    close: () => ctx.fiber.dispose(),
  }
}

test('actual SDK masks inherited research tools, preserves own tools, and restores decision access', { skip: unavailable }, async () => {
  for (const presentation of ['native', 'ptc', 'both']) {
    const f = await fixture(presentation)
    try {
      const original = f.schemas(f.parent)
      const { route, agent } = await f.create()
      const child = await f.childOf(agent, 'native-child')
      for (const research of [agent, child]) {
        assert.ok(f.schemas(research).includes('read'), 'preset research tool retained')
        assert.ok(f.schemas(research).includes('global_read'), 'global research tool retained')
        assert.ok(f.schemas(research).includes('subagent'), 'native child capability retained')
        for (const hidden of ['pwsh', 'workflow', 'preset_write', 'run_code', 'ultra_task']) assert.equal(f.schemas(research).includes(hidden), false, hidden)
      }
      assert.ok(f.schemas(child).includes('own_mutation'), 'own scoped registration is not passed as an unknown inherited name')
      const deniedChild = await f.childOf(agent, 'denied-child', 'unapproved_own_tool')
      assert.equal((await f.execute(deniedChild, 'unapproved_own_tool')).isError, true)
      assert.equal(f.mutations, 0, 'guard rejects unapproved own tool even though SDK preserves its schema')
      assert.match(f.runtime.researchToolDenial(child, 'run_code'), /cannot execute/)
      await agent.ctx.get('tools').get('ask_user_question', agent).execute({ timeout: 8 }, { agent })
      assert.equal(f.questions[0].agent, f.parent)
      assert.equal(f.questions[0].args.timeout, -1)
      route.setReadOnly(false)
      for (const restored of [agent, child]) {
        for (const allowed of ['pwsh', 'workflow', 'preset_write']) assert.ok(f.schemas(restored).includes(allowed), allowed)
        assert.equal(f.schemas(restored).includes('run_code'), presentation !== 'native')
        assert.equal(f.runtime.researchToolDenial(restored, 'pwsh'), undefined)
        assert.equal(f.schemas(restored).includes('ultra_task'), false, 'recursive Ultra restriction remains')
      }
      assert.deepEqual(f.schemas(f.parent), original, 'visible root never acquires route filters')
      route.setReadOnly(true)
      assert.equal(f.schemas(child).includes('pwsh'), false, 're-entering research reapplies filtering')
      await route.dispose()
      for (const restored of [agent, child]) assert.ok(f.schemas(restored).includes('pwsh'), 'exact restriction disposers release retained scope views')
    } finally { await f.close() }
  }
})

test('actual SDK bridge survives a research allowlist without questions and cancellation releases filters', { skip: unavailable }, async () => {
  const f = await fixture('both')
  try {
    const controller = new AbortController()
    const { route, agent } = await f.create('ultra-route-cancel', controller.signal, ['read'])
    assert.equal(f.schemas(agent).includes('ask_user_question'), false, 'unapproved research question schema is hidden')
    assert.match(f.runtime.researchToolDenial(agent, 'ask_user_question'), /cannot execute/)
    route.setReadOnly(false)
    await agent.ctx.get('tools').get('ask_user_question', agent).execute({ timeout: 3 }, { agent })
    assert.equal(f.questions[0].agent, f.parent, 'question bridge was captured before the inherited tool was hidden')
    route.setReadOnly(true)
    controller.abort()
    assert.deepEqual(JSON.parse(JSON.stringify(agent.cancelled)), { kind: 'parent' })
    await route.dispose()
    assert.ok(f.schemas(agent).includes('pwsh'))
    assert.ok(f.schemas(agent).includes('run_code'))
    assert.equal(f.runtime.isUltraRoute(agent.id), false)
  } finally { await f.close() }
})

test('host-observed child identities are scoped to a turn, copied, and never labelled completed', { skip: unavailable }, async () => {
  const f = await fixture()
  try {
    const { route, agent } = await f.create()
    f.setTurn(async current => {
      await f.childOf(current, 'observed-native-child', null)
      await f.childOf(current, 'other-internal-loop', null, null)
    })
    const first = await route.run([{ type: 'text', text: 'Research' }])
    assert.equal(first.ok, true)
    assert.deepEqual(JSON.parse(JSON.stringify(first.subagents)), [{ sessionId: 'observed-native-child', parentSession: agent.id, origin: 'subagent', delegationDepth: 1 }])
    assert.equal('completed' in first.subagents[0], false)
    first.subagents[0].sessionId = 'consumer-change'
    f.setTurn(undefined)
    const second = await route.run([{ type: 'text', text: 'Final review' }])
    assert.equal(second.subagents, undefined, 'old child creations are not replayed as current-turn evidence')
    await route.dispose()
    f.failCreation()
    await assert.rejects(f.create('ultra-route-failed'), /creation failed/)
    assert.equal(f.runtime.isUltraRoute('ultra-route-failed'), false)
    assert.ok(f.schemas(f.agents.get('ultra-route-failed')).includes('pwsh'), 'failed creation releases applied policy layers')
  } finally { await f.close() }
})

test('real SDK tool progress routes child evidence to its worker and steering respects live turn boundaries', { skip: unavailable }, async () => {
  const f = await fixture()
  try {
    const { route, agent } = await f.create('ultra-route-progress')
    const progress = []
    const stop = route.subscribeProgress(value => progress.push(value))
    const original = [{ type: 'text', text: 'Research' }, { type: 'image', data: 'offline-fixture-image' }]
    assert.equal(route.steer('too early'), false)
    f.setTurn(async current => {
      assert.equal(route.steer('Check the alternate evidence'), true)
      assert.equal(current.inbox.nextStep.length, 1, 'the public agent method receives a native next-step message')
      assert.match(current.inbox.nextStep[0].content[0].text, /Ultra 决策研究改向：不扩权、原任务优先/)
      assert.match(current.inbox.nextStep[0].content[0].text, /Check the alternate evidence/)
      assert.deepEqual(current.followupMessage.content, original, 'steering preserves the original image/context prompt')
      const child = await f.childOf(current, 'progress-native-child', null)
      await f.execute(child, 'read')
      child.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: sdk['dsh-llm'].createAssistantMessage({ content: [
        { type: 'reasoning', text: 'PRIVATE_THINKING_MARKER' },
        { type: 'text', text: 'CHILD_EVIDENCE ' + 'x'.repeat(3000) },
      ], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
      const unrelated = await f.childOf(f.parent, 'unrelated-native-child', null)
      unrelated.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: sdk['dsh-llm'].createAssistantMessage({ content: [{ type: 'text', text: 'UNRELATED_MARKER' }], source: { provider: 'offline', model: 'fixture' } }) }, { surfaceOp: 'append' })
      assert.equal(route.steer('Unused late feedback'), true)
      current.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      assert.equal(route.steer('after completion'), false, 'turn/end closes steering before the driver reaches idle')
    })
    const result = await route.run(original)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(progress.some(value => value.kind === 'tool' && value.text.includes('read')))
    assert.ok(progress.some(value => value.kind === 'assistant' && value.text.includes('CHILD_EVIDENCE')))
    assert.ok(progress.some(value => value.text.includes('原生子代理 progress-native-child 的已提交进展')))
    assert.ok(progress.every(value => value.sessionId === agent.id && value.text.length <= 2000))
    assert.deepEqual(progress.map(value => value.sequence), progress.map((_, i) => i + 1))
    assert.ok(progress.every(value => !value.text.includes('PRIVATE_THINKING_MARKER') && !value.text.includes('UNRELATED_MARKER')))
    assert.equal(route.steer('idle feedback'), false)
    stop()
    const count = progress.length
    f.setTurn(undefined)
    await route.run([{ type: 'text', text: 'A fresh turn' }])
    assert.equal(progress.length, count, 'unsubscription releases progress delivery')
    await route.dispose()
    assert.equal(route.steer('disposed feedback'), false)
  } finally { await f.close() }
})
