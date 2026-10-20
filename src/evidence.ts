/** Local, append-only evidence authority. Host message bodies remain in the host log. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface EvidenceAccess { projectId: string; sessionIds: readonly string[] }
export interface EvidenceAttachment { type: string; ref: string }
export interface EvidenceHostRef { sessionId: string; seq: number }
export interface EvidenceOrigin { tool: string; callId: string; resourceId?: string }
export interface EvidenceInput {
  projectId: string; runId: string; sessionId: string; routeId: string; eventId: string
  seq?: number; at: number; kind: string; text: string; version?: number
  host?: EvidenceHostRef; coverage?: 'host' | 'captured' | 'truncated' | 'reference-only'
  attachments?: EvidenceAttachment[]; files?: string[]; topics?: string[]; origin?: EvidenceOrigin
  /** A host-only local retrieval wrapper locator, never a new searchable or publishable fact. */
  contextReceipt?: true
}
export interface EvidenceChunk { id: string; start: number; end: number; sha256: string; terms: string[] }
export interface EvidenceRecord {
  id: string; sourceId: string; projectId: string; runId: string; sessionId: string
  routeId: string; eventId: string; seq?: number; at: number; kind: string; version: number
  sha256: string; length: number; host?: EvidenceHostRef; coverage: NonNullable<EvidenceInput['coverage']>
  attachments: EvidenceAttachment[]; files: string[]; topics: string[]; chunks: EvidenceChunk[]
  origin?: EvidenceOrigin
  contextReceipt?: true
  promotion?: { at: number; previousCoverage: 'captured' | 'truncated'; verifiedSha256: string }
}
interface SourceRecord extends EvidenceRecord { type: 'source'; capturedText?: string }
export type SemanticKind = 'requirement' | 'fact' | 'decision' | 'failure' | 'question' | 'superseded'
export type SemanticStatus = 'current' | 'superseded' | 'unresolved'
export interface SemanticInput {
  id?: string; projectId: string; kind: SemanticKind; text: string; sourceIds: string[]
  topics?: string[]; files?: string[]; status?: SemanticStatus; supersedes?: string[]; conflicts?: string[]
}
export interface SemanticRecord {
  id: string; projectId: string; kind: SemanticKind; text: string; sourceIds: string[]
  topics: string[]; files: string[]; status: SemanticStatus; supersedes: string[]; conflicts: string[]; at: number
}
interface StoredSemantic extends SemanticRecord { type: 'semantic' }
export interface ProjectOperation { id: string; description: string; status: 'planned' | 'executed' | 'verified'; sourceIds: string[] }
export interface ProjectStateInput {
  goal: string; acceptance?: string[]; constraints?: string[]; progress?: string[]
  next?: string[]; blockers?: string[]; operations?: ProjectOperation[]; sourceIds: string[]
}
export interface ProjectState extends ProjectStateInput { id: string; projectId: string; revision: number; at: number }
interface StoredState extends ProjectState { type: 'state' }
type StoredRecord = SourceRecord | StoredSemantic | StoredState
interface VerifiedFile { fingerprint: string; record: StoredRecord }
type Resolver = (ref: EvidenceHostRef) => Promise<{ text: string; attachments?: EvidenceAttachment[]; callId?: string } | undefined>
export interface EvidenceQuery { query?: string; id?: string; kind?: string; file?: string; topic?: string; routeId?: string; after?: number; before?: number; offset?: number; limit?: number; maxChars?: number }
export type EvidenceStatus = 'host' | 'captured' | 'truncated' | 'reference-only' | 'unavailable' | 'hash-mismatch' | 'identity-mismatch'
export interface EvidenceSearchItem {
  id: string; sourceId: string; sessionId: string; routeId: string; at: number; kind: string
  excerpt: string; status: EvidenceStatus; start: number; end: number; attachments: EvidenceAttachment[]
  sourceIds?: string[]; topics?: string[]; files?: string[]; semanticStatus?: SemanticStatus
  match?: 'source-identity'; sourceChars?: number; sourceChunks?: number
}
export interface EvidenceSearchResult { items: EvidenceSearchItem[]; nextOffset?: number; total: number; omitted?: number; retrievalHint?: string }
export interface EvidenceGetResult { text: string; sourceIds: string[]; status: EvidenceStatus; offset: number; nextOffset?: number; attachments?: EvidenceAttachment[]; semanticStatus?: SemanticStatus; sourceIdsTruncated?: boolean; contextReceipt?: true; citation?: { sourceId: string; quote: string; start: number; end: number; sha256: string; origin?: EvidenceOrigin } }

const CHUNK_CHARS = 2048
const MAX_RECORD_CHARS = 8 * 1024 * 1024
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const copy = <T>(value: T): T => structuredClone(value)
const canonical = (value: unknown) => JSON.stringify(value)
const nonempty = (value: unknown, name: string, max = 256): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error(`Invalid ${name}`)
  return value
}
function strings(value: unknown, name: string, maxItem = 2048): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 10000) throw new Error(`Invalid ${name}`)
  return [...new Set(value.map(x => nonempty(x, name, maxItem)))].sort()
}
function attachments(value: unknown): EvidenceAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid attachments')
  return value.map(x => ({ type: nonempty(x?.type, 'attachment type'), ref: nonempty(x?.ref, 'attachment reference', 4096) }))
}
function integer(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`)
  return value
}
function origin(value: EvidenceOrigin): EvidenceOrigin {
  return { tool: nonempty(value.tool, 'origin tool'), callId: nonempty(value.callId, 'origin callId'), ...(value.resourceId === undefined ? {} : { resourceId: nonempty(value.resourceId, 'origin resourceId', 2048) }) }
}
function validateContextReceipt(value: Pick<EvidenceRecord, 'contextReceipt' | 'coverage' | 'host' | 'seq' | 'eventId' | 'kind' | 'origin' | 'attachments' | 'files' | 'topics'>): void {
  if (value.contextReceipt === undefined) return
  if (value.contextReceipt !== true || value.coverage !== 'host' || !value.host || value.seq !== value.host.seq
    || !value.origin || !['ultra_memory_search', 'ultra_memory_get'].includes(value.origin.tool)
    || value.kind !== 'tool/result:' + value.origin.tool || value.eventId !== 'tool:' + value.origin.callId
    || value.attachments.length || value.files.length || value.topics.length) throw new Error('Invalid local host context receipt')
}
function terms(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}_-]+/gu)) {
    const word = match[0]
    if (/\p{Script=Han}/u.test(word)) {
      for (let i = 0; i < word.length; i++) { found.add(word[i]); if (i + 1 < word.length) found.add(word.slice(i, i + 2)) }
    } else found.add(word)
  }
  return [...found].sort()
}
const budget = (value?: number) => Math.max(256, Math.min(65536, Number.isFinite(value) ? Math.floor(value!) : 12000))
const boundedInt = (value: number | undefined, fallback: number, max: number) => value === undefined ? fallback : Math.min(max, integer(value, 'pagination'))
const sourceIdentity = (record: Pick<EvidenceRecord, 'projectId' | 'runId' | 'sessionId' | 'routeId' | 'eventId' | 'version'>) =>
  `src_${sha(canonical([record.projectId, record.runId, record.sessionId, record.routeId, record.eventId, record.version]))}`
const md = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replaceAll('\n', ' ')

export class EvidenceStore {
  private readonly recordDirectory: string
  private records = new Map<string, StoredRecord>()
  private tornWrites = 0
  private integrityFailure?: Error
  private verifiedFiles = new Map<string, VerifiedFile>()
  private sourceIndex = new Map<string, SourceRecord>()
  private eventIndex = new Map<string, string[]>()
  private parsedRecords = 0
  constructor(readonly directory: string, private readonly resolver?: Resolver) {
    this.recordDirectory = path.join(path.resolve(directory), 'records')
    mkdirSync(this.recordDirectory, { recursive: true })
    this.reload()
  }

  private reload(): void {
    try { this.loadRecords(); this.integrityFailure = undefined }
    catch (error) {
      this.integrityFailure = error instanceof Error ? error : new Error('Evidence integrity failure')
      throw this.integrityFailure
    }
  }
  private loadRecords(): void {
    const loaded = new Map<string, StoredRecord>()
    const verifiedFiles = new Map<string, VerifiedFile>()
    let torn = 0
    for (const name of readdirSync(this.recordDirectory).sort()) {
      if (name.includes('.tmp-')) { torn++; continue }
      if (!name.endsWith('.json')) throw new Error(`Evidence integrity: unexpected record ${name}`)
      try {
        const fingerprint = this.fingerprint(path.join(this.recordDirectory, name))
        const cached = this.verifiedFiles.get(name)
        if (cached?.fingerprint === fingerprint) {
          if (loaded.has(cached.record.id)) throw new Error('duplicate record identity')
          loaded.set(cached.record.id, cached.record)
          verifiedFiles.set(name, cached)
          continue
        }
        this.parsedRecords++
        const encoded = readFileSync(path.join(this.recordDirectory, name), 'utf8')
        if (encoded.length > MAX_RECORD_CHARS) throw new Error('record too large')
        const envelope = JSON.parse(encoded)
        const record = envelope.record as StoredRecord
        if (envelope.schema !== 1 || typeof envelope.sha256 !== 'string' || envelope.sha256 !== sha(canonical(record))) throw new Error('checksum mismatch')
        nonempty(record.id, 'record id', 256)
        nonempty(record.projectId, 'projectId')
        if (name !== `${sha(record.id)}.json` || loaded.has(record.id)) throw new Error('record identity mismatch')
        if (record.type === 'source') {
          if (record.origin) origin(record.origin)
          if (record.id !== sourceIdentity(record) || record.sourceId !== record.id || !Array.isArray(record.chunks)) throw new Error('invalid source identity')
          if (record.coverage === 'host' && (typeof record.capturedText === 'string' || !record.host)) throw new Error('host body duplication')
          validateContextReceipt(record)
          if (record.contextReceipt && (record.chunks.length || !record.length)) throw new Error('Context receipt must contain only a host locator and integrity metadata')
          if (record.capturedText !== undefined && sha(record.capturedText) !== record.sha256) throw new Error('source body mismatch')
          integer(record.length, 'source length')
          integer(record.at, 'source timestamp')
          for (const chunk of record.chunks) {
            if (chunk.id !== `chunk_${sha(canonical([record.id, chunk.start, chunk.end]))}` || chunk.start < 0 || chunk.end < chunk.start || chunk.end > record.length || !Array.isArray(chunk.terms)) throw new Error('invalid chunk')
          }
        } else if (record.type === 'semantic' || record.type === 'state') {
          if (!Array.isArray(record.sourceIds) || record.sourceIds.length === 0) throw new Error('missing provenance')
        } else throw new Error('unknown record type')
        loaded.set(record.id, record)
        verifiedFiles.set(name, { fingerprint, record })
      } catch (error) { throw new Error(`Evidence integrity failure (${name}): ${error instanceof Error ? error.message : 'corrupt record'}`) }
    }
    const changed = loaded.size !== this.records.size || [...loaded].some(([id, record]) => this.records.get(id) !== record)
    const sourceIndex = changed ? new Map<string, SourceRecord>() : this.sourceIndex
    const eventIndex = changed ? new Map<string, string[]>() : this.eventIndex
    if (changed) for (const record of loaded.values()) if (record.type === 'source') this.indexSource(record, sourceIndex, eventIndex)
    // Validate provenance only after all immutable files have been loaded.
    for (const record of loaded.values()) {
      if (record.type === 'source') continue
      for (const id of record.sourceIds) {
        const source = sourceIndex.get(id)
        if (!source || source.contextReceipt || source.projectId !== record.projectId) throw new Error(`Evidence integrity failure: invalid source reference in ${record.id}`)
      }
      if (record.type === 'semantic') for (const id of [...record.supersedes, ...record.conflicts]) {
        const target = loaded.get(id)
        if (target?.type !== 'semantic' || target.projectId !== record.projectId) throw new Error(`Evidence integrity failure: invalid semantic reference in ${record.id}`)
      }
    }
    this.records = loaded
    this.verifiedFiles = verifiedFiles
    this.sourceIndex = sourceIndex
    this.eventIndex = eventIndex
    this.tornWrites = torn
  }

  private fingerprint(filename: string): string {
    const stats = lstatSync(filename, { bigint: true })
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > BigInt(MAX_RECORD_CHARS * 4)) throw new Error('invalid or oversized canonical record file')
    return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':')
  }
  private indexSource(record: SourceRecord, sources = this.sourceIndex, events = this.eventIndex): void {
    sources.set(record.id, record)
    for (const chunk of record.chunks) sources.set(chunk.id, record)
    const key = canonical([record.sessionId, record.eventId])
    const ids = events.get(key) ?? []
    if (!ids.includes(record.id)) events.set(key, [...ids, record.id])
  }

  private mutate<T>(operation: () => T): T {
    const lock = path.join(path.resolve(this.directory), '.writer-lock')
    let fd: number | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try { fd = openSync(lock, 'wx'); writeFileSync(fd, canonical({ pid: process.pid })); fsyncSync(fd); break }
      catch (error) {
        if (fd !== undefined) {
          closeSync(fd); fd = undefined
          // Only this attempt created this lock; do not strand it after an IO failure.
          try { unlinkSync(lock) } catch { /* Preserve the original write failure. */ }
        }
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        // A crashed writer must not permanently prevent an idempotent restart.
        try {
          const owner = JSON.parse(readFileSync(lock, 'utf8'))
          integer(owner.pid, 'lock owner', 1)
          try { process.kill(owner.pid, 0) } catch (probe) {
            if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(lock); continue }
          }
        } catch { /* An unreadable/live lock cannot be safely stolen. */ }
      }
    }
    if (fd === undefined) throw new Error('Evidence writer busy; retry later (bounded to three attempts)')
    try { this.reload(); return operation() }
    finally { closeSync(fd); unlinkSync(lock) }
  }

  private commit(record: StoredRecord): void {
    const encoded = canonical({ schema: 1, record, sha256: sha(canonical(record)) })
    if (encoded.length > MAX_RECORD_CHARS) throw new Error('Evidence record exceeds local storage limit')
    const destination = path.join(this.recordDirectory, `${sha(record.id)}.json`)
    const temporary = `${destination}.tmp-${randomUUID()}`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx')
      writeFileSync(fd, encoded, 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined
      renameSync(temporary, destination)
      // POSIX directory fsync makes the rename durable; Windows rejects directory handles.
      let directoryFd: number | undefined
      try { directoryFd = openSync(this.recordDirectory, 'r'); fsyncSync(directoryFd) }
      catch (error) { if (!['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
      finally { if (directoryFd !== undefined) closeSync(directoryFd) }
      this.records.set(record.id, record)
      this.verifiedFiles.set(path.basename(destination), { fingerprint: this.fingerprint(destination), record })
      if (record.type === 'source') this.indexSource(record)
    } finally { if (fd !== undefined) closeSync(fd) }
  }

  capture(input: EvidenceInput): EvidenceRecord {
    const base = {
      projectId: nonempty(input.projectId, 'projectId'), runId: nonempty(input.runId, 'runId'), sessionId: nonempty(input.sessionId, 'sessionId'),
      routeId: nonempty(input.routeId, 'routeId'), eventId: nonempty(input.eventId, 'eventId'), version: integer(input.version ?? 1, 'version', 1),
    }
    const at = integer(input.at, 'at timestamp')
    const kind = nonempty(input.kind, 'kind')
    if (/^(reasoning|analysis|chain[-_ ]?of[-_ ]?thought|private[-_ ]?reasoning)$/iu.test(kind)) throw new Error('Private reasoning is not evidence')
    if (typeof input.text !== 'string' || input.text.length > 2 * 1024 * 1024) throw new Error('Invalid evidence text or capture too large')
    const coverage = input.coverage ?? (input.host ? 'host' : 'captured')
    if (!['host', 'captured', 'truncated', 'reference-only'].includes(coverage)) throw new Error('Invalid coverage')
    let host: EvidenceHostRef | undefined
    if (input.host) {
      host = { sessionId: nonempty(input.host.sessionId, 'host sessionId'), seq: integer(input.host.seq, 'host seq') }
      if (host.sessionId !== base.sessionId) throw new Error('Host session must equal evidence session')
    }
    if (coverage === 'host' && !host) throw new Error('Host coverage requires a host reference')
    if (coverage === 'reference-only' && input.text) throw new Error('Reference-only evidence cannot claim text coverage')
    const id = sourceIdentity(base)
    const chunks: EvidenceChunk[] = []
    // A small overlap preserves lexical matches crossing chunk boundaries.
    for (let start = 0; !input.contextReceipt && (start < input.text.length || (start === 0 && input.text.length === 0)); start += CHUNK_CHARS - 128) {
      const end = Math.min(start + CHUNK_CHARS, input.text.length)
      const text = input.text.slice(start, end)
      chunks.push({ id: `chunk_${sha(canonical([id, start, end]))}`, start, end, sha256: sha(text), terms: terms(text) })
      if (end === input.text.length) break
    }
    const record: SourceRecord = {
      type: 'source', id, sourceId: id, ...base, ...(input.seq === undefined ? {} : { seq: integer(input.seq, 'seq') }), at, kind,
      sha256: sha(input.text), length: input.text.length, ...(host ? { host } : {}), coverage,
      attachments: attachments(input.attachments), files: strings(input.files, 'files'), topics: strings(input.topics, 'topics'), chunks,
      ...(input.origin ? { origin: origin(input.origin) } : {}),
      ...(input.contextReceipt === undefined ? {} : { contextReceipt: input.contextReceipt }),
      ...(coverage === 'host' || coverage === 'reference-only' ? {} : { capturedText: input.text }),
    }
    validateContextReceipt(record)
    if (record.contextReceipt && !record.length) throw new Error('Context receipt requires accessible host text')
    return this.mutate(() => {
      const previous = this.records.get(id)
      if (previous) {
        let equivalent = canonical(previous) === canonical(record)
        if (!equivalent && previous.type === 'source' && previous.promotion && !record.promotion) {
          const { promotion, host: _host, ...prior } = previous
          const original = { ...prior, coverage: promotion.previousCoverage, capturedText: input.text }
          equivalent = canonical(original) === canonical(record)
        }
        if (!equivalent) throw new Error(`Evidence source conflict: ${id}; supply a new source version`)
        return this.metadata(previous as SourceRecord)
      } else this.commit(record)
      return this.metadata(record)
    })
  }

  /** Release fallback bytes only after an exact host-log body has become durable. */
  async promoteToHost(sourceId: string, ref: EvidenceHostRef): Promise<boolean> {
    const source = this.records.get(sourceId)
    if (source?.type !== 'source') return false
    const host = { sessionId: nonempty(ref.sessionId, 'host sessionId'), seq: integer(ref.seq, 'host seq') }
    if (host.sessionId !== source.sessionId) throw new Error('Host session must equal evidence session')
    if (source.coverage === 'reference-only' || !this.resolver) return false
    let resolved: Awaited<ReturnType<Resolver>>
    try { resolved = await this.resolver(host) } catch { return false }
    if (!resolved || typeof resolved.text !== 'string' || resolved.text.length !== source.length || sha(resolved.text) !== source.sha256) return false
    return this.mutate(() => {
      const latest = this.records.get(sourceId)
      if (latest?.type !== 'source' || latest.sha256 !== source.sha256) return false
      if (latest.coverage === 'host') return latest.host?.sessionId === host.sessionId && latest.host.seq === host.seq
      if (latest.coverage !== 'captured' && latest.coverage !== 'truncated') return false
      const { capturedText: _text, ...metadata } = latest
      this.commit({ ...metadata, coverage: 'host', host, promotion: { at: Date.now(), previousCoverage: latest.coverage, verifiedSha256: latest.sha256 } })
      return true
    })
  }

  private metadata(record: SourceRecord): EvidenceRecord {
    const { type: _type, capturedText: _text, ...metadata } = record
    return copy(metadata)
  }
  private grant(access: EvidenceAccess): Set<string> {
    if (this.integrityFailure) throw this.integrityFailure
    nonempty(access.projectId, 'access projectId')
    return new Set(strings(access.sessionIds, 'access sessionIds', 256))
  }
  private allowed(access: EvidenceAccess, source: SourceRecord, sessions = this.grant(access)): boolean { return source.projectId === access.projectId && sessions.has(source.sessionId) }
  private findSource(id: string): SourceRecord | undefined { return this.sourceIndex.get(id) }
  private validSources(projectId: string, ids: unknown, access?: EvidenceAccess): string[] {
    const values = strings(ids, 'sourceIds', 256)
    if (!values.length) throw new Error('At least one evidence source is required')
    const sessions = access ? this.grant(access) : undefined
    for (const id of values) {
      const source = this.findSource(id)
      if (!source || source.contextReceipt || source.projectId !== projectId || (access && !this.allowed(access, source, sessions))) throw new Error('Invalid or inaccessible evidence source reference; context receipts cannot become provenance')
    }
    return values
  }
  private sourcesAllowed(access: EvidenceAccess, ids: readonly string[]): boolean {
    const sessions = this.grant(access)
    return ids.length > 0 && ids.every(id => { const source = this.findSource(id); return !!source && !source.contextReceipt && this.allowed(access, source, sessions) })
  }

  *recordsFor(access: EvidenceAccess): Iterable<EvidenceRecord> {
    const sessions = this.grant(access)
    for (const record of this.records.values()) if (record.type === 'source' && !record.contextReceipt && this.allowed(access, record, sessions)) yield this.metadata(record)
  }
  /** Metadata identifiers only; this helper conveys no content access. */
  idsFor(sessionId: string, eventId: string): string[] {
    if (this.integrityFailure) throw this.integrityFailure
    return [...(this.eventIndex.get(canonical([sessionId, eventId])) ?? [])]
  }
  private async resolve(source: SourceRecord): Promise<{ text: string; status: EvidenceStatus }> {
    if (source.coverage === 'reference-only') return { text: '', status: 'reference-only' }
    if (source.coverage !== 'host') return { text: source.capturedText ?? '', status: source.coverage }
    let resolved: Awaited<ReturnType<Resolver>>
    try { resolved = await this.resolver?.(source.host!) } catch { return { text: '', status: 'unavailable' } }
    if (!resolved || typeof resolved.text !== 'string') return { text: '', status: 'unavailable' }
    if (source.contextReceipt && resolved.callId !== source.origin?.callId) return { text: '', status: 'identity-mismatch' }
    if (resolved.text.length !== source.length || sha(resolved.text) !== source.sha256) return { text: '', status: 'hash-mismatch' }
    return { text: resolved.text, status: 'host' }
  }

  async search(access: EvidenceAccess, query: EvidenceQuery = {}): Promise<EvidenceSearchResult> {
    const sessions = this.grant(access)
    const maxChars = budget(query.maxChars)
    const offset = boundedInt(query.offset, 0, Number.MAX_SAFE_INTEGER)
    const limit = boundedInt(query.limit, 10, 100)
    const needle = query.query?.trim().toLowerCase() ?? ''
    if (needle.length > 2048) throw new Error('Search query too large')
    const keywords = terms(needle)
    if (query.kind !== undefined && (typeof query.kind !== 'string' || !query.kind || query.kind.length > 128)) throw new Error('Search kind must be a nonempty source or semantic class')
    const matchesKind = (kind: string) => query.kind === undefined || kind === query.kind || kind.startsWith(query.kind + ':')
    const visibleSemantic = this.semantics(access)
    const labels = new Map<string, { topics: Set<string>; files: Set<string> }>()
    for (const semantic of visibleSemantic) for (const id of semantic.sourceIds) {
      const source = this.findSource(id)!
      const associated = labels.get(source.id) ?? { topics: new Set<string>(), files: new Set<string>() }
      semantic.topics.forEach(topic => associated.topics.add(topic))
      semantic.files.forEach(file => associated.files.add(file))
      labels.set(source.id, associated)
    }
    const candidates: { source: SourceRecord; chunk?: EvidenceChunk; semantic?: SemanticRecord; bodyKeywords?: string[]; at: number; tie: string }[] = []
    for (const record of this.records.values()) {
      if (record.type !== 'source' || record.contextReceipt || !this.allowed(access, record, sessions)) continue
      if (!matchesKind(record.kind)) continue
      if (query.routeId !== undefined && record.routeId !== query.routeId) continue
      if (query.file !== undefined && ![...record.files, ...(labels.get(record.id)?.files ?? [])].some(file => file.toLowerCase().includes(query.file!.toLowerCase()))) continue
      if (query.topic !== undefined && !record.topics.includes(query.topic) && !labels.get(record.id)?.topics.has(query.topic)) continue
      if (query.after !== undefined && record.at < query.after) continue
      if (query.before !== undefined && record.at > query.before) continue
      // Public source identity applies to every chunk, only after its complete ACL passes.
      // Derive it at read time so existing records need no index/schema migration.
      const identityTerms = terms([record.origin?.resourceId, record.origin?.tool].filter(Boolean).join(' '))
      const bodyKeywords = keywords.filter(word => !identityTerms.some(term => term.includes(word)))
      for (const chunk of record.chunks) {
        if (query.id && ![record.id, record.eventId, chunk.id].includes(query.id)) continue
        if (needle && !bodyKeywords.every(word => chunk.terms.some(term => term.includes(word)))) continue
        candidates.push({ source: record, chunk, bodyKeywords, at: record.at, tie: chunk.id })
      }
    }
    for (const semantic of visibleSemantic) {
      if (!matchesKind(semantic.kind)) continue
      if (query.id !== undefined && query.id !== semantic.id && !semantic.sourceIds.includes(query.id)) continue
      const provenance = semantic.sourceIds.map(id => this.findSource(id)!)
      if (query.routeId !== undefined && !provenance.some(source => source.routeId === query.routeId)) continue
      if (query.topic !== undefined && !semantic.topics.includes(query.topic)) continue
      if (query.file !== undefined && !semantic.files.some(file => file.toLowerCase().includes(query.file!.toLowerCase()))) continue
      if (query.after !== undefined && semantic.at < query.after) continue
      if (query.before !== undefined && semantic.at > query.before) continue
      const words = terms(semantic.text)
      if (needle && !keywords.every(word => words.some(term => term.includes(word)))) continue
      candidates.push({ source: provenance[0], semantic, at: semantic.at, tie: semantic.id })
    }
    candidates.sort((a, b) => b.at - a.at || (b.source.seq ?? 0) - (a.source.seq ?? 0) || (b.chunk?.start ?? 0) - (a.chunk?.start ?? 0) || a.tie.localeCompare(b.tie))
    const result: EvidenceSearchResult = { items: [], total: candidates.length }
    if (keywords.length && candidates.some(candidate => candidate.bodyKeywords?.length === 0)) {
      result.retrievalHint = '匹配来源标识仅定位资料，摘录不是全文。请用真实sourceId作id加正文关键词精确检索，或按nextOffset翻页、get offset/maxChars读片段；quote只校验已读原文，结束标记不能替代缺失事实。'
    }
    const cache = new Map<string, Awaited<ReturnType<EvidenceStore['resolve']>>>()
    const acceptedIndices: number[] = []
    let index = offset
    for (; index < candidates.length && result.items.length < limit; index++) {
      const { source, chunk, semantic, bodyKeywords } = candidates[index]
      let resolved = semantic ? { text: semantic.text, status: 'captured' as EvidenceStatus } : cache.get(source.id)
      if (!resolved) { resolved = await this.resolve(source); cache.set(source.id, resolved) }
      const text = semantic ? semantic.text : resolved.text.slice(chunk!.start, chunk!.end)
      const lowerText = text.toLowerCase(), excerptKeywords = bodyKeywords ?? keywords
      // A metadata hit locates the source, not an excerpt at its header. When the
      // full body phrase is absent, use actual body word positions instead.
      const phrase = needle && excerptKeywords.length === keywords.length ? lowerText.indexOf(needle) : -1
      const matched = phrase >= 0 ? phrase : excerptKeywords.reduce((first, word) => {
        const position = lowerText.indexOf(word)
        return position < 0 ? first : first < 0 ? position : Math.min(first, position)
      }, -1)
      const start = matched < 0 ? 0 : Math.max(0, matched - 120)
      const item: EvidenceSearchItem = {
        id: semantic?.id ?? chunk!.id, sourceId: source.id, sessionId: source.sessionId, routeId: source.routeId, at: semantic?.at ?? source.at, kind: semantic?.kind ?? source.kind,
        excerpt: text.slice(start, start + 600), status: resolved.status, start: semantic ? 0 : chunk!.start, end: semantic ? semantic.text.length : chunk!.end, attachments: semantic ? [] : copy(source.attachments),
        ...(semantic ? { semanticStatus: semantic.status, sourceIds: copy(semantic.sourceIds), topics: copy(semantic.topics), files: copy(semantic.files) } : {}),
        ...(!semantic && keywords.length && bodyKeywords?.length === 0 ? { match: 'source-identity' as const, sourceChars: source.length, sourceChunks: source.chunks.length } : {}),
      }
      result.nextOffset = index + 1 < candidates.length ? index + 1 : undefined
      result.items.push(item)
      acceptedIndices.push(index)
      while (canonical(result).length > maxChars && item.excerpt.length) item.excerpt = item.excerpt.slice(0, Math.max(0, item.excerpt.length - (canonical(result).length - maxChars)))
      if (canonical(result).length > maxChars) {
        result.items.pop()
        acceptedIndices.pop()
        result.omitted = (result.omitted ?? 0) + 1
        if (result.items.length) { result.nextOffset = index; break }
      }
    }
    if (index < candidates.length) result.nextOffset ??= index
    else delete result.nextOffset
    // Counters and cursor widths can change after the last item's initial fit.
    // Budget the final envelope, including metadata, rather than only excerpts.
    while (canonical(result).length > maxChars) {
      const excerpt = result.items.findLast(item => item.excerpt.length > 0)
      if (excerpt) {
        excerpt.excerpt = excerpt.excerpt.slice(0, Math.max(0, excerpt.excerpt.length - (canonical(result).length - maxChars)))
        continue
      }
      const dropped = acceptedIndices.pop()
      if (dropped === undefined) break // The fixed empty envelope fits the minimum budget.
      result.items.pop()
      result.omitted = (result.omitted ?? 0) + 1
      if (result.items.length) result.nextOffset = Math.min(result.nextOffset ?? candidates.length, dropped)
      else if (dropped + 1 < candidates.length) result.nextOffset = dropped + 1
      else delete result.nextOffset
    }
    return result
  }

  async get(access: EvidenceAccess, id: string, options: { offset?: number; maxChars?: number; neighbors?: number; quote?: string } = {}): Promise<EvidenceGetResult> {
    this.grant(access)
    const semantic = this.records.get(id)?.type === 'semantic' ? this.semantics(access).find(record => record.id === id) : undefined
    const stored = this.records.get(id)
    let state: ProjectState | undefined
    if (stored?.type === 'state' && stored.projectId === access.projectId && this.sourcesAllowed(access, stored.sourceIds)) {
      const { type: _type, ...view } = stored
      state = view
    }
    const structured = semantic ?? state
    if (structured) {
      if (options.quote !== undefined) throw new Error('Verified quote requires an original raw source, not a semantic conclusion or state')
      const body = canonical(structured)
      const maxChars = budget(options.maxChars)
      const offset = Math.min(body.length, boundedInt(options.offset, 0, Number.MAX_SAFE_INTEGER))
      const result: EvidenceGetResult = { text: '', sourceIds: copy(structured.sourceIds), status: 'captured', ...(semantic ? { semanticStatus: semantic.status } : {}), offset }
      // The paginated JSON text retains full provenance even when metadata needs a prefix.
      while (canonical(result).length + 40 > maxChars && result.sourceIds.length > 1) { result.sourceIds.pop(); result.sourceIdsTruncated = true }
      result.text = body.slice(offset, Math.min(body.length, offset + Math.max(0, maxChars - canonical(result).length - 40)))
      while (canonical(result).length + 32 > maxChars && result.text.length) result.text = result.text.slice(0, Math.max(0, result.text.length - (canonical(result).length + 32 - maxChars)))
      if (offset + result.text.length < body.length) result.nextOffset = offset + result.text.length
      return result
    }
    const source = this.findSource(id)
    if (!source || !this.allowed(access, source)) throw new Error('Evidence not found or access denied')
    const resolved = await this.resolve(source)
    const chunkIndex = source.chunks.findIndex(chunk => chunk.id === id)
    const neighbors = boundedInt(options.neighbors, 0, 4)
    const first = chunkIndex < 0 ? 0 : source.chunks[Math.max(0, chunkIndex - neighbors)].start
    const last = chunkIndex < 0 ? source.length : source.chunks[Math.min(source.chunks.length - 1, chunkIndex + neighbors)].end
    const relativeOffset = boundedInt(options.offset, 0, Number.MAX_SAFE_INTEGER)
    const offset = Math.min(last, first + relativeOffset)
    const maxChars = budget(options.maxChars)
    if (options.quote !== undefined) {
      const quote = nonempty(options.quote, 'quote', 65536)
      if (!['host', 'captured', 'truncated'].includes(resolved.status)) throw new Error('Quote source is unavailable or failed integrity verification')
      const start = resolved.text.indexOf(quote, offset)
      if (start < 0 || start + quote.length > last) throw new Error('Quote is not an exact substring of the requested original source range')
      const result: EvidenceGetResult = { text: quote, sourceIds: [source.id], status: resolved.status, offset: start,
        ...(source.contextReceipt ? { contextReceipt: true as const } : {}),
        citation: { sourceId: source.id, quote, start, end: start + quote.length, sha256: source.sha256, ...(source.origin ? { origin: copy(source.origin) } : {}) } }
      if (canonical(result).length > maxChars) throw new Error('Verified quote exceeds return budget; request a shorter exact quote or a larger allowed maxChars')
      return result
    }
    const result: EvidenceGetResult = { text: resolved.text.slice(offset, Math.min(last, offset + maxChars)), sourceIds: [source.id], status: resolved.status, offset }
    if (source.contextReceipt) result.contextReceipt = true
    if (source.attachments.length) result.attachments = copy(source.attachments)
    while (canonical(result).length > maxChars && result.text.length) result.text = result.text.slice(0, Math.max(0, result.text.length - (canonical(result).length - maxChars) - 32))
    if (result.text && offset + result.text.length < last) result.nextOffset = relativeOffset + result.text.length
    if (canonical(result).length > maxChars) delete result.attachments
    return result
  }

  addSemantic(input: SemanticInput): SemanticRecord {
    return this.mutate(() => {
      const projectId = nonempty(input.projectId, 'projectId')
      if (!['requirement', 'fact', 'decision', 'failure', 'question', 'superseded'].includes(input.kind)) throw new Error('Invalid semantic kind')
      const status = input.status ?? (input.kind === 'question' ? 'unresolved' : input.kind === 'superseded' ? 'superseded' : 'current')
      if (!['current', 'superseded', 'unresolved'].includes(status)) throw new Error('Invalid semantic status')
      const payload = {
        projectId, kind: input.kind, text: nonempty(input.text, 'semantic text', 100000), sourceIds: this.validSources(projectId, input.sourceIds),
        topics: strings(input.topics, 'topics'), files: strings(input.files, 'files'), status,
        supersedes: strings(input.supersedes, 'supersedes', 256), conflicts: strings(input.conflicts, 'conflicts', 256),
      }
      for (const id of [...payload.supersedes, ...payload.conflicts]) {
        const target = this.records.get(id)
        if (target?.type !== 'semantic' || target.projectId !== projectId) throw new Error('Invalid semantic reference')
        // A narrow-session update must never silently supersede a broader fact.
        const sessions = new Set(payload.sourceIds.map(source => this.findSource(source)!.sessionId))
        if (!target.sourceIds.every(source => sessions.has(this.findSource(source)!.sessionId))) throw new Error('Semantic reference requires all source sessions')
      }
      const id = input.id === undefined ? `sem_${sha(canonical(payload))}` : nonempty(input.id, 'semantic id')
      const previous = this.records.get(id)
      if (previous) {
        if (previous.type !== 'semantic') throw new Error('Semantic id conflict')
        const { type: _type, id: _id, at: _at, ...prior } = previous
        if (canonical(prior) !== canonical(payload)) throw new Error('Semantic id conflict')
        return this.semanticView(previous, false)
      }
      const record: StoredSemantic = { type: 'semantic', id, ...payload, at: Date.now() }
      this.commit(record)
      return this.semanticView(record, false)
    })
  }
  private semanticView(record: StoredSemantic, superseded: boolean): SemanticRecord {
    const { type: _type, ...result } = record
    return copy({ ...result, ...(superseded ? { status: 'superseded' as const } : {}) })
  }
  semantics(access: EvidenceAccess, filter: { status?: SemanticStatus; kind?: SemanticKind; topic?: string } = {}): SemanticRecord[] {
    this.grant(access)
    const visible = [...this.records.values()].filter((record): record is StoredSemantic => record.type === 'semantic' && record.projectId === access.projectId && this.sourcesAllowed(access, record.sourceIds))
    const superseded = new Set(visible.flatMap(record => record.supersedes))
    return visible.map(record => this.semanticView(record, superseded.has(record.id)))
      .filter(record => (!filter.status || record.status === filter.status) && (!filter.kind || record.kind === filter.kind) && (!filter.topic || record.topics.includes(filter.topic)))
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  }

  updateProjectState(access: EvidenceAccess, input: ProjectStateInput): ProjectState {
    return this.mutate(() => {
      const sourceIds = this.validSources(access.projectId, input.sourceIds, access)
      const operations = input.operations?.map(operation => {
        if (!['planned', 'executed', 'verified'].includes(operation.status)) throw new Error('Invalid operation status')
        const ids = operation.status === 'planned' && !operation.sourceIds.length ? [] : this.validSources(access.projectId, operation.sourceIds, access)
        return { id: nonempty(operation.id, 'operation id'), description: nonempty(operation.description, 'operation description', 10000), status: operation.status, sourceIds: ids }
      })
      // Include operation provenance in the revision's visibility boundary.
      const allSources = [...new Set([...sourceIds, ...(operations?.flatMap(operation => operation.sourceIds) ?? [])])].sort()
      const revision = Math.max(0, ...[...this.records.values()].filter((x): x is StoredState => x.type === 'state' && x.projectId === access.projectId).map(x => x.revision)) + 1
      const record: StoredState = {
        type: 'state', id: `state_${sha(canonical([access.projectId, revision]))}`, projectId: nonempty(access.projectId, 'projectId'), revision, at: Date.now(),
        goal: nonempty(input.goal, 'goal', 100000), sourceIds: allSources,
        ...(input.acceptance === undefined ? {} : { acceptance: strings(input.acceptance, 'acceptance', 10000) }),
        ...(input.constraints === undefined ? {} : { constraints: strings(input.constraints, 'constraints', 10000) }),
        ...(input.progress === undefined ? {} : { progress: strings(input.progress, 'progress', 10000) }),
        ...(input.next === undefined ? {} : { next: strings(input.next, 'next', 10000) }),
        ...(input.blockers === undefined ? {} : { blockers: strings(input.blockers, 'blockers', 10000) }),
        ...(operations === undefined ? {} : { operations }),
      }
      this.commit(record)
      const { type: _type, ...result } = record
      return copy(result)
    })
  }
  projectState(access: EvidenceAccess): ProjectState | undefined {
    this.grant(access)
    const latest = [...this.records.values()].filter((record): record is StoredState => record.type === 'state' && record.projectId === access.projectId && this.sourcesAllowed(access, record.sourceIds)).sort((a, b) => b.revision - a.revision)[0]
    if (!latest) return undefined
    const { type: _type, ...result } = latest
    return copy(result)
  }
  stats(access: EvidenceAccess) {
    const sources = [...this.recordsFor(access)]
    const sessions = this.grant(access)
    const receipts = [...this.records.values()].filter((record): record is SourceRecord => record.type === 'source' && record.contextReceipt === true && this.allowed(access, record, sessions))
    const semantic = this.semantics(access)
    const coverage = { host: 0, captured: 0, truncated: 0, 'reference-only': 0 }
    for (const source of sources) coverage[source.coverage]++
    return {
      raw: { sources: sources.length, chunks: sources.reduce((sum, source) => sum + source.chunks.length, 0), characters: sources.reduce((sum, source) => sum + source.length, 0), attachments: sources.reduce((sum, source) => sum + source.attachments.length, 0), coverage },
      contextReceipts: { sources: receipts.length, characters: receipts.reduce((sum, source) => sum + source.length, 0), storage: 'host-metadata-only', indexedBodyCharacters: 0 },
      semantic: { total: semantic.length, current: semantic.filter(x => x.status === 'current').length, superseded: semantic.filter(x => x.status === 'superseded').length, unresolved: semantic.filter(x => x.status === 'unresolved').length },
      integrity: { tornWrites: this.tornWrites, status: this.tornWrites ? 'incomplete-temporary-write' : 'ok', parsedRecords: this.parsedRecords, verifiedFiles: this.verifiedFiles.size },
    }
  }

  /** Derived presentation only. No Markdown input is trusted as canonical evidence. */
  exportMarkdown(access: EvidenceAccess): { files: { path: string; content: string }[] } {
    const sources = [...this.recordsFor(access)]
    const semantic = this.semantics(access)
    const state = this.projectState(access)
    const lines = [`# Evidence index: ${md(access.projectId)}`, '', 'Derived from immutable local evidence records. Host text remains in the host log.', '']
    if (state) {
      lines.push(`## Project state (revision ${state.revision})`, '', md(state.goal), '')
      for (const key of ['acceptance', 'constraints', 'progress', 'next', 'blockers'] as const) if (state[key]?.length) lines.push(`### ${key}`, '', ...state[key]!.map(text => `- ${md(text)}`), '')
      for (const operation of state.operations ?? []) lines.push(`- ${operation.status}: ${md(operation.description)} [${operation.sourceIds.join(', ')}]`)
      lines.push('', `Sources: ${state.sourceIds.join(', ')}`, '')
    }
    lines.push('## Semantic records', '')
    for (const record of semantic) lines.push(`- **${record.kind} / ${record.status}** ${md(record.text)} (${record.id}; sources: ${record.sourceIds.join(', ')})`)
    lines.push('', '## Raw sources and coverage', '', '| Source | Session | Route | Timestamp | Coverage | SHA-256 |', '| --- | --- | --- | --- | --- | --- |')
    for (const source of sources) lines.push(`| ${source.id} | ${md(source.sessionId)} | ${md(source.routeId)} | ${source.at} | ${source.coverage} | ${source.sha256} |`)
    const files = [{ path: 'index.md', content: `${lines.join('\n')}\n` }]
    const topics = new Set([...sources.flatMap(x => x.topics), ...semantic.flatMap(x => x.topics)])
    for (const topic of [...topics].sort()) {
      const slug = topic.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'topic'
      const topicLines = [`# ${md(topic)}`, '', ...semantic.filter(x => x.topics.includes(topic)).map(x => `- ${x.kind} / ${x.status}: ${md(x.text)} [${x.sourceIds.join(', ')}]`), '', '## Sources', '', ...sources.filter(x => x.topics.includes(topic)).map(x => `- ${x.id}: ${x.coverage}; SHA-256 ${x.sha256}`)]
      files.push({ path: `topics/${slug}-${sha(topic).slice(0, 8)}.md`, content: `${topicLines.join('\n')}\n` })
    }
    return { files }
  }
}
