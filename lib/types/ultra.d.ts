/** Pure policies for 3–5 execution routes and their separate decision route. */
export declare const MIN_CONCURRENCY = 3;
export declare const MAX_CONCURRENCY = 5;
export interface UltraState {
    enabled: boolean;
    concurrency: number;
    activeRuns: number;
    phase: string;
    error: string | null;
    lastRun: {
        at: number;
        ms: number;
        requested: number;
        succeeded: number;
        runId: string;
    } | null;
}
export interface WorkerOutcome {
    ok: boolean;
    text: string;
    error?: string;
    sessionId: string;
    subagents?: {
        sessionId: string;
        parentSession?: string;
        origin: 'subagent';
        delegationDepth?: number;
    }[];
}
export interface MergePlan {
    requested: number;
    succeeded: number;
    failed: number;
    strategy: 'full' | 'degraded' | 'insufficient';
}
/** Validate the execution-route count, excluding the decision route. */
export declare function routeCount(value: unknown): number;
/** Resolve a session identity without a shared fallback bucket. */
export declare function resolveSessionKey(value: unknown): string | undefined;
/** Snapshot state without exposing mutable host records. */
export declare function snapshotOf(state: UltraState): {
    running: boolean;
    lastRun: {
        at: number;
        ms: number;
        requested: number;
        succeeded: number;
        runId: string;
    } | null;
    enabled: boolean;
    concurrency: number;
    activeRuns: number;
    phase: string;
    error: string | null;
};
/** Count only completed, nonblank route output. */
export declare function planMerge(outcomes: readonly WorkerOutcome[], requested: number): MergePlan;
/** Parse assignments, retaining work when the planner returns prose. */
export declare function parseAssignments(text: string, count: number): string[];
/** Built-in decision policy; optional evaluators never replace this route. */
export declare const ULTRA_DECISION_INSTRUCTIONS: string;
/** Plan in the decision loop that later implements and synthesizes. */
export declare function buildPlanPrompt(task: string, count: number): string;
/** Share user context while giving each route a different assignment. */
export declare function buildWorkerBrief(task: string, assignment: string, index: number, count: number, plan: string): string;
/** Resolve disagreements and let one route commit shared changes. */
export declare function buildDecisionPrompt(task: string, outcomes: readonly WorkerOutcome[], plan: MergePlan, jev: string, limit: number): string;
/** Never present failed decision output as a completed consensus. */
export declare function fallbackJoin(outcomes: readonly WorkerOutcome[]): string;
/** Advertise state without recursively starting more routes. */
export declare function renderUltraSection(state: UltraState | undefined): string;
