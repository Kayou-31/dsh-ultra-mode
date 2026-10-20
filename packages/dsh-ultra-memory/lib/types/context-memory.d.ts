/** Deterministic context admission and rc.2-native tool-result surface pruning.
 * This module never invokes a model and never indexes assistant reasoning.
 * Full host events remain the canonical evidence; new routes use an entry packet.
 */
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
export declare const CONTEXT_HOST_PROTOCOL: "dsh-0.2.0-rc.2";
export interface MemoryContextConfig {
    /** Soft total envelope target, including output and future tool-output reserves. */
    targetTokens?: number;
    /** Hysteresis: start pruning only at this envelope; default retains the old target trigger. */
    triggerTokens?: number;
    outputReserveTokens?: number;
    toolReserveTokens?: number;
    retainRecentMessages?: number;
    minResultChars?: number;
    maxPrunes?: number;
    previewChars?: number;
    /** Omit repeated project state/shared-ID lists from each result locator. */
    compactLocators?: boolean;
    routeEvidenceChars?: number;
    /** Off until one verified authority owns compression for the selected agents. */
    contextCompression?: boolean;
}
export interface RequestBudgetInput {
    system?: string;
    tools?: readonly unknown[];
    messages?: readonly unknown[];
    retrieval?: unknown;
    targetTokens?: number;
    outputReserveTokens?: number;
    toolReserveTokens?: number;
    /** An externally measured count for this exact assembled input, when available. */
    inputTokens?: number;
    /** Official host meter pressure (usage anchor plus estimated surface deltas); never an exact tokenizer count. */
    nativeInputEstimate?: number;
}
export interface RequestBudget {
    targetTokens: number;
    inputTokens: number;
    outputReserveTokens: number;
    toolReserveTokens: number;
    totalTokens: number;
    remainingTokens: number;
    withinBudget: boolean;
    estimated: boolean;
    method: 'utf8-heuristic' | 'supplied-input-count' | 'native-meter-envelope';
    nativeInputEstimate?: number;
    sections: {
        system: number;
        tools: number;
        messages: number;
        retrieval: number;
    };
}
/** Counts all requested input sections plus explicit output and future-tool reserves. */
export declare function estimateRequestBudget(input: RequestBudgetInput): RequestBudget;
export interface RouteContextEntry {
    text?: string;
    stateText?: string;
    evidenceIds?: readonly string[];
    eventSourceIds?: Readonly<Record<number, readonly string[]>>;
    sessionId?: string;
    system?: string;
    tools?: readonly unknown[];
}
export interface RouteContextAssembly {
    seed: readonly SessionEvent[];
    text: string;
    budget: RequestBudget;
    evidenceIds: string[];
    sourceEventSeqs: number[];
    compressed: boolean;
    kind: 'entry-packet' | 'canonical-seed';
    limit?: string;
}
/** New routes receive exact human constraints, current state, locators, and bounded public evidence.
 * A rich/unknown human input uses the original canonical seed rather than losing its attachment.
 * The soft target never authorizes silently deleting a human constraint.
 */
export declare function assembleRouteContext(events: readonly SessionEvent[], value: RouteContextEntry | string, config?: MemoryContextConfig): RouteContextAssembly;
/** A receipt attests durable source storage/lookup, never truth or task completion. */
export interface ContextEvidenceReceipt {
    ids: readonly string[];
    sessionId: string;
    sourceSeq: number;
    durable: boolean;
}
export interface CompactSessionContext {
    session: Session;
    readEvents(): Promise<readonly SessionEvent[]>;
    checkpoint(): Promise<void>;
    evidenceForEvent(event: SessionEvent): Promise<ContextEvidenceReceipt | undefined>;
    /** Must be the native tokenMeter.estimateMessage, required by shadow-price replay. */
    estimateMessage?: (message: unknown) => number;
    /** Remeasured after every surface replacement, not a cached pre-compression usage count. */
    measureInputTokens?: () => number | undefined;
    authority?: {
        protocol: typeof CONTEXT_HOST_PROTOCOL;
        soleOwner: boolean;
    };
    /** Any other configured compaction engine means this module cannot claim sole ownership. */
    nativeCompaction?: unknown;
    getCompactionOwner?: () => unknown;
    config?: MemoryContextConfig;
    stateText?: string;
    evidenceIds?: readonly string[];
    system?: string;
    tools?: readonly unknown[];
    retrieval?: string;
    pendingMessages?: readonly unknown[];
    signal?: AbortSignal;
}
export interface ContextReplacement {
    originalSeq: number;
    replacementSeq: number;
    callId: string;
    evidenceIds: string[];
}
export interface SessionCompactionOutcome {
    status: 'disabled' | 'unsupported' | 'unchanged' | 'compacted' | 'limited';
    triggerTokens: number;
    before: RequestBudget;
    after: RequestBudget;
    replacements: ContextReplacement[];
    limits: string[];
}
/** A post-commit error reports the live surface separately from durable raw evidence. */
export declare class ContextCompactionFailure extends Error {
    readonly originalHistoryRetained: boolean;
    readonly surfaceRestored: boolean;
    readonly recoveryCheckpointDurable: boolean;
    readonly replacements: readonly ContextReplacement[];
    constructor(message: string, originalHistoryRetained: boolean, surfaceRestored: boolean, recoveryCheckpointDurable: boolean, replacements: readonly ContextReplacement[], options?: ErrorOptions);
}
/** Apply the host's deterministic prune protocol to old text-only tool results.
 * Pinned reference: dsh-v0.2.0-rc.2 / compaction-tool-result-pruner/src/index.ts:160-171.
 * Checkpoint the original evidence before any replacement, preserve event/message/call
 * identities, and append prune + replacement synchronously adjacent. Full raw logs,
 * human instructions, rich blocks, recent messages, and tool pairing stay intact.
 */
export declare function compactSession(context: CompactSessionContext): Promise<SessionCompactionOutcome>;
