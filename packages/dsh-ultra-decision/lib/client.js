window.__ModuleLoader__.load({ id: "@dsh-external/dsh-ultra-decision", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// src/client/model-pool.ts
var model_pool_exports = {};
__export(model_pool_exports, {
  ModelPoolPanel: () => ModelPoolPanel
});
function readSnapshot(raw) {
  const invalid = () => {
    throw new Error("服务端返回了无效的模型池配置");
  };
  if (!object(raw)) return invalid();
  if (raw.ok !== true) throw new Error(object(raw.error) && string(raw.error.message) ? raw.error.message : "模型池服务请求失败");
  const value = raw.value;
  if (!object(value) || !object(value.config) || !Array.isArray(value.config.models) || value.config.models.length > 32 || !Array.isArray(value.hostModels) || value.hostModels.length > 1e4 || typeof value.editable !== "boolean" || !Array.isArray(value.records) || value.records.length > 1e3 || value.catalogErrors !== void 0 && (!Array.isArray(value.catalogErrors) || value.catalogErrors.length > 128 || !value.catalogErrors.every(string))) return invalid();
  const config = value.config;
  if (!["error", "default", "inherit"].includes(String(config.fallback)) || !Number.isSafeInteger(config.maxConcurrent) || Number(config.maxConcurrent) < 1 || Number(config.maxConcurrent) > 32 || !Number.isSafeInteger(config.maxRequests) || Number(config.maxRequests) < 0 || !Number.isSafeInteger(config.failureLimit) || Number(config.failureLimit) < 1 || Number(config.failureLimit) > 100 || config.explicitModelId !== void 0 && !string(config.explicitModelId)) return invalid();
  for (const model of config.models) {
    if (!object(model) || !["id", "name", "provider", "model", "strengths", "suitableFor", "avoidFor"].every((key) => string(model[key])) || !["enabled", "isDefault", "allowCrossProvider", "allowUnverifiedTools"].every((key) => typeof model[key] === "boolean") || !Number.isSafeInteger(model.maxConcurrent) || Number(model.maxConcurrent) < 1 || Number(model.maxConcurrent) > 32 || model.maxTokens !== void 0 && (!Number.isSafeInteger(model.maxTokens) || Number(model.maxTokens) < 1) || model.reasoningEffort !== void 0 && !string(model.reasoningEffort) || !["costNote", "speedNote"].every((key) => model[key] === void 0 || string(model[key])) || !["costSource", "speedSource"].every((key) => model[key] === void 0 || model[key] === "user" || model[key] === "measured")) return invalid();
  }
  for (const model of value.hostModels) if (!object(model) || !string(model.provider) || !string(model.model) || !string(model.name)) return invalid();
  const records = value.records.map((record) => {
    if (!object(record) || !string(record.id) || !string(record.taskName) || !string(record.status)) return invalid();
    const picked = { id: record.id, taskName: record.taskName, status: record.status };
    for (const key of ["error", "recordingError"]) if (record[key] !== void 0) {
      if (!string(record[key])) return invalid();
      picked[key] = record[key];
    }
    if (record.model !== void 0) {
      if (!object(record.model)) return invalid();
      const selected = {};
      for (const key of ["requestedConfigId", "selectedConfigId", "source", "reason", "provider", "model", "reasoningEffort", "fallbackReason"]) {
        const field = record.model[key];
        if (field !== void 0) {
          if (!string(field)) return invalid();
          selected[key] = field;
        }
      }
      if (record.model.maxTokens !== void 0) {
        if (!Number.isSafeInteger(record.model.maxTokens)) return invalid();
        selected.maxTokens = record.model.maxTokens;
      }
      if (string(record.model.compatibility)) selected.compatibility = record.model.compatibility;
      else if (object(record.model.compatibility)) selected.compatibility = Object.entries(record.model.compatibility).filter(([key]) => ["input", "tools", "outputLimit"].includes(key)).filter(([, field]) => string(field) || typeof field === "boolean").map(([key, field]) => `${key}: ${String(field)}`).join(" · ").slice(0, 2e3);
      if (record.model.requestStatus !== void 0) {
        if (record.model.requestStatus !== "pending" && record.model.requestStatus !== "observed") return invalid();
        selected.requestStatus = record.model.requestStatus;
      }
      if (record.model.actual !== void 0) {
        const actual = record.model.actual;
        if (!object(actual) || !string(actual.provider) || !string(actual.model) || actual.stage !== "native-request" || actual.reasoningEffort !== void 0 && !string(actual.reasoningEffort) || actual.maxTokens !== void 0 && (!Number.isSafeInteger(actual.maxTokens) || Number(actual.maxTokens) < 1)) return invalid();
        selected.actual = {
          provider: actual.provider,
          model: actual.model,
          stage: "native-request",
          ...actual.reasoningEffort === void 0 ? {} : { reasoningEffort: actual.reasoningEffort },
          ...actual.maxTokens === void 0 ? {} : { maxTokens: actual.maxTokens }
        };
      }
      picked.model = selected;
    }
    if (record.usage !== void 0) {
      if (!object(record.usage) || !["requests", "knownTokens", "unknownCalls"].every((key) => Number.isSafeInteger(record.usage[key]) && Number(record.usage[key]) >= 0)) return invalid();
      if (record.usage.inFlightRequests !== void 0 && (!Number.isSafeInteger(record.usage.inFlightRequests) || Number(record.usage.inFlightRequests) < 0)) return invalid();
      picked.usage = { requests: record.usage.requests, knownTokens: record.usage.knownTokens, unknownCalls: record.usage.unknownCalls, inFlightRequests: Number(record.usage.inFlightRequests ?? 0) };
    }
    return picked;
  });
  const models = config.models.map((model) => ({
    id: model.id,
    name: model.name,
    enabled: model.enabled,
    provider: model.provider,
    model: model.model,
    strengths: model.strengths,
    suitableFor: model.suitableFor,
    avoidFor: model.avoidFor,
    isDefault: model.isDefault,
    maxConcurrent: model.maxConcurrent,
    allowCrossProvider: model.allowCrossProvider,
    allowUnverifiedTools: model.allowUnverifiedTools,
    ...model.reasoningEffort === void 0 ? {} : { reasoningEffort: model.reasoningEffort },
    ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
    ...model.costNote === void 0 ? {} : { costNote: model.costNote },
    ...model.costSource === void 0 ? {} : { costSource: model.costSource },
    ...model.speedNote === void 0 ? {} : { speedNote: model.speedNote },
    ...model.speedSource === void 0 ? {} : { speedSource: model.speedSource }
  }));
  return {
    config: { models, explicitModelId: config.explicitModelId, fallback: config.fallback, maxConcurrent: config.maxConcurrent, maxRequests: config.maxRequests, failureLimit: config.failureLimit },
    hostModels: [...new Map(value.hostModels.map((model) => [routeKey(model), model])).values()],
    editable: value.editable,
    records,
    catalogErrors: value.catalogErrors ?? []
  };
}
function positive(value, name, allowZero = false, maximum = 1e6) {
  if (typeof value === "string" && !value.trim()) throw new Error(`${name}不能为空`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1) || parsed > maximum) throw new Error(`${name}须为${allowZero ? "非负" : "正"}整数，最多 ${maximum}`);
  return parsed;
}
function saveConfig(draft, hostModels) {
  const ids = /* @__PURE__ */ new Set(), routes = new Set(hostModels.map(routeKey));
  const models = draft.models.map((model) => {
    const id = model.id.trim(), name = model.name.trim();
    if (!id || !name || ids.has(id)) throw new Error("配置 ID 和名称不能为空，ID 不能重复");
    ids.add(id);
    if (model.enabled && !routes.has(routeKey(model))) throw new Error(`候选 ${name} 的模型不在已配置宿主目录，请重新选择或禁用`);
    const maxConcurrent = positive(model.maxConcurrent, "候选并发上限", false, 32);
    const effort = model.reasoningEffort?.trim();
    const maxTokens = model.maxTokens === void 0 || model.maxTokens === "" ? void 0 : positive(model.maxTokens, "输出上限");
    for (const kind of ["cost", "speed"]) if (model[`${kind}Source`] === "measured" && !model[`${kind}Note`]?.trim()) throw new Error("实测成本或速度必须填写测试来源说明");
    return {
      id,
      name,
      enabled: model.enabled,
      provider: model.provider,
      model: model.model,
      strengths: model.strengths,
      suitableFor: model.suitableFor,
      avoidFor: model.avoidFor,
      isDefault: model.isDefault,
      maxConcurrent,
      allowCrossProvider: model.allowCrossProvider,
      allowUnverifiedTools: model.allowUnverifiedTools,
      ...effort ? { reasoningEffort: effort } : {},
      ...maxTokens === void 0 ? {} : { maxTokens },
      ...model.costNote?.trim() ? { costNote: model.costNote.trim(), costSource: model.costSource ?? "user" } : {},
      ...model.speedNote?.trim() ? { speedNote: model.speedNote.trim(), speedSource: model.speedSource ?? "user" } : {}
    };
  });
  if (models.filter((model) => model.isDefault).length > 1) throw new Error("只能标记一个默认候选");
  if (draft.explicitModelId && !models.some((model) => model.id === draft.explicitModelId && model.enabled)) throw new Error("用户固定候选必须存在并已启用");
  return {
    models,
    ...draft.explicitModelId ? { explicitModelId: draft.explicitModelId } : {},
    fallback: draft.fallback,
    maxConcurrent: positive(draft.maxConcurrent, "模型池并发上限", false, 32),
    maxRequests: positive(draft.maxRequests, "请求预算", true),
    failureLimit: positive(draft.failureLimit, "重复失败上限", false, 100)
  };
}
function ModelPoolPanel({ sessionId, rpc, onClose, anchor, viewport }) {
  const [snapshot, setSnapshot] = import_react.default.useState(null);
  const [draft, setDraft] = import_react.default.useState(null);
  const [pending, setPending] = import_react.default.useState(true);
  const [error, setError] = import_react.default.useState(null);
  const [saved, setSaved] = import_react.default.useState(false);
  const scopeRef = import_react.default.useRef({ sessionId, rpc, disposed: false, busy: false });
  if (scopeRef.current.sessionId !== sessionId || scopeRef.current.rpc !== rpc) {
    scopeRef.current.disposed = true;
    scopeRef.current = { sessionId, rpc, disposed: false, busy: false };
  }
  import_react.default.useEffect(() => {
    const scope = scopeRef.current;
    scope.disposed = false;
    setSnapshot(null);
    setDraft(null);
    setPending(true);
    setError(null);
    setSaved(false);
    void rpc.call(channel, "get", { sessionId }).then((raw) => {
      if (scopeRef.current !== scope || scope.disposed) return;
      const result = readSnapshot(raw);
      setSnapshot(result);
      setDraft(result.config);
    }).catch((cause) => {
      if (scopeRef.current === scope && !scope.disposed) setError(errorMessage(cause));
    }).finally(() => {
      if (scopeRef.current === scope && !scope.disposed) setPending(false);
    });
    return () => {
      scope.disposed = true;
    };
  }, [sessionId, rpc]);
  const editable = snapshot?.editable === true && !pending;
  const update = (patch) => {
    if (!editable) return;
    setDraft((previous) => previous ? { ...previous, ...patch } : previous);
    setSaved(false);
  };
  const updateModel = (index, patch) => {
    if (!draft) return;
    update({ models: draft.models.map((model, position) => ({ ...model, ...patch.isDefault ? { isDefault: position === index } : {}, ...position === index ? patch : {} })) });
  };
  const add = () => {
    const route = snapshot?.hostModels[0];
    if (!draft || !route || !editable) return;
    let counter = draft.models.length + 1;
    while (draft.models.some((model) => model.id === `model-${counter}`)) counter++;
    update({ models: [...draft.models, {
      id: `model-${counter}`,
      name: route.name,
      enabled: true,
      provider: route.provider,
      model: route.model,
      strengths: "",
      suitableFor: "",
      avoidFor: "",
      isDefault: draft.models.length === 0,
      maxConcurrent: 1,
      allowCrossProvider: false,
      allowUnverifiedTools: false
    }] });
  };
  const save = async () => {
    const scope = scopeRef.current;
    if (!draft || !snapshot || !editable || scope.disposed || scope.busy) return;
    try {
      const config = saveConfig(draft, snapshot.hostModels);
      scope.busy = true;
      setPending(true);
      setError(null);
      setSaved(false);
      const result = readSnapshot(await rpc.call(channel, "save", { sessionId, config }));
      if (scopeRef.current !== scope || scope.disposed) return;
      setSnapshot(result);
      setDraft(result.config);
      setSaved(true);
    } catch (cause) {
      if (scopeRef.current === scope && !scope.disposed) setError(errorMessage(cause));
    } finally {
      scope.busy = false;
      if (scopeRef.current === scope && !scope.disposed) setPending(false);
    }
  };
  const h = import_react.default.createElement;
  const field = (label, name, value, change, options = {}) => h(
    "label",
    { className: "dsh-pool-field", key: name },
    h("span", null, label),
    h(options.multiline ? "textarea" : "input", {
      "data-field": name,
      value: value ?? "",
      type: options.type ?? "text",
      rows: options.multiline ? 2 : void 0,
      disabled: !editable,
      onChange: (event) => {
        change(event.target.value);
      }
    }),
    options.hint ? h("small", null, options.hint) : null
  );
  const checkbox = (label, name, checked, change) => h(
    "label",
    { className: "dsh-pool-check", key: name },
    h("input", { type: "checkbox", "data-field": name, checked, disabled: !editable, onChange: (event) => {
      change(event.target.checked);
    } }),
    h("span", null, label)
  );
  const select = (label, name, selected, options, change) => h(
    "label",
    { className: "dsh-pool-field", key: name },
    h("span", null, label),
    h(
      "select",
      { "data-field": name, value: selected, disabled: !editable, onChange: (event) => {
        change(event.target.value);
      } },
      ...options.map((option) => h("option", { key: option.value, value: option.value, disabled: option.disabled }, option.label))
    )
  );
  const width = viewport ? Math.min(680, Math.max(0, viewport.width - 32)) : void 0;
  const above = anchor ? Math.max(0, anchor.top - 12) : void 0;
  const below = anchor && viewport ? Math.max(0, viewport.height - anchor.bottom - 12) : void 0;
  const style = anchor && viewport && width !== void 0 && above !== void 0 && below !== void 0 ? {
    width,
    left: Math.max(16, Math.min(anchor.right - width, viewport.width - width - 16)) - anchor.left,
    right: "auto",
    ...below > above ? { top: "calc(100% + 8px)", bottom: "auto", maxHeight: Math.max(40, below) } : { maxHeight: Math.max(40, above) }
  } : void 0;
  return h(
    "section",
    {
      className: "dsh-pool-panel",
      role: "dialog",
      "aria-label": "普通协作模型池",
      "aria-busy": pending,
      style,
      onKeyDown: (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }
    },
    h("style", null, POOL_CSS),
    h("div", { className: "dsh-pool-heading" }, h("strong", null, "普通协作模型池"), h("button", { type: "button", onClick: onClose, "aria-label": "关闭模型池" }, "关闭")),
    h("p", { className: "dsh-pool-note" }, "仅影响后续新建子代理；运行中的实例保持模型快照。主 Agent、Ultra worker 和 decision 的模型保持原配置。"),
    h("p", { className: "dsh-pool-note" }, "擅长与场景由用户声明；技术兼容性由宿主校验。未知不表示支持；此界面不保存密钥、不新增 provider。"),
    error ? h("div", { role: "alert", className: "dsh-pool-error" }, error) : null,
    ...(snapshot?.catalogErrors ?? []).map((message, index) => h("div", { key: index, role: "status", className: "dsh-pool-note" }, message)),
    pending && !snapshot ? h("div", { role: "status" }, "正在读取模型池…") : null,
    snapshot && !snapshot.editable ? h("div", { role: "status" }, "当前配置只读，不可编辑；需要宿主配置持久化权限。") : null,
    draft && snapshot ? h(
      "div",
      null,
      h(
        "div",
        { className: "dsh-pool-grid" },
        select("用户固定候选（优先于自主选择）", "explicitModelId", draft.explicitModelId ?? "", [{ value: "", label: "自动：由主 Agent 按任务选择" }, ...draft.models.map((model) => ({ value: model.id, label: `${model.name} · ${model.id}${model.enabled ? "" : "（已禁用）"}`, disabled: !model.enabled }))], (explicitModelId) => {
          update({ explicitModelId });
        }),
        select("失败回退策略", "fallback", draft.fallback, [{ value: "error", label: "报错：不换模型（默认）" }, { value: "default", label: "允许回退到默认候选" }, { value: "inherit", label: "允许回退到父 Agent 模型" }], (fallback) => {
          update({ fallback });
        }),
        field("模型池并发上限", "maxConcurrent", draft.maxConcurrent, (maxConcurrent) => {
          update({ maxConcurrent });
        }, { type: "number" }),
        field("请求预算", "maxRequests", draft.maxRequests, (maxRequests) => {
          update({ maxRequests });
        }, { type: "number", hint: "0：继承既有宿主/任务限制，不代表无限授权。" }),
        field("重复失败退出上限", "failureLimit", draft.failureLimit, (failureLimit) => {
          update({ failureLimit });
        }, { type: "number" })
      ),
      h("p", { className: "dsh-pool-note" }, "优先级：用户固定候选 → 主 Agent 选择 → 默认候选 → 原有继承。回退仅按上方明确授权执行，选模不会扩大工具、审批或嵌套权限。"),
      ...draft.models.map((model, index) => {
        const name = (field2) => `models.${index}.${field2}`;
        const key = routeKey(model);
        const routes = snapshot.hostModels.map((route) => ({ value: routeKey(route), label: `${route.name} · ${route.provider} / ${route.model}` }));
        if (!routes.some((route) => route.value === key)) routes.unshift({ value: key, label: `宿主目录中不可用：${model.provider} / ${model.model}` });
        return h(
          "fieldset",
          { key: index, className: "dsh-pool-candidate", disabled: !editable },
          h("legend", null, `候选 ${index + 1}`),
          h(
            "div",
            { className: "dsh-pool-grid" },
            field("稳定配置 ID", name("id"), model.id, (id) => {
              updateModel(index, { id });
            }),
            field("显示名称", name("name"), model.name, (name2) => {
              updateModel(index, { name: name2 });
            }),
            select("已配置宿主模型", name("route"), key, routes, (selected) => {
              try {
                const route = JSON.parse(selected);
                if (Array.isArray(route) && route.length === 2 && route.every((item) => typeof item === "string")) updateModel(index, { provider: route[0], model: route[1] });
              } catch {
                setError("请选择已配置宿主模型");
              }
            }),
            field("候选并发上限", name("maxConcurrent"), model.maxConcurrent, (maxConcurrent) => {
              updateModel(index, { maxConcurrent });
            }, { type: "number" }),
            field("擅长能力（用户声明）", name("strengths"), model.strengths, (strengths) => {
              updateModel(index, { strengths });
            }, { multiline: true }),
            field("适用场景（用户声明）", name("suitableFor"), model.suitableFor, (suitableFor) => {
              updateModel(index, { suitableFor });
            }, { multiline: true }),
            field("不适用场景（用户声明）", name("avoidFor"), model.avoidFor, (avoidFor) => {
              updateModel(index, { avoidFor });
            }, { multiline: true }),
            field("思考强度（可选）", name("reasoningEffort"), model.reasoningEffort, (reasoningEffort) => {
              updateModel(index, { reasoningEffort });
            }, { hint: "留空使用目标模型默认；填写值须由宿主确认支持。" }),
            field("输出 token 上限（可选）", name("maxTokens"), model.maxTokens, (maxTokens) => {
              updateModel(index, { maxTokens });
            }, { type: "number", hint: "留空使用目标模型默认；不开放其他未支持参数。" })
          ),
          checkbox("启用此候选", name("enabled"), model.enabled, (enabled) => {
            updateModel(index, { enabled });
          }),
          checkbox("设为默认候选", name("isDefault"), model.isDefault, (isDefault) => {
            updateModel(index, { isDefault });
          }),
          checkbox("允许向此候选发送跨 provider 的子任务数据", name("allowCrossProvider"), model.allowCrossProvider, (allowCrossProvider) => {
            updateModel(index, { allowCrossProvider });
          }),
          checkbox("用户允许使用工具兼容性尚未验证的候选（仍标记未验证）", name("allowUnverifiedTools"), model.allowUnverifiedTools, (allowUnverifiedTools) => {
            updateModel(index, { allowUnverifiedTools });
          }),
          h("div", { className: "dsh-pool-grid" }, ...["cost", "speed"].flatMap((kind) => [
            field(kind === "cost" ? "成本说明 / 测试来源" : "速度说明 / 测试来源", name(`${kind}Note`), model[`${kind}Note`], (note) => {
              updateModel(index, { [`${kind}Note`]: note });
            }, { multiline: true }),
            select(kind === "cost" ? "成本说明来源" : "速度说明来源", name(`${kind}Source`), model[`${kind}Source`] ?? "user", [{ value: "user", label: "用户填写（非实测）" }, { value: "measured", label: "实测（须注明测试来源）" }], (source) => {
              updateModel(index, { [`${kind}Source`]: source });
            })
          ])),
          h("button", { type: "button", disabled: !editable, onClick: () => {
            update({ models: draft.models.filter((_item, position) => position !== index), ...draft.explicitModelId === model.id ? { explicitModelId: void 0 } : {} });
          } }, `移除候选 ${index + 1}`)
        );
      }),
      !draft.models.length ? h("p", { className: "dsh-pool-note" }, "未配置候选：保留普通协作的原有模型继承行为。") : null,
      h(
        "div",
        { className: "dsh-pool-actions" },
        h("button", { type: "button", disabled: !editable || snapshot.hostModels.length === 0 || draft.models.length >= 32, onClick: add }, "添加候选模型"),
        h("button", { type: "button", disabled: !editable, onClick: () => {
          void save();
        } }, "保存配置")
      ),
      snapshot.hostModels.length === 0 ? h("p", { role: "status" }, snapshot.catalogErrors.length ? "宿主目录暂不可用；关闭后重新打开可重试读取。" : "暂无可用宿主模型，请先在 DSH 模型设置中配置。") : null,
      saved ? h("div", { role: "status" }, "已保存；仅影响后续新建子代理。") : null,
      h(
        "details",
        { className: "dsh-pool-records", open: true },
        h("summary", null, `普通协作子代理记录（${snapshot.records.length}）`),
        ...snapshot.records.map((record) => h(
          "article",
          { key: record.id },
          h("strong", null, `${record.taskName} · ${record.status}`),
          h("div", null, record.id),
          record.error ? h("div", { role: "status", className: "dsh-pool-error" }, record.error) : null,
          record.recordingError ? h("div", { role: "alert", className: "dsh-pool-error" }, record.recordingError) : null,
          record.model ? h(
            "div",
            null,
            h("div", null, `请求候选：${record.model.requestedConfigId ?? "继承"}；生效候选：${record.model.selectedConfigId ?? "继承"}；来源：${record.model.source ?? "未知"}`),
            h("div", null, `解析模型：${record.model.provider ?? "待解析"} / ${record.model.model ?? "待解析"}${record.model.reasoningEffort ? `；思考强度 ${record.model.reasoningEffort}` : ""}${record.model.maxTokens ? `；输出上限 ${record.model.maxTokens}` : ""}`),
            h("div", null, record.model.requestStatus === "observed" && record.model.actual ? `实际请求：${record.model.actual.provider} / ${record.model.actual.model}${record.model.actual.reasoningEffort ? `；思考强度 ${record.model.actual.reasoningEffort}` : ""}${record.model.actual.maxTokens ? `；输出上限 ${record.model.actual.maxTokens}` : ""}（原生组装已观察，不代表供应商已执行）` : "实际请求：尚未观察到（解析或创建成功不代表供应商已执行）"),
            record.model.reason ? h("div", null, `选择理由：${record.model.reason}`) : null,
            record.model.compatibility ? h("div", null, `兼容性：${String(record.model.compatibility)}`) : null,
            record.model.fallbackReason ? h("div", null, `回退原因：${record.model.fallbackReason}`) : null
          ) : null,
          record.usage ? h("div", null, `已记录请求 ${record.usage.requests} 次；已报告 ${record.usage.knownTokens} tokens；用量未知 ${record.usage.unknownCalls} 次；尚未结算 ${record.usage.inFlightRequests ?? 0} 次（不将估算计为实测）`) : h("div", null, "消耗数据暂不可用")
        ))
      )
    ) : null
  );
}
var import_react, channel, object, string, routeKey, errorMessage, POOL_CSS;
var init_model_pool = __esm({
  "src/client/model-pool.ts"() {
    "use strict";
    import_react = __toESM(require("react"), 1);
    channel = "/dsh-ultra-model-pool";
    object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    string = (value) => typeof value === "string" && value.length <= 2e4;
    routeKey = (route) => JSON.stringify([route.provider, route.model]);
    errorMessage = (error) => error instanceof Error ? error.message : "模型池服务请求失败";
    POOL_CSS = [
      ".dsh-pool-panel{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;box-sizing:border-box;width:min(680px,calc(100vw - 32px));max-height:min(76vh,760px);overflow:auto;padding:16px;border:1px solid var(--dsw-alias-border-l1,#a0a0a044);border-radius:12px;background:var(--ultra-surface,#fff);color:var(--ultra-ink,#20242c);box-shadow:0 8px 32px #0003;font-family:inherit;font-size:13px;line-height:1.5;overflow-wrap:anywhere}",
      ".dsh-pool-heading,.dsh-pool-actions{display:flex;justify-content:space-between;align-items:center;gap:12px}.dsh-pool-heading strong{font-size:15px}.dsh-pool-note{font-size:12px;color:var(--dsw-alias-label-secondary,#686c75)}",
      ".dsh-pool-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}.dsh-pool-field{display:flex;flex-direction:column;gap:4px;min-width:0}.dsh-pool-field small{font-size:11px;opacity:.8}",
      ".dsh-pool-panel input:not([type=checkbox]),.dsh-pool-panel select,.dsh-pool-panel textarea{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l1,#9996);border-radius:6px;padding:6px;background:var(--ultra-surface,#fff);color:inherit;font:inherit}.dsh-pool-panel textarea{resize:vertical}",
      ".dsh-pool-panel button{border:1px solid var(--dsw-alias-border-l1,#9996);border-radius:6px;padding:5px 9px;background:var(--ultra-surface,#fff);color:inherit;font:inherit;cursor:pointer}.dsh-pool-panel button:disabled{opacity:.55;cursor:default}.dsh-pool-panel :focus-visible{outline:2px solid var(--ultra-accent,#5069cb);outline-offset:2px}",
      ".dsh-pool-candidate{margin:16px 0;padding:12px;border:1px solid var(--dsw-alias-border-l1,#9996);border-radius:8px;min-width:0}.dsh-pool-check{display:flex;align-items:flex-start;gap:7px;margin:9px 0;font-size:12px}.dsh-pool-check input{margin:3px 0 0;flex:none}.dsh-pool-error{padding:9px;background:#d44a;color:var(--ultra-danger,#b22);border-radius:6px;margin:8px 0}",
      ".dsh-pool-records{margin-top:16px;font-size:12px}.dsh-pool-records article{padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#9996)}@media(max-width:520px){.dsh-pool-grid{grid-template-columns:minmax(0,1fr)}.dsh-pool-panel{padding:12px}}"
    ].join("");
  }
});

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react2 = __toESM(require("react"), 1);
var decisionOnly = true;
var PLUGIN_ID = decisionOnly ? "dsh-ultra-decision" : "dsh-ultra-mode";
var RPC_CHANNEL = decisionOnly ? "/dsh-ultra-decision" : "/dsh-ultra-mode";
var LOCALE_NAMESPACE = PLUGIN_ID;
var LEVELS = decisionOnly ? [0, 1] : [0, 1, 2, 3, 4, 5];
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
  "pool.label": "普通协作模型池",
  "pool.compact": "模型池",
  "pool.narrow": "池",
  "pool.title": "配置普通协作子代理的候选模型、能力和选择记录；不改变主 Agent 或 Ultra 路线。",
  "pool.loading": "载入模型池…",
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
  "governance.title": "意图与验收",
  "governance.contract": "任务契约 v{version} · 原话 {chars} 字符 · 意图条目 {items}",
  "governance.delivery": "方向建议：待处理 {queued} · 已准入 {admitted} · 进入请求 {visible} · 独立效果验证 {verified}",
  "governance.review": "验收（模型判断）：满足 {satisfied} · 失败 {failed} · 未验证 {unverified}；不代表宿主验证",
  "governance.noReview": "验收尚未形成；不推断任务通过",
  "governance.durable": "治理快照已保存到证据库",
  "governance.memoryOnly": "治理快照尚未确认持久化",
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
  "evidence.archive": "阶段归档：{status} · 估算包络 {before} → {after} tokens（含预留）",
  "evidence.archiveStatus": "阶段归档：{status}；估算包络不可用",
  "evidence.archiveReceipt": "恢复 ID：{id}",
  "evidence.archivePaused": "归档持久化状态未确认；后续执行已暂停",
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
  "pool.label": "Ordinary collaboration model pool",
  "pool.compact": "Pool",
  "pool.narrow": "Pool",
  "pool.title": "Configure ordinary child model choices, capabilities and records; parent and Ultra routes keep their models.",
  "pool.loading": "Loading model pool…",
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
  "governance.title": "Intent and acceptance",
  "governance.contract": "Task contract v{version} · original {chars} characters · {items} intent items",
  "governance.delivery": "Directions: pending {queued} · admitted {admitted} · request-visible {visible} · independently verified effects {verified}",
  "governance.review": "Acceptance (model assessment): satisfied {satisfied} · failed {failed} · unverified {unverified}; not host verification",
  "governance.noReview": "No acceptance report yet; task success is not inferred",
  "governance.durable": "Governance snapshot saved to evidence storage",
  "governance.memoryOnly": "Durable governance storage has not been confirmed",
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
  "evidence.archive": "Stage archive: {status} · Estimated envelope {before} → {after} tokens (including reserves)",
  "evidence.archiveStatus": "Stage archive: {status}; estimated envelope unavailable",
  "evidence.archiveReceipt": "Recovery ID: {id}",
  "evidence.archivePaused": "Persistence is uncertain; further execution is paused",
  "evidence.usage": "Model requests: attempted {attempted} · settled {settled}; measured {tokens} tokens · unknown usage {unknown} calls",
  "evidence.estimate": "Estimated next request: {tokens} tokens (including reserves)",
  "evidence.estimated": "Estimated",
  "evidence.unknown": "Unknown",
  "evidence.route": "Route {route}: {status}",
  "error.invalidResponse": "The server returned an invalid Ultra state",
  "error.connection": "Unable to connect to Ultra",
  "error.retry": "Retry"
};
if (decisionOnly) {
  Object.assign(zh, {
    "menu.title": "Decision 辅助",
    "menu.description": "普通主 Agent + 可选单条只读决策辅助",
    "menu.off": "关闭决策辅助",
    "trigger.offTitle": "Decision 辅助已关闭；保持普通主 Agent。",
    "trigger.assistedTitle": "Decision：正常主 Agent 执行 + 1 路只读 Max 决策辅助",
    "status.disabled": "Decision 辅助已关闭",
    "error.invalidResponse": "服务端返回了无效的 Decision 状态",
    "error.connection": "无法连接 Decision 服务",
    "collaboration.title": "独立开关：增强普通 DSH Agent 的协作，不改变决策辅助开关。",
    "pool.title": "配置普通协作子代理的候选模型、能力和选择记录。"
  });
  Object.assign(en, {
    "menu.title": "Decision assistance",
    "menu.description": "Ordinary Agent with one optional read-only decision assistant",
    "menu.off": "Disable decision assistance",
    "trigger.offTitle": "Decision assistance is off; use the ordinary Agent.",
    "trigger.assistedTitle": "Decision: ordinary Agent with one read-only Max decision assistant",
    "status.disabled": "Decision assistance is off",
    "error.invalidResponse": "Invalid Decision state from the server",
    "error.connection": "Cannot connect to Decision service",
    "collaboration.title": "Independent Team toggle for the ordinary DSH Agent.",
    "pool.title": "Configure ordinary collaboration model candidates and inspect their actual request records."
  });
}
var ULTRA_CSS = [
  // Retain the host-measured footprint while adding an on-demand model-pool entry.
  // The host measures this group alongside its original model selector.
  ".dsh-ultra{position:relative;display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;flex:0 0 132px;width:132px;max-width:132px;min-width:0;font-family:inherit;--ultra-surface:rgb(from var(--dsw-specific-menu,#fff) r g b / 1);--ultra-ink:rgb(from var(--dsw-alias-label-primary,#20242c) r g b / 1);--ultra-accent:rgb(from var(--dsw-alias-state-info-label,#5069cb) r g b / 1);--ultra-danger:rgb(from var(--dsw-alias-state-error-primary,#d84c4c) r g b / 1);--ultra-hover:color-mix(in srgb,var(--ultra-surface) 92%,var(--ultra-ink) 8%)}",
  ".dsh-ultra-team{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:0 0 30px;width:30px;height:28px;padding:0 1px;border:0;border-radius:24px;background:var(--ultra-surface,#fff);color:var(--dsw-alias-label-secondary,#686c75);font-family:inherit;font-size:12px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}",
  ".dsh-ultra-team:hover:not(:disabled){background:var(--ultra-hover,#edf0f5)}",
  ".dsh-ultra-team[aria-pressed=true]{color:var(--ultra-accent);background:color-mix(in srgb,var(--ultra-surface) 90%,var(--ultra-accent) 10%)}",
  ".dsh-ultra-team:focus-visible{outline:2px solid var(--dsw-alias-border-l3,#7a9be0);outline-offset:2px}",
  ".dsh-ultra-team:disabled{color:var(--dsw-alias-label-dimmed,#9599a1);cursor:default}",
  ".dsh-ultra-pool-trigger{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:0 0 38px;width:38px;height:28px;padding:0 1px;border:0;border-radius:24px;background:var(--ultra-surface,#fff);color:var(--dsw-alias-label-secondary,#686c75);font-family:inherit;font-weight:500;font-size:11px;line-height:20px;white-space:nowrap;cursor:pointer}.dsh-ultra-pool-trigger:hover:not(:disabled){background:var(--ultra-hover,#edf0f5)}.dsh-ultra-pool-trigger:focus-visible{outline:2px solid var(--dsw-alias-border-l3,#7a9be0);outline-offset:2px}.dsh-ultra-pool-trigger:disabled{opacity:.55;cursor:default}.dsh-ultra-pool-narrow{display:none}.dsh-ultra-pool-status{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;width:240px;padding:12px;border-radius:8px;background:var(--ultra-surface,#fff);box-shadow:0 4px 20px #0003;font-size:12px;overflow-wrap:anywhere}",
  ".dsh-ultra-trigger{position:relative;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:2px;flex:0 0 56px;width:56px;height:28px;padding:0 1px;border:0;border-radius:24px;background:var(--ultra-surface,#fff);color:var(--dsw-alias-label-secondary,#686c75);font-family:inherit;font-size:12px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer}",
  ".dsh-ultra-trigger:hover:not(:disabled){background:var(--ultra-hover,#edf0f5)}",
  ".dsh-ultra-trigger:focus-visible{outline:2px solid var(--dsw-alias-border-l3,#7a9be0);outline-offset:2px}",
  ".dsh-ultra-trigger:disabled{color:var(--dsw-alias-label-dimmed,#9599a1);cursor:default}",
  ".dsh-ultra[data-enabled=true] .dsh-ultra-trigger{color:var(--dsw-alias-state-info-label,#5069cb);background:color-mix(in srgb,var(--ultra-surface) 90%,var(--ultra-accent) 10%)}",
  ".dsh-ultra-value,.dsh-ultra-chevron{color:var(--dsw-alias-label-caption,#858994)}",
  ".dsh-ultra[data-enabled=true] .dsh-ultra-value{color:inherit}",
  ".dsh-ultra-chevron{display:none;flex:none;width:8px;height:8px;transition:transform 120ms ease}",
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
  "@container(max-width:440px){.dsh-ultra{flex-basis:96px;width:96px;max-width:96px}.dsh-ultra-pool-trigger{flex-basis:28px;width:28px}.dsh-ultra-trigger{flex-basis:30px;width:30px}.dsh-ultra-pool-full,.dsh-ultra-name{display:none}.dsh-ultra-pool-narrow{display:inline}}",
  "@media(prefers-reduced-motion:reduce){.dsh-ultra-trigger:after{animation:none!important}.dsh-ultra-chevron{transition:none}}"
].join("");
function validEvidence(raw) {
  const object2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const text = (value) => typeof value === "string" && value.length <= 2e4;
  const optional = (value, check) => value === void 0 || check(value);
  const strings = (value) => Array.isArray(value) && value.length <= 1e3 && value.every(text);
  const finiteTree = (value, key = "", depth = 0) => {
    if (depth > 12) return false;
    if (typeof value === "number") return Number.isSafeInteger(value) && (value >= 0 || key === "remainingTokens");
    if (value === null || typeof value === "boolean" || text(value)) return true;
    if (Array.isArray(value)) return value.length <= 4096 && value.every((item) => finiteTree(item, "", depth + 1));
    return object2(value) && Object.keys(value).length <= 512 && Object.entries(value).every(([name, item]) => finiteTree(item, name, depth + 1));
  };
  const budget = (value) => object2(value) && count(value.totalTokens) && optional(value.estimated, (item) => typeof item === "boolean") && finiteTree(value);
  if (!object2(raw) || !finiteTree(raw) || typeof raw.enabled !== "boolean" || typeof raw.available !== "boolean" || !optional(raw.phase, text) || !optional(raw.runId, text) || !optional(raw.error, text) || !optional(raw.retrievals, count) || !optional(raw.unresolvedConflicts, count) || !optional(raw.errors, strings)) return false;
  if (raw.coverage !== void 0) {
    if (raw.coverage === "unknown") {
      if (raw.available) return false;
    } else {
      const coverage = raw.coverage;
      if (!object2(coverage) || !object2(coverage.raw) || !object2(coverage.semantic) || !object2(coverage.raw.coverage)) return false;
      const rawCounts = coverage.raw, semanticCounts = coverage.semantic, sourceCoverage = rawCounts.coverage;
      if (!["sources", "chunks", "characters", "attachments"].every((key) => count(rawCounts[key])) || !["total", "current", "superseded", "unresolved"].every((key) => count(semanticCounts[key])) || !["host", "captured", "truncated", "reference-only"].every((key) => count(sourceCoverage[key]))) return false;
    }
  }
  if (raw.compression !== void 0 && raw.compression !== null) {
    const value = raw.compression;
    if (!object2(value) || !text(value.status) || !optional(value.originalHistoryRetained, (item) => typeof item === "boolean") || !optional(value.limits, strings) || !optional(value.replacements, Array.isArray)) return false;
    const partial = ["failed", "unsupported", "disabled", "limited"].includes(value.status);
    for (const metrics of [value.before, value.after]) {
      if (metrics === void 0 || metrics === null) {
        if (!partial) return false;
      } else if (!budget(metrics)) return false;
    }
  }
  if (raw.archive !== void 0 && raw.archive !== null) {
    const value = raw.archive;
    const keys = [
      "status",
      "before",
      "after",
      "committed",
      "persistenceUncertain",
      "receiptId",
      "limits",
      "triggerTokens",
      "selectedSeqs",
      "startSeq",
      "pruneSeq",
      "replacementSeq",
      "endSeq",
      "rawHistoryRetained",
      "persistenceRecovered",
      "reason"
    ];
    if (!object2(value) || Object.keys(value).some((key) => !keys.includes(key)) || !["disabled", "unsupported", "unchanged", "limited", "archived", "failed"].includes(String(value.status)) || !["committed", "persistenceUncertain", "rawHistoryRetained", "persistenceRecovered"].every((key) => optional(value[key], (item) => typeof item === "boolean")) || value.persistenceUncertain === true && value.committed !== true || !optional(value.receiptId, (item) => typeof item === "string" && /^arc_[a-f0-9]{64}$/u.test(item)) || !optional(value.limits, strings) || !optional(value.reason, text) || !["triggerTokens", "startSeq", "pruneSeq", "replacementSeq", "endSeq"].every((key) => optional(value[key], count)) || !optional(value.selectedSeqs, (item) => Array.isArray(item) && item.every(count))) return false;
    const partial = ["failed", "unsupported", "disabled", "limited"].includes(String(value.status));
    for (const metrics of [value.before, value.after]) {
      if (metrics === void 0 || metrics === null) {
        if (!partial) return false;
      } else if (!budget(metrics) || !object2(metrics) || metrics.estimated !== true) return false;
    }
    if (value.status === "archived" && (value.committed !== true || typeof value.receiptId !== "string")) return false;
  }
  if (raw.resources !== void 0) {
    const value = raw.resources;
    if (!object2(value) || !optional(value.attemptedCalls, count) || !["settledCalls", "measuredTokens", "unknownUsageCalls"].every((key) => count(value[key])) || !(value.estimates === void 0 || value.estimates === null || budget(value.estimates))) return false;
    const routeCounts = ["settledCalls", "measuredTokens", "unknownUsageCalls"];
    if (value.byRoute !== void 0 && (!object2(value.byRoute) || !Object.values(value.byRoute).every((route) => object2(route) && Object.keys(route).every((key) => routeCounts.includes(key)) && routeCounts.every((key) => count(route[key]))))) return false;
  }
  if (raw.routes !== void 0 && (!Array.isArray(raw.routes) || raw.routes.length > 1e3 || !raw.routes.every((route) => object2(route) && text(route.routeId) && text(route.status)))) return false;
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
  if (evidence.archive) {
    const { status, before, after, receiptId, persistenceUncertain, limits } = evidence.archive;
    lines.push(before && after ? t("evidence.archive", { status, before: before.totalTokens, after: after.totalTokens }) : t("evidence.archiveStatus", { status }));
    if (receiptId) lines.push(t("evidence.archiveReceipt", { id: receiptId }));
    if (persistenceUncertain) lines.push(t("evidence.archivePaused"));
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
function validGovernance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value;
  const count = (n) => Number.isSafeInteger(n) && Number(n) >= 0;
  if (item.enabled !== true || typeof item.taskHash !== "string" || !/^[a-f0-9]{64}$/.test(item.taskHash) || !count(item.taskRevision) || item.taskRevision === 0 || !["originalChars", "intentItems", "queued", "admitted", "requestVisible", "effectVerified", "closedDirections"].every((key) => count(item[key])) || typeof item.durable !== "boolean" || typeof item.closed !== "boolean" || !Array.isArray(item.errors) || item.errors.length > 64 || !item.errors.every((error) => typeof error === "string" && error.length <= 2e3)) return false;
  if (item.verification !== null) {
    if (!item.verification || typeof item.verification !== "object") return false;
    const review = item.verification;
    if (review.hostVerified !== false || typeof review.allSatisfied !== "boolean" || !["satisfied", "failed", "unverified"].every((key) => count(review[key]))) return false;
  }
  return true;
}
function governanceLines(value, t) {
  return [
    t("governance.contract", { version: value.taskRevision, chars: value.originalChars, items: value.intentItems }),
    t("governance.delivery", { queued: value.queued, admitted: value.admitted, visible: value.requestVisible, verified: value.effectVerified }),
    value.verification ? t("governance.review", value.verification) : t("governance.noReview"),
    t(value.durable ? "governance.durable" : "governance.memoryOnly"),
    ...value.errors
  ];
}
function readSnapshot2(raw, t) {
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
  if (typeof value.enabled !== "boolean" || decisionOnly && value.concurrency !== 1 || value.concurrency !== 1 && value.concurrency !== 2 && value.concurrency !== 3 && value.concurrency !== 4 && value.concurrency !== 5 || typeof value.running !== "boolean" || !Number.isInteger(value.activeRuns) || (value.activeRuns ?? -1) < 0 || value.lastRun !== null && (typeof value.lastRun !== "object" || value.lastRun === void 0 || !Number.isFinite(value.lastRun.at) || !Number.isFinite(value.lastRun.ms) || value.lastRun.ms < 0) || value.phase !== void 0 && typeof value.phase !== "string" || value.error !== void 0 && value.error !== null && typeof value.error !== "string" || value.warnings !== void 0 && (!Array.isArray(value.warnings) || value.warnings.some((item) => typeof item !== "string")) || value.collaborationEnabled !== void 0 && typeof value.collaborationEnabled !== "boolean" || value.evidence !== void 0 && !validEvidence(value.evidence) || value.governance !== void 0 && !validGovernance(value.governance)) return invalid();
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
  const [view, setView] = import_react2.default.useState({ sessionId, snapshot: null, pending: false, syncError: null, actionError: null });
  const [open, setOpen] = import_react2.default.useState(false);
  const [poolOpen, setPoolOpen] = import_react2.default.useState(false);
  const [poolPanel, setPoolPanel] = import_react2.default.useState(null);
  const [poolLoading, setPoolLoading] = import_react2.default.useState(false);
  const [poolError, setPoolError] = import_react2.default.useState(null);
  const rootRef = import_react2.default.useRef(null);
  const triggerRef = import_react2.default.useRef(null);
  const optionRefs = import_react2.default.useRef([]);
  const retryRef = import_react2.default.useRef(null);
  const scopeRef = import_react2.default.useRef({ sessionId, rpc, disposed: false, reading: false, mutating: false, revision: 0 });
  const menuId = import_react2.default.useId();
  const available = typeof sessionId === "string" && sessionId.trim() !== "";
  if (scopeRef.current.sessionId !== sessionId || scopeRef.current.rpc !== rpc) {
    scopeRef.current.disposed = true;
    scopeRef.current = { sessionId, rpc, disposed: false, reading: false, mutating: false, revision: 0 };
  }
  const current = view.sessionId === sessionId ? view : { sessionId, snapshot: null, pending: false, syncError: null, actionError: null };
  const snapshot = current.snapshot;
  const error = current.actionError ?? current.syncError ?? snapshot?.error ?? null;
  import_react2.default.useEffect(() => {
    const scope = scopeRef.current;
    scope.disposed = false;
    setOpen(false);
    setPoolOpen(false);
    setPoolLoading(false);
    setPoolError(null);
    setView({ sessionId, snapshot: null, pending: false, syncError: null, actionError: null });
    if (!available) return () => {
      scope.disposed = true;
    };
    const sync = async () => {
      if (scope.disposed || scope.reading || scope.mutating) return;
      scope.reading = true;
      const revision = scope.revision;
      try {
        const state = readSnapshot2(await rpc.call(RPC_CHANNEL, "get", { sessionId }), t);
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
  import_react2.default.useEffect(() => {
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
  const togglePool = () => {
    if (!available) return;
    setOpen(false);
    if (poolOpen) {
      setPoolOpen(false);
      return;
    }
    setPoolOpen(true);
    if (poolPanel || poolLoading) return;
    const scope = scopeRef.current;
    setPoolLoading(true);
    setPoolError(null);
    void Promise.resolve().then(() => (init_model_pool(), model_pool_exports)).then((module2) => {
      if (scopeRef.current !== scope || scope.disposed) return;
      setPoolPanel(() => module2.ModelPoolPanel);
    }).catch((cause) => {
      if (scopeRef.current === scope && !scope.disposed) setPoolError(cause instanceof Error ? cause.message : t("error.connection"));
    }).finally(() => {
      if (scopeRef.current === scope && !scope.disposed) setPoolLoading(false);
    });
  };
  const mutate = async (patch, closeMenu) => {
    const scope = scopeRef.current;
    if (!available || snapshot === null || scope.mutating || scope.disposed) return;
    scope.mutating = true;
    scope.revision += 1;
    setView((previous) => ({ ...previous, pending: true, actionError: null }));
    try {
      const saved = readSnapshot2(await rpc.call(RPC_CHANNEL, "set", {
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
  const detailSummary = (label) => import_react2.default.createElement("summary", {
    onMouseDown: (event) => {
      event.preventDefault();
    }
  }, label);
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
  return import_react2.default.createElement(
    "div",
    {
      // Host locale already supplies labels; automatic translation can alter stable IDs.
      ref: rootRef,
      className: "dsh-ultra",
      translate: "no",
      "data-plugin": PLUGIN_ID,
      "data-enabled": snapshot?.enabled === true,
      "data-error": Boolean(error),
      "data-running": snapshot?.running === true,
      "data-pending": current.pending,
      onKeyDown,
      onBlur: (event) => {
        if (event.relatedTarget === null) return;
        if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
        close();
      }
    },
    import_react2.default.createElement("button", {
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
    import_react2.default.createElement(
      "button",
      {
        type: "button",
        className: "dsh-ultra-pool-trigger",
        disabled: !available,
        "aria-label": t("pool.label"),
        "aria-haspopup": "dialog",
        "aria-expanded": poolOpen,
        title: t("pool.title"),
        onClick: togglePool,
        onKeyDown: (event) => {
          event.stopPropagation();
        }
      },
      import_react2.default.createElement("span", { className: "dsh-ultra-pool-full" }, t("pool.compact")),
      import_react2.default.createElement("span", { className: "dsh-ultra-pool-narrow", "aria-hidden": true }, t("pool.narrow"))
    ),
    import_react2.default.createElement(
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
          setPoolOpen(false);
          setOpen((previous) => !previous);
        }
      },
      import_react2.default.createElement("span", { className: "dsh-ultra-name" }, decisionOnly ? "Decision" : "Ultra"),
      import_react2.default.createElement("span", { className: "dsh-ultra-value" }, available ? valueLabel : t("trigger.off")),
      import_react2.default.createElement("span", { className: "dsh-ultra-status", role: "status", "aria-live": "polite" }, ultraDescription),
      import_react2.default.createElement(
        "svg",
        { className: "dsh-ultra-chevron", viewBox: "0 0 10 10", fill: "none", "aria-hidden": true },
        import_react2.default.createElement("path", { d: "m2 3.5 3 3 3-3", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" })
      )
    ),
    poolOpen && (poolLoading || poolError) ? import_react2.default.createElement("div", { className: "dsh-ultra-pool-status", role: poolError ? "alert" : "status" }, poolError ?? t("pool.loading")) : null,
    poolOpen && poolPanel && available ? import_react2.default.createElement(poolPanel, {
      key: sessionId,
      sessionId,
      rpc,
      anchor: rootRef.current?.getBoundingClientRect?.(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      onClose: () => {
        setPoolOpen(false);
      }
    }) : null,
    !open ? null : import_react2.default.createElement(
      "div",
      { className: "dsh-ultra-menu", id: menuId, role: "menu", "aria-label": t("menu.title"), style: menuStyle },
      import_react2.default.createElement(
        "div",
        { className: "dsh-ultra-heading" },
        t("menu.title"),
        import_react2.default.createElement("div", { className: "dsh-ultra-description" }, t("menu.description"))
      ),
      ...LEVELS.map((level, index) => {
        const selected = snapshot !== null && (level === 0 ? !snapshot.enabled : snapshot.enabled && snapshot.concurrency === level);
        return import_react2.default.createElement(
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
          import_react2.default.createElement(
            "span",
            null,
            import_react2.default.createElement("span", { className: "dsh-ultra-option-label" }, t(level === 0 ? "menu.off" : level === 1 ? "menu.assisted" : "menu.routes", { count: level })),
            import_react2.default.createElement("span", { className: "dsh-ultra-detail" }, t(level === 0 ? "menu.offDetail" : level === 1 ? "menu.assistedDetail" : "menu.routesDetail"))
          ),
          !selected ? null : import_react2.default.createElement(
            "svg",
            { className: "dsh-ultra-check", viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
            import_react2.default.createElement("path", { d: "m3 8 3 3 7-7", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" })
          )
        );
      }),
      error ? import_react2.default.createElement(
        "div",
        { className: "dsh-ultra-error", role: "alert" },
        import_react2.default.createElement("span", null, error),
        current.syncError ? import_react2.default.createElement("button", {
          type: "button",
          className: "dsh-ultra-retry",
          onClick: () => {
            void retryRef.current?.();
          }
        }, t("error.retry")) : null
      ) : null,
      snapshot?.warnings?.length ? import_react2.default.createElement(
        "details",
        { className: "dsh-ultra-warning" },
        detailSummary(t("status.warnings", { count: snapshot.warnings.length })),
        ...snapshot.warnings.map((warning, index) => import_react2.default.createElement("div", { key: index }, warning))
      ) : null,
      evidence ? import_react2.default.createElement(
        "details",
        { className: "dsh-ultra-warning", "aria-label": t("evidence.title") },
        detailSummary(t("evidence.title")),
        ...evidenceLines(evidence, t).map((line, index) => import_react2.default.createElement("div", { key: index }, line))
      ) : null,
      snapshot?.governance ? import_react2.default.createElement(
        "details",
        { className: "dsh-ultra-warning", "aria-label": t("governance.title") },
        detailSummary(t("governance.title")),
        ...governanceLines(snapshot.governance, t).map((line, index) => import_react2.default.createElement("div", { key: index }, line))
      ) : null,
      import_react2.default.createElement(
        "div",
        { className: "dsh-ultra-footer", role: "status", "aria-live": "polite" },
        snapshot === null ? t("trigger.loading") : t("status.runs", { phase: status, count: snapshot.activeRuns }),
        snapshot?.running ? import_react2.default.createElement("div", null, t("menu.runningHint")) : null,
        snapshot?.lastRun ? import_react2.default.createElement("div", null, t("status.lastRun", { seconds: (snapshot.lastRun.ms / 1e3).toFixed(1) })) : null
      )
    )
  );
}
var inject = ["slots", "connection", "locale", "sessions"];
function apply(ctx) {
  const connection = ctx.get("connection");
  const rpc = connection?.rpc;
  if (rpc === void 0) throw new Error(PLUGIN_ID + " requires connection.rpc");
  ctx.effect(() => hideRouteSessions(ctx.sessions.list), "dsh-ultra-mode: internal route sessions");
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), "dsh-ultra-mode: dictionaries");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = PLUGIN_ID;
    style.textContent = ULTRA_CSS;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, "dsh-ultra-mode: styles");
  ctx.effect(() => ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
    name: "conversation.input.right",
    id: PLUGIN_ID,
    order: 30,
    label: decisionOnly ? "Decision" : "Ultra",
    locale: LOCALE_NAMESPACE,
    // Session identity is a registrant-owned face on the installed DSH slot API.
    inject: (sessionId) => ({ sessionId })
  }, (props) => import_react2.default.createElement(UltraButton, { ...props, key: props.sessionId, rpc }))), "dsh-ultra-mode: button");
}
return module.exports;
} });
//# sourceMappingURL=client.js.map
