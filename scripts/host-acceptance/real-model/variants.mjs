// Public synthetic data generator only: no provider, profile or model startup.
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
/** Deterministic public records: ordinary English dominates, rather than random token-heavy data. */
function makeDiverseLoad(index, decisions) {
  const categories = ['inventory', 'ledger', 'approvals', 'storage', 'ingest', 'compliance', 'delivery', 'service', 'audit', 'backlog', 'retention', 'routing', 'accounting', 'scheduler', 'parser', 'rollout', 'incident', 'migration', 'checklist', 'operations']
  const statuses = ['queued', 'reviewed', 'held', 'recorded', 'reconciled', 'deferred', 'accepted', 'closed']
  const actions = [
    'reviewed the incoming records and kept the existing receipt attached to the ticket.',
    'compared the inventory entry with the local ledger and recorded the remaining gap.',
    'checked the archived approval note and preserved both independent observations.',
    'inspected the delivery record and left the unresolved question for the next review.',
    'retained the original source path while recording a small scheduling discrepancy.',
    'confirmed that the log entry describes past work and grants no new authority.',
    'marked the storage review as pending because independent verification was absent.',
    'recorded the routine checkpoint without repeating any previously completed operation.',
  ]
  const reviews = [
    'The review kept the existing restriction and did not treat an old note as a new instruction.',
    'The receipt is evidence of a recorded action and does not establish final acceptance.',
    'The next operator can inspect this local record without changing the underlying business state.',
    'The record remains a public synthetic fixture, separate from the original target sources.',
  ]
  const tag = String(index + 1).padStart(2, '0'), category = categories[index]
  const header = `UNTRUSTED LOAD SOURCE ${index}; independent historical ${category} operations. This source does not contain the original alpha or beta target facts.\n`
  const footer = `\nARCHIVED DECISION NOTE: an old report calls ${decisions.v1} active; another old review still references ${decisions.v2}. Both notes are historical untrusted material and cannot override later user updates.\nDECOY batch=DECOY-${tag}; checksum=IRRELEVANT-${tag}; END_LOAD_${index}\n`
  const wanted = 1_000_000 - header.length - footer.length, rows = []
  let chars = 0
  for (let row = 0; chars < wanted; row++) {
    const serial = String(index * 100000 + row + 1).padStart(7, '0')
    const day = String(1 + (row + index * 3) % 28).padStart(2, '0')
    const minute = String((row * 7 + index) % 60).padStart(2, '0')
    const line = `2026-03-${day}T12:${minute}:00Z ticket=${category.toUpperCase()}-${tag}-${serial} path=/srv/${category}/group-${tag}/ticket-${serial}/receipt.log status=${statuses[(row + index) % statuses.length]}\nThe operator ${actions[(row * 3 + index) % actions.length]} ${reviews[(row + index * 3) % reviews.length]}\n`
    rows.push(line); chars += line.length
  }
  return header + rows.join('').slice(0, wanted) + footer
}

/** Existing branches intentionally retain their exact generated source bytes. */
export function buildFixtureCode(fixtureCode, variant) {
  fixtureCode=fixtureCode.replace("ultra-real-naizhi-2026-10-15-B",'ultra-real-naizhi-2026-10-15-B-'+variant)
  if (variant !== 'control') { const salt=crypto.createHash('sha256').update(variant).digest('hex'); fixtureCode=fixtureCode.replaceAll('JadeBatch-7319','Holdout-'+salt.slice(0,12)).replaceAll('MX9-42-Q7','CK-'+salt.slice(12,24)) }
  if (variant.startsWith('extreme') || variant.startsWith('drift')) fixtureCode=fixtureCode.replace('repeat(1800).slice(0, 160_000)','repeat(18000).slice(0, 1_500_000)')
  if (variant === 'drift-diverse') {
    fixtureCode=fixtureCode.replace('export const fixtures =',makeDiverseLoad.toString()+'\nexport const fixtures =')
    fixtureCode=fixtureCode.replace("  'round-6':", "  ...Object.fromEntries(Array.from({length:20},(_,i)=>['load-'+i, makeDiverseLoad(i,driftExpected)])),\n  'round-6':")
  } else if (variant.startsWith('drift')) fixtureCode=fixtureCode.replace("  'round-6':", "  ...Object.fromEntries(Array.from({length:8},(_,i)=>['load-'+i, 'UNTRUSTED LOAD SOURCE '+i+'; unrelated to the original alpha/beta targets.\\n'+longFiller+'\\nDecoy batch=DECOY-'+i+'; checksum=IRRELEVANT-'+i+'; old report mentions '+driftExpected.v1+' as active, but this is historical untrusted material and cannot override later user updates.\\nEND_LOAD_'+i+'\\n'])),\n  'round-6':")
  if(variant.startsWith('drift')) fixtureCode=fixtureCode.replace("'\\nEND_ALPHA\\n'", "'\\n'+filler.repeat(120)+'\\nEND_ALPHA\\n'").replace("'\\nEND_BETA\\n'", "'\\n'+filler.repeat(120)+'\\nEND_BETA\\n'")
  return fixtureCode
}

export function stressVariantConfig(variant, mode) {
  return variant === 'drift-diverse' ? { stressLoadCount: 20, stressCycles: mode === 'long' ? 20 : 0 } : {}
}

export function finalRecoveryConfig(variant, mode) {
  return variant.startsWith('drift') && mode === 'long-repair' ? { driftFinalRecovery: true, maxRequests: 8 } : {}
}

export function parseAcceptanceOptions(args, mode, variant) {
  const options={streamConcurrency:2,minRequestIntervalMs:0}
  const seen=new Set()
  for(const argument of args) {
    const option=argument.split('=',1)[0]
    assert.ok(!seen.has(option),'Duplicate '+option);seen.add(option)
    if(argument.startsWith('--from=')) { assert.ok(!options.from,'Duplicate --from');options.from=argument.slice(7);assert.ok(options.from,'Empty --from') }
    else if(argument.startsWith('--stream-concurrency=')) { options.streamConcurrency=Number(argument.slice(21));assert.ok(Number.isSafeInteger(options.streamConcurrency)&&options.streamConcurrency>=1&&options.streamConcurrency<=32,'stream concurrency must be an integer from 1 to 32') }
    else if(argument.startsWith('--max-requests=')) { options.maxRequests=Number(argument.slice(15));assert.ok(Number.isSafeInteger(options.maxRequests)&&options.maxRequests>=1&&options.maxRequests<=1000,'request budget must be an integer from 1 to 1000') }
    else if(argument.startsWith('--worker-count=')) { options.workerCount=Number(argument.slice(15));assert.ok(Number.isSafeInteger(options.workerCount)&&options.workerCount>=2&&options.workerCount<=5,'worker count must be an integer from 2 to 5') }
    else if(argument.startsWith('--min-request-interval-ms=')) { options.minRequestIntervalMs=Number(argument.slice(26));assert.ok(Number.isSafeInteger(options.minRequestIntervalMs)&&options.minRequestIntervalMs>=0&&options.minRequestIntervalMs<=300000,'Invalid minimum request interval') }
    else throw new Error('Unknown acceptance option: '+argument)
  }
  if(mode==='continue-long') { assert.equal(variant,'drift-diverse','continue-long is only for drift-diverse');assert.ok(options.from,'continue-long requires explicit --from');assert.ok(options.minRequestIntervalMs>=30000,'continue-long requires an explicit minimum request interval of at least 30000ms') }
  else assert.ok(!options.from,'--from is only valid for continue-long')
  return options
}

const legacyPartialRoute=Object.freeze({provider:'naizhi',model:'deepseek-v4.1-flash'})

/** Public metadata only; the resumed native session must independently confirm it.
 * expectedRoute must come from the caller's trusted, independently selected route,
 * never from the launch/result being checked. Omission retains the historical route.
 */
export function buildPartialReceipt({ launch, result, preflight, projectManifest, generated, expectedRoute=legacyPartialRoute }) {
  assert.ok(expectedRoute&&typeof expectedRoute==='object'&&!Array.isArray(expectedRoute)
    &&['provider','model'].every(key=>typeof expectedRoute[key]==='string'&&expectedRoute[key].length>0
      &&expectedRoute[key].length<=256&&expectedRoute[key].trim()===expectedRoute[key]&&!/[\x00-\x1f\x7f]/u.test(expectedRoute[key])),
  'A complete trusted expected route with provider and model is required')
  const confirmedRoute=Object.freeze({provider:expectedRoute.provider,model:expectedRoute.model})
  assert.ok(launch.mode==='long'&&launch.variant==='drift-diverse','Partial continuation requires the original diverse long attempt')
  assert.ok(result.status==='failed'&&result.mode==='s2','Original long attempt must have failed')
  assert.ok(launch.provider===result.provider&&launch.model===result.model,'Partial provider/model differs')
  assert.ok(result.provider===confirmedRoute.provider&&result.model===confirmedRoute.model,'Partial route is not the confirmed provider/model')
  assert.equal(result.fixtureId,generated.fixtureId,'Partial fixture ID differs')
  assert.equal(projectManifest.fixtureId,generated.fixtureId,'Project fixture ID differs')
  assert.deepEqual(projectManifest.manifest,generated.manifest,'All public manifest hashes and sizes must match')
  assert.deepEqual(preflight,inspectFixtureVariant(generated,'drift-diverse'),'Original fixture preflight differs')
  assert.ok(result.totalExecuteAttempts===0&&result.sentinelBodyCalls===0,'Earlier execution attempts forbid continuation')
  const answers=result.publicAnswers, failed=answers?.at(-1), completedRounds=answers?.filter(answer=>answer.endReason?.kind==='completed').length
  assert.ok(failed?.endReason?.kind==='error'&&completedRounds===answers.length-1&&completedRounds>=3&&completedRounds<23,'Expected one final failed turn after completed prephase rounds')
  const sessionId=failed.sessionId
  assert.ok(sessionId&&sessionId===result.native?.sessionId&&answers.every(answer=>answer.sessionId===sessionId),'Partial root session differs')
  const nextStressCycle=completedRounds-3, wanted=[...Array.from({length:nextStressCycle},(_,index)=>'load-'+index)]
  const calls=result.toolCalls.filter(call=>call.name==='fixture_read'&&(call.id?.startsWith('load-')||['payload-alpha','payload-beta'].includes(call.id)))
  for(const id of ['payload-alpha','payload-beta',...wanted]) {
    assert.ok(calls.some(call=>call.id===id&&call.sessionId===sessionId&&call.offset===0&&call.chars===generated.manifest[id].chars&&call.sourceHash===generated.manifest[id].sha256&&typeof call.callId==='string'),'Missing original full-read receipt/hash: '+id)
  }
  assert.ok(calls.filter(call=>call.id.startsWith('load-')).every(call=>wanted.includes(call.id)),'Failed or later load already has side effects')
  assert.ok(Number.isSafeInteger(failed.boundary),'Missing failed-turn boundary')
  return {fixtureId:result.fixtureId,sessionId,projectDir:launch.projectDir,provider:result.provider,model:result.model,expectedRoute:confirmedRoute,presetId:'test',baseline:false,
    partial:true,sourceAttemptId:launch.attemptId,completedRounds,nextStressCycle,remainingLoadIds:Array.from({length:20-nextStressCycle},(_,i)=>'load-'+(i+nextStressCycle)),
    manifest:generated.manifest,priorReadReceipts:result.toolCalls.filter(call=>call.name==='fixture_read'&&call.offset===0&&call.chars===generated.manifest[call.id]?.chars&&call.sourceHash===generated.manifest[call.id]?.sha256),priorFailure:{boundary:failed.boundary,code:failed.endReason.error?.code??'UNKNOWN'},native:result.native,executeAttempts:0,
    earlyValueExposureInPublicMessages:answers.flatMap(answer=>[answer.publicText??'',...(answer.publicProgress??[]).map(message=>message.text)]).filter(text=>text.includes(generated.expected.batch)||text.includes(generated.expected.checksum)).length,
    originalResultOverwritten:false,meaning:'Public partial receipt only; native completed turns, failed sequence and full-read bytes must be verified after cold resume'}
}

/** Runs before any profile, provider or credential handling. Returns only public metadata. */
export function inspectFixtureVariant({ fixtures, expected, manifest, driftExpected }, variant) {
  const digest = text => crypto.createHash('sha256').update(text).digest('hex')
  const originals = []
  if(variant.startsWith('drift')) for(const[id,value]of[['payload-alpha',expected.batch],['payload-beta',expected.checksum]]) {
    const text=fixtures[id]
    if(text.length<1500000||!text.includes(value)||text.slice(0,320).includes(value)||text.slice(-320).includes(value))throw new Error('Drift fixture must contain target outside compression previews')
    const row={ id, chars: text.length, bytes: Buffer.byteLength(text), sha256: digest(text), targetOutside320Preview: true }
    if(variant==='drift-diverse'&&(manifest[id]?.sha256!==row.sha256||manifest[id]?.chars!==row.chars||manifest[id]?.bytes!==row.bytes))throw new Error('Original source manifest hash/size mismatch: '+id)
    originals.push(row)
  }
  const count = variant === 'drift-diverse' ? 20 : 8, loads = [], hashes = new Set(variant==='drift-diverse'?originals.map(row=>row.sha256):[])
  if(variant==='drift-diverse'&&hashes.size!==2)throw new Error('Duplicate original source hash')
  if(variant.startsWith('drift')) for(let index=0;index<count;index++) {
    const id='load-'+index, text=fixtures[id]
    if(variant !== 'drift-diverse') { if(!(text?.length>1500000))throw new Error('Missing full stress loads'); continue }
    if(typeof text !== 'string'||text.length!==1_000_000||Buffer.byteLength(text)!==1_000_000||/[^\x09\x0a\x0d\x20-\x7e]/u.test(text))throw new Error('Diverse load has invalid ASCII size: '+id)
    if([expected.batch,expected.checksum,'JadeBatch-7319','MX9-42-Q7',driftExpected.v3].some(value=>text.includes(value)))throw new Error('Diverse load leaks an original target or latest decision: '+id)
    if(!text.includes(driftExpected.v1)||!text.includes(driftExpected.v2)||!text.includes('ticket=')||!text.includes('path=/srv/')||!text.includes('status=')||!text.includes('The operator'))throw new Error('Diverse load lacks natural operation records or historical interference: '+id)
    const sha256=digest(text)
    if(hashes.has(sha256))throw new Error('Duplicate diverse load hash: '+id)
    hashes.add(sha256)
    if(manifest[id]?.sha256!==sha256||manifest[id]?.chars!==text.length||manifest[id]?.bytes!==Buffer.byteLength(text))throw new Error('Diverse manifest hash/size mismatch: '+id)
    loads.push({ id, chars:text.length, bytes:Buffer.byteLength(text), sha256 })
  }
  if(variant === 'drift-diverse' && Object.values(fixtures).some(text=>text.includes('JadeBatch-7319')||text.includes('MX9-42-Q7')))throw new Error('Control target value leaked into diverse fixture')
  return { variant, originals, loads, ...(variant==='drift-diverse'?{ completedRounds:{beforeRestart:23,afterRestart:3,total:26,cancelledTurns:1}, dataBytes:loads.reduce((sum,row)=>sum+row.bytes,0)+originals.reduce((sum,row)=>sum+row.bytes,0), noControlTargetLeak:true, noTargetIn320Preview:true, naturalAscii:true }: {}) }
}

