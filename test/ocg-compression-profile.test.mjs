import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as runner from '../scripts/host-acceptance/run-ocg-profile.mjs'
import { chooseWorkflowReportRows } from '../scripts/host-acceptance/ocg-workflow-plugin.mjs'

test('workflow efficiency is explicit and baseline settings remain unchanged', () => {
  const baseline = runner.ocgScenarioSettings('workflow', 'ultra-mode', 1000)
  assert.equal(baseline.contextTargetTokens, 420000)
  assert.equal(baseline.contextTriggerTokens, undefined)
  assert.equal(baseline.contextRetrievalReceipts, undefined)
  assert.deepEqual(runner.ocgScenarioSettings('workflow', 'ultra-mode', 1000, 'baseline'), baseline)
  const efficient = runner.ocgScenarioSettings('workflow', 'ultra-mode', 1000, 'efficient')
  assert.equal(efficient.contextTargetTokens, 30000)
  assert.equal(efficient.contextTriggerTokens, 420000)
  assert.equal(efficient.contextRetainRecentMessages, 2)
  assert.equal(efficient.contextOutputReserveTokens, 8192)
  assert.equal(efficient.contextToolReserveTokens, 2048)
  assert.equal(efficient.contextMinResultChars, 64)
  assert.equal(efficient.contextMaxPrunes, 256)
  assert.equal(efficient.contextPreviewChars, 0)
  assert.equal(efficient.contextCompactLocators, true)
  assert.equal(efficient.contextRetrievalReceipts, true)
  assert.throws(() => runner.ocgScenarioSettings('workflow', 'ultra-mode', 1000, 'arbitrary'))
  for (const scenario of ['s0', 'pool', 'knowledge']) assert.throws(() => runner.ocgScenarioSettings(scenario, 'ultra-mode', 1000, 'efficient'))
})

test('workflow launch receipt reports exact compression settings and preserves explicit profile provenance', () => {
  const bootstrap = { provider: 'opencode-go', mainModel: 'deepseek-v4.1-flash', providerConfig: { models: [{ id: 'deepseek-v4.1-flash' }] } }
  const rows = runner.ocgProfileRows({ runtime: '/runtime', work: '/work', installed: '/installed', support: '/support', bootstrap, scenario: 'workflow', concurrency: 1, maxRequests: 900, timeoutMs: 10800000, bundleName: '@dsh-external/dsh-ultra-mode', workflow: { fixtureSeed: 'same-source-seed', compressionProfile: 'efficient' } })
  const receipt = runner.ocgWorkflowLaunchReceipt(rows)
  assert.equal(receipt.fixtureSeed, 'same-source-seed')
  assert.equal(receipt.compressionProfile, 'efficient')
  assert.equal(receipt.compressionSettings.contextTargetTokens, 30000)
  assert.equal(receipt.compressionSettings.contextTriggerTokens, 420000)
  assert.equal(rows.find(row => row[0] === 'experiment')[2].compressionProfile, 'efficient')
  assert.equal(rows.find(row => row[0] === 'experiment')[2].reportTargetInputTokens, 445000)
  assert.equal(receipt.reportTargetInputTokens, 445000)
})

test('efficient report allocation leaves explicit pruning headroom without relaxing the 500K cap or cycle criterion', () => {
  const old = chooseWorkflowReportRows({ maxRows: 12000, pressureTokens: 30000, tokensPerRow: 400, calibrateOnly: false })
  const efficient = chooseWorkflowReportRows({ maxRows: 12000, pressureTokens: 30000, tokensPerRow: 400, calibrateOnly: false, targetInputTokens: 445000 })
  assert.equal(old.effectiveRows, 1000)
  assert.equal(old.targetInputTokens, 430000)
  assert.equal(efficient.effectiveRows, 1037)
  assert.equal(efficient.targetInputTokens, 445000)
  for (const targetInputTokens of [429999, 450001, 445000.5, NaN]) assert.throws(() => chooseWorkflowReportRows({ maxRows: 12000, pressureTokens: 30000, tokensPerRow: 400, calibrateOnly: false, targetInputTokens }))
})

test('workflow efficiency CLI validates controls before profile creation or credential access', async () => {
  const required = ['--runtime', '/missing', '--candidate', '/missing', '--candidate-sha256', '0'.repeat(64), '--work', '/unused', '--bootstrap', '/missing', '--concurrency', '1', '--max-requests', '900', '--timeout-ms', '1000']
  await assert.rejects(runner.main([...required, '--scenario', 'pool', '--workflow-compression-profile', 'efficient']), /Workflow controls/u)
  await assert.rejects(runner.main([...required, '--scenario', 'workflow', '--workflow-compression-profile', 'arbitrary']), /compression profile/iu)
  const help = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/host-acceptance/run-ocg-profile.mjs', import.meta.url)), '--help'], { encoding: 'utf8', windowsHide: true })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /workflow-compression-profile/u)
})
