import z from '@deepseek-ai/schemastery';
import { apply as applyUltra, Config as UltraConfig, ConfigFields } from './index.js';
export const name = '@dsh-external/dsh-ultra-decision';
export const inject = ['agents', 'tools', 'systemPrompt'];
// Native schema nodes are the same nodes as Ultra. Route-count/tool-entry fields
// deliberately never enter this package's public configuration boundary.
const fields = { ...ConfigFields };
const { toolName: _toolName, concurrency: _concurrency, ...ordinaryFields } = fields;
export const Config = z.object({
    ...ordinaryFields,
    decisionAssistEnabled: z.boolean().default(false).description('明确开启后才为普通主 Agent 启动一条只读决策辅助；默认不增加模型请求'),
});
export function apply(ctx, config) {
    // The host already resolved Decision's native schema (including volatile
    // model-pool settings). Only fill the two internal Ultra defaults here.
    const resolved = { ...UltraConfig({}), ...config, concurrency: 1, decisionAssistEnabled: config.decisionAssistEnabled === true };
    return applyUltra(ctx, resolved, 'decision');
}
//# sourceMappingURL=decision-plugin.js.map