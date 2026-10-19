/** Model audit metadata uses the existing project evidence authority, not host history. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { EvidenceStore } from './evidence.js'
import type { TeamSnapshot } from './collaboration.js'

interface AuditOwner { id: string; session: { header: { cwd?: string } } }
function location(parent: AuditOwner, create: boolean) {
  const raw = parent.session.header.cwd
  if (!raw || !path.isAbsolute(raw)) throw Error('模型池审计需要宿主提供绝对项目目录')
  const cwd = fs.realpathSync.native(raw)
  const projectId = createHash('sha256').update(process.platform === 'win32' ? cwd.toLowerCase() : cwd).digest('hex')
  let directory = cwd
  for (const part of ['.dsh-ultra', 'v1', 'records']) {
    directory = path.join(directory, part)
    if (fs.existsSync(directory)) {
      const stat = fs.lstatSync(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('模型池审计拒绝链接或非目录存储路径')
    } else if (create) fs.mkdirSync(directory, { mode: 0o700 })
    else return undefined
  }
  return { projectId, directory: path.dirname(directory), access: { projectId, sessionIds: [parent.id] } }
}
export function createCollaborationAudit(parent: AuditOwner) {
  let sequence = 0, store: EvidenceStore | undefined
  return { write({ runId, record }: { runId: string; record: TeamSnapshot }): void {
    const project = location(parent, true)!
    store ??= new EvidenceStore(project.directory)
    store.capture({ projectId: project.projectId, runId, sessionId: parent.id, routeId: record.id,
      eventId: `model:${runId}:${++sequence}`, at: Date.now(), kind: 'collaboration/model', coverage: 'captured',
      text: JSON.stringify({ runId, record }), topics: ['协作选模审计'] })
  } }
}
export async function readCollaborationAudit(parent: AuditOwner): Promise<TeamSnapshot[]> {
  const project = location(parent, false)
  if (!project) return []
  const store = new EvidenceStore(project.directory), records = new Map<string, TeamSnapshot>()
  for (const source of store.recordsFor(project.access)) {
    if (source.kind !== 'collaboration/model') continue
    // Model-facing budgets count JSON escaping. Read small verified chunks so a
    // legal long report with many backslashes cannot become an empty source page.
    let body = ''
    for (const chunk of source.chunks) {
      const page = await store.get(project.access, chunk.id, { maxChars: 64000 })
      if (page.status !== 'captured' || page.offset !== chunk.start || page.nextOffset !== undefined || page.text.length !== chunk.end - chunk.start || body.length < chunk.start) throw Error('模型池审计记录不完整或校验失败')
      body = body.slice(0, chunk.start) + page.text
    }
    if (body.length !== source.length || createHash('sha256').update(body).digest('hex') !== source.sha256) throw Error('模型池审计记录校验失败')
    const value = JSON.parse(body) as { record?: TeamSnapshot }, record = value.record
    if (!record || typeof record.id !== 'string' || typeof record.revision !== 'number' || !record.model) throw Error('模型池审计记录结构无效')
    const previous = records.get(record.id)
    if (!previous || record.revision >= previous.revision) records.set(record.id, record)
  }
  return [...records.values()].slice(-128)
}
