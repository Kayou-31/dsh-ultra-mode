/** Observe accessible tool output before host retention; never rewrite tool outcomes. */
import type { Context } from '@deepseek-ai/cordis';
import { type UltraMemoryHost } from './memory-host.js';
export interface PreTruncationCaptureStatus {
    capturedResults: number;
    capturedPtcLogs: number;
    ignoredResults: number;
    unavailableCaptures: number;
    captureFailures: number;
    coverage: 'normalized-public-output-before-host-retention';
    limitations: string[];
}
export interface PreTruncationCaptureHandle {
    dispose(): void;
    status(): PreTruncationCaptureStatus;
}
/**
 * rc.2 tools/execute returns normalized renderer output before projectContent,
 * post-execute spill/retention, and finalizeContent. PTC's separate log waterfall
 * exposes its settled rendered content before log-only retention. Tool-owned
 * clipping in execute()/output.render() has already happened and is unavailable.
 *
 * The host-owned captureTool writer is idempotent by call identity and persists
 * fallback bytes before this wrapper returns. A later retained tools/result must
 * not replace that source; it can be promoted to a host reference only on an
 * exact hash match after the host checkpoint. No result, cancellation, or original
 * dispatch error is changed by evidence availability.
 */
export declare function installPreTruncationCapture(ctx: Context, host: UltraMemoryHost): PreTruncationCaptureHandle;
