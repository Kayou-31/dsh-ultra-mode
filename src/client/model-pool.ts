/** Profile-owned ordinary collaboration model pool; the host owns all final validation. */
import React from 'react'

interface Rpc { call(channel: string, endpoint: string, payload?: unknown): Promise<unknown> }
interface HostModel { provider: string; model: string; name: string }
interface Candidate {
  id: string; name: string; enabled: boolean; provider: string; model: string
  strengths: string; suitableFor: string; avoidFor: string; reasoningEffort?: string; maxTokens?: number | string
  isDefault: boolean; maxConcurrent: number | string; allowCrossProvider: boolean; allowUnverifiedTools: boolean
  costNote?: string; costSource?: 'user' | 'measured'; speedNote?: string; speedSource?: 'user' | 'measured'
}
interface PoolConfig {
  models: Candidate[]; explicitModelId?: string; fallback: 'error' | 'default' | 'inherit'
  maxConcurrent: number | string; maxRequests: number | string; failureLimit: number | string
}
interface RecordView {
  id: string; taskName: string; status: string
  error?: string; recordingError?: string
  model?: { requestedConfigId?: string; selectedConfigId?: string; source?: string; reason?: string; provider?: string; model?: string; reasoningEffort?: string; maxTokens?: number; compatibility?: unknown; fallbackReason?: string
    requestStatus?: 'pending' | 'observed'; actual?: { provider: string; model: string; reasoningEffort?: string; maxTokens?: number; stage: 'native-request' } }
  usage?: { requests: number; knownTokens: number; unknownCalls: number; inFlightRequests?: number }
}
interface PoolSnapshot { config: PoolConfig; hostModels: HostModel[]; editable: boolean; records: RecordView[]; catalogErrors: string[] }
interface Props { sessionId: string; rpc: Rpc; onClose(): void; anchor?: { left: number; right: number; top: number; bottom: number }; viewport?: { width: number; height: number } }
interface Scope { sessionId: string; rpc: Rpc; disposed: boolean; busy: boolean }

const channel = '/dsh-ultra-model-pool'
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const string = (value: unknown): value is string => typeof value === 'string' && value.length <= 20000
const routeKey = (route: { provider: string; model: string }): string => JSON.stringify([route.provider, route.model])
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : '模型池服务请求失败'

/** Reject malformed service envelopes before binding any form values. */
function readSnapshot(raw: unknown): PoolSnapshot {
  const invalid = (): never => { throw new Error('服务端返回了无效的模型池配置') }
  if (!object(raw)) return invalid()
  if (raw.ok !== true) throw new Error(object(raw.error) && string(raw.error.message) ? raw.error.message : '模型池服务请求失败')
  const value = raw.value
  if (!object(value) || !object(value.config) || !Array.isArray(value.config.models) || value.config.models.length > 32
    || !Array.isArray(value.hostModels) || value.hostModels.length > 10000 || typeof value.editable !== 'boolean'
    || !Array.isArray(value.records) || value.records.length > 1000
    || (value.catalogErrors !== undefined && (!Array.isArray(value.catalogErrors) || value.catalogErrors.length > 128 || !value.catalogErrors.every(string)))) return invalid()
  const config = value.config
  if (!['error', 'default', 'inherit'].includes(String(config.fallback))
    || !Number.isSafeInteger(config.maxConcurrent) || Number(config.maxConcurrent) < 1 || Number(config.maxConcurrent) > 32
    || !Number.isSafeInteger(config.maxRequests) || Number(config.maxRequests) < 0 || !Number.isSafeInteger(config.failureLimit) || Number(config.failureLimit) < 1 || Number(config.failureLimit) > 100
    || (config.explicitModelId !== undefined && !string(config.explicitModelId))) return invalid()
  for (const model of config.models as unknown[]) {
    if (!object(model) || !['id', 'name', 'provider', 'model', 'strengths', 'suitableFor', 'avoidFor'].every(key => string(model[key]))
      || !['enabled', 'isDefault', 'allowCrossProvider', 'allowUnverifiedTools'].every(key => typeof model[key] === 'boolean')
      || !Number.isSafeInteger(model.maxConcurrent) || Number(model.maxConcurrent) < 1 || Number(model.maxConcurrent) > 32
      || (model.maxTokens !== undefined && (!Number.isSafeInteger(model.maxTokens) || Number(model.maxTokens) < 1))
      || (model.reasoningEffort !== undefined && !string(model.reasoningEffort))
      || !['costNote', 'speedNote'].every(key => model[key] === undefined || string(model[key]))
      || !['costSource', 'speedSource'].every(key => model[key] === undefined || model[key] === 'user' || model[key] === 'measured')) return invalid()
  }
  for (const model of value.hostModels) if (!object(model) || !string(model.provider) || !string(model.model) || !string(model.name)) return invalid()
  // Display only a small whitelist from child records; never serialize arbitrary history or private fields.
  const records: RecordView[] = value.records.map(record => {
    if (!object(record) || !string(record.id) || !string(record.taskName) || !string(record.status)) return invalid()
    const picked: RecordView = { id: record.id, taskName: record.taskName, status: record.status }
    for (const key of ['error', 'recordingError'] as const) if (record[key] !== undefined) { if (!string(record[key])) return invalid(); picked[key] = record[key] as string }
    if (record.model !== undefined) {
      if (!object(record.model)) return invalid()
      const selected: NonNullable<RecordView['model']> = {}
      for (const key of ['requestedConfigId', 'selectedConfigId', 'source', 'reason', 'provider', 'model', 'reasoningEffort', 'fallbackReason'] as const) {
        const field = record.model[key]
        if (field !== undefined) { if (!string(field)) return invalid(); selected[key] = field }
      }
      if (record.model.maxTokens !== undefined) { if (!Number.isSafeInteger(record.model.maxTokens)) return invalid(); selected.maxTokens = record.model.maxTokens as number }
      // Compatibility is summarized from scalar status flags, never treated as proof from a user capability description.
      if (string(record.model.compatibility)) selected.compatibility = record.model.compatibility
      else if (object(record.model.compatibility)) selected.compatibility = Object.entries(record.model.compatibility).filter(([key]) => ['input', 'tools', 'outputLimit'].includes(key))
        .filter(([, field]) => string(field) || typeof field === 'boolean').map(([key, field]) => `${key}: ${String(field)}`).join(' · ').slice(0, 2000)
      if (record.model.requestStatus !== undefined) {
        if (record.model.requestStatus !== 'pending' && record.model.requestStatus !== 'observed') return invalid()
        selected.requestStatus = record.model.requestStatus
      }
      if (record.model.actual !== undefined) {
        const actual = record.model.actual
        if (!object(actual) || !string(actual.provider) || !string(actual.model) || actual.stage !== 'native-request'
          || (actual.reasoningEffort !== undefined && !string(actual.reasoningEffort))
          || (actual.maxTokens !== undefined && (!Number.isSafeInteger(actual.maxTokens) || Number(actual.maxTokens) < 1))) return invalid()
        selected.actual = { provider: actual.provider, model: actual.model, stage: 'native-request',
          ...(actual.reasoningEffort === undefined ? {} : { reasoningEffort: actual.reasoningEffort as string }), ...(actual.maxTokens === undefined ? {} : { maxTokens: actual.maxTokens as number }) }
      }
      picked.model = selected
    }
    if (record.usage !== undefined) {
      if (!object(record.usage) || !['requests', 'knownTokens', 'unknownCalls'].every(key => Number.isSafeInteger((record.usage as Record<string, unknown>)[key]) && Number((record.usage as Record<string, unknown>)[key]) >= 0)) return invalid()
      if (record.usage.inFlightRequests !== undefined && (!Number.isSafeInteger(record.usage.inFlightRequests) || Number(record.usage.inFlightRequests) < 0)) return invalid()
      picked.usage = { requests: record.usage.requests as number, knownTokens: record.usage.knownTokens as number, unknownCalls: record.usage.unknownCalls as number, inFlightRequests: Number(record.usage.inFlightRequests ?? 0) }
    }
    return picked
  })
  // Construct only supported fields, including when an RPC sender has extra properties.
  const models = (config.models as Candidate[]).map(model => ({
    id: model.id, name: model.name, enabled: model.enabled, provider: model.provider, model: model.model,
    strengths: model.strengths, suitableFor: model.suitableFor, avoidFor: model.avoidFor,
    isDefault: model.isDefault, maxConcurrent: model.maxConcurrent, allowCrossProvider: model.allowCrossProvider, allowUnverifiedTools: model.allowUnverifiedTools,
    ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }), ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    ...(model.costNote === undefined ? {} : { costNote: model.costNote }), ...(model.costSource === undefined ? {} : { costSource: model.costSource }),
    ...(model.speedNote === undefined ? {} : { speedNote: model.speedNote }), ...(model.speedSource === undefined ? {} : { speedSource: model.speedSource }),
  }))
  return { config: { models, explicitModelId: config.explicitModelId as string | undefined, fallback: config.fallback as PoolConfig['fallback'], maxConcurrent: config.maxConcurrent as number, maxRequests: config.maxRequests as number, failureLimit: config.failureLimit as number },
    hostModels: [...new Map((value.hostModels as HostModel[]).map(model => [routeKey(model), model])).values()], editable: value.editable, records, catalogErrors: value.catalogErrors as string[] | undefined ?? [] }
}

function positive(value: string | number, name: string, allowZero = false, maximum = 1000000): number {
  if (typeof value === 'string' && !value.trim()) throw new Error(`${name}不能为空`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1) || parsed > maximum) throw new Error(`${name}须为${allowZero ? '非负' : '正'}整数，最多 ${maximum}`)
  return parsed
}

/** Serialize an explicit whitelist; the host rechecks authorization, compatibility and live quotas. */
function saveConfig(draft: PoolConfig, hostModels: HostModel[]): PoolConfig {
  const ids = new Set<string>(), routes = new Set(hostModels.map(routeKey))
  const models = draft.models.map(model => {
    const id = model.id.trim(), name = model.name.trim()
    if (!id || !name || ids.has(id)) throw new Error('配置 ID 和名称不能为空，ID 不能重复')
    ids.add(id)
    // Disabled stale entries can remain editable even after their host route was removed.
    if (model.enabled && !routes.has(routeKey(model))) throw new Error(`候选 ${name} 的模型不在已配置宿主目录，请重新选择或禁用`)
    const maxConcurrent = positive(model.maxConcurrent, '候选并发上限', false, 32)
    const effort = model.reasoningEffort?.trim()
    const maxTokens = model.maxTokens === undefined || model.maxTokens === '' ? undefined : positive(model.maxTokens, '输出上限')
    for (const kind of ['cost', 'speed'] as const) if (model[`${kind}Source`] === 'measured' && !model[`${kind}Note`]?.trim()) throw new Error('实测成本或速度必须填写测试来源说明')
    return { id, name, enabled: model.enabled, provider: model.provider, model: model.model,
      strengths: model.strengths, suitableFor: model.suitableFor, avoidFor: model.avoidFor, isDefault: model.isDefault,
      maxConcurrent, allowCrossProvider: model.allowCrossProvider, allowUnverifiedTools: model.allowUnverifiedTools,
      ...(effort ? { reasoningEffort: effort } : {}), ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(model.costNote?.trim() ? { costNote: model.costNote.trim(), costSource: model.costSource ?? 'user' } : {}),
      ...(model.speedNote?.trim() ? { speedNote: model.speedNote.trim(), speedSource: model.speedSource ?? 'user' } : {}),
    }
  })
  if (models.filter(model => model.isDefault).length > 1) throw new Error('只能标记一个默认候选')
  if (draft.explicitModelId && !models.some(model => model.id === draft.explicitModelId && model.enabled)) throw new Error('用户固定候选必须存在并已启用')
  return { models, ...(draft.explicitModelId ? { explicitModelId: draft.explicitModelId } : {}), fallback: draft.fallback,
    maxConcurrent: positive(draft.maxConcurrent, '模型池并发上限', false, 32), maxRequests: positive(draft.maxRequests, '请求预算', true), failureLimit: positive(draft.failureLimit, '重复失败上限', false, 100) }
}

/** Open on demand; no polling and no model or credential operations occur in this editor. */
export function ModelPoolPanel({ sessionId, rpc, onClose, anchor, viewport }: Props): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<PoolSnapshot | null>(null)
  const [draft, setDraft] = React.useState<PoolConfig | null>(null)
  const [pending, setPending] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)
  const scopeRef = React.useRef<Scope>({ sessionId, rpc, disposed: false, busy: false })
  if (scopeRef.current.sessionId !== sessionId || scopeRef.current.rpc !== rpc) {
    scopeRef.current.disposed = true
    scopeRef.current = { sessionId, rpc, disposed: false, busy: false }
  }
  React.useEffect(() => {
    const scope = scopeRef.current; scope.disposed = false
    setSnapshot(null); setDraft(null); setPending(true); setError(null); setSaved(false)
    void rpc.call(channel, 'get', { sessionId }).then(raw => {
      if (scopeRef.current !== scope || scope.disposed) return
      const result = readSnapshot(raw); setSnapshot(result); setDraft(result.config)
    }).catch(cause => { if (scopeRef.current === scope && !scope.disposed) setError(errorMessage(cause)) })
      .finally(() => { if (scopeRef.current === scope && !scope.disposed) setPending(false) })
    return () => { scope.disposed = true }
  }, [sessionId, rpc])
  const editable = snapshot?.editable === true && !pending
  const update = (patch: Partial<PoolConfig>): void => { if (!editable) return; setDraft(previous => previous ? { ...previous, ...patch } : previous); setSaved(false) }
  const updateModel = (index: number, patch: Partial<Candidate>): void => {
    if (!draft) return
    update({ models: draft.models.map((model, position) => ({ ...model, ...(patch.isDefault ? { isDefault: position === index } : {}), ...(position === index ? patch : {}) })) })
  }
  const add = (): void => {
    const route = snapshot?.hostModels[0]
    if (!draft || !route || !editable) return
    let counter = draft.models.length + 1
    while (draft.models.some(model => model.id === `model-${counter}`)) counter++
    update({ models: [...draft.models, { id: `model-${counter}`, name: route.name, enabled: true, provider: route.provider, model: route.model,
      strengths: '', suitableFor: '', avoidFor: '', isDefault: draft.models.length === 0, maxConcurrent: 1, allowCrossProvider: false, allowUnverifiedTools: false }] })
  }
  const save = async (): Promise<void> => {
    const scope = scopeRef.current
    if (!draft || !snapshot || !editable || scope.disposed || scope.busy) return
    try {
      const config = saveConfig(draft, snapshot.hostModels)
      scope.busy = true; setPending(true); setError(null); setSaved(false)
      const result = readSnapshot(await rpc.call(channel, 'save', { sessionId, config }))
      if (scopeRef.current !== scope || scope.disposed) return
      setSnapshot(result); setDraft(result.config); setSaved(true)
    } catch (cause) { if (scopeRef.current === scope && !scope.disposed) setError(errorMessage(cause)) }
    finally { scope.busy = false; if (scopeRef.current === scope && !scope.disposed) setPending(false) }
  }
  const h = React.createElement
  const field = (label: string, name: string, value: string | number | undefined, change: (next: string) => void, options: { type?: string; multiline?: boolean; hint?: string } = {}): React.ReactElement => h('label', { className: 'dsh-pool-field', key: name },
    h('span', null, label), h(options.multiline ? 'textarea' : 'input', { 'data-field': name, value: value ?? '', type: options.type ?? 'text', rows: options.multiline ? 2 : undefined, disabled: !editable,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { change(event.target.value) } }), options.hint ? h('small', null, options.hint) : null)
  const checkbox = (label: string, name: string, checked: boolean, change: (next: boolean) => void): React.ReactElement => h('label', { className: 'dsh-pool-check', key: name },
    h('input', { type: 'checkbox', 'data-field': name, checked, disabled: !editable, onChange: (event: React.ChangeEvent<HTMLInputElement>) => { change(event.target.checked) } }), h('span', null, label))
  const select = (label: string, name: string, selected: string, options: { value: string; label: string; disabled?: boolean }[], change: (next: string) => void): React.ReactElement => h('label', { className: 'dsh-pool-field', key: name },
    h('span', null, label), h('select', { 'data-field': name, value: selected, disabled: !editable, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { change(event.target.value) } },
      ...options.map(option => h('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label))))
  const width = viewport ? Math.min(680, Math.max(0, viewport.width - 32)) : undefined
  const above = anchor ? Math.max(0, anchor.top - 12) : undefined
  const below = anchor && viewport ? Math.max(0, viewport.height - anchor.bottom - 12) : undefined
  const style: React.CSSProperties | undefined = anchor && viewport && width !== undefined && above !== undefined && below !== undefined
    ? { width, left: Math.max(16, Math.min(anchor.right - width, viewport.width - width - 16)) - anchor.left, right: 'auto',
      ...(below > above ? { top: 'calc(100% + 8px)', bottom: 'auto', maxHeight: Math.max(40, below) } : { maxHeight: Math.max(40, above) }) } : undefined
  return h('section', { className: 'dsh-pool-panel', role: 'dialog', 'aria-label': '普通协作模型池', 'aria-busy': pending,
    style,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose() } } },
  h('style', null, POOL_CSS),
  h('div', { className: 'dsh-pool-heading' }, h('strong', null, '普通协作模型池'), h('button', { type: 'button', onClick: onClose, 'aria-label': '关闭模型池' }, '关闭')),
  h('p', { className: 'dsh-pool-note' }, '仅影响后续新建子代理；运行中的实例保持模型快照。主 Agent、Ultra worker 和 decision 的模型保持原配置。'),
  h('p', { className: 'dsh-pool-note' }, '擅长与场景由用户声明；技术兼容性由宿主校验。未知不表示支持；此界面不保存密钥、不新增 provider。'),
  error ? h('div', { role: 'alert', className: 'dsh-pool-error' }, error) : null,
  ...(snapshot?.catalogErrors ?? []).map((message, index) => h('div', { key: index, role: 'status', className: 'dsh-pool-note' }, message)),
  pending && !snapshot ? h('div', { role: 'status' }, '正在读取模型池…') : null,
  snapshot && !snapshot.editable ? h('div', { role: 'status' }, '当前配置只读，不可编辑；需要宿主配置持久化权限。') : null,
  draft && snapshot ? h('div', null,
    h('div', { className: 'dsh-pool-grid' },
      select('用户固定候选（优先于自主选择）', 'explicitModelId', draft.explicitModelId ?? '', [{ value: '', label: '自动：由主 Agent 按任务选择' }, ...draft.models.map(model => ({ value: model.id, label: `${model.name} · ${model.id}${model.enabled ? '' : '（已禁用）'}`, disabled: !model.enabled }))], explicitModelId => { update({ explicitModelId }) }),
      select('失败回退策略', 'fallback', draft.fallback, [{ value: 'error', label: '报错：不换模型（默认）' }, { value: 'default', label: '允许回退到默认候选' }, { value: 'inherit', label: '允许回退到父 Agent 模型' }], fallback => { update({ fallback: fallback as PoolConfig['fallback'] }) }),
      field('模型池并发上限', 'maxConcurrent', draft.maxConcurrent, maxConcurrent => { update({ maxConcurrent }) }, { type: 'number' }),
      field('请求预算', 'maxRequests', draft.maxRequests, maxRequests => { update({ maxRequests }) }, { type: 'number', hint: '0：继承既有宿主/任务限制，不代表无限授权。' }),
      field('重复失败退出上限', 'failureLimit', draft.failureLimit, failureLimit => { update({ failureLimit }) }, { type: 'number' })),
    h('p', { className: 'dsh-pool-note' }, '优先级：用户固定候选 → 主 Agent 选择 → 默认候选 → 原有继承。回退仅按上方明确授权执行，选模不会扩大工具、审批或嵌套权限。'),
    ...draft.models.map((model, index) => {
      const name = (field: string): string => `models.${index}.${field}`
      const key = routeKey(model)
      const routes = snapshot.hostModels.map(route => ({ value: routeKey(route), label: `${route.name} · ${route.provider} / ${route.model}` }))
      if (!routes.some(route => route.value === key)) routes.unshift({ value: key, label: `宿主目录中不可用：${model.provider} / ${model.model}` })
      return h('fieldset', { key: index, className: 'dsh-pool-candidate', disabled: !editable },
        h('legend', null, `候选 ${index + 1}`), h('div', { className: 'dsh-pool-grid' },
          field('稳定配置 ID', name('id'), model.id, id => { updateModel(index, { id }) }),
          field('显示名称', name('name'), model.name, name => { updateModel(index, { name }) }),
          select('已配置宿主模型', name('route'), key, routes, selected => {
            try { const route: unknown = JSON.parse(selected); if (Array.isArray(route) && route.length === 2 && route.every(item => typeof item === 'string')) updateModel(index, { provider: route[0], model: route[1] }) }
            catch { setError('请选择已配置宿主模型') }
          }),
          field('候选并发上限', name('maxConcurrent'), model.maxConcurrent, maxConcurrent => { updateModel(index, { maxConcurrent }) }, { type: 'number' }),
          field('擅长能力（用户声明）', name('strengths'), model.strengths, strengths => { updateModel(index, { strengths }) }, { multiline: true }),
          field('适用场景（用户声明）', name('suitableFor'), model.suitableFor, suitableFor => { updateModel(index, { suitableFor }) }, { multiline: true }),
          field('不适用场景（用户声明）', name('avoidFor'), model.avoidFor, avoidFor => { updateModel(index, { avoidFor }) }, { multiline: true }),
          field('思考强度（可选）', name('reasoningEffort'), model.reasoningEffort, reasoningEffort => { updateModel(index, { reasoningEffort }) }, { hint: '留空使用目标模型默认；填写值须由宿主确认支持。' }),
          field('输出 token 上限（可选）', name('maxTokens'), model.maxTokens, maxTokens => { updateModel(index, { maxTokens }) }, { type: 'number', hint: '留空使用目标模型默认；不开放其他未支持参数。' })),
        checkbox('启用此候选', name('enabled'), model.enabled, enabled => { updateModel(index, { enabled }) }),
        checkbox('设为默认候选', name('isDefault'), model.isDefault, isDefault => { updateModel(index, { isDefault }) }),
        checkbox('允许向此候选发送跨 provider 的子任务数据', name('allowCrossProvider'), model.allowCrossProvider, allowCrossProvider => { updateModel(index, { allowCrossProvider }) }),
        checkbox('用户允许使用工具兼容性尚未验证的候选（仍标记未验证）', name('allowUnverifiedTools'), model.allowUnverifiedTools, allowUnverifiedTools => { updateModel(index, { allowUnverifiedTools }) }),
        h('div', { className: 'dsh-pool-grid' }, ...(['cost', 'speed'] as const).flatMap(kind => [
          field(kind === 'cost' ? '成本说明 / 测试来源' : '速度说明 / 测试来源', name(`${kind}Note`), model[`${kind}Note`], note => { updateModel(index, { [`${kind}Note`]: note }) }, { multiline: true }),
          select(kind === 'cost' ? '成本说明来源' : '速度说明来源', name(`${kind}Source`), model[`${kind}Source`] ?? 'user', [{ value: 'user', label: '用户填写（非实测）' }, { value: 'measured', label: '实测（须注明测试来源）' }], source => { updateModel(index, { [`${kind}Source`]: source }) }),
        ])),
        h('button', { type: 'button', disabled: !editable, onClick: () => { update({ models: draft.models.filter((_item, position) => position !== index), ...(draft.explicitModelId === model.id ? { explicitModelId: undefined } : {}) }) } }, `移除候选 ${index + 1}`))
    }),
    !draft.models.length ? h('p', { className: 'dsh-pool-note' }, '未配置候选：保留普通协作的原有模型继承行为。') : null,
    h('div', { className: 'dsh-pool-actions' }, h('button', { type: 'button', disabled: !editable || snapshot.hostModels.length === 0 || draft.models.length >= 32, onClick: add }, '添加候选模型'),
      h('button', { type: 'button', disabled: !editable, onClick: () => { void save() } }, '保存配置')),
    snapshot.hostModels.length === 0 ? h('p', { role: 'status' }, snapshot.catalogErrors.length ? '宿主目录暂不可用；关闭后重新打开可重试读取。' : '暂无可用宿主模型，请先在 DSH 模型设置中配置。') : null,
    saved ? h('div', { role: 'status' }, '已保存；仅影响后续新建子代理。') : null,
    h('details', { className: 'dsh-pool-records', open: true }, h('summary', null, `普通协作子代理记录（${snapshot.records.length}）`),
      ...snapshot.records.map(record => h('article', { key: record.id }, h('strong', null, `${record.taskName} · ${record.status}`), h('div', null, record.id),
        record.error ? h('div', { role: 'status', className: 'dsh-pool-error' }, record.error) : null,
        record.recordingError ? h('div', { role: 'alert', className: 'dsh-pool-error' }, record.recordingError) : null,
        record.model ? h('div', null,
          h('div', null, `请求候选：${record.model.requestedConfigId ?? '继承'}；生效候选：${record.model.selectedConfigId ?? '继承'}；来源：${record.model.source ?? '未知'}`),
          h('div', null, `解析模型：${record.model.provider ?? '待解析'} / ${record.model.model ?? '待解析'}${record.model.reasoningEffort ? `；思考强度 ${record.model.reasoningEffort}` : ''}${record.model.maxTokens ? `；输出上限 ${record.model.maxTokens}` : ''}`),
          h('div', null, record.model.requestStatus === 'observed' && record.model.actual
            ? `实际请求：${record.model.actual.provider} / ${record.model.actual.model}${record.model.actual.reasoningEffort ? `；思考强度 ${record.model.actual.reasoningEffort}` : ''}${record.model.actual.maxTokens ? `；输出上限 ${record.model.actual.maxTokens}` : ''}（原生组装已观察，不代表供应商已执行）`
            : '实际请求：尚未观察到（解析或创建成功不代表供应商已执行）'),
          record.model.reason ? h('div', null, `选择理由：${record.model.reason}`) : null,
          record.model.compatibility ? h('div', null, `兼容性：${String(record.model.compatibility)}`) : null,
          record.model.fallbackReason ? h('div', null, `回退原因：${record.model.fallbackReason}`) : null) : null,
        record.usage ? h('div', null, `已记录请求 ${record.usage.requests} 次；已报告 ${record.usage.knownTokens} tokens；用量未知 ${record.usage.unknownCalls} 次；尚未结算 ${record.usage.inFlightRequests ?? 0} 次（不将估算计为实测）`) : h('div', null, '消耗数据暂不可用'))))) : null)
}

const POOL_CSS = [
  '.dsh-pool-panel{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;box-sizing:border-box;width:min(680px,calc(100vw - 32px));max-height:min(76vh,760px);overflow:auto;padding:16px;border:1px solid var(--dsw-alias-border-l1,#a0a0a044);border-radius:12px;background:var(--ultra-surface,#fff);color:var(--ultra-ink,#20242c);box-shadow:0 8px 32px #0003;font-family:inherit;font-size:13px;line-height:1.5;overflow-wrap:anywhere}',
  '.dsh-pool-heading,.dsh-pool-actions{display:flex;justify-content:space-between;align-items:center;gap:12px}.dsh-pool-heading strong{font-size:15px}.dsh-pool-note{font-size:12px;color:var(--dsw-alias-label-secondary,#686c75)}',
  '.dsh-pool-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}.dsh-pool-field{display:flex;flex-direction:column;gap:4px;min-width:0}.dsh-pool-field small{font-size:11px;opacity:.8}',
  '.dsh-pool-panel input:not([type=checkbox]),.dsh-pool-panel select,.dsh-pool-panel textarea{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l1,#9996);border-radius:6px;padding:6px;background:var(--ultra-surface,#fff);color:inherit;font:inherit}.dsh-pool-panel textarea{resize:vertical}',
  '.dsh-pool-panel button{border:1px solid var(--dsw-alias-border-l1,#9996);border-radius:6px;padding:5px 9px;background:var(--ultra-surface,#fff);color:inherit;font:inherit;cursor:pointer}.dsh-pool-panel button:disabled{opacity:.55;cursor:default}.dsh-pool-panel :focus-visible{outline:2px solid var(--ultra-accent,#5069cb);outline-offset:2px}',
  '.dsh-pool-candidate{margin:16px 0;padding:12px;border:1px solid var(--dsw-alias-border-l1,#9996);border-radius:8px;min-width:0}.dsh-pool-check{display:flex;align-items:flex-start;gap:7px;margin:9px 0;font-size:12px}.dsh-pool-check input{margin:3px 0 0;flex:none}.dsh-pool-error{padding:9px;background:#d44a;color:var(--ultra-danger,#b22);border-radius:6px;margin:8px 0}',
  '.dsh-pool-records{margin-top:16px;font-size:12px}.dsh-pool-records article{padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#9996)}@media(max-width:520px){.dsh-pool-grid{grid-template-columns:minmax(0,1fr)}.dsh-pool-panel{padding:12px}}',
].join('')
