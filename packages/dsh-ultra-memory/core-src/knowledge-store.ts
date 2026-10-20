/** Profile-scoped, explicitly shared knowledge. This module never reads host sessions or calls models. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
export interface KnowledgeSource {
  sourceId: string; projectId: string; sessionId: string; sha256: string; sourceVersion: number
  start: number; end: number; quote: string
}
export interface KnowledgePublication {
  publisher: string; key: string; title: string; summary: string; applicability: string
  topics: string[]; readers: string[]; sources: KnowledgeSource[]; supersedes?: string; expiresAt?: number
  /** Immutable reader IDs to canonical project hashes; new host publications always provide this. */
  readerProjects?: Readonly<Record<string, string>>
}
export interface KnowledgeRecord extends KnowledgePublication {
  id: string; profileId: string; revision: number; createdAt: number
  status: 'current' | 'superseded' | 'revoked' | 'expired'
}
export interface KnowledgeAccess {
  projectId: string; publisherIds: readonly string[]
  /** Host-derived current publisher root binding; when supplied, absent or changed roots deny visibility. */
  publisherProjects?: Readonly<Record<string, string>>
  /** Current caller's canonical project hash; when supplied, legacy missing reader snapshots deny access. */
  readerProject?: string
}
export interface KnowledgeQuery {
  query?: string; topic?: string; publisher?: string; offset?: number; limit?: number; includeInactive?: boolean
}

type PublicationEvent = { type: 'publication'; record: KnowledgeRecord }
type RevocationEvent = { type: 'revocation'; id: string; profileId: string; publisher: string; targetId: string; reason: string; createdAt: number }
type ProfileEvent = { type: 'profile'; profileId: string }
type StoredEvent = PublicationEvent | RevocationEvent | ProfileEvent
interface View { records: KnowledgeRecord[]; latest: Map<string, KnowledgeRecord>; revoked: Set<string> }
const MAX_RECORD_BYTES = 131072
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
function object(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${name}`)
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error(`Unknown ${name} field`)
  return result
}
function text(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || value.includes('\0')) throw new Error(`Invalid ${name}`)
  return value
}
function integer(value: unknown, name: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error(`Invalid ${name}`)
  return value as number
}
function stringList(value: unknown, name: string, max: number, length: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${name}`)
  const list = value.map(item => text(item, name, length))
  if (new Set(list).size !== list.length) throw new Error(`Duplicate ${name}`)
  return [...list].sort()
}
const publicationKeys = ['publisher', 'key', 'title', 'summary', 'applicability', 'topics', 'readers', 'sources', 'supersedes', 'expiresAt', 'readerProjects']
const recordKeys = [...publicationKeys, 'id', 'profileId', 'revision', 'createdAt', 'status']
function publication(value: unknown, stored = false): KnowledgePublication {
  const input = object(value, 'publication', stored ? recordKeys : publicationKeys)
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 4) throw new Error('Invalid sources')
  const sources: KnowledgeSource[] = input.sources.map(value => {
    const source = object(value, 'source', ['sourceId', 'projectId', 'sessionId', 'sha256', 'sourceVersion', 'start', 'end', 'quote'])
    const start = integer(source.start, 'source start'), end = integer(source.end, 'source end')
    const quote = text(source.quote, 'source quote', 2000)
    if (end - start !== quote.length) throw new Error('Invalid source quote range')
    const digest = text(source.sha256, 'source sha256', 64)
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid source sha256')
    return { sourceId: text(source.sourceId, 'sourceId', 512), projectId: text(source.projectId, 'source projectId', 512),
      sessionId: text(source.sessionId, 'source sessionId', 512), sha256: digest,
      sourceVersion: integer(source.sourceVersion, 'sourceVersion', 1), start, end, quote }
  })
  const result: KnowledgePublication = { publisher: text(input.publisher, 'publisher', 512), key: text(input.key, 'key', 128),
    title: text(input.title, 'title', 200), summary: text(input.summary, 'summary', 4000),
    applicability: text(input.applicability, 'applicability', 2000, true), topics: stringList(input.topics, 'topics', 16, 128),
    readers: stringList(input.readers, 'readers', 10000, 512), sources }
  if (input.readerProjects !== undefined) {
    const readerProjects = object(input.readerProjects, 'readerProjects', result.readers)
    if (Object.keys(readerProjects).length !== result.readers.length || result.readers.some(id => !Object.hasOwn(readerProjects, id))) throw new Error('readerProjects must match readers exactly')
    result.readerProjects = Object.fromEntries(result.readers.map(id => {
      const digest = text(readerProjects[id], 'reader project hash', 64)
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid reader project hash')
      return [id, digest]
    }))
  }
  if (input.supersedes !== undefined) result.supersedes = recordId(input.supersedes)
  if (input.expiresAt !== undefined) result.expiresAt = integer(input.expiresAt, 'expiresAt')
  if (Buffer.byteLength(canonical(result)) > MAX_RECORD_BYTES - 4096) throw new Error('Publication size limit exceeded')
  return result
}
function recordId(value: unknown): string {
  const id = text(value, 'record id', 68)
  if (!/^kn_[a-f0-9]{64}$/.test(id)) throw new Error('Invalid record id')
  return id
}
const group = (record: KnowledgePublication) => canonical([record.publisher, record.key])
function payload(input: KnowledgePublication): string { const { supersedes: _previous, ...content } = publication(input, true); return canonical(content) }
function identity(profileId: string, input: KnowledgePublication, revision: number): string { return `kn_${sha(canonical({ profileId, publication: input, revision }))}` }

/** Walk every ancestor before creating anything; recursive mkdir alone follows symlinks. */
function secureDirectory(directory: string, create = false): void {
  const absolute = path.resolve(directory), root = path.parse(absolute).root
  let cursor = root
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part)
    let stat
    try { stat = lstatSync(cursor) } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try { mkdirSync(cursor, { mode: 0o700 }) } catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError }
      stat = lstatSync(cursor)
    }
    if (stat.isSymbolicLink()) throw new Error('Knowledge storage symbolic link rejected')
    if (!stat.isDirectory()) throw new Error('Knowledge storage directory required')
  }
}

export class KnowledgeStore {
  private readonly directory: string
  private readonly recordsDirectory: string
  private readonly profileId: string
  private readonly now: () => number
  private readonly maxEntries: number
  constructor(directory: string, profileId: string, options: { now?: () => number; maxEntries?: number } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Absolute knowledge directory required')
    if (!/^[a-f0-9]{64}$/.test(profileId)) throw new Error('Invalid profileId')
    this.directory = path.resolve(directory)
    this.recordsDirectory = path.join(this.directory, 'records')
    this.profileId = profileId
    this.now = options.now ?? Date.now
    this.maxEntries = integer(options.maxEntries ?? 10000, 'maxEntries', 1)
    if (this.maxEntries > 10000) throw new Error('maxEntries exceeds limit')
    secureDirectory(this.directory, true)
    secureDirectory(this.recordsDirectory, true)
    const manifest = path.join(this.directory, 'profile.json')
    try { lstatSync(manifest) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.lock(() => {
        // Another initializer may have completed before our lock was acquired.
        try { lstatSync(manifest) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          if (readdirSync(this.recordsDirectory).some(name => name.endsWith('.json'))) throw new Error('Missing profile binding for existing records')
          this.write(manifest, { type: 'profile', profileId: this.profileId })
        }
      })
    }
    this.binding()
  }
  private clock(): number { return integer(this.now(), 'current time') }
  private checkDirectories(): void { secureDirectory(this.directory); secureDirectory(this.recordsDirectory) }
  private read(file: string): StoredEvent {
    const stat = lstatSync(file)
    if (stat.isSymbolicLink()) throw new Error('Knowledge record symbolic link rejected')
    if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) throw new Error('Invalid knowledge record file')
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const opened = fstatSync(fd)
      if (!opened.isFile() || opened.size > MAX_RECORD_BYTES || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('Knowledge record integrity race')
      let envelope
      try { envelope = object(JSON.parse(readFileSync(fd, 'utf8')), 'record envelope', ['schema', 'event', 'sha256']) }
      catch { throw new Error('Invalid knowledge record JSON') }
      if (envelope.schema !== 1 || typeof envelope.sha256 !== 'string' || sha(canonical(envelope.event)) !== envelope.sha256) throw new Error('Knowledge record checksum integrity failure')
      return envelope.event as StoredEvent
    } finally { closeSync(fd) }
  }
  private binding(): void {
    this.checkDirectories()
    const event = object(this.read(path.join(this.directory, 'profile.json')), 'profile binding', ['type', 'profileId'])
    if (event.type !== 'profile' || event.profileId !== this.profileId) throw new Error('Knowledge profile mismatch')
  }
  /** No stale-lock stealing: fail immediately with a bounded diagnostic for manual recovery. */
  private lock<T>(operation: () => T): T {
    this.checkDirectories()
    const file = path.join(this.directory, '.writer.lock')
    let fd: number
    try { fd = openSync(file, 'wx', 0o600) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Knowledge writer lock exists; possible stale lock requires manual recovery')
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        // Windows may refuse exclusive creation during a sharing restriction.
        // Preserve the errno and fail closed: this is not proof that a lock
        // exists, and never authorizes deleting it or retrying implicitly.
        throw Object.assign(new Error('Knowledge writer lock unavailable (EPERM): concurrent writer or filesystem permission/sharing restriction; check the current owner and permissions before retrying', { cause: error }), { code: 'EPERM' })
      }
      throw error
    }
    try {
      writeFileSync(fd, canonical({ pid: process.pid, createdAt: this.clock() }), 'utf8')
      fsyncSync(fd)
      return operation()
    } finally { closeSync(fd); unlinkSync(file) }
  }
  /** Caller holds the writer lock. An existing immutable destination is never replaced. */
  private write(file: string, event: StoredEvent): void {
    const temporary = `${file}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      try { lstatSync(file); throw new Error('Immutable knowledge record already exists') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const encoded = canonical({ schema: 1, event, sha256: sha(canonical(event)) })
      if (Buffer.byteLength(encoded) > MAX_RECORD_BYTES) throw new Error('Knowledge record size limit exceeded')
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, encoded, 'utf8')
      fsyncSync(fd)
      closeSync(fd); fd = undefined
      // Lock serializes legitimate writers; recheck to avoid overwriting unexpected files.
      try { lstatSync(file); throw new Error('Immutable knowledge record already exists') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      renameSync(temporary, file)
    } finally {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
  private view(): View {
    this.binding()
    const records: KnowledgeRecord[] = [], revocations: RevocationEvent[] = []
    const files = readdirSync(this.recordsDirectory)
    if (files.length > 30000) throw new Error('Knowledge directory entry limit exceeded')
    for (const name of files.sort()) {
      if (lstatSync(path.join(this.recordsDirectory, name)).isSymbolicLink()) throw new Error('Knowledge record symbolic link rejected')
      // Atomic writes may leave an uncommitted .tmp after a crash. Never interpret it as data.
      if (name.endsWith('.tmp')) continue
      if (!/^(kn|rev)_[a-f0-9]{64}\.json$/.test(name)) throw new Error('Invalid finalized knowledge record filename')
      const event = this.read(path.join(this.recordsDirectory, name))
      if (event.type === 'publication') {
        object(event, 'publication event', ['type', 'record'])
        const data = event.record, input = publication(data, true)
        if (data.profileId !== this.profileId) throw new Error('Knowledge record profile mismatch')
        const revision = integer(data.revision, 'revision', 1)
        integer(data.createdAt, 'createdAt')
        if (data.status !== 'current' || data.id !== identity(this.profileId, input, revision) || name !== `${data.id}.json`) throw new Error('Knowledge record identity integrity failure')
        records.push({ ...input, id: data.id, profileId: this.profileId, revision, createdAt: data.createdAt, status: 'current' })
      } else if (event.type === 'revocation') {
        object(event, 'revocation event', ['type', 'id', 'profileId', 'publisher', 'targetId', 'reason', 'createdAt'])
        if (event.profileId !== this.profileId) throw new Error('Knowledge revocation profile mismatch')
        text(event.publisher, 'revocation publisher', 512); text(event.reason, 'revocation reason', 2000)
        recordId(event.targetId); integer(event.createdAt, 'revocation createdAt')
        const expected = `rev_${sha(canonical([this.profileId, event.publisher, event.targetId]))}`
        if (event.id !== expected || name !== `${expected}.json`) throw new Error('Knowledge revocation identity integrity failure')
        revocations.push(event)
      } else throw new Error('Invalid knowledge record type')
    }
    if (records.length > 10000) throw new Error('Knowledge entries limit exceeded')
    records.sort((a, b) => a.revision - b.revision || a.id.localeCompare(b.id))
    const latest = new Map<string, KnowledgeRecord>(), byId = new Map<string, KnowledgeRecord>()
    for (const record of records) {
      const previous = latest.get(group(record))
      if ((!previous && (record.revision !== 1 || record.supersedes !== undefined)) ||
        (previous && (record.revision !== previous.revision + 1 || record.supersedes !== previous.id))) throw new Error('Knowledge version chain integrity failure')
      latest.set(group(record), record); byId.set(record.id, record)
    }
    const revoked = new Set<string>()
    for (const event of revocations) {
      if (byId.get(event.targetId)?.publisher !== event.publisher || revoked.has(event.targetId)) throw new Error('Knowledge revocation integrity failure')
      revoked.add(event.targetId)
    }
    const now = this.clock()
    for (const record of records) {
      record.status = revoked.has(record.id) ? 'revoked' : latest.get(group(record))?.id !== record.id ? 'superseded' :
        record.expiresAt !== undefined && record.expiresAt <= now ? 'expired' : 'current'
    }
    return { records, latest, revoked }
  }
  publish(value: KnowledgePublication): KnowledgeRecord {
    const input = publication(value)
    return this.lock(() => {
      const view = this.view(), previous = view.latest.get(group(input))
      if (previous?.status === 'current' && payload(previous) === payload(input)) return structuredClone(previous)
      if (previous ? input.supersedes !== previous.id : input.supersedes !== undefined) throw new Error('supersedes must identify the exact latest publication')
      if (view.records.length >= this.maxEntries) throw new Error('Knowledge entries limit exceeded')
      const createdAt = this.clock()
      if (input.expiresAt !== undefined && input.expiresAt <= createdAt) throw new Error('expiresAt must be in the future')
      const revision = (previous?.revision ?? 0) + 1
      const record: KnowledgeRecord = { ...input, id: identity(this.profileId, input, revision), profileId: this.profileId, revision, createdAt, status: 'current' }
      this.write(path.join(this.recordsDirectory, `${record.id}.json`), { type: 'publication', record })
      return structuredClone(record)
    })
  }
  revoke(publisher: string, id: string, reason: string): void {
    text(publisher, 'publisher', 512); recordId(id); text(reason, 'reason', 2000)
    this.lock(() => {
      const view = this.view(), target = view.records.find(record => record.id === id)
      if (!target || target.publisher !== publisher) throw new Error('Publication publisher does not own the target')
      if (view.revoked.has(id)) return
      const event: RevocationEvent = { type: 'revocation', id: `rev_${sha(canonical([this.profileId, publisher, id]))}`,
        profileId: this.profileId, publisher, targetId: id, reason, createdAt: this.clock() }
      this.write(path.join(this.recordsDirectory, `${event.id}.json`), event)
    })
  }
  private visible(access: KnowledgeAccess, record: KnowledgeRecord, includeInactive: boolean): boolean {
    if (typeof access?.projectId !== 'string' || !Array.isArray(access.publisherIds)) return false
    const isOwner = access.projectId === record.publisher
    if (access.publisherProjects !== undefined) {
      const project = Object.hasOwn(access.publisherProjects, record.publisher) ? access.publisherProjects[record.publisher] : undefined
      if (!project || !record.sources.every(source => source.projectId === project)) return false
    }
    if (record.status !== 'current' && !(includeInactive && isOwner)) return false
    if (!isOwner && access.readerProject !== undefined && (!record.readerProjects ||
      !Object.hasOwn(record.readerProjects, access.projectId) || record.readerProjects[access.projectId] !== access.readerProject)) return false
    return isOwner || (access.publisherIds.includes(record.publisher) && record.readers.includes(access.projectId))
  }
  private present(record: KnowledgeRecord): KnowledgeRecord {
    // Revocation closes shared content even in the publisher's explicit history view.
    // Apply this before matching as well as before returning data to avoid a count oracle.
    return record.status === 'revoked' ? { ...record, title: '', summary: '', applicability: '', topics: [], sources: [], readers: [], ...(record.readerProjects ? { readerProjects: {} } : {}) } : record
  }
  search(access: KnowledgeAccess, value: KnowledgeQuery = {}): { items: KnowledgeRecord[]; total: number; nextOffset?: number } {
    const query = object(value, 'query', ['query', 'topic', 'publisher', 'offset', 'limit', 'includeInactive'])
    const offset = integer(query.offset ?? 0, 'offset'), limit = Math.min(10000, integer(query.limit ?? 20, 'limit', 1))
    const terms = query.query === undefined ? [] : text(query.query, 'query', 4000, true).toLocaleLowerCase().split(/\s+/u).filter(Boolean)
    const topic = query.topic === undefined ? undefined : text(query.topic, 'topic', 128)
    const publisher = query.publisher === undefined ? undefined : text(query.publisher, 'publisher', 512)
    if (query.includeInactive !== undefined && typeof query.includeInactive !== 'boolean') throw new Error('Invalid includeInactive')
    const filtered = this.view().records.filter(record => this.visible(access, record, query.includeInactive === true)).map(record => this.present(record)).filter(record => {
      if (topic !== undefined && !record.topics.includes(topic) || publisher !== undefined && record.publisher !== publisher) return false
      const document = [record.key, record.title, record.summary, record.applicability, ...record.topics].join('\n').toLocaleLowerCase()
      return terms.every(term => document.includes(term))
    }).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    const items = filtered.slice(offset, offset + limit)
    return { items: structuredClone(items), total: filtered.length, ...(offset + items.length < filtered.length ? { nextOffset: offset + items.length } : {}) }
  }
  get(access: KnowledgeAccess, id: string, includeInactive = false): KnowledgeRecord | undefined {
    recordId(id)
    if (typeof includeInactive !== 'boolean') throw new Error('Invalid includeInactive')
    const record = this.view().records.find(record => record.id === id)
    return record && this.visible(access, record, includeInactive) ? structuredClone(this.present(record)) : undefined
  }
}
