/** Strategy protocol over the existing decision calls; owns no LLM or tool runtime. */
import { type TaskContract, type VerificationReport, type DiagnosticRecord } from './decision-contract.js';
import type { RouteProgress, CoordinationDecision } from './coordination.js';
interface DeliveryMetadata {
    directiveId: string;
    isCurrent(): boolean;
    onDelivery(status: 'queued' | 'admitted' | 'request-visible', sourceId: string): void;
}
export interface GovernanceSnapshot {
    enabled: true;
    contract: TaskContract;
    diagnostics: readonly DiagnosticRecord[];
    verification: VerificationReport | null;
    errors: string[];
    evidence: {
        observed: string[];
        toolResults: string[];
    };
    durable: boolean;
    closed: boolean;
}
export interface GovernanceStatus {
    enabled: true;
    taskHash: string;
    taskRevision: number;
    originalChars: number;
    intentItems: number;
    queued: number;
    admitted: number;
    requestVisible: number;
    effectVerified: number;
    closedDirections: number;
    verification: {
        satisfied: number;
        failed: number;
        unverified: number;
        allSatisfied: boolean;
        hostVerified: false;
    } | null;
    durable: boolean;
    closed: boolean;
    errors: string[];
}
export declare function governanceStatus(snapshot: GovernanceSnapshot): GovernanceStatus;
export declare class DecisionGovernance {
    private readonly persist?;
    private readonly observe?;
    private current;
    private ledger;
    private readonly observed;
    private readonly toolResults;
    private readonly dispatched;
    private readonly errors;
    private verification;
    private durable;
    private closed;
    private intentAccepted;
    constructor(task: string, sourceId: string, persist?: ((snapshot: GovernanceSnapshot) => void) | undefined, observe?: ((snapshot: GovernanceSnapshot) => void) | undefined);
    get contract(): TaskContract;
    private error;
    private publish;
    snapshot(): GovernanceSnapshot;
    contractEntry(): string;
    intentInstruction(): string;
    parsePlan(text: string, count: number): string[] | undefined;
    recordProgress(progress: RouteProgress): void;
    coordinationProtocol(): string;
    coordinate(text: string, activeIds: ReadonlySet<string>, steer: (routeId: string, instruction: string, meta: DeliveryMetadata) => boolean): CoordinationDecision;
    finalProtocol(): string;
    review(text: string): {
        output: string;
        verification: VerificationReport | null;
        valid: boolean;
    };
    closeRoute(routeId: string, reason?: string): void;
    close(reason?: string): void;
}
export {};
