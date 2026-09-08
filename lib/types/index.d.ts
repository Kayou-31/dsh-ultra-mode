/**
 * @dsh-external/dsh-ultra-mode — ULTRA 并发模式（host 半）。
 *
 * 一次处理一件事时并发 N 个独立 agent（self-consistency），全部完成后由
 * 第 N+1 个 agent 交叉核对并合并成一份最终答案。附带 composer 滑块开关
 * （辐射光效 + 运行态"燃烧"光效）、/ultra 命令、按会话动态注入的提示词引导。
 *
 * 兼容性与正确性要点：
 * - `tools` / `subagents` 为核心依赖；`commands` / `systemPrompt` /
 *   `connection` 为软依赖，缺席时对应功能自动裁剪。
 * - 状态按会话（agent.id）隔离，读取不创建条目，Map 有上限与 LRU 淘汰。
 * - 提示词段在**每次装配时**读取当前会话开关状态（`context.agent`），
 *   模型因此始终知道开关的真实位置，而不是从静态文案里猜。
 * - 每个 run（worker 与 merger）都进入统一 `finally` 清理；重叠调用用
 *   `activeRuns` 计数，UI 的"燃烧态"不会因先结束的一次而提前熄灭。
 * - 成功样本 < 2 时不再"静默降级"；2..N-1 时降级合并并明确告知
 *   merger 与用户本次只成功了几路。
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
    /** 会话状态条目上限（超出按最久未用淘汰）。 */
    maxSessions: z<number, number>;
}>, Schemastery.ObjectT<{
    /** subagent provider 名；留空自动探测（spawn → 首个可用）。 */
    provider: z<string, string>;
    /** 模型可见工具名。 */
    toolName: z<string, string>;
    /** 默认并发路数 2-5。 */
    concurrency: z<number, number>;
    /** 提示词段插入顺序。 */
    sectionOrder: z<number, number>;
    /** 会话状态条目上限（超出按最久未用淘汰）。 */
    maxSessions: z<number, number>;
}>>;
export type Config = {
    provider: string;
    toolName: string;
    concurrency: number;
    sectionOrder: number;
    maxSessions: number;
};
export declare function apply(ctx: Context & {
    tools: ToolsService;
    subagents: SubagentService;
}, config: Config): void;
export {};
