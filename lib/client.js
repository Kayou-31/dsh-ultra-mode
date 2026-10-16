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
var LEVELS = [0, 1, 2, 3, 4, 5];
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
  "trigger.assisted": "Agent + 决策",
  "trigger.routes": "{count} 路",
  "trigger.assistedCompact": "辅助",
  "trigger.routesCompact": "{count}",
  "trigger.offTitle": "Ultra 已关闭；使用当前会话的普通模式。",
  "trigger.loading": "载入中",
  "trigger.saving": "保存中",
  "trigger.error": "出错",
  "trigger.unavailable": "请先选择会话",
  "collaboration.label": "协作增强",
  "collaboration.compact": "协作",
  "collaboration.title": "独立开关：增强普通 DSH Agent 的协作，不强制 Max，也不改变 Ultra 模式。",
  "collaboration.on": "已开启",
  "collaboration.off": "已关闭",
  "trigger.title": "Ultra：{count} 路并发执行 + 1 路独立决策；默认 max 思考",
  "trigger.assistedTitle": "Ultra：正常主 Agent 执行 + 1 路 Max 自动决策辅助",
  "menu.title": "Ultra 模式",
  "menu.description": "主 Agent 决策辅助或多路并发",
  "menu.off": "关闭 Ultra",
  "menu.offDetail": "使用当前会话的普通模式",
  "menu.assisted": "Agent + 决策",
  "menu.assistedDetail": "正常主 Agent 执行 · 另 1 路 Max 决策",
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
  "status.timedOut": "辅助已超时",
  "status.stopped": "辅助已停止",
  "status.warnings": "保留 {count} 条辅助诊断；当前状态以运行结果为准。",
  "status.runs": "{phase} · {count} 个任务",
  "status.lastRun": "上次运行 {seconds} 秒",
  "evidence.title": "证据与资源",
  "evidence.stage": "当前阶段：{phase}",
  "evidence.available": "证据服务可用",
  "evidence.unavailable": "证据服务不可用；覆盖未知",
  "evidence.raw": "原始证据：{sources} 个来源 · {chunks} 个片段 · {characters} 字符 · {attachments} 附件",
  "evidence.coverage": "原文覆盖：宿主 {host} · 已捕获 {captured} · 截断 {truncated} · 仅引用 {reference}",
  "evidence.semantic": "语义记忆：{total} 条 · 当前 {current} · 已替代 {superseded} · 未解决 {unresolved}",
  "evidence.retrievals": "检索：{count} 次",
  "evidence.conflicts": "未解决冲突：{count}",
  "evidence.compression": "上下文压缩：{status} · {before} → {after} tokens",
  "evidence.compressionStatus": "上下文压缩：{status}；token 指标不可用",
  "evidence.historyRetained": "原始历史已保留",
  "evidence.usage": "模型请求：已发起 {attempted} · 已结算 {settled}；实测 {tokens} tokens · 用量未知 {unknown} 次",
  "evidence.estimate": "估算下一请求：{tokens} tokens（含预留）",
  "evidence.estimated": "估算",
  "evidence.unknown": "未知",
  "evidence.route": "路线 {route}：{status}",
  "error.invalidResponse": "服务端返回了无效的 Ultra 状态",
  "error.connection": "无法连接 Ultra 服务",
  "error.retry": "重试"
};
var en = {
  "trigger.off": "Off",
  "trigger.assisted": "Agent + decision",
  "trigger.routes": "{count} routes",
  "trigger.assistedCompact": "Aid",
  "trigger.routesCompact": "{count}",
  "trigger.offTitle": "Ultra is off; use this session’s ordinary mode.",
  "trigger.loading": "Loading",
  "trigger.saving": "Saving",
  "trigger.error": "Error",
  "trigger.unavailable": "Select a session first",
  "collaboration.label": "Team",
  "collaboration.compact": "Team",
  "collaboration.title": "Independent toggle for ordinary DSH Agent cooperation; does not force Max or change Ultra mode.",
  "collaboration.on": "On",
  "collaboration.off": "Off",
  "trigger.title": "Ultra: {count} execution routes + 1 independent decision route; max reasoning by default",
  "trigger.assistedTitle": "Ultra: normal main Agent execution + 1 automatic Max decision assistant",
  "menu.title": "Ultra mode",
  "menu.description": "Main Agent decision assistance or parallel execution",
  "menu.off": "Turn Ultra off",
  "menu.offDetail": "Use this session’s ordinary mode",
  "menu.assisted": "Agent + decision",
  "menu.assistedDetail": "Normal main Agent execution · plus 1 Max decision route",
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
  "status.timedOut": "Assistant timed out",
  "status.stopped": "Assistant stopped",
  "status.warnings": "{count} assistant diagnostics retained; current status follows the run outcome.",
  "status.runs": "{phase} · {count} tasks",
  "status.lastRun": "Last run: {seconds} s",
  "evidence.title": "Evidence and resources",
  "evidence.stage": "Current stage: {phase}",
  "evidence.available": "Evidence service available",
  "evidence.unavailable": "Evidence unavailable; coverage unknown",
  "evidence.raw": "Raw evidence: {sources} sources · {chunks} chunks · {characters} characters · {attachments} attachments",
  "evidence.coverage": "Original coverage: host {host} · captured {captured} · truncated {truncated} · references only {reference}",
  "evidence.semantic": "Semantic memory: {total} records · current {current} · superseded {superseded} · unresolved {unresolved}",
  "evidence.retrievals": "Retrievals: {count}",
  "evidence.conflicts": "Unresolved conflicts: {count}",
  "evidence.compression": "Context compression: {status} · {before} → {after} tokens",
  "evidence.compressionStatus": "Context compression: {status}; token metrics unavailable",
  "evidence.historyRetained": "Original history retained",
  "evidence.usage": "Model requests: attempted {attempted} · settled {settled}; measured {tokens} tokens · unknown usage {unknown} calls",
  "evidence.estimate": "Estimated next request: {tokens} tokens (including reserves)",
  "evidence.estimated": "Estimated",
  "evidence.unknown": "Unknown",
  "evidence.route": "Route {route}: {status}",
  "error.invalidResponse": "The server returned an invalid Ultra state",
  "error.connection": "Unable to connect to Ultra",
  "error.retry": "Retry"
};
var ULTRA_CSS = [
  // Fixed toolbar footprint: 44px collaboration + 4px gap + 84px Ultra.
  // The host measures this group alongside its original model selector.
  ".dsh-ultra{position:relative;display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;flex:0 0 132px;width:132px;max-width:132px;min-width:0;font-family:inherit;--ultra-surface:rgb(from var(--dsw-specific-menu,#fff) r g b / 1);--ultra-ink:rgb(from var(--dsw-alias-label-primary,#20242c) r g b / 1);--ultra-accent:rgb(from var(--dsw-alias-state-info-label,#5069cb) r g b / 1);--ultra-danger:rgb(from var(--dsw-alias-state-error-primary,#d84c4c) r g b / 1);--ultra-hover:color-mix(in srgb,var(--ultra-surface) 92%,var(--ultra-ink) 8%)}",
  ".dsh-ultra-team{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;height:28px;padding:0 4px;border:0;border-radius:24px;background:var(--ultra-surface,#fff);color:var(--dsw-alias-label-secondary,#686c75);font-family:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}",
  ".dsh-ultra-team:hover:not(:disabled){background:var(--ultra-hover,#edf0f5)}",
  ".dsh-ultra-team[aria-pressed=true]{color:var(--ultra-accent);background:color-mix(in srgb,var(--ultra-surface) 90%,var(--ultra-accent) 10%)}",
  ".dsh-ultra-team:focus-visible{outline:2px solid var(--dsw-alias-border-l3,#7a9be0);outline-offset:2px}",
  ".dsh-ultra-team:disabled{color:var(--dsw-alias-label-dimmed,#9599a1);cursor:default}",
  ".dsh-ultra-trigger{position:relative;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:3px;flex:0 0 84px;width:84px;height:28px;padding:0 4px;border:0;border-radius:24px;background:var(--ultra-surface,#fff);color:var(--dsw-alias-label-secondary,#686c75);font-family:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}",
  ".dsh-ultra-trigger:hover:not(:disabled){background:var(--ultra-hover,#edf0f5)}",
  ".dsh-ultra-trigger:focus-visible{outline:2px solid var(--dsw-alias-border-l3,#7a9be0);outline-offset:2px}",
  ".dsh-ultra-trigger:disabled{color:var(--dsw-alias-label-dimmed,#9599a1);cursor:default}",
  ".dsh-ultra[data-enabled=true] .dsh-ultra-trigger{color:var(--dsw-alias-state-info-label,#5069cb);background:color-mix(in srgb,var(--ultra-surface) 90%,var(--ultra-accent) 10%)}",
  ".dsh-ultra-value,.dsh-ultra-chevron{color:var(--dsw-alias-label-caption,#858994)}",
  ".dsh-ultra[data-enabled=true] .dsh-ultra-value{color:inherit}",
  ".dsh-ultra-chevron{flex:none;width:8px;height:8px;transition:transform 120ms ease}",
  ".dsh-ultra-trigger[aria-expanded=true] .dsh-ultra-chevron{transform:rotate(180deg)}",
  ".dsh-ultra-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;clip:rect(0,0,0,0);overflow:hidden;white-space:nowrap}",
  '.dsh-ultra[data-running=true] .dsh-ultra-trigger:after,.dsh-ultra[data-pending=true] .dsh-ultra-trigger:after,.dsh-ultra[data-error=true] .dsh-ultra-trigger:after{content:"";position:absolute;right:2px;top:2px;width:4px;height:4px;border-radius:50%;background:currentColor}',
  ".dsh-ultra[data-running=true] .dsh-ultra-trigger:after{animation:dsh-ultra-pulse 1.5s ease-in-out infinite}",
  ".dsh-ultra[data-pending=true] .dsh-ultra-trigger:after{background:var(--ultra-accent)}",
  ".dsh-ultra[data-error=true] .dsh-ultra-trigger:after{background:var(--ultra-danger)}",
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
  ".dsh-ultra-warning{padding:7px 8px;margin:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#828691);overflow-wrap:anywhere}",
  "@keyframes dsh-ultra-pulse{0%,100%{opacity:.45}50%{opacity:1}}",
  "@container(max-width:440px){.dsh-ultra{flex-basis:96px;width:96px;max-width:96px}.dsh-ultra-trigger{flex-basis:48px;width:48px}.dsh-ultra-name{display:none}}",
  "@media(prefers-reduced-motion:reduce){.dsh-ultra-trigger:after{animation:none!important}.dsh-ultra-chevron{transition:none}}"
].join("");
function validEvidence(raw) {
  const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const text = (value) => typeof value === "string" && value.length <= 2e4;
  const optional = (value, check) => value === void 0 || check(value);
  const strings = (value) => Array.isArray(value) && value.length <= 1e3 && value.every(text);
  const finiteTree = (value, key = "", depth = 0) => {
    if (depth > 12) return false;
    if (typeof value === "number") return Number.isSafeInteger(value) && (value >= 0 || key === "remainingTokens");
    if (value === null || typeof value === "boolean" || text(value)) return true;
    if (Array.isArray(value)) return value.length <= 4096 && value.every((item) => finiteTree(item, "", depth + 1));
    return object(value) && Object.keys(value).length <= 512 && Object.entries(value).every(([name, item]) => finiteTree(item, name, depth + 1));
  };
  const budget = (value) => object(value) && count(value.totalTokens) && optional(value.estimated, (item) => typeof item === "boolean") && finiteTree(value);
  if (!object(raw) || !finiteTree(raw) || typeof raw.enabled !== "boolean" || typeof raw.available !== "boolean" || !optional(raw.phase, text) || !optional(raw.runId, text) || !optional(raw.error, text) || !optional(raw.retrievals, count) || !optional(raw.unresolvedConflicts, count) || !optional(raw.errors, strings)) return false;
  if (raw.coverage !== void 0) {
    if (raw.coverage === "unknown") {
      if (raw.available) return false;
    } else {
      const coverage = raw.coverage;
      if (!object(coverage) || !object(coverage.raw) || !object(coverage.semantic) || !object(coverage.raw.coverage)) return false;
      const rawCounts = coverage.raw, semanticCounts = coverage.semantic, sourceCoverage = rawCounts.coverage;
      if (!["sources", "chunks", "characters", "attachments"].every((key) => count(rawCounts[key])) || !["total", "current", "superseded", "unresolved"].every((key) => count(semanticCounts[key])) || !["host", "captured", "truncated", "reference-only"].every((key) => count(sourceCoverage[key]))) return false;
    }
  }
  if (raw.compression !== void 0 && raw.compression !== null) {
    const value = raw.compression;
    if (!object(value) || !text(value.status) || !optional(value.originalHistoryRetained, (item) => typeof item === "boolean") || !optional(value.limits, strings) || !optional(value.replacements, Array.isArray)) return false;
    const partial = ["failed", "unsupported", "disabled", "limited"].includes(value.status);
    for (const metrics of [value.before, value.after]) {
      if (metrics === void 0 || metrics === null) {
        if (!partial) return false;
      } else if (!budget(metrics)) return false;
    }
  }
  if (raw.resources !== void 0) {
    const value = raw.resources;
    if (!object(value) || !optional(value.attemptedCalls, count) || !["settledCalls", "measuredTokens", "unknownUsageCalls"].every((key) => count(value[key])) || !(value.estimates === void 0 || value.estimates === null || budget(value.estimates))) return false;
    if (value.byRoute !== void 0 && (!object(value.byRoute) || !Object.values(value.byRoute).every(Array.isArray))) return false;
  }
  if (raw.routes !== void 0 && (!Array.isArray(raw.routes) || raw.routes.length > 1e3 || !raw.routes.every((route) => object(route) && text(route.routeId) && text(route.status)))) return false;
  return true;
}
function evidenceLines(evidence, t) {
  const lines = [t(evidence.available ? "evidence.available" : "evidence.unavailable")];
  if (evidence.phase) lines.push(t("evidence.stage", { phase: evidence.phase }));
  if (evidence.coverage && evidence.coverage !== "unknown") {
    const { raw, semantic } = evidence.coverage;
    lines.push(
      t("evidence.raw", { ...raw }),
      t("evidence.coverage", { ...raw.coverage, reference: raw.coverage["reference-only"] }),
      t("evidence.semantic", { ...semantic })
    );
  }
  if (evidence.retrievals !== void 0) lines.push(t("evidence.retrievals", { count: evidence.retrievals }));
  if (evidence.unresolvedConflicts !== void 0) lines.push(t("evidence.conflicts", { count: evidence.unresolvedConflicts }));
  if (evidence.compression) {
    const { status, before, after, originalHistoryRetained, limits } = evidence.compression;
    lines.push(before && after ? t("evidence.compression", { status, before: before.totalTokens, after: after.totalTokens }) + (before.estimated || after.estimated ? ` (${t("evidence.estimated")})` : "") : t("evidence.compressionStatus", { status }));
    if (originalHistoryRetained) lines.push(t("evidence.historyRetained"));
    lines.push(...limits ?? []);
  }
  if (evidence.resources) {
    const resource = evidence.resources;
    lines.push(t("evidence.usage", { attempted: resource.attemptedCalls ?? t("evidence.unknown"), settled: resource.settledCalls, tokens: resource.measuredTokens, unknown: resource.unknownUsageCalls }));
    if (resource.estimates) lines.push(t("evidence.estimate", { tokens: resource.estimates.totalTokens }));
  }
  for (const route of evidence.routes ?? []) lines.push(t("evidence.route", { route: route.routeId, status: route.status }));
  if (evidence.error) lines.push(evidence.error);
  lines.push(...evidence.errors ?? []);
  return lines;
}
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
  if (typeof value.enabled !== "boolean" || value.concurrency !== 1 && value.concurrency !== 2 && value.concurrency !== 3 && value.concurrency !== 4 && value.concurrency !== 5 || typeof value.running !== "boolean" || !Number.isInteger(value.activeRuns) || (value.activeRuns ?? -1) < 0 || value.lastRun !== null && (typeof value.lastRun !== "object" || value.lastRun === void 0 || !Number.isFinite(value.lastRun.at) || !Number.isFinite(value.lastRun.ms) || value.lastRun.ms < 0) || value.phase !== void 0 && typeof value.phase !== "string" || value.error !== void 0 && value.error !== null && typeof value.error !== "string" || value.warnings !== void 0 && (!Array.isArray(value.warnings) || value.warnings.some((item) => typeof item !== "string")) || value.collaborationEnabled !== void 0 && typeof value.collaborationEnabled !== "boolean" || value.evidence !== void 0 && !validEvidence(value.evidence)) return invalid();
  return value;
}
function phaseLabel(snapshot, t) {
  if (snapshot.phase === "coordinating") return t("status.coordinating");
  if (snapshot.phase === "deciding" || snapshot.phase === "decision" || snapshot.phase === "merging") return t("status.deciding");
  if (snapshot.running) return t("status.running");
  if (snapshot.phase === "timed-out") return t("status.timedOut");
  if (snapshot.phase === "stopped") return t("status.stopped");
  if (snapshot.phase === "cancelled" || snapshot.phase === "aborted") return t("status.cancelled");
  if (snapshot.phase === "failed" || snapshot.error) return t("status.failed");
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
  const mutate = async (patch, closeMenu) => {
    const scope = scopeRef.current;
    if (!available || snapshot === null || scope.mutating || scope.disposed) return;
    scope.mutating = true;
    scope.revision += 1;
    setView((previous) => ({ ...previous, pending: true, actionError: null }));
    try {
      const saved = readSnapshot(await rpc.call(RPC_CHANNEL, "set", {
        sessionId,
        ...patch
      }), t);
      if (scopeRef.current !== scope || scope.disposed) return;
      setView((previous) => ({ ...previous, snapshot: saved, pending: false, syncError: null, actionError: null }));
      if (closeMenu) close(true);
    } catch (cause) {
      if (scopeRef.current !== scope || scope.disposed) return;
      setView((previous) => ({ ...previous, pending: false, actionError: cause instanceof Error ? cause.message : t("error.connection") }));
    } finally {
      scope.mutating = false;
    }
  };
  const choose = async (level) => {
    if (snapshot === null) return;
    if (snapshot.enabled === (level !== 0) && (level === 0 || snapshot.concurrency === level)) {
      close(true);
      return;
    }
    await mutate({ enabled: level !== 0, concurrency: level === 0 ? snapshot.concurrency : level }, true);
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
  const valueLabel = snapshot?.enabled ? snapshot.concurrency === 1 ? t("trigger.assistedCompact") : t("trigger.routesCompact", { count: snapshot.concurrency }) : t("trigger.off");
  const status = snapshot === null ? null : phaseLabel(snapshot, t);
  const modeDescription = snapshot?.enabled ? snapshot.concurrency === 1 ? t("trigger.assistedTitle") : t("trigger.title", { count: snapshot.concurrency }) : t("trigger.offTitle");
  const activityDescription = current.pending ? t("trigger.saving") : snapshot === null ? t("trigger.loading") : status;
  const evidence = snapshot?.evidence;
  const evidenceDescription = evidence ? ` ${t(evidence.available ? "evidence.available" : "evidence.unavailable")}${evidence.phase ? " " + t("evidence.stage", { phase: evidence.phase }) : ""}` : "";
  const ultraDescription = available ? `${modeDescription} ${error ?? activityDescription ?? ""}${evidenceDescription}` : t("trigger.unavailable");
  const teamActivity = current.pending ? t("trigger.saving") : snapshot === null ? t("trigger.loading") : t(snapshot.collaborationEnabled ? "collaboration.on" : "collaboration.off");
  const teamDescription = available ? `${t("collaboration.title")} ${teamActivity}` : t("trigger.unavailable");
  const anchor = open ? rootRef.current?.getBoundingClientRect?.() : void 0;
  const above = anchor ? Math.max(0, anchor.top - 12) : void 0;
  const below = anchor ? Math.max(0, window.innerHeight - anchor.bottom - 12) : void 0;
  const menuWidth = Math.min(260, Math.max(0, window.innerWidth - 32));
  const desiredLeft = anchor ? Math.max(16, Math.min(anchor.right - menuWidth, window.innerWidth - menuWidth - 16)) : void 0;
  const menuStyle = above !== void 0 && below !== void 0 ? {
    ...below > above && above < 260 ? { top: "calc(100% + 8px)", bottom: "auto", maxHeight: Math.max(40, below) } : { maxHeight: Math.max(40, above) },
    // Stay in the plugin's absolute positioning context; viewport clamping
    // must not switch to fixed positioning inside transformed host panels.
    ...anchor && desiredLeft !== void 0 ? { left: desiredLeft - anchor.left, right: "auto" } : {}
  } : void 0;
  return import_react.default.createElement(
    "div",
    {
      ref: rootRef,
      className: "dsh-ultra",
      "data-enabled": snapshot?.enabled === true,
      "data-error": Boolean(error),
      "data-running": snapshot?.running === true,
      "data-pending": current.pending,
      onKeyDown,
      onBlur: (event) => {
        if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
        close();
      }
    },
    import_react.default.createElement("button", {
      type: "button",
      className: "dsh-ultra-team",
      disabled: !available || snapshot === null || current.pending,
      "aria-label": t("collaboration.label"),
      "aria-pressed": snapshot?.collaborationEnabled === true,
      "aria-busy": current.pending,
      title: teamDescription,
      "aria-description": teamDescription,
      onClick: () => {
        void mutate({ collaborationEnabled: snapshot?.collaborationEnabled !== true }, false);
      },
      onKeyDown: (event) => {
        event.stopPropagation();
      }
    }, t("collaboration.compact")),
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
        title: ultraDescription,
        "aria-description": ultraDescription,
        "aria-busy": current.pending,
        onClick: () => {
          setOpen((previous) => !previous);
        }
      },
      import_react.default.createElement("span", { className: "dsh-ultra-name" }, "Ultra"),
      import_react.default.createElement("span", { className: "dsh-ultra-value" }, available ? valueLabel : t("trigger.off")),
      import_react.default.createElement("span", { className: "dsh-ultra-status", role: "status", "aria-live": "polite" }, ultraDescription),
      import_react.default.createElement(
        "svg",
        { className: "dsh-ultra-chevron", viewBox: "0 0 10 10", fill: "none", "aria-hidden": true },
        import_react.default.createElement("path", { d: "m2 3.5 3 3 3-3", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" })
      )
    ),
    !open ? null : import_react.default.createElement(
      "div",
      { className: "dsh-ultra-menu", id: menuId, role: "menu", "aria-label": t("menu.title"), style: menuStyle },
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
            import_react.default.createElement("span", { className: "dsh-ultra-option-label" }, t(level === 0 ? "menu.off" : level === 1 ? "menu.assisted" : "menu.routes", { count: level })),
            import_react.default.createElement("span", { className: "dsh-ultra-detail" }, t(level === 0 ? "menu.offDetail" : level === 1 ? "menu.assistedDetail" : "menu.routesDetail"))
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
      snapshot?.warnings?.length ? import_react.default.createElement(
        "details",
        { className: "dsh-ultra-warning" },
        import_react.default.createElement("summary", null, t("status.warnings", { count: snapshot.warnings.length })),
        ...snapshot.warnings.map((warning, index) => import_react.default.createElement("div", { key: index }, warning))
      ) : null,
      evidence ? import_react.default.createElement(
        "details",
        { className: "dsh-ultra-warning", "aria-label": t("evidence.title") },
        import_react.default.createElement("summary", null, t("evidence.title")),
        ...evidenceLines(evidence, t).map((line, index) => import_react.default.createElement("div", { key: index }, line))
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
