import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { agentCarrier } from '@deepseek-ai/dsh-agent';
import { runUltra } from './orchestrator.js';
import { researchToolDenial, routeParentOf } from './runtime.js';
import { routeCount, resolveSessionKey, snapshotOf, renderUltraSection } from './ultra.js';
export const name = '@dsh-external/dsh-ultra-mode';
export const inject = ['agents', 'tools', 'systemPrompt'];
export const Config = z.object({
    toolName: z.string().default('ultra_task'),
    concurrency: z.number().step(1).min(3).max(5).default(3),
    sectionOrder: z.number().default(117.5),
    maxSessions: z.number().step(1).min(1).default(64),
    timeoutMs: z.number().step(1).min(1000).max(86400000).default(900000),
    reportChars: z.number().step(1).min(1000).max(100000).default(20000),
    researchTools: z.array(z.string()).default(['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'subagent', 'subagent_fork', 'wait', 'list_agents', 'send_message', 'interrupt_agent']),
    jevEnabled: z.boolean().default(false),
    jevKeyEnv: z.string().default('TYPESAFE_API_KEY'),
    jevModel: z.string().default('jev-latest'),
    jevBaseUrl: z.string().default('https://api.typesafe.ai'),
    jevTimeoutMs: z.number().step(1).min(100).max(120000).default(15000),
});
/** Registers automatic turn dispatch, the independent button RPC, and manual command/tool entries. */
export function apply(ctx, config) {
    routeCount(config.concurrency);
    const host = ctx;
    const shutdown = new AbortController();
    const pending = new Set();
    const deliveryOnly = new WeakSet();
    const sessions = new Map();
    const stateFor = (id, create = false) => {
        const existing = sessions.get(id);
        if (existing !== undefined) {
            sessions.delete(id);
            sessions.set(id, existing);
            return existing;
        }
        if (!create)
            return undefined;
        while (sessions.size >= config.maxSessions) {
            const oldest = [...sessions.entries()].find(([, s]) => s.activeRuns === 0);
            if (oldest === undefined)
                throw new Error('Ultra 所有状态均在运行中，请稍后再试。');
            sessions.delete(oldest[0]);
        }
        const state = { enabled: false, concurrency: config.concurrency, activeRuns: 0, phase: 'idle', error: null, lastRun: null };
        sessions.set(id, state);
        return state;
    };
    const execute = async (agent, task, content, signal, count, route) => {
        shutdown.signal.throwIfAborted();
        if (routeParentOf(agent) !== undefined)
            throw new Error('Ultra 内部路线及其子代理不能递归开启 Ultra。');
        if (deliveryOnly.has(agent))
            throw new Error('本轮 Ultra 已交付；下一轮用户消息可开始新任务。');
        const state = stateFor(agent.id, true);
        if (state.activeRuns > 0)
            throw new Error('当前会话已有 Ultra 运行；请等待完成或取消。');
        const concurrency = routeCount(count ?? state.concurrency);
        const startedAt = Date.now();
        state.activeRuns = 1;
        state.error = null;
        let result;
        let drain;
        try {
            const run = runUltra(config, { parent: agent, task, content, concurrency, signal: AbortSignal.any([signal, shutdown.signal]), route, phase: phase => { state.phase = phase; } });
            drain = run.then(() => { }, () => { });
            pending.add(drain);
            result = await run;
            deliveryOnly.add(agent);
            state.phase = result.decided ? 'completed' : 'failed';
            if (!result.decided)
                state.error = '决策路线失败；保留报告，但未形成最终交付。';
            return result;
        }
        catch (error) {
            state.phase = signal.aborted || shutdown.signal.aborted ? 'cancelled' : 'failed';
            state.error = error instanceof Error ? error.message : String(error);
            throw error;
        }
        finally {
            state.activeRuns = 0;
            if (drain !== undefined)
                pending.delete(drain);
            state.lastRun = { at: Date.now(), ms: Date.now() - startedAt, requested: concurrency, succeeded: result?.succeeded ?? 0, runId: result?.runId ?? '' };
        }
    };
    host.tools.guard(exec => {
        if (exec.agent !== undefined && deliveryOnly.has(exec.agent))
            return 'Ultra 决策已完成，本轮主会话只负责转述；禁止重复工具操作。';
        if (exec.agent !== undefined && routeParentOf(exec.agent) !== undefined && exec.name === config.toolName)
            return 'Ultra 内部路线及其子代理不能递归开启 Ultra。';
        return researchToolDenial(exec.agent, exec.name);
    });
    host.tools.register(defineTool({
        name: config.toolName,
        description: '仅当用户明确请求 Ultra 而会话按钮未开启时使用：3–5 条独立 Max 执行路线，加 1 条持续 Max 决策路线规划、实施和收敛。每路保留正常子代理能力。按钮开启时由宿主自动调度，无需调用本工具。',
        timeoutMs: config.timeoutMs,
        parameters: { task: { type: 'string', required: true, description: '用户完整任务' }, concurrency: { type: 'integer', enum: [3, 4, 5], description: '执行路线数，不含决策路线' } },
        output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true }, runId: { type: 'string', required: true }, succeeded: { type: 'integer', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            if (!exec.agent)
                throw new Error('ultra_task requires a calling agent');
            const task = args.task.trim();
            if (task === '')
                throw new Error('任务不能为空');
            const result = await execute(exec.agent, task, [{ type: 'text', text: task }], exec.signal, args.concurrency);
            return { text: result.output, runId: result.runId, succeeded: result.succeeded };
        },
    }));
    host.on('agent/pre-step', (async (payload, next) => {
        if (payload.step === 1)
            deliveryOnly.delete(payload.agent);
        const decision = await next();
        if (decision.kind !== 'enter' || payload.step !== 1 || routeParentOf(payload.agent) !== undefined || !stateFor(payload.agent.id)?.enabled)
            return decision;
        const user = decision.messages.filter(m => m.source.kind === 'user');
        if (user.length === 0)
            return decision;
        const content = user.flatMap(m => [...m.content]);
        const task = content.filter((b) => b.type === 'text').map(b => b.text).join('\n');
        const dispatch = payload.agent.ctx;
        const selected = await dispatch.waterfall(agentCarrier(payload.agent), 'agent/request', payload, () => Promise.resolve({ ...payload.agent.options }));
        const route = typeof selected.provider === 'string' && typeof selected.model === 'string' ? { provider: selected.provider, model: selected.model } : undefined;
        const result = await execute(payload.agent, task || '处理用户附带的材料', content, payload.signal, undefined, route);
        return { ...decision, messages: [...decision.messages, createUserMessage({
                    content: [{ type: 'text', text: '【Ultra 决策结果】\n' + result.output + '\n\n以上是本轮决策路线的交付结果。直接转述给用户，保持事实、路径与验证边界。不要调用工具重新实施或再开启 Ultra。' }],
                    source: { kind: 'ultra-mode', form: 'notice', summary: `Ultra ${result.requested} + 1：成功 ${result.succeeded} 条执行路线`, runId: result.runId, routeIds: result.routeIds, decisionId: result.decisionId },
                })] };
    }));
    host.inject(['systemPrompt'], owner => {
        const service = owner.get('systemPrompt');
        service.section({ name: 'ultra-mode', order: config.sectionOrder, text: ({ agent }) => {
                if (agent === undefined || routeParentOf(agent) !== undefined)
                    return '';
                return renderUltraSection(stateFor(agent.id));
            } });
    });
    host.inject(['commands'], owner => {
        const commands = owner.get('commands');
        commands.register({ name: 'ultra', description: 'Ultra：3–5 条 Max 执行路线 + 1 条决策路线', input: { hint: '[on|off|3|4|5]', attachments: false },
            handler: ({ agent, rawInput }) => {
                const id = resolveSessionKey(agent?.id);
                if (id === undefined || (agent !== undefined && routeParentOf(agent) !== undefined))
                    return { kind: 'error', text: '/ultra 只能用于主会话。' };
                const state = stateFor(id, true);
                const input = (rawInput ?? '').trim().toLowerCase();
                if (input === 'off')
                    state.enabled = false;
                else if (input === 'on')
                    state.enabled = true;
                else if (['3', '4', '5'].includes(input)) {
                    state.concurrency = Number(input);
                    state.enabled = true;
                }
                else if (input !== '')
                    return { kind: 'error', text: '用法：/ultra on | off | 3 | 4 | 5' };
                return { kind: 'success', text: state.enabled ? `Ultra 已开启：${state.concurrency} 条 Max 执行路线 + 1 条 Max 决策路线。` : 'Ultra 已关闭。' };
            },
        });
    });
    host.inject(['connection', 'webServer'], owner => {
        const connection = owner.connection;
        // Explicit owner avoids the installed Cordis RPC getter's shadowed origin.
        owner.effect(() => connection.register(owner, '/dsh-ultra-mode', (endpoint, payload) => {
            const data = (typeof payload === 'object' && payload !== null ? payload : {});
            const id = resolveSessionKey(data.sessionId);
            if (id === undefined)
                return { ok: false, error: { code: 'missing-session-id', message: 'sessionId is required' } };
            if (endpoint !== 'get' && endpoint !== 'set')
                return { ok: false, error: { code: 'not-found', message: 'unknown endpoint' } };
            try {
                if (endpoint === 'set') {
                    if (data.enabled !== undefined && typeof data.enabled !== 'boolean')
                        throw new Error('enabled must be boolean');
                    if (data.concurrency !== undefined)
                        routeCount(data.concurrency);
                    const state = stateFor(id, true);
                    if (typeof data.enabled === 'boolean')
                        state.enabled = data.enabled;
                    if (typeof data.concurrency === 'number')
                        state.concurrency = data.concurrency;
                }
                const state = stateFor(id) ?? { enabled: false, concurrency: config.concurrency, activeRuns: 0, phase: 'idle', error: null, lastRun: null };
                return { ok: true, value: snapshotOf(state) };
            }
            catch (error) {
                return { ok: false, error: { code: 'invalid-setting', message: error instanceof Error ? error.message : String(error) } };
            }
        }));
    });
    // Register last so scoped teardown cancels and drains in-flight routes first.
    host.effect(() => async () => {
        shutdown.abort(new Error('Ultra plugin unloaded'));
        await Promise.allSettled([...pending]);
    });
}
//# sourceMappingURL=index.js.map