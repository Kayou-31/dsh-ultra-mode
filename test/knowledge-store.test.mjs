import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const sourcePath = new URL('../src/knowledge-store.ts', import.meta.url)
function load(overrides = {}, runtimeProcess = process) {
  const exports = {}
  if (fs.existsSync(sourcePath)) vm.runInNewContext(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, Buffer, process: runtimeProcess, structuredClone, require: id => id === 'node:fs' ? { ...fs, ...overrides } : require(id) })
  return exports.KnowledgeStore
}
const KnowledgeStore = load()
const profile = 'a'.repeat(64)
const access = { projectId: 'b', publisherIds: ['a'] }
const owner = { projectId: 'a', publisherIds: [] }
const input = extra => ({ publisher: 'a', key: 'build', title: '中文构建', summary: 'Use offline compiler for project',
  applicability: '本地开发', topics: ['offline'], readers: ['b'], sources: [{ sourceId: 'src_1', projectId: 'root-a',
    sessionId: 'session-a', sha256: 'b'.repeat(64), sourceVersion: 1, start: 4, end: 9, quote: 'proof' }], ...extra })
function fixture(t, options = {}, Store = KnowledgeStore) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-knowledge-'))
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }))
  const directory = path.join(parent, 'knowledge')
  return { parent, directory, store: new Store(directory, profile, options) }
}
function jsonFiles(directory) {
  return fs.readdirSync(directory, { recursive: true }).filter(name => name.endsWith('.json')).map(name => path.join(directory, name))
}
const ready = { skip: typeof KnowledgeStore !== 'function' }

test('knowledge store exposes the specified synchronous publication interface', () => {
  assert.equal(typeof KnowledgeStore, 'function')
})
test('empty store publishes durable records, isolates profiles, and returns defensive copies', ready, t => {
  const { store, directory } = fixture(t)
  assert.equal(store.search(access, {}).total, 0)
  const first = store.publish(input())
  assert.equal(first.status, 'current')
  assert.equal(first.revision, 1)
  assert.equal(first.profileId, profile)
  first.sources[0].quote = 'changed'
  const restored = new KnowledgeStore(directory, profile)
  assert.equal(restored.get(access, first.id).sources[0].quote, 'proof')
  assert.throws(() => new KnowledgeStore(directory, 'c'.repeat(64)), /profile/i)
})
test('same live payload deduplicates across stores and replacement requires exact latest id', ready, t => {
  const { store, directory } = fixture(t)
  const original = store.publish(input())
  assert.equal(new KnowledgeStore(directory, profile).publish(input()).id, original.id)
  assert.throws(() => store.publish(input({ summary: 'changed' })), /supersedes/i)
  const next = store.publish(input({ summary: 'changed', supersedes: original.id }))
  assert.equal(next.revision, 2)
  assert.equal(store.publish(input({ summary: 'changed', supersedes: original.id })).id, next.id)
  assert.throws(() => store.publish(input({ summary: 'other', supersedes: original.id })), /supersedes/i)
  assert.equal(store.get(access, original.id, true), undefined)
  assert.equal(store.get(owner, original.id, true).status, 'superseded')
  assert.equal(store.get(owner, original.id), undefined)
})
test('revocation and expiry remain closed to readers and cannot resurrect through an identical retry', ready, t => {
  let now = 100
  const { store } = fixture(t, { now: () => now })
  const original = store.publish(input({ expiresAt: 200 }))
  now = 200
  assert.equal(store.get(access, original.id, true), undefined)
  assert.equal(store.get(owner, original.id, true).status, 'expired')
  assert.throws(() => store.publish(input({ expiresAt: 200 })), /supersedes/i)
  assert.throws(() => store.publish(input({ expiresAt: 300 })), /supersedes/i)
  const next = store.publish(input({ expiresAt: 300, supersedes: original.id }))
  assert.throws(() => store.revoke('b', next.id, 'bad'), /publisher/i)
  store.revoke('a', next.id, 'withdraw')
  store.revoke('a', next.id, 'withdraw')
  assert.equal(store.get(owner, next.id, true).status, 'revoked')
  assert.equal(store.search(access, { includeInactive: true }).total, 0)
  assert.throws(() => store.publish(input({ expiresAt: 300, supersedes: original.id })), /supersedes/i)
  assert.equal(store.publish(input({ expiresAt: 400, supersedes: next.id })).revision, 3)
})
test('ACL and publisher root binding are applied before matching and totals, with snapshot readers', ready, t => {
  const { store } = fixture(t)
  const record = store.publish(input())
  assert.equal(store.search({ projectId: 'c', publisherIds: ['a'] }, { query: '中文' }).total, 0)
  assert.equal(store.search({ projectId: 'b', publisherIds: [] }, {}).total, 0)
  assert.equal(store.search({ ...access, publisherProjects: { a: 'wrong-root' } }, {}).total, 0)
  assert.equal(store.get({ ...access, publisherProjects: {} }, record.id), undefined)
  assert.equal(store.search({ ...access, publisherProjects: { a: 'root-a' } }, {}).total, 1)
  assert.equal(store.get(owner, record.id).id, record.id)
  const later = store.publish(input({ readers: ['b', 'c'], supersedes: record.id }))
  const newReader = { projectId: 'c', publisherIds: ['a'] }
  assert.equal(store.get(newReader, record.id, true), undefined)
  assert.equal(store.get(newReader, later.id).id, later.id)
})
test('revoked owner history redacts payload before search matching, topic filtering and totals', ready, t => {
  const { store } = fixture(t)
  const record = store.publish(input({ title: 'WITHDRAWN_TITLE', summary: 'WITHDRAWN_BODY', topics: ['withdrawn-topic'] }))
  store.revoke('a', record.id, 'withdraw')
  const history = store.get(owner, record.id, true)
  assert.equal(history.id, record.id)
  assert.equal(history.key, 'build')
  assert.equal(history.status, 'revoked')
  assert.equal(history.title, '')
  assert.equal(history.summary, '')
  assert.equal(history.applicability, '')
  assert.equal(history.sources.length, 0)
  assert.equal(history.topics.length, 0)
  assert.equal(store.search(owner, { includeInactive: true }).total, 1)
  assert.equal(store.search(owner, { includeInactive: true, query: 'WITHDRAWN_TITLE' }).total, 0)
  assert.equal(store.search(owner, { includeInactive: true, query: 'WITHDRAWN_BODY' }).total, 0)
  assert.equal(store.search(owner, { includeInactive: true, topic: 'withdrawn-topic' }).total, 0)
  assert.equal(store.search(owner, { includeInactive: true, query: 'build' }).total, 1)
})
test('reader project snapshots deny rebound reader IDs before matching/counting/get and survive restart', ready, t => {
  const { store, directory } = fixture(t)
  const oldRoot = 'd'.repeat(64), reboundRoot = 'e'.repeat(64)
  const publication = input({ readerProjects: { b: oldRoot } })
  const record = store.publish(publication)
  const bound = { ...access, readerProject: oldRoot }
  assert.equal(store.get(bound, record.id).id, record.id)
  assert.equal(new KnowledgeStore(directory, profile).search(bound, { query: '中文' }).total, 1)
  const rebound = { ...access, readerProject: reboundRoot }
  assert.equal(store.get(rebound, record.id), undefined)
  assert.equal(store.search(rebound, { query: '中文' }).total, 0)
  assert.equal(store.search(rebound, {}).items.length, 0)
  assert.equal(store.get({ ...owner, readerProject: reboundRoot }, record.id).id, record.id)
  assert.equal(store.publish(publication).id, record.id)
  assert.throws(() => store.publish(input({ readerProjects: { b: reboundRoot } })), /supersedes/i)
  const replacement = store.publish(input({ readerProjects: { b: reboundRoot }, supersedes: record.id }))
  assert.equal(store.get(rebound, replacement.id).id, replacement.id)
  assert.equal(store.get(bound, replacement.id), undefined)
})
test('reader binding requires valid exact snapshot keys and missing legacy snapshots fail closed when caller root is supplied', ready, t => {
  const { store } = fixture(t)
  const legacy = store.publish(input())
  assert.equal(store.get(access, legacy.id).id, legacy.id)
  assert.equal(store.get({ ...access, readerProject: 'd'.repeat(64) }, legacy.id), undefined)
  assert.equal(store.search({ ...access, readerProject: 'd'.repeat(64) }, {}).total, 0)
  for (const readerProjects of [{}, { b: 'invalid' }, { b: 'd'.repeat(64), c: 'e'.repeat(64) }, []]) {
    assert.throws(() => store.publish(input({ key: 'bad-snapshot', readerProjects })))
  }
  assert.equal(store.search(owner, {}).total, 1)
})
test('search supports Chinese substring AND, exact topic/publisher filters and bounded stable pages', ready, t => {
  const { store } = fixture(t)
  const first = store.publish(input())
  store.publish(input({ key: 'other', title: '中文运行', topics: ['runtime'] }))
  assert.equal(store.search(access, { query: '中文 offline' }).total, 2)
  assert.equal(store.search(access, { query: '构建 offline', topic: 'offline', publisher: 'a' }).items[0].id, first.id)
  assert.equal(store.search(access, { query: '中文 nonexistent' }).total, 0)
  const page = store.search(access, { limit: 1 })
  assert.equal(page.total, 2)
  assert.equal(page.nextOffset, 1)
  assert.equal(store.search(access, { offset: page.nextOffset, limit: 1 }).items.length, 1)
  assert.throws(() => store.search(access, { offset: -1 }), /offset/i)
})
test('validation rejects unknown/private fields, oversized values and malformed source metadata before writes', ready, t => {
  const { store } = fixture(t)
  for (const extra of [{ reasoning: 'private' }, { summary: 's'.repeat(4001) }, { key: 'x'.repeat(129) },
    { title: 't'.repeat(201) }, { applicability: 'a'.repeat(2001) }, { topics: Array(17).fill('x') },
    { topics: ['x'.repeat(129)] }, { sources: Array(5).fill(input().sources[0]) },
    { sources: [{ ...input().sources[0], quote: 'q'.repeat(2001), end: 2005 }] },
    { sources: [{ ...input().sources[0], end: 8 }] }, { sources: [{ ...input().sources[0], sourceVersion: 0 }] },
    { sources: [{ ...input().sources[0], privateCoT: 'secret' }] }, { expiresAt: NaN }]) {
    assert.throws(() => store.publish(input(extra)))
  }
  assert.equal(store.search(access, {}).total, 0)
})
test('tampered, truncated and invalid final records fail closed while abandoned temporary files are ignored', ready, t => {
  const { store, directory } = fixture(t)
  const record = store.publish(input())
  fs.writeFileSync(path.join(directory, 'abandoned.tmp'), '{')
  assert.equal(store.get(access, record.id).id, record.id)
  const file = jsonFiles(directory).find(file => fs.readFileSync(file, 'utf8').includes('中文构建'))
  const text = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, text.replace('中文构建', '篡改标题'))
  assert.throws(() => store.search(access, {}), /checksum|integrity/i)
  fs.writeFileSync(file, '{')
  assert.throws(() => store.get(access, record.id), /invalid|corrupt|integrity/i)
  fs.writeFileSync(file, text)
  assert.equal(store.get(access, record.id).status, 'current')
})
test('writer conflicts preserve the lock and fail closed even when its timestamp is stale', ready, t => {
  const { store, directory } = fixture(t)
  // Publicly documented store lock is deliberately never auto-stolen.
  const lock = path.join(directory, '.writer.lock')
  fs.writeFileSync(lock, JSON.stringify({ pid: 99999999, createdAt: 1 }))
  assert.throws(() => store.publish(input()), /lock/i)
  assert.ok(fs.existsSync(lock))
  fs.unlinkSync(lock)
  assert.equal(store.publish(input()).revision, 1)
})
test('Windows lock acquisition EPERM remains a visible bounded failure without changing data or retrying implicitly', ready, t => {
  let fail = false, attempts = 0
  const denied = Object.assign(new Error('injected Windows sharing or permission restriction'), { code: 'EPERM' })
  const Store = load({ openSync(file, ...args) {
    if (fail && path.basename(String(file)) === '.writer.lock') { attempts++; throw denied }
    return fs.openSync(file, ...args)
  } }, { ...process, platform: 'win32' })
  const { store, directory } = fixture(t, {}, Store), original = store.publish(input())
  const before = jsonFiles(directory).map(file => [file, fs.readFileSync(file, 'utf8')])
  fail = true
  assert.throws(() => store.publish(input({ summary: 'after a visible lock failure', supersedes: original.id })), error => {
    assert.match(error.message, /writer lock.*EPERM.*permission|writer lock.*EPERM.*sharing/i)
    assert.equal(error.code, 'EPERM')
    assert.equal(error.cause, denied)
    return true
  })
  assert.equal(attempts, 1, 'The product never retries or steals a lock automatically')
  assert.equal(fs.existsSync(path.join(directory, '.writer.lock')), false)
  assert.deepEqual(jsonFiles(directory).map(file => [file, fs.readFileSync(file, 'utf8')]), before)
  assert.equal(store.get(access, original.id).status, 'current')
  fail = false
  assert.equal(store.publish(input({ summary: 'after a visible lock failure', supersedes: original.id })).revision, 2)
})
test('failed fsync rolls back the new record, releases the lock and preserves the previous version', ready, t => {
  let fail = false, writes = 0
  const Store = load({ fsyncSync(fd) { if (fail && ++writes === 2) throw new Error('injected fsync failure'); fs.fsyncSync(fd) } })
  const { store, directory } = fixture(t, {}, Store)
  const record = store.publish(input())
  fail = true
  assert.throws(() => store.publish(input({ summary: 'replacement', supersedes: record.id })), /fsync/i)
  fail = false
  assert.equal(store.get(access, record.id).status, 'current')
  assert.equal(fs.existsSync(path.join(directory, '.writer.lock')), false)
  assert.equal(store.publish(input({ summary: 'replacement', supersedes: record.id })).revision, 2)
})
test('maxEntries rejects growth without preventing idempotent retries or revocation', ready, t => {
  const { store } = fixture(t, { maxEntries: 1 })
  const record = store.publish(input())
  assert.equal(store.publish(input()).id, record.id)
  assert.throws(() => store.publish(input({ key: 'overflow' })), /limit|entries/i)
  store.revoke('a', record.id, 'closed')
  assert.equal(store.get(owner, record.id, true).status, 'revoked')
})
test('a partially written temporary record never appears and retry appends the intended revision', ready, t => {
  let fail = false
  const Store = load({ writeFileSync(fd, data, encoding) {
    if (fail && typeof data === 'string' && data.includes('"type":"publication"')) {
      fs.writeFileSync(fd, data.slice(0, 19), encoding)
      throw new Error('injected partial disk write')
    }
    return fs.writeFileSync(fd, data, encoding)
  } })
  const { store, directory } = fixture(t, {}, Store)
  const original = store.publish(input())
  fail = true
  assert.throws(() => store.publish(input({ summary: 'new content', supersedes: original.id })), /partial disk write/i)
  fail = false
  const restored = new KnowledgeStore(directory, profile)
  assert.equal(restored.get(access, original.id).status, 'current')
  assert.equal(restored.publish(input({ summary: 'new content', supersedes: original.id })).revision, 2)
})
test('failed atomic rename keeps the prior publication and allows a clean retry', ready, t => {
  let fail = false
  const Store = load({ renameSync(from, to) { if (fail) throw new Error('injected rename failure'); return fs.renameSync(from, to) } })
  const { store } = fixture(t, {}, Store)
  const original = store.publish(input())
  fail = true
  assert.throws(() => store.publish(input({ summary: 'new content', supersedes: original.id })), /rename failure/i)
  fail = false
  assert.equal(store.get(access, original.id).status, 'current')
  assert.equal(store.publish(input({ summary: 'new content', supersedes: original.id })).revision, 2)
})

async function concurrentPublish(directory, publications) {
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const gate = new SharedArrayBuffer(4)
  const workers = publications.map(publication => new Worker(`
    const { workerData, parentPort } = require('node:worker_threads')
    const vm = require('node:vm'), exports = {}
    vm.runInNewContext(workerData.compiled, { exports, require, Buffer, process, structuredClone })
    const store = new exports.KnowledgeStore(workerData.directory, workerData.profile)
    parentPort.postMessage({ ready: true })
    Atomics.wait(new Int32Array(workerData.gate), 0, 0)
    for (let attempt = 0; attempt < 500; attempt++) {
      try { parentPort.postMessage({ record: store.publish(workerData.publication) }); break }
      catch (error) {
        if (!/writer lock/.test(error.message) || attempt === 499) { parentPort.postMessage({ error: error.message }); break }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
      }
    }
  `, { eval: true, workerData: { compiled, gate, directory, profile, publication } }))
  const results = workers.map(worker => new Promise((resolve, reject) => {
    worker.on('message', message => { if (!message.ready) resolve(message) })
    worker.on('error', reject)
    worker.on('exit', code => { if (code) reject(new Error(`worker exit ${code}`)) })
  }))
  await Promise.all(workers.map(worker => new Promise(resolve => worker.once('message', resolve))))
  Atomics.store(new Int32Array(gate), 0, 1)
  Atomics.notify(new Int32Array(gate), 0)
  return Promise.all(results)
}
test('concurrent writers deduplicate identical attempts and reject a stale replacement without losing the winner', ready, async t => {
  const { store, directory } = fixture(t)
  const repeated = await concurrentPublish(directory, Array.from({ length: 4 }, () => input()))
  assert.ok(repeated.every(result => result.record), JSON.stringify(repeated))
  assert.equal(new Set(repeated.map(result => result.record.id)).size, 1)
  assert.equal(store.search(owner, { includeInactive: true }).total, 1)
  const original = repeated[0].record
  const replacements = await concurrentPublish(directory, [
    input({ summary: 'winner A', supersedes: original.id }), input({ summary: 'winner B', supersedes: original.id }),
  ])
  assert.equal(replacements.filter(result => result.record).length, 1)
  assert.match(replacements.find(result => result.error).error, /supersedes/i)
  assert.equal(store.search(owner, { includeInactive: true }).total, 2)
  assert.equal(store.search(access, {}).items[0].revision, 2)
})
test('symlink storage components are rejected before nested directories are created', ready, t => {
  const { parent } = fixture(t)
  const target = path.join(parent, 'outside')
  fs.mkdirSync(target)
  const linked = path.join(parent, 'linked')
  try { fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS denies creating symlinks'); throw error }
  assert.throws(() => new KnowledgeStore(path.join(linked, 'nested'), profile), /symbolic|symlink/i)
  assert.equal(fs.existsSync(path.join(target, 'nested')), false)
})
test('abandoned temporary symlink paths fail closed rather than entering the ignored temporary-file class', ready, t => {
  const { parent, directory, store } = fixture(t)
  const target = path.join(parent, 'outside')
  fs.mkdirSync(target)
  try { fs.symlinkSync(target, path.join(directory, 'records', 'abandoned.tmp'), process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS denies creating symlinks'); throw error }
  assert.throws(() => store.search(access, {}), /symbolic|symlink/i)
})
test('symlink record files are rejected before reading their destination', ready, t => {
  const { parent, directory, store } = fixture(t)
  const target = path.join(parent, 'outside')
  fs.mkdirSync(target)
  const linked = path.join(parent, 'linked')
  try { fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS denies creating symlinks'); throw error }
  assert.throws(() => new KnowledgeStore(path.join(linked, 'nested'), profile), /symbolic|symlink/i)
  const record = store.publish(input())
  const file = jsonFiles(directory).find(file => fs.readFileSync(file, 'utf8').includes(record.id))
  const moved = path.join(target, 'moved.json')
  fs.renameSync(file, moved)
  try { fs.symlinkSync(moved, file, 'file') }
  catch (error) { if (error.code === 'EPERM') return t.skip('OS denies creating file symlinks'); throw error }
  assert.throws(() => store.get(access, record.id), /symbolic|symlink/i)
})
