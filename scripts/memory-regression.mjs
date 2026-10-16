#!/usr/bin/env node
/** Keyless mechanism fixture, deliberately not a model quality A/B benchmark. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { EvidenceStore } from '../lib/evidence.js'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-long-fixture-'))
const access = { projectId: 'long-fixture', sessionIds: ['root', 'worker-a', 'worker-b', 'decision'] }
const start = performance.now()
try {
  let store = new EvidenceStore(directory)
  const markers = ['ONE_TIME_NO_PUBLICATION', 'TOOL_TAIL_4711', 'WORKER_A_CONFLICT', 'WORKER_B_CONFLICT']
  const originals = [markers[0], 'ordinary-tool-result '.repeat(10000) + markers[1], 'same question: ' + markers[2], 'same question: ' + markers[3]]
  const sessions = ['root', 'worker-a', 'worker-a', 'worker-b']
  const sources = originals.map((text, index) => store.capture({ projectId: access.projectId, runId: 'fixture', sessionId: sessions[index], routeId: sessions[index], eventId: 'important-' + index, at: index, kind: index === 0 ? 'user' : 'tool', text }))
  for (let i = 0; i < 160; i++) store.capture({ projectId: access.projectId, runId: 'fixture', sessionId: i % 2 ? 'worker-a' : 'worker-b', routeId: i % 2 ? 'a' : 'b', eventId: 'later-' + i, at: i + 10, kind: 'tool', text: 'later progress '.repeat(20) + i })
  const old = store.addSemantic({ projectId: access.projectId, kind: 'decision', text: 'old conclusion', sourceIds: [sources[2].id] })
  store.addSemantic({ projectId: access.projectId, kind: 'decision', text: 'new conclusion', sourceIds: [sources[2].id, sources[3].id], supersedes: [old.id] })
  store = new EvidenceStore(directory)
  const queryStart = performance.now()
  const recovered = []
  for (const marker of markers) { const hits = await store.search(access, { query: marker, maxChars: 3000 }); assert.ok(hits.items.length); recovered.push(marker) }
  const get = await store.get(access, sources[1].id, { offset: originals[1].length - 100, maxChars: 2000 }); assert.match(get.text, /TOOL_TAIL_4711/)
  const bounded = await store.search(access, { maxChars: 2048, limit: 100 }); assert.ok(JSON.stringify(bounded).length <= 2048)
  await assert.rejects(store.get({ projectId: 'another', sessionIds: ['worker-a'] }, sources[1].id), /access|authorized|denied|inaccessible/i)
  const report = {
    schema: 1, kind: 'deterministic-local-mechanism-fixture', collectedAt: new Date().toISOString(),
    sourceBase: 'ecf056fdc7d7777250cab4b20af6fc1c03372119', fixtureSources: store.stats(access).raw.sources,
    recovery: { expected: markers.length, retrieved: recovered.length, rate: recovered.length / markers.length, afterRestart: true },
    summaryFixture: { strategy: 'tail of recent progress only; excludes the four known markers', recoverableMarkers: 0, originalUltraRun: false },
    resultBudget: { requestedChars: 2048, actualSerializedChars: JSON.stringify(bounded).length },
    localLatencyMs: { indexingAndRecovery: +(performance.now() - start).toFixed(2), retrievalPhase: +(performance.now() - queryStart).toFixed(2) },
    modelComparison: { status: 'not-run', reason: 'This deterministic mechanism script performs no model comparison. Separate authorized real-model observations are reported in model-verification.json; no complete captured historical baseline is available.', originalUltra: null, newUltra: null, taskQuality: null, constraintOmissions: null, totalTokens: null, modelLatency: null, rework: null },
  }
  const destination = process.argv[2]
  if (destination) { fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n') }
  console.log(JSON.stringify(report, null, 2))
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
