import { agentCarrier } from '@deepseek-ai/dsh-agent';
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session';
const routes = new Map();
/** Whether an identity is a directly owned ULTRA loop rather than its coordinator. */
export function isUltraRoute(id) {
    return routes.has(id);
}
/** Follow logged lineage so delegated children retain the route's execution policy. */
function ancestorState(agent) {
    const visited = new Set();
    let cursor = agent;
    while (cursor !== undefined && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        const found = routes.get(cursor.id);
        if (found !== undefined)
            return found;
        const parentId = cursor.session.header.parentSession;
        cursor = parentId === undefined ? undefined : agent.ctx.agents.get(parentId);
    }
    return undefined;
}
/** Global tool guards use this lookup because a subagent joins a preset, not its parent's scope. */
export function isResearchRoute(agent) {
    return ancestorState(agent)?.readOnly === true;
}
/** Return the visible conversation that owns an internal loop or its delegated descendants. */
export function routeParentOf(agent) {
    return ancestorState(agent)?.parent;
}
/** Apply a route's read-only allow list to every direct or PTC sub-dispatch. */
export function researchToolDenial(agent, toolName) {
    if (agent === undefined)
        return undefined;
    const state = ancestorState(agent);
    if (state?.readOnly !== true)
        return undefined;
    // PTC can run arbitrary JavaScript, including direct filesystem access outside
    // nested tool dispatch. A tool allow list cannot make that transport read-only.
    // Keep research routes on native tools until confined PTC is verified end to end.
    if (toolName !== 'run_code' && state.researchTools.has(toolName))
        return undefined;
    return `ULTRA research routes cannot execute ${toolName}; report the proposed change to the decision route.`;
}
/** Tools and prompt sections live on preset scopes in DSH 0.2; a fresh loop must join one. */
function composeRoute(childCtx, parent, child, toolName, state) {
    const presets = childCtx.get('agentPresets');
    if (presets === undefined)
        throw new Error('ULTRA requires the DSH agent preset registry');
    presets.composeFrom(childCtx, parent.ctx);
    attachRouteCapabilities(childCtx, parent, child, toolName, state);
    const events = childCtx;
    events.on('agent/request', async (_payload, next) => ({
        ...await next(),
        reasoningEffort: ReasoningEffortId('max'),
    }));
}
/** A delegated child joins the shared preset but does not inherit route-local hooks. */
function attachRouteCapabilities(childCtx, parent, child, toolName, state) {
    const tools = childCtx.get('tools');
    if (tools === undefined)
        throw new Error('ULTRA requires the DSH tools registry');
    state.attachedAgents.add(child);
    childCtx.effect(() => () => {
        state.attachedAgents.delete(child);
        const presentation = state.presentations.get(child);
        state.presentations.delete(child);
        presentation?.dispose();
    }, 'ultra.routePresentation()');
    updatePresentation(state, child);
    if (tools.get(toolName, child) !== undefined)
        tools.restrict({ deny: [toolName] });
    const events = childCtx;
    // The approval audit remains on the calling loop; only the visible answerer scope changes.
    events.on('approval/request', (request) => parent.ctx.waterfall(agentCarrier(parent), 'approval/request', request, () => Promise.resolve('unavailable')));
    // DSH's human-question service accepts only live roots. Keep the child tool-call
    // audit, and execute its public question tool with the visible root identity.
    const questionTool = tools.get('ask_user_question', child);
    if (questionTool !== undefined) {
        const schema = questionTool.parameters;
        const timed = schema.properties?.timeout !== undefined;
        tools.register({
            ...questionTool,
            execute: (args, exec) => questionTool.execute(timed && typeof args === 'object' && args !== null ? { ...args, timeout: -1 } : args, { ...exec, agent: parent }),
        });
    }
}
/** Native research schemas preserve tools/subagents while arbitrary PTC remains denied. */
function updatePresentation(state, agent) {
    const tools = agent.ctx.get('tools');
    const desired = state.readOnly ? 'native' : state.parentPresentation;
    const previous = state.presentations.get(agent);
    if (previous?.mode === desired)
        return;
    previous?.dispose();
    state.presentations.delete(agent);
    // A scoped override is necessary only when the retained preset differs.
    // Its exact disposer removes both mode and any owned PTC prompt sections.
    if (tools.modeFor(agent) !== desired)
        state.presentations.set(agent, { mode: desired, dispose: tools.presentAs(desired) });
}
/** Read only this run's settled log suffix, never inherited answers or earlier decision turns. */
function outcomeOf(agent, boundary, label, aborted) {
    const events = agent.session.snapshotEvents().slice(boundary);
    let text = '';
    let ending;
    for (const event of events) {
        if (event.type === 'assistant/message') {
            const message = event;
            const candidate = message.data.message.content
                .filter((block) => block.type === 'text')
                .map(block => block.text).join('');
            if (candidate.length > 0)
                text = candidate;
        }
        else if (event.type === 'turn/end') {
            ending = event.data.reason;
        }
    }
    if (!aborted && ending?.kind === 'completed' && text.length > 0) {
        return { ok: true, text, sessionId: agent.id };
    }
    const reason = aborted ? 'cancelled' : ending?.kind ?? 'no completed turn';
    return {
        ok: false, text, sessionId: agent.id,
        error: `${label}: ${reason}${ending?.message === undefined ? '' : `: ${ending.message}`}`,
    };
}
/** Create a loop without subagent origin or additional delegation depth. */
export async function createRoute(parent, options, config) {
    options.signal.throwIfAborted();
    if (routes.has(options.id))
        throw new Error(`ULTRA route ${options.id} already exists`);
    const inherited = parent.session.requestHeader()?.config ?? parent.options;
    const selected = options.route ?? inherited;
    if (!selected.provider || !selected.model)
        throw new Error('ULTRA cannot create a route before provider and model are selected');
    const sandbox = parent.ctx.get('sandboxPolicy');
    const inheritedMode = sandbox?.resolve({ session: parent.session }).mode;
    const approval = parent.ctx.get('approval');
    const inheritedApproval = approval?.effectivePolicy(parent.session);
    const parentTools = parent.ctx.get('tools');
    if (parentTools === undefined)
        throw new Error('ULTRA requires the DSH tools registry');
    const state = {
        parent,
        readOnly: options.readOnly === true,
        researchTools: new Set(options.researchTools ?? []),
        parentPresentation: parentTools.modeFor(parent),
        attachedAgents: new Set(),
        presentations: new Map(),
    };
    routes.set(options.id, state);
    // The registry's serial creation notification precedes the child's first turn.
    // Listen at deployment scope: lifecycle ownership is independent of preset scopes.
    const stopDescendants = parent.ctx.root.on('agent/created', payload => {
        const descendant = payload.agent;
        if (descendant.id !== options.id && ancestorState(descendant) === state) {
            attachRouteCapabilities(descendant.ctx, parent, descendant, config.toolName, state);
        }
    });
    let handle;
    try {
        handle = await parent.ctx.agents.create({
            sessionId: SessionId(options.id),
            parentAgent: parent,
            meta: {
                ...(parent.session.header.cwd === undefined ? {} : { cwd: parent.session.header.cwd }),
                parentSession: parent.id,
                isSeeded: (options.seed?.length ?? 0) > 0,
            },
            ...(options.seed === undefined ? {} : {
                seed: options.seed,
                inheritedEventCount: SessionLogOffset(options.seed.length),
            }),
            agentOptions: {
                provider: selected.provider,
                model: selected.model,
                reasoningEffort: ReasoningEffortId('max'),
                ...(parent.options.maxTokens === undefined ? {} : { maxTokens: parent.options.maxTokens }),
            },
            signal: options.signal,
            setup: (childCtx, child) => {
                state.agent = child;
                composeRoute(childCtx, parent, child, config.toolName, state);
                const policyLog = child.session;
                if (inheritedMode !== undefined)
                    policyLog.append('sandbox/mode', {
                        mode: state.readOnly ? 'read-only' : inheritedMode, source: 'delegation',
                    });
                if (inheritedApproval !== undefined)
                    policyLog.append('approval/policy', {
                        policy: inheritedApproval, source: 'delegation',
                    });
            },
        });
    }
    catch (error) {
        stopDescendants();
        routes.delete(options.id);
        throw error;
    }
    const child = handle.agent;
    let active = false;
    let disposal;
    const onAbort = () => { child.cancel({ kind: 'parent' }); };
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted)
        onAbort();
    return {
        id: options.id,
        setReadOnly(readOnly) {
            if (active)
                throw new Error('ULTRA cannot change route access while a turn is running');
            if (disposal !== undefined)
                throw new Error('ULTRA route is disposed');
            const mode = readOnly ? 'read-only' : inheritedMode;
            if (mode !== undefined)
                child.session.append('sandbox/mode', { mode, source: 'delegation' });
            state.readOnly = readOnly;
            for (const attached of state.attachedAgents)
                updatePresentation(state, attached);
        },
        async run(prompt) {
            if (active)
                throw new Error('ULTRA route already has an active turn');
            if (disposal !== undefined)
                throw new Error('ULTRA route is disposed');
            const boundary = child.session.seq;
            if (options.signal.aborted)
                return outcomeOf(child, boundary, options.label, true);
            active = true;
            try {
                child.followup(createUserMessage({ content: prompt, source: { kind: 'user' } }));
                await child.whenIdle();
                return outcomeOf(child, boundary, options.label, options.signal.aborted);
            }
            catch (error) {
                return { ok: false, text: '', sessionId: child.id, error: `${options.label}: ${error instanceof Error ? error.message : String(error)}` };
            }
            finally {
                active = false;
            }
        },
        dispose() {
            return disposal ??= (async () => {
                options.signal.removeEventListener('abort', onAbort);
                try {
                    await handle.dispose();
                }
                finally {
                    stopDescendants();
                    routes.delete(options.id);
                }
            })();
        },
    };
}
/** Execute a single route turn and drain its owned loop even after cancellation or failure. */
export async function runRoute(parent, options, config) {
    const route = await createRoute(parent, options, config);
    try {
        return await route.run(options.prompt);
    }
    finally {
        await route.dispose();
    }
}
//# sourceMappingURL=runtime.js.map