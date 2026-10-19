/** One native root-owned evidence host shared by independently bundled plugins. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { installMemoryHost, type MemoryConfig } from './memory-host.js';
import { type PreTruncationCaptureHandle } from './capture-memory.js';
export declare const EVIDENCE_SUPPORT_PROTOCOL = "dsh-ultra-evidence/v1";
export interface EvidenceSupportConfig extends MemoryConfig {
    globalKnowledge?: unknown;
}
export interface EvidenceSupportOptions {
    owner: 'ultra' | 'memory' | 'decision';
    isUltraEnabled?(agent: Agent): boolean;
    canPublish?(agent: Agent): boolean;
}
export interface EvidenceSupportLease {
    memory: ReturnType<typeof installMemoryHost>;
    ownsTools: true;
    captureStatus(): ReturnType<PreTruncationCaptureHandle['status']> | undefined;
    knowledgeStatus(agent: Agent): unknown;
    readonly readTools: readonly string[];
    release(): Promise<void>;
    ready(): Promise<void>;
}
export declare function acquireEvidenceSupport(ctx: Context, config: EvidenceSupportConfig, options: EvidenceSupportOptions): EvidenceSupportLease;
