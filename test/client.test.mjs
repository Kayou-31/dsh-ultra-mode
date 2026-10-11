/** Keyless client lifecycle checks through the actual plugin registration and component. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText

const state = (overrides = {}) => ({ enabled: false, concurrency: 3, running: false, activeRuns: 0, lastRun: null, ...overrides })
const response = (overrides = {}) => ({ ok: true, value: state(overrides) })
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** Small hook runner: tests own effect scheduling rather than depending on a browser fixture. */
function harness(handler = async () => response(), { sessionList } = {}) {
  const slots = []
  const effects = []
  const timers = new Map()
  const calls = []
  const styles = []
  let dictionaries
  let cursor = 0
  let hooks = []
  let scheduled = []
  let dirty = false
  let tree
  let component
  let props
  let disposed = false
  const react = {
    createElement(type, elementProps, ...children) { return { type, props: elementProps ?? {}, children: children.flat() } },
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], value => {
        if (disposed) throw new Error('state write after unmount')
        hooks[index] = typeof value === 'function' ? value(hooks[index]) : value
        dirty = true
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useId() { cursor++; return 'ultra-menu-test' },
    useEffect(effect, dependencies) {
      const index = cursor++
      const previous = hooks[index]
      if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return
      scheduled.push(() => {
        previous?.cleanup?.()
        hooks[index] = { dependencies, cleanup: effect() }
      })
    },
  }
  const document = {
    activeElement: null,
    createElement: () => ({ dataset: {}, textContent: '', remove() { styles.splice(styles.indexOf(this), 1) } }),
    head: { appendChild: style => { styles.push(style) } },
    addEventListener() {},
    removeEventListener() {},
  }
  const rpc = { async call(channel, endpoint, payload) { calls.push({ channel, endpoint, payload }); return handler(endpoint, payload) } }
  const list = sessionList ?? { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => {} }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: name => {
      assert.equal(name, 'react')
      return react
    },
    window: { setInterval(fn) { const id = timers.size + 1; timers.set(id, fn); return id }, clearInterval: id => timers.delete(id) },
    document, Node: class Node {}, Error,
  }, { filename: 'client/index.ts' })
  module.exports.apply({
    sessions: { list },
    effect(callback) { const cleanup = callback(); effects.push(cleanup); return cleanup },
    locale: { register(_namespace, values) { dictionaries = values; return () => {} } },
    get: name => name === 'connection' ? { rpc } : undefined,
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.input.right'); return callback() },
      register(options, renderer) { slots.push({ options, renderer }); return () => {} },
    },
  })
  const t = (key, params = {}) => dictionaries.zh[key]?.replace(/\{(\w+)\}/g, (_match, name) => String(params[name])) ?? key
  const flush = () => {
    for (let iteration = 0; iteration < 20; iteration++) {
      if (!dirty) return
      dirty = false
      cursor = 0
      tree = component(props)
      const next = scheduled
      scheduled = []
      next.forEach(effect => effect())
    }
    throw new Error('component did not settle')
  }
  const render = sessionId => {
    const entry = slots[0]
    const injected = sessionId === undefined ? {} : entry.options.inject(sessionId)
    const element = entry.renderer({ ...injected, t })
    component = element.type
    props = element.props
    dirty = true
    flush()
  }
  const settle = async () => {
    for (let iteration = 0; iteration < 8; iteration++) await Promise.resolve()
    flush()
  }
  const findAll = predicate => {
    const found = []
    const walk = node => {
      if (node === null || typeof node !== 'object') return
      if (predicate(node)) found.push(node)
      node.children?.forEach(walk)
    }
    walk(tree)
    return found
  }
  const textOf = node => typeof node === 'string' || typeof node === 'number' ? String(node)
    : node?.children?.map(textOf).join('') ?? ''
  const trigger = () => findAll(node => node.props.className === 'dsh-ultra-trigger')[0]
  const options = () => findAll(node => node.props.role === 'menuitemradio')
  const open = () => { trigger().props.onClick(); flush() }
  const select = level => { options().find(option => option.props.key === level).props.onClick(); flush() }
  const dispose = () => {
    hooks.forEach(hook => hook?.cleanup?.())
    effects.toReversed().forEach(effect => effect?.())
    disposed = true
  }
  return {
    calls, slots, styles, timers, list, module: module.exports, render, settle, open, select, trigger, options, dispose, flush,
    text: () => textOf(tree), pulse: () => { timers.forEach(fn => fn()) },
    alerts: () => findAll(node => node.props.role === 'alert').map(textOf),
  }
}

test('registers a localized independent button with explicit session injection and only off/3/4/5 routes', async () => {
  const ui = harness()
  assert.deepEqual(Array.from(ui.module.inject), ['slots', 'connection', 'locale', 'sessions'])
  assert.equal(ui.slots[0].options.locale, 'dsh-ultra-mode')
  assert.equal(ui.slots[0].options.inject('session-a').sessionId, 'session-a')
  ui.render('session-a')
  await ui.settle()
  ui.open()
  assert.deepEqual(ui.options().map(option => option.props.key), [0, 3, 4, 5])
  assert.match(ui.text(), /另加 1 路决策 · 默认 max 思考/)
  assert.doesNotMatch(ui.styles[0].textContent, /canvas|slider|ult-track/)
  ui.select(5)
  await ui.settle()
  const mutation = ui.calls.find(call => call.endpoint === 'set')
  assert.equal(mutation.payload.sessionId, 'session-a')
  assert.equal(mutation.payload.concurrency, 5)
  assert.equal(mutation.payload.enabled, true)
  ui.dispose()
  assert.equal(ui.timers.size, 0)
  assert.equal(ui.styles.length, 0)
})

test('missing session identity leaves the button inert and never touches a shared bucket', async () => {
  const ui = harness()
  ui.render(undefined)
  await ui.settle()
  assert.equal(ui.trigger().props.disabled, true)
  assert.equal(ui.calls.length, 0)
  assert.equal(ui.timers.size, 0)
  ui.dispose()
})

test('late get response from the previous session cannot replace the current session state', async () => {
  const old = deferred()
  const ui = harness((_endpoint, payload) => payload.sessionId === 'session-a' ? old.promise : response({ enabled: true, concurrency: 4 }))
  ui.render('session-a')
  ui.render('session-b')
  await ui.settle()
  assert.match(ui.text(), /4 路/)
  old.resolve(response({ enabled: true, concurrency: 5 }))
  await ui.settle()
  assert.match(ui.text(), /4 路/)
  assert.doesNotMatch(ui.text(), /5 路/)
  ui.dispose()
})

test('late set response after a session switch cannot mark the new session enabled', async () => {
  const old = deferred()
  const ui = harness((endpoint, payload) => endpoint === 'set' ? old.promise
    : response(payload.sessionId === 'session-b' ? { enabled: true, concurrency: 3 } : {}))
  ui.render('session-a')
  await ui.settle()
  ui.open()
  ui.select(5)
  ui.render('session-b')
  await ui.settle()
  old.resolve(response({ enabled: true, concurrency: 5 }))
  await ui.settle()
  assert.match(ui.text(), /3 路/)
  assert.doesNotMatch(ui.text(), /5 路/)
  ui.dispose()
})

test('a rejected selection preserves the committed state and announces the service error', async () => {
  const ui = harness(endpoint => endpoint === 'set'
    ? { ok: false, error: { code: 'unavailable', message: 'model does not support max' } } : response())
  ui.render('session-a')
  await ui.settle()
  ui.open()
  ui.select(4)
  await ui.settle()
  assert.equal(ui.options().find(option => option.props.key === 0).props['aria-checked'], true)
  assert.match(ui.alerts().join(''), /model does not support max/)
  ui.dispose()
})

test('a poll begun before a successful selection cannot overwrite its newer result', async () => {
  const poll = deferred()
  let reads = 0
  const ui = harness(endpoint => endpoint === 'set' ? response({ enabled: true, concurrency: 5 })
    : ++reads === 1 ? response() : poll.promise)
  ui.render('session-a')
  await ui.settle()
  ui.pulse()
  ui.open()
  ui.select(5)
  await ui.settle()
  poll.resolve(response())
  await ui.settle()
  assert.match(ui.text(), /5 路/)
  ui.dispose()
})

test('decision and live coordination phases, active count and invalid responses have visible status', async () => {
  for (const [phase, label] of [['deciding', '决策中'], ['coordinating', '跨路协调中']]) {
    const ui = harness(async () => response({ enabled: true, running: true, activeRuns: 1, phase }))
    ui.render('session-a')
    await ui.settle()
    ui.open()
    assert.ok(ui.text().includes(label + ' · 1 个任务'))
    ui.dispose()
  }
  const broken = harness(async () => ({ ok: true, value: { enabled: true } }))
  broken.render('session-a')
  await broken.settle()
  broken.open()
  assert.match(broken.alerts().join(''), /无效的 Ultra 状态/)
  assert.ok(broken.options().every(option => option.props.disabled))
  broken.dispose()
})

test('settling an in-flight request after unmount does not write React state', async () => {
  const pending = deferred()
  const ui = harness(async () => pending.promise)
  ui.render('session-a')
  ui.dispose()
  pending.resolve(response())
  await ui.settle()
  assert.equal(ui.timers.size, 0)
})

test('internal route sessions are hidden without mutating the source or ordinary session metadata', () => {
  const regular = Object.freeze({ title: 'parent', origin: { kind: 'user' } })
  const subagent = Object.freeze({ title: 'real child', origin: { kind: 'subagent' } })
  const route = Object.freeze({ title: 'private execution audit', origin: undefined })
  const jobs = Object.freeze({ parent: [] })
  const original = Object.freeze({
    ids: Object.freeze(['parent', 'ultra-route-111', 'child', 'ordinary-ultra-route-name']),
    byId: Object.freeze({ parent: regular, 'ultra-route-111': route, child: subagent,
      'ordinary-ultra-route-name': regular, 'ultra-route-decision-only': route }),
    current: 'parent', phase: 'ready', jobsBySession: jobs,
  })
  const list = { getSnapshot: () => original, subscribe: () => () => {} }
  const ui = harness(undefined, { sessionList: list })
  const filtered = list.getSnapshot()
  assert.deepEqual(Array.from(filtered.ids), ['parent', 'child', 'ordinary-ultra-route-name'])
  assert.deepEqual(Object.keys(filtered.byId), ['parent', 'child', 'ordinary-ultra-route-name'])
  assert.equal(filtered.byId.parent, regular)
  assert.equal(filtered.byId.child, subagent)
  assert.equal(filtered.current, original.current)
  assert.equal(filtered.phase, original.phase)
  assert.equal(filtered.jobsBySession, jobs)
  assert.equal(original.ids.length, 4)
  assert.equal(Object.keys(original.byId).length, 5)
  assert.equal(list.getSnapshot(), filtered)
  ui.dispose()
})

test('session-list filtering memoizes source identity and follows later snapshots', () => {
  const first = { ids: ['parent', 'ultra-route-a'], byId: { parent: {}, 'ultra-route-a': {} }, phase: 'ready' }
  const second = { ids: ['parent', 'new-parent', 'ultra-route-b'], byId: { parent: {}, 'new-parent': {}, 'ultra-route-b': {} }, phase: 'ready' }
  let source = first
  const list = { getSnapshot() { return source }, subscribe: () => () => {} }
  const ui = harness(undefined, { sessionList: list })
  const firstResult = list.getSnapshot()
  source = second
  const secondResult = list.getSnapshot()
  assert.notEqual(secondResult, firstResult)
  assert.deepEqual(Array.from(secondResult.ids), ['parent', 'new-parent'])
  assert.equal(list.getSnapshot(), secondResult)
  source = first
  assert.equal(list.getSnapshot(), firstResult)
  const ordinary = { ids: ['parent'], byId: { parent: {} }, phase: 'ready' }
  source = ordinary
  assert.equal(list.getSnapshot(), ordinary)
  ui.dispose()
})

test('session-list bridge restores the exact original descriptor and preserves its receiver', () => {
  const raw = { ids: ['parent', 'ultra-route-a'], byId: { parent: {}, 'ultra-route-a': {} } }
  const list = { source: raw, getSnapshot() { assert.equal(this, list); return this.source }, subscribe: () => () => {} }
  const original = list.getSnapshot
  const descriptor = Object.getOwnPropertyDescriptor(list, 'getSnapshot')
  const ui = harness(undefined, { sessionList: list })
  assert.notEqual(list.getSnapshot, original)
  assert.deepEqual(Array.from(list.getSnapshot().ids), ['parent'])
  ui.dispose()
  assert.equal(list.getSnapshot, original)
  assert.deepEqual(Object.getOwnPropertyDescriptor(list, 'getSnapshot'), descriptor)
  assert.equal(list.getSnapshot(), raw)
})

test('unload respects a later plugin wrapper and retires filtering retained by that wrapper', () => {
  const raw = { ids: ['parent', 'ultra-route-a'], byId: { parent: {}, 'ultra-route-a': {} } }
  const list = { getSnapshot: () => raw, subscribe: () => () => {} }
  const ui = harness(undefined, { sessionList: list })
  const ultraWrapper = list.getSnapshot
  const laterWrapper = () => ultraWrapper()
  list.getSnapshot = laterWrapper
  assert.deepEqual(Array.from(list.getSnapshot().ids), ['parent'])
  ui.dispose()
  assert.equal(list.getSnapshot, laterWrapper)
  assert.equal(list.getSnapshot(), raw)
})

test('session-list bridge rejects an unwritable descriptor with a clear compatibility error', () => {
  const list = { subscribe: () => () => {} }
  Object.defineProperty(list, 'getSnapshot', { value: () => ({ ids: [], byId: {} }), writable: false })
  const original = list.getSnapshot
  assert.throws(() => harness(undefined, { sessionList: list }), /requires a writable sessions\.list\.getSnapshot/)
  assert.equal(list.getSnapshot, original)
})
