import { memoryFor } from './memory-host.js';
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
export function installPreTruncationCapture(ctx, host) {
    const counters = { capturedResults: 0, capturedPtcLogs: 0, ignoredResults: 0, unavailableCaptures: 0, captureFailures: 0 };
    let disposed = false;
    function capture(agent, callId, name, content, isError, ptc) {
        if (disposed)
            return;
        if (['ultra_memory_search', 'ultra_memory_get', 'ultra_knowledge_search', 'ultra_knowledge_get'].includes(name)) {
            counters.ignoredResults++;
            return;
        }
        try {
            const run = agent && memoryFor(agent);
            if (!agent || !run || run.host !== host || !run.active) {
                counters.ignoredResults++;
                return;
            }
            // Recheck live registry/project/lineage authorization at the host boundary.
            if (host.access(agent) !== run) {
                counters.ignoredResults++;
                return;
            }
            const ids = run.captureTool(agent, callId, name, { content, ...(isError === undefined ? {} : { isError }) });
            if (ids.length === 0) {
                counters.unavailableCaptures++;
                return;
            }
            if (ptc)
                counters.capturedPtcLogs++;
            else
                counters.capturedResults++;
        }
        catch {
            // The writer records its own detailed failures. Do not log private output
            // or turn an observer/storage failure into an execution failure.
            counters.captureFailures++;
        }
    }
    const disposers = [];
    try {
        disposers.push(ctx.on('tools/execute', async (exec, next) => {
            const result = await next();
            capture(exec.agent, exec.callId, exec.name, result.content, result.isError, false);
            return result;
        }, { prepend: true }));
        disposers.push(ctx.on('tools/ptc-dispatch-log', async (dispatch, next) => {
            capture(dispatch.agent ?? dispatch.exec.agent, dispatch.subCallId, dispatch.name, dispatch.content, dispatch.isError, true);
            return next();
        }, { prepend: true }));
    }
    catch (error) {
        for (const dispose of disposers.reverse())
            dispose();
        throw error;
    }
    return {
        dispose() {
            if (disposed)
                return;
            disposed = true;
            for (const dispose of disposers.reverse())
                dispose();
        },
        status: () => ({ ...counters, coverage: 'normalized-public-output-before-host-retention', limitations: [
                'Only normalized public rendered output observable at the middleware boundary is captured; tool-body/render clipping cannot be recovered.',
                'Calls denied before tools/execute and thrown dispatches can have no pre-retention capture; canonical host events remain separate evidence.',
                'PTC canonical program values, private presentation metadata, provider streams, and private reasoning are not indexed.',
                'Fallback output remains stored when the durable host log contains a different retained preview; capture is not a claim that a task was verified.',
            ] }),
    };
}
//# sourceMappingURL=capture-memory.js.map