import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type UltraMemoryHost } from './memory-host.js';
interface Options {
    isUltraEnabled(agent: Agent): boolean;
    signal: AbortSignal;
    ordinaryEnabled?(): boolean;
    publishPolicy?(agent: Agent): boolean;
}
export declare function installKnowledgeIntegration(context: Context, config: {
    globalKnowledge?: unknown;
}, memory: UltraMemoryHost, options: Options): {
    readTools: readonly string[];
    status: (agent: Agent) => {
        lifecycleErrors: string[];
        enabled: boolean;
        available: boolean;
        project: string;
        read: boolean;
        publish: boolean;
        assessment: string;
        hostVerified: boolean;
    } | {
        lifecycleErrors: string[];
        enabled: boolean;
        available: boolean;
        project?: undefined;
        read?: undefined;
        publish?: undefined;
        assessment?: undefined;
        hostVerified?: undefined;
    } | undefined;
    close: () => Promise<void>;
};
export {};
