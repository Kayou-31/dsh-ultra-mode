export interface EvidenceAccess {
    projectId: string;
    sessionIds: readonly string[];
}
export interface EvidenceAttachment {
    type: string;
    ref: string;
}
export interface EvidenceHostRef {
    sessionId: string;
    seq: number;
}
export interface EvidenceOrigin {
    tool: string;
    callId: string;
    resourceId?: string;
}
export interface EvidenceInput {
    projectId: string;
    runId: string;
    sessionId: string;
    routeId: string;
    eventId: string;
    seq?: number;
    at: number;
    kind: string;
    text: string;
    version?: number;
    host?: EvidenceHostRef;
    coverage?: 'host' | 'captured' | 'truncated' | 'reference-only';
    attachments?: EvidenceAttachment[];
    files?: string[];
    topics?: string[];
    origin?: EvidenceOrigin;
    /** A host-only local retrieval wrapper locator, never a new searchable or publishable fact. */
    contextReceipt?: true;
}
export interface EvidenceChunk {
    id: string;
    start: number;
    end: number;
    sha256: string;
    terms: string[];
}
export interface EvidenceRecord {
    id: string;
    sourceId: string;
    projectId: string;
    runId: string;
    sessionId: string;
    routeId: string;
    eventId: string;
    seq?: number;
    at: number;
    kind: string;
    version: number;
    sha256: string;
    length: number;
    host?: EvidenceHostRef;
    coverage: NonNullable<EvidenceInput['coverage']>;
    attachments: EvidenceAttachment[];
    files: string[];
    topics: string[];
    chunks: EvidenceChunk[];
    origin?: EvidenceOrigin;
    contextReceipt?: true;
    promotion?: {
        at: number;
        previousCoverage: 'captured' | 'truncated';
        verifiedSha256: string;
    };
}
export type SemanticKind = 'requirement' | 'fact' | 'decision' | 'failure' | 'question' | 'superseded';
export type SemanticStatus = 'current' | 'superseded' | 'unresolved';
export interface SemanticInput {
    id?: string;
    projectId: string;
    kind: SemanticKind;
    text: string;
    sourceIds: string[];
    topics?: string[];
    files?: string[];
    status?: SemanticStatus;
    supersedes?: string[];
    conflicts?: string[];
}
export interface SemanticRecord {
    id: string;
    projectId: string;
    kind: SemanticKind;
    text: string;
    sourceIds: string[];
    topics: string[];
    files: string[];
    status: SemanticStatus;
    supersedes: string[];
    conflicts: string[];
    at: number;
}
export interface ProjectOperation {
    id: string;
    description: string;
    status: 'planned' | 'executed' | 'verified';
    sourceIds: string[];
}
export interface ProjectStateInput {
    goal: string;
    acceptance?: string[];
    constraints?: string[];
    progress?: string[];
    next?: string[];
    blockers?: string[];
    operations?: ProjectOperation[];
    sourceIds: string[];
}
export interface ProjectState extends ProjectStateInput {
    id: string;
    projectId: string;
    revision: number;
    at: number;
}
type Resolver = (ref: EvidenceHostRef) => Promise<{
    text: string;
    attachments?: EvidenceAttachment[];
    callId?: string;
} | undefined>;
export interface EvidenceQuery {
    query?: string;
    id?: string;
    kind?: string;
    file?: string;
    topic?: string;
    routeId?: string;
    after?: number;
    before?: number;
    offset?: number;
    limit?: number;
    maxChars?: number;
}
export type EvidenceStatus = 'host' | 'captured' | 'truncated' | 'reference-only' | 'unavailable' | 'hash-mismatch' | 'identity-mismatch';
export interface EvidenceSearchItem {
    id: string;
    sourceId: string;
    sessionId: string;
    routeId: string;
    at: number;
    kind: string;
    excerpt: string;
    status: EvidenceStatus;
    start: number;
    end: number;
    attachments: EvidenceAttachment[];
    sourceIds?: string[];
    topics?: string[];
    files?: string[];
    semanticStatus?: SemanticStatus;
    match?: 'source-identity';
    sourceChars?: number;
    sourceChunks?: number;
}
export interface EvidenceSearchResult {
    items: EvidenceSearchItem[];
    nextOffset?: number;
    total: number;
    omitted?: number;
    retrievalHint?: string;
}
export interface EvidenceGetResult {
    text: string;
    sourceIds: string[];
    status: EvidenceStatus;
    offset: number;
    nextOffset?: number;
    attachments?: EvidenceAttachment[];
    semanticStatus?: SemanticStatus;
    sourceIdsTruncated?: boolean;
    contextReceipt?: true;
    citation?: {
        sourceId: string;
        quote: string;
        start: number;
        end: number;
        sha256: string;
        origin?: EvidenceOrigin;
    };
}
export declare class EvidenceStore {
    readonly directory: string;
    private readonly resolver?;
    private readonly recordDirectory;
    private records;
    private tornWrites;
    private integrityFailure?;
    private verifiedFiles;
    private sourceIndex;
    private eventIndex;
    private parsedRecords;
    constructor(directory: string, resolver?: Resolver | undefined);
    private reload;
    private loadRecords;
    private fingerprint;
    private indexSource;
    private mutate;
    private commit;
    capture(input: EvidenceInput): EvidenceRecord;
    /** Release fallback bytes only after an exact host-log body has become durable. */
    promoteToHost(sourceId: string, ref: EvidenceHostRef): Promise<boolean>;
    private metadata;
    private grant;
    private allowed;
    private findSource;
    private validSources;
    private sourcesAllowed;
    recordsFor(access: EvidenceAccess): Iterable<EvidenceRecord>;
    /** Metadata identifiers only; this helper conveys no content access. */
    idsFor(sessionId: string, eventId: string): string[];
    private resolve;
    search(access: EvidenceAccess, query?: EvidenceQuery): Promise<EvidenceSearchResult>;
    get(access: EvidenceAccess, id: string, options?: {
        offset?: number;
        maxChars?: number;
        neighbors?: number;
        quote?: string;
    }): Promise<EvidenceGetResult>;
    addSemantic(input: SemanticInput): SemanticRecord;
    private semanticView;
    semantics(access: EvidenceAccess, filter?: {
        status?: SemanticStatus;
        kind?: SemanticKind;
        topic?: string;
    }): SemanticRecord[];
    updateProjectState(access: EvidenceAccess, input: ProjectStateInput): ProjectState;
    projectState(access: EvidenceAccess): ProjectState | undefined;
    stats(access: EvidenceAccess): {
        raw: {
            sources: number;
            chunks: number;
            characters: number;
            attachments: number;
            coverage: {
                host: number;
                captured: number;
                truncated: number;
                'reference-only': number;
            };
        };
        contextReceipts: {
            sources: number;
            characters: number;
            storage: string;
            indexedBodyCharacters: number;
        };
        semantic: {
            total: number;
            current: number;
            superseded: number;
            unresolved: number;
        };
        integrity: {
            tornWrites: number;
            status: string;
            parsedRecords: number;
            verifiedFiles: number;
        };
    };
    /** Derived presentation only. No Markdown input is trusted as canonical evidence. */
    exportMarkdown(access: EvidenceAccess): {
        files: {
            path: string;
            content: string;
        }[];
    };
}
export {};
