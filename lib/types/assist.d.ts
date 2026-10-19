import { type ContentBlock } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { RunConfig } from './orchestrator.js';
import type { createRoute } from './runtime.js';
import { type CoordinationSummary } from './coordination.js';
import { type GovernanceSnapshot } from './decision-governance.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'ultra-assist': {
            kind: 'ultra-assist';
            form: 'feedback';
            summary: string;
            runId: string;
            decisionId: string;
        };
    }
}
export interface DecisionAssistOptions {
    parent: Agent;
    task: string;
    content: ContentBlock[];
    signal: AbortSignal;
    route?: {
        provider: string;
        model: string;
    };
    phase(value: string): void;
    onGovernance?(snapshot: GovernanceSnapshot): void;
}
export interface DecisionAssistHandle {
    runId: string;
    decisionId: string;
    coordination: CoordinationSummary;
    /** Includes the currently running decision turn and lifecycle disposal. */
    done: Promise<DecisionAssistOutcome>;
    /** Stop the sidecar only, without cancelling or waking the parent. */
    stop(): void;
    readonly governance?: GovernanceSnapshot;
}
/** Describes the sidecar lifecycle only, never the success of the parent task. */
export interface DecisionAssistOutcome {
    reason: 'turn-ended' | 'cancelled' | 'timeout' | 'stopped' | 'failed';
    warnings: string[];
    error: string | null;
    governance?: GovernanceSnapshot;
}
/** Create one Max sidecar, returning without waiting for its model response. */
export declare function startDecisionAssist(config: RunConfig, options: DecisionAssistOptions, factory?: typeof createRoute): Promise<DecisionAssistHandle>;
