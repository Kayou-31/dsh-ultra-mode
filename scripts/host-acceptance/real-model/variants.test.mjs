import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { buildFixtureCode, inspectFixtureVariant, stressVariantConfig } from './variants.mjs'
import { stressLoadIds } from './driver.mjs'

const source = fs.readFileSync(new URL('./fixture.mjs', import.meta.url), 'utf8')
const sha = value => createHash('sha256').update(value).digest('hex')
const moduleOf = code => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const legacyHashes = {
  control: '28756815885e2aac1588b3e4922d75b8d2efdeb77892ddf086a337e260c7eef0',
  'holdout-a': '82cdb6d7047d2dd2510e348b72bb9bf529737c39bd7f434db7ccd4a4d59e692c',
  extreme: '52efb653495772ff5eabaf989543eeaa4ac2d71e18aa80bdd6c789a950d26fde',
  'extreme-a': 'a1961189e639e972a9615a094b2e67081b41eea246dc47530cb66dfd95bf0530',
  drift: '00f7c18c076ae968380b6428518f7c098e6254aa1176cb2132ed07a577b17335',
  'drift-a': 'e7416a23f1b0fdaa526052e820340ed510d817247ab8c4199b1db0a424dcb245',
  'drift-b': '2aa8d0c8812c4af1510c7958d64329f7eb9c1b1501a54eb3643348ac936b18d0',
  'drift-c': '3944d8f2bb69f2a1943a855480277e5c3c0dc8ac31b8d958aff69319c1752638',
}

test('all existing variant generator bytes remain exactly unchanged', () => {
  for (const [variant, wanted] of Object.entries(legacyHashes)) assert.equal(sha(buildFixtureCode(source, variant)), wanted, variant)
})

test('diverse fixture is deterministic, natural ASCII, unique per load and safe for cold resume', async () => {
  const code = buildFixtureCode(source, 'drift-diverse')
  assert.equal(code, buildFixtureCode(source, 'drift-diverse'))
  const generated = await moduleOf(code), resumed = await moduleOf(code + '\n// independent cold import\n')
  const preflight = inspectFixtureVariant(generated, 'drift-diverse')
  assert.equal(preflight.loads.length, 20)
  assert.deepEqual(generated.manifest, resumed.manifest)
  assert.equal(new Set(preflight.loads.map(row => row.sha256)).size, 20)
  for (const row of preflight.loads) {
    const body = generated.fixtures[row.id]
    assert.equal(row.chars, 1_000_000)
    assert.equal(row.bytes, row.chars)
    assert.match(body, /ticket=/)
    assert.match(body, /path=\/srv\//)
    assert.match(body, /status=/)
    assert.match(body, /The operator/)
    assert.ok(body.includes(generated.driftExpected.v1))
    assert.equal(body.includes(generated.driftExpected.v3), false)
    assert.equal(body.includes(generated.expected.batch), false)
    assert.equal(body.includes(generated.expected.checksum), false)
    assert.equal(/[\u0080-\uffff]/u.test(body), false)
  }
  for (const text of Object.values(generated.fixtures)) {
    assert.equal(text.includes('JadeBatch-7319'), false)
    assert.equal(text.includes('MX9-42-Q7'), false)
  }
  assert.deepEqual(preflight.completedRounds, { beforeRestart: 23, afterRestart: 3, total: 26, cancelledTurns: 1 })
})

test('only exact diverse variant expands the load IDs and only long executes the 20 extra rounds', () => {
  assert.equal(stressLoadIds({}).length, 8)
  assert.equal(stressLoadIds({ variant: 'drift-c', stressLoadCount: 20 }).length, 8)
  assert.equal(stressLoadIds({ variant: 'drift-diverse-extra', stressLoadCount: 20 }).length, 8)
  assert.deepEqual(stressVariantConfig('drift-c', 'long'), {})
  for (const mode of ['long', 'resume', 'cancel-mid']) {
    const config = stressVariantConfig('drift-diverse', mode)
    assert.equal(config.stressLoadCount, 20)
    assert.equal(config.stressCycles, mode === 'long' ? 20 : 0)
    assert.equal(stressLoadIds({ variant: 'drift-diverse', ...config }).length, 20)
  }
})

test('preflight rejects target leakage, duplicate documents and wrong manifest hashes', async () => {
  const generated = await moduleOf(buildFixtureCode(source, 'drift-diverse'))
  const forged = { ...generated, fixtures: { ...generated.fixtures } }
  forged.fixtures['load-0'] = generated.expected.batch + forged.fixtures['load-0']
  assert.throws(() => inspectFixtureVariant(forged, 'drift-diverse'), /target|leak|size/i)
  forged.fixtures['load-0'] = forged.fixtures['load-1']
  assert.throws(() => inspectFixtureVariant(forged, 'drift-diverse'), /duplicate|hash/i)
  const wrong = { ...generated, manifest: { ...generated.manifest, 'load-0': { ...generated.manifest['load-0'], sha256: '0'.repeat(64) } } }
  assert.throws(() => inspectFixtureVariant(wrong, 'drift-diverse'), /hash/i)
  const wrongOriginal = { ...generated, manifest: { ...generated.manifest, 'payload-alpha': { ...generated.manifest['payload-alpha'], sha256: '0'.repeat(64) } } }
  assert.throws(() => inspectFixtureVariant(wrongOriginal, 'drift-diverse'), /hash/i)
})
