/** User-owned native profile policy. Models receive tools, never this configuration writer. */
import z from '@deepseek-ai/schemastery'
export const GlobalKnowledgeSchema = z.object({
  enabled: z.boolean().default(false).description('启用当前profile显式授权知识库；切换启用状态后重载插件或重启，项目授权热修改即时生效'),
  projects: z.array(z.object({
    id: z.string().description('稳定项目ID；更换实际目录不会继承旧共享授权'),
    root: z.string().description('该项目真实绝对目录；不接受模型指定路径'),
    read: z.boolean().default(false).description('允许该项目从已明确共享给它的发布中检索'),
    publish: z.boolean().default(false).description('允许该项目主Agent/可写decision向shareWith发布；worker/辅助/普通子代理禁止'),
    shareWith: z.array(z.string()).default([]).description('发布目标的已配置项目ID；每次发布保存范围快照，新加目标不追溯扩大旧内容'),
  })).default([]),
  maxSearchChars: z.number().step(1).min(512).max(32000).default(6000).description('检索实际JSON字符预算，包含元数据'),
  maxGetChars: z.number().step(1).min(512).max(64000).default(12000).description('读取实际JSON字符预算；更长文档按offset分页'),
}).default({ enabled: false, projects: [], maxSearchChars: 6000, maxGetChars: 12000 }).volatile()
