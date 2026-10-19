import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createCollaborationAudit, readCollaborationAudit } from '../lib/model-pool-audit.js'
for (const [name, unit] of [['newlines', 'x\n'], ['backslashes', '\\']]) test(`durable model audit restores legal long escaped ${name} across evidence chunks`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-pool-audit-'))
  try {
    const owner = { id: 'parent', session: { header: { cwd: root } } }, audit = createCollaborationAudit(owner)
    const value = unit.repeat(Math.floor(20000 / unit.length))
    const record = { id: 'child', parentId: 'parent', taskName: 'long', task: value, text: value, status: 'completed', revision: 9,
      model: { selectedConfigId: 'local', provider: 'p', model: 'm', source: 'agent', reason: 'One short reason', compatibility: { input: 'host-declared', tools: 'unknown-user-allowed', outputLimit: 'host-default' } } }
    audit.write({ runId: 'test', record })
    const restored = await readCollaborationAudit(owner)
    assert.equal(restored.length, 1); assert.equal(restored[0].task, value); assert.equal(restored[0].text, value)
    assert.equal((await readCollaborationAudit({ ...owner, id: 'other-parent' })).length, 0)
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
