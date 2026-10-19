/** Parallel research routes, plus an optional normal-agent decision assistant. */
import { type TaskContract } from './decision-contract.js';
import type { GovernanceStatus } from './decision-governance.js';
export declare const MIN_CONCURRENCY = 2;
export declare const MAX_CONCURRENCY = 5;
export interface UltraState {
    enabled: boolean;
    collaborationEnabled?: boolean;
    concurrency: number;
    warnings?: string[];
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
    governance?: GovernanceStatus;
}
export interface WorkerOutcome {
    ok: boolean;
    text: string;
    error?: string;
    sessionId: string;
    evidenceIds?: string[];
    uncertainties?: string[];
    conflicts?: string[];
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
/** 1 means the existing main agent with an additional read-only decision loop. */
export declare function modeCount(value: unknown): number;
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
    warnings?: string[];
    enabled: boolean;
    collaborationEnabled?: boolean;
    concurrency: number;
    activeRuns: number;
    phase: string;
    error: string | null;
    governance?: GovernanceStatus;
};
/** Count only completed, nonblank route output. */
export declare function planMerge(outcomes: readonly WorkerOutcome[], requested: number): MergePlan;
/** Accept one complete planning protocol, without extracting JSON from prose. */
export declare function tryParseAssignments(text: string, count: number): string[] | undefined;
/** Compatible fallback API: each route keeps its own original user obligations. */
export declare function parseAssignments(text: string, count: number): string[];
/** Built-in decision policy; optional evaluators never replace this route. */
export declare const ULTRA_DECISION_INSTRUCTIONS: string;
/** Plan in the decision loop that later implements and synthesizes. */
export declare function buildPlanPrompt(task: string, count: number, contract?: TaskContract): string;
/** Repair formatting once on the same decision, preserving every route's obligations. */
export declare function buildPlanRepairPrompt(task: string, count: number, invalid: string, limit: number, contract?: TaskContract): string;
/** Share user context while giving each route a different assignment. */
export declare function buildWorkerBrief(task: string, assignment: string, index: number, count: number, plan: string, reportLimit?: number): string;
/** Resolve disagreements and let one route commit shared changes. */
export declare function buildDecisionPrompt(task: string, outcomes: readonly WorkerOutcome[], plan: MergePlan, jev: string, limit: number): string;
/** Never present failed decision output as a completed consensus. */
export declare function fallbackJoin(outcomes: readonly WorkerOutcome[]): string;
/** Advertise state without recursively starting more routes. */
export declare function renderUltraSection(state: UltraState | undefined): string;
