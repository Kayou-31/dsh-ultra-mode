#!/usr/bin/env node
/** Cross-platform build. Uses project dependencies installed by npm/pnpm. */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildClient } from './build-client.mjs'
import { buildCompanions } from './build-companions.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)

try {
  let tsc
  try {
    tsc = require.resolve('typescript/bin/tsc')
  } catch {
    throw new Error('TypeScript is missing. Run npm install in this project before building.')
  }
  // Launch the JavaScript CLI with this Node, avoiding .cmd/.sh and shell PATH.
  const compiled = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.json')], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  })
  if (compiled.error) throw compiled.error
  if (compiled.status !== 0) {
    process.exitCode = compiled.status ?? 1
  } else {
    await buildClient()
    await buildCompanions()
  }
} catch (error) {
  console.error(`build: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
