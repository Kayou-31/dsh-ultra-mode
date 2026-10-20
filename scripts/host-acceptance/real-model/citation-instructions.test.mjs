import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareTurnPrompt, longRepairPrompt } from './driver.mjs'
import { prompts } from './fixture.mjs'

test('verified ordinary final explicitly requests both resource IDs required by the supplemental oracle', () => {
  const { prompt } = prepareTurnPrompt(prompts.longFinal, { requireVerifiedCitations: true }, 's2-resume')
  assert.match(prompt, /vendor-a、vendor-b/)
  assert.match(prompt, /即使.*alpha.*beta.*已能证明/)
  assert.match(prompt, /quote.*resourceId/)
})

test('ordinary final without supplemental verification keeps the original prompt', () => {
  assert.equal(prepareTurnPrompt(prompts.longFinal, {}, 's2-resume').prompt, prompts.longFinal)
})

test('a bounded final repair is a final delivery and retains the same explicit citation obligations', () => {
  const { prompt, isFinal } = prepareTurnPrompt(longRepairPrompt, { requireVerifiedCitations: true, driftStress: true }, 'long-repair')
  assert.equal(isFinal, true)
  assert.match(prompt, /vendor-a、vendor-b/)
  assert.match(prompt, /额外输出 activeDecisionId/)
})
