/**
 * @dsh-external/dsh-ultra-mode — ULTRA 并发模式。
 *
 * 一次处理一件事时并发 N 个独立 agent（self-consistency），全部完成后由
 * 第 N+1 个 agent 交叉核对并合并成一份最终答案。附带 composer 滑块开关
 * （辐射光效 + 燃烧态）、/ultra 命令、动态提示词引导。
 *
 * 兼容性设计：
 * - `tools` / `subagents` 为核心依赖（缺失则整体等待）；`commands` /
 *   `systemPrompt` / `connection` 全部软依赖，缺席时对应功能自动裁剪。
 * - 状态按会话（agent.id）隔离，多会话互不串扰；全局装配安全。
 * - provider 可通过 config 指定；留空则自动探测（spawn → 首个可用）。
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
interface ContentBlockLike {
    type: string;
    text?: string;
    [key: string]: unknown;
}
interface RunLike {
    id: string;
    result: Promise<{
        stopReason: string;
        diagnostic?: string;
        output?: ContentBlockLike[];
    }>;
    dispose(): Promise<unknown>;
}
interface AgentLike {
    id: string;
}
interface SubagentService {
    list(): string[];
    start(provider: string, request: {
        label: string;
        prompt: ContentBlockLike[];
        parent: AgentLike;
        signal?: AbortSignal;
    }): Promise<RunLike>;
}
interface ToolsService {
    register(definition: unknown): () => void;
}
export declare const name = "@dsh-external/dsh-ultra-mode";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<{
    /** subagent provider 名；留空自动探测（spawn → 首个可用）。 */
    provider: z<string, string>;
    /** 模型可见工具名。 */
    toolName: z<string, string>;
    /** 默认并发路数 2-5。 */
    concurrency: z<number, number>;
    /** 提示词段插入顺序。 */
    sectionOrder: z<number, number>;
}>, Schemastery.ObjectT<{
    /** subagent provider 名；留空自动探测（spawn → 首个可用）。 */
    provider: z<string, string>;
    /** 模型可见工具名。 */
    toolName: z<string, string>;
    /** 默认并发路数 2-5。 */
    concurrency: z<number, number>;
    /** 提示词段插入顺序。 */
    sectionOrder: z<number, number>;
}>>;
export type Config = {
    /** subagent provider 名；留空自动探测。 */
    provider: string;
    /** 模型可见工具名。 */
    toolName: string;
    /** 默认并发路数 2-5。 */
    concurrency: number;
    /** 提示词段插入顺序。 */
    sectionOrder: number;
};
export declare function apply(ctx: Context & {
    tools: ToolsService;
    subagents: SubagentService;
}, config: Config): void;
export {};
