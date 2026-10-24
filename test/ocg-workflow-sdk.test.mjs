/** Pinned native SDK protocol fixture, scripted adapter; no real provider or credentials. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { runWorkflow, judgeOcgWorkflow, judgeOcgWorkflowWithArchives, WORKFLOW_TOOLS } from '../scripts/host-acceptance/ocg-workflow-plugin.mjs'
import * as gatePlugin from '../scripts/host-acceptance/real-model-global-limit.mjs'

const sdkRoot = process.env.DSH_ULTRA_TEST_SDK
const names = ['cordis', 'cordis-plugin-loader', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-session-persistence-jsonl', 'dsh-session-query', 'dsh-agent-preset-registry', 'dsh-agent-preset', 'dsh-fs-local', 'dsh-working-directory', 'dsh-commands', 'dsh-token-meter']
let unavailable = !sdkRoot && 'Set DSH_ULTRA_TEST_SDK to a complete official 0.2.1-rc.2 / rc.3 runtime for this version-specific integration proof.'
if (sdkRoot) {
  try {
    const version = JSON.parse(await fs.readFile(path.join(sdkRoot, '@deepseek-ai/dsh-agent/package.json'), 'utf8')).version
    if (!['0.2.1-rc.2', '0.2.1-rc.3'].includes(version)) unavailable = 'This workflow integration proof requires official 0.2.1-rc.2 / rc.3; selected SDK is ' + version + '. Skipped, not a compatibility pass.'
    else for (const name of names) await fs.access(path.join(sdkRoot, '@deepseek-ai', name, 'lib/index.js'))
  } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ERR_MODULE_NOT_FOUND') throw error; unavailable = 'Selected SDK lacks a required official 0.2.1-rc.2 / rc.3 workflow module. Skipped, not a compatibility pass.' }
}
const textOf = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
const parse = message => JSON.parse(message.content.find(block => block.type === 'text').text)

for (const failFinal of [false, true, 'format']) test('native workflow calibration executes and retrieves real cases; ' + (failFinal === 'format' ? 'strict JSON final recovery adds one read-only native turn without replay' : failFinal ? 'TRANSPORT final recovery is read-only and preserves prior operations' : 'completed resume replays nothing'), { skip: unavailable }, async t => {
  const sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(pathToFileURL(path.join(sdkRoot, '@deepseek-ai', name, 'lib/index.js')).href)])))
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocg-workflow-sdk-')), projectDir = path.join(directory, 'project'), candidate = path.join(directory, 'candidate')
  await fs.mkdir(projectDir); await fs.mkdir(candidate)
  await fs.cp(new URL('../lib/', import.meta.url), path.join(candidate, 'lib'), { recursive: true })
  await fs.writeFile(path.join(candidate, 'package.json'), '{"type":"module"}')
  await fs.symlink(path.resolve(sdkRoot), path.join(candidate, 'node_modules'), 'junction')
  const ctx = new sdk.cordis.Context(), requests = [], native = []
  t.after(async () => { await ctx.fiber.dispose(); await fs.rm(directory, { recursive: true, force: true }) })
  ctx.baseUrl = pathToFileURL(directory + path.sep).href
  for (const [name, options] of [
    ['cordis-plugin-loader'], ['dsh-llm'], ['dsh-session'], ['dsh-session-projection'], ['dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }],
    ['dsh-tools', { mode: 'native' }], ['dsh-agent'], ['dsh-agent-loop', { agents: [] }], ['dsh-session-persistence-jsonl', { root: path.join(directory, 'logs'), compression: 'none' }], ['dsh-session-query'],
    ['dsh-agent-preset-registry', { default: 'ocg' }], ['dsh-agent-preset', { id: 'ocg', plugins: [] }], ['dsh-fs-local'], ['dsh-working-directory', { defaultDirectory: projectDir }], ['dsh-commands'], ['dsh-token-meter'],
  ]) await ctx.plugin(sdk[name].default ?? sdk[name], options).await()
  const ultra = await import(pathToFileURL(path.join(candidate, 'lib/index.js')).href)
  await ctx.plugin(ultra, { toolName: 'ultra_task', concurrency: 2, sectionOrder: 117.5, maxSessions: 64, timeoutMs: 60000, reportChars: 2000, researchTools: [], collaborationEnabled: false, decisionGovernance: false,
    evidenceEnabled: true, contextCompression: true, contextTargetTokens: 20000, contextRetainRecentMessages: 2, contextOutputReserveTokens: 8192, contextToolReserveTokens: 2048, memorySearchChars: 6400, memoryGetChars: 6400, jevEnabled: false }).await()
  await ctx.plugin(gatePlugin, { allowedProvider: 'opencode-go', allowedModel: 'deepseek-v4.1-flash', concurrency: 1, maxRequests: 30, testRoot: directory, logFile: 'gate.jsonl', syntheticUsage: true }).await()
  ctx.on('session/event', (session, event) => { if (event.type !== 'assistant/stream') native.push(event) })
  let count = 0, specification, current, tested, reportQuote, sourceId, citation, committed
  class Offline extends sdk['dsh-llm'].LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: 'Offline native protocol only', inputModalities: ['text'], context: { contextWindow: 500000 }, reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } } }
    async *stream(options) {
      requests.push(options); count++
      assert.ok((options.tools ?? []).every(tool => WORKFLOW_TOOLS.includes(tool.name)))
      assert.ok(JSON.stringify(options.tools).includes('Unique stable operation ID'), 'Actual native model request includes operation ID semantics')
      assert.ok(options.tools.find(tool => tool.name === 'workflow_read').description.includes('two base files'))
      const tools = options.messages.filter(message => message.role === 'tool' && !message.isError)
      const last = tools.at(-1)
      let action
      if (count === 1) action = ['workflow_read', { id: 'initial-core', file: 'src/reconcile.mjs' }]
      else if (count === 2) action = ['workflow_read', { id: 'initial-history', file: 'history/initial-ledger.json' }]
      else if (count === 3) action = 'Initial read-only project inspection complete.'
      else if (count === 4) action = ['workflow_read', { id: 'spec-1', file: 'specs/phase-01.json' }]
      else if (count === 5) { specification = JSON.parse(last.content[1].text); action = ['workflow_read', { id: 'case-1', file: 'cases/phase-01.mjs' }] }
      else if (count === 6) {
        current = parse(last)
        const cases = specification.requiredCases.map(item => {
          const input = item.input, itemsCents = input.items.reduce((sum, line) => sum + line.qty * line.unitCents, 0), dueCents = Math.max(0, Math.max(0, itemsCents - input.discountCents) + input.shippingCents - input.returnedCents), balanceCents = input.paidCents - dueCents
          return { ...item, expected: { currency: 'CNY', itemsCents, shippingCents: input.shippingCents, refundCents: input.returnedCents, dueCents, balanceCents, status: balanceCents === 0 ? 'settled' : balanceCents > 0 ? 'credit' : 'outstanding', decisionId: 'reconciliation-v1' } }
        })
        action = ['workflow_patch', { id: 'patch-1', file: 'cases/phase-01.mjs', expectedSha256: current.sha256, content: 'export default ' + JSON.stringify(cases) + ';\n' }]
      } else if (count === 7) action = ['workflow_test', { id: 'test-1', phase: 1, verbose: true }]
      else if (count === 8) {
        tested = parse(last); assert.equal(tested.passed, true, JSON.stringify(tested))
        reportQuote = last.content[1].text.trim().split('\n').find(line => JSON.parse(line).caseId === 'audit-phase-01')
        action = 'Added four real cases and ran the fixed Node tests successfully.'
      } else if (count === 9) action = ['ultra_memory_search', { query: 'audit-phase-01', kind: 'tool/result', maxChars: 6400, limit: 8 }]
      else if (count === 10) {
        const value = parse(last), row = value.items.find(row => row.kind === 'tool/result:workflow_test' && row.excerpt.includes('audit-phase-01'))
        assert.ok(row, JSON.stringify(value)); sourceId = row.sourceId
        action = ['ultra_memory_get', { id: sourceId, quote: reportQuote, maxChars: 6400 }]
      } else if (count === 11) {
        citation = parse(last).citation; assert.equal(citation.quote, reportQuote)
        action = ['workflow_commit', { id: 'workflow-phase-01-commit', phase: 1, expectedSha256: tested.treeSha256, summary: 'Actual native source verified and current Node test tree committed.' }]
      } else if (count === 12 && failFinal === true) {
        yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'Synthetic disconnected final response' } } }; return
      } else if (count === 12 || count === 13 && failFinal) {
        committed = parse(last); const row = JSON.parse(reportQuote)
        const answer = JSON.stringify({ phase: 1, label: '协作', activeDecisionId: 'reconciliation-v1', decisionHistory: [{ id: 'reconciliation-v1', status: 'current' }], commitReceiptId: committed.receiptId,
          target: { caseId: row.caseId, dueCents: row.observed.dueCents, balanceCents: row.observed.balanceCents, status: row.observed.status, resultSha256: row.resultSha256 }, operation: { seedReceiptId: 'seed-reconciled-001', seedRepeated: false }, conflict: { id: 'bank-vs-ledger', status: 'unresolved' }, evidence: { sourceId, quote: reportQuote } })
        action = failFinal === 'format' && count === 13 ? answer : '```json\n' + answer + '\n```' + (failFinal === 'format' ? '\nThis extra explanation invalidates the original public answer.' : '')
      } else assert.fail('Unexpected native request/replay ' + count)
      const block = Array.isArray(action) ? { type: 'tool-call', id: sdk['dsh-llm'].ToolCallId('workflow-script-' + count), name: action[0], arguments: JSON.stringify(action[1]) } : { type: 'text', text: action }
      yield { type: 'block-start', index: 0, blockType: block.type }
      if (block.type === 'tool-call') yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
      else yield { type: 'text-delta', index: 0, text: block.text }
      yield { type: 'block-end', index: 0, block }
      const inputTokens = Math.ceil(Buffer.byteLength(JSON.stringify({ system: options.system, tools: options.tools, messages: options.messages })) / 4)
      yield { type: 'usage', usage: { inputTokens, cacheReadTokens: 0, outputTokens: 10, totalTokens: inputTokens + 10 } }
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['opencode-go'], new Offline())
  const cfg = { runtimeRoot: path.dirname(sdkRoot), ultraRoot: candidate, projectDir, resultFile: path.join(directory, 'result.json'), stateFile: path.join(directory, 'state.json'), provider: 'opencode-go', model: 'deepseek-v4.1-flash', maxRequests: 30, timeoutMs: 60000, reportRows: 32, cycles: 1, calibrateOnly: true, fixtureSeed: 'native-workflow-fixed-reproduction-1' }
  let result
  if (failFinal) {
    await assert.rejects(runWorkflow(ctx, cfg, { allowSyntheticGate: true }), { code: failFinal === 'format' ? 'WORKFLOW_INVALID_JSON' : 'TRANSPORT' })
    const failure = JSON.parse(await fs.readFile(cfg.resultFile, 'utf8')), prefix = JSON.stringify(native), priorEvents = native.length
    assert.equal(failure.status, 'failed'); assert.equal(failure.phases[0].status, 'committed-awaiting-verification')
    const beforeCalls = native.filter(event => event.type === 'tool/call').length
    result = await runWorkflow(ctx, { ...cfg, resume: true, recoverCommittedVerification: true, ...(failFinal === 'format' ? { recoverReadOnlyFinal: true, recoveryFailureCode: 'WORKFLOW_INVALID_JSON' } : {}) }, { allowSyntheticGate: true })
    assert.equal(JSON.stringify(native.slice(0, priorEvents)), prefix)
    assert.equal(native.filter(event => event.type === 'tool/call').length, beforeCalls, 'Final-only recovery must not replay any completed mutation')
    assert.equal(count, 13); assert.equal(result.phases[0].recovery.readOnly, true)
    assert.equal(result.requests[11].nativeUsageVerified, failFinal === 'format', 'A completed but format-invalid answer has real usage; failed default-zero TRANSPORT does not')
    if (failFinal === 'format') {
      const proof = result.phases[0].recovery
      assert.equal(proof.businessFilesUnchanged, true); assert.equal(proof.nativeProof.userAdmissions, 1); assert.equal(proof.nativeProof.mutationCalls, 0)
      assert.deepEqual(proof.nativeProof.toolCalls, []); assert.equal(proof.nativeProof.originalPhaseTaskReplayed, false)
      assert.ok(requests[12].messages.some(message => message.role === 'user' && textOf(message).includes('Output a bare JSON object')))
      assert.equal(result.initialRequirementReceipt.occurrences, 1)
    }
  } else result = await runWorkflow(ctx, cfg, { allowSyntheticGate: true })
  assert.equal(result.status, 'calibrated'); assert.equal(result.evidenceClass, 'scripted-native'); assert.equal(result.phases[0].grade.passed, true)
  const persistedState = JSON.parse(await fs.readFile(cfg.stateFile, 'utf8')).state
  assert.equal(result.fixtureSeed, cfg.fixtureSeed); assert.equal(persistedState.seed, cfg.fixtureSeed); assert.equal(result.fixtureManifestSha256, persistedState.fixtureManifestSha256)
  t.diagnostic(JSON.stringify({ groups: result.compressionGroups, retrieval: { verified: result.phases[0].retrieval.verified, afterCompression: result.phases[0].retrieval.afterCompression }, requests: result.requests.map(row => ({ sequence: row.sequence, stage: row.stage, fullReportVisible: row.fullReportVisible, input: row.contextUsage?.totalMinusOutput, estimate: row.estimatedRequestBudget.totalTokens })) }))
  assert.equal(result.phases[0].retrieval.verified, true); assert.equal(result.phases[0].retrieval.afterCompression, true)
  const group = result.compressionGroups.find(group => group.replacedCallIds.includes(result.phases[0].reportSource.callId))
  assert.ok(group); assert.ok(group.pruneSeqs.includes(group.nativeBoundary), 'First prune seq equals the session next-seq boundary')
  assert.equal(result.requests.find(row => row.sequence === group.nextRequestSequence).fullReportVisible, false)
  const disk = judgeOcgWorkflow({ events: native, result })
  assert.equal(disk.passed, true); assert.equal(disk.nativeGroupsVerified, true); assert.equal(disk.usageAudit.passed, true)
  const physical = await judgeOcgWorkflowWithArchives({ events: native, result, compressionProfile: 'baseline', projectDir, ultraRoot: candidate, runtimeRoot: path.dirname(sdkRoot) })
  assert.equal(physical.passed, true, 'The actual runner asynchronous boundary preserves baseline native verification')
  const beforeResume = requests.length, resumed = await runWorkflow(ctx, { ...cfg, resume: true }, { allowSyntheticGate: true })
  assert.equal(resumed.status, 'calibrated'); assert.equal(requests.length, beforeResume); assert.equal(resumed.phases.length, 1)
  assert.equal(resumed.phases[0].commit.duplicate, false); assert.equal(resumed.globalGate.final.active, 0)
})
