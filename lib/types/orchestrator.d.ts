import type { AgentLike as RouteParent, ContentBlock, createRoute } from './runtime.js';
export interface RunConfig {
    toolName: string;
    timeoutMs: number;
    reportChars: number;
    researchTools: string[];
    jevEnabled: boolean;
    jevKeyEnv: string;
    jevModel: string;
    jevBaseUrl: string;
    jevTimeoutMs: number;
}
export interface RunOptions {
    parent: RouteParent;
    task: string;
    content: ContentBlock[];
    concurrency: number;
    signal: AbortSignal;
    route?: {
        provider: string;
        model: string;
    };
    phase(value: string): void;
}
export interface UltraResult {
    runId: string;
    requested: number;
    succeeded: number;
    degraded: boolean;
    decided: boolean;
    output: string;
    routeIds: string[];
    decisionId: string;
}
/** Keep only complete turns as context seed, as required by DSH session replay. */
export declare function completedSeed(parent: RouteParent): import("@deepseek-ai/dsh-session/types").SessionEvent[];
/** One persistent decision loop plans, waits for parallel research, then implements. */
export declare function runUltra(config: RunConfig, options: RunOptions, factory?: typeof createRoute): Promise<UltraResult>;
