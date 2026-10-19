import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UltraMemoryHost } from './memory-host.js';
import { type KnowledgeQuery } from './knowledge-store.js';
export interface GlobalKnowledgeConfig {
    enabled?: boolean;
    projects?: {
        id: string;
        root: string;
        read?: boolean;
        publish?: boolean;
        shareWith?: string[];
    }[];
    maxSearchChars?: number;
    maxGetChars?: number;
}
export interface KnowledgePublishInput {
    key: string;
    title: string;
    summary: string;
    applicability: string;
    topics?: string[];
    sources: {
        sourceId: string;
        quote: string;
    }[];
    supersedes?: string;
    expiresAt?: number;
}
export declare class GlobalKnowledgeHost {
    readonly ctx: {
        get(name: string): unknown;
    };
    readonly memory: UltraMemoryHost;
    private readonly config;
    private readonly canPublish;
    private stores;
    constructor(ctx: {
        get(name: string): unknown;
    }, memory: UltraMemoryHost, config: () => unknown, canPublish: (agent: Agent) => boolean);
    private configured;
    private policy;
    /** Prompt/bootstrap preflight grants no evidence access and never creates a store. */
    authorized(agent: Agent): boolean;
    private authorize;
    private reauthorize;
    /** Reload existing canonical evidence without creating directories or trusting a run's cached view. */
    private freshEvidence;
    private completeSource;
    publish(agent: Agent, input: KnowledgePublishInput, signal?: AbortSignal): Promise<{
        id: string;
        revision: number;
        status: "expired" | "superseded" | "current" | "revoked";
        assessment: string;
        hostVerified: boolean;
        verification: string;
    }>;
    search(agent: Agent, query?: KnowledgeQuery & {
        maxChars?: number;
    }): Promise<{
        items: ({
            id: string;
            revision: number;
            status: "revoked";
            publisher?: undefined;
            title?: undefined;
            excerpt?: undefined;
            assessment?: undefined;
            hostVerified?: undefined;
        } | {
            id: string;
            publisher: string;
            revision: number;
            status: "expired" | "superseded" | "current";
            title: string;
            excerpt: string;
            assessment: string;
            hostVerified: boolean;
        })[];
        total: number;
        nextOffset?: number;
    }>;
    private verify;
    get(agent: Agent, input: {
        id: string;
        offset?: number;
        maxChars?: number;
        includeInactive?: boolean;
    }): Promise<{
        nextOffset?: number | undefined;
        text: string;
        offset: number;
    }>;
    revoke(agent: Agent, input: {
        id: string;
        reason: string;
    }): {
        id: string;
        status: string;
    };
    entry(agent: Agent): string | undefined;
    status(agent: Agent): {
        enabled: boolean;
        available: boolean;
        project: string;
        read: boolean;
        publish: boolean;
        assessment: string;
        hostVerified: boolean;
    } | {
        enabled: boolean;
        available: boolean;
        project?: undefined;
        read?: undefined;
        publish?: undefined;
        assessment?: undefined;
        hostVerified?: undefined;
    };
}
