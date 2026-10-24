import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { installMemoryHost, uninstallMemoryHost } from './memory-host.js';
import { installPreTruncationCapture } from './capture-memory.js';
import { installKnowledgeIntegration } from './knowledge-integration.js';
import { installMemoryTools } from './memory-tools.js';
export const EVIDENCE_SUPPORT_PROTOCOL = 'dsh-ultra-evidence/v1';
const priority = { memory: 3, ultra: 2, decision: 1 };
const knowledgeEnabled = (config) => {
    const raw = config.globalKnowledge;
    return (typeof raw?.get === 'function' ? raw.get() : raw)?.enabled === true;
};
class EvidenceSupport {
    ctx;
    protocol = EVIDENCE_SUPPORT_PROTOCOL;
    memory;
    providers = new Set();
    selected;
    capture;
    removeReads;
    knowledge;
    knowledgeSignal;
    removeKnowledge;
    removeNative;
    pending = Promise.resolve();
    transitioning = false;
    closed = false;
    epoch = 0;
    closeTask;
    errors = [];
    config;
    constructor(ctx) {
        this.ctx = ctx;
        this.config = new Proxy({}, { get: (_target, key) => {
                if (this.closed)
                    return key === 'evidenceEnabled' ? false : undefined;
                return Reflect.get(this.selected?.config ?? {}, key);
            } });
        this.memory = installMemoryHost(ctx, this.config);
    }
    report(error) { if (this.errors.length < 16)
        this.errors.push(String(error).slice(0, 300)); }
    orchestrationOwned() { return [...this.providers].some(p => p.options.owner !== 'memory'); }
    ordinaryEnabled() { return this.config.evidenceEnabled !== false && [...this.providers].some(p => p.options.owner === 'memory'); }
    isUltraEnabled(agent) { return [...this.providers].some(p => p.options.isUltraEnabled?.(agent) === true); }
    canPublish(agent) {
        if (this.closed || this.transitioning || agent.status !== 'running')
            return false;
        if (this.ctx.get('agents')?.get(agent.id) !== agent)
            return false;
        try {
            const sandbox = agent.ctx.get('sandboxPolicy');
            if (sandbox?.resolve({ session: agent.session }).mode === 'read-only')
                return false;
            return [...this.providers].some(p => p.options.canPublish?.(agent) === true);
        }
        catch {
            return false;
        }
    }
    runFor(agent) {
        if (this.closed || this.config.evidenceEnabled === false)
            return undefined;
        try {
            const run = this.memory.access(agent);
            return run.active ? run : undefined;
        }
        catch {
            return undefined;
        }
    }
    ready() { return this.pending; }
    captureStatus() { return this.capture?.status(); }
    knowledgeStatus(agent) { return this.knowledge?.status(agent); }
    status() { return { protocol: this.protocol, owner: this.selected?.options.owner, leases: this.providers.size, transitioning: this.transitioning, errors: [...this.errors] }; }
    get readTools() { return knowledgeEnabled(this.config) ? ['ultra_knowledge_search', 'ultra_knowledge_get'] : []; }
    /** Root fiber, explicit returned disposers: the first requesting plugin owns no shared effects. */
    install() {
        const service = this, ctx = this.ctx;
        this.removeNative = ctx.effect(function* () {
            yield ctx.provide('ultraEvidenceSupport', service);
            yield ctx.on('session/event', (session, event) => {
                if (!service.closed && !service.orchestrationOwned())
                    service.memory.capture(session, event);
            });
            yield ctx.on('llm/stream', (async function* (options, next) {
                await service.ready();
                if (!service.closed && !service.orchestrationOwned())
                    service.memory.observeRequest(options);
                yield* next();
            }));
            const prompt = ctx.get('systemPrompt');
            if (typeof prompt?.context === 'function' && typeof prompt.refreshContext === 'function')
                yield prompt.context({
                    name: 'ultra-task-memory', order: 118, required: true, interpolate: false,
                    text: (request) => service.memory.taskContext(request.agent),
                });
            yield ctx.on('system-prompt/assemble', (async (_assembly, request, next) => {
                await service.ready();
                const accepted = await next();
                if (!request.agent || !service.memory.nativeTaskContext)
                    return accepted;
                await service.memory.prepareTaskMemory(request.agent);
                request.signal?.throwIfAborted();
                return prompt.refreshContext(accepted, request);
            }));
            yield ctx.on('agent/pre-step', (async (payload, next) => {
                await service.ready();
                if (service.closed || service.orchestrationOwned())
                    return next();
                await service.memory.beforeStep(payload.agent, payload.messages, payload.signal);
                const decision = await next();
                if (decision.kind !== 'enter')
                    return decision;
                const entry = service.memory.mainContext(payload.agent);
                return !entry ? decision : { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: entry }], source: { kind: 'ultra-mode', form: 'notice', summary: '项目证据恢复入口', runId: '', routeIds: [], decisionId: '' } })] };
            }));
            // Also drain on application shutdown if the host tears down the root before plugin leases.
            yield () => { if (!service.closed)
                return service.shutdown(false); };
        }, 'ultraEvidenceSupport: root leases');
    }
    acquire(config, options) {
        if (this.closed)
            throw new Error('Shared evidence support is closing; retry after plugin cleanup');
        const provider = { config, options }, previous = this.selected;
        this.providers.add(provider);
        this.choose();
        try {
            if (previous !== this.selected)
                this.refresh(previous === undefined);
        }
        catch (error) {
            this.providers.delete(provider);
            this.choose();
            throw error;
        }
        let releaseTask;
        const service = this;
        return {
            memory: this.memory, ownsTools: true,
            captureStatus: () => this.captureStatus(), knowledgeStatus: agent => this.knowledgeStatus(agent),
            ready: () => this.ready(),
            get readTools() { return service.readTools; },
            release() {
                if (releaseTask)
                    return releaseTask;
                const previous = service.selected;
                service.providers.delete(provider);
                service.choose();
                if (!service.providers.size)
                    return releaseTask = service.shutdown();
                if (previous !== service.selected)
                    service.refresh(false);
                return releaseTask = service.ready();
            },
        };
    }
    choose() {
        this.selected = [...this.providers].sort((a, b) => priority[b.options.owner] - priority[a.options.owner])[0];
        this.memory.refreshAuthority();
    }
    setupFeatures() {
        if (this.closed)
            return;
        // Reject a conflicting authority before installing any lifecycle listeners or
        // write guards. The previous integration has already drained at this point.
        if (knowledgeEnabled(this.config)) {
            const tools = this.ctx.get('tools');
            for (const name of ['ultra_knowledge_search', 'ultra_knowledge_get', 'ultra_knowledge_publish', 'ultra_knowledge_revoke']) {
                if (tools?.get(name))
                    throw new Error('Knowledge tool already registered: ' + name);
            }
        }
        if (this.config.evidenceEnabled !== false && !this.removeReads) {
            this.removeReads = installMemoryTools(this.ctx, this.memory);
            this.capture = installPreTruncationCapture(this.ctx, this.memory);
        }
        else if (this.config.evidenceEnabled === false) {
            this.removeReads?.();
            this.removeReads = undefined;
            this.capture?.dispose();
            this.capture = undefined;
        }
        const signal = new AbortController();
        this.knowledgeSignal = signal;
        try {
            this.knowledge = installKnowledgeIntegration(this.ctx, this.config, this.memory, {
                signal: signal.signal, ordinaryEnabled: () => this.ordinaryEnabled(),
                isUltraEnabled: agent => this.isUltraEnabled(agent), publishPolicy: agent => this.canPublish(agent),
            });
        }
        catch (error) {
            // The integration's abort handler owns rollback even if setup could not
            // return its handle. Never leave its partial hooks active after failure.
            signal.abort(error);
            this.knowledge = undefined;
            throw error;
        }
        const integration = this.knowledge;
        this.removeKnowledge = this.ctx.effect(() => () => integration.close(), 'ultraEvidenceSupport: knowledge lifecycle');
    }
    refresh(initial) {
        const epoch = ++this.epoch;
        if (initial) {
            this.setupFeatures();
            return;
        }
        this.transitioning = true;
        this.knowledgeSignal?.abort(new Error('Evidence configuration authority changed'));
        const remove = this.removeKnowledge;
        this.removeKnowledge = undefined;
        this.knowledge = undefined;
        // Keep the current transition's rejection visible to ready(), but recover
        // the queue when a subsequent lease change supplies a different authority.
        this.pending = this.pending.catch(() => { }).then(async () => {
            await remove?.();
            if (this.closed || epoch !== this.epoch)
                return;
            this.setupFeatures();
            this.transitioning = false;
        });
        void this.pending.catch(error => this.report(error));
    }
    shutdown(removeNative = true) {
        if (this.closeTask)
            return this.closeTask;
        this.closed = true;
        ++this.epoch;
        this.knowledgeSignal?.abort(new Error('Last evidence lease released'));
        this.capture?.dispose();
        this.capture = undefined;
        this.removeReads?.();
        this.removeReads = undefined;
        this.closeTask = (async () => {
            await this.pending.catch(error => this.report(error));
            await this.removeKnowledge?.();
            this.removeKnowledge = undefined;
            await this.memory.close();
            uninstallMemoryHost(this.ctx, this.memory);
            // Do not recursively await this shutdown from the root group's finalizer.
            if (removeNative) {
                const remove = this.removeNative;
                this.removeNative = undefined;
                await remove?.();
            }
        })();
        return this.closeTask;
    }
}
export function acquireEvidenceSupport(ctx, config, options) {
    const root = ctx.root ?? ctx;
    let service = ctx.get('ultraEvidenceSupport');
    if (service !== undefined) {
        if (!service || service.protocol !== EVIDENCE_SUPPORT_PROTOCOL || typeof service.acquire !== 'function')
            throw new Error('Incompatible ultraEvidenceSupport protocol; align companion package versions');
        return service.acquire(config, options);
    }
    if (root.get('ultraEvidenceSupport') !== undefined)
        throw new Error('Isolated ultraEvidenceSupport namespace is incompatible with the shared root');
    service = new EvidenceSupport(root);
    service.install();
    try {
        return service.acquire(config, options);
    }
    catch (error) {
        void service['shutdown']().catch(() => { });
        throw error;
    }
}
//# sourceMappingURL=evidence-support.js.map