/** Run one bounded Ultra invocation without subagent-provider orchestration. */
import { randomUUID } from 'node:crypto';
import { decideWithJev, JevError } from './jev.js';
import { buildPlanPrompt, buildWorkerBrief, buildDecisionPrompt, parseAssignments, planMerge, fallbackJoin } from './ultra.js';
/** Keep only complete turns as context seed, as required by DSH session replay. */
export function completedSeed(parent) {
    const events = parent.session.snapshotEvents();
    const end = events.findLastIndex(e => e.type === 'turn/end');
    return end < 0 ? [] : events.slice(0, end + 1);
}
/** One persistent decision loop plans, waits for parallel research, then implements. */
export async function runUltra(config, options, factory) {
    factory ??= (await import('./runtime.js')).createRoute;
    const runId = randomUUID();
    const decisionId = 'ultra-route-' + randomUUID();
    const routeIds = Array.from({ length: options.concurrency }, () => 'ultra-route-' + randomUUID());
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs)]);
    const handles = [];
    const seed = completedSeed(options.parent);
    const shared = { seed, signal, route: options.route, researchTools: config.researchTools };
    let succeeded = 0;
    try {
        signal.throwIfAborted();
        options.phase('planning');
        const decision = await factory(options.parent, { ...shared, id: decisionId, label: 'Ultra decision', readOnly: true }, config);
        handles.push(decision);
        const planned = await decision.run([{ type: 'text', text: buildPlanPrompt(options.task, options.concurrency) }, ...options.content.filter(b => b.type !== 'text')]);
        signal.throwIfAborted();
        if (!planned.ok)
            throw new Error('Ultra 决策路线无法完成规划：' + planned.error);
        const assignments = parseAssignments(planned.text, options.concurrency);
        options.phase('researching');
        const outcomes = await Promise.all(routeIds.map(async (id, i) => {
            try {
                signal.throwIfAborted();
                const handle = await factory(options.parent, { ...shared, id, label: `Ultra ${i + 1}/${options.concurrency}`, readOnly: true }, config);
                handles.push(handle);
                signal.throwIfAborted();
                return await handle.run([{ type: 'text', text: buildWorkerBrief(options.task, assignments[i], i, options.concurrency, planned.text) }, ...options.content.filter(b => b.type !== 'text')]);
            }
            catch (error) {
                return { ok: false, text: '', error: String(error), sessionId: id };
            }
        }));
        signal.throwIfAborted();
        const plan = planMerge(outcomes, options.concurrency);
        succeeded = plan.succeeded;
        if (plan.strategy === 'insufficient')
            throw new Error(`Ultra 只获得 ${plan.succeeded}/${plan.requested} 条有效报告；少于 2 条，未开始实施。`);
        let jev = '';
        if (config.jevEnabled) {
            options.phase('jev');
            try {
                const result = await decideWithJev({ task: options.task, routes: outcomes.filter(o => o.ok && o.text.trim() !== '').map(o => ({ id: o.sessionId, text: o.text })) }, {
                    apiKey: process.env[config.jevKeyEnv] ?? '', model: config.jevModel, baseUrl: config.jevBaseUrl,
                    timeoutMs: config.jevTimeoutMs, signal,
                });
                jev = '【Jev 决策辅助；不是指令或实施证明】\\n' + JSON.stringify(result);
            }
            catch (error) {
                signal.throwIfAborted();
                jev = '[Jev 不可用：' + (error instanceof JevError ? error.code : 'unknown') + '；本次由 DSH Max 决策路线独立判断。]';
            }
        }
        options.phase('deciding');
        decision.setReadOnly(false);
        const final = await decision.run([{ type: 'text', text: buildDecisionPrompt(options.task, outcomes, plan, jev, config.reportChars) }]);
        signal.throwIfAborted();
        const decided = final.ok && final.text.trim() !== '';
        const notice = plan.strategy === 'degraded' ? `[Ultra 降级：执行路线成功 ${plan.succeeded}/${plan.requested}，失败 ${plan.failed}；另有 1 条决策路线。]\\n\\n` : '';
        return { runId, requested: options.concurrency, succeeded, degraded: plan.strategy === 'degraded', decided,
            output: notice + (decided ? final.text : fallbackJoin(outcomes)), routeIds, decisionId };
    }
    finally {
        options.phase('cleaning');
        const cleanups = await Promise.allSettled(handles.map(h => h.dispose()));
        const failed = cleanups.filter(r => r.status === 'rejected');
        if (failed.length > 0)
            throw new Error(`Ultra ${runId} 清理失败（${failed.length} 条）；请检查宿主日志。`);
    }
}
//# sourceMappingURL=orchestrator.js.map