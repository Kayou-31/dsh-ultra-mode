#!/usr/bin/env node
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { compareReports, exportCase, getCases, gradeCase, selftest } from '../benchmarks/lib.mjs'

const help = [
  'DSH Ultra business fixture tools (no model calls)',
  '  node scripts/benchmarks.mjs list',
  '  node scripts/benchmarks.mjs export --case ID --out PATH [--variant faulty|clean]',
  '  node scripts/benchmarks.mjs grade --case ID --workspace PATH [--report FILE] [--mode LABEL] [--model LABEL] [--metrics FILE]',
  '  node scripts/benchmarks.mjs compare --left REPORT --right REPORT [--report FILE]',
  '  node scripts/benchmarks.mjs selftest [--report FILE]',
  'Reports are written with exclusive creation; existing files are never replaced.',
  'Export parents must exist. Candidate code executes locally; this is not a security sandbox.',
].join('\n')
function options(args) {
  const output = {}
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]
    if (!name?.startsWith('--') || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(output, name.slice(2))) {
      throw new Error('Options require unique --name value pairs')
    }
    output[name.slice(2)] = args[i + 1]
  }
  return output
}
function allowed(opts, names) {
  for (const name of Object.keys(opts)) if (!names.includes(name)) throw new Error('Unknown option: --' + name)
}
function required(opts, names) {
  for (const name of names) if (!opts[name]) throw new Error('Missing --' + name)
}
async function emit(value, report) {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (report) await writeFile(path.resolve(report), text, { flag: 'wx' })
  process.stdout.write(text)
}
try {
  const [command = 'help', ...rest] = process.argv.slice(2)
  if (command === 'help' || command === '--help') {
    process.stdout.write(help + '\n')
  } else {
    const opts = options(rest)
    if (command === 'list') {
      allowed(opts, [])
      const cases = (await getCases()).map(({ id, title, description, suggestedMode }) => ({ id, title, description, suggestedMode }))
      await emit({ cases })
    } else if (command === 'export') {
      allowed(opts, ['case', 'out', 'variant'])
      required(opts, ['case', 'out'])
      await emit(await exportCase(opts.case, opts.out, opts.variant))
    } else if (command === 'grade') {
      allowed(opts, ['case', 'workspace', 'report', 'mode', 'model', 'metrics'])
      required(opts, ['case', 'workspace'])
      const metrics = opts.metrics ? JSON.parse(await readFile(path.resolve(opts.metrics), 'utf8')) : undefined
      const result = await gradeCase(opts.case, opts.workspace, { mode: opts.mode, model: opts.model, metrics })
      await emit(result, opts.report)
      if (!result.accepted) process.exitCode = 2
    } else if (command === 'compare') {
      allowed(opts, ['left', 'right', 'report'])
      required(opts, ['left', 'right'])
      const left = JSON.parse(await readFile(path.resolve(opts.left), 'utf8'))
      const right = JSON.parse(await readFile(path.resolve(opts.right), 'utf8'))
      await emit(compareReports(left, right), opts.report)
    } else if (command === 'selftest') {
      allowed(opts, ['report'])
      await emit(await selftest(), opts.report)
    } else throw new Error('Unknown command: ' + command)
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
