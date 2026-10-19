import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertArchiveEntry, claimFreshWork, inspectSessionJsonl } from '../scripts/host-acceptance/run-decision-loop-profile.mjs'
import { auditRedirectEffect } from '../scripts/host-acceptance/decision-loop-plugin.mjs'

test('decision driver requires a new independent profile and refuses even its own used root', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-driver-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const work = path.join(dir, 'new')
  assert.equal(claimFreshWork(work).work, fs.realpathSync(work))
  assert.throws(() => claimFreshWork(work), /new empty/)
  const old = path.join(dir, 'old'); fs.mkdirSync(old); fs.writeFileSync(path.join(old, 'old-profile.json'), '{}')
  assert.throws(() => claimFreshWork(old), /new empty/)
})

test('decision candidate extraction refuses traversal, absolute paths, special archive roots and backslashes', () => {
  for (const value of ['package/../x', '/package/lib/x', 'package/a\\b', 'package/C:/x', 'other/lib/index.js', 'package/./x']) assert.throws(() => assertArchiveEntry(value), /Unsafe/)
  assert.doesNotThrow(() => assertArchiveEntry('package/lib/index.js'))
})

test('persisted evidence requires actual JSONL event types, not tool descriptions or model claims', () => {
  assert.equal(inspectSessionJsonl('{"type":"request/header","data":{"text":"tool/result turn/end"}}\n').toolResultPresent, false)
  const parsed = inspectSessionJsonl('{"type":"tool/result","seq":1}\n{"type":"turn/end","seq":2}\n')
  assert.equal(parsed.toolResultPresent, true)
  assert.equal(parsed.turnEndPresent, true)
  assert.throws(() => inspectSessionJsonl('{"type":"tool/result"\n'), SyntaxError)
})

test('redirect acceptance separates visibility from behavior and requires a subsequent native fixture tool receipt', () => {
  const request = { sessionId: 'worker', sequence: 8, text: 'REDIRECT_CANARY' }
  const tool = { sessionId: 'worker', requestSequence: 8, file: 'verify.txt', isError: false, receipt: 'verified-42' }
  const options = { targetId: 'worker', canary: 'REDIRECT_CANARY', expectedFile: 'verify.txt', expectedReceipt: 'verified-42', diagnosticRequestSequence: 7 }
  assert.equal(auditRedirectEffect({ ...options, requests: [request], tools: [] }).stage, 'request-visible')
  assert.equal(auditRedirectEffect({ ...options, requests: [request], tools: [{ ...tool, requestSequence: 6 }] }).stage, 'request-visible')
  assert.equal(auditRedirectEffect({ ...options, requests: [request], tools: [{ ...tool, sessionId: 'other' }] }).stage, 'request-visible')
  assert.equal(auditRedirectEffect({ ...options, requests: [request], tools: [{ ...tool, isError: true }] }).stage, 'request-visible')
  assert.equal(auditRedirectEffect({ ...options, requests: [request], tools: [{ ...tool, receipt: 'generic tool completion' }] }).stage, 'request-visible')
  assert.equal(auditRedirectEffect({ ...options, requests: [request], tools: [tool] }).stage, 'effect-verified')
  assert.equal(auditRedirectEffect({ ...options, requests: [{ ...request, sequence: 6 }], tools: [tool] }).stage, 'unverified')
})
