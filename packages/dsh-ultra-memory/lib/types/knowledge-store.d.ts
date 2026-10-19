export interface KnowledgeSource {
    sourceId: string;
    projectId: string;
    sessionId: string;
    sha256: string;
    sourceVersion: number;
    start: number;
    end: number;
    quote: string;
}
export interface KnowledgePublication {
    publisher: string;
    key: string;
    title: string;
    summary: string;
    applicability: string;
    topics: string[];
    readers: string[];
    sources: KnowledgeSource[];
    supersedes?: string;
    expiresAt?: number;
    /** Immutable reader IDs to canonical project hashes; new host publications always provide this. */
    readerProjects?: Readonly<Record<string, string>>;
}
export interface KnowledgeRecord extends KnowledgePublication {
    id: string;
    profileId: string;
    revision: number;
    createdAt: number;
    status: 'current' | 'superseded' | 'revoked' | 'expired';
}
export interface KnowledgeAccess {
    projectId: string;
    publisherIds: readonly string[];
    /** Host-derived current publisher root binding; when supplied, absent or changed roots deny visibility. */
    publisherProjects?: Readonly<Record<string, string>>;
    /** Current caller's canonical project hash; when supplied, legacy missing reader snapshots deny access. */
    readerProject?: string;
}
export interface KnowledgeQuery {
    query?: string;
    topic?: string;
    publisher?: string;
    offset?: number;
    limit?: number;
    includeInactive?: boolean;
}
export declare class KnowledgeStore {
    private readonly directory;
    private readonly recordsDirectory;
    private readonly profileId;
    private readonly now;
    private readonly maxEntries;
    constructor(directory: string, profileId: string, options?: {
        now?: () => number;
        maxEntries?: number;
    });
    private clock;
    private checkDirectories;
    private read;
    private binding;
    /** No stale-lock stealing: fail immediately with a bounded diagnostic for manual recovery. */
    private lock;
    /** Caller holds the writer lock. An existing immutable destination is never replaced. */
    private write;
    private view;
    publish(value: KnowledgePublication): KnowledgeRecord;
    revoke(publisher: string, id: string, reason: string): void;
    private visible;
    private present;
    search(access: KnowledgeAccess, value?: KnowledgeQuery): {
        items: KnowledgeRecord[];
        total: number;
        nextOffset?: number;
    };
    get(access: KnowledgeAccess, id: string, includeInactive?: boolean): KnowledgeRecord | undefined;
}
