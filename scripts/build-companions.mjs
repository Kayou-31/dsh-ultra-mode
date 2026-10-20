#!/usr/bin/env node
/** Sync optional self-contained packages from the single maintained core tree. */
import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { buildClient } from './build-client.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const slash = value => value.split(path.sep).join('/')
const sha256 = value => createHash('sha256').update(value).digest('hex')
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const groups = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))
  return groups.flat()
}
async function inventory(paths) {
  return Promise.all(paths.map(async filename => ({ path: slash(path.relative(root, filename)), sha256: sha256(await readFile(filename)) })))
}
/** One declared local closure for build snapshots and standalone import checks. */
export function companionAcceptanceFiles(variant) {
  if (!['memory', 'decision'].includes(variant)) throw new Error('Unknown companion variant')
  return ['knowledge-profile-plugin.mjs', 'real-model-global-limit.mjs', 'network-guard.cjs',
    'companion-decision-plugin.mjs', 'model-pool-live-driver.mjs', 'run-decision-loop-profile.mjs',
    'run-ocg-profile.mjs', 'ocg-network-guard.cjs', 'ocg-pool-plugin.mjs', 'ocg-knowledge-plugin.mjs', 'ocg-pool-README.md', 'ocg-report.mjs',
    'real-model/driver.mjs', 'real-model/fixture.mjs', 'real-model/read-completed-recovery.mjs',
    'ocg-workflow-plugin.mjs', 'workflow-fixture.mjs', 'archive-proof.mjs', 'recovery-policy.mjs',
    ...(variant === 'decision' ? ['run-companion-decision-profile.mjs'] : [])]
}

export async function buildCompanions() {
  const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const coreSources = await inventory((await files(path.join(root, 'src'))).filter(file => file.endsWith('.ts')))
  const provenance = { schemaVersion: 1, root: { name: rootManifest.name, version: rootManifest.version }, coreSources }
  await writeFile(path.join(root, 'SOURCE-MANIFEST.json'), JSON.stringify({ ...provenance, package: provenance.root, buildEntry: 'src/index.ts' }, null, 2) + '\n')
  for (const variant of ['memory', 'decision']) {
    const directory = path.join(root, 'packages', `dsh-ultra-${variant}`)
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
    await mkdir(path.join(directory, 'lib'), { recursive: true })
    // These snapshots are generated, never independently maintained algorithms.
    await cp(path.join(root, 'src'), path.join(directory, 'core-src'), { recursive: true })
    await cp(path.join(root, 'lib', 'types'), path.join(directory, 'lib', 'types'), { recursive: true })
    await copyFile(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'))
    const bundled = await build({
      absWorkingDir: root, entryPoints: [`src/${variant}-plugin.ts`], outfile: path.join(directory, 'lib', 'index.js'),
      bundle: true, format: 'esm', platform: 'node', target: 'node22', charset: 'utf8', sourcemap: 'linked',
      sourcesContent: true, external: ['@deepseek-ai/*', 'node:*'], metafile: true, logLevel: 'info',
    })
    for (const output of Object.values(bundled.metafile.outputs)) for (const dependency of output.imports) {
      if (dependency.external && !dependency.path.startsWith('@deepseek-ai/') && !dependency.path.startsWith('node:')) {
        throw new Error(`Companion has a non-native runtime dependency: ${dependency.path}`)
      }
    }
    if (variant === 'decision') await buildClient({ variant, manifest, outfile: path.join(directory, 'lib', 'client.js') })
    const frozen = companionAcceptanceFiles(variant)
    const acceptanceSources = []
    await mkdir(path.join(directory, 'scripts', 'host-acceptance'), { recursive: true })
    for (const filename of frozen) {
      const source = path.join(root, 'scripts', 'host-acceptance', filename)
      await mkdir(path.dirname(path.join(directory, 'scripts', 'host-acceptance', filename)), { recursive: true })
      await copyFile(source, path.join(directory, 'scripts', 'host-acceptance', filename))
      acceptanceSources.push(...await inventory([source]))
    }
    const buildSources = await inventory(['scripts/build-companions.mjs', 'scripts/build-client.mjs'].map(file => path.join(root, file)))
    await writeFile(path.join(directory, 'SOURCE-MANIFEST.json'), JSON.stringify({ ...provenance,
      package: { name: manifest.name, version: manifest.version }, buildEntry: `src/${variant}-plugin.ts`,
      packageEntry: 'src/index.ts', runtime: { entry: 'lib/index.js', sha256: sha256(await readFile(path.join(directory, 'lib', 'index.js'))) },
      externalImports: [...new Set(Object.values(bundled.metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path)))].sort(),
      buildSources, acceptanceSources,
    }, null, 2) + '\n')
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildCompanions()
}
