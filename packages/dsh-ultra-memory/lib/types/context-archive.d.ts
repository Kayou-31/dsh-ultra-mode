import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import { type RequestBudget } from './context-memory.js';
export interface ContextArchiveReceipt {
    id: string;
    text: string;
    durable: true;
    sessionId: string;
    sourceSeqs: readonly number[];
}
export interface ContextArchiveConfig {
    enabled?: boolean;
    targetTokens?: number;
    triggerTokens?: number;
    retainRecentMessages?: number;
    outputReserveTokens?: number;
    toolReserveTokens?: number;
}
export interface ContextArchiveOptions {
    session: Session;
    readEvents(): Promise<readonly SessionEvent[]>;
    checkpoint(): Promise<void>;
    prepare(events: readonly SessionEvent[]): Promise<ContextArchiveReceipt>;
    estimateMessage(message: unknown): number;
    measureInputTokens?: () => number | undefined;
    authority?: {
        protocol: 'dsh-0.2.1-rc.2';
        soleOwner: boolean;
        owner?: object;
    };
    getCompactionOwner?: () => unknown;
    config?: ContextArchiveConfig;
    system?: string;
    tools?: readonly unknown[];
    pendingMessages?: readonly unknown[];
    signal?: AbortSignal;
}
export interface ContextArchiveOutcome {
    status: 'disabled' | 'unsupported' | 'unchanged' | 'limited' | 'archived';
    committed: boolean;
    persistenceUncertain: false;
    rawHistoryRetained: true;
    before: RequestBudget;
    after: RequestBudget;
    triggerTokens: number;
    selectedSeqs: number[];
    receiptId?: string;
    startSeq?: number;
    /** Deterministic local-template summary; never a provider LLM call. */
    summarySeq?: number;
    /** Legacy result compatibility only. The summary protocol never sets this. */
    pruneSeq?: number;
    replacementSeq?: number;
    endSeq?: number;
    limits: string[];
}
export declare class ContextArchiveFailure extends Error {
    readonly stage: string;
    readonly committed: boolean;
    readonly persistenceUncertain: boolean;
    readonly receiptId: string | undefined;
    readonly replacementSeq: number | undefined;
    readonly lifecycleClosed: boolean;
    readonly rawHistoryRetained = true;
    readonly originalSurfaceRetained: boolean;
    constructor(stage: string, committed: boolean, persistenceUncertain: boolean, receiptId: string | undefined, replacementSeq: number | undefined, lifecycleClosed: boolean, options?: ErrorOptions);
}
/** The caller owns evidence, authorization and sealed-manifest persistence.
 * This module owns one native replacement, never model summarization or raw-log deletion.
 */
export declare function archiveSession(context: ContextArchiveOptions): Promise<ContextArchiveOutcome>;
