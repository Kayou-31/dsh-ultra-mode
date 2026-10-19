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
function harness(handler = async () => response(), { sessionList, language = 'zh', anchor, variant, viewport = { width: 800, height: 640 } } = {}) {
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
    createElement(type, elementProps, ...children) {
      if (anchor && elementProps?.className === 'dsh-ultra' && elementProps.ref) {
        elementProps.ref.current = { getBoundingClientRect: () => anchor }
      }
      return { type, props: elementProps ?? {}, children: children.flat() }
    },
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
    window: { innerWidth: viewport.width, innerHeight: viewport.height,
      setInterval(fn) { const id = timers.size + 1; timers.set(id, fn); return id }, clearInterval: id => timers.delete(id) },
    document, Node: class Node {}, Error, __DSH_ULTRA_VARIANT__: variant,
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
  const t = (key, params = {}) => dictionaries[language][key]?.replace(/\{(\w+)\}/g, (_match, name) => String(params[name])) ?? key
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
  const visibleTextOf = node => typeof node === 'string' || typeof node === 'number' ? String(node)
    : node?.props['aria-hidden'] || node?.props.className === 'dsh-ultra-status' ? ''
      : node?.children?.map(visibleTextOf).join('') ?? ''
  const trigger = () => findAll(node => node.props.className === 'dsh-ultra-trigger')[0]
  const team = () => findAll(node => node.props.className === 'dsh-ultra-team')[0]
  const options = () => findAll(node => node.props.role === 'menuitemradio')
  const menu = () => findAll(node => node.props.role === 'menu')[0]
  const open = () => { trigger().props.onClick(); flush() }
  const select = level => { options().find(option => option.props.key === level).props.onClick(); flush() }
  const dispose = () => {
    hooks.forEach(hook => hook?.cleanup?.())
    effects.toReversed().forEach(effect => effect?.())
    disposed = true
  }
  return {
    calls, slots, styles, timers, list, module: module.exports, render, settle, open, select, trigger, team, options, menu, dispose, flush,
    toggleTeam: () => { team().props.onClick(); flush() },
    text: () => textOf(tree), pulse: () => { timers.forEach(fn => fn()) },
    toolbarText: () => visibleTextOf(team()) + visibleTextOf(trigger()),
    alerts: () => findAll(node => node.props.role === 'alert').map(textOf),
  }
}

test('Decision client has its own module identity, RPC, locale, and only off/assist choices', async () => {
  const ui = harness(async () => response({ concurrency: 1 }), { variant: 'decision' })
  assert.equal(ui.slots[0].options.id, 'dsh-ultra-decision')
  assert.equal(ui.slots[0].options.locale, 'dsh-ultra-decision')
  assert.equal(ui.styles[0].dataset.plugin, 'dsh-ultra-decision')
  ui.render('decision-session')
  await ui.settle()
  ui.open()
  assert.equal(ui.calls[0].channel, '/dsh-ultra-decision')
  assert.deepEqual(ui.options().map(option => option.props.key), [0, 1])
  assert.match(ui.text(), /Decision/)
  assert.doesNotMatch(ui.text(), /2 路|3 路|4 路|5 路/)
  ui.dispose()
})

test('absolute menu stays within horizontal viewport margins without changing its vertical placement', async () => {
  for (const [width, anchor, expectedLeft, below] of [
    [240, { left: 20, right: 100, top: 600, bottom: 628 }, 16, false],
    [320, { left: 20, right: 100, top: 600, bottom: 628 }, 16, false],
    [390, { left: 282, right: 390, top: 80, bottom: 108 }, 114, true],
    [800, { left: 500, right: 608, top: 600, bottom: 628 }, 348, false],
  ]) {
    const ui = harness(undefined, { anchor, viewport: { width, height: 640 } })
    ui.render('session-a')
    await ui.settle()
    ui.open()
    const style = ui.menu().props.style
    const menuWidth = Math.min(260, width - 32)
    assert.equal(anchor.left + style.left, expectedLeft)
    assert.equal(style.right, 'auto')
    assert.ok(expectedLeft >= 16)
    assert.ok(expectedLeft + menuWidth <= width - 16)
    assert.equal(style.top, below ? 'calc(100% + 8px)' : undefined)
    assert.equal(style.bottom, below ? 'auto' : undefined)
    assert.ok(style.maxHeight > 0)
    ui.dispose()
  }
})

test('compact toolbar keeps full accessible mode descriptions with a bounded plugin-only footprint', async () => {
  for (const language of ['zh', 'en']) {
    for (const concurrency of [1, 2, 3, 4, 5]) {
      const ui = harness(async () => response({ enabled: true, concurrency, collaborationEnabled: true }), { language })
      ui.render('session-a')
      await ui.settle()
      const compact = concurrency === 1 ? language === 'zh' ? '辅助' : 'Aid' : String(concurrency)
      assert.equal(ui.toolbarText(), `${language === 'zh' ? '协作' : 'Team'}Ultra${compact}`)
      assert.equal(ui.team().props['aria-label'], language === 'zh' ? '协作增强' : 'Team')
      assert.equal(ui.team().props['aria-pressed'], true)
      assert.match(ui.team().props['aria-description'], /不强制 Max|does not force Max/)
      assert.match(ui.trigger().props['aria-description'], /Max|max/)
      const rootRule = ui.styles[0].textContent.match(/\.dsh-ultra\{([^}]+)\}/)[1]
      assert.match(rootRule, /flex:0 0 132px;width:132px;max-width:132px/)
      assert.match(ui.styles[0].textContent, /@container\(max-width:440px\)\{\.dsh-ultra\{flex-basis:96px;width:96px;max-width:96px\}/)
      ui.dispose()
    }
  }
})

test('loading, saving, running and errors add no visible toolbar status text', async () => {
  const loaded = deferred()
  const saved = deferred()
  const ui = harness(endpoint => endpoint === 'set' ? saved.promise : loaded.promise)
  ui.render('session-a')
  assert.equal(ui.toolbarText(), '协作Ultra关')
  assert.match(ui.trigger().props.title, /载入中/)
  loaded.resolve(response({ enabled: true, concurrency: 1 }))
  await ui.settle()
  ui.toggleTeam()
  assert.equal(ui.toolbarText(), '协作Ultra辅助')
  assert.equal(ui.trigger().props['aria-busy'], true)
  assert.match(ui.team().props.title, /保存中/)
  saved.resolve(response({ enabled: true, concurrency: 1, running: true, activeRuns: 1, phase: 'coordinating', collaborationEnabled: true }))
  await ui.settle()
  assert.equal(ui.toolbarText(), '协作Ultra辅助')
  assert.match(ui.trigger().props.title, /跨路协调中/)
  ui.dispose()

  const broken = harness(async () => response({ enabled: true, concurrency: 1, phase: 'failed', error: 'route failed' }))
  broken.render('session-a')
  await broken.settle()
  assert.equal(broken.toolbarText(), '协作Ultra辅助')
  assert.match(broken.trigger().props.title, /route failed/)
  broken.open()
  assert.match(broken.alerts().join(''), /route failed/)
  broken.dispose()
})

test('collaboration is an adjacent independent toggle and Ultra changes preserve its committed value', async () => {
  let committed = { enabled: false, concurrency: 3, collaborationEnabled: false }
  const ui = harness((endpoint, payload) => {
    if (endpoint === 'set') { const { sessionId, ...patch } = payload; committed = { ...committed, ...patch } }
    return response(committed)
  })
  ui.render('session-a')
  await ui.settle()
  assert.match(ui.team().props.title, /独立开关.*不强制 Max.*不改变 Ultra/)
  assert.equal(ui.team().props['aria-pressed'], false)
  ui.toggleTeam()
  await ui.settle()
  assert.equal(ui.team().props['aria-pressed'], true)
  assert.deepEqual({ ...ui.calls.find(call => call.endpoint === 'set').payload }, { sessionId: 'session-a', collaborationEnabled: true })
  assert.equal(committed.enabled, false)
  assert.equal(committed.concurrency, 3)
  ui.open()
  ui.select(4)
  await ui.settle()
  assert.equal(ui.team().props['aria-pressed'], true)
  assert.equal(Object.hasOwn(ui.calls.filter(call => call.endpoint === 'set').at(-1).payload, 'collaborationEnabled'), false)
  ui.toggleTeam()
  await ui.settle()
  assert.equal(ui.team().props['aria-pressed'], false)
  assert.equal(committed.enabled, true)
  assert.equal(committed.concurrency, 4)
  assert.deepEqual({ ...ui.calls.filter(call => call.endpoint === 'set').at(-1).payload }, { sessionId: 'session-a', collaborationEnabled: false })
  ui.dispose()
})

test('collaboration loading and shared mutation guards prevent duplicate or competing writes', async () => {
  const firstRead = deferred()
  const saved = deferred()
  const ui = harness(endpoint => endpoint === 'set' ? saved.promise : firstRead.promise)
  ui.render('session-a')
  assert.equal(ui.team().props.disabled, true)
  ui.toggleTeam()
  assert.equal(ui.calls.filter(call => call.endpoint === 'set').length, 0)
  firstRead.resolve(response())
  await ui.settle()
  assert.equal(ui.team().props['aria-pressed'], false, 'older snapshots omit collaborationEnabled and default to off')
  ui.toggleTeam()
  assert.equal(ui.team().props.disabled, true)
  ui.toggleTeam()
  ui.open()
  assert.ok(ui.options().every(option => option.props.disabled))
  ui.select(5)
  assert.equal(ui.calls.filter(call => call.endpoint === 'set').length, 1)
  saved.resolve(response({ collaborationEnabled: true }))
  await ui.settle()
  assert.equal(ui.team().props.disabled, false)
  assert.equal(ui.team().props['aria-pressed'], true)
  ui.dispose()
})

test('late collaboration writes and old polls cannot replace the current session snapshot', async () => {
  const oldWrite = deferred()
  const ui = harness((endpoint, payload) => endpoint === 'set' ? oldWrite.promise
    : response(payload.sessionId === 'session-b' ? { enabled: true, concurrency: 2, collaborationEnabled: false } : {}))
  ui.render('session-a')
  await ui.settle()
  ui.toggleTeam()
  ui.render('session-b')
  await ui.settle()
  oldWrite.resolve(response({ enabled: true, concurrency: 5, collaborationEnabled: true }))
  await ui.settle()
  assert.equal(ui.team().props['aria-pressed'], false)
  assert.match(ui.text(), /2 路/)
  ui.dispose()

  const oldPoll = deferred()
  let reads = 0
  const polled = harness(endpoint => endpoint === 'set' ? response({ collaborationEnabled: true })
    : ++reads === 1 ? response() : oldPoll.promise)
  polled.render('session-a')
  await polled.settle()
  polled.pulse()
  polled.toggleTeam()
  await polled.settle()
  oldPoll.resolve(response({ collaborationEnabled: false }))
  await polled.settle()
  assert.equal(polled.team().props['aria-pressed'], true)
  polled.dispose()
})

test('rejected collaboration toggle preserves both switches and invalid snapshot fields fail closed', async () => {
  const ui = harness(endpoint => endpoint === 'set' ? { ok: false, error: { message: 'Collaboration setting unavailable' } }
    : response({ enabled: true, concurrency: 3, collaborationEnabled: false }))
  ui.render('session-a')
  await ui.settle()
  ui.toggleTeam()
  await ui.settle()
  assert.equal(ui.team().props['aria-pressed'], false)
  assert.match(ui.text(), /3 路/)
  ui.open()
  assert.match(ui.alerts().join(''), /Collaboration setting unavailable/)
  ui.dispose()
  for (const collaborationEnabled of ['true', 1, null]) {
    const broken = harness(async () => response({ collaborationEnabled }))
    broken.render('session-a')
    await broken.settle()
    assert.equal(broken.team().props.disabled, true)
    broken.open()
    assert.match(broken.alerts().join(''), /无效的 Ultra 状态/)
    broken.dispose()
  }
})

test('registers a localized independent button with session injection, Agent assistance and 2/3/4/5 routes', async () => {
  const ui = harness((endpoint, payload) => endpoint === 'set'
    ? response({ enabled: payload.enabled, concurrency: payload.concurrency }) : response())
  assert.deepEqual(Array.from(ui.module.inject), ['slots', 'connection', 'locale', 'sessions'])
  assert.equal(ui.slots[0].options.locale, 'dsh-ultra-mode')
  assert.equal(ui.slots[0].options.inject('session-a').sessionId, 'session-a')
  ui.render('session-a')
  await ui.settle()
  ui.open()
  assert.deepEqual(ui.options().map(option => option.props.key), [0, 1, 2, 3, 4, 5])
  assert.match(ui.text(), /另加 1 路决策 · 默认 max 思考/)
  assert.doesNotMatch(ui.styles[0].textContent, /canvas|slider|ult-track/)
  ui.select(2)
  await ui.settle()
  const mutation = ui.calls.find(call => call.endpoint === 'set')
  assert.equal(mutation.payload.sessionId, 'session-a')
  assert.equal(mutation.payload.concurrency, 2)
  assert.equal(mutation.payload.enabled, true)
  assert.match(ui.text(), /2 路/)
  ui.dispose()
  assert.equal(ui.timers.size, 0)
  assert.equal(ui.styles.length, 0)
})

test('Agent plus decision mode uses main Agent wording and accepts its enabled and disabled snapshots', async () => {
  const ui = harness((endpoint, payload) => endpoint === 'set'
    ? response({ enabled: payload.enabled, concurrency: payload.concurrency }) : response())
  ui.render('session-a')
  await ui.settle()
  ui.open()
  assert.match(ui.text(), /正常主 Agent 执行 · 另 1 路 Max 决策/)
  ui.select(1)
  await ui.settle()
  const mutation = ui.calls.find(call => call.endpoint === 'set')
  assert.equal(mutation.payload.concurrency, 1)
  assert.equal(mutation.payload.enabled, true)
  assert.match(ui.text(), /辅助/)
  assert.match(ui.trigger().props.title, /正常主 Agent 执行 \+ 1 路 Max 自动决策辅助/)
  assert.doesNotMatch(ui.trigger().props.title, /1 路并发/)
  ui.open()
  assert.equal(ui.options().find(option => option.props.key === 1).props['aria-checked'], true)
  ui.select(0)
  await ui.settle()
  const off = ui.calls.filter(call => call.endpoint === 'set').at(-1)
  assert.equal(off.payload.enabled, false)
  assert.equal(off.payload.concurrency, 1)
  assert.equal(ui.alerts().length, 0)
  assert.match(ui.text(), /关/)
  ui.dispose()
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
  for (const invalid of [{ enabled: true }, state({ enabled: true, concurrency: 0 }), state({ enabled: true, concurrency: 6 })]) {
    const broken = harness(async () => ({ ok: true, value: invalid }))
    broken.render('session-a')
    await broken.settle()
    broken.open()
    assert.match(broken.alerts().join(''), /无效的 Ultra 状态/)
    assert.ok(broken.options().every(option => option.props.disabled))
    broken.dispose()
  }
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

test('recovered assistant diagnostics remain inspectable without presenting successful completion as failure', async () => {
  const ui = harness(async () => response({ enabled: true, concurrency: 1, phase: 'completed', error: null,
    warnings: ['第 1 轮：协议格式曾无效，随后已修复'] }))
  ui.render('session-a')
  await ui.settle()
  ui.open()
  assert.match(ui.text(), /已完成/)
  assert.match(ui.text(), /保留 1 条辅助诊断/)
  assert.match(ui.text(), /随后已修复/)
  assert.doesNotMatch(ui.text(), /执行失败/)
  assert.equal(ui.alerts().length, 0, 'historical warnings are not an active error alert')
  ui.dispose()
})

test('timeout, cancellation and explicit stop retain their distinct status even with diagnostics', async () => {
  for (const [phase, label, error] of [
    ['timed-out', '辅助已超时', 'Ultra 决策辅助已超时，主 Agent 保持正常运行。'],
    ['stopped', '辅助已停止', null],
    ['cancelled', '已取消', 'Parent cancellation during assistant cleanup'],
  ]) {
    const ui = harness(async () => response({ enabled: true, concurrency: 1, phase, error }))
    ui.render('session-a')
    await ui.settle()
    ui.open()
    assert.match(ui.text(), new RegExp(label))
    assert.doesNotMatch(ui.text(), /已完成|执行失败/)
    ui.dispose()
  }
})

test('malformed warning metadata is rejected at the client RPC boundary', async () => {
  for (const warnings of ['a warning', [1]]) {
    const ui = harness(async () => response({ warnings }))
    ui.render('session-a')
    await ui.settle()
    ui.open()
    assert.match(ui.alerts().join(''), /无效的 Ultra 状态/)
    ui.dispose()
  }
})

const evidenceStatus = () => ({ enabled: true, available: true, runId: 'run-visible', phase: 'researching',
  coverage: { raw: { sources: 8, chunks: 20, characters: 30000, attachments: 2, coverage: { host: 6, captured: 1, truncated: 1, 'reference-only': 0 } }, semantic: { total: 5, current: 3, superseded: 1, unresolved: 1 } },
  retrievals: 4, unresolvedConflicts: 2, errors: [], routes: [{ routeId: 'worker-real', status: 'running' }],
  compression: { status: 'compacted', before: { totalTokens: 24000, estimated: true }, after: { totalTokens: 12000, estimated: true }, replacements: [], limits: [] },
  resources: { attemptedCalls: 6, settledCalls: 5, measuredTokens: 18000, unknownUsageCalls: 1, estimates: { totalTokens: 16000, estimated: true, remainingTokens: -2000 } },
})

test('optional evidence is inspectable in menu and ARIA without expanding compact controls or polling', async () => {
  for (const language of ['zh', 'en']) {
    const ui = harness(async () => response({ enabled: true, concurrency: 2, evidence: evidenceStatus() }), { language })
    ui.render('session-a'); await ui.settle()
    assert.equal(ui.toolbarText(), language === 'zh' ? '协作Ultra2' : 'TeamUltra2')
    assert.match(ui.trigger().props['aria-description'], /researching/)
    assert.equal(ui.timers.size, 1)
    ui.open()
    for (const phrase of ['24000', '12000', '18000', '16000', 'worker-real', 'running']) assert.ok(ui.text().includes(phrase), phrase)
    assert.match(ui.text(), language === 'zh' ? /原始证据.*8/ : /Raw evidence.*8/)
    assert.match(ui.text(), language === 'zh' ? /语义记忆.*5/ : /Semantic memory.*5/)
    assert.match(ui.text(), language === 'zh' ? /未解决冲突.*2/ : /Unresolved conflicts.*2/)
    assert.match(ui.text(), language === 'zh' ? /估算/ : /Estimated/)
    assert.equal(ui.options().length, 6)
    assert.equal(ui.calls.length, 1)
    ui.dispose()
  }
})

test('absent evidence stays hidden and unavailable evidence reports its bounded diagnostic', async () => {
  for (const evidence of [undefined, { enabled: true, available: false, coverage: 'unknown', error: 'Persistence unavailable' }]) {
    const ui = harness(async () => response({ evidence }))
    ui.render('session-a'); await ui.settle(); ui.open()
    assert.equal(ui.alerts().length, 0)
    if (evidence) assert.ok(ui.text().includes('Persistence unavailable'))
    else assert.equal(ui.text().includes('证据与资源'), false)
    ui.dispose()
  }
})

test('malformed nested evidence metadata fails closed at the RPC boundary', async () => {
  for (const change of [
    value => { value.enabled = 'yes' }, value => { value.retrievals = -1 },
    value => { value.coverage.raw.sources = 0.5 }, value => { value.coverage.semantic.current = Infinity },
    value => { value.resources.measuredTokens = NaN }, value => { value.resources.unknownUsageCalls = 'unknown' },
    value => { value.resources.estimates.totalTokens = -1 }, value => { value.compression.after.totalTokens = -2 },
    value => { value.errors = [1] }, value => { value.routes = [{ routeId: 'r', status: 1 }] },
  ]) {
    const evidence = evidenceStatus(); change(evidence)
    const ui = harness(async () => response({ evidence }))
    ui.render('session-a'); await ui.settle(); ui.open()
    assert.match(ui.alerts().join(''), /无效的 Ultra 状态/)
    ui.dispose()
  }
})

test('partial compression failure and unsupported diagnostics retain controls without claiming token metrics', async () => {
  for (const language of ['zh', 'en']) for (const compression of [
    { status: 'failed', originalHistoryRetained: true },
    { status: 'unsupported', before: null, after: null, limits: ['Pinned host authority unavailable'] },
    { status: 'limited', before: { totalTokens: 12345, estimated: true }, limits: ['History retained'] },
  ]) {
    const evidence = { ...evidenceStatus(), compression }
    const ui = harness(async () => response({ enabled: true, evidence }), { language })
    ui.render('session-a'); await ui.settle(); ui.open()
    assert.equal(ui.alerts().length, 0)
    assert.equal(ui.team().props.disabled, false)
    assert.ok(ui.options().every(option => option.props.disabled === false))
    assert.ok(ui.text().includes(compression.status))
    assert.equal(ui.text().includes('undefined'), false)
    if (compression.originalHistoryRetained) assert.match(ui.text(), language === 'zh' ? /原始历史已保留/ : /Original history retained/)
    if (compression.limits) assert.ok(ui.text().includes(compression.limits[0]))
    ui.dispose()
  }
})

test('provided compression failure metrics and retention flags remain strictly validated', async () => {
  for (const compression of [
    { status: 'failed', before: { totalTokens: -1 } },
    { status: 'unsupported', after: { totalTokens: Infinity } },
    { status: 'failed', originalHistoryRetained: 'yes' },
    { status: 'failed', limits: [42] },
  ]) {
    const ui = harness(async () => response({ evidence: { ...evidenceStatus(), compression } }))
    ui.render('session-a'); await ui.settle(); ui.open()
    assert.match(ui.alerts().join(''), /无效的 Ultra 状态/)
    ui.dispose()
  }
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

test('decision governance displays delivery stages and model-only acceptance without claiming effects', async () => {
  const governance = { enabled: true, taskHash: 'a'.repeat(64), taskRevision: 1, originalChars: 40, intentItems: 4,
    queued: 1, admitted: 0, requestVisible: 1, effectVerified: 0, closedDirections: 0,
    verification: { satisfied: 1, failed: 0, unverified: 1, allSatisfied: false, hostVerified: false }, durable: true, closed: false, errors: [] }
  const ui = harness(async () => response({ governance }))
  ui.render('session-a'); await ui.settle(); ui.open()
  assert.match(ui.text(), /意图与验收/)
  assert.match(ui.text(), /待处理 1/)
  assert.match(ui.text(), /进入请求 1/)
  assert.match(ui.text(), /独立效果验证 0/)
  assert.match(ui.text(), /模型判断/)
  assert.match(ui.text(), /未验证 1/)
  ui.dispose()
})

test('invalid governance telemetry cannot turn a model judgement into host verification', async () => {
  const ui = harness(async () => response({ governance: { enabled: true, verification: { hostVerified: true } } }))
  ui.render('session-a'); await ui.settle(); ui.open()
  assert.match(ui.alerts().join(''), /无效的 Ultra 状态/)
  ui.dispose()
})
