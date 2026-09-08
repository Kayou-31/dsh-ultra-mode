import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildMergePrompt, buildWorkerBrief, clampConcurrency, fallbackJoin, isRunning, planMerge, renderUltraSection, resolveSessionKey, runBanner, snapshotOf, } from './ultra.js';
export const name = '@dsh-external/dsh-ultra-mode';
export const inject = ['tools', 'subagents'];
export const Config = z.object({
    /** subagent provider 名；留空自动探测（spawn → 首个可用）。 */
    provider: z.string().default(''),
    /** 模型可见工具名。 */
    toolName: z.string().default('ultra_task'),
    /** 默认并发路数 2-5。 */
    concurrency: z.number().step(1).min(2).max(5).default(3),
    /** 提示词段插入顺序。 */
    sectionOrder: z.number().default(117.5),
    /** 会话状态条目上限（超出按最久未用淘汰）。 */
    maxSessions: z.number().step(1).min(1).default(64),
});
/** Client→Host 私有 RPC 通道（与 client 半共享）。 */
const RPC_CHANNEL = '/dsh-ultra-mode';
export function apply(ctx, config) {
    const textOf = (result) => Array.isArray(result.output)
        ? result.output
            .filter((b) => typeof b === 'object' &&
            b !== null &&
            b.type === 'text' &&
            typeof b.text === 'string')
            .map((b) => b.text)
            .join('')
        : '';
    const providerOf = () => {
        const names = ctx.subagents.list();
        if (config.provider !== '')
            return config.provider;
        if (names.includes('spawn'))
            return 'spawn';
        return names[0];
    };
    // ── 会话隔离状态（读取不创建；LRU 上限） ─────────────────────────
    const sessions = new Map();
    const touch = (key, state) => {
        sessions.delete(key);
        sessions.set(key, state);
        while (sessions.size > config.maxSessions) {
            const oldest = sessions.keys().next();
            if (oldest.done === true)
                break;
            sessions.delete(oldest.value);
        }
        return state;
    };
    /** Read-only lookup: an unknown session reports "no state", not a new entry. */
    const peek = (key) => {
        if (key === undefined)
            return undefined;
        const found = sessions.get(key);
        if (found !== undefined)
            touch(key, found);
        return found;
    };
    /** Mutating lookup used only by explicit user actions (UI / command / tool). */
    const ensure = (key) => {
        const found = sessions.get(key);
        if (found !== undefined)
            return touch(key, found);
        return touch(key, { enabled: false, concurrency: config.concurrency, activeRuns: 0, lastRun: null });
    };
    // ── Client RPC（sessionId 必填，缺失即拒绝） ──────────────────────
    // `connection` 只由 Web 载体提供，且晚于 tools/subagents 就绪：在 apply
    // 时刻用 `ctx.get('connection')` 一次性读取通常拿到 undefined，通道就永远
    // 不会注册——滑块 get/set 全部失败，松手后回落到已提交位。优先用 ctx.inject
    // 等服务出现再挂通道；没有 inject 的老版本/极简 ctx 退回一次性读取（服务
    // 已经就绪的场合仍然可用），两者都不命中时其余能力不受影响。
    const mountRpc = (owner) => {
        const connection = owner.get('connection');
        if (connection?.rpc === undefined)
            return;
        const rpc = connection.rpc;
        owner.effect(() => rpc.handle(RPC_CHANNEL, (endpoint, payload) => {
            const request = (payload ?? {});
            const key = resolveSessionKey(request.sessionId);
            if (key === undefined) {
                return { ok: false, error: { code: 'missing-session-id', message: 'sessionId is required' } };
            }
            if (endpoint === 'get') {
                const state = peek(key);
                return {
                    ok: true,
                    value: state === undefined
                        ? { enabled: false, concurrency: config.concurrency, running: false, activeRuns: 0, lastRun: null }
                        : snapshotOf(state),
                };
            }
            if (endpoint === 'set') {
                const state = ensure(key);
                if (typeof request.enabled === 'boolean')
                    state.enabled = request.enabled;
                if (request.concurrency !== undefined) {
                    state.concurrency = clampConcurrency(request.concurrency, state.concurrency);
                }
                return { ok: true, value: snapshotOf(state) };
            }
            return {
                ok: false,
                error: { code: 'not-found', message: `unknown endpoint ${JSON.stringify(endpoint)}` },
            };
        }, { authority: 'loopback' }));
    };
    const injectService = ctx.inject;
    if (typeof injectService === 'function')
        injectService.call(ctx, ['connection'], mountRpc);
    else
        mountRpc(ctx);
    // ── ultra_task 工具 ────────────────────────────────────────────
    ctx.tools.register(defineTool({
        name: config.toolName,
        description: 'ULTRA 模式：并发运行 N 个独立 agent 处理同一个任务（类似 o1-pro 的 self-consistency 多路采样），全部完成后由第 N+1 个 agent 把各分支结果交叉核对并合并成一份最终答案。提示词段会给出当前会话的 ULTRA 开关状态：开启时每个新用户请求必须先调用本工具再作答；用户明确要求“ultra/并发处理”时也可使用。代价约为 N+1 个完整 agent 会话。',
        parameters: {
            task: {
                type: 'string',
                required: true,
                description: '要并发处理的完整任务描述（应自包含，子代理看不到本对话）',
            },
            concurrency: {
                type: 'number',
                description: '并发路数 2-5（默认取当前 ULTRA 设置，默认 3）',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    kind: { type: 'string', required: true, const: 'foreground' },
                    runId: { type: 'string', required: true },
                    output: { type: 'array', required: true, items: { type: 'json' } },
                },
            },
            render: (_args, value) => [{ type: 'text', text: textOf({ output: value.output }) }],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const agent = exec && exec.agent;
            const parent = agent;
            if (!parent)
                throw new Error('ultra_task requires a calling agent');
            const key = resolveSessionKey(parent.id);
            if (key === undefined)
                throw new Error('ultra_task requires a session identity (agent.id)');
            const state = ensure(key);
            const task = String((args && args.task) || '').trim();
            if (task === '')
                throw new Error('ultra_task requires a non-empty task');
            const requested = clampConcurrency(args && args.concurrency !== undefined ? args.concurrency : state.concurrency, state.concurrency);
            const provider = providerOf();
            if (provider === undefined)
                throw new Error('no subagent provider available (subagents.list() is empty)');
            const startedAt = Date.now();
            const runs = [];
            let mergeRun;
            state.activeRuns += 1;
            try {
                const workerBrief = buildWorkerBrief(task);
                for (let i = 0; i < requested; i += 1) {
                    // 逐路启动：任何一路失败都会进入 finally，已启动的 run 一并释放。
                    runs.push(await ctx.subagents.start(provider, {
                        label: `ultra-${i + 1}/${requested}`,
                        prompt: [{ type: 'text', text: workerBrief }],
                        parent,
                        signal: exec.signal,
                    }));
                }
                const outcomes = await Promise.all(runs.map(async (run) => {
                    try {
                        const result = await run.result;
                        if (result.stopReason !== 'completed') {
                            return {
                                ok: false,
                                error: `worker ended: ${result.stopReason}${result.diagnostic ? `: ${result.diagnostic}` : ''}`,
                            };
                        }
                        return { ok: true, text: textOf(result) };
                    }
                    catch (error) {
                        return { ok: false, error: String(error) };
                    }
                }));
                const plan = planMerge(outcomes, requested);
                if (plan.strategy === 'insufficient') {
                    const errors = outcomes.map((o) => o.error ?? 'empty output').join(' | ');
                    throw new Error(`ULTRA 只获得 ${plan.succeeded}/${plan.requested} 路可用结果（少于 2 路，可靠性不足，已放弃合并）：${errors}`);
                }
                let merged = '';
                try {
                    mergeRun = await ctx.subagents.start(provider, {
                        label: 'ultra-merge',
                        prompt: [{ type: 'text', text: buildMergePrompt(task, outcomes, plan) }],
                        parent,
                        signal: exec.signal,
                    });
                    const mergeResult = await mergeRun.result;
                    if (mergeResult.stopReason === 'completed')
                        merged = textOf(mergeResult);
                }
                catch {
                    // 合并失败不掩盖分支成果；清理仍在 finally 统一进行。
                    merged = '';
                }
                const body = merged.trim() === '' ? fallbackJoin(outcomes) : merged;
                const banner = runBanner(plan);
                return {
                    kind: 'foreground',
                    runId: 'ultra',
                    output: [{ type: 'text', text: banner === '' ? body : `${banner}\n\n${body}` }],
                };
            }
            finally {
                state.activeRuns = Math.max(0, state.activeRuns - 1);
                if (!isRunning(state))
                    state.lastRun = { at: Date.now(), ms: Date.now() - startedAt };
                await Promise.allSettled([
                    ...runs.map((run) => run.dispose()),
                    ...(mergeRun === undefined ? [] : [mergeRun.dispose()]),
                ]);
            }
        },
    }));
    // ── /ultra 命令（软依赖；无 agent 身份时拒绝修改） ────────────────
    const commands = ctx.get('commands');
    if (commands !== undefined) {
        commands.register({
            name: 'ultra',
            description: 'toggle ULTRA multi-agent concurrency mode for this session',
            input: { hint: '[on|off|<2-5>]', images: false },
            handler: (invocation) => {
                const key = resolveSessionKey(invocation?.agent?.id);
                if (key === undefined) {
                    return { kind: 'error', text: '/ultra 需要一个会话身份（当前上下文没有 agent），已拒绝修改。' };
                }
                const state = ensure(key);
                const input = String((invocation && invocation.rawInput) || '').trim();
                const lower = input.toLowerCase();
                if (input === '') {
                    return {
                        kind: 'success',
                        text: `ULTRA: ${state.enabled ? `开（${state.concurrency} 路并发）` : '关'}\n用法: /ultra on | off | <2-5>`,
                    };
                }
                if (lower === 'on') {
                    state.enabled = true;
                    return { kind: 'success', text: `ULTRA 已开启（${state.concurrency} 路并发）。` };
                }
                if (lower === 'off') {
                    state.enabled = false;
                    return { kind: 'success', text: 'ULTRA 已关闭。' };
                }
                const num = Number(input);
                if (Number.isInteger(num) && num >= 2 && num <= 5) {
                    state.concurrency = clampConcurrency(num, state.concurrency);
                    state.enabled = true;
                    return { kind: 'success', text: `ULTRA 已开启（${state.concurrency} 路并发）。` };
                }
                return { kind: 'error', text: '用法: /ultra on | off | <2-5>' };
            },
        });
    }
    // ── 提示词引导段（软依赖；每次装配按会话状态求值） ─────────────────
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt !== undefined) {
        systemPrompt.section({
            name: 'ultra-mode',
            order: config.sectionOrder,
            // AssembleContext 携带 agent（DSH 的 assembleContextFor 同时设置 agent 与
            // scope），因此这里能读到"当前会话"的开关状态并注入到本轮提示词。
            text: (context) => {
                const key = resolveSessionKey(context?.agent?.id);
                return renderUltraSection(peek(key), config.toolName);
            },
        });
    }
}
//# sourceMappingURL=index.js.map