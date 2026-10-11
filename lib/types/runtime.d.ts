import { type Agent } from '@deepseek-ai/dsh-agent';
import { type ContentBlock } from '@deepseek-ai/dsh-llm';
import { type SessionEvent } from '@deepseek-ai/dsh-session';
export type AgentLike = Agent;
export type { ContentBlock, SessionEvent };
/** One settled route turn, with the internal log identity retained for diagnostics. */
export interface RouteOutcome {
    ok: boolean;
    text: string;
    error?: string;
    sessionId: string;
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
}
/** A persistent decision loop can plan, then receive evidence in a later turn. */
export interface RouteHandle {
    id: string;
    run(prompt: ContentBlock[]): Promise<RouteOutcome>;
    setReadOnly(readOnly: boolean): void;
    dispose(): Promise<void>;
}
/** Whether an identity is a directly owned ULTRA loop rather than its coordinator. */
export declare function isUltraRoute(id: string): boolean;
/** Global tool guards use this lookup because a subagent joins a preset, not its parent's scope. */
export declare function isResearchRoute(agent: Agent): boolean;
/** Return the visible conversation that owns an internal loop or its delegated descendants. */
export declare function routeParentOf(agent: Agent): Agent | undefined;
/** Apply a route's read-only allow list to every direct or PTC sub-dispatch. */
export declare function researchToolDenial(agent: Agent | undefined, toolName: string): string | undefined;
/** Create a loop without subagent origin or additional delegation depth. */
export declare function createRoute(parent: Agent, options: RouteOptions, config: {
    toolName: string;
}): Promise<RouteHandle>;
/** Execute a single route turn and drain its owned loop even after cancellation or failure. */
export declare function runRoute(parent: Agent, options: RouteOptions & {
    prompt: ContentBlock[];
}, config: {
    toolName: string;
}): Promise<RouteOutcome>;
