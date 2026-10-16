/** Local, append-only evidence authority. Host message bodies remain in the host log. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const CHUNK_CHARS = 2048;
const MAX_RECORD_CHARS = 8 * 1024 * 1024;
const sha = (text) => createHash('sha256').update(text).digest('hex');
const copy = (value) => structuredClone(value);
const canonical = (value) => JSON.stringify(value);
const nonempty = (value, name, max = 256) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))
        throw new Error(`Invalid ${name}`);
    return value;
};
function strings(value, name, maxItem = 2048) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 10000)
        throw new Error(`Invalid ${name}`);
    return [...new Set(value.map(x => nonempty(x, name, maxItem)))].sort();
}
function attachments(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 1000)
        throw new Error('Invalid attachments');
    return value.map(x => ({ type: nonempty(x?.type, 'attachment type'), ref: nonempty(x?.ref, 'attachment reference', 4096) }));
}
function integer(value, name, minimum = 0) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
        throw new Error(`Invalid ${name}`);
    return value;
}
function origin(value) {
    return { tool: nonempty(value.tool, 'origin tool'), callId: nonempty(value.callId, 'origin callId'), ...(value.resourceId === undefined ? {} : { resourceId: nonempty(value.resourceId, 'origin resourceId', 2048) }) };
}
function terms(text) {
    const found = new Set();
    for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}_-]+/gu)) {
        const word = match[0];
        if (/\p{Script=Han}/u.test(word)) {
            for (let i = 0; i < word.length; i++) {
                found.add(word[i]);
                if (i + 1 < word.length)
                    found.add(word.slice(i, i + 2));
            }
        }
        else
            found.add(word);
    }
    return [...found].sort();
}
const budget = (value) => Math.max(256, Math.min(65536, Number.isFinite(value) ? Math.floor(value) : 12000));
const boundedInt = (value, fallback, max) => value === undefined ? fallback : Math.min(max, integer(value, 'pagination'));
const sourceIdentity = (record) => `src_${sha(canonical([record.projectId, record.runId, record.sessionId, record.routeId, record.eventId, record.version]))}`;
const md = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replaceAll('\n', ' ');
export class EvidenceStore {
    directory;
    resolver;
    recordDirectory;
    records = new Map();
    tornWrites = 0;
    integrityFailure;
    verifiedFiles = new Map();
    sourceIndex = new Map();
    eventIndex = new Map();
    parsedRecords = 0;
    constructor(directory, resolver) {
        this.directory = directory;
        this.resolver = resolver;
        this.recordDirectory = path.join(path.resolve(directory), 'records');
        mkdirSync(this.recordDirectory, { recursive: true });
        this.reload();
    }
    reload() {
        try {
            this.loadRecords();
            this.integrityFailure = undefined;
        }
        catch (error) {
            this.integrityFailure = error instanceof Error ? error : new Error('Evidence integrity failure');
            throw this.integrityFailure;
        }
    }
    loadRecords() {
        const loaded = new Map();
        const verifiedFiles = new Map();
        let torn = 0;
        for (const name of readdirSync(this.recordDirectory).sort()) {
            if (name.includes('.tmp-')) {
                torn++;
                continue;
            }
            if (!name.endsWith('.json'))
                throw new Error(`Evidence integrity: unexpected record ${name}`);
            try {
                const fingerprint = this.fingerprint(path.join(this.recordDirectory, name));
                const cached = this.verifiedFiles.get(name);
                if (cached?.fingerprint === fingerprint) {
                    if (loaded.has(cached.record.id))
                        throw new Error('duplicate record identity');
                    loaded.set(cached.record.id, cached.record);
                    verifiedFiles.set(name, cached);
                    continue;
                }
                this.parsedRecords++;
                const encoded = readFileSync(path.join(this.recordDirectory, name), 'utf8');
                if (encoded.length > MAX_RECORD_CHARS)
                    throw new Error('record too large');
                const envelope = JSON.parse(encoded);
                const record = envelope.record;
                if (envelope.schema !== 1 || typeof envelope.sha256 !== 'string' || envelope.sha256 !== sha(canonical(record)))
                    throw new Error('checksum mismatch');
                nonempty(record.id, 'record id', 256);
                nonempty(record.projectId, 'projectId');
                if (name !== `${sha(record.id)}.json` || loaded.has(record.id))
                    throw new Error('record identity mismatch');
                if (record.type === 'source') {
                    if (record.origin)
                        origin(record.origin);
                    if (record.id !== sourceIdentity(record) || record.sourceId !== record.id || !Array.isArray(record.chunks))
                        throw new Error('invalid source identity');
                    if (record.coverage === 'host' && (typeof record.capturedText === 'string' || !record.host))
                        throw new Error('host body duplication');
                    if (record.capturedText !== undefined && sha(record.capturedText) !== record.sha256)
                        throw new Error('source body mismatch');
                    integer(record.length, 'source length');
                    integer(record.at, 'source timestamp');
                    for (const chunk of record.chunks) {
                        if (chunk.id !== `chunk_${sha(canonical([record.id, chunk.start, chunk.end]))}` || chunk.start < 0 || chunk.end < chunk.start || chunk.end > record.length || !Array.isArray(chunk.terms))
                            throw new Error('invalid chunk');
                    }
                }
                else if (record.type === 'semantic' || record.type === 'state') {
                    if (!Array.isArray(record.sourceIds) || record.sourceIds.length === 0)
                        throw new Error('missing provenance');
                }
                else
                    throw new Error('unknown record type');
                loaded.set(record.id, record);
                verifiedFiles.set(name, { fingerprint, record });
            }
            catch (error) {
                throw new Error(`Evidence integrity failure (${name}): ${error instanceof Error ? error.message : 'corrupt record'}`);
            }
        }
        const changed = loaded.size !== this.records.size || [...loaded].some(([id, record]) => this.records.get(id) !== record);
        const sourceIndex = changed ? new Map() : this.sourceIndex;
        const eventIndex = changed ? new Map() : this.eventIndex;
        if (changed)
            for (const record of loaded.values())
                if (record.type === 'source')
                    this.indexSource(record, sourceIndex, eventIndex);
        // Validate provenance only after all immutable files have been loaded.
        for (const record of loaded.values()) {
            if (record.type === 'source')
                continue;
            for (const id of record.sourceIds) {
                const source = sourceIndex.get(id);
                if (!source || source.projectId !== record.projectId)
                    throw new Error(`Evidence integrity failure: invalid source reference in ${record.id}`);
            }
            if (record.type === 'semantic')
                for (const id of [...record.supersedes, ...record.conflicts]) {
                    const target = loaded.get(id);
                    if (target?.type !== 'semantic' || target.projectId !== record.projectId)
                        throw new Error(`Evidence integrity failure: invalid semantic reference in ${record.id}`);
                }
        }
        this.records = loaded;
        this.verifiedFiles = verifiedFiles;
        this.sourceIndex = sourceIndex;
        this.eventIndex = eventIndex;
        this.tornWrites = torn;
    }
    fingerprint(filename) {
        const stats = lstatSync(filename, { bigint: true });
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > BigInt(MAX_RECORD_CHARS * 4))
            throw new Error('invalid or oversized canonical record file');
        return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':');
    }
    indexSource(record, sources = this.sourceIndex, events = this.eventIndex) {
        sources.set(record.id, record);
        for (const chunk of record.chunks)
            sources.set(chunk.id, record);
        const key = canonical([record.sessionId, record.eventId]);
        const ids = events.get(key) ?? [];
        if (!ids.includes(record.id))
            events.set(key, [...ids, record.id]);
    }
    mutate(operation) {
        const lock = path.join(path.resolve(this.directory), '.writer-lock');
        let fd;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                fd = openSync(lock, 'wx');
                writeFileSync(fd, canonical({ pid: process.pid }));
                fsyncSync(fd);
                break;
            }
            catch (error) {
                if (fd !== undefined) {
                    closeSync(fd);
                    fd = undefined;
                    // Only this attempt created this lock; do not strand it after an IO failure.
                    try {
                        unlinkSync(lock);
                    }
                    catch { /* Preserve the original write failure. */ }
                }
                if (error.code !== 'EEXIST')
                    throw error;
                // A crashed writer must not permanently prevent an idempotent restart.
                try {
                    const owner = JSON.parse(readFileSync(lock, 'utf8'));
                    integer(owner.pid, 'lock owner', 1);
                    try {
                        process.kill(owner.pid, 0);
                    }
                    catch (probe) {
                        if (probe.code === 'ESRCH') {
                            unlinkSync(lock);
                            continue;
                        }
                    }
                }
                catch { /* An unreadable/live lock cannot be safely stolen. */ }
            }
        }
        if (fd === undefined)
            throw new Error('Evidence writer busy; retry later (bounded to three attempts)');
        try {
            this.reload();
            return operation();
        }
        finally {
            closeSync(fd);
            unlinkSync(lock);
        }
    }
    commit(record) {
        const encoded = canonical({ schema: 1, record, sha256: sha(canonical(record)) });
        if (encoded.length > MAX_RECORD_CHARS)
            throw new Error('Evidence record exceeds local storage limit');
        const destination = path.join(this.recordDirectory, `${sha(record.id)}.json`);
        const temporary = `${destination}.tmp-${randomUUID()}`;
        let fd;
        try {
            fd = openSync(temporary, 'wx');
            writeFileSync(fd, encoded, 'utf8');
            fsyncSync(fd);
            closeSync(fd);
            fd = undefined;
            renameSync(temporary, destination);
            // POSIX directory fsync makes the rename durable; Windows rejects directory handles.
            let directoryFd;
            try {
                directoryFd = openSync(this.recordDirectory, 'r');
                fsyncSync(directoryFd);
            }
            catch (error) {
                if (!['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes(error.code ?? ''))
                    throw error;
            }
            finally {
                if (directoryFd !== undefined)
                    closeSync(directoryFd);
            }
            this.records.set(record.id, record);
            this.verifiedFiles.set(path.basename(destination), { fingerprint: this.fingerprint(destination), record });
            if (record.type === 'source')
                this.indexSource(record);
        }
        finally {
            if (fd !== undefined)
                closeSync(fd);
        }
    }
    capture(input) {
        const base = {
            projectId: nonempty(input.projectId, 'projectId'), runId: nonempty(input.runId, 'runId'), sessionId: nonempty(input.sessionId, 'sessionId'),
            routeId: nonempty(input.routeId, 'routeId'), eventId: nonempty(input.eventId, 'eventId'), version: integer(input.version ?? 1, 'version', 1),
        };
        const at = integer(input.at, 'at timestamp');
        const kind = nonempty(input.kind, 'kind');
        if (/^(reasoning|analysis|chain[-_ ]?of[-_ ]?thought|private[-_ ]?reasoning)$/iu.test(kind))
            throw new Error('Private reasoning is not evidence');
        if (typeof input.text !== 'string' || input.text.length > 2 * 1024 * 1024)
            throw new Error('Invalid evidence text or capture too large');
        const coverage = input.coverage ?? (input.host ? 'host' : 'captured');
        if (!['host', 'captured', 'truncated', 'reference-only'].includes(coverage))
            throw new Error('Invalid coverage');
        let host;
        if (input.host) {
            host = { sessionId: nonempty(input.host.sessionId, 'host sessionId'), seq: integer(input.host.seq, 'host seq') };
            if (host.sessionId !== base.sessionId)
                throw new Error('Host session must equal evidence session');
        }
        if (coverage === 'host' && !host)
            throw new Error('Host coverage requires a host reference');
        if (coverage === 'reference-only' && input.text)
            throw new Error('Reference-only evidence cannot claim text coverage');
        const id = sourceIdentity(base);
        const chunks = [];
        // A small overlap preserves lexical matches crossing chunk boundaries.
        for (let start = 0; start < input.text.length || (start === 0 && input.text.length === 0); start += CHUNK_CHARS - 128) {
            const end = Math.min(start + CHUNK_CHARS, input.text.length);
            const text = input.text.slice(start, end);
            chunks.push({ id: `chunk_${sha(canonical([id, start, end]))}`, start, end, sha256: sha(text), terms: terms(text) });
            if (end === input.text.length)
                break;
        }
        const record = {
            type: 'source', id, sourceId: id, ...base, ...(input.seq === undefined ? {} : { seq: integer(input.seq, 'seq') }), at, kind,
            sha256: sha(input.text), length: input.text.length, ...(host ? { host } : {}), coverage,
            attachments: attachments(input.attachments), files: strings(input.files, 'files'), topics: strings(input.topics, 'topics'), chunks,
            ...(input.origin ? { origin: origin(input.origin) } : {}),
            ...(coverage === 'host' || coverage === 'reference-only' ? {} : { capturedText: input.text }),
        };
        return this.mutate(() => {
            const previous = this.records.get(id);
            if (previous) {
                let equivalent = canonical(previous) === canonical(record);
                if (!equivalent && previous.type === 'source' && previous.promotion && !record.promotion) {
                    const { promotion, host: _host, ...prior } = previous;
                    const original = { ...prior, coverage: promotion.previousCoverage, capturedText: input.text };
                    equivalent = canonical(original) === canonical(record);
                }
                if (!equivalent)
                    throw new Error(`Evidence source conflict: ${id}; supply a new source version`);
                return this.metadata(previous);
            }
            else
                this.commit(record);
            return this.metadata(record);
        });
    }
    /** Release fallback bytes only after an exact host-log body has become durable. */
    async promoteToHost(sourceId, ref) {
        const source = this.records.get(sourceId);
        if (source?.type !== 'source')
            return false;
        const host = { sessionId: nonempty(ref.sessionId, 'host sessionId'), seq: integer(ref.seq, 'host seq') };
        if (host.sessionId !== source.sessionId)
            throw new Error('Host session must equal evidence session');
        if (source.coverage === 'reference-only' || !this.resolver)
            return false;
        let resolved;
        try {
            resolved = await this.resolver(host);
        }
        catch {
            return false;
        }
        if (!resolved || typeof resolved.text !== 'string' || resolved.text.length !== source.length || sha(resolved.text) !== source.sha256)
            return false;
        return this.mutate(() => {
            const latest = this.records.get(sourceId);
            if (latest?.type !== 'source' || latest.sha256 !== source.sha256)
                return false;
            if (latest.coverage === 'host')
                return latest.host?.sessionId === host.sessionId && latest.host.seq === host.seq;
            if (latest.coverage !== 'captured' && latest.coverage !== 'truncated')
                return false;
            const { capturedText: _text, ...metadata } = latest;
            this.commit({ ...metadata, coverage: 'host', host, promotion: { at: Date.now(), previousCoverage: latest.coverage, verifiedSha256: latest.sha256 } });
            return true;
        });
    }
    metadata(record) {
        const { type: _type, capturedText: _text, ...metadata } = record;
        return copy(metadata);
    }
    grant(access) {
        if (this.integrityFailure)
            throw this.integrityFailure;
        nonempty(access.projectId, 'access projectId');
        return new Set(strings(access.sessionIds, 'access sessionIds', 256));
    }
    allowed(access, source, sessions = this.grant(access)) { return source.projectId === access.projectId && sessions.has(source.sessionId); }
    findSource(id) { return this.sourceIndex.get(id); }
    validSources(projectId, ids, access) {
        const values = strings(ids, 'sourceIds', 256);
        if (!values.length)
            throw new Error('At least one evidence source is required');
        const sessions = access ? this.grant(access) : undefined;
        for (const id of values) {
            const source = this.findSource(id);
            if (!source || source.projectId !== projectId || (access && !this.allowed(access, source, sessions)))
                throw new Error('Invalid or inaccessible evidence source reference');
        }
        return values;
    }
    sourcesAllowed(access, ids) {
        const sessions = this.grant(access);
        return ids.length > 0 && ids.every(id => { const source = this.findSource(id); return !!source && this.allowed(access, source, sessions); });
    }
    *recordsFor(access) {
        const sessions = this.grant(access);
        for (const record of this.records.values())
            if (record.type === 'source' && this.allowed(access, record, sessions))
                yield this.metadata(record);
    }
    /** Metadata identifiers only; this helper conveys no content access. */
    idsFor(sessionId, eventId) {
        if (this.integrityFailure)
            throw this.integrityFailure;
        return [...(this.eventIndex.get(canonical([sessionId, eventId])) ?? [])];
    }
    async resolve(source) {
        if (source.coverage === 'reference-only')
            return { text: '', status: 'reference-only' };
        if (source.coverage !== 'host')
            return { text: source.capturedText ?? '', status: source.coverage };
        let resolved;
        try {
            resolved = await this.resolver?.(source.host);
        }
        catch {
            return { text: '', status: 'unavailable' };
        }
        if (!resolved || typeof resolved.text !== 'string')
            return { text: '', status: 'unavailable' };
        if (resolved.text.length !== source.length || sha(resolved.text) !== source.sha256)
            return { text: '', status: 'hash-mismatch' };
        return { text: resolved.text, status: 'host' };
    }
    async search(access, query = {}) {
        const sessions = this.grant(access);
        const maxChars = budget(query.maxChars);
        const offset = boundedInt(query.offset, 0, Number.MAX_SAFE_INTEGER);
        const limit = boundedInt(query.limit, 10, 100);
        const needle = query.query?.trim().toLowerCase() ?? '';
        if (needle.length > 2048)
            throw new Error('Search query too large');
        const keywords = terms(needle);
        if (query.kind !== undefined && (typeof query.kind !== 'string' || !query.kind || query.kind.length > 128))
            throw new Error('Search kind must be a nonempty source or semantic class');
        const matchesKind = (kind) => query.kind === undefined || kind === query.kind || kind.startsWith(query.kind + ':');
        const visibleSemantic = this.semantics(access);
        const labels = new Map();
        for (const semantic of visibleSemantic)
            for (const id of semantic.sourceIds) {
                const source = this.findSource(id);
                const associated = labels.get(source.id) ?? { topics: new Set(), files: new Set() };
                semantic.topics.forEach(topic => associated.topics.add(topic));
                semantic.files.forEach(file => associated.files.add(file));
                labels.set(source.id, associated);
            }
        const candidates = [];
        for (const record of this.records.values()) {
            if (record.type !== 'source' || !this.allowed(access, record, sessions))
                continue;
            if (!matchesKind(record.kind))
                continue;
            if (query.routeId !== undefined && record.routeId !== query.routeId)
                continue;
            if (query.file !== undefined && ![...record.files, ...(labels.get(record.id)?.files ?? [])].some(file => file.toLowerCase().includes(query.file.toLowerCase())))
                continue;
            if (query.topic !== undefined && !record.topics.includes(query.topic) && !labels.get(record.id)?.topics.has(query.topic))
                continue;
            if (query.after !== undefined && record.at < query.after)
                continue;
            if (query.before !== undefined && record.at > query.before)
                continue;
            // Public source identity applies to every chunk, only after its complete ACL passes.
            // Derive it at read time so existing records need no index/schema migration.
            const identityTerms = terms([record.origin?.resourceId, record.origin?.tool].filter(Boolean).join(' '));
            const bodyKeywords = keywords.filter(word => !identityTerms.some(term => term.includes(word)));
            for (const chunk of record.chunks) {
                if (query.id && ![record.id, record.eventId, chunk.id].includes(query.id))
                    continue;
                if (needle && !bodyKeywords.every(word => chunk.terms.some(term => term.includes(word))))
                    continue;
                candidates.push({ source: record, chunk, bodyKeywords, at: record.at, tie: chunk.id });
            }
        }
        for (const semantic of visibleSemantic) {
            if (!matchesKind(semantic.kind))
                continue;
            if (query.id !== undefined && query.id !== semantic.id && !semantic.sourceIds.includes(query.id))
                continue;
            const provenance = semantic.sourceIds.map(id => this.findSource(id));
            if (query.routeId !== undefined && !provenance.some(source => source.routeId === query.routeId))
                continue;
            if (query.topic !== undefined && !semantic.topics.includes(query.topic))
                continue;
            if (query.file !== undefined && !semantic.files.some(file => file.toLowerCase().includes(query.file.toLowerCase())))
                continue;
            if (query.after !== undefined && semantic.at < query.after)
                continue;
            if (query.before !== undefined && semantic.at > query.before)
                continue;
            const words = terms(semantic.text);
            if (needle && !keywords.every(word => words.some(term => term.includes(word))))
                continue;
            candidates.push({ source: provenance[0], semantic, at: semantic.at, tie: semantic.id });
        }
        candidates.sort((a, b) => b.at - a.at || (b.source.seq ?? 0) - (a.source.seq ?? 0) || (b.chunk?.start ?? 0) - (a.chunk?.start ?? 0) || a.tie.localeCompare(b.tie));
        const result = { items: [], total: candidates.length };
        const cache = new Map();
        const acceptedIndices = [];
        let index = offset;
        for (; index < candidates.length && result.items.length < limit; index++) {
            const { source, chunk, semantic, bodyKeywords } = candidates[index];
            let resolved = semantic ? { text: semantic.text, status: 'captured' } : cache.get(source.id);
            if (!resolved) {
                resolved = await this.resolve(source);
                cache.set(source.id, resolved);
            }
            const text = semantic ? semantic.text : resolved.text.slice(chunk.start, chunk.end);
            const lowerText = text.toLowerCase(), excerptKeywords = bodyKeywords ?? keywords;
            // A metadata hit locates the source, not an excerpt at its header. When the
            // full body phrase is absent, use actual body word positions instead.
            const phrase = needle && excerptKeywords.length === keywords.length ? lowerText.indexOf(needle) : -1;
            const matched = phrase >= 0 ? phrase : excerptKeywords.reduce((first, word) => {
                const position = lowerText.indexOf(word);
                return position < 0 ? first : first < 0 ? position : Math.min(first, position);
            }, -1);
            const start = matched < 0 ? 0 : Math.max(0, matched - 120);
            const item = {
                id: semantic?.id ?? chunk.id, sourceId: source.id, sessionId: source.sessionId, routeId: source.routeId, at: semantic?.at ?? source.at, kind: semantic?.kind ?? source.kind,
                excerpt: text.slice(start, start + 600), status: resolved.status, start: semantic ? 0 : chunk.start, end: semantic ? semantic.text.length : chunk.end, attachments: semantic ? [] : copy(source.attachments),
                ...(semantic ? { semanticStatus: semantic.status, sourceIds: copy(semantic.sourceIds), topics: copy(semantic.topics), files: copy(semantic.files) } : {}),
            };
            result.nextOffset = index + 1 < candidates.length ? index + 1 : undefined;
            result.items.push(item);
            acceptedIndices.push(index);
            while (canonical(result).length > maxChars && item.excerpt.length)
                item.excerpt = item.excerpt.slice(0, Math.max(0, item.excerpt.length - (canonical(result).length - maxChars)));
            if (canonical(result).length > maxChars) {
                result.items.pop();
                acceptedIndices.pop();
                result.omitted = (result.omitted ?? 0) + 1;
                if (result.items.length) {
                    result.nextOffset = index;
                    break;
                }
            }
        }
        if (index < candidates.length)
            result.nextOffset ??= index;
        else
            delete result.nextOffset;
        // Counters and cursor widths can change after the last item's initial fit.
        // Budget the final envelope, including metadata, rather than only excerpts.
        while (canonical(result).length > maxChars) {
            const excerpt = result.items.findLast(item => item.excerpt.length > 0);
            if (excerpt) {
                excerpt.excerpt = excerpt.excerpt.slice(0, Math.max(0, excerpt.excerpt.length - (canonical(result).length - maxChars)));
                continue;
            }
            const dropped = acceptedIndices.pop();
            if (dropped === undefined)
                break; // The fixed empty envelope fits the minimum budget.
            result.items.pop();
            result.omitted = (result.omitted ?? 0) + 1;
            if (result.items.length)
                result.nextOffset = Math.min(result.nextOffset ?? candidates.length, dropped);
            else if (dropped + 1 < candidates.length)
                result.nextOffset = dropped + 1;
            else
                delete result.nextOffset;
        }
        return result;
    }
    async get(access, id, options = {}) {
        this.grant(access);
        const semantic = this.records.get(id)?.type === 'semantic' ? this.semantics(access).find(record => record.id === id) : undefined;
        const stored = this.records.get(id);
        let state;
        if (stored?.type === 'state' && stored.projectId === access.projectId && this.sourcesAllowed(access, stored.sourceIds)) {
            const { type: _type, ...view } = stored;
            state = view;
        }
        const structured = semantic ?? state;
        if (structured) {
            if (options.quote !== undefined)
                throw new Error('Verified quote requires an original raw source, not a semantic conclusion or state');
            const body = canonical(structured);
            const maxChars = budget(options.maxChars);
            const offset = Math.min(body.length, boundedInt(options.offset, 0, Number.MAX_SAFE_INTEGER));
            const result = { text: '', sourceIds: copy(structured.sourceIds), status: 'captured', ...(semantic ? { semanticStatus: semantic.status } : {}), offset };
            // The paginated JSON text retains full provenance even when metadata needs a prefix.
            while (canonical(result).length + 40 > maxChars && result.sourceIds.length > 1) {
                result.sourceIds.pop();
                result.sourceIdsTruncated = true;
            }
            result.text = body.slice(offset, Math.min(body.length, offset + Math.max(0, maxChars - canonical(result).length - 40)));
            while (canonical(result).length + 32 > maxChars && result.text.length)
                result.text = result.text.slice(0, Math.max(0, result.text.length - (canonical(result).length + 32 - maxChars)));
            if (offset + result.text.length < body.length)
                result.nextOffset = offset + result.text.length;
            return result;
        }
        const source = this.findSource(id);
        if (!source || !this.allowed(access, source))
            throw new Error('Evidence not found or access denied');
        const resolved = await this.resolve(source);
        const chunkIndex = source.chunks.findIndex(chunk => chunk.id === id);
        const neighbors = boundedInt(options.neighbors, 0, 4);
        const first = chunkIndex < 0 ? 0 : source.chunks[Math.max(0, chunkIndex - neighbors)].start;
        const last = chunkIndex < 0 ? source.length : source.chunks[Math.min(source.chunks.length - 1, chunkIndex + neighbors)].end;
        const relativeOffset = boundedInt(options.offset, 0, Number.MAX_SAFE_INTEGER);
        const offset = Math.min(last, first + relativeOffset);
        const maxChars = budget(options.maxChars);
        if (options.quote !== undefined) {
            const quote = nonempty(options.quote, 'quote', 65536);
            if (!['host', 'captured', 'truncated'].includes(resolved.status))
                throw new Error('Quote source is unavailable or failed integrity verification');
            const start = resolved.text.indexOf(quote, offset);
            if (start < 0 || start + quote.length > last)
                throw new Error('Quote is not an exact substring of the requested original source range');
            const result = { text: quote, sourceIds: [source.id], status: resolved.status, offset: start,
                citation: { sourceId: source.id, quote, start, end: start + quote.length, sha256: source.sha256, ...(source.origin ? { origin: copy(source.origin) } : {}) } };
            if (canonical(result).length > maxChars)
                throw new Error('Verified quote exceeds return budget; request a shorter exact quote or a larger allowed maxChars');
            return result;
        }
        const result = { text: resolved.text.slice(offset, Math.min(last, offset + maxChars)), sourceIds: [source.id], status: resolved.status, offset };
        if (source.attachments.length)
            result.attachments = copy(source.attachments);
        while (canonical(result).length > maxChars && result.text.length)
            result.text = result.text.slice(0, Math.max(0, result.text.length - (canonical(result).length - maxChars) - 32));
        if (result.text && offset + result.text.length < last)
            result.nextOffset = relativeOffset + result.text.length;
        if (canonical(result).length > maxChars)
            delete result.attachments;
        return result;
    }
    addSemantic(input) {
        return this.mutate(() => {
            const projectId = nonempty(input.projectId, 'projectId');
            if (!['requirement', 'fact', 'decision', 'failure', 'question', 'superseded'].includes(input.kind))
                throw new Error('Invalid semantic kind');
            const status = input.status ?? (input.kind === 'question' ? 'unresolved' : input.kind === 'superseded' ? 'superseded' : 'current');
            if (!['current', 'superseded', 'unresolved'].includes(status))
                throw new Error('Invalid semantic status');
            const payload = {
                projectId, kind: input.kind, text: nonempty(input.text, 'semantic text', 100000), sourceIds: this.validSources(projectId, input.sourceIds),
                topics: strings(input.topics, 'topics'), files: strings(input.files, 'files'), status,
                supersedes: strings(input.supersedes, 'supersedes', 256), conflicts: strings(input.conflicts, 'conflicts', 256),
            };
            for (const id of [...payload.supersedes, ...payload.conflicts]) {
                const target = this.records.get(id);
                if (target?.type !== 'semantic' || target.projectId !== projectId)
                    throw new Error('Invalid semantic reference');
                // A narrow-session update must never silently supersede a broader fact.
                const sessions = new Set(payload.sourceIds.map(source => this.findSource(source).sessionId));
                if (!target.sourceIds.every(source => sessions.has(this.findSource(source).sessionId)))
                    throw new Error('Semantic reference requires all source sessions');
            }
            const id = input.id === undefined ? `sem_${sha(canonical(payload))}` : nonempty(input.id, 'semantic id');
            const previous = this.records.get(id);
            if (previous) {
                if (previous.type !== 'semantic')
                    throw new Error('Semantic id conflict');
                const { type: _type, id: _id, at: _at, ...prior } = previous;
                if (canonical(prior) !== canonical(payload))
                    throw new Error('Semantic id conflict');
                return this.semanticView(previous, false);
            }
            const record = { type: 'semantic', id, ...payload, at: Date.now() };
            this.commit(record);
            return this.semanticView(record, false);
        });
    }
    semanticView(record, superseded) {
        const { type: _type, ...result } = record;
        return copy({ ...result, ...(superseded ? { status: 'superseded' } : {}) });
    }
    semantics(access, filter = {}) {
        this.grant(access);
        const visible = [...this.records.values()].filter((record) => record.type === 'semantic' && record.projectId === access.projectId && this.sourcesAllowed(access, record.sourceIds));
        const superseded = new Set(visible.flatMap(record => record.supersedes));
        return visible.map(record => this.semanticView(record, superseded.has(record.id)))
            .filter(record => (!filter.status || record.status === filter.status) && (!filter.kind || record.kind === filter.kind) && (!filter.topic || record.topics.includes(filter.topic)))
            .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    }
    updateProjectState(access, input) {
        return this.mutate(() => {
            const sourceIds = this.validSources(access.projectId, input.sourceIds, access);
            const operations = input.operations?.map(operation => {
                if (!['planned', 'executed', 'verified'].includes(operation.status))
                    throw new Error('Invalid operation status');
                const ids = operation.status === 'planned' && !operation.sourceIds.length ? [] : this.validSources(access.projectId, operation.sourceIds, access);
                return { id: nonempty(operation.id, 'operation id'), description: nonempty(operation.description, 'operation description', 10000), status: operation.status, sourceIds: ids };
            });
            // Include operation provenance in the revision's visibility boundary.
            const allSources = [...new Set([...sourceIds, ...(operations?.flatMap(operation => operation.sourceIds) ?? [])])].sort();
            const revision = Math.max(0, ...[...this.records.values()].filter((x) => x.type === 'state' && x.projectId === access.projectId).map(x => x.revision)) + 1;
            const record = {
                type: 'state', id: `state_${sha(canonical([access.projectId, revision]))}`, projectId: nonempty(access.projectId, 'projectId'), revision, at: Date.now(),
                goal: nonempty(input.goal, 'goal', 100000), sourceIds: allSources,
                ...(input.acceptance === undefined ? {} : { acceptance: strings(input.acceptance, 'acceptance', 10000) }),
                ...(input.constraints === undefined ? {} : { constraints: strings(input.constraints, 'constraints', 10000) }),
                ...(input.progress === undefined ? {} : { progress: strings(input.progress, 'progress', 10000) }),
                ...(input.next === undefined ? {} : { next: strings(input.next, 'next', 10000) }),
                ...(input.blockers === undefined ? {} : { blockers: strings(input.blockers, 'blockers', 10000) }),
                ...(operations === undefined ? {} : { operations }),
            };
            this.commit(record);
            const { type: _type, ...result } = record;
            return copy(result);
        });
    }
    projectState(access) {
        this.grant(access);
        const latest = [...this.records.values()].filter((record) => record.type === 'state' && record.projectId === access.projectId && this.sourcesAllowed(access, record.sourceIds)).sort((a, b) => b.revision - a.revision)[0];
        if (!latest)
            return undefined;
        const { type: _type, ...result } = latest;
        return copy(result);
    }
    stats(access) {
        const sources = [...this.recordsFor(access)];
        const semantic = this.semantics(access);
        const coverage = { host: 0, captured: 0, truncated: 0, 'reference-only': 0 };
        for (const source of sources)
            coverage[source.coverage]++;
        return {
            raw: { sources: sources.length, chunks: sources.reduce((sum, source) => sum + source.chunks.length, 0), characters: sources.reduce((sum, source) => sum + source.length, 0), attachments: sources.reduce((sum, source) => sum + source.attachments.length, 0), coverage },
            semantic: { total: semantic.length, current: semantic.filter(x => x.status === 'current').length, superseded: semantic.filter(x => x.status === 'superseded').length, unresolved: semantic.filter(x => x.status === 'unresolved').length },
            integrity: { tornWrites: this.tornWrites, status: this.tornWrites ? 'incomplete-temporary-write' : 'ok', parsedRecords: this.parsedRecords, verifiedFiles: this.verifiedFiles.size },
        };
    }
    /** Derived presentation only. No Markdown input is trusted as canonical evidence. */
    exportMarkdown(access) {
        const sources = [...this.recordsFor(access)];
        const semantic = this.semantics(access);
        const state = this.projectState(access);
        const lines = [`# Evidence index: ${md(access.projectId)}`, '', 'Derived from immutable local evidence records. Host text remains in the host log.', ''];
        if (state) {
            lines.push(`## Project state (revision ${state.revision})`, '', md(state.goal), '');
            for (const key of ['acceptance', 'constraints', 'progress', 'next', 'blockers'])
                if (state[key]?.length)
                    lines.push(`### ${key}`, '', ...state[key].map(text => `- ${md(text)}`), '');
            for (const operation of state.operations ?? [])
                lines.push(`- ${operation.status}: ${md(operation.description)} [${operation.sourceIds.join(', ')}]`);
            lines.push('', `Sources: ${state.sourceIds.join(', ')}`, '');
        }
        lines.push('## Semantic records', '');
        for (const record of semantic)
            lines.push(`- **${record.kind} / ${record.status}** ${md(record.text)} (${record.id}; sources: ${record.sourceIds.join(', ')})`);
        lines.push('', '## Raw sources and coverage', '', '| Source | Session | Route | Timestamp | Coverage | SHA-256 |', '| --- | --- | --- | --- | --- | --- |');
        for (const source of sources)
            lines.push(`| ${source.id} | ${md(source.sessionId)} | ${md(source.routeId)} | ${source.at} | ${source.coverage} | ${source.sha256} |`);
        const files = [{ path: 'index.md', content: `${lines.join('\n')}\n` }];
        const topics = new Set([...sources.flatMap(x => x.topics), ...semantic.flatMap(x => x.topics)]);
        for (const topic of [...topics].sort()) {
            const slug = topic.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'topic';
            const topicLines = [`# ${md(topic)}`, '', ...semantic.filter(x => x.topics.includes(topic)).map(x => `- ${x.kind} / ${x.status}: ${md(x.text)} [${x.sourceIds.join(', ')}]`), '', '## Sources', '', ...sources.filter(x => x.topics.includes(topic)).map(x => `- ${x.id}: ${x.coverage}; SHA-256 ${x.sha256}`)];
            files.push({ path: `topics/${slug}-${sha(topic).slice(0, 8)}.md`, content: `${topicLines.join('\n')}\n` });
        }
        return { files };
    }
}
//# sourceMappingURL=evidence.js.map