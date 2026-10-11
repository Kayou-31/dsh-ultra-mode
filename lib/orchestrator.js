/** Run one bounded Ultra invocation without subagent-provider orchestration. */
import { randomUUID } from 'node:crypto';
import { decideWithJev, JevError } from './jev.js';
import { buildPlanPrompt, buildWorkerBrief, buildDecisionPrompt, parseAssignments, planMerge, fallbackJoin } from './ultra.js';
import { buildCoordinationPrompt, parseCoordinationDecision, renderCoordinationSummary } from './coordination.js';
/** Keep only complete turns as context seed, as required by DSH session replay. */
export function completedSeed(parent) {
    const events = parent.session.snapshotEvents();
    const end = events.findLastIndex(e => e.type === 'turn/end');
    return end < 0 ? [] : events.slice(0, end + 1);
}
/** Observe running loops and serialize every intermediate turn on the same decision. */
class ResearchCoordinator {
    decision;
    config;
    options;
    signal;
    summary = { rounds: 0, directives: [], errors: [] };
    pending;
    snapshots = new Map();
    active = new Map();
    revision = 0;
    consumed = 0;
    wake;
    stopped = false;
    constructor(decision, routeIds, config, options, signal) {
        this.decision = decision;
        this.config = config;
        this.options = options;
        this.signal = signal;
        this.pending = new Set(routeIds);
        for (const routeId of routeIds)
            this.snapshots.set(routeId, { routeId, status: 'starting' });
    }
    observe(handle) {
        this.active.set(handle.id, handle);
        this.snapshots.set(handle.id, { routeId: handle.id, status: 'running' });
        return handle.subscribeProgress?.((progress) => {
            if (this.stopped || this.signal.aborted || !this.pending.has(handle.id) || progress.sessionId !== handle.id || !Number.isFinite(progress.sequence))
                return;
            const previous = this.snapshots.get(handle.id);
            if (previous.progress !== undefined && progress.sequence <= previous.progress.sequence)
                return;
            this.snapshots.set(handle.id, { ...previous, progress: { ...progress, text: progress.text.slice(0, 2000) } });
            this.revision++;
            this.wake?.();
        }) ?? (() => { });
    }
    settled(id, outcome) {
        this.pending.delete(id);
        this.active.delete(id);
        const previous = this.snapshots.get(id);
        this.snapshots.set(id, { ...previous, status: outcome.ok ? 'completed' : 'failed', report: outcome.ok ? outcome.text : outcome.error ?? outcome.text });
        this.revision++;
        this.wake?.();
    }
    stop() { this.stopped = true; this.wake?.(); }
    changed(delay) {
        return new Promise(resolve => {
            let timer;
            const done = () => {
                if (timer !== undefined)
                    clearTimeout(timer);
                this.signal.removeEventListener('abort', done);
                if (this.wake === done)
                    this.wake = undefined;
                resolve();
            };
            this.wake = done;
            this.signal.addEventListener('abort', done, { once: true });
            if (delay !== undefined)
                timer = setTimeout(done, delay);
            if (this.stopped || this.signal.aborted || this.pending.size === 0)
                done();
        });
    }
    async run() {
        const interval = Math.min(60000, Math.max(100, this.config.coordinationIntervalMs ?? 1000));
        const configuredMaxRounds = this.config.coordinationMaxRounds ?? -1;
        const maxRounds = configuredMaxRounds === -1 ? Infinity : Math.min(1000, Math.max(0, configuredMaxRounds));
        let nextAt = Date.now() + interval;
        while (!this.stopped && !this.signal.aborted && this.pending.size > 0 && this.summary.rounds < maxRounds) {
            if (this.revision <= this.consumed) {
                await this.changed();
                continue;
            }
            const remaining = nextAt - Date.now();
            if (remaining > 0) {
                await this.changed(remaining);
                continue;
            }
            if (this.stopped || this.signal.aborted || this.pending.size === 0)
                break;
            const activeIds = new Set(this.active.keys());
            if (activeIds.size === 0) {
                await this.changed();
                continue;
            }
            this.consumed = this.revision;
            const round = ++this.summary.rounds;
            nextAt = Date.now() + interval;
            this.options.phase('coordinating');
            try {
                const response = await this.decision.run([{ type: 'text', text: buildCoordinationPrompt(this.options.task, [...this.snapshots.values()], round, this.summary, this.config.reportChars) }]);
                if (this.signal.aborted || this.stopped)
                    break;
                if (!response.ok)
                    throw new Error(response.error ?? '协调路线未返回完成报告');
                const parsed = parseCoordinationDecision(response.text, activeIds);
                for (const directive of parsed.directives) {
                    const target = this.active.get(directive.routeId);
                    if (!this.pending.has(directive.routeId))
                        continue;
                    if (target?.steer?.(directive.instruction))
                        this.summary.directives.push({ ...directive, round, at: Date.now() });
                    else
                        this.summary.errors.push(`第 ${round} 轮：${directive.routeId} 未接收方向调整，未记入改向记录。`);
                }
            }
            catch (error) {
                if (!this.signal.aborted)
                    this.summary.errors.push(`第 ${round} 轮：${error instanceof Error ? error.message : String(error)}`.slice(0, 2000));
            }
            finally {
                if (!this.stopped && !this.signal.aborted && this.pending.size > 0)
                    this.options.phase('researching');
            }
        }
        return this.summary;
    }
}
/** One persistent decision loop plans, coordinates active research, then implements. */
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
        const coordinator = new ResearchCoordinator(decision, routeIds, config, options, signal);
        const coordinationDone = coordinator.run();
        const outcomes = await Promise.all(routeIds.map(async (id, i) => {
            let stopProgress;
            let outcome = { ok: false, text: '', error: '路线未开始', sessionId: id };
            try {
                signal.throwIfAborted();
                const handle = await factory(options.parent, { ...shared, id, label: `Ultra ${i + 1}/${options.concurrency}`, readOnly: true }, config);
                handles.push(handle);
                signal.throwIfAborted();
                stopProgress = coordinator.observe(handle);
                outcome = await handle.run([{ type: 'text', text: buildWorkerBrief(options.task, assignments[i], i, options.concurrency, planned.text) }, ...options.content.filter(b => b.type !== 'text')]);
            }
            catch (error) {
                outcome = { ok: false, text: '', error: String(error), sessionId: id };
            }
            finally {
                try {
                    stopProgress?.();
                }
                catch (error) {
                    outcome = { ok: false, text: outcome.text, error: `停止路线进展订阅失败：${String(error)}`, sessionId: id };
                }
            }
            coordinator.settled(id, outcome);
            return outcome;
        }));
        // A running coordination turn must settle before this same decision starts its
        // final turn. Completed workers suppress every not-yet-started coordination.
        coordinator.stop();
        const coordination = await coordinationDone;
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
        const final = await decision.run([{ type: 'text', text: buildDecisionPrompt(options.task, outcomes, plan, jev, config.reportChars) + '\n\n' + renderCoordinationSummary(coordination) }]);
        signal.throwIfAborted();
        const decided = final.ok && final.text.trim() !== '';
        const notice = plan.strategy === 'degraded' ? `[Ultra 降级：已返回有效报告 ${plan.succeeded}/${plan.requested}，未返回有效报告 ${plan.failed}；另有 1 条决策路线。]\\n\\n` : '';
        return { runId, requested: options.concurrency, succeeded, degraded: plan.strategy === 'degraded', decided,
            output: notice + (decided ? final.text : fallbackJoin(outcomes)), routeIds, decisionId, coordination };
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