/** Native profile schema and Settings bridge; no parallel configuration store. */
import z from '@deepseek-ai/schemastery'
import { ModelPool, readModelPool, type ModelPoolHost, type ModelPoolSource } from './model-pool.js'
import type { TeamSnapshot } from './collaboration.js'

export const ModelPoolSchema = z.object({
  models: z.array(z.object({
    id: z.string().description('稳定配置ID；不随显示名称变更'),
    name: z.string().description('显示名称'), enabled: z.boolean().default(true).description('启用候选'),
    provider: z.string().description('宿主已配置provider，不保存密钥'), model: z.string().description('该provider中的实际模型ID'),
    strengths: z.string().default('').description('用户声明的擅长能力，不是兼容性证明'),
    suitableFor: z.string().default('').description('适用场景'), avoidFor: z.string().default('').description('不适用场景'),
    reasoningEffort: z.string().description('可选思考强度，必须由宿主精确模型元数据支持'),
    maxTokens: z.number().step(1).min(1).max(1000000).description('可选单请求输出上限，供应商最大值未知时仍需实际验收'),
    isDefault: z.boolean().default(false).description('默认候选，最多一个启用默认'),
    maxConcurrent: z.number().step(1).min(1).max(32).default(1).description('该配置同时活动的普通子代理上限'),
    allowCrossProvider: z.boolean().default(false).description('配置用户授权向其他provider发送普通子任务数据'),
    allowUnverifiedTools: z.boolean().default(false).description('配置用户允许试用工具兼容性未知的模型；仍标记未验证'),
    costNote: z.string().default('').description('可选成本说明；实测须写来源、条件和时间'),
    costSource: z.union(['user', 'measured']).default('user').description('user=用户填写；measured=用户提供实测记录'),
    speedNote: z.string().default('').description('可选速度说明；实测须写来源、条件和时间'),
    speedSource: z.union(['user', 'measured']).default('user').description('user=用户填写；measured=用户提供实测记录'),
  })).default([]).description('普通协作模型候选，空池沿用原生继承'),
  explicitModelId: z.string().default('').description('配置用户固定ID，优先于主智能体选择；留空自主选择'),
  fallback: z.union(['error', 'default', 'inherit']).default('error').description('失败回退；默认报错，允许回退表示授权可能不同的成本'),
  maxConcurrent: z.number().step(1).min(1).max(32).default(2).description('该插件普通协作模型池的总活动子代理上限'),
  maxRequests: z.number().step(1).min(0).max(1000000).default(0).description('每轮普通协作池原生请求次数预算；0不增加上限，宿主限制继续生效'),
  failureLimit: z.number().step(1).min(1).max(100).default(3).description('同一候选快照连续失败后停止派发，修改候选后重新验收'),
}).default({ models: [], fallback: 'error', maxConcurrent: 2, maxRequests: 0, failureLimit: 3 }).volatile()

interface SettingsContext {
  fiber?: { entry?: { options?: { id?: string } } }
  get(name: string): unknown
}
export function createModelPoolSettings(ctx: SettingsContext, config: { collaborationModelPool?: ModelPoolSource }, records: (id: string) => TeamSnapshot[] | Promise<TeamSnapshot[]>) {
  const llm = ctx.get('llm') as ModelPoolHost | undefined
  const pool = new ModelPool(() => config.collaborationModelPool, llm!)
  const persistence = () => {
    const settings = ctx.get('settings') as { update(ns: string, patch: unknown): Promise<unknown> } | undefined
    const id = ctx.fiber?.entry?.options?.id
    return settings?.update && id ? { settings, id } : undefined
  }
  const get = async (sessionId: string) => {
    const value = readModelPool(config.collaborationModelPool)
    const catalog = new Map<string, { provider: string; model: string; name: string }>(), catalogErrors: string[] = []
    const key = (provider: string, model: string) => JSON.stringify([provider, model])
    const configured = new Set(value.models.map(m => key(m.provider, m.model)))
    let truncated = false
    if (llm) for (const provider of llm.listProviders()) {
      try { for (const m of await llm.listModels(provider.id)) if (m.provider === provider.id) {
        const id = key(m.provider, m.id)
        if (catalog.size < 9968 || configured.has(id)) catalog.set(id, { provider: m.provider, model: m.id, name: m.name ?? m.id })
        else truncated = true
      } }
      catch { catalogErrors.push(`${provider.id} 的宿主模型目录暂不可用`) }
    }
    for (const m of value.models) if (!catalog.has(key(m.provider, m.model))) catalog.set(key(m.provider, m.model), { provider: m.provider, model: m.model, name: `${m.name}（已保存配置，宿主目录未确认）` })
    if (truncated) catalogErrors.push('宿主目录超过展示预算，已保留当前配置的候选；最终可用性仍由创建前校验')
    return { config: value, hostModels: [...catalog.values()], editable: !!persistence(), records: await records(sessionId), catalogErrors: catalogErrors.slice(0, 128) }
  }
  const save = async (sessionId: string, value: unknown) => {
    const next = readModelPool(value), target = persistence()
    if (!target) throw new Error('原生 Settings 或 profile entry 不可用，不能确认配置持久化')
    // Native Settings merges object fields. An absent optional key would retain
    // an earlier fixed ID, so explicitly unset it using the schema's empty value.
    await target.settings.update(target.id, { collaborationModelPool: { ...next, explicitModelId: next.explicitModelId ?? '' } })
    return get(sessionId)
  }
  return { pool, get, save }
}
