import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
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
});
/** Client→Host 私有 RPC 通道（与 client 半共享）。 */
const RPC_CHANNEL = '/dsh-ultra-mode';
export function apply(ctx, config) {
    const clampN = (v) => {
        const num = Number(v);
        if (!Number.isInteger(num))
            return 3;
        return Math.max(2, Math.min(5, num));
    };
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
    // ── 会话隔离状态 ────────────────────────────────────────────────
    const sessions = new Map();
    const stateOf = (sessionKey) => {
        let s = sessions.get(sessionKey);
        if (s === undefined) {
            s = { enabled: false, concurrency: config.concurrency, running: false, lastRun: null };
            sessions.set(sessionKey, s);
        }
        return s;
    };
    const keyOfAgent = (agent) => {
        if (agent && typeof agent === 'object' && 'id' in agent)
            return String(agent.id);
        return 'unknown';
    };
    // ── Client RPC ─────────────────────────────────────────────────
    const connection = ctx.get('connection');
    if (connection?.rpc) {
        const rpc = connection.rpc;
        ctx.effect(() => rpc.handle(RPC_CHANNEL, (endpoint, payload) => {
            const req = (payload ?? {});
            const key = typeof req.sessionId === 'string' ? req.sessionId : 'default';
            const state = stateOf(key);
            if (endpoint === 'get') {
                return { ok: true, value: { enabled: state.enabled, concurrency: state.concurrency, running: state.running, lastRun: state.lastRun } };
            }
            if (endpoint === 'set') {
                if (typeof req.enabled === 'boolean')
                    state.enabled = req.enabled;
                if (Number.isInteger(req.concurrency))
                    state.concurrency = clampN(req.concurrency);
                return { ok: true, value: { enabled: state.enabled, concurrency: state.concurrency, running: state.running, lastRun: state.lastRun } };
            }
            return { ok: false, error: { code: 'not-found', message: `unknown endpoint ${JSON.stringify(endpoint)}` } };
        }, { authority: 'loopback' }));
    }
    // ── ultra_task 工具 ────────────────────────────────────────────
    ctx.tools.register(defineTool({
        name: config.toolName,
        description: 'ULTRA 模式：并发运行 N 个独立 agent 处理同一个任务（类似 o1-pro 的 self-consistency 多路采样），全部完成后由第 N+1 个 agent 把各分支结果交叉核对并合并成一份最终答案。当 ULTRA 模式开启（composer 滑块），每个新用户请求必须先调用本工具再作答；用户明确要求“ultra/并发处理”时也可使用。代价约为 N+1 个完整 agent 会话。',
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
            render: (_args, value) => [
                { type: 'text', text: textOf({ output: value.output }) },
            ],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const agent = exec && exec.agent;
            const parent = agent;
            if (!parent)
                throw new Error('ultra_task requires a calling agent');
            const state = stateOf(keyOfAgent(parent));
            const startedAt = Date.now();
            state.running = true;
            try {
                const task = String((args && args.task) || '').trim();
                if (task === '')
                    throw new Error('ultra_task requires a non-empty task');
                const n = clampN(args && args.concurrency !== undefined ? args.concurrency : state.concurrency);
                const provider = providerOf();
                if (provider === undefined)
                    throw new Error('no subagent provider available (subagents.list() is empty)');
                const workerBrief = [
                    '你是 ULTRA 并发工作流的一个分支（独立 agent，看不到主对话）。',
                    '【任务】' + task,
                    '要求：',
                    '1. 独立、完整地处理该任务；你的最终回复就是交付物（完成态最终结果，不是草稿或过程汇报）。',
                    '2. 需要时可使用可用工具（读文件、执行命令、搜索等）取得事实后再下结论。',
                    '3. 最终回复用中文（除非任务另有要求），结构清晰、可直接使用。',
                    '4. 不要提及“分支、并发、ULTRA”等机制性内容。',
                ].join('\n');
                const runs = [];
                for (let i = 0; i < n; i += 1) {
                    runs.push(await ctx.subagents.start(provider, {
                        label: `ultra-${i + 1}/${n}`,
                        prompt: [{ type: 'text', text: workerBrief }],
                        parent,
                        signal: exec.signal,
                    }));
                }
                const results = await Promise.all(runs.map(async (run) => {
                    try {
                        const result = await run.result;
                        if (result.stopReason !== 'completed') {
                            return { ok: false, error: `worker ended: ${result.stopReason}${result.diagnostic ? `: ${result.diagnostic}` : ''}` };
                        }
                        return { ok: true, text: textOf(result) };
                    }
                    catch (error) {
                        return { ok: false, error: String(error) };
                    }
                }));
                const okWorkers = results.filter((r) => r.ok);
                if (okWorkers.length === 0) {
                    for (const run of runs) {
                        try {
                            await run.dispose();
                        }
                        catch { /* 清理失败不掩盖主错误 */ }
                    }
                    throw new Error(`all ultra workers failed: ${results.map((r) => r.error).join(' | ')}`);
                }
                const mergePrompt = buildMergePrompt(task, okWorkers);
                let merged = '';
                try {
                    const mergeRun = await ctx.subagents.start(provider, {
                        label: 'ultra-merge',
                        prompt: [{ type: 'text', text: mergePrompt }],
                        parent,
                        signal: exec.signal,
                    });
                    const mergeResult = await mergeRun.result;
                    if (mergeResult.stopReason === 'completed')
                        merged = textOf(mergeResult);
                    await mergeRun.dispose();
                }
                catch {
                    merged = '';
                }
                if (merged.trim() === '') {
                    merged = okWorkers.map((w, i) => `【分支 ${i + 1}】\n${w.text}`).join('\n\n');
                }
                for (const run of runs) {
                    try {
                        await run.dispose();
                    }
                    catch { /* 同上 */ }
                }
                return { kind: 'foreground', runId: 'ultra', output: [{ type: 'text', text: merged }] };
            }
            finally {
                state.running = false;
                state.lastRun = { at: Date.now(), ms: Date.now() - startedAt };
            }
        },
    }));
    const buildMergePrompt = (task, workers) => {
        const parts = workers
            .map((w, i) => `【结果 ${i + 1}】\n${(w.text ?? '').slice(0, 20000)}`)
            .join('\n\n');
        return [
            `你是 ULTRA 合并者。下面是 ${workers.length} 个独立 agent 对同一个任务的完成结果，任务原文如下：`,
            `【任务】${task}`,
            '',
            parts,
            '',
            '请：',
            '1. 交叉核对：找出共识点、分歧点和遗漏点；对分歧给出你的判断与理由。',
            '2. 整合出一份最终答案（中文，除非任务另有要求）：结构清晰、完整、可直接使用，宁全勿缺。',
            '3. 若某些分歧无法调和，在答案中注明。',
            '4. 最终回复即最终答案本身；不要附上流程说明。',
        ].join('\n');
    };
    // ── /ultra 命令（软依赖） ──────────────────────────────────────
    const commands = ctx.get('commands');
    if (commands !== undefined) {
        const register = (definition) => void commands.register(definition);
        register({
            name: 'ultra',
            description: 'toggle ULTRA multi-agent concurrency mode for this session',
            input: { hint: '[on|off|<2-5>]', images: false },
            handler: (invocation) => {
                const input = String((invocation && invocation.rawInput) || '').trim();
                const state = stateOf(keyOfAgent(invocation && invocation.agent));
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
                    state.concurrency = num;
                    state.enabled = true;
                    return { kind: 'success', text: `ULTRA 已开启（${num} 路并发）。` };
                }
                return { kind: 'error', text: '用法: /ultra on | off | <2-5>' };
            },
        });
    }
    // ── 提示词引导段（软依赖；无状态静态文案，跨会话安全） ─────────────
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt !== undefined) {
        systemPrompt.section({
            name: 'ultra-mode',
            order: config.sectionOrder,
            text: () => `存在 ${config.toolName} 工具：并发运行多个独立 agent 处理同一任务并合并答案（类似 o1-pro 多路采样）。当用户开启 ULTRA 模式（composer 滑块）或明确要求“ultra/并发处理”时，对每个新用户请求先在第一步调用 ${config.toolName}（task 参数 = 用户请求全文），再基于合并结果直接答复用户；不要重新执行整个任务，也不要对同一请求发起多次调用。`,
        });
    }
}
//# sourceMappingURL=index.js.map