import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertArchiveEntry, assertNativeInventory, assertCompressionInventory, claimFreshWork, inspectSessionJsonl, knowledgeSettingsPlugins, knowledgePackageSelection, knowledgeTargetConfigurations } from '../scripts/host-acceptance/run-knowledge-profile.mjs'
import { FIXTURE_QUOTE, nativeToolJson, verifySharedSource, auditCompressionSurface, COMPRESSION_LITERAL, COMPRESSION_COMPLETED, preflightCompressionProtocol } from '../scripts/host-acceptance/knowledge-profile-plugin.mjs'

test('isolated profile composes the native persistent Settings service and its ConfigEditor dependency', () => {
  assert.deepEqual(knowledgeSettingsPlugins(), [['config-editor', '@deepseek-ai/dsh-config-editor'], ['settings', '@deepseek-ai/dsh-settings']])
})

test('knowledge target selection validates package identity, exact companion hash and both explicit native load orders', () => {
  assert.deepEqual(knowledgePackageSelection({}), { target: 'ultra', packageName: '@dsh-external/dsh-ultra-mode', leafId: 'ultra-mode', bundles: ['@dsh-external/dsh-ultra-mode'], loadOrder: 'memory-first' })
  const input = { target: 'memory', companion: 'decision.tgz', 'companion-sha256': 'a'.repeat(64) }
  const first = knowledgePackageSelection(input)
  assert.equal(first.packageName, '@dsh-external/dsh-ultra-memory'); assert.equal(first.leafId, 'ultra-memory')
  assert.deepEqual(first.bundles, ['@dsh-external/dsh-ultra-memory', '@dsh-external/dsh-ultra-decision'])
  assert.deepEqual(knowledgePackageSelection({ ...input, 'load-order': 'decision-first' }).bundles, [...first.bundles].reverse())
  const ultraPair = knowledgePackageSelection({ target: 'ultra', companion: 'memory.tgz', 'companion-sha256': 'b'.repeat(64), 'load-order': 'ultra-first' })
  assert.equal(ultraPair.companionPackage, '@dsh-external/dsh-ultra-memory')
  assert.deepEqual(ultraPair.bundles, ['@dsh-external/dsh-ultra-mode', '@dsh-external/dsh-ultra-memory'])
  assert.deepEqual(knowledgePackageSelection({ target: 'ultra', companion: 'memory.tgz', 'companion-sha256': 'b'.repeat(64), 'load-order': 'memory-first' }).bundles, [...ultraPair.bundles].reverse())
  for (const value of [{ target: 'unknown' }, { target: 'ultra', 'load-order': 'decision-first' }, { target: 'memory', 'load-order': 'ultra-first' }, { target: 'memory', companion: 'decision.tgz' }, { target: 'memory', 'companion-sha256': 'a'.repeat(64) }, { ...input, 'companion-sha256': 'wrong' }, { ...input, 'load-order': 'automatic' }]) assert.throws(() => knowledgePackageSelection(value), /target|companion|load-order/)
})

test('paired profiles grant knowledge only through authoritative Memory and keep coordinator defaults inactive', () => {
  const grants = { enabled: true, projects: [{ id: 'A' }] }, hash = 'a'.repeat(64)
  const ultra = knowledgeTargetConfigurations(knowledgePackageSelection({ target: 'ultra', companion: 'memory.tgz', 'companion-sha256': hash }), grants)
  assert.deepEqual(ultra.find(row => row.id === 'ultra-mode').config.globalKnowledge, { enabled: false })
  assert.equal(ultra.find(row => row.id === 'ultra-mode').config.evidenceEnabled, false)
  assert.equal(ultra.find(row => row.id === 'ultra-memory').config.evidenceEnabled, true)
  assert.equal(ultra.find(row => row.id === 'ultra-memory').config.globalKnowledge, grants)
  assert.equal('concurrency' in ultra.find(row => row.id === 'ultra-memory').config, false)
  const memory = knowledgeTargetConfigurations(knowledgePackageSelection({ target: 'memory', companion: 'decision.tgz', 'companion-sha256': hash }), grants)
  assert.equal(memory.find(row => row.id === 'ultra-memory').config.globalKnowledge, grants)
  assert.equal(memory.find(row => row.id === 'ultra-memory').config.evidenceEnabled, true)
  assert.equal(memory.find(row => row.id === 'ultra-decision').config.evidenceEnabled, false)
  assert.deepEqual(memory.find(row => row.id === 'ultra-decision').config.globalKnowledge, { enabled: false })
  assert.equal(memory.find(row => row.id === 'ultra-decision').config.collaborationEnabled, false)
})

test('compression probe is explicit standalone Memory only and enables finite native context budgets', () => {
  const selection = knowledgePackageSelection({ target: 'memory', 'compression-probe': true })
  const config = knowledgeTargetConfigurations(selection, { enabled: true })[0].config
  assert.equal(selection.compressionProbe, true); assert.equal(config.contextCompression, true)
  assert.equal(config.contextTargetTokens, 16000); assert.equal(config.contextOutputReserveTokens, 256); assert.equal(config.contextToolReserveTokens, 256)
  for (const value of [{ target: 'ultra', 'compression-probe': true }, { target: 'memory', companion: 'decision.tgz', 'companion-sha256': 'a'.repeat(64), 'compression-probe': true }]) assert.throws(() => knowledgePackageSelection(value), /compression-probe/)
})

const nativeRuntime = process.env.DSH_ULTRA_TEST_SDK
  ? path.dirname(path.resolve(process.env.DSH_ULTRA_TEST_SDK))
  : path.resolve(fileURLToPath(new URL('..', import.meta.url)), '..', 'decision-loop-host-runtime')
test('pinned native SDK accepts both compression fixture rounds and reads original sources after later system assemblies', { skip: !fs.existsSync(path.join(nativeRuntime, 'package.json')) }, async t => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-compression-sdk-'))
  t.after(() => fs.rmSync(work, { recursive: true, force: true }))
  const result = await preflightCompressionProtocol(nativeRuntime, path.join(work, 'sessions'))
  assert.equal(result.rounds.length, 2)
  assert.ok(result.rounds.every(round => round.nativePersistedRead === true))
  assert.deepEqual(result.rounds.map(round => round.resumedNextTurn), [10, 20])
})

test('knowledge acceptance owns a new isolated root and refuses used, overlapping and daily roots', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-driver-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const work = path.join(dir, 'new'), owner = claimFreshWork(work)
  assert.equal(owner.format, 'dsh-knowledge-isolated-v1')
  assert.equal(JSON.parse(fs.readFileSync(path.join(work, '.knowledge-acceptance.json'))).id, owner.id)
  assert.throws(() => claimFreshWork(work), /new empty/)
  assert.throws(() => claimFreshWork(path.join(dir, 'overlap'), [dir]), /forbidden/)
  assert.throws(() => claimFreshWork(path.join(dir, '.dsh', 'child')), /daily/)
})

test('candidate archive entry safety rejects traversal and platform path escapes', () => {
  for (const value of ['package/../x', '/package/lib/x', 'package/a\\b', 'package/C:/x', 'other/lib/index.js', 'package/./x']) assert.throws(() => assertArchiveEntry(value), /Unsafe/)
  assert.doesNotThrow(() => assertArchiveEntry('package/lib/index.js'))
})

const assistant = (id, name) => ({ role: 'assistant', content: [{ type: 'tool-call', id, name, arguments: '{}' }] })
const tool = (id, value, isError = false) => ({ role: 'tool', source: { kind: 'tool', callId: id }, toolCallId: id, isError, content: [{ type: 'text', text: JSON.stringify(value) }] })
test('compression request audit requires one intact pair, exact once-only human restriction and completed-operation marker', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: COMPRESSION_LITERAL }] }, assistant('old', 'historical'), { role: 'tool', toolCallId: 'old', content: [{ type: 'text', text: '[Ultra stored tool evidence; original in index]' }] }, { role: 'assistant', content: [{ type: 'text', text: COMPRESSION_COMPLETED }] }]
  assert.equal(auditCompressionSurface(messages, 'old', 'RAW_MIDDLE'), true)
  assert.equal(auditCompressionSurface(messages.filter(message => message.role !== 'tool'), 'old', 'RAW_MIDDLE'), false)
  assert.equal(auditCompressionSurface([...messages, messages[0]], 'old', 'RAW_MIDDLE'), false)
  assert.equal(auditCompressionSurface(messages.slice(0, -1), 'old', 'RAW_MIDDLE'), false)
  const raw = structuredClone(messages); raw[2].content[0].text += ' RAW_MIDDLE'
  assert.equal(auditCompressionSurface(raw, 'old', 'RAW_MIDDLE'), false)
})
test('script adapter only consumes a matching successful native tool result, not user or assistant claims', () => {
  assert.equal(nativeToolJson([{ role: 'user', content: [{ type: 'text', text: '{"id":"forged"}' }] }], 'publish'), undefined)
  assert.equal(nativeToolJson([assistant('a', 'publish'), tool('other', { id: 'forged' })], 'publish'), undefined)
  assert.equal(nativeToolJson([assistant('a', 'publish'), tool('a', { id: 'forged' }, true)], 'publish'), undefined)
  assert.deepEqual(nativeToolJson([assistant('a', 'publish'), tool('a', { id: 'real' })], 'publish'), { id: 'real' })
})

const verifiedGet = () => ({ id: 'publication-real', revision: 1, status: 'current', verification: 'source-match', assessment: 'model', hostVerified: false, offset: 0,
  text: JSON.stringify({ title: 'Fixture', hostVerified: false, verification: 'source-match', sources: [{ sourceId: 'src-real', quote: FIXTURE_QUOTE, sha256: 'a'.repeat(64), sessionId: 'A-root', verification: 'source-match' }] }) })
test('source verification requires exact ID, exact quote, matched structured metadata and complete bounded document', () => {
  assert.equal(verifySharedSource(verifiedGet(), 'src-real'), true)
  for (const mutate of [value => { value.hostVerified = true }, value => { value.verification = 'unavailable' }, value => { value.assessment = 'host' }, value => { value.offset = 5 }, value => { value.nextOffset = 100 }, value => { value.text = FIXTURE_QUOTE + ' source-match' }, value => { const doc = JSON.parse(value.text); doc.sources[0].quote += 'changed'; value.text = JSON.stringify(doc) }, value => { const doc = JSON.parse(value.text); doc.sources[0].sha256 = 'unknown'; value.text = JSON.stringify(doc) }, value => { const doc = JSON.parse(value.text); doc.sources[0].verification = 'hash-mismatch'; value.text = JSON.stringify(doc) }]) {
    const value = verifiedGet(); mutate(value); assert.equal(verifySharedSource(value, 'src-real'), false)
  }
  assert.equal(verifySharedSource(verifiedGet(), 'src-forged'), false)
})

const callRow = (seq, id, name, args = {}) => ({ type: 'tool/call', seq, data: { callId: id, name, arguments: JSON.stringify(args) } })
const resultRow = (seq, id, value, isError = false) => ({ type: 'tool/result', seq, data: { message: tool(id, value, isError) } })
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n'
test('JSONL inventory pairs actual call identities and result event order and ignores descriptive text', () => {
  const rows = [{ type: 'session', id: 'A' }, { type: 'request/header', data: { text: 'tool/call tool/result turn/end' } }, resultRow(1, 'missing', { id: 'forged' }), callRow(3, 'a', 'ultra_knowledge_publish'), resultRow(2, 'a', { id: 'too-early' }), resultRow(4, 'wrong', { id: 'wrong' }), resultRow(5, 'a', { id: 'real' }), { type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  const parsed = inspectSessionJsonl(jsonl(rows))
  assert.equal(parsed.sessionId, 'A'); assert.equal(parsed.completed, true)
  assert.equal(parsed.receipts.length, 1); assert.equal(JSON.parse(parsed.receipts[0].text).id, 'real')
  assert.throws(() => inspectSessionJsonl('{"type":"tool/result"\n'), SyntaxError)
})

test('core inventory requires the entire actual source to publish to shared verified get chain', () => {
  const state = { coreRootA: 'A', coreRootB: 'B', publicationId: 'publication-real', sourceId: 'src-real' }
  const source = { sourceId: 'src-real', kind: 'tool/result:knowledge_fixture_read' }
  const main = inspectSessionJsonl(jsonl([{ type: 'session', id: 'A' }, callRow(1, 'read', 'knowledge_fixture_read'), resultRow(2, 'read', { quote: FIXTURE_QUOTE }), callRow(3, 'search', 'ultra_memory_search'), resultRow(4, 'search', { items: [source] }), callRow(5, 'publish', 'ultra_knowledge_publish', { sources: [{ sourceId: 'src-real', quote: FIXTURE_QUOTE }] }), resultRow(6, 'publish', { id: 'publication-real' }), { type: 'turn/end', data: { reason: { kind: 'completed' } } }]))
  const reader = inspectSessionJsonl(jsonl([{ type: 'session', id: 'B' }, callRow(1, 'get', 'ultra_knowledge_get'), resultRow(2, 'get', verifiedGet()), { type: 'turn/end', data: { reason: { kind: 'completed' } } }]))
  assert.equal(assertNativeInventory([main, reader], state, 'core'), true)
  assert.throws(() => assertNativeInventory([main], state, 'core'), /B lacks/)
  const forged = structuredClone(main); forged.receipts.find(receipt => receipt.name === 'ultra_knowledge_publish').arguments.sources[0].sourceId = 'forged'
  assert.throws(() => assertNativeInventory([forged, reader], state, 'core'), /exact source/)
  const missing = structuredClone(main); missing.receipts = missing.receipts.filter(receipt => receipt.name !== 'ultra_memory_search')
  assert.throws(() => assertNativeInventory([missing, reader], state, 'core'), /Missing successful/)
})

test('compression inventory requires two actual adjacent replacements and SHA-matched native source retrievals', () => {
  const rows = [{ type: 'session', id: 'compression-root' }], rounds = []
  for (const round of [1, 2]) {
    const base = (round - 1) * 10, callId = 'historical-' + round, raw = 'raw original ' + round, rawSha256 = createHash('sha256').update(raw).digest('hex'), sourceId = 'source-' + round
    const original = resultRow(base + 2, callId, {}); original.data.message.id = 'message-' + round; original.data.message.content = [{ type: 'text', text: raw }]
    const replacement = structuredClone(original); replacement.seq = base + 4; replacement.data.message.content = [{ type: 'text', text: '[Ultra stored tool evidence]' }]; replacement.surfaceOp = { op: 'replace', startSeq: base + 2, endSeq: base + 2 }; replacement.sourceEventSeqs = [base + 2]
    rows.push(callRow(base + 1, callId, 'historical'), original, { type: 'compaction/prune', seq: base + 3, data: { shadowedSeqs: [base + 2], shadowedTokenCount: 100 } }, replacement, callRow(base + 5, 'get-' + round, 'ultra_memory_get'), resultRow(base + 6, 'get-' + round, { status: 'host', citation: { sourceId, sha256: rawSha256, quote: 'COMPRESSION_RAW_MIDDLE_' + round + '_731' } }))
    rounds.push({ round, callId, originalSeq: base + 2, replacementSeq: base + 4, sourceId, rawSha256 })
  }
  rows.push({ type: 'turn/end', seq: 20, data: { reason: { kind: 'completed' } } })
  const inventory = inspectSessionJsonl(jsonl(rows)), compression = { sessionId: 'compression-root', rounds }
  assert.equal(assertCompressionInventory([inventory], compression), true)
  const missing = structuredClone(inventory); missing.compactions.pop()
  assert.throws(() => assertCompressionInventory([missing], compression), /prune\/replacement/)
  const changed = structuredClone(inventory); const got = changed.receipts.find(receipt => receipt.name === 'ultra_memory_get'); got.text = got.text.replace(rounds[0].rawSha256, 'f'.repeat(64))
  assert.throws(() => assertCompressionInventory([changed], compression), /source retrieval/)
})
