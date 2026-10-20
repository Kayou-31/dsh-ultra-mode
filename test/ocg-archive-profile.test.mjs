import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import * as runner from '../scripts/host-acceptance/run-ocg-profile.mjs'
import * as controller from '../scripts/host-acceptance/ocg-workflow-plugin.mjs'
import * as companionBuild from '../scripts/build-companions.mjs'
import ts from 'typescript'
const root = path.resolve(import.meta.dirname, '..')
function proof() {
  return { phase: 1, compressionProfile: 'archive-130k', requests: [{ sequence: 1, phase: 1, nativeUsageVerified: true, fullReportVisible: true, reportCallId: 'report', usage: { inputTokens: 420000, cacheReadTokens: 0, outputTokens: 100, totalTokens: 420100 }, outputReserveTokens: 8192, toolReserveTokens: 2048 },
    { sequence: 2, phase: 1, nativeUsageVerified: true, fullReportVisible: false, usage: { inputTokens: 119760, cacheReadTokens: 0, outputTokens: 100, totalTokens: 119860 }, outputReserveTokens: 8192, toolReserveTokens: 2048 }],
    groups: [{ id: 'compression-1', phase: 1, beforeGeneration: 2, afterGeneration: 3, nextRequestSequence: 2, summarySeqs: [101], replacedCallIds: ['report'] }], retrieval: { verified: true, afterCompression: true, callId: 'report', sourceId: 'src-real', sourceSha256: 'a'.repeat(64) }, commit: { committed: true }, grade: { passed: true } }
}
test('archive profile is explicit, bounded, and preserves earlier settings', () => {
  assert.equal(runner.ocgScenarioSettings('workflow', 'ultra-mode', 1000).contextArchiveCompletedTurns, undefined)
  assert.equal(runner.ocgScenarioSettings('workflow', 'ultra-mode', 1000, 'efficient').contextMinResultChars, 64)
  const settings = runner.ocgScenarioSettings('workflow', 'ultra-mode', 1000, 'archive-130k')
  assert.equal(settings.contextArchiveCompletedTurns, true); assert.equal(settings.contextMinResultChars, 4096); assert.equal(settings.contextMaxPrunes, 16)
  assert.equal(settings.contextTargetTokens, 30000); assert.equal(settings.contextTriggerTokens, 420000)
  const input = { runtime: '/runtime', work: '/work', installed: '/installed', support: '/support', bootstrap: { provider: 'opencode-go', mainModel: 'deepseek-v4.1-flash', providerConfig: { models: [{ id: 'deepseek-v4.1-flash' }] } }, scenario: 'workflow', concurrency: 1, maxRequests: 900, timeoutMs: 10800000, bundleName: '@dsh-external/dsh-ultra-mode', workflow: { compressionProfile: 'archive-130k' } }
  const rows = runner.ocgProfileRows(input), config = rows.find(row => row[0] === 'experiment')[2]
  assert.equal(config.postCompressionCapTokens, 130000); assert.equal(config.reportTargetInputTokens, 445000)
  const normalized = controller.normalizeWorkflowConfig({ ...config, reportRows: 12000 })
  assert.equal(normalized.outputReserveTokens, 8192); assert.equal(normalized.toolReserveTokens, 2048)
  for (const patch of [{ outputReserveTokens: 8191 }, { toolReserveTokens: 2047 }, { postCompressionCapTokens: 130001 }, { maxRequests: 901 }, { timeoutMs: 10800001 }]) assert.throws(() => controller.normalizeWorkflowConfig({ ...config, reportRows: 12000, ...patch }))
  for (const patch of [{ concurrency: 2 }, { maxRequests: 901 }]) assert.throws(() => runner.ocgProfileRows({ ...input, ...patch }))
  assert.equal(runner.ocgWorkflowLaunchReceipt(rows).compressionSettings.contextArchiveCompletedTurns, true)
})
test('130K adds a gate only for the explicit archive profile and does not erase original requirements', () => {
  const input = proof(); assert.equal(controller.assessWorkflowCycle(input).qualified, true)
  input.requests[1].usage.inputTokens++; input.requests[1].usage.totalTokens++
  assert.equal(controller.assessWorkflowCycle(input).qualified, false)
  assert.equal(controller.assessWorkflowCycle({ ...input, compressionProfile: 'baseline' }).qualified, true)
  for (const mutate of [row => { row.requests[0].nativeUsageVerified = false }, row => { row.retrieval.verified = false }, row => { row.commit.committed = false }, row => { row.grade.passed = false }]) { const row = proof(); mutate(row); assert.equal(controller.assessWorkflowCycle(row).qualified, false) }
})
test('pure native compression audit distinguishes summary proof from paired tool result prunes', () => {
  const events = [{ seq: 90, type: 'tool/result', data: { message: { toolCallId: 'report' } } }, { seq: 100, type: 'compaction/summary', data: { shadowedSeqs: [90] } }, { seq: 101, type: 'user/message', surfaceOp: { op: 'replace', startSeq: 90, endSeq: 90 }, data: { source: { kind: 'compact-checkpoint' } } }]
  const sealed = new Map([[101, { verified: true, kind: 'native-template-summary', summarySeq: 100, endSeq: 102, sourceSeqs: [90], replacedCallIds: ['report'] }]])
  const evidence = controller.workflowPruneEvidence({ events, beforeSeq: 100, archiveProofs: sealed })
  assert.deepEqual(evidence, { pruneSeqs: [], summarySeqs: [100], shadowedSeqs: [90], replacedCallIds: ['report'] })
  const group = { ...evidence, nativeBoundary: 100, nextRequestSequence: 2, beforeGeneration: 0, afterGeneration: 1 }, requests = [{ sequence: 2, nativeBoundary: 103 }]
  assert.equal(controller.workflowNativeCompressionAudit({ events, groups: [group], requests, archiveProofs: sealed }), true)
  assert.equal(controller.workflowNativeCompressionAudit({ events, groups: [group], requests }), false)
})
test('asynchronous disk judge loads archives itself and fails closed for invented archive/profile claims', async () => {
  assert.equal(typeof controller.judgeOcgWorkflowWithArchives, 'function')
  assert.equal(typeof controller.judgeOcgWorkflow({ events: [], result: {} }).then, 'undefined', 'Old synchronous API stays synchronous')
  const result = { compressionProfile: 'archive-130k', limits: { postCompressionCapTokens: 130000, contextCapTokens: 500000, contextTriggerTokens: 420000, archiveProtocol: 'native-template-summary-v1' }, sessionId: 'root', memoryProjectId: 'project' }
  const audit = await controller.judgeOcgWorkflowWithArchives({ events: [{ seq: 1, type: 'user/message', data: { source: { kind: 'compact-checkpoint', compactionId: 'arc_' + 'a'.repeat(64) } } }], result, compressionProfile: 'archive-130k', projectDir: '/missing', ultraRoot: '/missing', runtimeRoot: '/missing', archiveProofs: new Map([[1, { verified: true }]]) })
  assert.equal(audit.passed, false); assert.equal(audit.acceptancePassed, false)
  assert.equal((await controller.judgeOcgWorkflowWithArchives({ events: [], result, compressionProfile: 'baseline' })).passed, false)
})
test('workflow support and both companion build closures contain all transitive local dependencies', async () => {
  const files = runner.ocgSupportFiles('workflow')
  for (const file of ['archive-proof.mjs', 'recovery-policy.mjs']) assert.ok(files.includes(file))
  const build = fs.readFileSync(path.join(root, 'scripts/build-companions.mjs'), 'utf8')
  for (const file of files) assert.ok(build.includes("'" + file + "'"), 'Companion build closure: ' + file)
  const standalone = fs.mkdtempSync(path.join(os.tmpdir(), 'ocg-standalone-closure-'))
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(standalone, file)), { recursive: true }); fs.copyFileSync(path.join(root, 'scripts/host-acceptance', file), path.join(standalone, file)) }
  const imported = await import(pathToFileURL(path.join(standalone, 'ocg-workflow-plugin.mjs')).href)
  assert.equal(typeof imported.runWorkflow, 'function'); assert.equal(typeof imported.judgeOcgWorkflowWithArchives, 'function')
})
test('each standalone companion acceptance snapshot imports from its own complete directory', async t => {
  assert.equal(typeof companionBuild.companionAcceptanceFiles, 'function')
  for (const variant of ['memory', 'decision']) {
    const files = companionBuild.companionAcceptanceFiles(variant), known = new Set(files)
    for (const file of runner.ocgSupportFiles('workflow')) assert.ok(known.has(file), variant + ': ' + file)
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocg-companion-closure-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    for (const file of files) {
      const source = path.join(root, 'scripts/host-acceptance', file), target = path.join(directory, file)
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target)
      const text = fs.readFileSync(source, 'utf8')
      if (file.endsWith('.mjs')) {
        const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
        const check = literal => { if (literal && ts.isStringLiteral(literal) && literal.text.startsWith('.')) { const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), literal.text)); assert.ok(known.has(relative), variant + ': missing ' + relative) } }
        const visit = node => { if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) check(node.moduleSpecifier); else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) check(node.arguments[0]); ts.forEachChild(node, visit) }
        visit(sourceFile)
      }
    }
    const imported = await import(pathToFileURL(path.join(directory, 'run-ocg-profile.mjs')).href)
    assert.equal(typeof imported.main, 'function'); assert.equal(imported.ocgScenarioSettings('workflow', 'ultra-mode', 1000, 'archive-130k').contextArchiveCompletedTurns, true)
  }
})
