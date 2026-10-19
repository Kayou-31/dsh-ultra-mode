/**
 * Optional, server-side TypeSafe Jev decision adapter.
 * Contract: https://api.typesafe.ai/openapi.json (verified 2026-10-11).
 * Jev returns bounded judgments; the DSH decision route owns synthesis/tools.
 * This module never reads credentials, logs prompts, or calls an API at import.
 */
export declare const JEV_BASE_URL = "https://api.typesafe.ai";
export declare const JEV_MODEL = "jev-latest";
export declare const JEV_TASK_LIMIT = 4000;
export declare const JEV_ROUTE_TEXT_LIMIT = 8000;
export interface JevRoute {
    id: string;
    text: string;
}
export interface JevDecisionInput {
    task: string;
    /** Successful routes only. IDs refer to this invocation, not other sessions. */
    routes: readonly JevRoute[];
}
export interface JevOptions {
    /** Resolve from server-side configuration; never send to client/UI state. */
    apiKey: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Dependency injection for offline tests. Defaults to the host fetch. */
    fetch?: typeof fetch;
}
export interface JevDecision {
    selectedRouteId: string;
    confidence: number;
    sufficientEvidenceProbability: number;
    probabilities: Record<string, number>;
    model: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}
export type JevErrorCode = 'configuration' | 'input' | 'http' | 'response' | 'aborted' | 'timeout' | 'network';
/** Deliberately omit upstream bodies/errors, which can contain submitted state. */
export declare class JevError extends Error {
    readonly code: JevErrorCode;
    readonly status?: number | undefined;
    constructor(code: JevErrorCode, message: string, status?: number | undefined);
}
/** Build only the bounded route comparison state required by TypeSafe's API. */
export declare function buildJevRequest(input: JevDecisionInput, model?: string): {
    model: string;
    state: {
        task: string;
        taskTruncated: boolean;
        routes: {
            id: any;
            text: any;
            truncated: boolean;
        }[];
    };
    questions: {
        best_route: {
            type: "choice";
            instructions: string;
            criteria: any;
        };
        sufficient_evidence: {
            type: "noul";
            instructions: string;
            criteria: {
                true: string;
                false: string;
            };
        };
    };
};
/** Validate every decision field against the current request's answer space. */
export declare function parseJevDecision(value: unknown, routeIds: readonly string[]): JevDecision;
/** One explicit API call with a bounded deadline; no automatic paid retries. */
export declare function decideWithJev(input: JevDecisionInput, options: JevOptions): Promise<JevDecision>;
