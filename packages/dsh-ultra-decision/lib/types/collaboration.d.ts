import type { ModelChoice, ModelSelection, ModelUsage } from './model-pool.js';
export type TeamModel = Omit<ModelSelection, 'snapshot' | 'agentOptions'>;
export interface TeamSpawnRequest extends ModelChoice {
    taskName: string;
    message: string;
}
export interface TeamSnapshot {
    id: string;
    parentId?: string;
    taskName: string;
    task?: string;
    model?: TeamModel;
    usage?: ModelUsage;
    recordingError?: string;
    status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
    revision: number;
    text?: string;
    error?: string;
}
export interface TeamAdapter {
    spawn(callerId: string, request: TeamSpawnRequest & {
        id: string;
    }, signal: AbortSignal): Promise<{
        id: string;
    }>;
    /** Native waking delivery, used only by explicit follow-up tasks. */
    deliver(callerId: string, targetId: string, message: string, signal: AbortSignal): Promise<string>;
    /** Optional non-waking delivery through the exact live target's public inbox. */
    deliverContext?(callerId: string, targetId: string, message: string, signal: AbortSignal): Promise<string>;
    interrupt(callerId: string, targetId: string, signal: AbortSignal): Promise<void>;
    close(children: readonly {
        id: string;
        parentId: string;
    }[]): Promise<void>;
}
interface TeamOptions {
    runId: string;
    rootId: string;
    maxAgents?: number;
    maxMailbox?: number;
    maxTextChars?: number;
    onChange?(members: TeamSnapshot[]): void;
}
export declare class CollaborationTeam {
    private readonly options;
    private readonly adapter;
    private readonly members;
    private readonly mailbox;
    private readonly busy;
    private readonly listeners;
    private readonly pending;
    private readonly controller;
    private revision;
    private closing?;
    private readonly maxAgents;
    private readonly maxMailbox;
    private readonly maxTextChars;
    constructor(options: TeamOptions, adapter: TeamAdapter);
    private live;
    private text;
    private child;
    private adjacent;
    private changed;
    private copy;
    annotate(id: string, value: {
        model?: TeamModel;
        usage?: ModelUsage;
    }): void;
    private track;
    has(id: string): boolean;
    spawn(callerId: string, request: TeamSpawnRequest, signal: AbortSignal): Promise<TeamSnapshot>;
    sendMessage(callerId: string, targetId: string, message: string, signal: AbortSignal): Promise<{
        queued: true;
        wakeup: false;
    }>;
    /** Called at a live target's pre-step. Never wakes an idle/cold Agent. */
    flushMessages(targetId: string, signal: AbortSignal): Promise<number>;
    followupTask(callerId: string, targetId: string, message: string, signal: AbortSignal): Promise<TeamSnapshot>;
    interruptAgent(callerId: string, targetId: string, signal: AbortSignal): Promise<TeamSnapshot>;
    observe(id: string, value: {
        status: TeamSnapshot['status'];
        text?: string;
        error?: string;
    }): void;
    listAgents(callerId: string): TeamSnapshot[];
    waitAgents(callerId: string, targets: string[], options: {
        timeoutMs?: number;
        afterCursor?: string;
    }, signal: AbortSignal): Promise<{
        cursor: string;
        timedOut: boolean;
        agents: TeamSnapshot[];
    }>;
    close(): Promise<void>;
}
export {};
