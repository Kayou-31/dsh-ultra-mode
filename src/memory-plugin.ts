/** Optional memory/knowledge companion; never creates a model or coordination loop. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GlobalKnowledgeSchema } from './knowledge-settings.js'
import { acquireEvidenceSupport, type EvidenceSupportConfig } from './evidence-support.js'

export const name = '@dsh-external/dsh-ultra-memory'
export const inject = ['agents', 'tools', 'systemPrompt']
export const Config = z.object({
  evidenceEnabled: z.boolean().default(true),
  globalKnowledge: GlobalKnowledgeSchema,
  memorySearchChars: z.number().step(1).min(256).max(32000).default(6000),
  memoryGetChars: z.number().step(1).min(256).max(64000).default(12000),
  contextTargetTokens: z.number().step(1).min(4096).max(1000000).default(30000),
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
