import { type Agent } from '@deepseek-ai/dsh-agent';
import { type ContentBlock } from '@deepseek-ai/dsh-llm';
import { type SessionEvent } from '@deepseek-ai/dsh-session';
import type { RouteProgress } from './coordination.js';
import { type CollaborationHostConfig } from './collaboration-host.js';
import { type MemoryRun } from './memory-host.js';
export type AgentLike = Agent;
export type { ContentBlock, SessionEvent };
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'ultra-steering': {
            kind: 'ultra-steering';
            form: 'feedback';
            summary: string;
            runId?: string;
        };
        'ultra-route-task': {
            kind: 'ultra-route-task';
            summary: string;
        };
    }
}
/** One settled route turn, with the internal log identity retained for diagnostics. */
export interface SubagentIdentity {
    sessionId: string;
    parentSession?: string;
    origin: 'subagent';
    delegationDepth?: number;
}
export interface RouteOutcome {
    ok: boolean;
    text: string;
    error?: string;
    sessionId: string;
    evidenceIds?: string[];
    uncertainties?: string[];
    conflicts?: string[];
    /** Observed creation identities only; these do not establish completion. */
    subagents?: SubagentIdentity[];
}
/** Route creation inputs; the signal controls creation and every later turn. */
export interface RouteOptions {
    id: string;
    label: string;
    seed?: readonly SessionEvent[];
    signal: AbortSignal;
    readOnly?: boolean;
    researchTools?: readonly string[];
    route?: {
        provider: string;
        model: string;
    };
    memory?: MemoryRun;
}
export interface RouteRunOptions {
    /** Explicit per-request cap for this turn, including reasoning; 0 inherits. */
    maxTokens?: number;
    /** Worker-only public report handoff; never enabled on decision phases. */
    reportSubmission?: boolean;
    /** Planning protocol only: no model-visible schemas or executable tools. */
    planningOnly?: boolean;
}
export interface SteeringMetadata {
    directiveId: string;
    isCurrent?(): boolean;
    onDelivery?(status: 'queued' | 'admitted' | 'request-visible', sourceId: string): void;
}
/** A persistent decision loop can plan, then receive evidence in a later turn. */
export interface RouteHandle {
    id: string;
    run(prompt: ContentBlock[], options?: RouteRunOptions): Promise<RouteOutcome>;
    setReadOnly(readOnly: boolean): void;
    subscribeProgress?(listener: (progress: RouteProgress) => void): () => void;
    steer?(instruction: string, meta?: SteeringMetadata): boolean;
    dispose(): Promise<void>;
}
/** Whether an identity is a directly owned ULTRA loop rather than its coordinator. */
export declare function isUltraRoute(id: string): boolean;
/** Global tool guards use this lookup because a subagent joins a preset, not its parent's scope. */
export declare function isResearchRoute(agent: Agent): boolean;
/** Return the visible conversation that owns an internal loop or its delegated descendants. */
export declare function routeParentOf(agent: Agent): Agent | undefined;
/** Knowledge publication is a configured host write, never a delegated research capability. */
export declare function canPublishKnowledge(agent: Agent): boolean;
/** Apply a route's read-only allow list to every direct or PTC sub-dispatch. */
export declare function researchToolDenial(agent: Agent | undefined, toolName: string): string | undefined;
/** Create a loop without subagent origin or additional delegation depth. */
export declare function createRoute(parent: Agent, options: RouteOptions, config: {
    toolName: string;
    reportChars?: number;
} & CollaborationHostConfig): Promise<RouteHandle>;
/** Execute a single route turn and drain its owned loop even after cancellation or failure. */
export declare function runRoute(parent: Agent, options: RouteOptions & {
    prompt: ContentBlock[];
}, config: {
    toolName: string;
}): Promise<RouteOutcome>;
