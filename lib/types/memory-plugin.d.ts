/** Optional memory/knowledge companion; never creates a model or coordination loop. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type EvidenceSupportConfig } from './evidence-support.js';
export declare const name = "@dsh-external/dsh-ultra-memory";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    evidenceEnabled: z<boolean, boolean, "defined">;
    globalKnowledge: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        projects: z<({
            id?: string | null | undefined;
            root?: string | null | undefined;
            read?: boolean | null | undefined;
            publish?: boolean | null | undefined;
            shareWith?: string[] | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "plain">;
            root: z<string, string, "plain">;
            read: z<boolean, boolean, "defined">;
            publish: z<boolean, boolean, "defined">;
            shareWith: z<string[], string[], "defined">;
        }>>[], "defined">;
        maxSearchChars: z<number, number, "defined">;
        maxGetChars: z<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        projects: z<({
            id?: string | null | undefined;
            root?: string | null | undefined;
            read?: boolean | null | undefined;
            publish?: boolean | null | undefined;
            shareWith?: string[] | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "plain">;
            root: z<string, string, "plain">;
            read: z<boolean, boolean, "defined">;
            publish: z<boolean, boolean, "defined">;
            shareWith: z<string[], string[], "defined">;
        }>>[], "defined">;
        maxSearchChars: z<number, number, "defined">;
        maxGetChars: z<number, number, "defined">;
    }>>>, "volatile-defined">;
    memorySearchChars: z<number, number, "defined">;
    memoryGetChars: z<number, number, "defined">;
    contextTargetTokens: z<number, number, "defined">;
    contextTriggerTokens: z<number, number, "plain">;
    contextRetainRecentMessages: z<number, number, "defined">;
    contextMinResultChars: z<number, number, "defined">;
    contextMaxPrunes: z<number, number, "defined">;
    contextPreviewChars: z<number, number, "defined">;
    contextCompactLocators: z<boolean, boolean, "defined">;
    contextRetrievalReceipts: z<boolean, boolean, "defined">;
    contextArchiveCompletedTurns: z<boolean, boolean, "defined">;
    contextOutputReserveTokens: z<number, number, "defined">;
    contextToolReserveTokens: z<number, number, "defined">;
    contextCompression: z<boolean, boolean, "defined">;
    memoryMaxRequests: z<number, number, "defined">;
    memoryMaxTokens: z<number, number, "defined">;
    taskMemoryEnabled: z<boolean, boolean, "defined">;
    taskMemoryMaxBytes: z<number, number, "defined">;
    taskMemoryConditionalRecall: z<boolean, boolean, "defined">;
    taskMemoryRecallLimit: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    evidenceEnabled: z<boolean, boolean, "defined">;
    globalKnowledge: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        projects: z<({
            id?: string | null | undefined;
            root?: string | null | undefined;
            read?: boolean | null | undefined;
            publish?: boolean | null | undefined;
            shareWith?: string[] | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "plain">;
            root: z<string, string, "plain">;
            read: z<boolean, boolean, "defined">;
            publish: z<boolean, boolean, "defined">;
            shareWith: z<string[], string[], "defined">;
        }>>[], "defined">;
        maxSearchChars: z<number, number, "defined">;
        maxGetChars: z<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        projects: z<({
            id?: string | null | undefined;
            root?: string | null | undefined;
            read?: boolean | null | undefined;
            publish?: boolean | null | undefined;
            shareWith?: string[] | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "plain">;
            root: z<string, string, "plain">;
            read: z<boolean, boolean, "defined">;
            publish: z<boolean, boolean, "defined">;
            shareWith: z<string[], string[], "defined">;
        }>>[], "defined">;
        maxSearchChars: z<number, number, "defined">;
        maxGetChars: z<number, number, "defined">;
    }>>>, "volatile-defined">;
    memorySearchChars: z<number, number, "defined">;
    memoryGetChars: z<number, number, "defined">;
    contextTargetTokens: z<number, number, "defined">;
    contextTriggerTokens: z<number, number, "plain">;
    contextRetainRecentMessages: z<number, number, "defined">;
    contextMinResultChars: z<number, number, "defined">;
    contextMaxPrunes: z<number, number, "defined">;
    contextPreviewChars: z<number, number, "defined">;
    contextCompactLocators: z<boolean, boolean, "defined">;
    contextRetrievalReceipts: z<boolean, boolean, "defined">;
    contextArchiveCompletedTurns: z<boolean, boolean, "defined">;
    contextOutputReserveTokens: z<number, number, "defined">;
    contextToolReserveTokens: z<number, number, "defined">;
    contextCompression: z<boolean, boolean, "defined">;
    memoryMaxRequests: z<number, number, "defined">;
    memoryMaxTokens: z<number, number, "defined">;
    taskMemoryEnabled: z<boolean, boolean, "defined">;
    taskMemoryMaxBytes: z<number, number, "defined">;
    taskMemoryConditionalRecall: z<boolean, boolean, "defined">;
    taskMemoryRecallLimit: z<number, number, "defined">;
}>>, "plain">;
export type Config = EvidenceSupportConfig;
export declare function apply(ctx: Context, config: Config): Promise<void>;
