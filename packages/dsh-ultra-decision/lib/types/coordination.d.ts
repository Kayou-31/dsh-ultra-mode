/** Only observed boundaries; partial model streams never become instructions. */
export interface RouteProgress {
    sessionId: string;
    sequence: number;
    kind: 'tool' | 'assistant';
    text: string;
    at: number;
    evidenceIds?: string[];
    originalChars?: number;
}
export interface SteeringDirective {
    routeId: string;
    instruction: string;
}
export interface CoordinationDecision {
    assessment: string;
    directives: SteeringDirective[];
}
export interface CoordinationRecord extends SteeringDirective {
    round: number;
    at: number;
}
export interface CoordinationSummary {
    rounds: number;
    directives: CoordinationRecord[];
    errors: string[];
}
export interface CoordinationSnapshot {
    routeId: string;
    status: 'starting' | 'running' | 'completed' | 'failed';
    progress?: RouteProgress;
    report?: string;
    evidenceIds?: string[];
}
/** Accept only a strict bounded protocol targeting this invocation's active loops. */
export declare function parseCoordinationDecision(text: string, activeIds: ReadonlySet<string>): CoordinationDecision;
/** Reports are evidence only; this turn proposes directions without gaining write access. */
export declare function buildCoordinationPrompt(task: string, snapshots: readonly CoordinationSnapshot[], round: number, previous: CoordinationSummary, reportChars: number, governanceProtocol?: string): string;
export declare function renderCoordinationSummary(summary: CoordinationSummary): string;
