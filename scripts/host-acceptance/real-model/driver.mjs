/** Real-provider acceptance driver. Loaded only by the isolated native Loader.
 * Never reads credentials, registers an adapter, or logs private reasoning.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { fixtureId, fixtures, manifest, expected, prompts, outputInstructions, judgeFinal, driftExpected } from './fixture.mjs'

export const name = 'ultra-real-model-driver'
export const inject = ['agents', 'agentLoop', 'tools', 'llm', 'sessions', 'sessionPersistence', 'systemPrompt', 'agentPresets', 'commands', 'tokenMeter']
const phaseRequestDefaults = { s0: 2, s1: 18, 's1-recover': 12, 'compare-common': 18, baseline: 18, s2: 40, 's2-resume': 24, 'baseline-long': 40, 'baseline-long-resume': 24, 'long-repair': 8, 'baseline-long-repair': 8 }
const boundedInteger = (value, min, max, name) => {
  assert.ok(Number.isSafeInteger(value) && value >= min && value <= max, `${name} must be an integer from ${min} to ${max}`)
  return value
}

/** Immutable deployment/phase limits. The actual gate remains the dispatch authority. */
export function freezeAcceptanceConfig(config, gate, mode) {
  const streamConcurrency = boundedInteger(gate?.concurrency, 1, 32, 'Global gate concurrency')
  if (config.streamConcurrency !== undefined) {
    boundedInteger(config.streamConcurrency, 1, 32, 'Explicit stream concurrency')
    assert.equal(config.streamConcurrency, streamConcurrency, 'Explicit stream concurrency differs from the actual global gate')
  }
  const globalMaxRequests = boundedInteger(gate.maxRequests, 1, 1000, 'Global gate request budget')
  const phaseMaxRequests = boundedInteger(config.maxRequests ?? phaseRequestDefaults[mode] ?? 2, 1, 1000, 'Phase request budget')
  assert.ok(phaseMaxRequests <= globalMaxRequests, 'Phase request budget cannot exceed the global gate request budget')
  return Object.freeze({ streamConcurrency, phaseMaxRequests, globalMaxRequests,
    workerCount: boundedInteger(config.workerCount ?? 2, 2, 5, 'Manual worker count') })
}

export function assertFinalAcceptanceGate(snapshot, gate) {
  assert.equal(gate.concurrency, snapshot.streamConcurrency, 'Global gate concurrency changed during the frozen attempt')
  assert.equal(gate.maxRequests, snapshot.globalMaxRequests, 'Global gate request budget changed during the frozen attempt')
  boundedInteger(gate.activePeak, 0, snapshot.streamConcurrency, 'Global gate concurrency peak')
  assert.equal(gate.active, 0, 'Global gate still has active streams after native cleanup')
}

/** Native request-visible host notices identify roles; request arrival order does not. */
export function inspectManualTopology({ rootId, workerCount, notices, requests, reportSubmissions, requireReportSubmission }) {
  boundedInteger(workerCount, 2, 5, 'Manual worker count')
  const distinct = [...new Map(notices.map(notice => [JSON.stringify([notice.runId, notice.decisionId, notice.routeIds]), notice])).values()]
  assert.equal(distinct.length, 1, 'Exactly one native Ultra run notice is required')
  const { runId, decisionId, routeIds } = distinct[0]
  assert.ok(typeof runId === 'string' && runId && typeof decisionId === 'string' && decisionId && decisionId !== rootId, 'Native run notice requires a distinct decision identity')
  assert.ok(Array.isArray(routeIds) && routeIds.length === workerCount && new Set(routeIds).size === workerCount
    && routeIds.every(id => typeof id === 'string' && id && id !== rootId && id !== decisionId), 'Native notice must identify every distinct manual worker')
  const internalSessions = [...new Set(requests.filter(request => request.sessionId !== rootId).map(request => request.sessionId))]
  const expected = new Set([...routeIds, decisionId])
  assert.ok(internalSessions.length === workerCount + 1 && internalSessions.every(id => expected.has(id)), 'Native internal sessions differ from the workers and decision in the run notice')
  const acceptedReports = reportSubmissions.filter(report => !report.isError && report.concludesTurn)
  const accepted = new Set(acceptedReports.map(report => report.sessionId))
  assert.equal(accepted.size, acceptedReports.length, 'Each native worker can submit only one accepted concluding report')
  assert.ok([...accepted].every(id => routeIds.includes(id)), 'Accepted report belongs to a non-worker session')
  if (requireReportSubmission) assert.ok(accepted.size === workerCount, 'Every native worker must submit an accepted concluding report')
  return { runId, decisionId, workerIds: [...routeIds], internalSessions, acceptedWorkerReports: accepted.size }
}

export function stressLoadIds(config = {}) {
  const count = config.variant === 'drift-diverse' ? config.stressLoadCount ?? 8 : 8
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 20, 'stressLoadCount must be an integer from 1 to 20')
  return Array.from({ length: count }, (_, index) => 'load-' + index)
}

function abortable(promise, signal) {
  if(!signal)return promise
  if(signal.aborted)return Promise.reject(signal.reason)
  return new Promise((resolve,reject)=>{
    const onAbort=()=>{signal.removeEventListener('abort',onAbort);reject(signal.reason)}
    signal.addEventListener('abort',onAbort,{once:true})
    promise.then(value=>{signal.removeEventListener('abort',onAbort);resolve(value)},error=>{signal.removeEventListener('abort',onAbort);reject(error)})
  })
}

/** Test-only start pacing; cancellation does not prove an upstream slot was released. */
export function createRequestPacer(intervalMs, {now=Date.now,sleep=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return}
  const done=()=>{signal?.removeEventListener('abort',cancel);resolve()}
  const timer=setTimeout(done,ms),cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(signal.reason)}
  signal?.addEventListener('abort',cancel,{once:true})
})}={}) {
  assert.ok(Number.isSafeInteger(intervalMs)&&intervalMs>=0&&intervalMs<=300000,'Invalid test-only request interval')
  let tail=Promise.resolve(),lastStart=-Infinity
  return {wait(signal){
    const pending=tail.then(async()=>{
      signal?.throwIfAborted()
      let remaining=lastStart+intervalMs-now()
      while(remaining>0){await sleep(remaining,signal);signal?.throwIfAborted();remaining=lastStart+intervalMs-now()}
      signal?.throwIfAborted();lastStart=now();return lastStart
    })
    tail=pending.catch(()=>{})
    return abortable(pending,signal)
  }}
}

/** Returns only full, hash-matched native tool receipts; never exports source bodies. */
export function nativeFixtureReadReceipts(events, fixtureManifest, sessionId) {
  const calls=new Map(),receipts=[]
  for(const event of events) {
    if(event.type==='tool/call'&&event.data.name==='fixture_read') {
      try {const args=typeof event.data.arguments==='string'?JSON.parse(event.data.arguments):event.data.arguments;calls.set(event.data.callId,{seq:event.seq,args})}catch{}
    } else if(event.type==='tool/result'&&!event.data.message.isError) {
      const message=event.data.message,call=calls.get(message.toolCallId),item=fixtureManifest[call?.args?.id]
      if(!item||(call.args.offset??0)!==0)continue
      const text=message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n')
      const newline=text.indexOf('\n'),header=text.slice(0,newline),body=text.slice(newline+1),id=call.args.id
      if(newline<0||header!==`PUBLIC_FIXTURE id=${id}; totalChars=${item.chars}; offset=0; returnedChars=${item.chars}`||body.length!==item.chars)continue
      const sourceHash=createHash('sha256').update(body).digest('hex')
      if(sourceHash===item.sha256)receipts.push({name:'fixture_read',id,callId:message.toolCallId,callSeq:call.seq,resultSeq:event.seq,sessionId,offset:0,chars:body.length,sourceHash})
    }
  }
  return receipts
}
export function hasMeasuredUsage(row) {
  if (!row.usage) return false
  if (Object.values(row.usage).some(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) return true
  return !!row.finish && !['error', 'abort', 'aborted', 'cancelled'].includes(row.finish.kind)
}
export const longRepairPrompt = '这是对同一任务前一份最终交付的唯一一次格式和引用修订，不重新进行六轮任务，不启动 Ultra 或 worker。保留已有用户要求和已读取事实，不猜缺失值，不重复已执行操作。只输出一个 JSON 对象，前后都不附解释、标题或 Markdown 围栏。字段仍为 label、batch、checksum、conflict{status,left{id,value,quote},right{id,value,quote}}、operation{id,execution,acceptance,repeated}、sources[{id,quote,sourceId?}]、footer。所有 id 使用工具实际返回的公共资料 ID 字面值，不加自拟前缀。quote 必须逐字复制相应原文的一段连续子串，保留空格、标点和大小写；必要时用已有只读工具定点读取小片段核对。sourceId 只有在实际验证为相应原文的真实证据 ID 时才填写，否则省略这个可选字段。回答不得附加额外文字。'
export const driftFinalRecoveryPrompt = longRepairPrompt.replace('这是对同一任务前一份最终交付的唯一一次格式和引用修订，不重新进行六轮任务，不启动 Ultra 或 worker。', '上一原生最终轮次因网络传输错误结束，没有交付最终公开答案。这是在同一会话中唯一一次有界最终恢复，只追加当前这一轮，不重做此前已完成的轮次，也不重新进行恢复后的三轮，不启动 Ultra 或 worker。请完成原任务的最终交付。')
export const driftReadbackRecoveryPrompt = longRepairPrompt.replace('这是对同一任务前一份最终交付的唯一一次格式和引用修订，不重新进行六轮任务，不启动 Ultra 或 worker。','上一份最终答复保留了归档检索缺口。这是修复本地检索后，在同一原生会话追加的唯一一次有界最终修订；不重做先前完成轮次，不重新启动 Ultra 或 worker。请根据原任务重新检索早期来源的缺失字段：用资料ID与字段关键词联合查找，按命中的区间读取原文，不把文档结束标记当字段值。')

export function validateReadbackRecovery({result,sessionId,completedTurns,lastEnd}) {
  assert.ok(result.status==='failed'&&result.grade?.passed===false,'Readback repair must preserve an actually failed public final grade')
  assert.equal(result.native?.sessionId,sessionId,'Readback repair root differs')
  assert.equal(completedTurns,26,'Readback repair must follow the actual twenty-six completed rounds')
  const answer=result.publicAnswers?.at(-1)
  assert.ok(answer?.endReason?.kind==='completed'&&lastEnd?.data.reason.kind==='completed'&&lastEnd.seq>answer.boundary,'Original native final completion is missing')
  return {priorCompletedRounds:completedTurns,priorFinalNativeCompleted:true,priorStrictQualityPassed:false,previousResultsOverwritten:false}
}

/** Preserve the existing prompts byte-for-byte unless final recovery is explicitly enabled. */
export function prepareTurnPrompt(prompt, config, mode) {
  const isInitial=prompt===prompts.longInitial, isFinal=prompt===prompts.longFinal || prompt===longRepairPrompt || config.driftFinalRecovery===true || config.driftReadbackRecovery===true
  if(config.requireVerifiedCitations && (mode==='s1' || isFinal)) prompt+='\n最终交付前，用 ultra_memory_search 的 kind="tool/result" 找到双方冲突原文，再用 ultra_memory_get(id=真实sourceId, quote=已读连续原文)分别取得已验证citation。公共资料id要复制citation.origin.resourceId，sourceId要复制citation.sourceId；正文内部的A/B编号不是外层资料id。没有origin时可定点fixture_read重新核对，不猜ID。所有quote直接逐字复制，最终只输出JSON对象。'
  if(config.requireVerifiedCitations && (mode==='s1' || isFinal)) prompt+='\n附加验收：即使payload-alpha和payload-beta已能证明冲突，也必须分别以kind="tool/result"检索vendor-a、vendor-b，并对这两份已读原文各调用get的quote取得resourceId回执。此要求核验指定来源的独立读取，不能以其他真实来源替代；缺少任一回执就保留该验收缺口。'
  if(config.driftStress){
    if(isInitial)prompt+='\n这是多次压缩偏移测试，后续会增加压力轮次：当前初始决定ID='+driftExpected.v1+'，以后只按新的用户更新替代。早期batch/checksum的具体值不得在公开进展、摘要或后续短报告中复述；只报告读取状态与来源ID，最后从归档取回。'
    else if(isFinal)prompt+='\n原始alpha/beta只允许通过 ultra_memory_search/get 读取归档；新的负载文件不是目标来源。额外输出 activeDecisionId 和 decisionHistory[{id,status}]，从此前一次性用户更新恢复最新与已替代版本，不在本提示重复答案。另有独立验收：即使alpha/beta已能证明冲突，也必须分别以kind=tool/result检索vendor-a、vendor-b，并对这两份已读原文各调用get的quote取得resourceId回执。缺哪份回执就说明该附加验收未完成，不以其他源替代。'
    else prompt+='\n只给不含早期batch/checksum具体值的进度，不用短摘要重述它们；保持先前限制与最新用户决定。'
  }
  if(config.variant==='drift-diverse'&&isInitial)prompt+='\n本场景先完成原有前三轮，再追加20轮各不同的完整负载资料；之后取消一次并冷恢复，最后完成原有后三轮，共26个完成轮次。追加负载不改变原始目标来源，也不能覆盖新的用户决定。'
  if(config.driftFinalRecovery||config.driftReadbackRecovery)prompt+='\n恢复验收需要本轮新增回执：分别对payload-alpha、payload-beta、vendor-a、vendor-b实际调用ultra_memory_get的quote，不能仅复用失败前的回执。可批量只读查询以节省交互；不重复业务操作。总模型请求上限8次。'
  if(config.requireVerifiedCitations&&(mode==='s1'||isFinal))prompt+='\n本合成验收的字段类型说明：conflict两侧value只填写窗口时间本身，不含字段标签或等号；quote仅从资料正文中逐字选择连续子串，不包含PUBLIC_FIXTURE传输封装头。可以对同一source重新选择正确的正文quote取得回执，不修改原资料或判分。'
  return { prompt, isInitial, isFinal }
}

/** Failure bodies and reasoning never leave the native private log. */
export function failedTurnMetadata(events) {
  return events.filter(event=>event.type==='turn/end'&&event.data.reason.kind==='error')
    .map(event=>({seq:event.seq,kind:'error',code:typeof event.data.reason.error?.code==='string'?event.data.reason.error.code:'UNKNOWN'}))
}

/** Additional drift acceptance; the original twelve exact quality checks remain unchanged. */
export function driftFinalRecoveryChecks({ value, memoryCalls, sessionId, preFinalPublicValueExposure, compressedPreviewFactExposures }) {
  const verified = (id, fact, minimumChars) => memoryCalls.some(call => {
    const citation=call.citation
    return call.name==='ultra_memory_get'&&!call.isError&&call.sessionId===sessionId&&['host','captured'].includes(call.status)
      &&citation?.origin?.tool==='fixture_read'&&citation.origin.resourceId===id&&call.sourceIds?.includes(citation.sourceId)
      &&typeof citation.quote==='string'&&citation.quote.includes(expected[fact])&&call.facts?.[fact]===true
      &&call.originalSources?.some(source=>source.id===citation.sourceId&&source.sha256===citation.sha256&&source.length>=minimumChars
        &&['host','captured'].includes(source.coverage)&&source.origin?.tool==='fixture_read'&&source.origin.resourceId===id
        &&source.origin.callId===citation.origin.callId&&Number.isSafeInteger(citation.start)&&citation.start>=0
        &&citation.end===citation.start+citation.quote.length&&citation.end<=source.length)
  })
  const alpha=verified('payload-alpha','batch',1_500_000), beta=verified('payload-beta','checksum',1_500_000)
  return [
    {name:'latest decision survives repeated compression',passed:value?.activeDecisionId===driftExpected.v3,details:{observed:value?.activeDecisionId}},
    {name:'old decision versions remain superseded',passed:[driftExpected.v1,driftExpected.v2].every(id=>value?.decisionHistory?.some(item=>item.id===id&&item.status==='superseded')),details:{history:value?.decisionHistory}},
    {name:'archived alpha and beta readback is independent of current fixtures',passed:alpha&&beta,details:{alpha,beta,minimumOriginalChars:1_500_000}},
    {name:'cold final conflict citations verified by main agent through host service',passed:verified('vendor-a','left',1)&&verified('vendor-b','right',1),details:{resourceIds:['vendor-a','vendor-b']}},
    {name:'early target values omitted from public progress and compression previews',passed:preFinalPublicValueExposure===0&&compressedPreviewFactExposures===0,details:{publicProgress:preFinalPublicValueExposure,compressedPreviews:compressedPreviewFactExposures}},
  ]
}

export function apply(ctx, config) {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  if (!ready || !exit) throw new Error('Real model driver requires native launcher lifecycle')
  let disposed = false
  const release = ready.onReady(() => {
    if (disposed) return
    run(ctx, config).then(() => exit(0), async error => {
      let previous = {}
      try { previous = JSON.parse(await fs.readFile(config.resultFile, 'utf8')) } catch {}
      await fs.mkdir(path.dirname(config.resultFile), { recursive: true })
      await fs.writeFile(config.resultFile, JSON.stringify({ ...previous, status: 'failed', error: { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 1800) } }, null, 2))
      // Error bodies and native streams remain in the private profile; no console dump.
      exit(1)
    })
  })
  ctx.effect(() => () => { disposed = true; release() }, 'real-model.acceptance.ready')
}

async function run(ctx, config) {
  assert.ok(config.provider && config.model, 'Exact confirmed provider and model are required')
  const requestedMode = String(config.mode ?? 's0').toLowerCase()
  const mode = ({ smoke: 's0', ultra: 's1', long: 's2', resume: 's2-resume' })[requestedMode] ?? requestedMode
  const longRepair = ['long-repair', 'baseline-long-repair'].includes(mode)
  const readCompletedContinue = mode === 'continue-read-completed-long'
  const longContinue = mode==='continue-long' || readCompletedContinue
  const baselineLong = ['baseline-long', 'baseline-long-resume', 'baseline-long-repair'].includes(mode)
  const longRun = ['s2', 's2-resume', 'baseline-long', 'baseline-long-resume', 'cancel-mid'].includes(mode) || longRepair || longContinue
  const longResume = ['s2-resume', 'baseline-long-resume'].includes(mode) || longRepair
  const availableIds = mode === 's0' ? ['health'] : longRun
    ? ['brief', 'state', 'payload-alpha', 'payload-beta', 'vendor-a', 'vendor-b', 'distractor', 'round-3', 'round-4', 'round-5', 'round-6']
    : ['brief', 'state', 'catalog', 'vendor-a', 'vendor-b']
  if(config.driftStress) availableIds.push(...stressLoadIds(config))
  const requireRuntime = createRequire(path.join(config.runtimeRoot, 'package.json'))
  const sdk = name => import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/' + name)).href)
  const [{ createUserMessage }, { defineTool }] = await Promise.all([sdk('dsh-llm'), sdk('dsh-tools')])
  const started = Date.now(), handles = [], disposers = []
  const result = { status: 'running', mode, fixtureId, startedAt: new Date(started).toISOString(), provider: config.provider, model: config.model,
    host: 'actual rc.2 Loader, native AgentLoop, native JSONL; real model provider', requests: [], routeNotices: [], toolCalls: [], memoryCalls: [], reportSubmissions: [], executeAttempts: [], checks: [], usage: [], publicAnswers: [], privateReasoningExported: false }
  const gate = ctx.get('ultraAcceptanceModelGate')
  assert.ok(typeof gate?.snapshot === 'function', 'Required deployment-wide model concurrency gate is unavailable')
  const initialGate = gate.snapshot()
  const acceptanceConfig = freezeAcceptanceConfig(config, initialGate, mode)
  result.acceptanceConfig = acceptanceConfig
  assert.equal(initialGate.allowedProvider, config.provider, 'Global gate provider differs from confirmed route')
  assert.equal(initialGate.allowedModel, config.model, 'Global gate model differs from confirmed route')
  result.globalGate = { initial: initialGate }
  const check = (name, passed, details = {}) => { result.checks.push({ name, passed: !!passed, details }); assert.ok(passed, name) }
  const writeResult = async () => { await fs.mkdir(path.dirname(config.resultFile), { recursive: true }); await fs.writeFile(config.resultFile, JSON.stringify(result, null, 2)) }
  const publicText = events => events.filter(event => event.type === 'assistant/message').flatMap(event => event.data.message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
  const phaseRequests = acceptanceConfig.phaseMaxRequests
  if(config.driftFinalRecovery) assert.ok(mode==='long-repair'&&config.driftStress&&Number.isSafeInteger(phaseRequests)&&phaseRequests>=1&&phaseRequests<=8, 'Drift final recovery requires its exact repair mode and a maximum of eight model calls')
  if(config.driftReadbackRecovery)assert.ok(mode==='long-repair'&&config.variant==='drift-diverse'&&config.driftStress&&!config.driftFinalRecovery&&phaseRequests<=8&&config.priorFinalFailureFile&&config.priorFinalFailureSha256,'Readback repair requires its explicit bounded failure receipt')
  const stopAfterMs = config.timeoutMs ?? ({ s0: 90_000, s1: 360_000, s2: 720_000, 's2-resume': 480_000, 'long-repair': 300_000, 'baseline-long-repair': 300_000 }[mode] ?? 90_000)
  const timer = setTimeout(() => { for (const handle of handles) handle.agent.cancel({ kind: 'hook', reason: 'real model acceptance time budget exhausted' }) }, stopAfterMs)
  const presetId = config.presetId ?? 'test'
  const minRequestIntervalMs=config.minRequestIntervalMs??0, pacer=createRequestPacer(minRequestIntervalMs)
  if(minRequestIntervalMs)result.requestPacing={minRequestIntervalMs,meaning:'Conservative local stream-dispatch start spacing; not a provider RPM claim. Local cancelled streams can leave unknown upstream occupancy.',unknownUpstreamOccupancyAfterCancellation:true}
  const sessionId = config.sessionId ?? 'real-model-' + mode + '-' + Date.now()
  let receiptCalls = 0, previousExecuteAttempts = 0, sentinelBodyCalls = 0, manualMemory, observedRootId, recoveringReadRound = false, recoveryRequests = 0
  if(config.driftStress) disposers.push(ctx.on('agent/pre-step',async(payload,next)=>{
    if(payload.agent.id!==observedRootId)return next()
    const start=Date.now(),before=payload.agent.session.surface.replaceGeneration
    const decision=await next(),after=payload.agent.session.surface.replaceGeneration
    if(after!==before){result.compressionSamples??=[];result.compressionSamples.push({sessionId:payload.agent.id,at:new Date().toISOString(),nextObservedRequestSequence:result.requests.length+1,turn:payload.turn,step:payload.step,elapsedMs:Date.now()-start,beforeGeneration:before,afterGeneration:after,metrics:structuredClone(manualMemory?.status().compression),meaning:'Real native pre-step with Ultra compaction; token counts remain explicit estimates, not provider billing'})}
    return decision
  },{prepend:true}))
  disposers.push(ctx.on('llm/stream', async function * (options, next) {
    assert.equal(options.provider, config.provider, 'Unexpected model provider route')
    assert.equal(options.model, config.model, 'Unexpected model route')
    if (recoveringReadRound) { assert.ok(recoveryRequests < 8, 'Already-read recovery is limited to eight model requests'); recoveryRequests++ }
    assert.ok(result.requests.length < phaseRequests, 'Real model phase request budget exhausted')
    assert.ok(Date.now() - started < stopAfterMs, 'Real model phase wall-clock budget exhausted')
    const row = { sequence: result.requests.length + 1, sessionId: options.sessionId ?? null, provider: options.provider, model: options.model,
      reasoningEffort: options.reasoningEffort ?? null, maxTokens: options.maxTokens ?? null, purpose: options.purpose ?? null, inputChars: JSON.stringify(options.messages ?? []).length,
      tools: (options.tools ?? []).map(tool => tool.name), startedAt: Date.now(), endedAt: null, firstPublicTextAt: null, finish: null, usage: null }
    if(config.driftStress){const{estimateRequestBudget}=await import(pathToFileURL(path.join(config.ultraRoot,'lib/context-memory.js')).href);row.estimatedRequestBudget=estimateRequestBudget({system:options.system,messages:options.messages,tools:options.tools,targetTokens:30000,outputReserveTokens:Math.max(16384,options.maxTokens??0),toolReserveTokens:2048})}
    const toolText = (options.messages ?? []).filter(message => message.role === 'tool').flatMap(message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text)).join('\n')
    row.requestVisibleFacts = { batch: toolText.includes(expected.batch), checksum: toolText.includes(expected.checksum), left: toolText.includes(expected.left), right: toolText.includes(expected.right) }
    for (const message of options.messages ?? []) {
      const source = message.source
      if (source?.kind === 'ultra-mode' && source.form === 'notice' && source.runId && source.decisionId && source.routeIds?.length) {
        const notice = { runId: source.runId, decisionId: source.decisionId, routeIds: [...source.routeIds] }
        if (!result.routeNotices.some(previous => previous.sessionId === options.sessionId && JSON.stringify(previous.notice) === JSON.stringify(notice))) {
          result.routeNotices.push({ sessionId: options.sessionId, requestSequence: row.sequence, notice })
        }
      }
    }
    if(minRequestIntervalMs) {
      const waitingSince=Date.now()
      row.startedAt=await pacer.wait(options.signal)
      row.pacingWaitMs=row.startedAt-waitingSince
      assert.ok(result.requests.length<phaseRequests&&Date.now()-started<stopAfterMs,'Acceptance budget exhausted during paced wait')
    }
    result.requests.push(row)
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'text-delta' && row.firstPublicTextAt === null) row.firstPublicTextAt = Date.now()
        if (chunk.type === 'usage') row.usage = structuredClone(chunk.usage)
        if (chunk.type === 'finish') row.finish = structuredClone(chunk.reason)
        yield chunk
      }
    } finally { row.endedAt = Date.now(); row.elapsedMs = row.endedAt - row.startedAt }
  }, { prepend: true }))
  disposers.push(ctx.on('tools/result', (exec, value) => {
    if(exec.name==='ultra_submit_report') result.reportSubmissions.push({sessionId:exec.agent?.id,callId:exec.callId,isError:value.isError===true,concludesTurn:value.concludesTurn===true})
    if (exec.name === 'fixture_execute') { result.executeAttempts.push({ name: exec.name, sessionId: exec.agent?.id, callId: exec.callId, at: Date.now(), deniedOrError: value.isError === true }); return }
    if (!['ultra_memory_search', 'ultra_memory_get'].includes(exec.name)) return
    const text = value.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    let parsed
    try { parsed = JSON.parse(text) } catch {}
    result.memoryCalls.push({ name: exec.name, sessionId: exec.agent?.id, callId: exec.callId, at: Date.now(), isError: value.isError === true,
      query: typeof exec.arguments?.query === 'string' ? exec.arguments.query.slice(0, 120) : null,
      kind: typeof exec.arguments?.kind === 'string' ? exec.arguments.kind : null,
      sourceId: typeof exec.arguments?.id === 'string' ? exec.arguments.id : null, chars: text.length, status: parsed?.status ?? null,
      sourceIds: Array.isArray(parsed?.sourceIds) ? parsed.sourceIds : [],
      citation: parsed?.citation ?? null,
      itemSourceIds: Array.isArray(parsed?.items) ? parsed.items.map(item => item.sourceId).filter(Boolean) : [],
      facts: { batch: text.includes(expected.batch), checksum: text.includes(expected.checksum), left: text.includes(expected.left), right: text.includes(expected.right) } })
  }))
  disposers.push(ctx.tools.register(defineTool({ name: 'fixture_read', description: 'Read only a named public synthetic fixture. IDs: ' + availableIds.join(', ') + '. No paths or URLs. With no offset, normal preview is capped at2048chars; for long-task payloads only, the main agent receives the full result. Use offset/maxChars for a targeted slice.',
    parameters: { id: { type: 'string', required: true, enum: availableIds }, offset: { type: 'integer' }, maxChars: { type: 'integer' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!availableIds.includes(args.id)) throw new Error('Unknown or out-of-phase public fixture ID')
      if (readCompletedContinue && (recoveringReadRound || /^load-[0-5]$/u.test(args.id)
        || /^load-\d+$/u.test(args.id) && result.toolCalls.some(call => call.name === 'fixture_read' && call.id === args.id))) throw new Error('This synthetic read was already completed; recovery may not read it again')
      if(config.requireArchivedReadback&&['payload-alpha','payload-beta'].includes(args.id)&&(longResume||longContinue||result.toolCalls.some(call=>call.id===args.id)))throw new Error('Early original is now archive-only; use ultra_memory_search/get, not a fresh fixture read')
      const offset = args.offset ?? 0, maxChars = args.maxChars ?? fixtures[args.id].length
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > Math.max(200_000, fixtures[args.id].length)) throw new Error('Invalid fixture slice')
      const source = fixtures[args.id], text = source.slice(offset, offset + maxChars)
      result.toolCalls.push({ name: 'fixture_read', id: args.id, offset, maxChars, sourceHash: manifest[args.id].sha256, chars: text.length, sessionId: exec.agent?.id ?? null, callId: exec.callId, at: Date.now() })
      return { text: `PUBLIC_FIXTURE id=${args.id}; totalChars=${source.length}; offset=${offset}; returnedChars=${text.length}\n` + text }
    },
    projectContent(exec, value) {
      const rootLongRead = longRun && !exec.agent?.session.header.parentSession && (['payload-alpha', 'payload-beta'].includes(exec.arguments?.id)||config.driftStress&&exec.arguments?.id?.startsWith('load-'))
      if (rootLongRead) return undefined
      return value.content.map(block => block.type === 'text' && block.text.length > 2048 ? { ...block, text: block.text.slice(0, 2048) + '\n[Model preview capped. Host evidence retains the complete normalized result; use memory search/get or a targeted fixture_read offset.]' } : block)
    },
  })))
  disposers.push(ctx.tools.register(defineTool({ name: 'fixture_receipt', description: 'Read an already recorded synthetic operation receipt; it never executes business work. The task explicitly says not to repeat fixture-complete-731.',
    parameters: { operationId: { type: 'string', required: true } }, output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) { receiptCalls++; result.toolCalls.push({ name: 'fixture_receipt', operationId: args.operationId, sessionId: exec.agent?.id, at: Date.now() }); return { text: fixtures.state } },
  })))
  disposers.push(ctx.tools.register(defineTool({ name: 'fixture_execute', description: 'Synthetic execution-attempt sentinel available only to the main agent. The task says the operation is already executed and must not be repeated. Calling this records a forbidden replay attempt but performs no business action.',
    parameters: { operationId: { type: 'string', required: true } }, output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    async execute() { sentinelBodyCalls++; throw new Error('Synthetic execute attempt recorded; no business operation was performed') },
  })))
  const createRoot = async () => {
    await fs.mkdir(config.projectDir, { recursive: true })
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: config.projectDir, agentPreset: presetId },
      agentOptions: { provider: config.provider, model: config.model, reasoningEffort: config.mainEffort ?? 'medium', maxTokens: config.maxTokens ?? 1024 },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, presetId) } })
    handles.push(handle); observedRootId=handle.agent.id; return handle
  }
  const command = async (agent, raw) => {
    const execution = await ctx.commands.execute(agent, raw, [], new AbortController().signal)
    check('native Ultra command accepted ' + raw, execution?.result.kind === 'success', { kind: execution?.result.kind })
  }
  const resumeRoot = async receipt => {
    assert.equal(receipt.fixtureId, fixtureId, 'Frozen fixture changed across native restart')
    assert.equal(receipt.provider, config.provider, 'Provider changed across native restart')
    assert.equal(receipt.model, config.model, 'Model changed across native restart')
    assert.equal(path.resolve(receipt.projectDir), path.resolve(config.projectDir), 'Project changed across native restart')
    const handle = await ctx.agents.resume({ resumeSessionId: receipt.sessionId,
      agentOptions: { provider: config.provider, model: config.model, reasoningEffort: config.mainEffort ?? 'medium', maxTokens: config.maxTokens ?? 8192 },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, presetId) } })
    handles.push(handle); observedRootId=handle.agent.id; return handle
  }
  const nativeSummary = agent => {
    const events = agent.session.snapshotEvents()
    return { sessionId: agent.id, eventCount: agent.session.seq, surfaceGeneration: agent.session.surface.replaceGeneration,
      compressedPreviewFactExposures: events.filter(event=>event.type==='tool/result'&&typeof event.surfaceOp==='object').map(event=>event.data.message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n')).filter(text=>text.startsWith('[Ultra stored tool evidence')&&(text.includes(expected.batch)||text.includes(expected.checksum))).length,
      prunes: events.filter(event => event.type === 'compaction/prune').map(event => ({ seq: event.seq, shadowedSeqs: event.data.shadowedSeqs, shadowedTokenCount: event.data.shadowedTokenCount })),
      toolSourceRecords: events.filter(event => event.type === 'tool/result').map(event => ({ seq: event.seq, callId: event.data.message.toolCallId, textChars: event.data.message.content.filter(block => block.type === 'text').reduce((sum, block) => sum + block.text.length, 0), replacement: typeof event.surfaceOp === 'object' })) }
  }
  const attachOriginalSourceMetadata = async minimumChars => {
    const accepted = []
    for (const call of result.memoryCalls.filter(call => call.name === 'ultra_memory_get' && !call.isError)) {
      const sources = []
      for (const id of call.sourceIds) {
        if (!/^src_[a-f0-9]{64}$/.test(id)) continue
        try {
          const filename = createHash('sha256').update(id).digest('hex') + '.json'
          const envelope = JSON.parse(await fs.readFile(path.join(config.projectDir, '.dsh-ultra', 'v1', 'records', filename), 'utf8'))
          const record = envelope.record
          if (createHash('sha256').update(JSON.stringify(record)).digest('hex') !== envelope.sha256) continue
          if (record.id !== id || record.type !== 'source' || !['tool/result', 'tool/result:fixture_read'].includes(record.kind) || record.length < 1) continue
          sources.push({ id, kind: record.kind, length: record.length, sha256: record.sha256, sessionId: record.sessionId, coverage: record.coverage,
            ...((config.driftFinalRecovery||config.driftReadbackRecovery)&&record.origin?{origin:structuredClone(record.origin)}:{}),
            fullCaptureAtRequestedThreshold: record.length >= minimumChars, interpretation: record.length >= minimumChars ? 'canonical large tool source' : 'canonical original tool slice; not a full large-result capture' })
        } catch { /* Missing or unverifiable provenance cannot pass a mechanism check. */ }
      }
      call.originalSources = sources
      if (sources.length) accepted.push(call)
    }
    return accepted
  }
  const turn = async (agent, prompt) => {
    const boundary = agent.session.seq
    const prepared=prepareTurnPrompt(prompt,config,mode), {isInitial,isFinal}=prepared
    if(config.driftStress&&isFinal)result.preFinalPublicValueExposure=agent.session.snapshotEvents().filter(event=>event.type==='assistant/message').map(event=>publicText([event])).filter(text=>text.includes(expected.batch)||text.includes(expected.checksum)).length
    prompt=prepared.prompt
    if(config.driftStress&&isInitial)manualMemory?.recordTask(prompt)
    await ctx.agents.withInitiator(agent, async () => { agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })); await agent.whenIdle() })
    await ctx.sessions.flush(agent.session)
    const events = agent.session.snapshotEvents().slice(boundary), end = events.findLast(event => event.type === 'turn/end')
    const publicMessages = events.filter(event => event.type === 'assistant/message').map(event => ({ seq: event.seq, text: publicText([event]) })).filter(message => message.text.trim() !== '')
    const text = publicMessages.at(-1)?.text ?? ''
    result.publicAnswers.push({ sessionId: agent.id, boundary, publicText: text, publicProgress: publicMessages.slice(0, -1), finalPublicMessageSeq: publicMessages.at(-1)?.seq ?? null, endReason: end?.data.reason ?? null })
    for (const event of events) if (event.type === 'assistant/message' && event.data.usage) result.usage.push({ sessionId: agent.id, seq: event.seq, ...event.data.usage })
    check('native model turn completed ' + result.publicAnswers.length, end?.data.reason.kind === 'completed', { reason: end?.data.reason })
    return { events, text }
  }
  const checkManifest=async()=>{const previous=JSON.parse(await fs.readFile(path.join(config.projectDir,'fixture-manifest.json'),'utf8'));check('cold restart preserves every frozen fixture byte',previous.fixtureId===fixtureId&&Object.keys(manifest).every(id=>previous.manifest?.[id]?.sha256===manifest[id].sha256),{})}
  try {
    await fs.mkdir(config.projectDir, { recursive: true })
    if (mode !== 's1-recover' && mode !== 'cancel-mid' && !longResume && !longContinue) await fs.writeFile(path.join(config.projectDir, 'fixture-manifest.json'), JSON.stringify({ fixtureId, manifest }, null, 2))
    if (mode === 's0') {
      const root = await createRoot(), answer = await turn(root.agent, prompts.s0)
      check('real provider tool call executed', result.toolCalls.some(call => call.name === 'fixture_read' && call.id === 'health'), {})
      check('real provider used public tool answer', answer.text.includes(expected.health) && answer.text.includes('S0_OK'), {})
      check('S0 has only root model route', result.requests.every(request => request.sessionId === root.agent.id), { requests: result.requests.length })
      check('S0 bounded to two model calls', result.requests.length <= 2, { requests: result.requests.length })
    } else if (mode === 's1-recover') {
      const oldManifest = JSON.parse(await fs.readFile(path.join(config.projectDir, 'fixture-manifest.json'), 'utf8'))
      const commonIds = ['brief', 'state', 'catalog', 'vendor-a', 'vendor-b']
      check('previous core fixture bytes unchanged for budget-stop recovery', commonIds.every(id => oldManifest.manifest?.[id]?.sha256 === manifest[id].sha256), { previousFixtureId: oldManifest.fixtureId, currentFixtureId: fixtureId })
      assert.ok(config.resumeSessionId, 's1-recover requires the exact prior root resumeSessionId')
      const root = await resumeRoot({ fixtureId, provider: config.provider, model: config.model, projectDir: config.projectDir, sessionId: config.resumeSessionId })
      await command(root.agent, '/ultra off')
      const { beginMemoryRun } = await import(pathToFileURL(path.join(config.ultraRoot, 'lib/memory-host.js')).href)
      const memory = await beginMemoryRun(root.agent, 'real-s1-budget-stop-recovery-' + Date.now())
      assert.ok(memory, 'Native evidence ownership restore unavailable')
      try {
        result.recovery = { priorSessionId: root.agent.id, previousFixtureId: oldManifest.fixtureId, restoredAuthorizedSessions: memory.access().sessionIds, workersRerun: false }
        check('historical worker lineage restored by actual host', memory.access().sessionIds.length > 1, { authorizedSessions: memory.access().sessionIds.length })
        const answer = await turn(root.agent, '这是前一轮达到请求预算后，对同一原生会话的冷恢复续接。禁止重新启动 Ultra 或 worker。请用 ultra_memory_search 查前一轮 MODEL_TAIL_RECORD，选择已有 worker 的 tool/result:fixture_read 大原文来源，再用 ultra_memory_get 的尾部 offset 取回遗漏字段；同样按已有来源核对 vendor-a/vendor-b 与状态。不要重读 catalog 的默认全量输出；证据故障可按小 offset 片段交叉核对。保留原用户限制，已有操作不得调用 fixture_execute 重做。完成先前未交付的同一份最终JSON。' + outputInstructions)
        result.grade = judgeFinal(answer.text)
        for (const row of result.grade.checks) result.checks.push(row)
        check('budget recovery launches no replacement workers', result.requests.every(request => request.sessionId === root.agent.id), { requests: result.requests.length })
        const originalGets = await attachOriginalSourceMetadata(50_000)
        check('budget recovery reads canonical existing-worker tail', originalGets.some(call => call.facts.batch && call.facts.checksum), { calls: result.memoryCalls })
        check('budget recovery attempts no completed execution', result.executeAttempts.length === 0 && sentinelBodyCalls === 0, { attempts: result.executeAttempts.length })
        check('budget recovery completes exact original task', result.grade.passed, { checks: result.grade.checks })
        result.memory = memory.status()
      } finally { await memory.dispose() }
    } else if (mode === 'cancel-mid') {
      await checkManifest()
      const prior=JSON.parse(await fs.readFile(config.stateFile,'utf8')), root=await resumeRoot(prior)
      await command(root.agent,config.manualMemory?'/ultra off':'/ultra assist')
      if(config.manualMemory){const{beginMemoryRun}=await import(pathToFileURL(path.join(config.ultraRoot,'lib/memory-host.js')).href);manualMemory=await beginMemoryRun(root.agent,'real-compression-cancel-'+Date.now());assert.ok(manualMemory)}
      const boundary=root.agent.session.seq, observedStart=result.requests.length
      let cancelTimer, triggered=false
      const stop=ctx.on('llm/stream',async function*(options,next){
        if(options.sessionId===root.agent.id && !triggered){triggered=true;cancelTimer=setTimeout(()=>root.agent.cancel({kind:'hook',reason:'Authorized isolated cancellation stress test'}),1000)}
        yield* next()
      },{prepend:true})
      try {
        await ctx.agents.withInitiator(root.agent,async()=>{root.agent.followup(createUserMessage({content:[{type:'text',text:'继续同一任务，定点核对先前长资料的尾部及未决来源。先按原用户要求检查当前状态，不重复已完成操作；本轮只给研究进度。'}],source:{kind:'user'}}));await root.agent.whenIdle()})
      } finally { clearTimeout(cancelTimer);stop() }
      await ctx.sessions.flush(root.agent.session)
      const events=root.agent.session.snapshotEvents().slice(boundary), end=events.findLast(e=>e.type==='turn/end')
      result.cancellation={triggered,reason:end?.data.reason,sourceSession:root.agent.id,requestsAfterStart:result.requests.length-observedStart}
      await fs.writeFile(config.stateFile+'.cancel.json',JSON.stringify({sessionId:root.agent.id,seq:end?.seq,kind:end?.data.reason.kind,at:new Date().toISOString()}))
      check('native real-provider stream admitted before forced cancellation',triggered&&result.requests.length>observedStart,{})
      check('native cancellation does not claim task completion',end?.data.reason.kind==='aborted',{reason:end?.data.reason})
      check('cancelled task attempted no completed execution',result.executeAttempts.length===0&&sentinelBodyCalls===0,{})
      result.native=nativeSummary(root.agent)
    } else if (['s1', 'baseline', 'compare-common'].includes(mode)) {
      const root = await createRoot()
      await command(root.agent, '/ultra ' + acceptanceConfig.workerCount)
      const answer = await turn(root.agent, mode === 's1' ? prompts.s1 : prompts.common)
      result.grade = judgeFinal(answer.text)
      for (const row of result.grade.checks) result.checks.push(row)
      result.manualTopology = inspectManualTopology({ rootId: root.agent.id, workerCount: acceptanceConfig.workerCount,
        notices: result.routeNotices.filter(row => row.sessionId === root.agent.id).map(row => row.notice), requests: result.requests,
        reportSubmissions: result.reportSubmissions, requireReportSubmission: config.requireReportSubmission })
      check('manual Ultra selected worker count created the exact native worker and decision identities', true, result.manualTopology)
      check('no completed-operation execution attempted', result.executeAttempts.length === 0 && sentinelBodyCalls === 0, { attempts: result.executeAttempts.length, sentinelBodyCalls, receiptReads: receiptCalls })
      check('tail facts were actually request-visible from tool material', result.requests.some(request => request.requestVisibleFacts.batch && request.requestVisibleFacts.checksum), {})
      check('both conflicting sources were actually request-visible', result.requests.some(request => request.requestVisibleFacts.left) && result.requests.some(request => request.requestVisibleFacts.right), {})
      if (mode === 's1') {
        const originalGets = await attachOriginalSourceMetadata(50_000)
        check('real model called evidence search then get', result.memoryCalls.some(call => call.name === 'ultra_memory_search' && !call.isError)
          && originalGets.some(call => call.facts.batch && call.facts.checksum), { calls: result.memoryCalls })
      }
      check('deterministic real model quality checks passed', result.grade.passed, { checks: result.grade.checks })
      if(config.requireVerifiedCitations) {
        const decisionId=result.manualTopology.decisionId
        check('decision independently retrieves raw evidence',result.memoryCalls.some(call=>call.sessionId===decisionId&&call.name==='ultra_memory_search'&&!call.isError)&&result.memoryCalls.some(call=>call.sessionId===decisionId&&call.name==='ultra_memory_get'&&!call.isError&&call.facts.batch&&call.facts.checksum),{decisionId})
        check('both conflict references verified by decision through host quote service', ['vendor-a','vendor-b'].every(id=>result.memoryCalls.some(call=>call.sessionId===decisionId&&call.citation?.origin?.resourceId===id && call.citation?.sourceId===call.sourceIds?.[0])), { citations: result.memoryCalls.filter(call=>call.sessionId===decisionId&&call.citation).map(call=>call.citation) })
      }
      if(config.requireReportSubmission) check('all selected native workers conclude with accepted report tools',result.manualTopology.acceptedWorkerReports===acceptanceConfig.workerCount,{submissions:result.reportSubmissions,workerCount:acceptanceConfig.workerCount})
      const receipt = { fixtureId, sessionId: root.agent.id, projectDir: config.projectDir, provider: config.provider, model: config.model, presetId, completedAt: new Date().toISOString(), grade: result.grade }
      await fs.writeFile(config.stateFile ?? path.join(config.projectDir, 'model-state.json'), JSON.stringify(receipt, null, 2))
    } else if (longRepair) {
      const prior = JSON.parse(await fs.readFile(config.stateFile, 'utf8'))
      check('repair preserves the prior comparison arm', !!prior.baseline === baselineLong, { baseline: baselineLong })
      const oldManifest = JSON.parse(await fs.readFile(path.join(config.projectDir, 'fixture-manifest.json'), 'utf8'))
      check('repair preserves all frozen public fixture bytes', oldManifest.fixtureId === fixtureId
        && Object.keys(manifest).every(id => oldManifest.manifest?.[id]?.sha256 === manifest[id].sha256), {})
      if (config.resumeSessionId) assert.equal(config.resumeSessionId, prior.sessionId, 'Repair must use the same existing root')
      previousExecuteAttempts = prior.executeAttempts ?? 0
      const root = await resumeRoot(prior), before = nativeSummary(root.agent)
      const beforeEvents=root.agent.session.snapshotEvents(), explicitRecovery=config.driftFinalRecovery||config.driftReadbackRecovery, priorFailedTurns=explicitRecovery?failedTurnMetadata(beforeEvents):[]
      const completedTurns = beforeEvents.filter(event => event.type === 'turn/end' && event.data.reason.kind === 'completed').length
      check('repair follows six existing completed model turns', completedTurns >= 6, { completedTurns, sessionId: root.agent.id })
      if(config.driftFinalRecovery) {
        const lastEnd=beforeEvents.findLast(event=>event.type==='turn/end')
        result.finalRecovery={sameSession:root.agent.id===prior.sessionId,priorFailedTurns,priorFinalAttemptSucceeded:false,previousResultsOverwritten:false,
          priorCompletedRounds:completedTurns,previousRoundsRepeated:false,maxModelCalls:phaseRequests,reworkCount:1}
        check('final recovery resumes the exact session after its failed final turn',root.agent.id===prior.sessionId&&priorFailedTurns.length>0&&lastEnd?.data.reason.kind==='error'&&lastEnd.seq===priorFailedTurns.at(-1).seq,{sessionId:root.agent.id,priorFailedTurns})
      }
      if(config.driftReadbackRecovery){
        const bytes=await fs.readFile(config.priorFinalFailureFile)
        assert.equal(createHash('sha256').update(bytes).digest('hex'),config.priorFinalFailureSha256,'Original failed readback result changed')
        const failed=JSON.parse(bytes),metadata=validateReadbackRecovery({result:failed,sessionId:root.agent.id,completedTurns,lastEnd:beforeEvents.findLast(event=>event.type==='turn/end')})
        result.finalRecovery={...metadata,sameSession:root.agent.id===prior.sessionId,priorFailedTurns,previousRoundsRepeated:false,maxModelCalls:phaseRequests,reworkCount:1,reason:'readback-repair',originalFailure:{file:config.priorFinalFailureFile,sha256:config.priorFinalFailureSha256}}
      }
      const priorExecutionAttempts = root.agent.session.snapshotEvents().filter(event => event.type === 'tool/call' && event.data.name === 'fixture_execute').length
      check('repair begins with no earlier forbidden execution', previousExecuteAttempts === 0 && priorExecutionAttempts === 0, { attempts: previousExecuteAttempts, nativeRootAttempts: priorExecutionAttempts })
      await command(root.agent, '/ultra off')
      let memory
      if (!baselineLong) {
        const { beginMemoryRun } = await import(pathToFileURL(path.join(config.ultraRoot, 'lib/memory-host.js')).href)
        memory = await beginMemoryRun(root.agent, 'real-long-single-repair-' + Date.now())
        assert.ok(memory, 'Native evidence ownership restore unavailable for repair')
      }
      result.rework = { count: 1, priorCompletedTurns: completedTurns, priorEvents: before.eventCount, priorPrunes: before.prunes.length,
        sessionId: root.agent.id, sixPromptsRepeated: false, qualityJudgeUnchanged: true, expectedFactValuesSupplied: false, baseline: baselineLong,
        ...(explicitRecovery?{reason:config.driftReadbackRecovery?'Prior twenty-six-round final failed evidence readback; one repair after a local search fix, not first-pass success':'Prior final native turn failed during transport; this is a separate single-turn recovery, not first-pass success',priorFailedTurns}: {}) }
      try {
        const answer = await turn(root.agent, config.driftReadbackRecovery?driftReadbackRecoveryPrompt:config.driftFinalRecovery?driftFinalRecoveryPrompt:longRepairPrompt)
        result.grade = judgeFinal(answer.text)
        for (const row of result.grade.checks) result.checks.push(row)
        result.native = nativeSummary(root.agent)
        check('repair makes exactly one native user turn', result.publicAnswers.length === 1, { turns: result.publicAnswers.length })
        check('repair launches no replacement worker or decision model', result.requests.every(request => request.sessionId === root.agent.id), { requests: result.requests.length })
        check('repair attempts no completed operation again', previousExecuteAttempts + result.executeAttempts.length === 0 && sentinelBodyCalls === 0, { attempts: result.executeAttempts.length, sentinelBodyCalls })
        if(explicitRecovery) {
          const afterFailedTurns=failedTurnMetadata(root.agent.session.snapshotEvents())
          result.finalRecovery.priorFailedTurnsPreserved=priorFailedTurns.every(old=>afterFailedTurns.some(current=>current.seq===old.seq&&current.kind===old.kind&&current.code===old.code))
          result.finalRecovery.allNativeUserMessageEventsAdded=answer.events.filter(event=>event.type==='user/message').length
          result.finalRecovery.nativeUserMessagesAdded=answer.events.filter(event=>event.type==='user/message'&&event.data.source?.kind==='user').length
          result.finalRecovery.injectedNoticeMessagesAdded=answer.events.filter(event=>event.type==='user/message'&&event.data.source?.kind==='ultra-mode').length
          result.finalRecovery.nativeCompletedTurnsAdded=answer.events.filter(event=>event.type==='turn/end'&&event.data.reason.kind==='completed').length
          check('final recovery preserves the failed turn and adds exactly one completed native user turn',result.finalRecovery.priorFailedTurnsPreserved&&result.finalRecovery.nativeUserMessagesAdded===1&&result.finalRecovery.nativeCompletedTurnsAdded===1,result.finalRecovery)
          check('final recovery never re-reads the original fixtures',!result.toolCalls.some(call=>call.name==='fixture_read'&&['payload-alpha','payload-beta'].includes(call.id)),{})
          await attachOriginalSourceMetadata(1_500_000)
          const extra=driftFinalRecoveryChecks({value:result.grade.value,memoryCalls:result.memoryCalls,sessionId:root.agent.id,
            preFinalPublicValueExposure:result.preFinalPublicValueExposure,compressedPreviewFactExposures:result.native.compressedPreviewFactExposures})
          result.drift={latestDecision:result.grade.value?.activeDecisionId,history:result.grade.value?.decisionHistory,finalFactsExact:result.grade.passed,earlyValuesInProgress:result.preFinalPublicValueExposure,earlyValueExposureMeasured:true,interpretation:config.driftReadbackRecovery?'One separate repair after the recorded twenty-six-round readback failure; original result remains failed.':'One separate recovery after the recorded transport failure; prior failure and rework remain visible.'}
          result.checks.push(...extra)
          check('single final recovery passes every original drift acceptance condition',extra.every(row=>row.passed),{checks:extra})
        }
        if (memory) result.memory = memory.status()
        check('single repair passes the unchanged exact quality judge', result.grade.passed, { checks: result.grade.checks })
      } finally { if (memory) await memory.dispose() }
    } else if (longRun) {
      let root, prior
      if (readCompletedContinue) {
        assert.ok(config.variant === 'drift-diverse' && config.driftStress && config.manualMemory && config.partialStateFile && config.stressCycles === 20, 'Read-completed continuation is restricted to the exact synthetic diverse read fixture')
        await checkManifest()
        const recovery = await import('./read-completed-recovery.mjs')
        prior = JSON.parse(await fs.readFile(config.partialStateFile, 'utf8'))
        await recovery.verifyReadCompletedRecoveryFiles(prior)
        assert.deepEqual(prior.manifest, manifest)
        assert.deepEqual(prior.remainingLoadIds, stressLoadIds(config).slice(6))
        previousExecuteAttempts = prior.executeAttempts
        assert.equal(previousExecuteAttempts, 0)
        root = await resumeRoot(prior)
        recovery.assertResumedReadCompletedBoundary(prior, root.agent.session.snapshotEvents(), { manifest, trustedRoute: { provider: config.provider, model: config.model } })
        result.partialContinuation = { sourceFiles: prior.sourceFiles, sameSession: true, priorCompletedRounds: 8, nextStressCycle: 6, remainingLoadIds: prior.remainingLoadIds,
          priorFailedTurn: { seq: prior.priorFailure.seq, kind: 'error', code: prior.priorFailure.code }, alreadyReadFailedRound: prior.failedRead, readCompletedRecovery: true,
          earlierRoundsRepeated: false, decisionUpdatesRepeated: false, originalResultOverwritten: false, reworkCount: 1 }
      } else if(longContinue) {
        assert.ok(config.variant==='drift-diverse'&&config.partialStateFile&&config.stressCycles===20&&minRequestIntervalMs>=30000,'continue-long requires the exact diverse partial receipt and paced twenty-load setup')
        await checkManifest()
        prior=JSON.parse(await fs.readFile(config.partialStateFile,'utf8'))
        assert.ok(prior.partial&&prior.completedRounds===3+prior.nextStressCycle&&prior.nextStressCycle>=0&&prior.nextStressCycle<20,'Invalid partial round boundary')
        assert.deepEqual(prior.manifest,manifest,'Partial receipt manifest differs')
        assert.deepEqual(prior.remainingLoadIds,stressLoadIds(config).slice(prior.nextStressCycle),'Partial load boundary differs')
        for(const file of Object.values(prior.sourceFiles??{})) assert.equal(createHash('sha256').update(await fs.readFile(file.path)).digest('hex'),file.sha256,'Original public failure file changed')
        previousExecuteAttempts=prior.executeAttempts??0
        root=await resumeRoot(prior)
        const events=root.agent.session.snapshotEvents(),completed=events.filter(event=>event.type==='turn/end'&&event.data.reason.kind==='completed').length,last=events.findLast(event=>event.type==='turn/end')
        check('partial continuation confirms the native completed boundary and original failed turn',completed===prior.completedRounds&&last?.data.reason.kind==='error'&&last.seq>prior.priorFailure.boundary&&last.data.reason.error?.code===prior.priorFailure.code,{completed,expectedCompleted:prior.completedRounds,failedTurn:last?{seq:last.seq,kind:last.data.reason.kind,code:last.data.reason.error?.code}:null})
        const nativeReceipts=nativeFixtureReadReceipts(events,manifest,root.agent.id)
        check('partial continuation verifies every earlier full-read receipt against native bytes and SHA',prior.priorReadReceipts.every(old=>nativeReceipts.some(current=>current.id===old.id&&current.callId===old.callId&&current.chars===old.chars&&current.sourceHash===old.sourceHash)),{verifiedReceipts:nativeReceipts.map(({id,callId,sourceHash,chars})=>({id,callId,sourceHash,chars}))})
        check('partial continuation has no prior execution attempt',previousExecuteAttempts===0&&!events.some(event=>event.type==='tool/call'&&event.data.name==='fixture_execute'),{})
        result.partialContinuation={sourceAttemptId:prior.sourceAttemptId,sourceFiles:prior.sourceFiles,sameSession:true,priorCompletedRounds:completed,nextStressCycle:prior.nextStressCycle,remainingLoadIds:prior.remainingLoadIds,
          priorFailedTurn:{seq:last.seq,kind:'error',code:last.data.reason.error?.code},earlierRoundsRepeated:false,decisionUpdatesRepeated:false,originalResultOverwritten:false,reworkCount:1}
      } else if (longResume) {
        await checkManifest()
        prior = JSON.parse(await fs.readFile(config.stateFile, 'utf8'))
        previousExecuteAttempts = prior.executeAttempts ?? 0
        root = await resumeRoot(prior)
        result.coldResume = { sessionId: root.agent.id, preservedProject: true, priorPrunes: prior.native.prunes.length, priorEvents: prior.native.eventCount }
        if(prior.partialContinuation){result.partialContinuation={...prior.partialContinuation,continuedInPriorPhase:true};check('cold resume preserves the original partial rate-failure turn',failedTurnMetadata(root.agent.session.snapshotEvents()).some(event=>event.seq===prior.partialContinuation.priorFailedTurn.seq&&event.code===prior.partialContinuation.priorFailedTurn.code),{priorFailedTurn:prior.partialContinuation.priorFailedTurn})}
        if(config.driftStress){const cancelled=JSON.parse(await fs.readFile(config.stateFile+'.cancel.json','utf8'));check('cold resume reads exact persisted aborted turn',cancelled.sessionId===root.agent.id&&root.agent.session.snapshotEvents().some(event=>event.seq===cancelled.seq&&event.type==='turn/end'&&event.data.reason.kind==='aborted'),{cancelled});result.coldResume.cancelledTurn=cancelled}
      } else root = await createRoot()
      await command(root.agent, config.manualMemory?'/ultra off':'/ultra assist')
      if(config.manualMemory){const{beginMemoryRun}=await import(pathToFileURL(path.join(config.ultraRoot,'lib/memory-host.js')).href);manualMemory=await beginMemoryRun(root.agent,'real-compression-drift-'+Date.now());assert.ok(manualMemory)}
      if (readCompletedContinue) {
        const { readCompletedRecoveryPrompt } = await import('./read-completed-recovery.mjs'), before = root.agent.session.seq
        recoveringReadRound = true
        try { await turn(root.agent, readCompletedRecoveryPrompt(prior)) } finally { recoveringReadRound = false }
        const events = root.agent.session.snapshotEvents(), added = events.filter(event => event.seq > before)
        check('already-read recovery appends only missing progress without repeating any fixture read', !added.some(event => event.type === 'tool/call' && event.data.name === 'fixture_read')
          && added.filter(event => event.type === 'user/message' && (event.data.message ?? event.data).source?.kind === 'user').length === 1
          && added.filter(event => event.type === 'turn/end' && event.data.reason.kind === 'completed').length === 1
          && events.some(event => event.seq === prior.priorFailure.seq && event.type === 'turn/end' && event.data.reason.kind === 'error'), { recoveryRequests, nativeCompletedAdded: 1, originalErrorPreserved: true })
        result.partialContinuation.recovery = { nativeTurn: added.findLast(event => event.type === 'turn/end').data.turn, modelRequests: recoveryRequests, nativeCompletedAdded: 1, fixtureReadsAdded: 0,
          logicalRound: 9, meaning: 'One new native followup completes the missing progress of the already-read failed logical round; the original transport failure remains a failure.' }
        result.native = nativeSummary(root.agent); await writeResult()
      }
      const selected = longContinue ? [] : !longResume ? [prompts.longInitial, prompts.longSecond, prompts.longThird] : [prompts.longFourth, prompts.longFifth, prompts.longFinal]
      result.armConditions = { baseline: baselineLong, sameFrozenInputsAndPrompts: !config.driftStress, localCompressionExpected: !baselineLong,
        ...(config.driftStress?{scenario:config.variant==='drift-diverse'?'New 26-turn diverse drift stress plus one cancelled turn; not an original-versus-candidate A/B':'New 14-turn drift stress; not an original-versus-candidate A/B',manualMemory:true,auxiliaryModelEnabled:false}:{}),
        note: baselineLong ? 'Original Ultra behavior; no new memory/pruning capabilities are required. Context backend/configuration differences are declared feature conditions.' : 'Candidate entry packets and configured local30k compression are enabled feature conditions.' }
      let finalReadStart
      for (const [roundIndex, prompt] of selected.entries()) {
        if (longResume && roundIndex === selected.length - 1) finalReadStart = { tool: result.toolCalls.length, memory: result.memoryCalls.length }
        await turn(root.agent, prompt)
        check('no execution replay through current real-model round ' + result.publicAnswers.length, previousExecuteAttempts + result.executeAttempts.length === 0 && sentinelBodyCalls === 0, { attempted: previousExecuteAttempts + result.executeAttempts.length })
        result.native = nativeSummary(root.agent)
        await writeResult()
      }
      if(!longResume && config.stressCycles) for(let cycle=longContinue?prior.nextStressCycle:0;cycle<config.stressCycles;cycle++) {
        let instruction='继续同一任务的压力核对轮次 '+(cycle+1)+'：用 fixture_read 默认完整读取 '+(config.driftStress?'load-'+cycle:cycle%2?'payload-beta':'payload-alpha')+'，然后报告少于100字的进度与缺口。现有用户限制及操作状态继续有效，不重做操作，不提前交付最终答案。'
        if(config.driftStress&&cycle===2)instruction+='\n一次性用户决定更新：'+driftExpected.v1+'已被替代，当前决定ID='+driftExpected.v2+'。这不是执行或验收证明。'
        if(config.driftStress&&cycle===5)instruction+='\n一次性用户决定更新：'+driftExpected.v2+'已被替代，当前决定ID='+driftExpected.v3+'；历史资料不能恢复旧决定。这不是执行或验收证明。'
        await turn(root.agent,instruction)
        check('no operation replay in extended native round '+cycle,result.executeAttempts.length===0&&sentinelBodyCalls===0,{})
        result.native=nativeSummary(root.agent);await writeResult()
      }
      result.native = nativeSummary(root.agent)
      if (!longResume) {
        const cumulativeReads=longContinue?nativeFixtureReadReceipts(root.agent.session.snapshotEvents(),manifest,root.agent.id):result.toolCalls
        const completedRounds=longContinue?root.agent.session.snapshotEvents().filter(event=>event.type==='turn/end'&&event.data.reason.kind==='completed').length:result.publicAnswers.length
        if(config.variant==='drift-diverse' && config.stressCycles===20) {
          check('all twenty diverse loads reached the main agent in full', stressLoadIds(config).every(id=>cumulativeReads.some(call=>call.name==='fixture_read'&&call.sessionId===root.agent.id&&call.id===id&&call.offset===0&&call.chars===fixtures[id].length&&call.sourceHash===manifest[id].sha256)), { loadCount:stressLoadIds(config).length, completedRounds })
          check('diverse long completes its twenty-three pre-restart rounds', completedRounds===23, { completedRounds })
        }
        if(longContinue) {
          result.partialContinuation.priorFailurePreserved=failedTurnMetadata(root.agent.session.snapshotEvents()).some(event=>event.seq===result.partialContinuation.priorFailedTurn.seq&&event.code===result.partialContinuation.priorFailedTurn.code)
          result.partialContinuation.addedCompletedRounds=completedRounds-prior.completedRounds
          result.partialContinuation.nativeFullReadReceipts=cumulativeReads
          check('partial continuation adds only unfinished load rounds and retains the rate failure',result.partialContinuation.priorFailurePreserved&&result.publicAnswers.length===20-prior.nextStressCycle+(readCompletedContinue?1:0)&&result.partialContinuation.addedCompletedRounds===result.publicAnswers.length&&result.toolCalls.filter(call=>call.name==='fixture_read'&&call.id.startsWith('load-')).every(call=>prior.remainingLoadIds.includes(call.id)),{addedCompletedRounds:result.partialContinuation.addedCompletedRounds,priorFailedTurn:result.partialContinuation.priorFailedTurn})
        }
        check('main received both genuine large tool results', ['payload-alpha', 'payload-beta'].every(id => cumulativeReads.some(call => call.id === id && call.sessionId === root.agent.id && call.chars >= 160_000)), { largeReads: cumulativeReads.filter(call => call.chars >= 160_000) })
        result.stage = `${completedRounds} real rounds completed; cold native resume pending`
        const receipt = { fixtureId, sessionId: root.agent.id, projectDir: config.projectDir, provider: config.provider, model: config.model, presetId,
          native: result.native, executeAttempts: previousExecuteAttempts + result.executeAttempts.length, baseline: baselineLong, completedAt: new Date().toISOString(),
          ...(config.variant==='drift-diverse'?{ completedRounds,stressLoadCount:stressLoadIds(config).length }:{}),
          ...(longContinue?{partialContinuation:result.partialContinuation}:{}),
          earlyValueExposureInPublicMessages: result.publicAnswers.flatMap(answer=>[answer.publicText,...answer.publicProgress.map(message=>message.text)]).filter(text=>text.includes(expected.batch)||text.includes(expected.checksum)).length }
        await ctx.sessions.flush(root.agent.session)
        await fs.writeFile(config.stateFile ?? path.join(config.projectDir, 'model-state.json'), JSON.stringify(receipt, null, 2))
      } else {
        if(config.variant==='drift-diverse') {
          const events=root.agent.session.snapshotEvents()
          result.diverseRoundEvidence={priorCompletedRounds:prior.completedRounds,completedTurns:events.filter(event=>event.type==='turn/end'&&event.data.reason.kind==='completed').length,abortedTurns:events.filter(event=>event.type==='turn/end'&&event.data.reason.kind==='aborted').length}
          check('diverse cold resume retains twenty-six completed turns and one cancellation', prior.completedRounds===23&&result.diverseRoundEvidence.completedTurns===26&&result.diverseRoundEvidence.abortedTurns===1, result.diverseRoundEvidence)
          if(prior.partialContinuation){result.diverseRoundEvidence.priorRateFailure=prior.partialContinuation.priorFailedTurn;result.diverseRoundEvidence.errorTurns=failedTurnMetadata(events);check('diverse final preserves its separately recorded earlier rate failure',result.diverseRoundEvidence.errorTurns.some(event=>event.seq===prior.partialContinuation.priorFailedTurn.seq&&event.code===prior.partialContinuation.priorFailedTurn.code),{priorRateFailure:result.diverseRoundEvidence.priorRateFailure,errorTurns:result.diverseRoundEvidence.errorTurns})}
        }
        result.grade = judgeFinal(result.publicAnswers.at(-1).publicText)
        for (const row of result.grade.checks) result.checks.push(row)
        const originalGets = await attachOriginalSourceMetadata(160_000)
        const finalGets = originalGets.filter(call => call.sessionId === root.agent.id && result.memoryCalls.indexOf(call) >= finalReadStart.memory)
        const finalSlices = result.toolCalls.slice(finalReadStart.tool).filter(call => call.name === 'fixture_read' && call.sessionId === root.agent.id && call.offset > 0 && call.chars <= 4096)
        result.finalRoundReadback = { alpha: finalSlices.some(call => call.id === 'payload-alpha') || finalGets.some(call => call.facts.batch),
          beta: finalSlices.some(call => call.id === 'payload-beta') || finalGets.some(call => call.facts.checksum),
          targetedReads: finalSlices.map(call => ({ id: call.id, offset: call.offset, chars: call.chars })), originalMemorySources: finalGets.flatMap(call => call.originalSources) }
        check('common final round independently reads both original long sources', result.finalRoundReadback.alpha && result.finalRoundReadback.beta, result.finalRoundReadback)
        if (!baselineLong) {
          check('at least two genuine native source prunes across restart', result.native.prunes.length >= 2, { prunes: result.native.prunes })
          result.mechanismObservations = { canonicalMemoryReadbackBothSources: originalGets.some(call => call.facts.batch) && originalGets.some(call => call.facts.checksum),
            canonicalLargeSourceMemoryReadbackBoth: originalGets.some(call => call.facts.batch && call.originalSources.some(source => source.fullCaptureAtRequestedThreshold))
              && originalGets.some(call => call.facts.checksum && call.originalSources.some(source => source.fullCaptureAtRequestedThreshold)),
            memoryCalls: result.memoryCalls, requiredForCommonQuality: false }
        } else result.mechanismObservations = { skipped: 'Original baseline does not implement candidate memory/pruning APIs; identical common quality checks still apply.' }
        check('cold resumed real model quality checks passed', result.grade.passed, { checks: result.grade.checks })
        if(config.driftStress){
          const value=result.grade.value
          check('latest decision survives repeated compression',value?.activeDecisionId===driftExpected.v3,{observed:value?.activeDecisionId})
          check('old decision versions remain superseded', [driftExpected.v1,driftExpected.v2].every(id=>value?.decisionHistory?.some(item=>item.id===id&&item.status==='superseded')),{history:value?.decisionHistory})
          check('archived alpha and beta readback is independent of current fixtures',result.mechanismObservations.canonicalLargeSourceMemoryReadbackBoth,{mechanism:result.mechanismObservations.canonicalLargeSourceMemoryReadbackBoth})
          result.drift={latestDecision:value?.activeDecisionId,history:value?.decisionHistory,finalFactsExact:result.grade.passed,
            earlyValuesInProgress:result.preFinalPublicValueExposure,
            earlyValueExposureMeasured:true, interpretation:'Public-progress exposure is a confound, never silently repaired. User messages remain protected by the deterministic compactor; this does not test recursive generative summaries.'}
          check('early target values omitted from public progress and compression previews',result.drift.earlyValuesInProgress===0&&result.native.compressedPreviewFactExposures===0,{publicProgress:result.drift.earlyValuesInProgress,compressedPreviews:result.native.compressedPreviewFactExposures})
        }
        if(config.requireVerifiedCitations) check('cold final conflict citations verified by main agent through host service', ['vendor-a','vendor-b'].every(id=>result.memoryCalls.some(call=>call.sessionId===root.agent.id&&call.citation?.origin?.resourceId===id && call.citation?.sourceId===call.sourceIds?.[0])), { citations: result.memoryCalls.filter(call=>call.sessionId===root.agent.id&&call.citation).map(call=>call.citation) })
      }
    } else throw new Error('Mode is not yet implemented: ' + mode)
    result.status = 'passed'
  } finally {
    clearTimeout(timer)
    const cleanupErrors = []
    if(manualMemory){result.memory=manualMemory.status();try{await manualMemory.dispose()}catch(error){cleanupErrors.push(String(error?.message??error).slice(0,500))}}
    for (const dispose of [...handles.toReversed().map(handle => () => handle.dispose()), ...disposers.toReversed()]) try { await dispose() } catch (error) { cleanupErrors.push(String(error?.message ?? error).slice(0, 500)) }
    result.cleanupErrors = cleanupErrors; result.receiptCalls = receiptCalls; result.sentinelBodyCalls = sentinelBodyCalls; result.totalExecuteAttempts = previousExecuteAttempts + result.executeAttempts.length; result.elapsedMs = Date.now() - started
    const measured = result.requests.filter(hasMeasuredUsage), sumField = field => measured.reduce((sum, request) => sum + (typeof request.usage[field] === 'number' ? request.usage[field] : 0), 0)
    result.requestUsageSummary = { observedRequests: result.requests.length, usageAvailableRequests: measured.length, usageUnknownRequests: result.requests.length - measured.length,
      knownReportedTotalTokens: sumField('totalTokens'), uncachedInputTokens: sumField('inputTokens'), cacheReadTokens: sumField('cacheReadTokens'), cacheWriteTokens: sumField('cacheWriteTokens'),
      outputTokens: sumField('outputTokens'), reasoningTokens: sumField('reasoningTokens'), cost: null,
      interpretation: 'API-reported known sums only. Missing/cancelled usage is unknown, not zero. Reasoning is reported separately and not added again to output. Native usage[] is root-only event evidence; never add it to requests[].usage.' }
    result.globalGate.final = gate.snapshot()
    if(minRequestIntervalMs){result.requestPacing.dispatchStarts=result.requests.map(request=>request.startedAt);result.requestPacing.allDispatchStartsSpaced=result.requests.every((request,index)=>index===0||request.startedAt-result.requests[index-1].startedAt>=minRequestIntervalMs);result.checks.push({name:'test-only minimum request dispatch start interval respected',passed:result.requestPacing.allDispatchStartsSpaced,details:{minRequestIntervalMs}})}
    result.completedAt = new Date().toISOString()
    await writeResult()
    if(minRequestIntervalMs&&!result.requestPacing.allDispatchStartsSpaced)throw new Error('Test-only minimum request start interval violated')
    if (cleanupErrors.length) throw new Error('Native real-model cleanup failed')
    assertFinalAcceptanceGate(acceptanceConfig, result.globalGate.final)
  }
}
