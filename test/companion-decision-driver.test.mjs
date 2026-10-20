import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import ts from 'typescript'
import { claimFreshWork, inspectSessionJsonl, assertDecisionManifest, assertCompanionInventory, companionSettingsPlugins } from '../scripts/host-acceptance/run-companion-decision-profile.mjs'
import { auditAssistRequests, companionPoolConfig, hasNativeTeamCatalog, companionTeamStep } from '../scripts/host-acceptance/companion-decision-plugin.mjs'
import * as companionDriver from '../scripts/host-acceptance/companion-decision-plugin.mjs'
import { DecisionGovernance } from '../lib/decision-governance.js'
import { readModelPool, modelPoolCatalog } from '../lib/model-pool.js'
import { EvidenceStore } from '../lib/evidence.js'

const permissionReceiptText = '{"permissionSentinel":true,"scopeExpanded":false}'
const permissionReceiptSha = createHash('sha256').update(permissionReceiptText).digest('hex')

test('saved native companion candidates exclude grading-only route fields', () => {
  const value = companionPoolConfig([{ id: 'code', kind: 'code', provider: 'companion-code', model: 'scripted-code', reasoningEffort: 'high', maxTokens: 256 }, { id: 'review', kind: 'review', provider: 'companion-review', model: 'scripted-review', reasoningEffort: 'low', maxTokens: 384 }], 'code')
  const parsed = readModelPool(value)
  assert.equal(parsed.explicitModelId, 'code')
  assert.equal(parsed.models[0].provider, 'companion-code')
  assert.equal(parsed.models[0].maxTokens, 256)
  assert.equal(parsed.models[1].isDefault, true)
  assert.equal(Object.hasOwn(value.models[0], 'kind'), false)
  assert.equal(hasNativeTeamCatalog({ tools: ['ultra_spawn_agent', 'ultra_send_message', 'ultra_followup_task', 'ultra_wait_agent', 'ultra_interrupt_agent', 'ultra_list_agents'], text: modelPoolCatalog({ get: () => parsed }) }, ['code', 'review']), true)
})

test('Team script consumes matching native typed JSON receipts and targets only the spawned child', () => {
  const messages = [], plan = { kind: 'code' }, challenge = { id: 'fixture-code' }
  const add = (name, value, index) => messages.push({ role: 'assistant', content: [{ type: 'tool-call', id: 'call-' + index, name, arguments: '{}' }] }, { role: 'tool', toolCallId: 'call-' + index, isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] })
  assert.equal(companionTeamStep(messages, plan, challenge).toolName, 'ultra_spawn_agent')
  add('ultra_spawn_agent', { id: 'actual-child', status: 'running' }, 1)
  assert.deepEqual(companionTeamStep(messages, plan, challenge), { toolName: 'ultra_wait_agent', args: { targets: ['actual-child'], timeout_ms: 5000 }, childId: 'actual-child' })
  add('ultra_wait_agent', { cursor: 'native:1', agents: [{ id: 'unrelated', status: 'completed', text: 'foreign' }] }, 2)
  assert.equal(companionTeamStep(messages, plan, challenge).toolName, 'ultra_wait_agent')
  add('ultra_wait_agent', { cursor: 'native:2', agents: [{ id: 'actual-child', status: 'completed', text: '{"answer":7}' }] }, 3)
  assert.deepEqual(companionTeamStep(messages, plan, challenge), { text: '{"answer":7}', childId: 'actual-child', status: 'completed' })
  add('ultra_spawn_agent', 'Native admission failure', 4); messages.at(-1).isError = true
  assert.throws(() => companionTeamStep(messages, plan, challenge), /Native Team tool failed/)
})

test('native compact Team catalog proves selectable IDs without requiring private provider identifiers', () => {
  const request = { tools: ['ultra_spawn_agent', 'ultra_send_message', 'ultra_followup_task', 'ultra_wait_agent', 'ultra_interrupt_agent', 'ultra_list_agents'], text: 'Native compact catalog\n{"fixedByUser":"code","models":[{"id":"code","strengths":"computation"},{"id":"review","strengths":"review"}]}\nUser task' }
  assert.equal(hasNativeTeamCatalog(request, ['code', 'review']), true)
  assert.equal(hasNativeTeamCatalog({ ...request, tools: request.tools.slice(1) }, ['code', 'review']), false)
  assert.equal(hasNativeTeamCatalog(request, ['code', 'missing']), false)
  assert.equal(hasNativeTeamCatalog({ ...request, text: 'The model claims code and review are configured' }, ['code', 'review']), false)
})

test('Decision companion runner refuses reused and daily profile roots', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-driver-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.equal(claimFreshWork(path.join(root, 'fresh')).format, 'dsh-companion-decision-isolated-v1')
  assert.throws(() => claimFreshWork(path.join(root, 'fresh')), /new empty/)
  assert.throws(() => claimFreshWork(path.join(root, '.dsh', 'fresh')), /daily/)
  assert.throws(() => claimFreshWork(path.join(root, 'nested'), [root]), /forbidden/)
})

test('Decision runner accepts only the exact independent self contained package identity', () => {
  const good = { name: '@dsh-external/dsh-ultra-decision', version: '0.1.0-dev.1', main: './lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }
  assert.doesNotThrow(() => assertDecisionManifest(good))
  assert.doesNotThrow(() => assertDecisionManifest({ ...good, version: '0.1.0-dev.2' }))
  assert.doesNotThrow(() => assertDecisionManifest({ ...good, version: '0.1.0' }))
  for (const manifest of [{ ...good, name: '@dsh-external/dsh-ultra-mode' }, { ...good, version: '0.1.1' }, { ...good, main: '../root/lib/index.js' }, { ...good, dependencies: { '@dsh-external/dsh-ultra-mode': '*' } }, { ...good, dependencies: { other: 'file:../../other' } }]) assert.throws(() => assertDecisionManifest(manifest), /Decision|self contained/)
  assert.deepEqual(companionSettingsPlugins(), [['config-editor', '@deepseek-ai/dsh-config-editor'], ['settings', '@deepseek-ai/dsh-settings']])
})

const call = { seq: 1, type: 'tool/call', data: { callId: 'read-1', name: 'fixture_read', arguments: '{"id":"fixture-a"}' } }
const receipt = { seq: 2, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'read-1', source: { kind: 'tool', callId: 'read-1' }, isError: false, content: [{ type: 'text', text: '{"fixtureId":"fixture-a","nonce":"native-nonce","answer":7}' }] } } }
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n'
test('native receipt parser rejects quoted claims and unmatched or out of order native results', () => {
  const rows = [{ type: 'session', id: 'child' }, call, receipt, { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  const parsed = inspectSessionJsonl(jsonl(rows))
  assert.equal(parsed.sessionId, 'child'); assert.equal(parsed.receipts.length, 1); assert.equal(parsed.completed, true)
  for (const bad of [{ ...receipt, seq: 0 }, { ...receipt, data: { message: { ...receipt.data.message, toolCallId: 'unmatched' } } }, { ...receipt, data: { message: { ...receipt.data.message, source: { kind: 'user', callId: 'read-1' } } } }]) assert.equal(inspectSessionJsonl(jsonl([call, bad])).receipts.length, 0)
  assert.equal(inspectSessionJsonl('{"type":"assistant/message","data":{"text":"tool/result"}}\n').receipts.length, 0)
  assert.throws(() => inspectSessionJsonl('{broken\n'), SyntaxError)
})

test('assist audit requires real main and sidecar identities and forbids tool permission expansion', () => {
  const main = { sessionId: 'main', stage: 'assist-main', provider: 'companion-main', model: 'scripted-main', reasoningEffort: 'medium', tools: ['fixture_read', 'write'] }
  const side = { sessionId: 'sidecar', stage: 'assist-decision', provider: 'companion-main', model: 'scripted-main', reasoningEffort: 'max', tools: ['fixture_read', 'ultra_memory_search'] }
  const args = { requests: [main, side], rootId: 'main', mainProvider: 'companion-main', mainModel: 'scripted-main', allowedSidecarTools: ['fixture_read', 'ultra_memory_search'] }
  assert.equal(auditAssistRequests(args).passed, true)
  for (const requests of [[main], [main, { ...side, sessionId: 'main' }], [{ ...main, model: 'rewritten' }, side], [main, { ...side, tools: ['write'] }], [main, { ...side, tools: ['ultra_spawn_agent'] }], [main, side, { ...side, sessionId: 'another-sidecar' }]]) assert.equal(auditAssistRequests({ ...args, requests }).passed, false)
})

test('standalone governance script obtains actual read/search/get receipts before emitting intent, diagnosis and three-state acceptance', () => {
  assert.equal(typeof companionDriver.companionGovernanceStep, 'function')
  const governance = new DecisionGovernance(companionDriver.COMPANION_GOVERNANCE_TASK, 'src_task')
  const prompt = '主 Agent 的真实会话 ID：main\n' + governance.coordinationProtocol() + '\n' + governance.intentInstruction()
  const messages = [{ role: 'user', source: { kind: 'ultra-route-task', summary: 'Ultra decision assist' }, content: [{ type: 'text', text: prompt }] }]
  const add = (name, value) => {
    const id = 'governance-' + messages.length
    messages.push({ role: 'assistant', content: [{ type: 'tool-call', id, name, arguments: '{}' }] },
      { role: 'tool', toolCallId: id, isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] })
  }
  assert.deepEqual(companionDriver.companionGovernanceStep(messages), { toolName: 'fixture_read', args: { id: 'assist' } })
  add('fixture_read', { fixtureId: 'assist', nonce: 'native-assist-731' })
  assert.equal(companionDriver.companionGovernanceStep(messages).toolName, 'ultra_memory_search')
  add('ultra_memory_search', { items: [{ sourceId: 'src_write', sessionId: 'main', kind: 'tool/result:write', excerpt: permissionReceiptText }] })
  const read = companionDriver.companionGovernanceStep(messages)
  assert.deepEqual(read, { toolName: 'ultra_memory_get', args: { id: 'src_write', quote: permissionReceiptText, maxChars: 4000 } })
  // Actual quote reads return only the requested quote, not extra source text.
  const original = { status: 'host', text: read.args.quote, offset: 0, sourceIds: ['src_write'], citation: { sourceId: 'src_write', quote: read.args.quote, start: 0, end: read.args.quote.length, sha256: permissionReceiptSha } }
  add('ultra_memory_get', original)
  const action = companionDriver.companionGovernanceStep(messages)
  assert.equal(action.rootId, 'main')
  const response = JSON.parse(action.text)
  assert.ok(response.intent.constraints[0].quote.includes('不联网'))
  assert.equal(response.directives[0].targetRouteId, 'main')
  assert.ok(response.directives[0].instruction.includes(companionDriver.COMPANION_GOVERNANCE_REDIRECT))
  governance.recordProgress({ sessionId: 'main', kind: 'tool', text: 'Actual permission fixture', sequence: 1, at: 1, evidenceIds: ['src_write'] })
  let delivery
  const accepted = governance.coordinate(action.text, new Set(['main']), (_target, _text, meta) => { delivery = meta; return true })
  assert.equal(accepted.directives.length, 1)
  delivery.onDelivery('admitted', 'native-feedback')
  delivery.onDelivery('request-visible', 'native-feedback')
  const final = governance.snapshot()
  assert.equal(final.diagnostics[0].wasRequestVisible, true)
  assert.deepEqual(new Set(final.verification.criteria.map(item => item.status)), new Set(['satisfied', 'failed', 'unverified']))
  assert.equal(final.verification.allSatisfied, false)
  assert.equal(final.verification.hostVerified, false)
  assert.equal(final.contract.originalTask, companionDriver.COMPANION_GOVERNANCE_TASK)
  for (const mutate of [
    value => { value.sourceIds = ['foreign']; value.citation.sourceId = 'foreign' },
    value => { value.text = value.citation.quote = '"permissionSentinel":true'; value.offset = value.citation.start = 1; value.citation.end = 26 },
    value => { value.citation.sha256 = 'f'.repeat(64) },
    value => { value.citation.end-- },
    value => { value.citation.start = value.offset = 1 },
    value => { value.text = '"permissionSentinel":true' },
  ]) {
    const bad = structuredClone(messages), value = structuredClone(original); mutate(value)
    bad.at(-1).content[0].text = JSON.stringify(value)
    assert.throws(() => companionDriver.companionGovernanceStep(bad), /source|receipt/i)
  }
})

test('standalone governance audit refuses enable flags or script claims without native lifecycle evidence', () => {
  assert.equal(typeof companionDriver.auditCompanionGovernance, 'function')
  assert.equal(companionDriver.auditCompanionGovernance({ rootId: 'main', requests: [], sessions: [], sourceRecords: [], deliveries: [] }).passed, false)
})

test('governance script consumes the real persistent search/get quote shape without borrowing unrequested text', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-governance-quote-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const access = { projectId: 'governance-project', sessionIds: ['native-main'] }, store = new EvidenceStore(directory)
  const source = store.capture({ projectId: access.projectId, runId: 'governance-run', sessionId: 'native-main', routeId: 'main', eventId: 'write-result',
    seq: 3, at: 1, kind: 'tool/result:write', text: permissionReceiptText, origin: { tool: 'write', callId: 'native-write' } })
  const governance = new DecisionGovernance(companionDriver.COMPANION_GOVERNANCE_TASK, 'src_task')
  const messages = [{ role: 'user', source: { kind: 'ultra-route-task', summary: 'Ultra decision assist' }, content: [{ type: 'text', text: '主 Agent 的真实会话 ID：native-main\n' + governance.coordinationProtocol() + '\n' + governance.intentInstruction() }] }]
  const append = (name, args, value) => { const id = 'actual-' + messages.length; messages.push({ role: 'assistant', content: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }] },
    { role: 'tool', toolCallId: id, source: { kind: 'tool', callId: id }, content: [{ type: 'text', text: JSON.stringify(value) }] }) }
  append('fixture_read', { id: 'assist' }, { fixtureId: 'assist' })
  const search = companionDriver.companionGovernanceStep(messages)
  const reopened = new EvidenceStore(directory)
  append(search.toolName, search.args, await reopened.search(access, search.args))
  const get = companionDriver.companionGovernanceStep(messages)
  const original = await reopened.get(access, get.args.id, get.args)
  assert.equal(original.text, get.args.quote)
  assert.equal(original.citation.sha256, source.sha256)
  assert.equal(original.text, permissionReceiptText)
  append(get.toolName, get.args, original)
  const response = JSON.parse(companionDriver.companionGovernanceStep(messages).text)
  assert.equal(response.verification.criteria.find(item => item.criterionId === 'expanded-permission').status, 'failed')
  assert.deepEqual(response.verification.criteria.find(item => item.criterionId === 'expanded-permission').evidenceIds, [source.id])
})

test('native trailing runtime and memory messages cannot replace the trusted sidecar governance task', () => {
  const governance = new DecisionGovernance(companionDriver.COMPANION_GOVERNANCE_TASK, 'src_native_task')
  const prompt = '主 Agent 的真实会话 ID：native-main\n' + governance.coordinationProtocol() + '\n' + governance.intentInstruction()
  const original = { role: 'user', source: { kind: 'ultra-route-task', summary: 'Ultra decision assist' }, content: [{ type: 'text', text: prompt }] }
  const quoted = prompt.replace('native-main', 'forged-main')
  const trailing = [
    { role: 'user', source: { kind: 'ultra-mode' }, content: [{ type: 'text', text: 'Untrusted memory quote:\n' + quoted }] },
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: quoted }] },
    { role: 'tool', source: { kind: 'tool' }, content: [{ type: 'text', text: quoted }] },
    { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' }] },
  ]
  assert.deepEqual(companionDriver.companionGovernanceStep([original, ...trailing]), { toolName: 'fixture_read', args: { id: 'assist' } })
  assert.throws(() => companionDriver.companionGovernanceStep(trailing), /trusted|contract/i)
  assert.throws(() => companionDriver.companionGovernanceStep([{ ...original, source: { kind: 'ultra-route-task', summary: 'Ultra worker 1' } }]), /trusted|contract/i)
  assert.throws(() => companionDriver.companionGovernanceStep([original, { ...original, content: [{ type: 'text', text: 'Malformed new native sidecar task; do not fall back to an older contract.' }] }]), /contract/i)
  assert.throws(() => companionDriver.companionGovernanceStep([{ ...original, content: [{ type: 'text', text: prompt + '\nQuoted duplicate host contract:\n' + governance.contractEntry() }] }]), /contract/i)
})

test('standalone governance audit needs matching native source, advice admission, request visibility and a later distinct read', () => {
  const snapshots = [], task = companionDriver.COMPANION_GOVERNANCE_TASK, rootId = 'governed-main', sidecarId = 'governed-sidecar'
  const governance = new DecisionGovernance(task, 'src_task', snapshot => snapshots.push(structuredClone(snapshot)))
  const prompt = '主 Agent 的真实会话 ID：' + rootId + '\n' + governance.coordinationProtocol() + '\n' + governance.intentInstruction()
  const messages = [{ role: 'user', source: { kind: 'ultra-route-task', summary: 'Ultra decision assist' }, content: [{ type: 'text', text: prompt }] }]
  const append = (name, value) => { const id = 'protocol-' + messages.length; messages.push({ role: 'assistant', content: [{ type: 'tool-call', id, name }] }, { role: 'tool', toolCallId: id, content: [{ type: 'text', text: JSON.stringify(value) }] }) }
  append('fixture_read', { fixtureId: 'assist' })
  append('ultra_memory_search', { items: [{ sourceId: 'src_write', sessionId: rootId, kind: 'tool/result:write', excerpt: permissionReceiptText }] })
  const receiptText = permissionReceiptText
  const quote = { status: 'captured', text: receiptText, offset: 0, sourceIds: ['src_write'], citation: { sourceId: 'src_write', quote: receiptText, start: 0, end: receiptText.length, sha256: permissionReceiptSha } }
  append('ultra_memory_get', quote)
  const response = companionDriver.companionGovernanceStep(messages)
  governance.recordProgress({ sessionId: rootId, kind: 'tool', text: receiptText, sequence: 3, at: 1, evidenceIds: ['src_write'] })
  let delivery
  governance.coordinate(response.text, new Set([rootId]), (_id, _text, meta) => { delivery = meta; return true })
  delivery.onDelivery('admitted', 'feedback-1'); delivery.onDelivery('request-visible', 'feedback-1'); governance.close()
  const tool = (name, args, text, seq, callId) => [{ seq, type: 'tool/call', data: { name, callId, arguments: JSON.stringify(args) } },
    { seq: seq + 1, type: 'tool/result', data: { message: { role: 'tool', toolCallId: callId, source: { kind: 'tool', callId }, content: [{ type: 'text', text }] } } }]
  const observation = { rootId,
    requests: [{ sequence: 1, sessionId: sidecarId, stage: 'assist-decision', text: prompt },
      { sequence: 2, sessionId: rootId, stage: 'assist-main', text: companionDriver.COMPANION_GOVERNANCE_REDIRECT, messageIds: ['feedback-1'], nativeBoundary: 9 }],
    sessions: [{ id: rootId, events: [{ seq: 0, type: 'user/message', data: { id: 'original-task', source: { kind: 'user' }, content: [{ type: 'text', text: task }] } }, ...tool('write', {}, receiptText, 2, 'write-1'),
      { seq: 8, type: 'user/message', data: { id: 'feedback-1', source: { kind: 'ultra-assist' }, content: [{ type: 'text', text: companionDriver.COMPANION_GOVERNANCE_REDIRECT }] } },
      ...tool('fixture_read', { id: 'assist-verify' }, '{"fixtureId":"assist-verify","nonce":"native-assist-verify-731"}', 10, 'verify-1'), { seq: 14, type: 'turn/end', data: { reason: { kind: 'completed' } } }] },
    { id: sidecarId, events: [...tool('ultra_memory_search', { query: 'permissionSentinel' }, '{}', 1, 'search-1'),
      ...tool('ultra_memory_get', { id: 'src_write', quote: receiptText, maxChars: 4000 }, JSON.stringify(quote), 4, 'get-1'),
      { seq: 7, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: response.text }] } } }, { seq: 9, type: 'turn/end', data: { reason: { kind: 'completed' } } }] }],
    sourceRecords: [{ id: 'src_task', sessionId: rootId, kind: 'user/task', capturedText: task },
      { id: 'src_write', sessionId: rootId, kind: 'tool/result:write', origin: { callId: 'write-1' }, sha256: createHash('sha256').update(receiptText).digest('hex') },
      ...snapshots.map((snapshot, index) => ({ id: 'governance-' + index, eventId: 'decision-governance:' + index, sessionId: rootId, kind: 'host/decision-governance', capturedText: JSON.stringify(snapshot) }))],
    deliveries: [{ messageId: 'feedback-1', targetId: rootId, stages: ['queued', 'admitted', 'request-visible'].map(stage => ({ stage })) }] }
  assert.equal(companionDriver.auditCompanionGovernance(observation).passed, true)
  for (const mutate of [
    value => { value.deliveries[0].stages.pop() },
    value => { value.requests[1].messageIds = [] },
    value => { value.requests[1].nativeBoundary = 11 },
    value => { value.sessions[0].events.find(event => event.seq === 8).data.source.kind = 'user' },
    value => { value.sessions[0].events = value.sessions[0].events.filter(event => event.seq !== 11) },
    value => { value.sessions[0].events.pop() },
    value => { value.sessions[1].events.pop() },
    value => { value.sessions[0].events[0].data.source.kind = 'ultra-assist' },
    value => { value.sessions[1].events = value.sessions[1].events.filter(event => event.seq > 2) },
    value => { value.sourceRecords[1].origin.callId = 'foreign-call' },
    value => { value.sourceRecords[1].sha256 = 'f'.repeat(64) },
    value => { value.sourceRecords[0].capturedText = 'changed task' },
    value => { value.sessions[1].events.find(event => event.type === 'tool/call' && event.data.name === 'ultra_memory_get').data.arguments = JSON.stringify({ id: 'src_write', quote: '"permissionSentinel":true', maxChars: 4000 }) },
    value => { const result = value.sessions[1].events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'get-1'); const quoted = JSON.parse(result.data.message.content[0].text); quoted.citation.sha256 = 'f'.repeat(64); result.data.message.content[0].text = JSON.stringify(quoted) },
    value => { const result = value.sessions[1].events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'get-1'); const quoted = JSON.parse(result.data.message.content[0].text); quoted.text = '"permissionSentinel":true'; result.data.message.content[0].text = JSON.stringify(quoted) },
    value => { for (const record of value.sourceRecords.filter(item => item.kind === 'host/decision-governance')) record.eventId = 'decision-governance:' + (100 - Number(record.eventId.split(':').at(-1))) },
  ]) {
    const bad = structuredClone(observation); mutate(bad)
    assert.equal(companionDriver.auditCompanionGovernance(bad).passed, false)
  }
})

test('persisted companion inventory cannot pass from in memory claims without native evidence', () => {
  assert.throws(() => assertCompanionInventory([], { status: 'passed', phaseProofs: [{ passed: true }] }, 'core'), /native|phase/)
  assert.throws(() => assertCompanionInventory([{ sessionId: 'root', completed: true, receipts: [] }], { rootId: 'root', phaseProofs: [] }, 'resume'), /fixture/)
})

test('persisted companion acceptance requires both actual distinct model readback chains', () => {
  const proofs = ['code', 'review'].map((kind, index) => ({ rootId: 'root-' + kind, route: { id: kind, provider: 'provider-' + kind, model: 'model-' + kind, reasoningEffort: 'high', maxTokens: 256 }, challenge: { id: 'fixture-' + kind, nonce: 'nonce-' + kind, answer: index + 7 } }))
  const sessions = [], requests = [], toolExecutions = []
  for (const proof of proofs) {
    const childId = 'child-' + proof.route.id, readback = JSON.stringify({ fixtureId: proof.challenge.id, nonce: proof.challenge.nonce, answer: proof.challenge.answer })
    sessions.push({ sessionId: proof.rootId, completed: true, finalText: readback, receipts: [
      { name: 'ultra_spawn_agent', isError: false, arguments: { model_config_id: proof.route.id, model_reason: 'Task fits this saved candidate' }, text: JSON.stringify({ id: childId }) },
      { name: 'ultra_wait_agent', isError: false, text: JSON.stringify({ agents: [{ id: childId, status: 'completed', model: { requestedConfigId: proof.route.id, actual: { provider: proof.route.provider, model: proof.route.model }, compatibility: { tools: 'observed-native-tool-result' } } }] }) },
    ] })
    sessions.push({ sessionId: childId, completed: true, finalText: readback, receipts: [{ name: 'fixture_read', callId: 'call-' + childId, callSeq: 4, resultSeq: 5, isError: false, arguments: { id: proof.challenge.id }, text: JSON.stringify({ nonce: proof.challenge.nonce }) }] })
    requests.push(...[[], [proof.challenge.nonce]].map(toolResultNonces => ({ sessionId: childId, provider: proof.route.provider, model: proof.route.model, reasoningEffort: 'high', maxTokens: 256, tools: ['fixture_read'], toolResultNonces })))
    toolExecutions.push({ sessionId: childId, name: 'fixture_read', id: proof.challenge.id, nonce: proof.challenge.nonce, callId: 'call-' + childId, isError: false })
  }
  const result = { phaseProofs: proofs, requests, toolExecutions }
  assert.equal(assertCompanionInventory(sessions, result, 'core'), true)
  const altered = structuredClone(sessions); altered[1].receipts[0].text = '{"nonce":"invented"}'
  assert.throws(() => assertCompanionInventory(altered, result, 'core'), /native JSONL/)
  const same = structuredClone(result); same.phaseProofs[1].route = same.phaseProofs[0].route
  assert.throws(() => assertCompanionInventory(sessions, same, 'core'), /distinct/)
})

const preflightSdkVersion = process.env.DSH_ULTRA_TEST_SDK ? JSON.parse(fs.readFileSync(path.resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai/dsh-agent/package.json'), 'utf8')).version : undefined
test('native SDK preflight drives the same Team script through actual typed ToolRuntime and matched JSONL', { skip: !preflightSdkVersion ? 'Set DSH_ULTRA_TEST_SDK for focused native SDK protocol preflight' : preflightSdkVersion === '0.2.0-rc.2' ? 'Companion CLI preflight targets exact native 0.2.1-rc.2; existing model-pool-sdk suite covers 0.2.0-rc.2' : false, timeout: 20000 }, async t => {
  assert.equal(preflightSdkVersion, '0.2.1-rc.2', 'Explicit companion preflight requires the complete pinned new SDK')
  const names = ['cordis', 'cordis-plugin-loader', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-session-persistence-jsonl', 'dsh-session-query', 'dsh-agent-preset-registry', 'dsh-agent-preset', 'dsh-fs-local', 'dsh-working-directory', 'dsh-subagent', 'dsh-subagent-spawn-in-process', 'dsh-scope']
  const sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(path.resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai', name, 'lib/index.js')).href)])))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-sdk-preflight-')), projectDir = path.join(root, 'project'), logs = path.join(root, 'jsonl')
  fs.mkdirSync(projectDir)
  const ctx = new sdk.cordis.Context(), handles = [], owners = [], sessions = new Map(), plans = new Map(), requests = [], toolExecutions = []; let verified = false
  t.after(async () => { for (const owner of owners.toReversed()) await owner.close(); for (const handle of handles.toReversed()) await handle.dispose(); await ctx.fiber.dispose(); if (verified) fs.rmSync(root, { recursive: true, force: true }); else t.diagnostic('Failed SDK preflight preserved: ' + root) })
  ctx.baseUrl = pathToFileURL(root + path.sep).href
  for (const [name, config] of [['cordis-plugin-loader'], ['dsh-llm'], ['dsh-session'], ['dsh-session-projection'], ['dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }], ['dsh-tools', { mode: 'native' }], ['dsh-agent'], ['dsh-agent-loop', { agents: [] }], ['dsh-session-persistence-jsonl', { root: logs, compression: 'none' }], ['dsh-session-query'], ['dsh-agent-preset-registry', { default: 'offline' }], ['dsh-agent-preset', { id: 'offline', plugins: [] }], ['dsh-fs-local'], ['dsh-working-directory', { defaultDirectory: projectDir }], ['dsh-subagent', { maxDepth: 1, maxActiveSubagents: 2 }], ['dsh-subagent-spawn-in-process', { providerName: 'spawn' }]]) await ctx.plugin(sdk[name].default ?? sdk[name], config).await()
  ctx.on('session/event', session => { sessions.set(session.id, session) })
  const { createGlobalLimit } = await import('../scripts/host-acceptance/real-model-global-limit.mjs'), { createLiveChallenges } = await import('../scripts/host-acceptance/model-pool-live-driver.mjs')
  const routes = [{ id: 'code', kind: 'code', provider: 'companion-code', model: 'scripted-code', reasoningEffort: 'high', maxTokens: 256 }, { id: 'review', kind: 'review', provider: 'companion-review', model: 'scripted-review', reasoningEffort: 'low', maxTokens: 384 }]
  const gate = createGlobalLimit({ testRoot: root, logFile: path.join(root, 'gate.jsonl'), allowedRoutes: [{ provider: 'companion-main', model: 'scripted-main' }, ...routes.map(({ provider, model }) => ({ provider, model }))], concurrency: 2, maxRequests: 40, syntheticUsage: true })
  ctx.on('llm/stream', gate.stream, { prepend: true }); t.after(() => gate.close())
  const challenges = createLiveChallenges(), entered = Promise.withResolvers(), release = Promise.withResolvers(); let current = companionPoolConfig(routes, 'code'), callCounter = 0
  const textOf = messages => messages.flatMap(message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text)).join('\n')
  const call = (name, args) => ({ type: 'tool-call', id: sdk['dsh-llm'].ToolCallId('preflight-' + ++callCounter), name, arguments: JSON.stringify(args) })
  class Offline extends sdk['dsh-llm'].LlmAdapter {
    providerInfo(id) { return { id, name: 'Offline SDK preflight' } }
    async listModels(provider) { return [{ provider, id: provider.replace('companion', 'scripted'), name: 'Offline preflight model', inputModalities: ['text'] }] }
    async resolveModel(provider, model) { return { provider, id: model, name: 'Offline preflight model', inputModalities: ['text'], context: { contextWindow: 1000000 }, reasoning: { efforts: ['low', 'medium', 'high', 'max'].map(id => ({ id, name: id })), defaultEffort: 'medium' } } }
    async *stream(options) {
      const row = { sequence: requests.length + 1, sessionId: options.sessionId, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, maxTokens: options.maxTokens, tools: (options.tools ?? []).map(tool => tool.name), text: textOf(options.messages), toolResultNonces: options.messages.filter(message => message.role === 'tool' && !message.isError).flatMap(message => { try { return [JSON.parse(textOf([message])).nonce].filter(Boolean) } catch { return [] } }) }
      requests.push(row); let content
      if (row.text.includes('自动决策辅助旁路')) {
        row.stage = 'assist-decision'
        content = options.messages.some(message => message.role === 'tool') ? [{ type: 'text', text: '{"assessment":"Only the permitted read was checked; no new authority.","directives":[]}' }] : [call('fixture_read', { id: 'assist' })]
      } else if (row.text.includes('PREFLIGHT_ASSIST_MAIN')) {
        row.stage = 'assist-main'; await new Promise(resolve => setTimeout(resolve, 100))
        content = options.messages.some(message => message.role === 'tool') ? [{ type: 'text', text: 'Main permission sentinel completed.' }] : [call('write', {})]
      } else if (plans.has(options.sessionId)) {
        const plan = plans.get(options.sessionId), action = companionTeamStep(options.messages, plan, challenges[plan.kind])
        if (action.toolName === 'ultra_spawn_agent') assert.equal(hasNativeTeamCatalog(row, ['code', 'review']), true)
        if (action.toolName === 'ultra_interrupt_agent') {
          const deadline = Date.now() + 3000
          while (!requests.some(request => request.sessionId === action.childId && request.stage === 'cancel-child') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2))
          assert.ok(requests.some(request => request.sessionId === action.childId && request.stage === 'cancel-child'), 'Cancellation must start actual native work')
        }
        content = action.toolName ? [call(action.toolName, action.args)] : [{ type: 'text', text: action.text }]
      } else {
        if (row.text.includes('COMPANION_CANCEL_CHILD')) {
          row.stage = 'cancel-child'
          await new Promise((_resolve, reject) => { const abort = () => reject(options.signal.reason ?? new Error('Cancelled SDK child')); if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true }) })
        }
        const kind = row.text.includes('COMPANION_CHILD code') ? 'code' : 'review'
        const result = options.messages.findLast(message => message.role === 'tool' && !message.isError)
        if (!result && kind === 'code') { entered.resolve(); await release.promise }
        if (!result) content = [call('fixture_read', { id: challenges[kind].id })]
        else { const value = JSON.parse(textOf([result])), answer = kind === 'code' ? value.values.filter(number => number % 2 === 0).reduce((sum, number) => sum + number * number, 0) : value.values.length; content = [{ type: 'text', text: JSON.stringify({ fixtureId: value.fixtureId, nonce: value.nonce, answer }) }] }
      }
      for (const [index, block] of content.entries()) { yield { type: 'block-start', index, blockType: block.type }; if (block.type === 'tool-call') yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments }; else yield { type: 'text-delta', index, text: block.text }; yield { type: 'block-end', index, block } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; yield { type: 'finish', reason: { kind: content.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['companion-main', 'companion-code', 'companion-review'], new Offline())
  ctx.tools.register(sdk['dsh-tools'].defineContentToolFixture({ name: 'fixture_read', description: 'Read-only preflight data', parameters: { id: { type: 'string', required: true } }, async execute(args, exec) { const fixture = Object.values(challenges).find(challenge => challenge.id === args.id), value = fixture ? JSON.parse(fixture.fixtureText) : { fixtureId: 'assist', nonce: 'native-assist-731' }; toolExecutions.push({ name: 'fixture_read', sessionId: exec.agent.id, callId: exec.callId, id: args.id, nonce: value.nonce, isError: false }); return [{ type: 'text', text: JSON.stringify(value) }] } }))
  ctx.tools.register(sdk['dsh-tools'].defineContentToolFixture({ name: 'write', description: 'No-op permission sentinel', parameters: {}, async execute(_args, exec) { toolExecutions.push({ name: 'write', sessionId: exec.agent.id }); return [{ type: 'text', text: '{"permissionSentinel":true}' }] } }))
  const pure = { './model-pool.js': await import('../lib/model-pool.js'), './collaboration.js': await import('../lib/collaboration.js'), './model-pool-audit.js': await import('../lib/model-pool-audit.js') }, exports = {}
  const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/collaboration-host.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(compiled, { exports, require: name => name === 'node:crypto' ? { randomUUID } : pure[name] ?? sdk[name.replace('@deepseek-ai/', '')] ?? assert.fail('Unexpected VM dependency ' + name), AbortController, AbortSignal, Error, AggregateError, Promise, Map, Set, WeakMap, JSON, structuredClone, queueMicrotask, setTimeout, clearTimeout })
  const phaseProofs = []
  for (const plan of [{ kind: 'code' }, { kind: 'review' }, { kind: 'review', cancel: true }]) {
    const { kind } = plan
    const handle = await ctx.agents.create({ sessionId: 'preflight-' + kind + '-' + randomUUID(), meta: { cwd: projectDir, agentPreset: 'offline' }, agentOptions: { provider: 'companion-main', model: 'scripted-main', reasoningEffort: 'medium', maxTokens: 1024 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } }); handles.push(handle)
    const parent = handle.agent; plans.set(parent.id, plan)
    const owner = exports.installCollaboration(parent, { collaborationEnabled: true, collaborationProvider: 'spawn', collaborationMaxAgents: 8, collaborationModelPool: { get: () => current } }); owners.push(owner)
    const pending = ctx.agents.withInitiator(parent, async () => { parent.followup(sdk['dsh-llm'].createUserMessage({ content: [{ type: 'text', text: 'Preflight delegated ' + kind }], source: { kind: 'user' } })); await parent.whenIdle() })
    if (kind === 'code') {
      let timer
      try { await Promise.race([entered.promise, pending.then(() => { throw new Error('Parent settled before native child started: ' + JSON.stringify(parent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason)) }), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Native preflight child did not enter within 5 seconds')), 5000) })]) }
      finally { clearTimeout(timer); release.resolve() }
      const old = current; current = companionPoolConfig(routes, 'review'); current.models[0].maxTokens = 512; assert.equal(old.models[0].maxTokens, 256)
    }
    await pending
    assert.equal(parent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'completed')
    for (const record of owner.records()) assert.ok(sessions.get(record.id)?.snapshotEvents().some(event => event.type === 'turn/end'), 'Retained native Session objects remain auditable after child disposal')
    if (!plan.cancel) phaseProofs.push({ rootId: parent.id, route: routes.find(route => route.kind === kind), challenge: challenges[kind] })
  }
  const compileVm = (file, dependencies) => {
    const exports = {}, compiled = ts.transpileModule(fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText
    vm.runInNewContext(compiled, { exports, require: name => name === 'node:crypto' ? { randomUUID } : dependencies[name] ?? sdk[name.replace('@deepseek-ai/', '')] ?? assert.fail('Unexpected VM dependency ' + name), AbortController, AbortSignal, Error, AggregateError, Promise, Map, Set, WeakMap, WeakSet, JSON, structuredClone, queueMicrotask, setTimeout, clearTimeout }); return exports
  }
  // The focused sidecar preflight intentionally has no evidence service. Its
  // real native route/permissions and governance are checked; durable evidence
  // ownership remains a separate CLI profile acceptance obligation.
  const runtime = compileVm('runtime.ts', { './collaboration-host.js': exports, './memory-host.js': { memoryFor: () => undefined } })
  const assistApi = compileVm('assist.ts', { './coordination.js': await import('../lib/coordination.js'), './decision-governance.js': await import('../lib/decision-governance.js'), './memory-host.js': { beginMemoryRun: async () => undefined } })
  const assistParent = await ctx.agents.create({ sessionId: 'preflight-assist-' + randomUUID(), meta: { cwd: projectDir, agentPreset: 'offline' }, agentOptions: { provider: 'companion-main', model: 'scripted-main', reasoningEffort: 'medium', maxTokens: 1024 }, setup: async scope => { await ctx.agentPresets.mount(scope, 'offline') } }); handles.push(assistParent)
  let assistHandle, governance
  const releaseAssistHook = ctx.on('agent/pre-step', async (payload, next) => { const decision = await next(); if (payload.agent === assistParent.agent && !assistHandle && decision.kind === 'enter') assistHandle = await assistApi.startDecisionAssist({ timeoutMs: 5000, coordinationIntervalMs: 100, coordinationMaxRounds: 1, decisionGovernance: true, researchTools: ['fixture_read'] }, { parent: assistParent.agent, task: 'PREFLIGHT_ASSIST_MAIN', content: [{ type: 'text', text: 'PREFLIGHT_ASSIST_MAIN' }], signal: payload.signal, phase() {}, onGovernance(value) { governance = value } }, runtime.createRoute); return decision })
  const assistStart = requests.length
  await ctx.agents.withInitiator(assistParent.agent, async () => { assistParent.agent.followup(sdk['dsh-llm'].createUserMessage({ content: [{ type: 'text', text: 'PREFLIGHT_ASSIST_MAIN' }], source: { kind: 'user' } })); await assistParent.agent.whenIdle() })
  const outcome = await assistHandle.done; releaseAssistHook()
  const audit = auditAssistRequests({ requests: requests.slice(assistStart), rootId: assistParent.agent.id, mainProvider: 'companion-main', mainModel: 'scripted-main', allowedSidecarTools: ['fixture_read'] })
  assert.equal(audit.passed, true)
  assert.ok(toolExecutions.some(row => row.name === 'write' && row.sessionId === assistParent.agent.id))
  assert.ok(toolExecutions.some(row => row.name === 'fixture_read' && row.sessionId === audit.sidecarId))
  assert.equal(governance.contract.originalTask, 'PREFLIGHT_ASSIST_MAIN'); assert.equal(governance.closed, true)
  assert.equal(outcome.error, null)
  for (const session of sessions.values()) if (ctx.agents.get(session.id)?.session === session) await ctx.sessions.flush(session)
  const inventory = fs.readdirSync(logs, { recursive: true, withFileTypes: true }).filter(item => item.isFile() && item.name.endsWith('.jsonl')).map(item => inspectSessionJsonl(fs.readFileSync(path.join(item.parentPath, item.name), 'utf8')))
  assert.equal(assertCompanionInventory(inventory, { phaseProofs, requests, toolExecutions }, 'core'), true)
  assert.equal(gate.snapshot().active, 0); assert.ok(gate.snapshot().activePeak <= 2); assert.equal(gate.snapshot().admitted, requests.length)
  verified = true
})
