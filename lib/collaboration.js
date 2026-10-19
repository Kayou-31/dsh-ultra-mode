/** Bounded collaboration ledger. The host adapter owns actual DSH delegation. */
import { randomUUID } from 'node:crypto';
const terminal = (status) => status === 'completed' || status === 'failed' || status === 'cancelled';
export class CollaborationTeam {
    options;
    adapter;
    members = new Map();
    mailbox = new Map();
    busy = new Set();
    listeners = new Set();
    pending = new Set();
    controller = new AbortController();
    revision = 0;
    closing;
    maxAgents;
    maxMailbox;
    maxTextChars;
    constructor(options, adapter) {
        this.options = options;
        this.adapter = adapter;
        if (!options.runId || !options.rootId)
            throw new Error('Collaboration requires a run and root identity');
        this.maxAgents = options.maxAgents ?? 8;
        this.maxMailbox = options.maxMailbox ?? 32;
        this.maxTextChars = options.maxTextChars ?? 20000;
        for (const value of [this.maxAgents, this.maxMailbox, this.maxTextChars]) {
            if (!Number.isSafeInteger(value) || value < 1)
                throw new Error('Collaboration limits must be positive integers');
        }
    }
    live(callerId, signal) {
        this.controller.signal.throwIfAborted();
        signal?.throwIfAborted();
        if (callerId !== this.options.rootId && !this.members.has(callerId))
            throw new Error('Agent is outside this Ultra collaboration run');
    }
    text(value, field) {
        if (typeof value !== 'string' || !value.trim() || value.length > this.maxTextChars)
            throw new Error(`${field} is empty or exceeds the collaboration text limit`);
        return value;
    }
    child(id) {
        const member = this.members.get(id);
        if (!member)
            throw new Error('Unknown collaboration child in this run');
        return member;
    }
    adjacent(callerId, targetId) {
        this.live(callerId);
        if (targetId === callerId)
            throw new Error('Cannot message yourself');
        const caller = this.members.get(callerId);
        const target = this.members.get(targetId);
        if (caller?.parentId !== targetId && target?.parentId !== callerId)
            throw new Error('Messaging requires a direct parent/child relationship');
    }
    changed() { this.options.onChange?.([...this.members.values()].map(m => this.copy(m))); for (const listener of this.listeners)
        listener(); }
    copy(member) { return JSON.parse(JSON.stringify(member)); }
    annotate(id, value) {
        const member = this.members.get(id);
        if (!member || this.controller.signal.aborted)
            return;
        Object.assign(member, JSON.parse(JSON.stringify(value)));
        member.revision = ++this.revision;
        this.changed();
    }
    track(operation) {
        this.pending.add(operation);
        void operation.finally(() => this.pending.delete(operation)).catch(() => { });
        return operation;
    }
    has(id) { return id === this.options.rootId || this.members.has(id); }
    spawn(callerId, request, signal) {
        this.live(callerId, signal);
        const taskName = this.text(request.taskName, 'taskName');
        if (taskName.length > 128)
            throw new Error('taskName exceeds 128 characters');
        const message = this.text(request.message, 'message');
        if ([...this.members.values()].some(member => member.parentId === callerId && member.taskName === taskName))
            throw new Error('Duplicate taskName; reuse the existing collaboration child');
        if (this.members.size >= this.maxAgents)
            throw new Error('Ultra collaboration agent capacity reached; reuse an existing child');
        const id = 'ultra-child-' + randomUUID();
        const member = { id, parentId: callerId, taskName, task: message, status: 'starting', revision: ++this.revision };
        this.members.set(id, member);
        const joined = AbortSignal.any([signal, this.controller.signal]);
        return this.track((async () => {
            let accepted = false;
            try {
                const receipt = await this.adapter.spawn(callerId, { id, taskName, message, ...(request.modelConfigId === undefined ? {} : { modelConfigId: request.modelConfigId }), ...(request.reason === undefined ? {} : { reason: request.reason }) }, joined);
                accepted = true;
                if (receipt.id !== id)
                    throw new Error('Native child identity differs from the reserved collaboration identity');
                joined.throwIfAborted();
                if (member.status === 'starting')
                    this.observe(id, { status: 'running' });
                return this.copy(member);
            }
            catch (error) {
                if (accepted) {
                    try {
                        await this.adapter.close([{ id, parentId: callerId }]);
                    }
                    catch (cleanup) {
                        throw new AggregateError([error, cleanup], 'Collaboration child admission and cleanup failed');
                    }
                }
                this.members.delete(id);
                this.mailbox.delete(id);
                this.changed();
                throw error;
            }
        })());
    }
    async sendMessage(callerId, targetId, message, signal) {
        this.live(callerId, signal);
        this.adjacent(callerId, targetId);
        const text = this.text(message, 'message');
        const pending = this.mailbox.get(targetId) ?? [];
        if (pending.length >= this.maxMailbox)
            throw new Error('Ultra collaboration mailbox capacity reached');
        pending.push({ callerId, message: text });
        this.mailbox.set(targetId, pending);
        return { queued: true, wakeup: false };
    }
    /** Called at a live target's pre-step. Never wakes an idle/cold Agent. */
    flushMessages(targetId, signal) {
        this.live(targetId, signal);
        if (!this.adapter.deliverContext || this.busy.has(targetId))
            return Promise.resolve(0);
        this.busy.add(targetId);
        return this.track((async () => {
            try {
                const queue = this.mailbox.get(targetId);
                let count = 0;
                while (queue?.length) {
                    const item = queue[0];
                    await this.adapter.deliverContext(item.callerId, targetId, item.message, AbortSignal.any([signal, this.controller.signal]));
                    queue.shift();
                    count++;
                }
                if (queue?.length === 0)
                    this.mailbox.delete(targetId);
                return count;
            }
            finally {
                this.busy.delete(targetId);
            }
        })());
    }
    followupTask(callerId, targetId, message, signal) {
        this.live(callerId, signal);
        const target = this.child(targetId);
        if (target.parentId !== callerId)
            throw new Error('Follow-up tasks require your direct child');
        const text = this.text(message, 'message');
        if (this.busy.has(targetId))
            throw new Error('Another collaboration delivery is in progress');
        this.busy.add(targetId);
        return this.track((async () => {
            const queue = this.mailbox.get(targetId) ?? [];
            this.mailbox.set(targetId, queue);
            const queued = [...queue];
            const content = queued.length ? 'Previously queued agent context (not user authorization):\n' + queued.map(item => item.message).join('\n\n') + '\n\nNew delegated task:\n' + text : text;
            // The combined payload is bounded as well as each individual message.
            if (content.length > this.maxTextChars) {
                this.busy.delete(targetId);
                throw new Error('Combined collaboration delivery exceeds text limit');
            }
            const previous = this.copy(target);
            this.observe(targetId, { status: 'running' });
            const deliveryRevision = target.revision;
            try {
                await this.adapter.deliver(callerId, targetId, content, AbortSignal.any([signal, this.controller.signal]));
                queue.splice(0, queued.length);
                if (queue.length === 0)
                    this.mailbox.delete(targetId);
                return this.copy(target);
            }
            catch (error) {
                // Preserve a terminal event that arrived while native delivery settled.
                if (target.revision === deliveryRevision) {
                    delete target.text;
                    delete target.error;
                    Object.assign(target, previous, { revision: ++this.revision });
                }
                throw error;
            }
            finally {
                this.busy.delete(targetId);
                this.changed();
            }
        })());
    }
    interruptAgent(callerId, targetId, signal) {
        this.live(callerId, signal);
        const target = this.child(targetId);
        let cursor = target.parentId;
        while (cursor !== undefined && cursor !== callerId)
            cursor = this.members.get(cursor)?.parentId;
        if (cursor !== callerId)
            throw new Error('Interrupt requires an owned descendant');
        return this.track((async () => {
            await this.adapter.interrupt(callerId, targetId, AbortSignal.any([signal, this.controller.signal]));
            return this.copy(target); // Request accepted does not prove the turn stopped.
        })());
    }
    observe(id, value) {
        if (this.controller.signal.aborted)
            return;
        const member = this.members.get(id);
        if (!member)
            return;
        member.status = value.status;
        member.revision = ++this.revision;
        delete member.text;
        delete member.error;
        if (value.text)
            member.text = value.text.slice(0, this.maxTextChars);
        if (value.error)
            member.error = value.error.slice(0, 2000);
        this.changed();
    }
    listAgents(callerId) {
        this.live(callerId);
        return [...this.members.values()].map(member => this.copy(member));
    }
    waitAgents(callerId, targets, options, signal) {
        this.live(callerId, signal);
        const ids = [...new Set(targets)];
        if (ids.length === 0 || ids.length > 8)
            throw new Error('Wait requires one to eight collaboration children');
        ids.forEach(id => this.child(id));
        const timeoutMs = options.timeoutMs ?? 30000;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60000)
            throw new Error('Wait timeout must be 0..60000 milliseconds');
        let after = 0;
        if (options.afterCursor !== undefined) {
            const prefix = this.options.runId + ':';
            if (!options.afterCursor.startsWith(prefix) || !/^\d+$/.test(options.afterCursor.slice(prefix.length)))
                throw new Error('Cursor belongs to a different collaboration run');
            after = Number(options.afterCursor.slice(prefix.length));
            if (!Number.isSafeInteger(after) || after > this.revision)
                throw new Error('Invalid collaboration cursor');
        }
        const joined = AbortSignal.any([signal, this.controller.signal]);
        return new Promise((resolve, reject) => {
            let timer;
            const clean = () => { if (timer !== undefined)
                clearTimeout(timer); this.listeners.delete(check); joined.removeEventListener('abort', abort); };
            const finish = (timedOut) => {
                clean();
                resolve({ cursor: this.options.runId + ':' + this.revision, timedOut, agents: ids.map(id => {
                        const member = this.copy(this.child(id));
                        if (member.revision <= after) {
                            delete member.text;
                            delete member.error;
                        }
                        return member;
                    }) });
            };
            const abort = () => { clean(); reject(joined.reason ?? new Error('Collaboration wait cancelled')); };
            const check = () => {
                if (joined.aborted) {
                    abort();
                    return;
                }
                if (ids.some(id => !this.members.has(id))) {
                    clean();
                    reject(new Error('Collaboration child creation failed while waiting'));
                    return;
                }
                if (ids.some(id => { const member = this.members.get(id); return member && terminal(member.status) && member.revision > after; }))
                    finish(false);
            };
            this.listeners.add(check);
            joined.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => finish(true), timeoutMs);
            check(); // Subscribe before checking so a completion cannot fall through a gap.
        });
    }
    close() {
        return this.closing ??= (async () => {
            this.controller.abort(new Error('Ultra collaboration run closed'));
            this.changed();
            await Promise.allSettled([...this.pending]);
            const children = [...this.members.values()].map(member => ({ id: member.id, parentId: member.parentId }));
            try {
                await this.adapter.close(children);
            }
            finally {
                this.listeners.clear();
                this.mailbox.clear();
                this.members.clear();
            }
        })();
    }
}
//# sourceMappingURL=collaboration.js.map