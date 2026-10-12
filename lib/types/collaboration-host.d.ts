import type { Agent } from '@deepseek-ai/dsh-agent';
import { CollaborationTeam } from './collaboration.js';
export interface CollaborationHostConfig {
    collaborationEnabled?: boolean;
    collaborationProvider?: string;
    collaborationMaxAgents?: number;
}
export declare const COLLABORATION_TOOLS: readonly ["ultra_spawn_agent", "ultra_send_message", "ultra_followup_task", "ultra_wait_agent", "ultra_interrupt_agent", "ultra_list_agents"];
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'ultra-collaboration': {
            kind: 'ultra-collaboration';
            form: 'relay';
            senderSessionId: string;
            runId: string;
        };
    }
}
export interface CollaborationHostHandle {
    team: CollaborationTeam;
    close(): Promise<void>;
}
/** Install only on the root and children this collaboration run actually creates. */
export declare function installCollaboration(parent: Agent, config: CollaborationHostConfig): CollaborationHostHandle;
