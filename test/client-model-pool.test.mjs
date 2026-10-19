/** Model-pool form contract through its actual React component; no browser/model/network. */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const sourceUrl = new URL('../src/client/model-pool.ts', import.meta.url)
const compiled = existsSync(sourceUrl) ? ts.transpileModule(readFileSync(sourceUrl, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText : 'module.exports = {}'
const model = (changes = {}) => ({ id: 'review', name: '审查', enabled: true, provider: 'alpha', model: 'same',
  strengths: '验证边界', suitableFor: '代码审查', avoidFor: '图片', isDefault: true, maxConcurrent: 1,
  allowCrossProvider: false, allowUnverifiedTools: false, ...changes })
const config = (changes = {}) => ({ models: [model()], fallback: 'error', maxConcurrent: 2, maxRequests: 0, failureLimit: 3, ...changes })
const value = (changes = {}) => ({ config: config(), editable: true,
  hostModels: [{ provider: 'alpha', model: 'same', name: '相同名称' }, { provider: 'beta', model: 'same', name: '相同名称' }], records: [], ...changes })
const response = (changes = {}) => ({ ok: true, value: value(changes) })
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

function harness(handler = () => response()) {
  let hooks = [], cursor = 0, dirty = false, pending = [], tree, props, disposed = false
  const calls = [], listeners = new Map()
  const React = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity) } },
    useState(initial) {
      const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      return [hooks[i], v => { if (disposed) throw new Error('state after unmount'); hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; dirty = true }]
    },
    useRef(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i] },
    useId() { return 'pool-dialog' },
    useEffect(fn, deps) {
      const i = cursor++, old = hooks[i]
      if (old && deps.every((v, n) => Object.is(v, old.deps[n]))) return
      pending.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() } })
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => { assert.equal(name, 'react'); return React }, Error,
    document: { addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) } },
  })
  const api = module.exports
  const rpc = { async call(channel, endpoint, payload) { calls.push({ channel, endpoint, payload }); return handler(endpoint, payload) } }
  const flush = () => {
    for (let n = 0; dirty && n < 30; n++) { dirty = false; cursor = 0; tree = api.ModelPoolPanel(props); const ready = pending; pending = []; ready.forEach(fn => fn()) }
    if (dirty) throw new Error('render loop')
  }
  const render = (sessionId = 'parent-a', options = {}) => { assert.equal(typeof api.ModelPoolPanel, 'function', 'model-pool editor must be implemented'); props = { sessionId, rpc, onClose() {}, ...options }; dirty = true; flush() }
  const find = predicate => { const found = []; const walk = n => { if (!n || typeof n !== 'object') return; if (predicate(n)) found.push(n); n.children?.forEach(walk) }; walk(tree); return found }
  const text = n => typeof n === 'string' || typeof n === 'number' ? String(n) : n?.children?.map(text).join('') ?? ''
  return { calls, api, render, flush,
    async settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); flush() },
    text: () => text(tree), find,
    field: name => find(n => n.props['data-field'] === name)[0],
    change(name, next, checkbox = false) { const n = this.field(name); assert.ok(n, name); n.props.onChange({ target: checkbox ? { checked: next } : { value: next } }); flush() },
    button(name) { const n = find(n => n.type === 'button' && text(n) === name)[0]; assert.ok(n, `button ${name}`); return n },
    click(name) { this.button(name).props.onClick(); flush() },
    dispose() { hooks.forEach(h => h?.cleanup?.()); disposed = true },
  }
}

test('pool editor loads only the scoped host directory and distinguishes same model names by provider', async () => {
  const ui = harness(() => response({ hostModels: [
    { provider: 'alpha', model: 'same', name: '相同名称' }, { provider: 'beta', model: 'same', name: '相同名称' }, { provider: 'alpha', model: 'same', name: '重复目录行' },
  ] })); ui.render(); await ui.settle()
  assert.equal(ui.calls[0].channel, '/dsh-ultra-model-pool')
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls[0].payload)), { sessionId: 'parent-a' })
  const routes = ui.field('models.0.route').children.filter(n => n?.type === 'option')
  assert.equal(routes.length, 2, 'duplicate host route rows collapse by exact provider/model identity')
  assert.notEqual(routes[0].props.value, routes[1].props.value)
  assert.ok(routes[0].children.join('').includes('alpha'))
  assert.ok(routes[1].children.join('').includes('beta'))
  assert.match(ui.text(), /仅影响后续新建子代理/)
  assert.match(ui.text(), /未验证/)
  assert.equal(ui.field('models.0.allowCrossProvider').props.checked, false)
  assert.equal(ui.field('models.0.allowUnverifiedTools').props.checked, false)
  ui.dispose()
})

test('editing capabilities and exact host route saves only supported settings and explicit opt-ins', async () => {
  const ui = harness(); ui.render(); await ui.settle()
  ui.change('models.0.route', '["beta","same"]')
  ui.change('models.0.strengths', '长文检查')
  ui.change('models.0.reasoningEffort', ' high ')
  ui.change('models.0.maxTokens', '4096')
  ui.change('models.0.allowCrossProvider', true, true)
  ui.change('models.0.allowUnverifiedTools', true, true)
  ui.change('explicitModelId', 'review')
  ui.click('保存配置'); await ui.settle()
  const saved = ui.calls.find(c => c.endpoint === 'save').payload
  assert.equal(saved.sessionId, 'parent-a')
  assert.equal(saved.config.explicitModelId, 'review')
  assert.equal(saved.config.models[0].provider, 'beta')
  assert.equal(saved.config.models[0].model, 'same')
  assert.equal(saved.config.models[0].reasoningEffort, 'high')
  assert.equal(saved.config.models[0].maxTokens, 4096)
  assert.equal(saved.config.models[0].strengths, '长文检查')
  assert.equal(saved.config.models[0].allowCrossProvider, true)
  assert.equal(saved.config.models[0].allowUnverifiedTools, true)
  assert.equal(Object.hasOwn(saved.config.models[0], 'apiKey'), false)
  assert.equal(Object.hasOwn(saved.config.models[0], 'temperature'), false)
  ui.dispose()
})

test('empty optional parameters stay omitted and auto removes a user-fixed selection', async () => {
  const ui = harness(() => response({ config: config({ explicitModelId: 'review', models: [model({ reasoningEffort: 'max', maxTokens: 8192 })] }) }))
  ui.render(); await ui.settle()
  ui.change('explicitModelId', '')
  ui.change('models.0.reasoningEffort', '')
  ui.change('models.0.maxTokens', '')
  ui.click('保存配置'); await ui.settle()
  const saved = ui.calls.find(c => c.endpoint === 'save').payload.config
  assert.equal(Object.hasOwn(saved, 'explicitModelId'), false)
  assert.equal(Object.hasOwn(saved.models[0], 'reasoningEffort'), false)
  assert.equal(Object.hasOwn(saved.models[0], 'maxTokens'), false)
  ui.dispose()
})

test('invalid concurrent limits, arbitrary route and unsupported parameter sources cannot be submitted', async () => {
  for (const [field, next, expected] of [
    ['maxConcurrent', '0', /并发/], ['models.0.maxTokens', '-1', /输出/],
    ['models.0.route', '["unconfigured","same"]', /宿主/],
    ['models.0.costSource', 'measured', /来源/],
  ]) {
    const ui = harness(); ui.render(); await ui.settle()
    ui.change(field, next); ui.click('保存配置'); await ui.settle()
    assert.equal(ui.calls.some(c => c.endpoint === 'save'), false, field)
    assert.match(ui.text(), expected)
    ui.dispose()
  }
})

test('adding multiple candidates uses host routes and one default; removal clears an explicit selection', async () => {
  const ui = harness(); ui.render(); await ui.settle()
  ui.click('添加候选模型')
  assert.ok(ui.field('models.1.id'))
  ui.change('models.1.id', 'writer')
  ui.change('models.1.isDefault', true, true)
  ui.change('explicitModelId', 'writer')
  ui.click('移除候选 2')
  ui.click('保存配置'); await ui.settle()
  const saved = ui.calls.find(c => c.endpoint === 'save').payload.config
  assert.equal(saved.models.length, 1)
  assert.equal(Object.hasOwn(saved, 'explicitModelId'), false)
  ui.dispose()
})

test('read-only profile and save rejection preserve the form with a visible reason', async () => {
  const locked = harness(() => response({ editable: false })); locked.render(); await locked.settle()
  assert.equal(locked.button('保存配置').props.disabled, true)
  locked.click('保存配置'); assert.equal(locked.calls.some(c => c.endpoint === 'save'), false)
  assert.match(locked.text(), /只读|不可编辑/); locked.dispose()
  const rejected = harness(endpoint => endpoint === 'save' ? { ok: false, error: { message: '宿主配置写入被拒绝' } } : response())
  rejected.render(); await rejected.settle(); rejected.change('models.0.strengths', '保留草稿')
  rejected.click('保存配置'); await rejected.settle()
  assert.equal(rejected.field('models.0.strengths').props.value, '保留草稿')
  assert.match(rejected.text(), /宿主配置写入被拒绝/); rejected.dispose()
})

test('host catalog failures remain visible and are distinct from an unconfigured model directory', async () => {
  const ui = harness(() => response({ hostModels: [], catalogErrors: ['alpha 的宿主模型目录暂不可用'] }))
  ui.render(); await ui.settle()
  assert.match(ui.text(), /alpha 的宿主模型目录暂不可用/)
  assert.doesNotMatch(ui.text(), /暂无可用宿主模型，请先在 DSH 模型设置中配置/)
  assert.equal(ui.button('添加候选模型').props.disabled, true)
  ui.dispose()
})

test('a prior session response and a response after unmount cannot update the current editor', async () => {
  const old = deferred()
  const ui = harness((_endpoint, payload) => payload.sessionId === 'parent-a' ? old.promise : response({ config: config({ models: [model({ id: 'second', name: '新会话' })] }) }))
  ui.render('parent-a'); ui.render('parent-b'); await ui.settle()
  old.resolve(response()); await ui.settle()
  assert.equal(ui.field('models.0.id').props.value, 'second')
  ui.dispose()
  const late = deferred(), gone = harness(() => late.promise); gone.render(); gone.dispose(); late.resolve(response()); await gone.settle()
})

test('late save result cannot replace another session form and duplicate saves are suppressed', async () => {
  const pending = deferred()
  const ui = harness((endpoint, payload) => endpoint === 'save' ? pending.promise : response({ config: config({ models: [model({ id: payload.sessionId })] }) }))
  ui.render('parent-a'); await ui.settle(); ui.click('保存配置'); ui.click('保存配置')
  assert.equal(ui.calls.filter(call => call.endpoint === 'save').length, 1)
  ui.render('parent-b'); await ui.settle()
  pending.resolve(response()); await ui.settle()
  assert.equal(ui.field('models.0.id').props.value, 'parent-b')
  ui.dispose()
})

test('malformed host telemetry and invalid raw limits fail before binding editable inputs', async () => {
  for (const change of [
    data => { data.config.maxConcurrent = -1 },
    data => { data.config.models[0].maxConcurrent = 0 },
    data => { data.records = [{ id: 'child', taskName: 'test', status: 'running', usage: { requests: 1, knownTokens: -1, unknownCalls: 0 } }] },
  ]) {
    const data = value(); change(data)
    const ui = harness(() => ({ ok: true, value: data })); ui.render(); await ui.settle()
    assert.match(ui.text(), /无效的模型池配置/)
    assert.equal(ui.field('models.0.id'), undefined)
    ui.dispose()
  }
})

test('editor remains inside narrow viewports and omits arbitrary nested compatibility fields', async () => {
  const ui = harness(() => response({ records: [{ id: 'child', taskName: 'test', status: 'running', model: { compatibility: { tools: 'unknown', privateReasoning: 'DO_NOT_RENDER' } } }] }))
  ui.render('parent-a', { anchor: { left: 240, right: 372, top: 550, bottom: 578 }, viewport: { width: 390, height: 640 } }); await ui.settle()
  const panel = ui.find(n => n.props.role === 'dialog')[0]
  assert.equal(panel.props.style.left + 240, 16)
  assert.equal(panel.props.style.width, 358)
  assert.ok(panel.props.style.maxHeight <= 538)
  assert.doesNotMatch(ui.text(), /DO_NOT_RENDER/)
  ui.dispose()
})

test('records show requested and effective model plus known usage without serializing private fields', async () => {
  const ui = harness(() => response({ records: [{ id: 'child-x', taskName: '核对调用', status: 'completed',
    model: { requestedConfigId: 'review', selectedConfigId: 'backup', source: 'agent', reason: '任务需要独立审查', provider: 'beta', model: 'same', compatibility: { tools: 'unknown' }, fallbackReason: '已授权默认回退' },
    usage: { requests: 2, knownTokens: 321, unknownCalls: 1 }, privateReasoning: 'DO_NOT_RENDER' }] }))
  ui.render(); await ui.settle()
  for (const text of ['核对调用', 'review', 'backup', 'beta', 'same', '321', 'unknown', '任务需要独立审查', '已授权默认回退']) assert.ok(ui.text().includes(text), text)
  assert.doesNotMatch(ui.text(), /DO_NOT_RENDER/)
  ui.dispose()
})
test('unfinished request usage is visible as unsettled rather than a zero-cost result', async () => {
  const ui = harness(() => response({ records: [{ id: 'child-pending', taskName: '读取', status: 'running', usage: { requests: 1, knownTokens: 0, unknownCalls: 0, inFlightRequests: 1 } }] }))
  ui.render(); await ui.settle()
  assert.match(ui.text(), /尚未结算 1 次/)
  ui.dispose()
})
test('public task and durable audit failures remain visible alongside in-memory usage', async () => {
  const ui = harness(() => response({ records: [{ id: 'child-warning', taskName: '核对', status: 'failed', error: 'provider unavailable', recordingError: '模型记录持久化失败：disk full', usage: { requests: 1, knownTokens: 10, unknownCalls: 0 } }] }))
  ui.render(); await ui.settle()
  assert.match(ui.text(), /provider unavailable/)
  assert.match(ui.text(), /模型记录持久化失败：disk full/)
  ui.dispose()
})

test('resolved model stays a plan until a native assembled request is observed', async () => {
  for (const observed of [false, true]) {
    const ui = harness(() => response({ records: [{ id: 'child', taskName: 'plan', status: 'running', model: {
      provider: 'alpha', model: 'same', requestStatus: observed ? 'observed' : 'pending',
      ...(observed ? { actual: { provider: 'beta', model: 'actual-route', stage: 'native-request', maxTokens: 321 } } : {}),
    } }] }))
    ui.render(); await ui.settle()
    assert.match(ui.text(), /解析模型：alpha \/ same/)
    assert.match(ui.text(), observed ? /实际请求：beta \/ actual-route/ : /实际请求：尚未观察到/)
    assert.match(ui.text(), /不代表供应商已执行/)
    ui.dispose()
  }
})

test('composer exposes an on-demand model pool beside collaboration without adding startup RPC calls', async () => {
  const client = ts.transpileModule(readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  let hooks = [], cursor = 0, dirty = true, effects = [], tree, slot, dictionaries
  const calls = [], cleanups = []
  const React = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity) } },
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], v => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; dirty = true }] },
    useRef(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i] },
    useId() { cursor++; return 'composer-menu' },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (old && deps.every((v, n) => Object.is(v, old.deps[n]))) return; effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() } }) },
  }
  const rpc = { async call(channel, endpoint, payload) { calls.push({ channel, endpoint, payload }); return { ok: true, value: { enabled: false, concurrency: 3, running: false, activeRuns: 0, lastRun: null } } } }
  const document = { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} }
  const module = { exports: {} }, panel = () => null
  vm.runInNewContext(client, { module, exports: module.exports, require: name => name === 'react' ? React : name === './model-pool.js' ? { ModelPoolPanel: panel } : assert.fail(name), Error,
    document, window: { setInterval: () => 1, clearInterval() {}, innerWidth: 800, innerHeight: 640 }, Node: class Node {} })
  module.exports.apply({ sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) } },
    effect(fn) { const off = fn(); cleanups.push(off); return off }, get: () => ({ rpc }), locale: { register(_ns, values) { dictionaries = values; return () => {} } },
    slots: { inject(_name, fn) { return fn() }, register(_options, render) { slot = render; return () => {} } } })
  const element = slot({ sessionId: 'session-entry', t: key => dictionaries.zh[key] ?? key })
  const flush = () => { for (let i = 0; dirty && i < 20; i++) { dirty = false; cursor = 0; tree = element.type(element.props); const ready = effects; effects = []; ready.forEach(fn => fn()) } }
  const find = predicate => { const found = []; const walk = n => { if (!n || typeof n !== 'object') return; if (predicate(n)) found.push(n); n.children?.forEach(walk) }; walk(tree); return found }
  flush(); for (let n = 0; n < 8; n++) await Promise.resolve(); flush()
  assert.equal(calls.length, 1, 'closed model pool causes no additional get/poll')
  const button = find(n => n.type === 'button' && n.props.className === 'dsh-ultra-pool-trigger')[0]
  assert.ok(button, 'compact model-pool entry is present')
  assert.equal(button.props.disabled, false)
  assert.match(button.props['aria-label'], /模型池/)
  button.props.onClick(); flush(); for (let n = 0; n < 8; n++) await Promise.resolve(); flush()
  const rendered = find(n => n.type === panel)[0]
  assert.ok(rendered, 'opening mounts the real lazy model-pool panel')
  assert.equal(rendered.props.sessionId, 'session-entry')
  assert.equal(rendered.props.rpc, rpc)
  hooks.forEach(h => h?.cleanup?.()); cleanups.reverse().forEach(fn => fn?.())
})
