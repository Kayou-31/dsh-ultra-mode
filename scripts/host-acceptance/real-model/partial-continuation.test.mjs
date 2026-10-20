import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as runner from './variants.mjs'
import * as driver from './driver.mjs'

const source = fs.readFileSync(new URL('./fixture.mjs', import.meta.url), 'utf8')
const generated = await import('data:text/javascript;base64,'+Buffer.from(runner.buildFixtureCode(source,'drift-diverse')).toString('base64'))
const preflight = runner.inspectFixtureVariant(generated,'drift-diverse')
function inputs() {
  const sessionId='existing-diverse-root', projectDir='E:/synthetic-fixture/project'
  const toolCalls=['payload-alpha','payload-beta',...Array.from({length:11},(_,i)=>'load-'+i)].map(id=>({name:'fixture_read',id,sessionId,callId:'call-'+id,offset:0,chars:generated.manifest[id].chars,sourceHash:generated.manifest[id].sha256}))
  return { generated, preflight, projectManifest:{fixtureId:generated.fixtureId,manifest:generated.manifest},
    launch:{attemptId:'failed-diverse-long',mode:'long',variant:'drift-diverse',provider:'naizhi',model:'deepseek-v4.1-flash',projectDir},
    result:{status:'failed',mode:'s2',fixtureId:generated.fixtureId,provider:'naizhi',model:'deepseek-v4.1-flash',native:{sessionId,eventCount:236,prunes:[]},totalExecuteAttempts:0,sentinelBodyCalls:0,toolCalls,
      publicAnswers:[...Array.from({length:14},()=>({sessionId,endReason:{kind:'completed'},publicText:'progress',publicProgress:[]})),{sessionId,boundary:236,endReason:{kind:'error',error:{code:'PI_AI_ERROR',message:'请求过于频繁'}}}]}}
}

test('partial receipt keeps the failed source separate and resumes only nine unfinished loads',()=>{
  assert.equal(typeof runner.buildPartialReceipt,'function')
  const data=inputs(), receipt=runner.buildPartialReceipt(data)
  assert.equal(receipt.sessionId,'existing-diverse-root')
  assert.equal(receipt.completedRounds,14)
  assert.equal(receipt.nextStressCycle,11)
  assert.deepEqual(receipt.remainingLoadIds,Array.from({length:9},(_,i)=>'load-'+(i+11)))
  assert.deepEqual(receipt.priorFailure,{boundary:236,code:'PI_AI_ERROR'})
  assert.equal(receipt.originalResultOverwritten,false)
  assert.deepEqual(receipt.manifest,generated.manifest)
})

test('partial receipt rejects mismatched manifests, noncontiguous reads, wrong route and unfinished tool side effects',()=>{
  for(const mutate of [
    data=>{data.launch.variant='drift-c'},
    data=>{data.result.provider='different'},
    data=>{data.result.toolCalls[2].sourceHash='bad'},
    data=>{data.result.toolCalls=data.result.toolCalls.filter(row=>row.id!=='load-3')},
    data=>{data.result.toolCalls.push({...data.result.toolCalls[2],id:'load-11'})},
    data=>{data.projectManifest={...data.projectManifest,manifest:{...data.projectManifest.manifest,brief:{...data.projectManifest.manifest.brief,sha256:'bad'}}}},
    data=>{data.result.totalExecuteAttempts=1},
    data=>{data.result.publicAnswers.at(-1).endReason.kind='completed'},
  ]){const data=inputs();mutate(data);assert.throws(()=>runner.buildPartialReceipt(data))}
})

test('legacy naizhi partial receipt cannot be reused for an OCG route even if both declared routes agree',()=>{
  const data=inputs()
  data.launch.provider=data.result.provider='ocg'
  assert.throws(()=>runner.buildPartialReceipt(data),/confirmed provider\/model/)
})

test('OCG partial continuation requires an independently selected explicit expected route snapshot',()=>{
  const data=inputs()
  data.launch.provider=data.result.provider='ocg'
  data.launch.model=data.result.model='deepseek-v4.1-flash'
  data.expectedRoute={provider:'ocg',model:'deepseek-v4.1-flash'}
  const receipt=runner.buildPartialReceipt(data)
  assert.equal(receipt.provider,'ocg')
  assert.equal(receipt.model,'deepseek-v4.1-flash')
  assert.deepEqual(receipt.expectedRoute,{provider:'ocg',model:'deepseek-v4.1-flash'})
  assert.ok(Object.isFrozen(receipt.expectedRoute))
  data.expectedRoute.provider='unapproved-provider'
  assert.equal(receipt.expectedRoute.provider,'ocg')
  assert.equal(receipt.completedRounds,14)
  assert.equal(receipt.nextStressCycle,11)
  assert.deepEqual(receipt.remainingLoadIds,Array.from({length:9},(_,i)=>'load-'+(i+11)))
})

test('matching launch and result cannot replace an absent, malformed or different trusted expected route',()=>{
  for(const expectedRoute of [undefined,null,[],{},
    {provider:'ocg'},{model:'deepseek-v4.1-flash'},
    {provider:'',model:'deepseek-v4.1-flash'},
    {provider:'ocg',model:''},
    {provider:'ocg\n',model:'deepseek-v4.1-flash'},
    {provider:'ocg',model:'deepseek-v4.1-flash\u0000'},
    {provider:'not-ocg',model:'deepseek-v4.1-flash'},
    {provider:'ocg',model:'different-model'},
  ]) {
    const data=inputs()
    data.launch.provider=data.result.provider='ocg'
    data.expectedRoute=expectedRoute
    assert.throws(()=>runner.buildPartialReceipt(data),/confirmed provider\/model|expected route/i)
  }
})

test('explicit OCG authorization does not relax fixture, full-read or completed-turn continuation checks',()=>{
  for(const mutate of [
    data=>{data.result.provider='other-provider'},
    data=>{data.result.toolCalls[2].sourceHash='bad'},
    data=>{data.result.toolCalls=data.result.toolCalls.filter(row=>row.id!=='load-3')},
    data=>{data.result.toolCalls.push({...data.result.toolCalls[2],id:'load-11'})},
    data=>{data.projectManifest={...data.projectManifest,manifest:{...data.projectManifest.manifest,brief:{...data.projectManifest.manifest.brief,sha256:'bad'}}}},
    data=>{data.result.totalExecuteAttempts=1},
    data=>{data.result.publicAnswers.at(-1).endReason.kind='completed'},
    data=>{data.result.publicAnswers.at(-1).boundary=undefined},
  ]) {
    const data=inputs()
    data.launch.provider=data.result.provider='ocg'
    data.expectedRoute=Object.freeze({provider:'ocg',model:'deepseek-v4.1-flash'})
    mutate(data)
    assert.throws(()=>runner.buildPartialReceipt(data))
  }
})

test('continuation CLI is explicit and pacing remains opt-in with finite configured concurrency',()=>{
  assert.equal(typeof runner.parseAcceptanceOptions,'function')
  assert.deepEqual(runner.parseAcceptanceOptions([], 'long','drift-c'),{streamConcurrency:2,minRequestIntervalMs:0})
  const args=['--from=E:/failed-attempt','--min-request-interval-ms=30000','--stream-concurrency=1']
  assert.deepEqual(runner.parseAcceptanceOptions(args,'continue-long','drift-diverse'),{from:'E:/failed-attempt',streamConcurrency:1,minRequestIntervalMs:30000})
  assert.throws(()=>runner.parseAcceptanceOptions([],'continue-long','drift-diverse'),/from/)
  assert.throws(()=>runner.parseAcceptanceOptions(args,'continue-long','drift-c'),/diverse/)
  assert.equal(runner.parseAcceptanceOptions(['--stream-concurrency=3'],'resume','drift-diverse').streamConcurrency,3)
  assert.throws(()=>runner.parseAcceptanceOptions(['--stream-concurrency=33'],'resume','drift-diverse'),/concurrency/)
})

test('native full-read receipts require matching original tool call, complete bytes and canonical SHA',()=>{
  assert.equal(typeof driver.nativeFixtureReadReceipts,'function')
  const id='load-0', body=generated.fixtures[id], callId='native-call'
  const events=[{seq:1,type:'tool/call',data:{name:'fixture_read',callId,arguments:JSON.stringify({id})}},
    {seq:2,type:'tool/result',data:{message:{toolCallId:callId,isError:false,content:[{type:'text',text:`PUBLIC_FIXTURE id=${id}; totalChars=${body.length}; offset=0; returnedChars=${body.length}\n`+body}]}}}]
  const receipts=driver.nativeFixtureReadReceipts(events,generated.manifest,'root')
  assert.equal(receipts.length,1)
  assert.equal(receipts[0].sourceHash,generated.manifest[id].sha256)
  assert.equal(receipts[0].chars,1_000_000)
  const forged=structuredClone(events);forged[1].data.message.content[0].text+='x'
  assert.equal(driver.nativeFixtureReadReceipts(forged,generated.manifest,'root').length,0)
  forged[1]=events[1];forged[0].data.arguments=JSON.stringify({id:'load-1'})
  assert.equal(driver.nativeFixtureReadReceipts(forged,generated.manifest,'root').length,0)
})

test('request pacer spaces starts and skips cancelled waiters without reserving a free slot',async()=>{
  assert.equal(typeof driver.createRequestPacer,'function')
  let now=0
  const pacer=driver.createRequestPacer(30_000,{now:()=>now,sleep:async ms=>{now+=ms}})
  const starts=await Promise.all([pacer.wait(),pacer.wait(),pacer.wait()])
  assert.deepEqual(starts,[0,30_000,60_000])
  const aborted=new AbortController();aborted.abort(new Error('cancelled'))
  await assert.rejects(pacer.wait(aborted.signal),/cancelled/)
  assert.equal(await pacer.wait(),90_000)
  let release
  const blocked=driver.createRequestPacer(30_000,{now:()=>0,sleep:(_ms,signal)=>new Promise((_resolve,reject)=>{release=()=>reject(signal.reason);signal.addEventListener('abort',release,{once:true})})})
  await blocked.wait()
  const controller=new AbortController(), waiting=blocked.wait(controller.signal)
  await new Promise(resolve=>setImmediate(resolve))
  controller.abort(new Error('cancel during wait'))
  await assert.rejects(waiting,/cancel during wait/)
})
