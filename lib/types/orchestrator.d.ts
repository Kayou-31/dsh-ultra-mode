import type { AgentLike as RouteParent, ContentBlock, createRoute } from './runtime.js';
import { type CoordinationSummary } from './coordination.js';
import type { CollaborationHostConfig } from './collaboration-host.js';
import { type GovernanceSnapshot } from './decision-governance.js';
export interface RunConfig extends CollaborationHostConfig {
    toolName: string;
    timeoutMs: number;
    reportChars: number;
    researchTools: string[];
    jevEnabled: boolean;
    jevKeyEnv: string;
    jevModel: string;
    jevBaseUrl: string;
    jevTimeoutMs: number;
    /** Event-driven coordination; no model request occurs merely because time passed. */
    coordinationIntervalMs?: number;
    /** -1 removes the round cap, 0 disables coordination, positives set a cap. */
    coordinationMaxRounds?: number;
    /** Stop intermediate reviews after consecutive failures; 0 disables this limit. */
    coordinationFailureLimit?: number;
    /** Explicit per-request output ceilings; 0/undefined inherit native defaults. */
    planningMaxTokens?: number;
    researchMaxTokens?: number;
    decisionMaxTokens?: number;
    coordinationMaxTokens?: number;
    /** Opt-in strategy protocol within existing decision calls; no new optimizer. */
    decisionGovernance?: boolean;
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
    onGovernance?(snapshot: GovernanceSnapshot): void;
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
    coordination: CoordinationSummary;
    governance?: GovernanceSnapshot;
}
/** Keep only complete turns as context seed, as required by DSH session replay. */
export declare function completedSeed(parent: RouteParent): import("@deepseek-ai/dsh-session/types").SessionEvent[];
/** One persistent decision loop plans, coordinates active research, then implements. */
export declare function runUltra(config: RunConfig, options: RunOptions, factory?: typeof createRoute): Promise<UltraResult>;
