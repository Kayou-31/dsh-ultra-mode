/** Native request assembly and ToolRuntime only; scripted adapter, no model/network. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
const names = ['cordis', 'dsh-llm', 'dsh-scope', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop']
let sdk, unavailable
try { sdk = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(process.env.DSH_ULTRA_TEST_SDK
  ? pathToFileURL(path.resolve(process.env.DSH_ULTRA_TEST_SDK, '@deepseek-ai', name, 'lib/index.js')).href : `@deepseek-ai/${name}`)]))) }
catch (error) { if (process.env.DSH_ULTRA_TEST_SDK || error.code !== 'ERR_MODULE_NOT_FOUND') throw error; unavailable = 'Native public DSH peers unavailable' }
const { EvidenceStore } = await import('../lib/evidence.js')
const memoryTools = sdk && await import('../lib/memory-tools.js')
const textOf = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')

test('native assembled requests contain source-only guidance, then precise search and verified source readback', { skip: unavailable }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-retrieval-loop-'))
  const ctx = new sdk.cordis.Context(), requests = [], sessionId = 'memory-retrieval-' + randomUUID()
  let handle, uninstall
  t.after(async () => { uninstall?.(); await handle?.dispose(); await ctx.fiber.dispose(); fs.rmSync(directory, { recursive: true, force: true }) })
  for (const [name, config] of [['dsh-llm'], ['dsh-session'], ['dsh-session-projection'], ['dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false }], ['dsh-tools', { mode: 'native' }], ['dsh-agent'], ['dsh-agent-loop', { agents: [] }]]) await ctx.plugin(sdk[name].default, config).await()
  const store = new EvidenceStore(directory), access = { projectId: 'project', sessionIds: [sessionId] }, secret = 'case-' + randomUUID()
  const body = 'Ordinary entry. '.repeat(600) + '\ncaseNumber = ' + secret + '\n' + 'Trailing entry. '.repeat(250)
  const record = store.capture({ projectId: 'project', sessionId, runId: 'r', routeId: 'main', eventId: 'tool-1', at: 100, kind: 'tool/result:read_file', text: body, origin: { tool: 'read_file', callId: 'original-call', resourceId: 'local-ledger' } })
  uninstall = memoryTools.installMemoryTools(ctx, { config: { evidenceEnabled: true }, access: agent => ({ active: agent.id === sessionId }), search: (_agent, args) => store.search(access, args), get: (_agent, id, args) => store.get(access, id, args) })
  class Offline extends sdk['dsh-llm'].LlmAdapter {
    async resolveModel(provider, model) { assert.equal(provider, 'retrieval-offline'); return { provider, id: model, name: 'Local protocol adapter', context: { contextWindow: 1000000 } } }
    async *stream(options) {
      requests.push(options)
      const count = requests.length
      assert.ok(count <= 4, 'Scripted protocol has exactly four requests')
      const searchTool = options.tools.find(tool => tool.name === 'ultra_memory_search')
      assert.match(searchTool.description, /来源标识.*摘录不是全文/)
      assert.match(searchTool.description, /nextOffset/)
      let block
      if (count === 1) block = { type: 'tool-call', name: 'ultra_memory_search', arguments: JSON.stringify({ query: 'local-ledger', kind: 'tool/result', maxChars: 1200 }) }
      else {
        const value = JSON.parse(textOf(options.messages.findLast(message => message.role === 'tool')))
        if (count === 2) {
          assert.match(value.retrievalHint, /摘录不是全文/)
          assert.equal(value.items[0].match, 'source-identity')
          assert.equal(value.items[0].sourceId, record.id)
          assert.equal(value.items[0].sourceChars, body.length)
          assert.ok(!value.items[0].excerpt.includes(secret))
          block = { type: 'tool-call', name: 'ultra_memory_search', arguments: JSON.stringify({ id: value.items[0].sourceId, query: 'caseNumber', kind: 'tool/result', maxChars: 1200 }) }
        } else if (count === 3) {
          assert.ok(value.items[0].excerpt.includes(secret))
          block = { type: 'tool-call', name: 'ultra_memory_get', arguments: JSON.stringify({ id: value.items[0].sourceId, quote: 'caseNumber = ' + secret, maxChars: 1200 }) }
        } else {
          assert.equal(value.citation.sourceId, record.id)
          assert.equal(value.citation.sha256, record.sha256)
          assert.equal(value.citation.quote, 'caseNumber = ' + secret)
          block = { type: 'text', text: 'Verified exact original source after precise retrieval.' }
        }
      }
      if (block.type === 'tool-call') block.id = sdk['dsh-llm'].ToolCallId('retrieval-call-' + count)
      yield { type: 'block-start', index: 0, blockType: block.type }
      if (block.type === 'tool-call') yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
      else yield { type: 'text-delta', index: 0, text: block.text }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['retrieval-offline'], new Offline())
  handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'retrieval-offline', model: 'script', maxTokens: 256 } })
  await ctx.agents.withInitiator(handle.agent, async () => { handle.agent.followup(sdk['dsh-llm'].createUserMessage({ content: [{ type: 'text', text: 'Recover a source from the local synthetic ledger.' }], source: { kind: 'user' } })); await handle.agent.whenIdle() })
  assert.equal(handle.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'completed')
  assert.equal(requests.length, 4)
  assert.deepEqual(handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message.isError), [false, false, false])
})
