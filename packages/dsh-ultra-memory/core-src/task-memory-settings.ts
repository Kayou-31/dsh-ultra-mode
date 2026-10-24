import z from '@deepseek-ai/schemastery'
export const TaskMemoryFields = {
  taskMemoryEnabled: z.boolean().default(true).description('原生动态上下文中的工程分层记忆；只注入有界资料，不创建模型，不代替当前文件核验'),
  taskMemoryMaxBytes: z.number().step(1).min(2048).max(65536).default(8192).description('整个注入文本的 UTF-8 字节上限；必要约束放不下时暂停新增压缩并保留原历史'),
  taskMemoryConditionalRecall: z.boolean().default(true).description('按当前用户问题与来源主题／文件线索条件召回；不相关、失效或预算外的候选不注入'),
  taskMemoryRecallLimit: z.number().step(1).min(0).max(16).default(6).description('每份记忆包最多条件召回条数；不包含当前目标和项目状态'),
}
