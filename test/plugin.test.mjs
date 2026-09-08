/**
 * Host-half integration tests (`npm test`).
 *
 * These drive the compiled `lib/index.js` through a minimal fake Cordis
 * context: no real Host, no LLM, no network. They cover the behaviours the
 * v0.1.0 review flagged — switch-to-prompt wiring, unified run cleanup,
 * partial-failure policy, overlapping-run accounting, and RPC session keys.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../lib/index.js'

const CONFIG = {
  provider: 'fake',
  toolName: 'ultra_task',
  concurrency: 3,
  sectionOrder: 117.5,
  maxSessions: 64,
}

/** Minimal fake context recording every registration. */
function makeCtx({ subagents } = {}) {
  const record = {
    tools: [],
    commands: [],
    sections: [],
    rpcHandlers: new Map(),
    effects: [],
  }
  const ctx = {
    tools: { register: (definition) => { record.tools.push(definition); return () => {} } },
    subagents: subagents ?? { list: () => ['fake'], start: async () => { throw new Error('no script') } },
    get(name) {
      if (name === 'commands') {
        return { register: (definition) => { record.commands.push(definition); return () => {} } }
      }
      if (name === 'systemPrompt') {
        return { section: (section) => { record.sections.push(section); return () => {} } }
      }
      if (name === 'connection') {
        return {
          rpc: {
            handle: (channel, handler) => { record.rpcHandlers.set(channel, handler); return () => {} },
          },
        }
      }
      return undefined
    },
    effect: (fn) => {
      const disposer = fn()
      record.effects.push(disposer)
      return typeof disposer === 'function' ? disposer : () => {}
    },
  }
  return { ctx, record }
}

/** Scriptable fake subagent provider. */
function makeSubagents(steps) {
  const calls = []
  const disposed = []
  const queue = [...steps]
  return {
    calls,
    disposed,
    list: () => ['fake'],
    async start(_provider, request) {
      calls.push(request.label)
      const step = queue.shift() ?? { text: request.label === 'ultra-merge' ? 'MERGED' : 'worker' }
      if (step.throwAtStart === true) throw new Error('start failed')
      return {
        id: request.label,
        result: Promise.resolve({
          stopReason: step.stopReason ?? 'completed',
          output: step.output === undefined ? [{ type: 'text', text: step.text ?? 'worker' }] : step.output,
        }),
        async dispose() {
          disposed.push(request.label)
        },
      }
    },
  }
}

function boot(options) {
  const { ctx, record } = makeCtx(options)
  apply(ctx, { ...CONFIG })
  const tool = record.tools[0]
  const section = record.sections[0]
  const rpc = record.rpcHandlers.get('/dsh-ultra-mode')
  return { ctx, record, tool, section, rpc }
}

const agent = { id: 'session-a' }

test('registers tool, command, prompt section and RPC channel', () => {
  const { record, tool, section, rpc } = boot({ subagents: makeSubagents([]) })
  assert.equal(tool.name, 'ultra_task')
  assert.equal(record.commands[0].name, 'ultra')
  assert.equal(section.name, 'ultra-mode')
  assert.equal(typeof section.text, 'function')
  assert.equal(typeof rpc, 'function')
})

test('prompt section reflects the live per-session switch', () => {
  const { section, rpc } = boot({ subagents: makeSubagents([]) })
  assert.equal(section.text({ agent }), '', 'unknown session contributes no text')
  rpc('set', { sessionId: 'session-a', enabled: true, concurrency: 4 })
  const on = section.text({ agent })
  assert.match(on, /ULTRA 当前状态：已开启/)
  assert.match(on, /并发数：4/)
  assert.match(on, /本轮必须先调用 ultra_task/)
  assert.equal(section.text({ agent: { id: 'session-b' } }), '', 'other sessions stay unaffected')
  rpc('set', { sessionId: 'session-a', enabled: false })
  assert.match(section.text({ agent }), /开关为关闭/)
})

test('RPC rejects a missing sessionId instead of sharing a bucket', () => {
  const { rpc } = boot({ subagents: makeSubagents([]) })
  const missing = rpc('get', {})
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'missing-session-id')
  const blank = rpc('set', { sessionId: '   ', enabled: true })
  assert.equal(blank.ok, false)
})

test('RPC clamps concurrency and keeps sessions isolated', () => {
  const { rpc } = boot({ subagents: makeSubagents([]) })
  rpc('set', { sessionId: 'a', enabled: true, concurrency: 99 })
  assert.equal(rpc('get', { sessionId: 'a' }).value.concurrency, 5)
  assert.equal(rpc('get', { sessionId: 'b' }).value.enabled, false)
})

test('execute runs N workers plus one merger and disposes every run', async () => {
  const subagents = makeSubagents([
    { text: 'alpha' },
    { text: 'beta' },
    { text: 'MERGED' },
  ])
  const { tool, rpc } = boot({ subagents })
  rpc('set', { sessionId: 'session-a', enabled: true, concurrency: 2 })
  const result = await tool.execute({ task: 'do it' }, { agent })
  assert.deepEqual(subagents.calls, ['ultra-1/2', 'ultra-2/2', 'ultra-merge'])
  assert.deepEqual(subagents.disposed.sort(), ['ultra-1/2', 'ultra-2/2', 'ultra-merge'])
  assert.equal(result.output[0].text, 'MERGED')
  assert.equal(rpc('get', { sessionId: 'session-a' }).value.running, false)
})

test('a worker that starts and then fails is still disposed (no leaked agent)', async () => {
  const subagents = makeSubagents([{ text: 'alpha' }, { throwAtStart: true }])
  const { tool, rpc } = boot({ subagents })
  rpc('set', { sessionId: 'session-a', enabled: true, concurrency: 3 })
  await assert.rejects(() => tool.execute({ task: 'do it' }, { agent }), /start failed/)
  assert.deepEqual(subagents.disposed, ['ultra-1/3'], 'already-started run must be released')
  assert.equal(rpc('get', { sessionId: 'session-a' }).value.running, false)
})

test('fewer than two usable workers refuses to merge (no silent degradation)', async () => {
  const subagents = makeSubagents([
    { text: 'only one' },
    { stopReason: 'error' },
    { stopReason: 'error' },
  ])
  const { tool, rpc } = boot({ subagents })
  rpc('set', { sessionId: 'session-a', enabled: true, concurrency: 3 })
  await assert.rejects(() => tool.execute({ task: 'do it' }, { agent }), /可靠性不足/)
  assert.equal(subagents.calls.includes('ultra-merge'), false, 'merger must not run')
  assert.equal(subagents.disposed.length, 3)
})

test('empty completed output does not count as a usable sample', async () => {
  const subagents = makeSubagents([
    { text: 'alpha' },
    { output: [{ type: 'text', text: '   ' }] },
    { stopReason: 'error' },
  ])
  const { tool, rpc } = boot({ subagents })
  rpc('set', { sessionId: 'session-a', enabled: true, concurrency: 3 })
  await assert.rejects(() => tool.execute({ task: 'do it' }, { agent }), /只获得 1\/3 路/)
})

test('partial success degrades but reports it to the user and the merger', async () => {
  const subagents = makeSubagents([
    { text: 'alpha' },
    { text: 'beta' },
    { stopReason: 'error' },
    { text: 'MERGED' },
  ])
  const { tool, rpc } = boot({ subagents })
  rpc('set', { sessionId: 'session-a', enabled: true, concurrency: 3 })
  const result = await tool.execute({ task: 'do it' }, { agent })
  assert.match(result.output[0].text, /启动 3 路，成功 2 路，失败 1 路/)
  assert.match(result.output[0].text, /MERGED/)
})

test('merger failure falls back to joining worker outputs', async () => {
  const subagents = makeSubagents([
    { text: 'alpha' },
    { text: 'beta' },
    { stopReason: 'error' },
  ])
  const { tool, rpc } = boot({ subagents })
  rpc('set', { sessionId: 'session-a', enabled: true, concurrency: 2 })
  const result = await tool.execute({ task: 'do it' }, { agent })
  assert.match(result.output[0].text, /分支 1/)
  assert.match(result.output[0].text, /alpha/)
  assert.match(result.output[0].text, /分支 2/)
  assert.equal(subagents.disposed.includes('ultra-merge'), true)
})

test('overlapping runs keep activeRuns > 0 until both settle', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const subagents = {
    list: () => ['fake'],
    calls: [],
    async start(_provider, request) {
      this.calls.push(request.label)
      await gate
      return {
        id: request.label,
        result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'x' }] }),
        dispose: async () => {},
      }
    },
  }
  const { tool, rpc } = boot({ subagents })
  rpc('set', { sessionId: 'session-a', enabled: true, concurrency: 2 })
  const first = tool.execute({ task: 'one' }, { agent })
  const second = tool.execute({ task: 'two' }, { agent })
  await new Promise((resolve) => setTimeout(resolve, 10))
  const mid = rpc('get', { sessionId: 'session-a' }).value
  assert.equal(mid.running, true)
  assert.equal(mid.activeRuns, 2)
  release()
  await Promise.allSettled([first, second])
  const after = rpc('get', { sessionId: 'session-a' }).value
  assert.equal(after.running, false)
  assert.equal(after.activeRuns, 0)
  assert.notEqual(after.lastRun, null)
})

test('/ultra refuses to mutate without a session identity', () => {
  const { record } = boot({ subagents: makeSubagents([]) })
  const command = record.commands[0]
  const refused = command.handler({ rawInput: 'on' })
  assert.equal(refused.kind, 'error')
  const accepted = command.handler({ rawInput: 'on', agent: { id: 'session-a' } })
  assert.equal(accepted.kind, 'success')
})

test('/ultra set and RPC read the same state', () => {
  const { record, rpc } = boot({ subagents: makeSubagents([]) })
  record.commands[0].handler({ rawInput: '4', agent: { id: 'session-a' } })
  const value = rpc('get', { sessionId: 'session-a' }).value
  assert.deepEqual({ enabled: value.enabled, concurrency: value.concurrency }, { enabled: true, concurrency: 4 })
})
