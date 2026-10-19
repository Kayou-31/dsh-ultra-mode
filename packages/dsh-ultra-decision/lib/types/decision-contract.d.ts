export interface IntentItem {
    readonly id: string;
    readonly text: string;
    readonly provenance: 'user' | 'machine';
    readonly quote?: string;
    readonly sourceId?: string;
}
export interface TaskIntent {
    readonly goals: readonly IntentItem[];
    readonly constraints: readonly IntentItem[];
    readonly acceptance: readonly IntentItem[];
    readonly assumptions: readonly IntentItem[];
}
export interface TaskContract {
    readonly originalTask: string;
    readonly sourceId: string;
    readonly sha256: string;
    readonly revision: number;
    readonly intent: TaskIntent;
}
/** Full original input is immutable and never silently shortened or replaced. */
export declare function createTaskContract(task: string, sourceId?: string): TaskContract;
/** Models supply quoted excerpts or labelled machine suggestions, never authorization. */
export declare function parseTaskIntent(raw: unknown, contract: TaskContract): TaskIntent;
export declare function withTaskIntent(contract: TaskContract, raw: unknown): TaskContract;
/** Instructions for the existing planning call; this does not add a model invocation. */
export declare function buildIntentInstruction(contract: TaskContract): string;
export declare function renderContractEntry(contract: TaskContract): string;
export interface VerificationCriterion {
    readonly criterionId: string;
    readonly status: 'satisfied' | 'failed' | 'unverified';
    readonly evidenceIds: readonly string[];
    readonly reason: string;
}
export interface VerificationReport {
    readonly criteria: readonly VerificationCriterion[];
    readonly assessment: 'model';
    readonly hostVerified: false;
    readonly allSatisfied: boolean;
}
/** Claims remain model assessments even when every cited ID exists in host evidence. */
export declare function parseVerificationReport(raw: unknown, contract: TaskContract, knownEvidenceIds: ReadonlySet<string>): VerificationReport;
export type DiagnosticType = 'redirect' | 'verify' | 'stop';
export type DiagnosticStatus = 'queued' | 'admitted' | 'request-visible' | 'effect-verified' | 'cancelled' | 'expired';
export interface DiagnosticEnvelope {
    readonly taskRevision: number;
    readonly taskHash: string;
    readonly targetRouteId: string;
    readonly type: DiagnosticType;
    readonly reason: string;
    readonly evidenceIds: readonly string[];
    readonly instruction: string;
    readonly stopCondition: string;
    readonly ttlMs: number;
    readonly replaces?: string;
}
export interface DiagnosticContext {
    activeIds: ReadonlySet<string>;
    sourceIds: ReadonlySet<string>;
}
export interface DiagnosticRecord extends DiagnosticEnvelope {
    readonly id: string;
    readonly status: DiagnosticStatus;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly wasRequestVisible: boolean;
    readonly requestSourceId?: string;
    readonly effectSourceId?: string;
    readonly closeReason?: string;
}
export interface DiagnosticLedgerOptions {
    maxTtlMs?: number;
    maxRecords?: number;
    now?: () => number;
}
/**
 * Bounded host-owned state. Model JSON cannot upgrade delivery or observation state.
 * Host callers alone invoke lifecycle methods using their actual observed source IDs.
 * An observed effect is an independently established result, not an arbitrary later tool.
 */
export declare class DiagnosticLedger {
    private readonly contract;
    private readonly history;
    private readonly clock;
    private readonly maxTtlMs;
    private readonly maxRecords;
    constructor(contract: TaskContract, options?: DiagnosticLedgerOptions);
    private time;
    private pending;
    private replace;
    private get;
    expire(): readonly DiagnosticRecord[];
    records(): readonly DiagnosticRecord[];
    propose(raw: unknown, context: DiagnosticContext): DiagnosticRecord;
    admit(recordId: string): DiagnosticRecord;
    markRequestVisible(recordId: string, sourceId: string): DiagnosticRecord;
    recordObservedEffect(recordId: string, sourceId: string): DiagnosticRecord;
    cancel(recordId: string, reason: string): DiagnosticRecord;
}
