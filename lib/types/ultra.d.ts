/**
 * Pure ULTRA policy helpers — no Cordis, no I/O.
 *
 * Everything here is deterministic and unit-tested (`test/ultra.test.mjs`).
 * The plugin's host half imports these; keeping the policy separate from the
 * Cordis wiring is what makes the fallback/degradation matrix testable.
 *
 * @module dsh-ultra-mode/ultra
 */
/** Concurrency bounds advertised to the model and the UI. */
export declare const MIN_CONCURRENCY = 2;
export declare const MAX_CONCURRENCY = 5;
/** Per-session ULTRA state. `activeRuns` counts overlapping invocations. */
export interface UltraState {
    enabled: boolean;
    concurrency: number;
    activeRuns: number;
    lastRun: {
        at: number;
        ms: number;
    } | null;
}
/** Immutable snapshot sent to the client and embedded in prompt text. */
export interface UltraSnapshot {
    enabled: boolean;
    concurrency: number;
    running: boolean;
    activeRuns: number;
    lastRun: {
        at: number;
        ms: number;
    } | null;
}
/** One worker's terminal outcome. */
export interface WorkerOutcome {
    /** `true` only for a clean completion with non-empty text. */
    ok: boolean;
    text?: string;
    error?: string;
}
/**
 * How a run should conclude given how many workers actually produced output.
 *
 * - `insufficient`: fewer than 2 usable workers — do not merge (a single
 *   sample is not "ULTRA"); report the failure instead of silently degrading.
 * - `degraded`: at least 2 but fewer than requested — merge, but tell both the
 *   merger and the user that the run was partial.
 * - `full`: every requested worker succeeded.
 */
export type MergeStrategy = 'insufficient' | 'degraded' | 'full';
export interface MergePlan {
    requested: number;
    succeeded: number;
    failed: number;
    strategy: MergeStrategy;
}
/** Clamp an arbitrary value into the supported concurrency range. */
export declare function clampConcurrency(value: unknown, fallback?: number): number;
/**
 * Canonical session key. An absent/blank/non-string candidate is *rejected*
 * (`undefined`) rather than folded into a shared bucket — silent sharing is
 * how two sessions end up driving one another's mode.
 */
export declare function resolveSessionKey(candidate: unknown): string | undefined;
/** A run is "burning" while at least one invocation is in flight. */
export declare function isRunning(state: Pick<UltraState, 'activeRuns'>): boolean;
/** Detached snapshot for the client (no live objects cross the RPC boundary). */
export declare function snapshotOf(state: UltraState): UltraSnapshot;
/**
 * A worker counts only when it completed *and* produced non-empty text.
 * "completed with empty output" must never be counted as a sample.
 */
export declare function countUsable(outcomes: readonly WorkerOutcome[]): number;
/** Decide the conclusion strategy for one run. */
export declare function planMerge(outcomes: readonly WorkerOutcome[], requested: number): MergePlan;
/** Human-readable banner describing a partial run, prepended to the answer. */
export declare function runBanner(plan: MergePlan): string;
/** Per-worker text budget inside the merge prompt (characters). */
export declare const WORKER_TEXT_LIMIT = 20000;
/**
 * Build the merger brief. The merger is told the *requested vs succeeded*
 * counts so it cannot silently present a 1-of-5 result as a 5-way consensus.
 */
export declare function buildMergePrompt(task: string, outcomes: readonly WorkerOutcome[], plan: MergePlan): string;
/** Fallback when the merger itself fails: keep every usable sample, labelled. */
export declare function fallbackJoin(outcomes: readonly WorkerOutcome[]): string;
/** The worker brief. Self-contained: workers never see the parent conversation. */
export declare function buildWorkerBrief(task: string): string;
/**
 * Prompt section text for one assembly. Returns an empty string when the
 * session has no ULTRA state at all (nothing to say, no prompt churn).
 *
 * The section is evaluated on every assembly, so the model is told the
 * *current* switch position instead of guessing it from a static sentence.
 */
export declare function renderUltraSection(state: UltraState | undefined, toolName: string): string;
