import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const semver = require('semver')
for (const file of ['package.json', 'packages/dsh-ultra-memory/package.json', 'packages/dsh-ultra-decision/package.json']) {
  test(`${file}: DSH installer accepts rc.3 and retained hosts, rejects unverified hosts`, () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)))
    for (const version of ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3']) {
      assert.ok(semver.satisfies(version, manifest.engines.dsh), `${manifest.name} engine rejects ${version}`)
      for (const [name, range] of Object.entries(manifest.peerDependencies)) {
        if (name.startsWith('@deepseek-ai/dsh-')) assert.ok(semver.satisfies(version, range), `${name} rejects ${version}`)
      }
    }
    for (const version of ['0.2.1-rc.1', '0.2.1-rc.4', '0.2.1', '0.3.0']) {
      assert.equal(semver.satisfies(version, manifest.engines.dsh), false, `unverified ${version} must not be advertised`)
    }
  })
}
