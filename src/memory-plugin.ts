/** Optional memory/knowledge companion; never creates a model or coordination loop. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GlobalKnowledgeSchema } from './knowledge-settings.js'
import { acquireEvidenceSupport, type EvidenceSupportConfig } from './evidence-support.js'
import { TaskMemoryFields } from './task-memory-settings.js'

export const name = '@dsh-external/dsh-ultra-memory'
export const inject = ['agents', 'tools', 'systemPrompt']
export const Config = z.object({
  ...TaskMemoryFields,
  evidenceEnabled: z.boolean().default(true),
  globalKnowledge: GlobalKnowledgeSchema,
  memorySearchChars: z.number().step(1).min(256).max(32000).default(6000),
  memoryGetChars: z.number().step(1).min(256).max(64000).default(12000),
  contextTargetTokens: z.number().step(1).min(4096).max(1000000).default(30000),
  contextTriggerTokens: z.number().step(1).min(4096).max(1000000).required(false).description('启动压缩的含预留空间预算；省略时沿用压后目标，配置时须大于或等于 contextTargetTokens'),
  contextRetainRecentMessages: z.number().step(1).min(2).max(128).default(8).description('保留近期历史窗口；仅压缩窗口外已配对纯文本工具结果，用户要求与附件保持原样'),
  contextMinResultChars: z.number().step(1).min(64).max(1000000).default(4096).description('可压缩纯文本工具结果的最小字符数；须有已校验的持久来源'),
  contextMaxPrunes: z.number().step(1).min(1).max(256).default(16),
  contextPreviewChars: z.number().step(1).min(0).max(4096).default(320),
  contextCompactLocators: z.boolean().default(false).description('用精简恢复定位替代每条结果中重复的状态、来源列表与预览'),
  contextRetrievalReceipts: z.boolean().default(false).description('允许压缩本地 memory 检索返回；仅保存宿主来源与校验元数据，不重复索引正文，不压全局知识返回'),
  contextArchiveCompletedTurns: z.boolean().default(false).description('实验性：归档已完成旧阶段，逐字保留用户要求与公开进展，原文按 arc_ID 分页恢复；提交后持久化失败会停止执行，不伪称已回滚'),
  contextOutputReserveTokens: z.number().step(1).min(256).max(100000).default(4096),
  contextToolReserveTokens: z.number().step(1).min(256).max(100000).default(2048),
  contextCompression: z.boolean().default(false),
  memoryMaxRequests: z.number().step(1).min(0).max(100000).default(0),
  memoryMaxTokens: z.number().step(1).min(0).max(100000000).default(0),
})
export type Config = EvidenceSupportConfig
export function apply(ctx: Context, config: Config): Promise<void> {
  const lease = acquireEvidenceSupport(ctx, config, { owner: 'memory', canPublish: agent => {
    if (agent.status !== 'running' || agent.session.header.parentSession !== undefined) return false
    try {
      const policy = agent.ctx.get('sandboxPolicy') as { resolve(input: { session: typeof agent.session }): { mode?: string } } | undefined
      return policy?.resolve({ session: agent.session }).mode !== 'read-only'
    } catch { return false }
  } })
  ctx.effect(() => () => lease.release(), 'dsh-ultra-memory: evidence lease')
  return lease.ready()
}
