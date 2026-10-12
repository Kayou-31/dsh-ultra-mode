import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CollaborationTeam } from '../lib/collaboration.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const signal = () => new AbortController().signal

/** An offline adapter; no model, SDK provider, network, or filesystem work. */
function harness(options = {}, hooks = {}) {
  const rootId = options.rootId ?? 'parent'
  const prefix = options.runId ?? 'test-team'
  const record = { spawned: [], delivered: [], contexts: [], interrupted: [], closed: [] }
  let team
  const adapter = {
    async spawn(callerId, request, operationSignal) {
      const id = request.id
      const call = { id, callerId, request: { ...request }, signal: operationSignal }
      record.spawned.push(call)
      await hooks.spawn?.(call, team)
      return { id }
    },
    async deliver(callerId, targetId, message, operationSignal) {
      const call = { callerId, targetId, message, signal: operationSignal }
      record.delivered.push(call)
      await hooks.deliver?.(call, team)
      return `message-${record.delivered.length}`
    },
    async interrupt(callerId, targetId, operationSignal) {
      record.interrupted.push({ callerId, targetId, signal: operationSignal })
      await hooks.interrupt?.({ callerId, targetId }, team)
    },
    async close(children) {
      record.closed.push(children.map(child => ({ ...child })))
      await hooks.close?.(children, team)
    },
  }
  if (hooks.deliverContext) adapter.deliverContext = async (callerId, targetId, message, operationSignal) => {
    const call = { callerId, targetId, message, signal: operationSignal }
    record.contexts.push(call)
    await hooks.deliverContext(call, team)
    return `context-${record.contexts.length}`
  }
  team = new CollaborationTeam({ runId: prefix, rootId, ...options }, adapter)
  return { team, rootId, record }
}
const spawn = (h, taskName = 'worker', callerId = h.rootId) =>
  h.team.spawn(callerId, { taskName, message: 'Investigate the assigned task' }, signal())
const child = (h, id) => h.team.listAgents(h.rootId).find(agent => agent.id === id)

test('spawn publishes before child completion and a slow creation does not stall other parent delegations', { timeout: 1000 }, async () => {
  const entered = deferred(), ready = deferred()
  const h = harness({}, { spawn: async call => { if (call.request.taskName === 'worker') { entered.resolve(); await ready.promise } } })
  try {
    const creation = spawn(h)
    await entered.promise
    const independent = await spawn(h, 'independent-task')
    assert.equal(independent.taskName, 'independent-task')
    ready.resolve()
    const created = await creation
    assert.notEqual(independent.id, created.id)
    assert.equal(created.id, h.record.spawned[0].id)
    assert.equal(created.parentId, h.rootId)
    assert.equal(created.taskName, 'worker')
    assert.notEqual(created.status, 'completed')
    assert.equal(h.record.delivered.length, 0, 'initial task belongs to the spawn adapter')
    h.team.observe(created.id, { status: 'completed', text: 'Actual child result' })
    assert.equal(child(h, created.id).text, 'Actual child result')
  } finally { ready.resolve(); await h.team.close() }
})

test('capacity reservations include children whose asynchronous creation is still pending', { timeout: 1000 }, async () => {
  const entered = deferred(), ready = deferred()
  const h = harness({ maxAgents: 1 }, { spawn: async () => { entered.resolve(); await ready.promise } })
  try {
    const creation = spawn(h, 'first')
    await entered.promise
    await assert.rejects(async () => spawn(h, 'second'))
    assert.equal(h.record.spawned.length, 1, 'excess work is rejected before native allocation')
    ready.resolve()
    const created = await creation
    assert.equal(child(h, created.id).taskName, 'first')
  } finally { ready.resolve(); await h.team.close() }
})

test('failed child creation releases its capacity reservation', async () => {
  let fail = true
  const h = harness({ maxAgents: 1 }, { spawn: async () => { if (fail) throw new Error('Offline creation failure') } })
  try {
    await assert.rejects(async () => spawn(h, 'first'), /Offline creation failure/)
    fail = false
    const created = await spawn(h, 'second')
    assert.equal(created.taskName, 'second')
  } finally { await h.team.close() }
})

test('a wait on a starting child rejects cleanly when native child creation fails', { timeout: 1000 }, async () => {
  const entered = deferred(), ready = deferred()
  const h = harness({}, { spawn: async () => { entered.resolve(); await ready.promise; throw new Error('Startup failed') } })
  try {
    const creation = spawn(h)
    const creationRejection = assert.rejects(creation, /Startup failed/)
    await entered.promise
    const startingId = h.record.spawned[0].id
    const waiting = h.team.waitAgents(h.rootId, [startingId], { timeoutMs: 500 }, signal())
    const waitRejection = assert.rejects(waiting)
    ready.resolve()
    await Promise.all([creationRejection, waitRejection])
    assert.equal(h.team.listAgents(h.rootId).some(agent => agent.id === startingId), false)
  } finally { ready.resolve(); await h.team.close() }
})

test('a terminal event emitted before the spawn adapter returns is retained', async () => {
  const h = harness({}, { spawn: (call, team) => team.observe(call.id, { status: 'completed', text: 'Fast final' }) })
  try {
    const created = await spawn(h)
    assert.equal(created.status, 'completed')
    const result = await h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 0 }, signal())
    assert.equal(result.timedOut, false)
    assert.equal(result.agents.find(agent => agent.id === created.id)?.text, 'Fast final')
  } finally { await h.team.close() }
})

test('task names are unique for a parent while separate parents can reuse a local task name', async () => {
  const h = harness()
  try {
    const first = await spawn(h, 'review')
    await assert.rejects(async () => spawn(h, 'review'))
    const grandchild = await spawn(h, 'review', first.id)
    assert.equal(grandchild.parentId, first.id)
    assert.notEqual(grandchild.id, first.id)
  } finally { await h.team.close() }
})

test('messages are bounded mailbox deliveries that leave an idle child asleep until explicit follow-up', async () => {
  const h = harness()
  try {
    const created = await spawn(h)
    h.team.observe(created.id, { status: 'completed', text: 'Initial final' })
    assert.deepEqual(await h.team.sendMessage(h.rootId, created.id, 'Check the new evidence', signal()), { queued: true, wakeup: false })
    assert.equal(h.record.delivered.length, 0)
    assert.equal(child(h, created.id).status, 'completed')
    const followed = await h.team.followupTask(h.rootId, created.id, 'Continue the investigation', signal())
    assert.equal(followed.id, created.id)
    assert.equal(followed.text, undefined, 'a prior final is not the answer to a new task')
    assert.equal(h.record.delivered.length, 1)
    const nativeMessage = h.record.delivered[0].message
    assert.match(nativeMessage, /Check the new evidence/)
    assert.match(nativeMessage, /Continue the investigation/)
    assert.equal(h.record.delivered[0].targetId, created.id)
    assert.equal(h.record.spawned.length, 1, 'continuation reuses the existing child')
  } finally { await h.team.close() }
})

test('mailbox capacity rejects overflow without silently losing accepted messages', async () => {
  const h = harness({ maxMailbox: 2 })
  try {
    const created = await spawn(h)
    await h.team.sendMessage(h.rootId, created.id, 'FIRST_ACCEPTED', signal())
    await h.team.sendMessage(h.rootId, created.id, 'SECOND_ACCEPTED', signal())
    await assert.rejects(async () => h.team.sendMessage(h.rootId, created.id, 'OVERFLOW_REJECTED', signal()))
    await h.team.followupTask(h.rootId, created.id, 'Continue', signal())
    const message = h.record.delivered.at(-1).message
    assert.match(message, /FIRST_ACCEPTED/)
    assert.match(message, /SECOND_ACCEPTED/)
    assert.doesNotMatch(message, /OVERFLOW_REJECTED/)
  } finally { await h.team.close() }
})

test('pre-step flush uses non-waking context delivery and preserves the exact sender', async () => {
  const h = harness({}, { deliverContext: async () => {} })
  try {
    const created = await spawn(h)
    await h.team.sendMessage(h.rootId, created.id, 'Parent observation', signal())
    await h.team.sendMessage(created.id, h.rootId, 'Child observation', signal())
    assert.equal(await h.team.flushMessages(created.id, signal()), 1)
    assert.equal(await h.team.flushMessages(h.rootId, signal()), 1)
    assert.equal(h.record.delivered.length, 0, 'mail never uses the native waking send')
    assert.deepEqual(h.record.contexts.map(({ callerId, targetId, message }) => ({ callerId, targetId, message })), [
      { callerId: h.rootId, targetId: created.id, message: 'Parent observation' },
      { callerId: created.id, targetId: h.rootId, message: 'Child observation' },
    ])
    assert.equal(await h.team.flushMessages(created.id, signal()), 0, 'accepted mail is not injected twice')
  } finally { await h.team.close() }
})

test('an adapter without non-waking delivery retains queued mail for explicit follow-up', async () => {
  const h = harness()
  try {
    const created = await spawn(h)
    await h.team.sendMessage(h.rootId, created.id, 'RETAINED_MAIL', signal())
    assert.equal(await h.team.flushMessages(created.id, signal()), 0)
    assert.equal(h.record.delivered.length, 0)
    await h.team.followupTask(h.rootId, created.id, 'Follow up', signal())
    assert.match(h.record.delivered.at(-1).message, /RETAINED_MAIL/)
  } finally { await h.team.close() }
})

test('a rejected context injection keeps accepted mail available for retry', async () => {
  let rejectDelivery = true
  const h = harness({}, { deliverContext: async () => { if (rejectDelivery) throw new Error('Offline context delivery rejected') } })
  try {
    const created = await spawn(h)
    await h.team.sendMessage(h.rootId, created.id, 'RETRY_CONTEXT', signal())
    await assert.rejects(async () => h.team.flushMessages(created.id, signal()), /Offline context delivery rejected/)
    rejectDelivery = false
    assert.equal(await h.team.flushMessages(created.id, signal()), 1)
    assert.equal(h.record.contexts.at(-1).message, 'RETRY_CONTEXT')
    assert.equal(await h.team.flushMessages(created.id, signal()), 0)
  } finally { await h.team.close() }
})

test('a failed follow-up retains mail and its previous final instead of claiming a new result', async () => {
  let rejectDelivery = true
  const h = harness({}, { deliver: async () => { if (rejectDelivery) throw new Error('Offline follow-up rejected') } })
  try {
    const created = await spawn(h)
    h.team.observe(created.id, { status: 'completed', text: 'Previous verified final' })
    await h.team.sendMessage(h.rootId, created.id, 'RETRY_FOLLOWUP_MAIL', signal())
    await assert.rejects(async () => h.team.followupTask(h.rootId, created.id, 'New task', signal()), /Offline follow-up rejected/)
    assert.equal(child(h, created.id).status, 'completed')
    assert.equal(child(h, created.id).text, 'Previous verified final')
    rejectDelivery = false
    const accepted = await h.team.followupTask(h.rootId, created.id, 'New task', signal())
    assert.equal(accepted.text, undefined)
    assert.match(h.record.delivered.at(-1).message, /RETRY_FOLLOWUP_MAIL/)
  } finally { await h.team.close() }
})

test('a rejected follow-up cannot overwrite new progress from the still-running original task', async () => {
  const h = harness({}, { deliver: async (call, team) => {
    team.observe(call.targetId, { status: 'running', text: 'New original-task progress' })
    throw new Error('Follow-up rejected before acceptance')
  } })
  try {
    const created = await spawn(h)
    h.team.observe(created.id, { status: 'running', text: 'Earlier original-task progress' })
    await assert.rejects(async () => h.team.followupTask(h.rootId, created.id, 'New task', signal()), /Follow-up rejected/)
    assert.equal(child(h, created.id).status, 'running')
    assert.equal(child(h, created.id).text, 'New original-task progress')
  } finally { await h.team.close() }
})

test('mail arriving during a follow-up delivery remains available for the next pre-step', { timeout: 1000 }, async () => {
  const entered = deferred(), delivered = deferred()
  const h = harness({}, { deliver: async () => { entered.resolve(); await delivered.promise }, deliverContext: async () => {} })
  let following
  try {
    const created = await spawn(h)
    h.team.observe(created.id, { status: 'completed', text: 'Old final' })
    following = h.team.followupTask(h.rootId, created.id, 'Start new task', signal())
    await entered.promise
    await h.team.sendMessage(h.rootId, created.id, 'ARRIVED_DURING_FOLLOWUP', signal())
    delivered.resolve()
    await following
    assert.equal(await h.team.flushMessages(created.id, signal()), 1)
    assert.equal(h.record.contexts.at(-1).message, 'ARRIVED_DURING_FOLLOWUP')
    assert.equal(await h.team.flushMessages(created.id, signal()), 0)
  } finally { delivered.resolve(); await Promise.allSettled([following, h.team.close()]) }
})

test('message and follow-up authority is restricted to adjacent team members', async () => {
  const h = harness()
  try {
    const first = await spawn(h, 'first'), sibling = await spawn(h, 'second')
    const grandchild = await spawn(h, 'nested', first.id)
    await h.team.sendMessage(first.id, h.rootId, 'Report to the parent', signal())
    await h.team.sendMessage(first.id, grandchild.id, 'Message to direct child', signal())
    await assert.rejects(async () => h.team.sendMessage(first.id, sibling.id, 'Unauthorized sibling message', signal()))
    await assert.rejects(async () => h.team.sendMessage(h.rootId, grandchild.id, 'Skip direct parent', signal()))
    await assert.rejects(async () => h.team.followupTask(first.id, h.rootId, 'Wake root', signal()))
    await assert.rejects(async () => h.team.followupTask(h.rootId, grandchild.id, 'Wake grandchild', signal()))
    assert.equal(h.record.delivered.length, 0, 'rejected follow-ups make no native request')
  } finally { await h.team.close() }
})

test('unknown and foreign identities cannot list, message, wait on, or interrupt this team', async () => {
  const left = harness({ runId: 'left-team', rootId: 'left-parent' })
  const right = harness({ runId: 'right-team', rootId: 'right-parent' })
  try {
    const own = await spawn(left), foreign = await spawn(right)
    assert.throws(() => left.team.listAgents(right.rootId))
    await assert.rejects(async () => left.team.sendMessage(left.rootId, foreign.id, 'Cross-team message', signal()))
    await assert.rejects(async () => left.team.followupTask(right.rootId, own.id, 'Foreign author', signal()))
    await assert.rejects(async () => left.team.waitAgents(left.rootId, [own.id, foreign.id], { timeoutMs: 0 }, signal()))
    await assert.rejects(async () => left.team.interruptAgent(left.rootId, foreign.id, signal()))
    assert.equal(left.record.delivered.length, 0)
    assert.equal(left.record.interrupted.length, 0)
  } finally { await Promise.all([left.team.close(), right.team.close()]) }
})

test('wait returns when the first watched child settles while other children continue', { timeout: 1000 }, async () => {
  const h = harness()
  try {
    const first = await spawn(h, 'first'), second = await spawn(h, 'second')
    const waiting = h.team.waitAgents(h.rootId, [first.id, second.id], { timeoutMs: 500 }, signal())
    h.team.observe(second.id, { status: 'completed', text: 'Second settled first' })
    const result = await waiting
    assert.equal(result.timedOut, false)
    assert.equal(result.agents.find(agent => agent.id === second.id)?.text, 'Second settled first')
    assert.notEqual(child(h, first.id).status, 'completed')
  } finally { await h.team.close() }
})

test('wait observes a failed child as actionable settlement instead of waiting for every child', { timeout: 1000 }, async () => {
  const h = harness()
  try {
    const first = await spawn(h, 'first'), second = await spawn(h, 'second')
    const waiting = h.team.waitAgents(h.rootId, [first.id, second.id], { timeoutMs: 500 }, signal())
    h.team.observe(first.id, { status: 'failed', error: 'Provider failed' })
    const result = await waiting
    assert.equal(result.timedOut, false)
    const failed = result.agents.find(agent => agent.id === first.id)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error, 'Provider failed')
  } finally { await h.team.close() }
})

test('cursor consumption suppresses duplicate final text but a later follow-up final is new', async () => {
  const h = harness()
  try {
    const created = await spawn(h)
    h.team.observe(created.id, { status: 'completed', text: 'First final' })
    const first = await h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 0 }, signal())
    const repeated = await h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 0, afterCursor: first.cursor }, signal())
    assert.equal(repeated.timedOut, true)
    assert.equal(repeated.agents.find(agent => agent.id === created.id)?.text, undefined)
    await h.team.followupTask(h.rootId, created.id, 'New task', signal())
    h.team.observe(created.id, { status: 'completed', text: 'Second final' })
    const second = await h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 0, afterCursor: first.cursor }, signal())
    assert.equal(second.timedOut, false)
    assert.equal(second.agents.find(agent => agent.id === created.id)?.text, 'Second final')
    assert.notEqual(second.cursor, first.cursor)
  } finally { await h.team.close() }
})

test('a cursor is bound to its team and rejects malformed or future revisions', async () => {
  const h = harness({ runId: 'cursor-team' })
  try {
    const created = await spawn(h)
    for (const afterCursor of ['another-team:1', 'not-a-cursor', 'cursor-team:-1', 'cursor-team:999999999']) {
      await assert.rejects(async () => h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 0, afterCursor }, signal()))
    }
  } finally { await h.team.close() }
})

test('wait timeout reports current progress without interpreting a partial answer as completed', { timeout: 1000 }, async () => {
  const h = harness()
  try {
    const created = await spawn(h)
    h.team.observe(created.id, { status: 'running', text: 'Partial evidence' })
    const result = await h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 5 }, signal())
    assert.equal(result.timedOut, true)
    const progress = result.agents.find(agent => agent.id === created.id)
    assert.equal(progress.status, 'running')
    assert.equal(progress.text, 'Partial evidence')
  } finally { await h.team.close() }
})

test('cancelling a wait does not cancel watched agents or lose their eventual result', { timeout: 1000 }, async () => {
  const h = harness()
  try {
    const created = await spawn(h), cancellation = new AbortController()
    const waiting = h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 500 }, cancellation.signal)
    cancellation.abort(new Error('Caller aborted wait'))
    await assert.rejects(waiting)
    assert.equal(h.record.interrupted.length, 0)
    assert.equal(h.record.closed.length, 0)
    h.team.observe(created.id, { status: 'completed', text: 'Completed despite wait cancellation' })
    const later = await h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 0 }, signal())
    assert.equal(later.timedOut, false)
    assert.equal(later.agents.find(agent => agent.id === created.id)?.text, 'Completed despite wait cancellation')
  } finally { await h.team.close() }
})

test('pre-cancelled operations allocate or deliver no native work', async () => {
  const h = harness(), cancelled = new AbortController()
  try {
    cancelled.abort(new Error('Already cancelled'))
    await assert.rejects(async () => h.team.spawn(h.rootId, { taskName: 'cancelled', message: 'Do not start' }, cancelled.signal))
    assert.equal(h.record.spawned.length, 0)
    const created = await spawn(h)
    await assert.rejects(async () => h.team.sendMessage(h.rootId, created.id, 'Do not enqueue', cancelled.signal))
    await assert.rejects(async () => h.team.followupTask(h.rootId, created.id, 'Do not wake', cancelled.signal))
    await assert.rejects(async () => h.team.interruptAgent(h.rootId, created.id, cancelled.signal))
    assert.equal(h.record.delivered.length, 0)
    assert.equal(h.record.interrupted.length, 0)
  } finally { await h.team.close() }
})

test('caller cancellation during spawn drains a child accepted after cancellation', { timeout: 1000 }, async () => {
  const entered = deferred(), ready = deferred(), cancellation = new AbortController()
  const h = harness({}, { spawn: async () => { entered.resolve(); await ready.promise } })
  try {
    const creation = h.team.spawn(h.rootId, { taskName: 'cancel-during-create', message: 'Pending task' }, cancellation.signal)
    const rejection = assert.rejects(creation)
    await entered.promise
    cancellation.abort(new Error('Parent cancelled during startup'))
    ready.resolve()
    await rejection
    const allocatedId = h.record.spawned[0].id
    assert.equal(h.record.closed.flat().some(entry => entry.id === allocatedId), true)
    assert.equal(h.team.listAgents(h.rootId).some(entry => entry.id === allocatedId), false)
  } finally { ready.resolve(); await h.team.close() }
})

test('interrupt preserves child identity for later continuation and permits ancestor authority', async () => {
  const h = harness()
  try {
    const created = await spawn(h), nested = await spawn(h, 'nested', created.id)
    const interrupted = await h.team.interruptAgent(h.rootId, nested.id, signal())
    assert.equal(interrupted.id, nested.id)
    assert.equal(h.record.interrupted.length, 1)
    assert.equal(h.record.interrupted[0].targetId, nested.id)
    assert.equal(h.record.closed.length, 0, 'interrupt is not disposal')
    h.team.observe(nested.id, { status: 'cancelled' })
    const resumed = await h.team.followupTask(created.id, nested.id, 'Resume after interruption', signal())
    assert.equal(resumed.id, nested.id)
    assert.equal(h.record.spawned.length, 2)
    assert.equal(h.record.delivered.at(-1).targetId, nested.id)
  } finally { await h.team.close() }
})

test('interrupt cannot target a sibling, an ancestor, or the visible root', async () => {
  const h = harness()
  try {
    const first = await spawn(h, 'first'), sibling = await spawn(h, 'second')
    await assert.rejects(async () => h.team.interruptAgent(first.id, sibling.id, signal()))
    await assert.rejects(async () => h.team.interruptAgent(first.id, h.rootId, signal()))
    await assert.rejects(async () => h.team.interruptAgent(h.rootId, h.rootId, signal()))
    assert.equal(h.record.interrupted.length, 0)
  } finally { await h.team.close() }
})

test('snapshots are copies and outside lifecycle events cannot create team membership', async () => {
  const h = harness()
  try {
    const created = await spawn(h)
    h.team.observe('foreign-child', { status: 'completed', text: 'Foreign final' })
    const before = h.team.listAgents(h.rootId)
    const owned = before.find(agent => agent.id === created.id)
    owned.status = 'completed'
    owned.text = 'Mutated by consumer'
    assert.notEqual(child(h, created.id).status, 'completed')
    assert.equal(child(h, created.id).text, undefined)
    assert.equal(h.team.listAgents(h.rootId).some(agent => agent.id === 'foreign-child'), false)
  } finally { await h.team.close() }
})

test('closing is idempotent, waits for native drain, releases waits and rejects new operations', { timeout: 1000 }, async () => {
  const drainEntered = deferred(), drained = deferred()
  const h = harness({}, { close: async () => { drainEntered.resolve(); await drained.promise } })
  try {
    const created = await spawn(h)
    const waiting = h.team.waitAgents(h.rootId, [created.id], { timeoutMs: 500 }, signal())
    const waitRejection = assert.rejects(waiting)
    let closed = false
    const firstClose = h.team.close().then(() => { closed = true })
    const secondClose = h.team.close()
    await drainEntered.promise
    assert.equal(closed, false, 'close must not finish before owned native work drains')
    await assert.rejects(async () => spawn(h, 'after-close'))
    await assert.rejects(async () => h.team.sendMessage(h.rootId, created.id, 'After close', signal()))
    await assert.rejects(async () => h.team.followupTask(h.rootId, created.id, 'After close', signal()))
    await assert.rejects(async () => h.team.interruptAgent(h.rootId, created.id, signal()))
    drained.resolve()
    await Promise.all([firstClose, secondClose, waitRejection])
    assert.equal(h.record.closed.length, 1)
    assert.equal(h.record.closed[0].some(entry => entry.id === created.id && entry.parentId === h.rootId), true)
  } finally { drained.resolve(); await h.team.close() }
})

test('closing during asynchronous spawn drains the child that materializes after admission closes', { timeout: 1000 }, async () => {
  const entered = deferred(), ready = deferred()
  const h = harness({}, { spawn: async () => { entered.resolve(); await ready.promise } })
  try {
    const creation = spawn(h)
    const creationRejection = assert.rejects(creation)
    await entered.promise
    let closed = false
    const closing = h.team.close().then(() => { closed = true })
    await Promise.resolve()
    assert.equal(closed, false)
    ready.resolve()
    await Promise.all([closing, creationRejection])
    const allocatedId = h.record.spawned[0].id
    assert.equal(h.record.closed.flat().some(entry => entry.id === allocatedId), true)
  } finally { ready.resolve(); await h.team.close() }
})

test('close drains an in-flight non-waking context delivery before releasing native children', { timeout: 1000 }, async () => {
  const entered = deferred(), delivered = deferred()
  const h = harness({}, { deliverContext: async () => { entered.resolve(); await delivered.promise } })
  let flushing
  try {
    const created = await spawn(h)
    await h.team.sendMessage(h.rootId, created.id, 'In-flight context', signal())
    flushing = h.team.flushMessages(created.id, signal())
    await entered.promise
    let closed = false
    const closing = h.team.close().then(() => { closed = true })
    await new Promise(done => setImmediate(done))
    assert.equal(closed, false, 'native child release cannot overtake accepted context delivery')
    assert.equal(h.record.closed.length, 0)
    delivered.resolve()
    await Promise.allSettled([flushing, closing])
    assert.equal(h.record.closed.length, 1)
  } finally { delivered.resolve(); await Promise.allSettled([flushing, h.team.close()]) }
})
