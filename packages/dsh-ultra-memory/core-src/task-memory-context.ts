import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Only our exact, single-section native projection may leave the capsule.
 * Mixed/unknown snapshots retain their literal text. Raw host history remains
 * in the archive manifest and is still available through its read-through. */
export function isTaskMemorySnapshot(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const data = event.data as unknown as { source?: Record<string, any>; content?: Record<string, any>[] }
  const source = data.source, content = data.content
  if (source?.kind !== 'runtime-context' || source.form !== 'snapshot'
    || Object.keys(source).some(key => !['kind', 'form', 'sections'].includes(key))
    || !Array.isArray(source.sections) || source.sections.length !== 1 || !Array.isArray(content) || content.length !== 1) return false
  const section = source.sections[0], block = content[0]
  return section?.name === 'ultra-task-memory' && typeof section.text === 'string'
    && Object.keys(section).every(key => ['name', 'text'].includes(key))
    && block.type === 'text' && Object.keys(block).every(key => ['type', 'text'].includes(key))
    && block.text === 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n' + section.text
}
