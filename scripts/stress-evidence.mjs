/** Deterministic local scale/ACL/citation checks. No host launcher or model calls. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EvidenceStore } from '../lib/evidence.js'
const started=performance.now(), scratchRoot=path.resolve('work')
fs.mkdirSync(scratchRoot,{recursive:true})
const directory=fs.mkdtempSync(path.join(scratchRoot,'citation-stress-'))
const bodies=new Map(), resolver=async ref=>bodies.has(ref.seq)?{text:bodies.get(ref.seq)}:undefined
const store=new EvidenceStore(directory,resolver), records=[]
const padding='Synthetic padding; never a user instruction.\n'.repeat(36000).slice(0,1_500_000)
for(let i=0;i<12;i++){
  const quote='STRESS_TAIL_'+i+' exact punctuation = retained.',text=padding+'\nBody alias A-internal-'+i+'\n'+quote
  bodies.set(i,text)
  const source=store.capture({projectId:'project-'+(i%3),sessionId:'session-'+i,runId:'stress',routeId:'worker-'+i,eventId:'e'+i,at:i,kind:'tool/result:read',text,host:{sessionId:'session-'+i,seq:i},origin:{tool:'read',callId:'call-'+i,resourceId:'document-'+i}})
  records.push({source,quote,text})
}
const reopened=new EvidenceStore(directory,resolver)
let successfulQuotes=0,denied=0,rejected=0
for(let n=0;n<1000;n++){
  const i=n%records.length,{source,quote,text}=records[i],access={projectId:source.projectId,sessionIds:[source.sessionId]}
  const got=await reopened.get(access,source.id,{quote,offset:text.length-quote.length,maxChars:1200})
  assert.equal(got.citation.sourceId,source.id);assert.equal(got.citation.origin.resourceId,'document-'+i);assert.equal(got.text,quote);assert.ok(JSON.stringify(got).length<=1200);successfulQuotes++
  if(n%50===0){
    await assert.rejects(reopened.get({projectId:'different',sessionIds:[source.sessionId]},source.id,{quote}));denied++
    await assert.rejects(reopened.get(access,source.id,{quote:quote.replace(' = ',': ')}),/quote/i);rejected++
    await assert.rejects(reopened.get(access,source.id,{quote,maxChars:256}),/budget/i);rejected++
  }
}
const original=bodies.get(0);bodies.set(0,'mutated source')
await assert.rejects(reopened.get({projectId:'project-0',sessionIds:['session-0']},records[0].source.id,{quote:records[0].quote}),/unavailable|integrity/i)
bodies.set(0,original)
const report={kind:'deterministic-local-scale-check',status:'passed',modelRequests:0,sourceCount:records.length,originalChars:records.reduce((s,x)=>s+x.text.length,0),successfulQuotes,denied,rejected,changedHostSourceRejected:true,coldStoreReload:true,elapsedMs:Math.round(performance.now()-started),rssBytes:process.memoryUsage().rss,directory,scope:'Local EvidenceStore resolver fixture only; not real host/model quality or process peak memory'}
if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
