#!/usr/bin/env node
/** Browser bundle for the DSH runtime module loader; no bundled host React. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

export async function buildClient() {
  let build
  try {
    ;({ build } = await import('esbuild'))
  } catch {
    throw new Error('esbuild is missing. Run npm install in this project before building.')
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error('package.json must define the DSH plugin name')
  }
  await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, 'src', 'client', 'index.ts')],
    outfile: path.join(root, 'lib', 'client.js'),
    bundle: true,
    splitting: false,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    sourcemap: 'linked',
    sourcesContent: true,
    charset: 'utf8',
    legalComments: 'eof',
    // These services are supplied by DSH's browser module loader. Bundling
    // another React copy breaks hooks when rendering inside host components.
    external: [
      'react', 'react/*', 'react-dom', 'react-dom/*',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-*',
      'cordis',
    ],
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
    },
    footer: { js: 'return module.exports;\n} });' },
    logLevel: 'info',
  })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await buildClient()
  } catch (error) {
    console.error(`build:client: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
