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
    if (c.message.includes('could not load:')) c.message = 'Candidate entry could not load (local path details omitted from portable selftest evidence)';
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
  const reference = await verify('reference', await candidate('reference'), true);
  assert.equal(reference.passed, 17);
  const retry = await candidate('request-id-reversion');
  await replace(retry, 'src/webhook.mjs', 'const eventKey = event.eventId;', 'const eventKey = event.requestId;');
  const r1 = await verify('only-idempotency-reverted', retry, false);
  assert.ok(r1.checks.find(c => c.id === 'stable-event-new-request-retry' && !c.passed));
  const tenant = await candidate('tenant-key-reversion');
  await replace(tenant, 'src/cache.mjs', 'return JSON.stringify([tenantId, accountId]);', 'return accountId;');
  const r2 = await verify('only-tenant-cache-reverted', tenant, false);
  assert.ok(r2.checks.find(c => c.id === 'tenant-visible-balance-isolation' && !c.passed));
  const commit = await candidate('precommit-cache-reversion');
  await replace(commit, 'src/webhook.mjs', 'await tx.commit();\n    cache.set(balanceCacheKey(event.tenantId, event.accountId), balanceCents);', 'cache.set(balanceCacheKey(event.tenantId, event.accountId), balanceCents);\n    await tx.commit();');
  const r3 = await verify('only-precommit-cache-reverted', commit, false);
  assert.ok(r3.checks.find(c => c.id === 'failed-commit-no-visible-phantom' && !c.passed));
  const noCache = await candidate('cache-disabled');
  await replace(noCache, 'src/service.mjs', 'if (hit !== undefined) return hit;', 'void hit;');
  const r4 = await verify('escape-disable-cache', noCache, false);
  assert.ok(r4.checks.find(c => c.id === 'cache-remains-effective' && !c.passed));
  await verify('missing-candidate', join(staging, 'does-not-exist'), false);
  const broken = await candidate('syntax-error');
  await writeFile(join(broken, 'src/service.mjs'), 'export const broken = ;\n');
  const syntax = await verify('syntax-error', broken, false); assert.equal(syntax.passed, 0);
  const hashes = {};
  for (const relative of ['grade.mjs', '../challenge/src/cache.mjs', '../challenge/src/webhook.mjs', 'reference/src/cache.mjs', 'reference/src/webhook.mjs']) {
    hashes[relative] = createHash('sha256').update((await readFile(resolve(organizer, relative), 'utf8')).replace(/\r\n/g, '\n')).digest('hex');
  }
  const evidence = { caseId: 'payment-consistency', nodeVersion: process.version, result: 'passed', noModelOrNetworkCalls: true, messagesSanitized: true,
    scope: 'One local selftest run: frozen baseline, reference overlay, three isolated defect reversions, cache-disable escape and invalid candidate reporting.', sourceHashes: hashes, results };
  await writeFile(join(organizer, 'selftest-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(results.map(r => ({ variant: r.variant, passed: r.passed, total: r.total, failed: r.total - r.passed, criticalFailures: r.criticalFailures }))));
} finally {
  const checked = await realpath(staging);
  const parent = await realpath(organizer);
  assert.ok(checked.startsWith(parent + '\\') || checked.startsWith(parent + '/'));
  assert.ok(checked.split(/[\\/]/).at(-1).startsWith('.selftest-tmp-'));
  await rm(checked, { recursive: true, force: true });
}
