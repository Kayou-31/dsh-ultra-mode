/** Ultra orchestration for the installed DSH 0.2.0-rc.2 extension API. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type RunConfig } from './orchestrator.js';
import type { CoordinationSummary } from './coordination.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'ultra-mode': {
            kind: 'ultra-mode';
            form: 'notice';
            summary: string;
            runId: string;
            routeIds: string[];
            decisionId: string;
            coordination?: CoordinationSummary;
        };
    }
}
export declare const name = "@dsh-external/dsh-ultra-mode";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    toolName: z<string, string, "defined">;
    concurrency: z<number, number, "defined">;
    collaborationEnabled: z<boolean, boolean, "defined">;
    collaborationProvider: z<string, string, "defined">;
    collaborationMaxAgents: z<number, number, "defined">;
    sectionOrder: z<number, number, "defined">;
    maxSessions: z<number, number, "defined">;
    timeoutMs: z<number, number, "defined">;
    reportChars: z<number, number, "defined">;
    planningMaxTokens: z<number, number, "defined">;
    researchMaxTokens: z<number, number, "defined">;
    decisionMaxTokens: z<number, number, "defined">;
    coordinationMaxTokens: z<number, number, "defined">;
    coordinationIntervalMs: z<number, number, "defined">;
    coordinationMaxRounds: z<number, number, "defined">;
    coordinationFailureLimit: z<number, number, "defined">;
    evidenceEnabled: z<boolean, boolean, "defined">;
    memorySearchChars: z<number, number, "defined">;
    memoryGetChars: z<number, number, "defined">;
    contextTargetTokens: z<number, number, "defined">;
    contextOutputReserveTokens: z<number, number, "defined">;
    contextToolReserveTokens: z<number, number, "defined">;
    contextCompression: z<boolean, boolean, "defined">;
    memoryMaxRequests: z<number, number, "defined">;
    memoryMaxTokens: z<number, number, "defined">;
    researchTools: z<string[], string[], "defined">;
    jevEnabled: z<boolean, boolean, "defined">;
    jevKeyEnv: z<string, string, "defined">;
    jevModel: z<string, string, "defined">;
    jevBaseUrl: z<string, string, "defined">;
    jevTimeoutMs: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    toolName: z<string, string, "defined">;
    concurrency: z<number, number, "defined">;
    collaborationEnabled: z<boolean, boolean, "defined">;
    collaborationProvider: z<string, string, "defined">;
    collaborationMaxAgents: z<number, number, "defined">;
    sectionOrder: z<number, number, "defined">;
    maxSessions: z<number, number, "defined">;
    timeoutMs: z<number, number, "defined">;
    reportChars: z<number, number, "defined">;
    planningMaxTokens: z<number, number, "defined">;
    researchMaxTokens: z<number, number, "defined">;
    decisionMaxTokens: z<number, number, "defined">;
    coordinationMaxTokens: z<number, number, "defined">;
    coordinationIntervalMs: z<number, number, "defined">;
    coordinationMaxRounds: z<number, number, "defined">;
    coordinationFailureLimit: z<number, number, "defined">;
    evidenceEnabled: z<boolean, boolean, "defined">;
    memorySearchChars: z<number, number, "defined">;
    memoryGetChars: z<number, number, "defined">;
    contextTargetTokens: z<number, number, "defined">;
    contextOutputReserveTokens: z<number, number, "defined">;
    contextToolReserveTokens: z<number, number, "defined">;
    contextCompression: z<boolean, boolean, "defined">;
    memoryMaxRequests: z<number, number, "defined">;
    memoryMaxTokens: z<number, number, "defined">;
    researchTools: z<string[], string[], "defined">;
    jevEnabled: z<boolean, boolean, "defined">;
    jevKeyEnv: z<string, string, "defined">;
    jevModel: z<string, string, "defined">;
    jevBaseUrl: z<string, string, "defined">;
    jevTimeoutMs: z<number, number, "defined">;
}>>, "plain">;
export interface Config extends RunConfig {
    concurrency: number;
    sectionOrder: number;
    maxSessions: number;
    evidenceEnabled?: boolean;
    memorySearchChars?: number;
    memoryGetChars?: number;
    contextTargetTokens?: number;
    contextOutputReserveTokens?: number;
    contextToolReserveTokens?: number;
    contextCompression?: boolean;
    memoryMaxRequests?: number;
    memoryMaxTokens?: number;
}
/** Registers automatic turn dispatch, the independent button RPC, and manual command/tool entries. */
export declare function apply(ctx: Context, config: Config): void;
