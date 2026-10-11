import { pathToFileURL } from 'node:url'
const [grader, workspace] = process.argv.slice(2)
try {
  const module = await import(pathToFileURL(grader).href)
  if (typeof module.grade !== 'function') throw new Error('Grader must export grade(candidateDir)')
  const result = await module.grade(workspace)
  process.stdout.write('@@ULTRA_BENCHMARK_RESULT@@' + JSON.stringify(result) + '\n')
} catch (error) {
  process.stderr.write('Grading failed: ' + (error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
