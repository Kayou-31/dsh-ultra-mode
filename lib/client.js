window.__ModuleLoader__.load({ id: "@dsh-external/dsh-ultra-mode", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = __toESM(require("react"), 1);
var RPC_CHANNEL = "/dsh-ultra-mode";
var LOCALE_NAMESPACE = "dsh-ultra-mode";
var LEVELS = [0, 3, 4, 5];
var ROUTE_SESSION_PREFIX = "ultra-route-";
function hideRouteSessions(list) {
  const original = list.getSnapshot;
  const descriptor = Object.getOwnPropertyDescriptor(list, "getSnapshot");
  const unsupported = () => {
    throw new Error("dsh-ultra-mode: DSH 0.2 compatibility requires a writable sessions.list.getSnapshot");
  };
  if (descriptor !== void 0 && (!("value" in descriptor) || descriptor.writable !== true)) return unsupported();
  const cache = /* @__PURE__ */ new WeakMap();
  let active = true;
  const filtered = () => {
    const source = original.call(list);
    if (!active) return source;
    const previous = cache.get(source);
    if (previous !== void 0) return previous;
    const hidden = (id) => id.startsWith(ROUTE_SESSION_PREFIX);
    const ids = source.ids.filter((id) => !hidden(id));
    const entries = Object.entries(source.byId).filter(([id]) => !hidden(id));
    const result = ids.length === source.ids.length && entries.length === Object.keys(source.byId).length ? source : { ...source, ids, byId: Object.fromEntries(entries) };
    cache.set(source, result);
    return result;
  };
  try {
    Object.defineProperty(list, "getSnapshot", descriptor === void 0 ? { value: filtered, writable: true, configurable: true, enumerable: true } : { ...descriptor, value: filtered });
  } catch (cause) {
    throw new Error("dsh-ultra-mode: cannot install the DSH 0.2 session-list compatibility filter", { cause });
  }
  return () => {
    active = false;
    if (list.getSnapshot !== filtered) return;
    if (descriptor === void 0) Reflect.deleteProperty(list, "getSnapshot");
    else Object.defineProperty(list, "getSnapshot", descriptor);
  };
}
var zh = {
  "trigger.off": "关",
  "trigger.routes": "{count} 路",
  "trigger.loading": "载入中",
  "trigger.saving": "保存中",
  "trigger.error": "出错",
  "trigger.unavailable": "请先选择会话",
  "trigger.title": "Ultra：{count} 路并发执行 + 1 路独立决策；默认 max 思考",
  "menu.title": "Ultra 并发模式",
  "menu.description": "高于 Max 的独立模式",
  "menu.off": "关闭 Ultra",
  "menu.offDetail": "使用当前会话的普通模式",
  "menu.routes": "{count} 路并发",
  "menu.routesDetail": "另加 1 路决策 · 默认 max 思考",
  "menu.runningHint": "当前执行保持原配置；更改用于后续任务。",
  "status.ready": "已就绪",
  "status.disabled": "Ultra 已关闭",
  "status.running": "执行中",
  "status.deciding": "决策中",
  "status.coordinating": "跨路协调中",
  "status.completed": "已完成",
  "status.failed": "执行失败",
  "status.cancelled": "已取消",
  "status.runs": "{phase} · {count} 个任务",
  "status.lastRun": "上次运行 {seconds} 秒",
  "error.invalidResponse": "服务端返回了无效的 Ultra 状态",
  "error.connection": "无法连接 Ultra 服务",
  "error.retry": "重试"
};
var en = {
  "trigger.off": "Off",
  "trigger.routes": "{count} routes",
  "trigger.loading": "Loading",
  "trigger.saving": "Saving",
  "trigger.error": "Error",
  "trigger.unavailable": "Select a session first",
  "trigger.title": "Ultra: {count} execution routes + 1 independent decision route; max reasoning by default",
  "menu.title": "Ultra concurrency",
  "menu.description": "Independent mode above Max",
  "menu.off": "Turn Ultra off",
  "menu.offDetail": "Use this session’s ordinary mode",
  "menu.routes": "{count} parallel routes",
  "menu.routesDetail": "Plus 1 decision route · max reasoning by default",
  "menu.runningHint": "The active task keeps its configuration. Changes apply to subsequent tasks.",
  "status.ready": "Ready",
  "status.disabled": "Ultra is off",
  "status.running": "Running",
  "status.deciding": "Deciding",
  "status.coordinating": "Coordinating routes",
  "status.completed": "Completed",
  "status.failed": "Failed",
  "status.cancelled": "Cancelled",
  "status.runs": "{phase} · {count} tasks",
  "status.lastRun": "Last run: {seconds} s",
  "error.invalidResponse": "The server returned an invalid Ultra state",
  "error.connection": "Unable to connect to Ultra",
  "error.retry": "Retry"
};
var ULTRA_CSS = [
  ".dsh-ultra{position:relative;min-width:0;font-family:inherit;--ultra-surface:rgb(from var(--dsw-specific-menu,#fff) r g b / 1);--ultra-ink:rgb(from var(--dsw-alias-label-primary,#20242c) r g b / 1);--ultra-accent:rgb(from var(--dsw-alias-state-info-label,#5069cb) r g b / 1);--ultra-danger:rgb(from var(--dsw-alias-state-error-primary,#d84c4c) r g b / 1);--ultra-hover:color-mix(in srgb,var(--ultra-surface) 92%,var(--ultra-ink) 8%)}",
  ".dsh-ultra-trigger{display:flex;align-items:center;gap:5px;height:28px;padding:0 7px;border:0;border-radius:24px;background:var(--ultra-surface,#fff);color:var(--dsw-alias-label-secondary,#686c75);font-family:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}",
  ".dsh-ultra-trigger:hover:not(:disabled){background:var(--ultra-hover,#edf0f5)}",
  ".dsh-ultra-trigger:focus-visible{outline:2px solid var(--dsw-alias-border-l3,#7a9be0);outline-offset:2px}",
  ".dsh-ultra-trigger:disabled{color:var(--dsw-alias-label-dimmed,#9599a1);cursor:default}",
  ".dsh-ultra[data-enabled=true] .dsh-ultra-trigger{color:var(--dsw-alias-state-info-label,#5069cb);background:color-mix(in srgb,var(--ultra-surface) 90%,var(--ultra-accent) 10%)}",
  ".dsh-ultra-icon{flex:none;width:14px;height:14px}",
  ".dsh-ultra-value,.dsh-ultra-chevron{color:var(--dsw-alias-label-caption,#858994)}",
  ".dsh-ultra-chevron{width:10px;height:10px;transition:transform 120ms ease}",
  ".dsh-ultra-trigger[aria-expanded=true] .dsh-ultra-chevron{transform:rotate(180deg)}",
  ".dsh-ultra-status{font-size:11px;line-height:16px;color:var(--dsw-alias-state-info-label,#5069cb)}",
  ".dsh-ultra-dot{display:inline-block;width:5px;height:5px;margin-right:4px;border-radius:50%;background:currentColor;animation:dsh-ultra-pulse 1.5s ease-in-out infinite}",
  ".dsh-ultra[data-error=true] .dsh-ultra-status{color:var(--dsw-alias-state-error-primary,#d84c4c)}",
  ".dsh-ultra-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:30;box-sizing:border-box;width:260px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-inverted,rgba(127,127,127,.16));border-radius:12px;background:var(--ultra-surface,#fff);box-shadow:var(--dsw-shadow-lv3,0 8px 30px rgba(0,0,0,.16));color:var(--dsw-alias-label-primary,#20242c)}",
  ".dsh-ultra-heading{padding:8px 8px 6px;font-size:13px;font-weight:600;line-height:20px}",
  ".dsh-ultra-description,.dsh-ultra-detail,.dsh-ultra-footer{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#828691);font-weight:400}",
  ".dsh-ultra-option{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:43px;padding:7px 8px;border:0;border-radius:9px;background:var(--ultra-surface,#fff);color:inherit;font:inherit;text-align:left;cursor:pointer}",
  ".dsh-ultra-option:hover:not(:disabled),.dsh-ultra-option:focus-visible{outline:none;background:var(--ultra-hover,#edf0f5)}",
  ".dsh-ultra-option:disabled{opacity:1;color:var(--dsw-alias-label-dimmed,#9599a1);cursor:default}",
  ".dsh-ultra-option-label{display:block;font-size:13px;line-height:20px;font-weight:500}",
  ".dsh-ultra-detail{display:block}",
  ".dsh-ultra-check{flex:none;width:14px;height:14px;color:var(--dsw-alias-state-info-label,#5069cb)}",
  ".dsh-ultra-footer{margin:4px 4px 0;padding:7px 4px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.15))}",
  ".dsh-ultra-error{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:7px 8px;margin:4px;border-radius:8px;background:color-mix(in srgb,var(--ultra-surface) 91%,var(--ultra-danger) 9%);color:var(--dsw-alias-state-error-primary,#d84c4c);font-size:12px;line-height:18px;overflow-wrap:anywhere}",
  ".dsh-ultra-retry{flex:none;padding:0;border:0;background:inherit;color:inherit;font:inherit;font-weight:600;cursor:pointer}",
  "@keyframes dsh-ultra-pulse{0%,100%{opacity:.45}50%{opacity:1}}",
  "@media(prefers-reduced-motion:reduce){.dsh-ultra-dot{animation:none}.dsh-ultra-chevron{transition:none}}"
].join("");
function readSnapshot(raw, t) {
  const invalid = () => {
    throw new Error(t("error.invalidResponse"));
  };
  if (typeof raw !== "object" || raw === null) return invalid();
  const result = raw;
  if (result.ok !== true) {
    throw new Error(typeof result.error?.message === "string" ? result.error.message : t("error.invalidResponse"));
  }
  if (typeof result.value !== "object" || result.value === null) return invalid();
  const value = result.value;
  if (typeof value.enabled !== "boolean" || value.concurrency !== 3 && value.concurrency !== 4 && value.concurrency !== 5 || typeof value.running !== "boolean" || !Number.isInteger(value.activeRuns) || (value.activeRuns ?? -1) < 0 || value.lastRun !== null && (typeof value.lastRun !== "object" || value.lastRun === void 0 || !Number.isFinite(value.lastRun.at) || !Number.isFinite(value.lastRun.ms) || value.lastRun.ms < 0) || value.phase !== void 0 && typeof value.phase !== "string" || value.error !== void 0 && value.error !== null && typeof value.error !== "string") return invalid();
  return value;
}
function phaseLabel(snapshot, t) {
  if (snapshot.phase === "coordinating") return t("status.coordinating");
  if (snapshot.phase === "deciding" || snapshot.phase === "decision" || snapshot.phase === "merging") return t("status.deciding");
  if (snapshot.running) return t("status.running");
  if (snapshot.phase === "failed" || snapshot.error) return t("status.failed");
  if (snapshot.phase === "cancelled" || snapshot.phase === "aborted") return t("status.cancelled");
  if (snapshot.phase === "completed") return t("status.completed");
  return t(snapshot.enabled ? "status.ready" : "status.disabled");
}
function UltraButton({ sessionId, rpc, t }) {
  const [view, setView] = import_react.default.useState({ sessionId, snapshot: null, pending: false, syncError: null, actionError: null });
  const [open, setOpen] = import_react.default.useState(false);
  const rootRef = import_react.default.useRef(null);
  const triggerRef = import_react.default.useRef(null);
  const optionRefs = import_react.default.useRef([]);
  const retryRef = import_react.default.useRef(null);
  const scopeRef = import_react.default.useRef({ sessionId, rpc, disposed: false, reading: false, mutating: false, revision: 0 });
  const menuId = import_react.default.useId();
  const available = typeof sessionId === "string" && sessionId.trim() !== "";
  if (scopeRef.current.sessionId !== sessionId || scopeRef.current.rpc !== rpc) {
    scopeRef.current.disposed = true;
    scopeRef.current = { sessionId, rpc, disposed: false, reading: false, mutating: false, revision: 0 };
  }
  const current = view.sessionId === sessionId ? view : { sessionId, snapshot: null, pending: false, syncError: null, actionError: null };
  const snapshot = current.snapshot;
  const error = current.actionError ?? current.syncError ?? snapshot?.error ?? null;
  import_react.default.useEffect(() => {
    const scope = scopeRef.current;
    scope.disposed = false;
    setOpen(false);
    setView({ sessionId, snapshot: null, pending: false, syncError: null, actionError: null });
    if (!available) return () => {
      scope.disposed = true;
    };
    const sync = async () => {
      if (scope.disposed || scope.reading || scope.mutating) return;
      scope.reading = true;
      const revision = scope.revision;
      try {
        const state = readSnapshot(await rpc.call(RPC_CHANNEL, "get", { sessionId }), t);
        if (scopeRef.current !== scope || scope.disposed || scope.revision !== revision || scope.mutating) return;
        setView((previous) => ({ ...previous, sessionId, snapshot: state, syncError: null }));
      } catch (cause) {
        if (scopeRef.current !== scope || scope.disposed || scope.revision !== revision || scope.mutating) return;
        setView((previous) => ({ ...previous, syncError: cause instanceof Error ? cause.message : t("error.connection") }));
      } finally {
        scope.reading = false;
      }
    };
    retryRef.current = sync;
    void sync();
    const timer = window.setInterval(() => {
      void sync();
    }, 800);
    return () => {
      scope.disposed = true;
      window.clearInterval(timer);
      if (scopeRef.current === scope) retryRef.current = null;
    };
  }, [rpc, sessionId, available, t]);
  import_react.default.useEffect(() => {
    if (!open) return;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
    };
  }, [open]);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const choose = async (level) => {
    const scope = scopeRef.current;
    if (!available || snapshot === null || scope.mutating || scope.disposed) return;
    if (snapshot.enabled === (level !== 0) && (level === 0 || snapshot.concurrency === level)) {
      close(true);
      return;
    }
    scope.mutating = true;
    scope.revision += 1;
    setView((previous) => ({ ...previous, pending: true, actionError: null }));
    try {
      const saved = readSnapshot(await rpc.call(RPC_CHANNEL, "set", {
        sessionId,
        enabled: level !== 0,
        concurrency: level === 0 ? snapshot.concurrency : level
      }), t);
      if (scopeRef.current !== scope || scope.disposed) return;
      setView((previous) => ({ ...previous, snapshot: saved, pending: false, syncError: null, actionError: null }));
      close(true);
    } catch (cause) {
      if (scopeRef.current !== scope || scope.disposed) return;
      setView((previous) => ({ ...previous, pending: false, actionError: cause instanceof Error ? cause.message : t("error.connection") }));
    } finally {
      scope.mutating = false;
    }
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const options = optionRefs.current.filter((option) => option !== null && !option.disabled);
      if (options.length === 0) return;
      const index = options.findIndex((option) => option === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : index < 0 ? event.key === "ArrowDown" ? 0 : options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    }
  };
  const valueLabel = current.pending ? t("trigger.saving") : snapshot === null ? t("trigger.loading") : snapshot.enabled ? t("trigger.routes", { count: snapshot.concurrency }) : t("trigger.off");
  const status = snapshot === null ? null : phaseLabel(snapshot, t);
  return import_react.default.createElement(
    "div",
    {
      ref: rootRef,
      className: "dsh-ultra",
      "data-enabled": snapshot?.enabled === true,
      "data-error": Boolean(error),
      onKeyDown,
      onBlur: (event) => {
        if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
        close();
      }
    },
    import_react.default.createElement(
      "button",
      {
        ref: triggerRef,
        type: "button",
        className: "dsh-ultra-trigger",
        disabled: !available,
        "aria-label": t("menu.title"),
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : void 0,
        title: available ? t("trigger.title", { count: snapshot?.concurrency ?? 3 }) : t("trigger.unavailable"),
        onClick: () => {
          setOpen((previous) => !previous);
        }
      },
      import_react.default.createElement(
        "svg",
        { className: "dsh-ultra-icon", viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
        import_react.default.createElement("path", { d: "M8 1.5 9.7 6.3 14.5 8 9.7 9.7 8 14.5 6.3 9.7 1.5 8 6.3 6.3Z", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" })
      ),
      import_react.default.createElement("span", null, "Ultra"),
      import_react.default.createElement("span", { className: "dsh-ultra-value" }, available ? valueLabel : t("trigger.off")),
      error || snapshot?.running ? import_react.default.createElement(
        "span",
        { className: "dsh-ultra-status", role: "status", "aria-live": "polite" },
        snapshot?.running && !error ? import_react.default.createElement("span", { className: "dsh-ultra-dot", "aria-hidden": true }) : null,
        error ? t("trigger.error") : status
      ) : null,
      import_react.default.createElement(
        "svg",
        { className: "dsh-ultra-chevron", viewBox: "0 0 10 10", fill: "none", "aria-hidden": true },
        import_react.default.createElement("path", { d: "m2 3.5 3 3 3-3", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" })
      )
    ),
    !open ? null : import_react.default.createElement(
      "div",
      { className: "dsh-ultra-menu", id: menuId, role: "menu", "aria-label": t("menu.title") },
      import_react.default.createElement(
        "div",
        { className: "dsh-ultra-heading" },
        t("menu.title"),
        import_react.default.createElement("div", { className: "dsh-ultra-description" }, t("menu.description"))
      ),
      ...LEVELS.map((level, index) => {
        const selected = snapshot !== null && (level === 0 ? !snapshot.enabled : snapshot.enabled && snapshot.concurrency === level);
        return import_react.default.createElement(
          "button",
          {
            key: level,
            ref: (node) => {
              optionRefs.current[index] = node;
            },
            type: "button",
            className: "dsh-ultra-option",
            role: "menuitemradio",
            "aria-checked": selected,
            disabled: current.pending || snapshot === null,
            onClick: () => {
              void choose(level);
            }
          },
          import_react.default.createElement(
            "span",
            null,
            import_react.default.createElement("span", { className: "dsh-ultra-option-label" }, t(level === 0 ? "menu.off" : "menu.routes", { count: level })),
            import_react.default.createElement("span", { className: "dsh-ultra-detail" }, t(level === 0 ? "menu.offDetail" : "menu.routesDetail"))
          ),
          !selected ? null : import_react.default.createElement(
            "svg",
            { className: "dsh-ultra-check", viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
            import_react.default.createElement("path", { d: "m3 8 3 3 7-7", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" })
          )
        );
      }),
      error ? import_react.default.createElement(
        "div",
        { className: "dsh-ultra-error", role: "alert" },
        import_react.default.createElement("span", null, error),
        current.syncError ? import_react.default.createElement("button", {
          type: "button",
          className: "dsh-ultra-retry",
          onClick: () => {
            void retryRef.current?.();
          }
        }, t("error.retry")) : null
      ) : null,
      import_react.default.createElement(
        "div",
        { className: "dsh-ultra-footer", role: "status", "aria-live": "polite" },
        snapshot === null ? t("trigger.loading") : t("status.runs", { phase: status, count: snapshot.activeRuns }),
        snapshot?.running ? import_react.default.createElement("div", null, t("menu.runningHint")) : null,
        snapshot?.lastRun ? import_react.default.createElement("div", null, t("status.lastRun", { seconds: (snapshot.lastRun.ms / 1e3).toFixed(1) })) : null
      )
    )
  );
}
var inject = ["slots", "connection", "locale", "sessions"];
function apply(ctx) {
  const connection = ctx.get("connection");
  const rpc = connection?.rpc;
  if (rpc === void 0) throw new Error("dsh-ultra-mode requires connection.rpc");
  ctx.effect(() => hideRouteSessions(ctx.sessions.list), "dsh-ultra-mode: internal route sessions");
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), "dsh-ultra-mode: dictionaries");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-ultra-mode";
    style.textContent = ULTRA_CSS;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, "dsh-ultra-mode: styles");
  ctx.effect(() => ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
    name: "conversation.input.right",
    id: "dsh-ultra-mode",
    order: 30,
    label: "Ultra",
    locale: LOCALE_NAMESPACE,
    // Session identity is a registrant-owned face on the installed DSH slot API.
    inject: (sessionId) => ({ sessionId })
  }, (props) => import_react.default.createElement(UltraButton, { ...props, key: props.sessionId, rpc }))), "dsh-ultra-mode: button");
}
return module.exports;
} });
//# sourceMappingURL=client.js.map
