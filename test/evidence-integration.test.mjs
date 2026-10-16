/** Owned-loop integration without a provider or persistent-store implementation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import * as ultra from '../lib/ultra.js'
import * as coordination from '../lib/coordination.js'
import * as jev from '../lib/jev.js'

function sourceModule(file) {
  const exported = {}
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  }).outputText
  const imported = {
    'node:crypto': { randomUUID }, './ultra.js': ultra, './coordination.js': coordination, './jev.js': jev,
    '@deepseek-ai/dsh-llm': { createUserMessage: value => ({ id: randomUUID(), ...value }) },
    './memory-host.js': { beginMemoryRun: async parent => parent.memoryRun },
  }
  vm.runInNewContext(compiled, { exports: exported, require: name => {
    assert.ok(imported[name], `Unexpected ${file} import ${name}`)
    return imported[name]
  }, AbortSignal, AbortController, setTimeout, clearTimeout })
  return exported
}

function memoryFixture() {
  const record = { events: [], reports: [], phases: [], deliveries: [], disposed: 0, prepared: 0 }
  const ids = new Map()
  const remember = (sessionId, prefix) => {
    const id = `${prefix}-${record.events.length}-${record.reports.length}`
    ids.set(sessionId, [...(ids.get(sessionId) ?? []), id]); return [id]
  }
  const run = {
    bind() {},
    async prepareSeed() { record.prepared++; return [] },
    entry: () => 'MEMORY_ENTRY_UNTRUSTED_EVIDENCE',
    reportInstructions: () => 'FREEFORM_REPORT_METADATA_ONLY',
    refs: sessionId => ids.get(sessionId) ?? [],
    captureEvent(session, event) { record.events.push({ session, event }); return remember(session.id, 'event-ref') },
    captureTool() { return [] },
    recordReport(sessionId, text, status) { record.reports.push({ sessionId, text, status }); return remember(sessionId, 'report-ref') },
    recordDelivery: (...args) => record.deliveries.push(args),
    stage: value => record.phases.push(value),
    async dispose() { record.disposed++ }, status: () => ({}),
  }
  return { run, record }
}
const config = { toolName: 'ultra_task', timeoutMs: 5000, reportChars: 1000, researchTools: ['read'], jevEnabled: false, coordinationMaxRounds: 0 }

test('Ultra stores injected-factory reports before excerpts and drains memory without extra model calls', async () => {
  const { runUltra } = sourceModule('orchestrator')
  const memory = memoryFixture()
  const parent = { memoryRun: memory.run, session: { snapshotEvents: () => [] } }
  const calls = [], created = [], disposed = []
  const result = await runUltra(config, { parent, task: 'Original authorized task', content: [], concurrency: 2, signal: new AbortController().signal, phase() {} }, async (_parent, options) => {
    created.push(options)
    let count = 0
    return { id: options.id, setReadOnly() {}, async run(prompt, runOptions) {
      calls.push({ id: options.id, text: prompt[0].text, runOptions })
      const text = options.label === 'Ultra decision' ? (++count === 1 ? '{"assignments":["First","Second"]}' : 'Delivered') : 'X'.repeat(2000) + 'FULL_REPORT_TAIL'
      return { ok: true, sessionId: options.id, text }
    }, async dispose() { disposed.push(options.id) } }
  })
  assert.equal(calls.length, 4, 'planning, two workers, final only')
  assert.equal(created.length, 3)
  assert.ok(created.every(value => value.memory === memory.run))
  assert.ok(created.every(value => value.seed.length === 0))
  assert.equal(memory.record.prepared, 1)
  assert.ok(memory.record.reports.some(value => value.text.endsWith('FULL_REPORT_TAIL')))
  assert.ok(calls.every(value => value.text.includes('MEMORY_ENTRY_UNTRUSTED_EVIDENCE')))
  assert.equal(calls[0].text.includes('FREEFORM_REPORT_METADATA_ONLY'), false, 'strict planner JSON has no conflicting fenced-block protocol')
  assert.ok(calls.slice(1,-1).every(value => !value.text.includes('FREEFORM_REPORT_METADATA_ONLY') && value.text.includes('ultra_submit_report') && value.runOptions.reportSubmission === true), 'worker native submission replaces optional large fenced metadata')
  assert.ok(calls.at(-1).text.includes('FREEFORM_REPORT_METADATA_ONLY'), 'final decision still supports existing semantic metadata ingestion')
  assert.ok(calls.at(-1).text.includes('report-ref'))
  assert.equal(calls.at(-1).text.includes('FULL_REPORT_TAIL'), false)
  assert.equal(memory.record.disposed, 1)
  assert.equal(disposed.length, 3)
  assert.equal(result.decided, true)
})

test('Ultra drains enabled memory after planning fails before workers exist', async () => {
  const { runUltra } = sourceModule('orchestrator')
  const memory = memoryFixture()
  await assert.rejects(runUltra(config, { parent: { memoryRun: memory.run, session: { snapshotEvents: () => [] } }, task: 'Task', content: [], concurrency: 2, signal: new AbortController().signal, phase() {} }, async () => ({ id: 'decision', async run() { return { ok: false, sessionId: 'decision', text: '', error: 'failure' } }, async dispose() {} })), /无法完成规划/)
  assert.equal(memory.record.disposed, 1)
})

test('assist captures full parent and native-child events before the ring evicts previews', async () => {
  const { startDecisionAssist } = sourceModule('assist')
  const memory = memoryFixture()
  const listeners = new Map(), calls = [], created = []
  const on = (name, listener) => { const set = listeners.get(name) ?? new Set(); set.add(listener); listeners.set(name, set); return () => set.delete(listener) }
  const emit = (name, ...args) => { for (const listener of [...(listeners.get(name) ?? [])]) listener(...args) }
  const parent = { id: 'main', memoryRun: memory.run, status: 'running', session: { id: 'main', header: {}, snapshotEvents: () => [{ type: 'turn/start', data: { turn: 7 } }] }, ctx: { root: { on } }, inbox: { remove() {} }, steer() {} }
  let release
  const held = new Promise(resolve => { release = resolve })
  const handle = await startDecisionAssist({ ...config, coordinationMaxRounds: 2, coordinationIntervalMs: 100 }, { parent, task: 'Task', content: [], signal: new AbortController().signal, phase() {} }, async (_parent, options) => {
    created.push(options)
    return { id: options.id, async run(prompt) { calls.push(prompt[0].text); if (calls.length === 1) await held; return { ok: true, sessionId: options.id, text: JSON.stringify({ assessment: 'review', directives: calls.length === 2 ? [{ routeId: parent.id, instruction: 'Verify the actual evidence' }] : [] }) } }, async dispose() {} }
  })
  const child = { id: 'native', session: { id: 'native', header: { origin: 'subagent', parentSession: parent.id } } }
  emit('agent/created', { agent: child })
  for (let i = 0; i < 10; i++) emit('session/event', i === 0 ? child.session : parent.session, { type: 'tool/result', data: { turn: 7, message: { content: [{ type: 'text', text: 'X'.repeat(2500) + `TAIL_${i}` }] } } })
  release()
  for (let i = 0; calls.length < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(calls.length, 2)
  assert.equal(created[0].memory, memory.run)
  assert.ok(calls.every(text => text.includes('MEMORY_ENTRY_UNTRUSTED_EVIDENCE')))
  assert.ok(calls[1].includes('event-ref'))
  assert.ok(memory.record.events.some(value => value.event.data.message.content[0].text.endsWith('TAIL_0')))
  assert.equal(calls[1].includes('TAIL_0'), false)
  assert.equal(memory.record.prepared, 1)
  assert.equal(memory.record.deliveries.length, 1)
  assert.equal(memory.record.deliveries[0][1], parent.id)
  assert.equal(memory.record.deliveries[0][2], 'queued')
  emit('session/event', parent.session, { type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } })
  await handle.done
  assert.equal(memory.record.disposed, 1)
})

test('repeated coordination failures stop extra reviews while workers still finalize', async () => {
  const { runUltra } = sourceModule('orchestrator')
  const listeners = [], calls = [], finishers = []
  const pending = runUltra({ ...config, coordinationMaxRounds: -1, coordinationFailureLimit: 2, coordinationIntervalMs: 100 }, {
    parent: { session: { snapshotEvents: () => [] } }, task: 'Task', content: [], concurrency: 2, signal: new AbortController().signal, phase() {},
  }, async (_parent, options) => {
    let turn = 0
    return { id: options.id, setReadOnly() {}, subscribeProgress(fn) { listeners.push({ id: options.id, fn }); return () => {} }, async run(prompt) {
      if (options.label === 'Ultra decision') {
        if (++turn === 1) return { ok: true, sessionId: options.id, text: '{"assignments":["First","Second"]}' }
        const intermediate = prompt[0].text.includes('当前是运行中的第')
        calls.push(intermediate)
        return { ok: !intermediate, sessionId: options.id, text: intermediate ? '' : 'Delivered', error: intermediate ? 'provider failed' : undefined }
      }
      await new Promise(resolve => finishers.push(resolve))
      return { ok: true, sessionId: options.id, text: 'Worker evidence' }
    }, async dispose() {} }
  })
  for (let i = 0; listeners.length < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5))
  for (let seq = 1; seq <= 3; seq++) {
    listeners[0].fn({ sessionId: listeners[0].id, sequence: seq, kind: 'tool', text: 'Fresh evidence', at: Date.now() })
    await new Promise(resolve => setTimeout(resolve, 125))
  }
  assert.equal(calls.length, 2, 'failure limit suppresses a third coordination request')
  finishers.forEach(resolve => resolve())
  const result = await pending
  assert.equal(result.decided, true)
  assert.equal(calls.filter(value => !value).length, 1)
  assert.match(result.coordination.errors.at(-1), /连续.*2/)
})
