import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { grade } from './grade.mjs';

const organizer = fileURLToPath(new URL('.', import.meta.url));
const caseRoot = resolve(organizer, '..');
const staging = await mkdtemp(join(organizer, '.selftest-tmp-'));
const results = [];
async function candidate(name, clean = true) {
  const dir = join(staging, name);
  await cp(join(caseRoot, 'challenge'), dir, { recursive: true });
  if (clean) await cp(join(organizer, 'reference'), dir, { recursive: true, force: true });
  return dir;
}
async function verify(name, dir, expectedAccepted) {
  const result = await grade(dir);
  assert.equal(result.accepted, expectedAccepted, name + ': acceptance mismatch');
  assert.equal(new Set(result.checks.map(c => c.id)).size, result.total);
  assert.equal(result.passed, result.checks.filter(c => c.passed).length);
  const portable = structuredClone(result);
  for (const c of portable.checks) {
    if (c.message.includes('could not load:')) c.message = 'Candidate module or diagnosis could not load (local path details omitted from portable selftest evidence)';
  }
  results.push({ variant: name, ...portable });
  return result;
}
async function replace(dir, file, oldText, newText) {
  const path = join(dir, file); const body = await readFile(path, 'utf8');
  assert.equal(body.split(oldText).length - 1, 1, 'Mutation anchor must be unique');
  await writeFile(path, body.replace(oldText, newText));
}
try {
  await verify('faulty-baseline', await candidate('baseline', false), false);
  const reference = await verify('reference', await candidate('reference'), true); assert.equal(reference.passed, 17);
  const limiter = await candidate('limiter-scope-reversion');
  await replace(limiter, 'src/limiter.mjs', 'JSON.stringify([tenantId, route, window])', 'JSON.stringify([route, window])');
  const r1 = await verify('only-limiter-scope-reverted', limiter, false);
  assert.ok(r1.checks.find(c => c.id === 'mixed-tenants-reverse-order' && !c.passed));
  const retry = await candidate('429-retry-reversion');
  await replace(retry, 'src/retry.mjs', '[500, 502, 503, 504]', '[429, 500, 502, 503, 504]');
  const r2 = await verify('only-429-retry-reverted', retry, false);
  assert.ok(r2.checks.find(c => c.id === '429-does-not-amplify-database-reads' && !c.passed));
  const diagnosis = await candidate('false-lead-diagnosis');
  await cp(join(caseRoot, 'challenge/outputs/diagnosis.json'), join(diagnosis, 'outputs/diagnosis.json'), { force: true });
  const r3 = await verify('only-diagnosis-reverted', diagnosis, false);
  assert.ok(r3.checks.find(c => c.id === 'root-cause-not-coincident-deployment' && !c.passed));
  const noLimit = await candidate('limiter-disabled');
  await replace(noLimit, 'src/limiter.mjs', 'if (used >= limit)', 'if (false)');
  const r4 = await verify('escape-disable-limiter', noLimit, false);
  assert.ok(r4.checks.find(c => c.id === 'quota-still-enforced-per-tenant' && !c.passed));
  const noRetry = await candidate('all-retries-disabled');
  await replace(noRetry, 'src/retry.mjs', 'return [500, 502, 503, 504].includes(status) && attempt < maxAttempts;', 'return false;');
  const r5 = await verify('escape-disable-all-retries', noRetry, false);
  assert.ok(r5.checks.find(c => c.id === 'upstream-transient-retry-retained' && !c.passed));
  const missing = await verify('missing-candidate', join(staging, 'does-not-exist'), false); assert.equal(missing.passed, 0);
  const broken = await candidate('syntax-error');
  await writeFile(join(broken, 'src/service.mjs'), 'export const broken = ;\n');
  await verify('syntax-error', broken, false);
  const badJson = await candidate('invalid-json');
  await writeFile(join(badJson, 'outputs/diagnosis.json'), '{invalid');
  const jsonResult = await verify('invalid-diagnosis-json', badJson, false);
  assert.ok(jsonResult.checks.find(c => c.id === 'typed-diagnosis-contract' && !c.passed));
  const hashes = {};
  for (const relative of ['grade.mjs', '../challenge/src/limiter.mjs', '../challenge/src/retry.mjs', '../challenge/outputs/diagnosis.json', 'reference/src/limiter.mjs', 'reference/src/retry.mjs', 'reference/outputs/diagnosis.json']) {
    hashes[relative] = createHash('sha256').update((await readFile(resolve(organizer, relative), 'utf8')).replace(/\r\n/g, '\n')).digest('hex');
  }
  const evidence = { caseId: 'incident-triage', nodeVersion: process.version, result: 'passed', noModelOrNetworkCalls: true, messagesSanitized: true,
    scope: 'One local selftest run: frozen baseline, reference overlay, isolated limiter/retry/diagnosis reversions, capability-disable escapes and invalid candidate reporting.', sourceHashes: hashes, results };
  await writeFile(join(organizer, 'selftest-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(results.map(r => ({ variant: r.variant, passed: r.passed, total: r.total, failed: r.total - r.passed, criticalFailures: r.criticalFailures }))));
} finally {
  const checked = await realpath(staging);
  const parent = await realpath(organizer);
  assert.ok(checked.startsWith(parent + '\\') || checked.startsWith(parent + '/'));
  assert.ok(checked.split(/[\\/]/).at(-1).startsWith('.selftest-tmp-'));
  await rm(checked, { recursive: true, force: true });
}
