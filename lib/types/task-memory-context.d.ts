import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** Only our exact, single-section native projection may leave the capsule.
 * Mixed/unknown snapshots retain their literal text. Raw host history remains
 * in the archive manifest and is still available through its read-through. */
export declare function isTaskMemorySnapshot(event: SessionEvent): boolean;
