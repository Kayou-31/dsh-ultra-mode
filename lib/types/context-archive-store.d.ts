import type { SessionEvent } from '@deepseek-ai/dsh-session';
export interface ContextArchiveAccess {
    projectId: string;
    sessionIds: readonly string[];
}
export interface ContextArchiveStoreOptions {
    projectId: string;
    readEvents(sessionId: string, offset: number, length: number): Promise<readonly SessionEvent[]>;
    /** Re-check the current live caller/ownership; a false result denies access. */
    authorize(access: ContextArchiveAccess, sessionId: string): boolean | void | Promise<boolean | void>;
    /** Existing canonical IDs only. This callback must not capture or publish anything. */
    sourceIdsFor?(sessionId: string, event: SessionEvent): readonly string[];
}
export interface ContextArchivePrepareInput {
    sessionId: string;
    events: readonly SessionEvent[];
    currentStateText: string;
    signal?: AbortSignal;
}
export interface ContextArchivePreparation {
    id: string;
    text: string;
    durable: true;
    sessionId: string;
    sourceSeqs: number[];
    flatSeqs: number[];
    sha256: string;
}
export interface ContextArchiveGetOptions {
    offset?: number;
    maxChars?: number;
    signal?: AbortSignal;
}
export interface ContextArchiveGetResult {
    contextArchive: true;
    id: string;
    sessionId: string;
    status: 'host';
    text: string;
    offset: number;
    nextOffset?: number;
    length: number;
    manifestSha256: string;
    verification: 'returned-events';
    verifiedEvents: {
        seq: number;
        sha256: string;
    }[];
}
export interface ContextArchiveVerification {
    id: string;
    projectId: string;
    sessionId: string;
    sourceSeqs: number[];
    flatSeqs: number[];
    capsuleSha256: string;
    manifestSha256: string;
}
interface EventMetadata {
    seq: number;
    type: string;
    sha256: string;
    length: number;
    transcriptLength: number;
    capsuleText: boolean;
    sourceIds: string[];
    toolCalls: {
        id: string;
        name: string;
        argumentsSha256: string;
    }[];
    resultCallId?: string;
}
interface ArchiveCore {
    projectId: string;
    sessionId: string;
    sourceSeqs: number[];
    flatSeqs: number[];
    events: EventMetadata[];
    priorArchiveIds: string[];
    stateSha256: string;
}
interface Manifest extends ArchiveCore {
    id: string;
    capsuleTextSha256: string;
}
/** Offline verifier for explicitly supplied metadata, with no filesystem access or source authority. */
export declare function verifyArchiveEnvelope(encoded: string, expectedId?: string): {
    schema: 1;
    sha256: string;
    manifest: Manifest;
};
export declare class ContextArchiveStore {
    readonly directory: string;
    private readonly options;
    private readonly archiveDirectory;
    constructor(directory: string, options: ContextArchiveStoreOptions);
    private safeDirectory;
    private access;
    private readManifest;
    private event;
    private original;
    private publish;
    prepare(access: ContextArchiveAccess, input: ContextArchivePrepareInput): Promise<ContextArchivePreparation>;
    verifyCapsule(access: ContextArchiveAccess, event: SessionEvent): Promise<ContextArchiveVerification>;
    get(access: ContextArchiveAccess, id: string, options?: ContextArchiveGetOptions): Promise<ContextArchiveGetResult>;
}
export {};
