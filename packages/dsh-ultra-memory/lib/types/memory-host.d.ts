import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { EvidenceStore, type EvidenceAccess, type EvidenceAttachment, type EvidenceQuery, type EvidenceHostRef } from './evidence.js';
import { ContextArchiveStore } from './context-archive-store.js';
import { type TaskMemoryConfig, type TaskMemoryPacket } from './task-memory.js';
export interface MemoryConfig extends TaskMemoryConfig {
    evidenceEnabled?: boolean;
    memorySearchChars?: number;
    memoryGetChars?: number;
    contextTargetTokens?: number;
    contextTriggerTokens?: number;
    contextRetainRecentMessages?: number;
    contextMinResultChars?: number;
    contextMaxPrunes?: number;
    contextPreviewChars?: number;
    contextCompactLocators?: boolean;
    contextRetrievalReceipts?: boolean;
    contextArchiveCompletedTurns?: boolean;
    contextOutputReserveTokens?: number;
    contextToolReserveTokens?: number;
    contextCompression?: boolean;
    memoryMaxRequests?: number;
    memoryMaxTokens?: number;
}
interface HostContext {
    root?: object;
    get(name: string): unknown;
    on?(name: string, fn: (...args: any[]) => unknown): () => void;
}
interface StoredHandle {
    header: {
        id: string;
        cwd?: string;
        parentSession?: string;
    };
    read(offset?: number, length?: number): Promise<{
        events: readonly SessionEvent[];
    }>;
    close(): Promise<void>;
}
interface Persistence {
    open(id: string, access: 'read'): Promise<StoredHandle>;
    flush?(): Promise<void>;
}
export declare function installMemoryHost(ctx: HostContext, config: MemoryConfig): UltraMemoryHost;
export declare function uninstallMemoryHost(ctx: HostContext, host: UltraMemoryHost): void;
export declare function beginMemoryRun(parent: Agent, runId: string): Promise<MemoryRun | undefined>;
export declare function memoryFor(agent: Agent): MemoryRun | undefined;
/** Only public text blocks; provider streams, reasoning and private tool metadata are never indexed. */
export declare function publicEvidence(event: SessionEvent): {
    text: string;
    attachments: EvidenceAttachment[];
} | undefined;
export declare class UltraMemoryHost {
    readonly ctx: HostContext;
    readonly config: MemoryConfig;
    private stores;
    private last;
    private initializing;
    private closed;
    private closeTask?;
    private liveSessions;
    private statuses;
    private taskPackets;
    private taskQueries;
    constructor(ctx: HostContext, config: MemoryConfig);
    get evidenceEnabled(): boolean;
    refreshAuthority(): void;
    private caller;
    begin(parent: Agent, runId: string): Promise<MemoryRun | undefined>;
    persistence(): Persistence | undefined;
    readEvents(sessionId: string, from?: number, length?: number): Promise<readonly SessionEvent[]>;
    resolve(ref: EvidenceHostRef): Promise<{
        callId?: string | undefined;
        text: string;
        attachments: EvidenceAttachment[];
    } | undefined>;
    flush(session: Agent['session']): Promise<void>;
    bind(agent: Agent, run: MemoryRun): void;
    unbind(agent: Agent, run: MemoryRun): void;
    releaseSessionRef(session: Agent['session']): void;
    access(agent: Agent): MemoryRun;
    search(agent: Agent, query: EvidenceQuery): Promise<import("./evidence.js").EvidenceSearchResult>;
    private taskQuery;
    get nativeTaskContext(): boolean;
    prepareTaskMemory(agent: Agent, pending?: readonly unknown[]): Promise<TaskMemoryPacket | undefined>;
    taskContext(agent?: Agent): string;
    taskStatus(agent: Agent, options?: {
        query?: string;
        depth?: string;
        sinceRevision?: string;
        revision?: string;
        offset?: number;
        maxChars?: number;
    }): Promise<{
        unchanged: boolean;
        text: string;
        offset: number;
        schema: "ultra-task-memory/v1";
        revision: string;
        projectId: string;
        stateId: string | undefined;
        stateRevision: number | undefined;
        freshness: "recorded-evidence-only";
    } | {
        pagination: string;
        nextOffset?: number | undefined;
        unchanged: boolean;
        depth: string;
        offset: number;
        text: string;
        totalChars: number;
        schema: "ultra-task-memory/v1";
        revision: string;
        projectId: string;
        stateId: string | undefined;
        stateRevision: number | undefined;
        freshness: "recorded-evidence-only";
    }>;
    get(agent: Agent, id: string, options?: {
        offset?: number;
        maxChars?: number;
        neighbors?: number;
        quote?: string;
    }): Promise<import("./evidence.js").EvidenceGetResult | import("./context-archive-store.js").ContextArchiveGetResult>;
    status(sessionId: string): Record<string, unknown> | undefined;
    mainContext(agent: Agent): string | undefined;
    private assertArchiveBinding;
    beforeStep(agent: Agent, pendingMessages?: readonly unknown[], signal?: AbortSignal): Promise<void>;
    capture(session: Agent['session'], event: SessionEvent): void;
    observeRequest(options: {
        sessionId?: string;
        messages?: readonly {
            id?: string;
        }[];
        [key: string]: unknown;
    }): void;
    close(): Promise<void>;
}
export declare class MemoryRun {
    readonly host: UltraMemoryHost;
    readonly parent: Agent;
    readonly runId: string;
    readonly store: EvidenceStore;
    readonly projectId: string;
    readonly directory: string;
    private ownership;
    private ownershipFile;
    private routes;
    private sessions;
    private latest;
    private pendingPromotions;
    private seen;
    private indexed;
    private auditedAvailable;
    private agents;
    private reportSources;
    private operationSources;
    private toolCalls;
    private retrievalCalls;
    private localRetrievalCalls;
    /** State of the durable scan prefix only; live event observers never mutate it. */
    private pendingScanRetrievals;
    private coverageGaps;
    private routeStates;
    private boundaries;
    private attempts;
    private reservations;
    private entriesSent;
    private mainGeneration?;
    private deliveries;
    private usage;
    private ledgerDirectory?;
    private errors;
    private contextText;
    private phase;
    private phaseSequence;
    private compression;
    private requestEstimate;
    private suspended;
    private suspensionPersistenceFailed;
    private checkpointing;
    private authoritySignal;
    private archiveStore?;
    private archiveState;
    private archiveRecoveryPending;
    private archiveCapsules;
    private archiveCheckedGeneration;
    private archiveCheckedSignature;
    active: boolean;
    retrievals: number;
    constructor(host: UltraMemoryHost, parent: Agent, runId: string, project: {
        cwd: string;
        projectId: string;
    }, store: EvidenceStore);
    access(): EvidenceAccess;
    get needsArchiveRecovery(): boolean;
    /** A committed surface keeps depending on its scoped recovery reader, even
     * when creation is switched off or evidence authority changes later. */
    assertArchiveRecoveryAccess(agent: Agent): void;
    /** Lazy and metadata-only; constructing or reading an archive does not create files. */
    archives(): ContextArchiveStore;
    private verifyActiveArchives;
    private assertArchiveSnapshot;
    /** Keep prior evidence; never backfill events emitted while the authority was off. */
    setSuspended(suspended: boolean): void;
    private enabled;
    get evidenceEnabled(): boolean;
    private excluded;
    initialize(): Promise<void>;
    bind(agent: Agent, routeId: string): void;
    private remember;
    refs(sessionId: string): string[];
    diagnostic(error: unknown): void;
    private ledger;
    rollback(): void;
    private callFor;
    private rememberRetrieval;
    private updatePendingRetrievals;
    private restorePendingRetrievals;
    private classifyResumedResult;
    captureEvent(session: Agent['session'], event: SessionEvent): string[];
    captureTool(agent: Agent, callId: string, name: string, result: {
        content: readonly ContentBlock[];
        isError?: boolean;
    }): string[];
    recordReport(sessionId: string, text: string, status: string): string[];
    /** Public strategy metadata uses the same host-owned evidence authority. */
    recordGovernance(snapshot: unknown): void;
    recordTask(task: string): void;
    private recordOperation;
    private indexSession;
    private indexStoredSession;
    prepareSeed(parent: Agent): Promise<readonly SessionEvent[]>;
    private stateText;
    private withRecoveryTypes;
    private indexEntry;
    reportInstructions(): string;
    entry(sessionId?: string): string;
    mainContext(generation: number): string | undefined;
    stage(phase: string): void;
    recordDelivery(messageId: string, targetId: string, stage: 'queued' | 'admitted' | 'request-visible' | 'discarded', details?: string): void;
    observeRequest(agent: Agent, options: {
        messages?: readonly {
            id?: string;
        }[];
        [key: string]: unknown;
    }): void;
    /** Local retrieval wrappers are recoverable host material, not fresh semantic evidence.
     * Build only a verified metadata receipt; never copy or recursively index their body.
     * Global knowledge wrappers remain protected by their original reader/revocation rules.
     */
    private retrievalReceipt;
    beforeStep(agent: Agent, pendingMessages?: readonly unknown[], signal?: AbortSignal): Promise<void>;
    private resources;
    private disabledCoverageGaps;
    status(): Record<string, any>;
    checkpoint(): Promise<void>;
    dispose(): Promise<void>;
}
export {};
