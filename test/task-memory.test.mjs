import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EvidenceStore } from '../lib/evidence.js'
import { buildTaskMemory, taskMemorySettings } from '../lib/task-memory.js'

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-memory-'))
  t.after(() => fs.rmSync(directory, {recursive:true,force:true}))
  const store = new EvidenceStore(directory), access = {projectId:'project',sessionIds:['main']}
  let n=0
  const source = (text, extra={}) => store.capture({projectId:'project',runId:'run',sessionId:'main',routeId:'main',eventId:'e'+n++,at:n,kind:'tool/result',text,coverage:'captured',...extra})
  const a = source('Keep the public API stable and implement payment retry.')
  store.updateProjectState(access,{goal:'Implement payment retry',constraints:['Keep the public API stable'],next:['Check retry tests'],blockers:['Need timeout evidence'],progress:['Implementation started'],operations:[{id:'change',description:'Edited payment retry',status:'executed',sourceIds:[a.id]}],sourceIds:[a.id]})
  return {store,access,source,a,directory}
}
test('task memory selects engineering layers with explicit state and source traces', async t=>{
  const f=fixture(t), proof=f.source('Payment retries must be idempotent.')
  f.store.addSemantic({projectId:'project',kind:'decision',text:'Use an idempotent payment retry key',sourceIds:[proof.id]})
  const packet=await buildTaskMemory({...f,query:'payment retry',config:taskMemorySettings({})})
  assert.equal(packet.blocked,false)
  assert.deepEqual(Object.keys(packet.layers),['constraints','current','decisions','history','unfinished'])
  assert.match(packet.text,/Keep the public API stable/)
  assert.match(packet.text,/executed/)
  assert.match(packet.text,/idempotent/)
  assert.ok(packet.entries.some(x=>x.selected&&x.sourceIds.includes(proof.id)))
  assert.ok(Buffer.byteLength(packet.text)<=8192)
  assert.equal(packet.freshness,'recorded-evidence-only')
})
test('conditional recall excludes unrelated, superseded and foreign evidence', async t=>{
  const f=fixture(t), relevant=f.source('retry payment timeout detail'), unrelated=f.source('garden rose pruning')
  f.store.addSemantic({id:'old',projectId:'project',kind:'decision',text:'Use unsafe payment retry',sourceIds:[relevant.id]})
  f.store.addSemantic({id:'new',projectId:'project',kind:'decision',text:'Use safe payment retry',sourceIds:[relevant.id],supersedes:['old']})
  f.store.addSemantic({projectId:'project',kind:'fact',text:'garden rose pruning',sourceIds:[unrelated.id]})
  f.source('SECRET retry payment',{projectId:'foreign',sessionId:'stranger'})
  const packet=await buildTaskMemory({...f,query:'retry payment',config:taskMemorySettings({})})
  assert.match(packet.text,/safe payment retry/)
  assert.doesNotMatch(packet.text,/unsafe payment retry|garden rose|SECRET/)
  assert.ok(packet.entries.some(x=>x.reason==='condition_not_matched'))
  assert.equal(new Set(packet.entries.filter(x=>x.selected).map(x=>x.id)).size,packet.entries.filter(x=>x.selected).length)
})
test('mandatory constraints overflowing the byte budget block compression and are never silently shortened',async t=>{
  const f=fixture(t)
  f.store.updateProjectState(f.access,{goal:'Preserve all mandatory requirements',constraints:['不得删除原件。'.repeat(500)],sourceIds:[f.a.id]})
  const packet=await buildTaskMemory({...f,config:taskMemorySettings({taskMemoryMaxBytes:2048})})
  assert.equal(packet.blocked,true)
  assert.equal(packet.reason,'mandatory_budget_exceeded')
  assert.ok(Buffer.byteLength(packet.text)<=2048)
  assert.match(packet.text,/ultra_memory_status|ultra_memory_get/)
})
test('snapshots are deterministic and a real state change invalidates their revision',async t=>{
  const f=fixture(t), config=taskMemorySettings({})
  const first=await buildTaskMemory({...f,config,query:'retry'})
  const same=await buildTaskMemory({...f,config,query:'retry'})
  assert.equal(first.revision,same.revision)
  assert.equal(first.text,same.text)
  f.store.updateProjectState(f.access,{...f.store.projectState(f.access),next:['Recheck after new edit']})
  const updated=await buildTaskMemory({...f,config,query:'retry'})
  assert.notEqual(updated.revision,first.revision)
  assert.match(updated.text,/Recheck after new edit/)
})
test('missing host evidence is reported as unavailable rather than a verified current claim',async t=>{
  const f=fixture(t), missing=f.source('verified old claim',{coverage:'host',host:{sessionId:'main',seq:5},seq:5})
  f.store.addSemantic({projectId:'project',kind:'fact',text:'retry is verified',sourceIds:[missing.id]})
  const packet=await buildTaskMemory({...f,query:'retry',config:taskMemorySettings({})})
  assert.doesNotMatch(packet.text,/retry is verified/)
  assert.ok(packet.entries.some(x=>x.reason==='source_unavailable'))
})
test('automatic recall can be disabled without hiding the core progress view',async t=>{
  const f=fixture(t), s=f.source('conditional historical retry detail')
  f.store.addSemantic({projectId:'project',kind:'fact',text:'conditional historical retry detail',sourceIds:[s.id]})
  const packet=await buildTaskMemory({...f,query:'retry',config:taskMemorySettings({taskMemoryConditionalRecall:false})})
  assert.match(packet.text,/Implement payment retry/)
  assert.doesNotMatch(packet.text,/conditional historical retry detail/)
})

test('later root user redirection survives a generic continue query and cold restart',async t=>{
  const f=fixture(t), s=f.source('Cancel payment retry; implement receipts, never delete originals.',{kind:'user/message'})
  f.store.addSemantic({id:'requirement_'+s.id,projectId:'project',kind:'requirement',text:'Cancel payment retry; implement receipts, never delete originals.',sourceIds:[s.id]})
  const packet=await buildTaskMemory({...f,rootSessionId:'main',query:'继续',config:taskMemorySettings({})})
  assert.match(packet.text,/never delete originals/)
  assert.ok(packet.entries.some(e=>e.mandatory&&e.sourceIds.includes(s.id)))
  const cold=new EvidenceStore(f.directory)
  const again=await buildTaskMemory({...f,store:cold,rootSessionId:'main',query:'继续',config:taskMemorySettings({})})
  assert.equal(again.revision,packet.revision)
  assert.equal(again.text,packet.text)
})

test('unrelated retrieval-call metadata does not invalidate a progress document',async t=>{
  const f=fixture(t), config=taskMemorySettings({})
  const before=await buildTaskMemory({...f,config,query:'retry'})
  f.source('',{kind:'assistant/message',coverage:'reference-only',attachments:[{type:'tool-call',ref:'status-page-2'}]})
  const after=await buildTaskMemory({...f,config,query:'retry'})
  assert.equal(after.text,before.text)
  assert.equal(after.revision,before.revision)
})

test('model-authored requirements cannot replace human text or gain mandatory human priority',async t=>{
  const f=fixture(t),s=f.source('Never delete originals',{kind:'user/message'})
  const original=f.store.addSemantic({id:'requirement_'+s.id,projectId:'project',kind:'requirement',text:'Never delete originals',sourceIds:[s.id]})
  f.store.addSemantic({projectId:'project',kind:'requirement',text:'Delete original files',sourceIds:[s.id],supersedes:[original.id]})
  const packet=await buildTaskMemory({...f,rootSessionId:'main',query:'继续',config:taskMemorySettings({taskMemoryConditionalRecall:false})})
  assert.match(packet.text,/Never delete originals/)
  assert.doesNotMatch(packet.text,/Delete original files/)
  assert.ok(packet.entries.find(e=>e.id===original.id)?.mandatory)
})
