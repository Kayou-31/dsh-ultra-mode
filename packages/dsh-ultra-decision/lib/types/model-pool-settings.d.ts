/** Native profile schema and Settings bridge; no parallel configuration store. */
import z from '@deepseek-ai/schemastery';
import { ModelPool, type ModelPoolSource } from './model-pool.js';
import type { TeamSnapshot } from './collaboration.js';
export declare const ModelPoolSchema: z<NoInfer<Schemastery.ObjectS<NoInfer<{
    models: z<({
        id?: string | null | undefined;
        name?: string | null | undefined;
        enabled?: boolean | null | undefined;
        provider?: string | null | undefined;
        model?: string | null | undefined;
        strengths?: string | null | undefined;
        suitableFor?: string | null | undefined;
        avoidFor?: string | null | undefined;
        reasoningEffort?: string | null | undefined;
        maxTokens?: number | null | undefined;
        isDefault?: boolean | null | undefined;
        maxConcurrent?: number | null | undefined;
        allowCrossProvider?: boolean | null | undefined;
        allowUnverifiedTools?: boolean | null | undefined;
        costNote?: string | null | undefined;
        costSource?: "user" | "measured" | null | undefined;
        speedNote?: string | null | undefined;
        speedSource?: "user" | "measured" | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "plain">;
        name: z<string, string, "plain">;
        enabled: z<boolean, boolean, "defined">;
        provider: z<string, string, "plain">;
        model: z<string, string, "plain">;
        strengths: z<string, string, "defined">;
        suitableFor: z<string, string, "defined">;
        avoidFor: z<string, string, "defined">;
        reasoningEffort: z<string, string, "plain">;
        maxTokens: z<number, number, "plain">;
        isDefault: z<boolean, boolean, "defined">;
        maxConcurrent: z<number, number, "defined">;
        allowCrossProvider: z<boolean, boolean, "defined">;
        allowUnverifiedTools: z<boolean, boolean, "defined">;
        costNote: z<string, string, "defined">;
        costSource: z<"user" | "measured", "user" | "measured", "defined">;
        speedNote: z<string, string, "defined">;
        speedSource: z<"user" | "measured", "user" | "measured", "defined">;
    }>>[], "defined">;
    explicitModelId: z<string, string, "defined">;
    fallback: z<"default" | "error" | "inherit", "default" | "error" | "inherit", "defined">;
    maxConcurrent: z<number, number, "defined">;
    maxRequests: z<number, number, "defined">;
    failureLimit: z<number, number, "defined">;
}>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
    models: z<({
        id?: string | null | undefined;
        name?: string | null | undefined;
        enabled?: boolean | null | undefined;
        provider?: string | null | undefined;
        model?: string | null | undefined;
        strengths?: string | null | undefined;
        suitableFor?: string | null | undefined;
        avoidFor?: string | null | undefined;
        reasoningEffort?: string | null | undefined;
        maxTokens?: number | null | undefined;
        isDefault?: boolean | null | undefined;
        maxConcurrent?: number | null | undefined;
        allowCrossProvider?: boolean | null | undefined;
        allowUnverifiedTools?: boolean | null | undefined;
        costNote?: string | null | undefined;
        costSource?: "user" | "measured" | null | undefined;
        speedNote?: string | null | undefined;
        speedSource?: "user" | "measured" | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "plain">;
        name: z<string, string, "plain">;
        enabled: z<boolean, boolean, "defined">;
        provider: z<string, string, "plain">;
        model: z<string, string, "plain">;
        strengths: z<string, string, "defined">;
        suitableFor: z<string, string, "defined">;
        avoidFor: z<string, string, "defined">;
        reasoningEffort: z<string, string, "plain">;
        maxTokens: z<number, number, "plain">;
        isDefault: z<boolean, boolean, "defined">;
        maxConcurrent: z<number, number, "defined">;
        allowCrossProvider: z<boolean, boolean, "defined">;
        allowUnverifiedTools: z<boolean, boolean, "defined">;
        costNote: z<string, string, "defined">;
        costSource: z<"user" | "measured", "user" | "measured", "defined">;
        speedNote: z<string, string, "defined">;
        speedSource: z<"user" | "measured", "user" | "measured", "defined">;
    }>>[], "defined">;
    explicitModelId: z<string, string, "defined">;
    fallback: z<"default" | "error" | "inherit", "default" | "error" | "inherit", "defined">;
    maxConcurrent: z<number, number, "defined">;
    maxRequests: z<number, number, "defined">;
    failureLimit: z<number, number, "defined">;
}>>>, "volatile-defined">;
interface SettingsContext {
    fiber?: {
        entry?: {
            options?: {
                id?: string;
            };
        };
    };
    get(name: string): unknown;
}
export declare function createModelPoolSettings(ctx: SettingsContext, config: {
    collaborationModelPool?: ModelPoolSource;
}, records: (id: string) => TeamSnapshot[] | Promise<TeamSnapshot[]>): {
    pool: ModelPool;
    get: (sessionId: string) => Promise<{
        config: import("./model-pool.js").ModelPoolConfig;
        hostModels: {
            provider: string;
            model: string;
            name: string;
        }[];
        editable: boolean;
        records: TeamSnapshot[];
        catalogErrors: string[];
    }>;
    save: (sessionId: string, value: unknown) => Promise<{
        config: import("./model-pool.js").ModelPoolConfig;
        hostModels: {
            provider: string;
            model: string;
            name: string;
        }[];
        editable: boolean;
        records: TeamSnapshot[];
        catalogErrors: string[];
    }>;
};
export {};
