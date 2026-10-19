import type { TeamSnapshot } from './collaboration.js';
interface AuditOwner {
    id: string;
    session: {
        header: {
            cwd?: string;
        };
    };
}
export declare function createCollaborationAudit(parent: AuditOwner): {
    write({ runId, record }: {
        runId: string;
        record: TeamSnapshot;
    }): void;
};
export declare function readCollaborationAudit(parent: AuditOwner): Promise<TeamSnapshot[]>;
export {};
