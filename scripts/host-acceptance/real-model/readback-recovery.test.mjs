import test from 'node:test'
import assert from 'node:assert/strict'
import * as driver from './driver.mjs'
import {expected,driftExpected} from './fixture.mjs'

test('readback recovery is one final repair without claiming a transport failure or supplying answers',()=>{
  assert.equal(typeof driver.driftReadbackRecoveryPrompt,'string')
  const prepared=driver.prepareTurnPrompt(driver.driftReadbackRecoveryPrompt,{driftStress:true,driftReadbackRecovery:true,requireVerifiedCitations:true},'long-repair')
  assert.equal(prepared.isFinal,true)
  assert.match(prepared.prompt,/检索/)
  assert.match(prepared.prompt,/本轮新增回执/)
  assert.doesNotMatch(prepared.prompt,/因网络传输错误|只给不含早期batch/)
  for(const value of [...Object.values(expected),...Object.values(driftExpected)].filter(v=>typeof v==='string'&&v.length>8))assert.equal(prepared.prompt.includes(value),false)
})

test('readback recovery requires a failed public grade and its completed same native final turn',()=>{
  assert.equal(typeof driver.validateReadbackRecovery,'function')
  const result={status:'failed',grade:{passed:false},native:{sessionId:'same-root'},publicAnswers:[{boundary:400,endReason:{kind:'completed'}}]}
  const input={result,sessionId:'same-root',completedTurns:26,lastEnd:{seq:430,data:{reason:{kind:'completed'}}}}
  assert.equal(driver.validateReadbackRecovery(input).priorCompletedRounds,26)
  for(const other of [{...input,sessionId:'other'},{...input,completedTurns:25},{...input,lastEnd:{seq:430,data:{reason:{kind:'error'}}}},{...input,result:{...result,grade:{passed:true}}}])assert.throws(()=>driver.validateReadbackRecovery(other))
})
