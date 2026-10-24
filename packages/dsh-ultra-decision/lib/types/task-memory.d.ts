import type { EvidenceAccess, EvidenceStore } from './evidence.js';
export declare const TASK_LAYERS: readonly ["constraints", "current", "decisions", "history", "unfinished"];
export type TaskLayer = typeof TASK_LAYERS[number];
export interface TaskMemoryConfig {
    taskMemoryEnabled?: boolean;
    taskMemoryMaxBytes?: number;
    taskMemoryConditionalRecall?: boolean;
    taskMemoryRecallLimit?: number;
}
export interface TaskMemorySettings {
    enabled: boolean;
    maxBytes: number;
    recall: boolean;
    recallLimit: number;
}
export declare function taskMemorySettings(config: TaskMemoryConfig): TaskMemorySettings;
export declare function memoryTerms(query: string): string[];
export interface TaskMemoryEntry {
    id: string;
    layer: TaskLayer;
    selected: boolean;
    mandatory: boolean;
    reason: string;
    sourceIds: string[];
    sourceStatus: string;
    bytes: number;
    bodySha256: string;
}
export interface TaskMemoryPacket {
    schema: 'ultra-task-memory/v1';
    revision: string;
    projectId: string;
    stateId?: string;
    stateRevision?: number;
    stateAt?: number;
    freshness: 'recorded-evidence-only';
    text: string;
    blocked: boolean;
    reason?: string;
    layers: Record<TaskLayer, string[]>;
    entries: TaskMemoryEntry[];
    omitted: number;
    queryTerms: string[];
    operationCounts: {
        planned: number;
        executed: number;
        verified: number;
    };
    sourceChecks: {
        id: string;
        status: string;
        sha256?: string;
    }[];
}
export declare function buildTaskMemory(input: {
    store: EvidenceStore;
    access: EvidenceAccess;
    rootSessionId?: string;
    query?: string;
    config: TaskMemorySettings;
}): Promise<TaskMemoryPacket>;
