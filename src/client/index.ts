/** Session-scoped Ultra button: main-agent assistance or 2–5 routes, with one decision route. */
import React from 'react'

interface HostRpc {
  call(channel: string, endpoint: string, payload?: unknown): Promise<unknown>
}

type Translate = (key: string, params?: Record<string, unknown>) => string

interface UltraProps {
  sessionId?: string
  t: Translate
}

interface SessionListSnapshot {
  ids: readonly string[]
  byId: Readonly<Record<string, unknown>>
  [field: string]: unknown
}

interface SessionListStore {
  getSnapshot(): SessionListSnapshot
  subscribe(listener: () => void): () => void
}

interface ClientContext {
  sessions: { list: SessionListStore }
  slots: {
    inject(name: string, callback: () => (() => void)): () => void
    register(
      options: {
        name: string
        id: string
        order: number
        label: string
        locale: string
        inject(sessionId: string): { sessionId: string }
      },
      component: (props: UltraProps) => React.ReactElement,
    ): () => void
  }
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  }
  get(name: string): unknown
  effect(callback: () => (() => void), label?: string): () => void
}

interface UltraStateSnapshot {
  enabled: boolean
  concurrency: 1 | 2 | 3 | 4 | 5
  running: boolean
  activeRuns: number
  lastRun: { at: number; ms: number } | null
  phase?: string
  error?: string | null
}

interface ButtonState {
  sessionId: string | undefined
  snapshot: UltraStateSnapshot | null
  pending: boolean
  syncError: string | null
  actionError: string | null
}

interface SessionScope {
  sessionId: string | undefined
  rpc: HostRpc
  disposed: boolean
  reading: boolean
  mutating: boolean
  revision: number
}

const RPC_CHANNEL = '/dsh-ultra-mode'
const LOCALE_NAMESPACE = 'dsh-ultra-mode'
const LEVELS = [0, 1, 2, 3, 4, 5] as const
const ROUTE_SESSION_PREFIX = 'ultra-route-'

/** Hide internal durable route records from the installed DSH 0.2 session list. */
function hideRouteSessions(list: SessionListStore): () => void {
  const original = list.getSnapshot
  const descriptor = Object.getOwnPropertyDescriptor(list, 'getSnapshot')
  const unsupported = (): never => {
    throw new Error('dsh-ultra-mode: DSH 0.2 compatibility requires a writable sessions.list.getSnapshot')
  }
  if (descriptor !== undefined && (!('value' in descriptor) || descriptor.writable !== true)) return unsupported()
  const cache = new WeakMap<SessionListSnapshot, SessionListSnapshot>()
  let active = true
  const filtered = (): SessionListSnapshot => {
    const source = original.call(list)
    // A later plugin may retain this function; unload stops filtering without rewriting its wrapper.
    if (!active) return source
    const previous = cache.get(source)
    if (previous !== undefined) return previous
    const hidden = (id: string): boolean => id.startsWith(ROUTE_SESSION_PREFIX)
    const ids = source.ids.filter(id => !hidden(id))
    const entries = Object.entries(source.byId).filter(([id]) => !hidden(id))
    const result = ids.length === source.ids.length && entries.length === Object.keys(source.byId).length
      ? source
      : { ...source, ids, byId: Object.fromEntries(entries) }
    cache.set(source, result)
    return result
  }
  try {
    Object.defineProperty(list, 'getSnapshot', descriptor === undefined
      ? { value: filtered, writable: true, configurable: true, enumerable: true }
      : { ...descriptor, value: filtered })
  } catch (cause) {
    throw new Error('dsh-ultra-mode: cannot install the DSH 0.2 session-list compatibility filter', { cause })
  }
  return () => {
    active = false
    if (list.getSnapshot !== filtered) return
    if (descriptor === undefined) Reflect.deleteProperty(list, 'getSnapshot')
    else Object.defineProperty(list, 'getSnapshot', descriptor)
  }
}

const zh = {
  'trigger.off': '关',
  'trigger.assisted': 'Agent + 决策',
  'trigger.routes': '{count} 路',
  'trigger.loading': '载入中',
  'trigger.saving': '保存中',
  'trigger.error': '出错',
  'trigger.unavailable': '请先选择会话',
  'trigger.title': 'Ultra：{count} 路并发执行 + 1 路独立决策；默认 max 思考',
  'trigger.assistedTitle': 'Ultra：正常主 Agent 执行 + 1 路 Max 自动决策辅助',
  'menu.title': 'Ultra 模式',
  'menu.description': '主 Agent 决策辅助或多路并发',
  'menu.off': '关闭 Ultra',
  'menu.offDetail': '使用当前会话的普通模式',
  'menu.assisted': 'Agent + 决策',
  'menu.assistedDetail': '正常主 Agent 执行 · 另 1 路 Max 决策',
  'menu.routes': '{count} 路并发',
  'menu.routesDetail': '另加 1 路决策 · 默认 max 思考',
  'menu.runningHint': '当前执行保持原配置；更改用于后续任务。',
  'status.ready': '已就绪',
  'status.disabled': 'Ultra 已关闭',
  'status.running': '执行中',
  'status.deciding': '决策中',
  'status.coordinating': '跨路协调中',
  'status.completed': '已完成',
  'status.failed': '执行失败',
  'status.cancelled': '已取消',
  'status.runs': '{phase} · {count} 个任务',
  'status.lastRun': '上次运行 {seconds} 秒',
  'error.invalidResponse': '服务端返回了无效的 Ultra 状态',
  'error.connection': '无法连接 Ultra 服务',
  'error.retry': '重试',
}

const en: Record<keyof typeof zh, string> = {
  'trigger.off': 'Off',
  'trigger.assisted': 'Agent + decision',
  'trigger.routes': '{count} routes',
  'trigger.loading': 'Loading',
  'trigger.saving': 'Saving',
  'trigger.error': 'Error',
  'trigger.unavailable': 'Select a session first',
  'trigger.title': 'Ultra: {count} execution routes + 1 independent decision route; max reasoning by default',
  'trigger.assistedTitle': 'Ultra: normal main Agent execution + 1 automatic Max decision assistant',
  'menu.title': 'Ultra mode',
  'menu.description': 'Main Agent decision assistance or parallel execution',
  'menu.off': 'Turn Ultra off',
  'menu.offDetail': 'Use this session’s ordinary mode',
  'menu.assisted': 'Agent + decision',
  'menu.assistedDetail': 'Normal main Agent execution · plus 1 Max decision route',
  'menu.routes': '{count} parallel routes',
  'menu.routesDetail': 'Plus 1 decision route · max reasoning by default',
  'menu.runningHint': 'The active task keeps its configuration. Changes apply to subsequent tasks.',
  'status.ready': 'Ready',
  'status.disabled': 'Ultra is off',
  'status.running': 'Running',
  'status.deciding': 'Deciding',
  'status.coordinating': 'Coordinating routes',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'status.runs': '{phase} · {count} tasks',
  'status.lastRun': 'Last run: {seconds} s',
  'error.invalidResponse': 'The server returned an invalid Ultra state',
  'error.connection': 'Unable to connect to Ultra',
  'error.retry': 'Retry',
}

const ULTRA_CSS = [
  '.dsh-ultra{position:relative;min-width:0;font-family:inherit;--ultra-surface:rgb(from var(--dsw-specific-menu,#fff) r g b / 1);--ultra-ink:rgb(from var(--dsw-alias-label-primary,#20242c) r g b / 1);--ultra-accent:rgb(from var(--dsw-alias-state-info-label,#5069cb) r g b / 1);--ultra-danger:rgb(from var(--dsw-alias-state-error-primary,#d84c4c) r g b / 1);--ultra-hover:color-mix(in srgb,var(--ultra-surface) 92%,var(--ultra-ink) 8%)}',
  '.dsh-ultra-trigger{display:flex;align-items:center;gap:5px;height:28px;padding:0 7px;border:0;border-radius:24px;background:var(--ultra-surface,#fff);color:var(--dsw-alias-label-secondary,#686c75);font-family:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}',
  '.dsh-ultra-trigger:hover:not(:disabled){background:var(--ultra-hover,#edf0f5)}',
  '.dsh-ultra-trigger:focus-visible{outline:2px solid var(--dsw-alias-border-l3,#7a9be0);outline-offset:2px}',
  '.dsh-ultra-trigger:disabled{color:var(--dsw-alias-label-dimmed,#9599a1);cursor:default}',
  '.dsh-ultra[data-enabled=true] .dsh-ultra-trigger{color:var(--dsw-alias-state-info-label,#5069cb);background:color-mix(in srgb,var(--ultra-surface) 90%,var(--ultra-accent) 10%)}',
  '.dsh-ultra-icon{flex:none;width:14px;height:14px}',
  '.dsh-ultra-value,.dsh-ultra-chevron{color:var(--dsw-alias-label-caption,#858994)}',
  '.dsh-ultra-chevron{width:10px;height:10px;transition:transform 120ms ease}',
  '.dsh-ultra-trigger[aria-expanded=true] .dsh-ultra-chevron{transform:rotate(180deg)}',
  '.dsh-ultra-status{font-size:11px;line-height:16px;color:var(--dsw-alias-state-info-label,#5069cb)}',
  '.dsh-ultra-dot{display:inline-block;width:5px;height:5px;margin-right:4px;border-radius:50%;background:currentColor;animation:dsh-ultra-pulse 1.5s ease-in-out infinite}',
  '.dsh-ultra[data-error=true] .dsh-ultra-status{color:var(--dsw-alias-state-error-primary,#d84c4c)}',
  '.dsh-ultra-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:30;box-sizing:border-box;width:260px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-inverted,rgba(127,127,127,.16));border-radius:12px;background:var(--ultra-surface,#fff);box-shadow:var(--dsw-shadow-lv3,0 8px 30px rgba(0,0,0,.16));color:var(--dsw-alias-label-primary,#20242c)}',
  '.dsh-ultra-heading{padding:8px 8px 6px;font-size:13px;font-weight:600;line-height:20px}',
  '.dsh-ultra-description,.dsh-ultra-detail,.dsh-ultra-footer{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#828691);font-weight:400}',
  '.dsh-ultra-option{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:43px;padding:7px 8px;border:0;border-radius:9px;background:var(--ultra-surface,#fff);color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dsh-ultra-option:hover:not(:disabled),.dsh-ultra-option:focus-visible{outline:none;background:var(--ultra-hover,#edf0f5)}',
  '.dsh-ultra-option:disabled{opacity:1;color:var(--dsw-alias-label-dimmed,#9599a1);cursor:default}',
  '.dsh-ultra-option-label{display:block;font-size:13px;line-height:20px;font-weight:500}',
  '.dsh-ultra-detail{display:block}',
  '.dsh-ultra-check{flex:none;width:14px;height:14px;color:var(--dsw-alias-state-info-label,#5069cb)}',
  '.dsh-ultra-footer{margin:4px 4px 0;padding:7px 4px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.15))}',
  '.dsh-ultra-error{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:7px 8px;margin:4px;border-radius:8px;background:color-mix(in srgb,var(--ultra-surface) 91%,var(--ultra-danger) 9%);color:var(--dsw-alias-state-error-primary,#d84c4c);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
  '.dsh-ultra-retry{flex:none;padding:0;border:0;background:inherit;color:inherit;font:inherit;font-weight:600;cursor:pointer}',
  '@keyframes dsh-ultra-pulse{0%,100%{opacity:.45}50%{opacity:1}}',
  '@media(prefers-reduced-motion:reduce){.dsh-ultra-dot{animation:none}.dsh-ultra-chevron{transition:none}}',
].join('')

/** Validate the custom RPC channel's untrusted envelope and state fields. */
function readSnapshot(raw: unknown, t: Translate): UltraStateSnapshot {
  const invalid = (): never => { throw new Error(t('error.invalidResponse')) }
  if (typeof raw !== 'object' || raw === null) return invalid()
  const result = raw as { ok?: unknown; value?: unknown; error?: { message?: unknown } }
  if (result.ok !== true) {
    throw new Error(typeof result.error?.message === 'string' ? result.error.message : t('error.invalidResponse'))
  }
  if (typeof result.value !== 'object' || result.value === null) return invalid()
  const value = result.value as Partial<UltraStateSnapshot>
  if (
    typeof value.enabled !== 'boolean'
    || (value.concurrency !== 1 && value.concurrency !== 2 && value.concurrency !== 3 && value.concurrency !== 4 && value.concurrency !== 5)
    || typeof value.running !== 'boolean'
    || !Number.isInteger(value.activeRuns) || (value.activeRuns ?? -1) < 0
    || (value.lastRun !== null && (
      typeof value.lastRun !== 'object' || value.lastRun === undefined
      || !Number.isFinite(value.lastRun.at) || !Number.isFinite(value.lastRun.ms)
      || value.lastRun.ms < 0
    ))
    || (value.phase !== undefined && typeof value.phase !== 'string')
    || (value.error !== undefined && value.error !== null && typeof value.error !== 'string')
  ) return invalid()
  return value as UltraStateSnapshot
}

function phaseLabel(snapshot: UltraStateSnapshot, t: Translate): string {
  if (snapshot.phase === 'coordinating') return t('status.coordinating')
  if (snapshot.phase === 'deciding' || snapshot.phase === 'decision' || snapshot.phase === 'merging') return t('status.deciding')
  if (snapshot.running) return t('status.running')
  if (snapshot.phase === 'failed' || snapshot.error) return t('status.failed')
  if (snapshot.phase === 'cancelled' || snapshot.phase === 'aborted') return t('status.cancelled')
  if (snapshot.phase === 'completed') return t('status.completed')
  return t(snapshot.enabled ? 'status.ready' : 'status.disabled')
}

function UltraButton({ sessionId, rpc, t }: UltraProps & { rpc: HostRpc }): React.ReactElement {
  const [view, setView] = React.useState<ButtonState>({ sessionId, snapshot: null, pending: false, syncError: null, actionError: null })
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const optionRefs = React.useRef<(HTMLButtonElement | null)[]>([])
  const retryRef = React.useRef<(() => Promise<void>) | null>(null)
  const scopeRef = React.useRef<SessionScope>({ sessionId, rpc, disposed: false, reading: false, mutating: false, revision: 0 })
  const menuId = React.useId()
  const available = typeof sessionId === 'string' && sessionId.trim() !== ''
  // Invalidate before effects: an old RPC can settle between this render and cleanup.
  if (scopeRef.current.sessionId !== sessionId || scopeRef.current.rpc !== rpc) {
    scopeRef.current.disposed = true
    scopeRef.current = { sessionId, rpc, disposed: false, reading: false, mutating: false, revision: 0 }
  }
  const current = view.sessionId === sessionId ? view : { sessionId, snapshot: null, pending: false, syncError: null, actionError: null }
  const snapshot = current.snapshot
  const error = current.actionError ?? current.syncError ?? snapshot?.error ?? null

  React.useEffect(() => {
    const scope = scopeRef.current
    scope.disposed = false
    setOpen(false)
    setView({ sessionId, snapshot: null, pending: false, syncError: null, actionError: null })
    if (!available) return () => { scope.disposed = true }
    const sync = async (): Promise<void> => {
      if (scope.disposed || scope.reading || scope.mutating) return
      scope.reading = true
      const revision = scope.revision
      try {
        const state = readSnapshot(await rpc.call(RPC_CHANNEL, 'get', { sessionId }), t)
        if (scopeRef.current !== scope || scope.disposed || scope.revision !== revision || scope.mutating) return
        setView(previous => ({ ...previous, sessionId, snapshot: state, syncError: null }))
      } catch (cause) {
        if (scopeRef.current !== scope || scope.disposed || scope.revision !== revision || scope.mutating) return
        setView(previous => ({ ...previous, syncError: cause instanceof Error ? cause.message : t('error.connection') }))
      } finally {
        scope.reading = false
      }
    }
    retryRef.current = sync
    void sync()
    const timer = window.setInterval(() => { void sync() }, 800)
    return () => {
      scope.disposed = true
      window.clearInterval(timer)
      if (scopeRef.current === scope) retryRef.current = null
    }
  }, [rpc, sessionId, available, t])

  React.useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const choose = async (level: typeof LEVELS[number]): Promise<void> => {
    const scope = scopeRef.current
    if (!available || snapshot === null || scope.mutating || scope.disposed) return
    if (snapshot.enabled === (level !== 0) && (level === 0 || snapshot.concurrency === level)) {
      close(true)
      return
    }
    scope.mutating = true
    scope.revision += 1
    setView(previous => ({ ...previous, pending: true, actionError: null }))
    try {
      const saved = readSnapshot(await rpc.call(RPC_CHANNEL, 'set', {
        sessionId,
        enabled: level !== 0,
        concurrency: level === 0 ? snapshot.concurrency : level,
      }), t)
      if (scopeRef.current !== scope || scope.disposed) return
      setView(previous => ({ ...previous, snapshot: saved, pending: false, syncError: null, actionError: null }))
      close(true)
    } catch (cause) {
      if (scopeRef.current !== scope || scope.disposed) return
      setView(previous => ({ ...previous, pending: false, actionError: cause instanceof Error ? cause.message : t('error.connection') }))
    } finally {
      scope.mutating = false
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open) { setOpen(true); return }
      const options = optionRefs.current.filter(option => option !== null && !option.disabled)
      if (options.length === 0) return
      const index = options.findIndex(option => option === document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      options[next]?.focus()
    }
  }

  const valueLabel = current.pending ? t('trigger.saving') : snapshot === null ? t('trigger.loading')
    : snapshot.enabled ? (snapshot.concurrency === 1 ? t('trigger.assisted') : t('trigger.routes', { count: snapshot.concurrency })) : t('trigger.off')
  const status = snapshot === null ? null : phaseLabel(snapshot, t)
  return React.createElement('div', {
    ref: rootRef, className: 'dsh-ultra', 'data-enabled': snapshot?.enabled === true, 'data-error': Boolean(error), onKeyDown,
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
      close()
    },
  },
  React.createElement('button', {
    ref: triggerRef, type: 'button', className: 'dsh-ultra-trigger', disabled: !available,
    'aria-label': t('menu.title'), 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? menuId : undefined,
    title: available ? (snapshot?.concurrency === 1 ? t('trigger.assistedTitle') : t('trigger.title', { count: snapshot?.concurrency ?? 3 })) : t('trigger.unavailable'),
    onClick: () => { setOpen(previous => !previous) },
  },
  React.createElement('svg', { className: 'dsh-ultra-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    React.createElement('path', { d: 'M8 1.5 9.7 6.3 14.5 8 9.7 9.7 8 14.5 6.3 9.7 1.5 8 6.3 6.3Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' })),
  React.createElement('span', null, 'Ultra'),
  React.createElement('span', { className: 'dsh-ultra-value' }, available ? valueLabel : t('trigger.off')),
  (error || snapshot?.running) ? React.createElement('span', { className: 'dsh-ultra-status', role: 'status', 'aria-live': 'polite' },
    snapshot?.running && !error ? React.createElement('span', { className: 'dsh-ultra-dot', 'aria-hidden': true }) : null,
    error ? t('trigger.error') : status) : null,
  React.createElement('svg', { className: 'dsh-ultra-chevron', viewBox: '0 0 10 10', fill: 'none', 'aria-hidden': true },
    React.createElement('path', { d: 'm2 3.5 3 3 3-3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
  !open ? null : React.createElement('div', { className: 'dsh-ultra-menu', id: menuId, role: 'menu', 'aria-label': t('menu.title') },
    React.createElement('div', { className: 'dsh-ultra-heading' }, t('menu.title'),
      React.createElement('div', { className: 'dsh-ultra-description' }, t('menu.description'))),
    ...LEVELS.map((level, index) => {
      const selected = snapshot !== null && (level === 0 ? !snapshot.enabled : snapshot.enabled && snapshot.concurrency === level)
      return React.createElement('button', {
        key: level, ref: (node: HTMLButtonElement | null) => { optionRefs.current[index] = node },
        type: 'button', className: 'dsh-ultra-option', role: 'menuitemradio', 'aria-checked': selected,
        disabled: current.pending || snapshot === null, onClick: () => { void choose(level) },
      },
      React.createElement('span', null,
        React.createElement('span', { className: 'dsh-ultra-option-label' }, t(level === 0 ? 'menu.off' : level === 1 ? 'menu.assisted' : 'menu.routes', { count: level })),
        React.createElement('span', { className: 'dsh-ultra-detail' }, t(level === 0 ? 'menu.offDetail' : level === 1 ? 'menu.assistedDetail' : 'menu.routesDetail'))),
      !selected ? null : React.createElement('svg', { className: 'dsh-ultra-check', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('path', { d: 'm3 8 3 3 7-7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })))
    }),
    error ? React.createElement('div', { className: 'dsh-ultra-error', role: 'alert' },
      React.createElement('span', null, error),
      current.syncError ? React.createElement('button', {
        type: 'button', className: 'dsh-ultra-retry', onClick: () => { void retryRef.current?.() },
      }, t('error.retry')) : null) : null,
    React.createElement('div', { className: 'dsh-ultra-footer', role: 'status', 'aria-live': 'polite' },
      snapshot === null ? t('trigger.loading') : t('status.runs', { phase: status, count: snapshot.activeRuns }),
      snapshot?.running ? React.createElement('div', null, t('menu.runningHint')) : null,
      snapshot?.lastRun ? React.createElement('div', null, t('status.lastRun', { seconds: (snapshot.lastRun.ms / 1000).toFixed(1) })) : null)))
}

/** Required browser services; the generic RPC remains on the Connection transport. */
export const inject = ['slots', 'connection', 'locale', 'sessions']

/**
 * Register localized composer UI and release its styles, dictionaries and slot on unload.
 * @param ctx - Browser plugin context with session slots, locale and generic Connection RPC.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as { rpc?: HostRpc } | undefined
  const rpc = connection?.rpc
  if (rpc === undefined) throw new Error('dsh-ultra-mode requires connection.rpc')
  ctx.effect(() => hideRouteSessions(ctx.sessions.list), 'dsh-ultra-mode: internal route sessions')
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'dsh-ultra-mode: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-ultra-mode'
    style.textContent = ULTRA_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-ultra-mode: styles')
  ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'dsh-ultra-mode', order: 30, label: 'Ultra', locale: LOCALE_NAMESPACE,
    // Session identity is a registrant-owned face on the installed DSH slot API.
    inject: sessionId => ({ sessionId }),
  }, props => React.createElement(UltraButton, { ...props, key: props.sessionId, rpc }))), 'dsh-ultra-mode: button')
}
