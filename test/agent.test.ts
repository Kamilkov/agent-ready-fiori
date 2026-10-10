import assert from 'node:assert/strict'
import { test } from 'node:test'
import Anthropic from '@anthropic-ai/sdk'
import { classify, runAgent, totals, type Exec, type Progress, type Send } from '../bench/agent.ts'
import { costUsd } from '../bench/models.ts'

const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: null, cache_creation_input_tokens: 50 }
const reply = (stop_reason: string, ...content: object[]) =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content, stop_reason, stop_sequence: null, usage }) as unknown as Anthropic.Message
const text = (t: string) => ({ type: 'text', text: t })
const call = (id: string, name: string, input: object = {}) => ({ type: 'tool_use', id, name, input })
const base = { model: 'haiku' as const, system: 'SYSTEM', tools: [], prompt: 'PROMPT' }
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`)

function script(...replies: (Anthropic.Message | Error)[]) {
  const params: Anthropic.MessageCreateParamsNonStreaming[] = []
  const send: Send = async p => {
    params.push(structuredClone(p))
    const r = replies.shift()
    if (!r) throw new Error('no reply left')
    if (r instanceof Error) throw r
    return r
  }
  return { send, params }
}
const exec = (log: string[] = [], isError = false): Exec => async name => {
  log.push(name)
  return { content: [{ type: 'text', text: `${name} result` }], isError }
}
const headers = new Headers()
const retryNow = new Headers({ 'retry-after': '0' })

test('a reply without tool calls ends the run; its text is the final answer; settings are as specified', async () => {
  const { send, params } = script(reply('end_turn', text('ANSWER: 3; ZX 406')))
  const run = await runAgent({ ...base, send, exec: exec() })
  assert.deepEqual(run.ending, { kind: 'done' })
  assert.equal(run.finalText, 'ANSWER: 3; ZX 406')
  assert.equal(params[0].model, 'claude-haiku-5-5')
  assert.equal(params[0].system, 'SYSTEM')
  assert.deepEqual(params[0].thinking, { type: 'adaptive', display: 'summarized' })
  assert.deepEqual(params[0].output_config, { effort: 'medium' })
  assert.deepEqual(params[0].cache_control, { type: 'ephemeral' })
  assert.deepEqual(run.requests[0].usage, { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 50, output_tokens: 10 })
})

test('tool calls run one after another in the given order; all results go back in one message', async () => {
  const log: string[] = [], turns: number[] = []
  const { send, params } = script(
    reply('tool_use', text('Looking.'), call('a', 'take_snapshot'), call('b', 'click', { uid: '1_2' })),
    reply('end_turn', text('Done.')),
  )
  const run = await runAgent({ ...base, send, exec: exec(log), afterTurn: async t => { turns.push(t) } })
  assert.deepEqual(log, ['take_snapshot', 'click'])
  assert.deepEqual(turns, [1])
  const results = params[1].messages[2].content as Anthropic.ToolResultBlockParam[]
  assert.deepEqual(results.map(r => [r.tool_use_id, r.is_error]), [['a', false], ['b', false]])
  assert.deepEqual(run.tools.map(t => [t.turn, t.name]), [[1, 'take_snapshot'], [1, 'click']])
  assert.equal(totals(run).turns, 2)
  assert.deepEqual(totals(run).toolCalls, { take_snapshot: 1, click: 1 })
})

test('a tool error goes back to the model as is_error, is counted, and the run goes on', async () => {
  const { send, params } = script(reply('tool_use', call('a', 'rebook_passengers')), reply('end_turn', text('ok')))
  const run = await runAgent({ ...base, send, exec: exec([], true) })
  assert.deepEqual(run.ending, { kind: 'done' })
  assert.equal((params[1].messages[2].content as Anthropic.ToolResultBlockParam[])[0].is_error, true)
  assert.equal(totals(run).toolErrors, 1)
})

test('limits: turns and time', async () => {
  const always = () => reply('tool_use', call('a', 'take_snapshot'))
  const turnsRun = await runAgent({ ...base, ...script(always(), always(), always()), exec: exec(), limits: { turns: 3, ms: 1e9 } })
  assert.deepEqual(turnsRun.ending, { kind: 'fail', reason: 'turn_limit' })
  assert.equal(turnsRun.requests.length, 3)

  let clock = 0
  const slow: Send = async () => { clock += 6 * 60_000; return always() }
  const timeRun = await runAgent({ ...base, send: slow, exec: exec(), now: () => clock })
  assert.deepEqual(timeRun.ending, { kind: 'fail', reason: 'time_limit' })
  assert.equal(timeRun.requests.length, 2)
})

test('the deadline aborts a model request that never answers; the request stays charged at its reservation', async () => {
  let aborted = false
  const hang: Send = (_p, { signal }) => new Promise((_ok, fail) =>
    signal.addEventListener('abort', () => { aborted = true; fail(new Anthropic.APIUserAbortError()) }))
  const budget = { maxUsd: 10, spentUsd: 0 }
  const started = Date.now()
  const run = await runAgent({ ...base, send: hang, exec: exec(), budget, limits: { turns: 60, ms: 50 } })
  assert.deepEqual(run.ending, { kind: 'fail', reason: 'time_limit' })
  assert.ok(aborted)
  assert.ok(Date.now() - started < 1_000)
  const [r] = run.requests
  assert.equal(r.charged, 'reserved')
  assert.ok(r.reservedUsd > 0)
  close(budget.spentUsd, r.reservedUsd)
  // The cap counts the reservation; the reported cost does not, it is shown apart as unresolved.
  assert.equal(totals(run).costUsd, 0)
  close(totals(run).unresolvedUsd, r.reservedUsd)
})

test('no tool starts after the deadline, and the tool in flight gets the deadline signal', async () => {
  let clock = 0
  const log: string[] = []
  const slowTool: Exec = async (name, _input, signal) => {
    assert.ok(signal instanceof AbortSignal)
    log.push(name)
    clock += 11 * 60_000
    return { content: 'ok', isError: false }
  }
  const run = await runAgent({ ...base, ...script(reply('tool_use', call('a', 'click'), call('b', 'click'))), exec: slowTool, now: () => clock })
  assert.deepEqual(run.ending, { kind: 'fail', reason: 'time_limit' })
  assert.deepEqual(log, ['click'])
})

test('spending cap: a request that could cross it is not sent; an answered request is charged its billed cost', async () => {
  const blocked = script(reply('end_turn', text('ok')))
  const tight = { maxUsd: 0.000_001, spentUsd: 0 }
  const stopped = await runAgent({ ...base, send: blocked.send, exec: exec(), budget: tight })
  assert.deepEqual(stopped.ending, { kind: 'stopped', reason: 'budget' })
  assert.equal(blocked.params.length, 0)
  assert.equal(tight.spentUsd, 0)

  const budget = { maxUsd: 10, spentUsd: 1 }
  const run = await runAgent({ ...base, ...script(reply('end_turn', text('ok'))), exec: exec(), budget })
  const [r] = run.requests
  assert.equal(r.charged, 'billed')
  assert.ok(r.reservedUsd > r.costUsd)
  close(budget.spentUsd, 1 + costUsd('haiku', r.usage!))
})

test('rate limits and server errors are retried, each try through the cap; an error status is not charged', async () => {
  const limited = () => new Anthropic.RateLimitError(429, undefined, 'rate limited', retryNow)
  const budget = { maxUsd: 10, spentUsd: 0 }
  const run = await runAgent({
    ...base, ...script(limited(), new Anthropic.InternalServerError(529, undefined, 'overloaded', retryNow), reply('end_turn', text('ok'))),
    exec: exec(), budget,
  })
  assert.deepEqual(run.ending, { kind: 'done' })
  assert.deepEqual(run.requests.map(r => r.charged), ['none', 'none', 'billed'])
  close(budget.spentUsd, run.requests[2].costUsd)
  close(totals(run).costUsd, run.requests[2].costUsd)
  assert.equal(totals(run).unresolvedUsd, 0)
  assert.equal(totals(run).turns, 1)

  const gaveUp = await runAgent({ ...base, ...script(limited(), limited(), limited(), limited()), exec: exec() })
  assert.equal(gaveUp.ending.kind, 'transient')
  assert.equal(gaveUp.requests.length, 4)
})

test('the cap fails closed: a spend that is not a number sends nothing', async () => {
  const { send, params } = script(reply('end_turn', text('ok')))
  const run = await runAgent({ ...base, send, exec: exec(), budget: { maxUsd: 10, spentUsd: NaN } })
  assert.deepEqual(run.ending, { kind: 'stopped', reason: 'budget' })
  assert.equal(params.length, 0)
})

test('a retry passes the cap too: an unanswered try keeps its reservation, so the next try can be refused', async () => {
  const lost = () => new Anthropic.APIConnectionError({ message: 'socket hang up' })
  const reserve = (await runAgent({ ...base, ...script(lost()), exec: exec(), retries: 0 })).requests[0].reservedUsd
  const budget = { maxUsd: reserve * 1.5, spentUsd: 0 }
  const { send, params } = script(lost(), reply('end_turn', text('ok')))
  const run = await runAgent({ ...base, send, exec: exec(), budget })
  assert.deepEqual(run.ending, { kind: 'stopped', reason: 'budget' })
  assert.equal(params.length, 1)
  close(budget.spentUsd, reserve)
})

test('a bill above its reservation is a defect: the cap rests on that bound, so the set stops', async () => {
  const over = { ...reply('end_turn', text('ok')), usage: { ...usage, output_tokens: 10_000_000 } } as Anthropic.Message
  const run = await runAgent({ ...base, ...script(over), exec: exec() })
  assert.equal(run.ending.kind, 'defect')
  assert.match(run.ending.kind === 'defect' ? run.ending.error : '', /billed \$[\d.]+, above its reservation of \$[\d.]+/)
  assert.equal(run.requests[0].charged, 'billed')
})

test('a request without an answer stays charged at its reservation', async () => {
  const budget = { maxUsd: 10, spentUsd: 0 }
  const lost = new Anthropic.APIConnectionError({ message: 'socket hang up' })
  const run = await runAgent({ ...base, ...script(lost), exec: exec(), budget, retries: 0 })
  assert.equal(run.ending.kind, 'transient')
  assert.equal(run.requests[0].charged, 'reserved')
  close(budget.spentUsd, run.requests[0].reservedUsd)
  assert.equal(totals(run).costUsd, 0)
  close(totals(run).unresolvedUsd, run.requests[0].reservedUsd)
})

test('the record is handed out as it grows: the reservation before each request is sent, then the response and results', async () => {
  const seen: string[] = []
  const { send } = script(reply('tool_use', call('a', 'take_snapshot')), reply('end_turn', text('ok')))
  let atFirstSend = ''
  const watched: Send = async (p, o) => { atFirstSend ||= seen.at(-1)!; return send(p, o) }
  await runAgent({ ...base, send: watched, exec: exec(), onUpdate: async p => { seen.push(`${p.requests.map(r => r.charged).join()} ${p.messages.length}`) } })
  assert.equal(atFirstSend, 'reserved 1')
  assert.ok(seen.includes('billed 3'))
  assert.equal(seen.at(-1), 'billed,billed 4')
})

test('each tool result is saved as it returns: a later call that fails keeps the earlier result', async () => {
  let saved: Progress | undefined
  const flaky: Exec = async name => {
    if (name === 'click') throw new Error('Chrome crashed')
    return { content: 'snapshot text', isError: false }
  }
  const run = await runAgent({
    ...base, ...script(reply('tool_use', call('a', 'take_snapshot'), call('b', 'click'))), exec: flaky,
    onUpdate: async p => { saved = structuredClone(p) },
  })
  assert.equal(run.ending.kind, 'defect')
  assert.deepEqual(saved?.messages[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'snapshot text', is_error: false }] })
})

test('refusal, output cut off and an over-long prompt fail the run', async () => {
  for (const [stop, reason] of [['refusal', 'refusal'], ['max_tokens', 'max_tokens'], ['model_context_window_exceeded', 'context']] as const) {
    const run = await runAgent({ ...base, ...script(reply(stop, text('…'))), exec: exec() })
    assert.deepEqual(run.ending, { kind: 'fail', reason })
  }
  const tooLong = new Anthropic.BadRequestError(400, undefined, 'prompt is too long: 1000500 tokens > 1000000 maximum', headers)
  assert.deepEqual((await runAgent({ ...base, ...script(tooLong), exec: exec() })).ending, { kind: 'fail', reason: 'context' })
})

test('classify: rate limits, overload, server and network errors are transient; anything else is a defect', () => {
  assert.equal(classify(new Anthropic.RateLimitError(429, undefined, 'rate limited', headers)), 'transient')
  assert.equal(classify(new Anthropic.InternalServerError(529, undefined, 'overloaded', headers)), 'transient')
  assert.equal(classify(new Anthropic.APIConnectionError({ message: 'socket hang up' })), 'transient')
  assert.equal(classify(new Anthropic.BadRequestError(400, undefined, 'tools.0.name: invalid', headers)), 'defect')
  assert.equal(classify(new TypeError('x is undefined')), 'defect')
})

test('a defect ends the run with the error, keeping what was recorded', async () => {
  const broken: Exec = async () => { throw new Error('Chrome crashed') }
  const defect = await runAgent({ ...base, ...script(reply('tool_use', call('a', 'click'))), exec: broken })
  assert.equal(defect.ending.kind, 'defect')
  assert.equal(defect.requests.length, 1)
  // The reply is kept, and so is the (empty) results message: no call returned before the failure.
  assert.deepEqual(defect.messages[2], { role: 'user', content: [] })
})
