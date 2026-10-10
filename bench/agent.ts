// The agent loop: one conversation with Claude. Tool calls run one after another, and every request and tool call is
// recorded as it happens. The history is append-only (thinking blocks are bound to it), and the system prompt never
// changes in a run.
import Anthropic from '@anthropic-ai/sdk'
import { setTimeout as sleep } from 'node:timers/promises'
import { MODELS, costUsd, tokensAtMost, worstCaseUsd, type ModelKey, type Usage } from './models.ts'
import type { ToolOutcome } from './browser.ts'

export const LIMITS = { turns: 60, ms: 10 * 60_000 }
/** Retries per request after a rate-limit, server or connection error. Each try goes through the spending cap. */
export const RETRIES = 3

/** The request settings, identical in both modes. One cache breakpoint: the top-level automatic one. */
export const settings = (model: ModelKey) => ({
  model: MODELS[model],
  max_tokens: 16_000,
  thinking: { type: 'adaptive', display: 'summarized' },
  output_config: { effort: 'medium' },
  cache_control: { type: 'ephemeral' },
}) satisfies Omit<Anthropic.MessageCreateParamsNonStreaming, 'messages'>

/** Sends one request. The signal aborts it at the run's deadline. */
export type Send = (params: Anthropic.MessageCreateParamsNonStreaming, options: { signal: AbortSignal }) => Promise<Anthropic.Message>
/** Runs one tool call. The signal aborts the browser call at the run's deadline. */
export type Exec = (name: string, input: unknown, signal: AbortSignal) => Promise<ToolOutcome>
export type FailReason = 'turn_limit' | 'time_limit' | 'context' | 'refusal' | 'max_tokens'
export type Ending =
  | { kind: 'done' } | { kind: 'fail'; reason: FailReason } | { kind: 'stopped'; reason: 'budget' }
  | { kind: 'transient'; error: string } | { kind: 'defect'; error: string }
/** What a set has spent, reservations for requests in flight included, and its cap. Shared by the set's attempts. */
export interface Budget { maxUsd: number; spentUsd: number }
/**
 * One request. Until it is answered, the budget holds its worst-case cost (reservedUsd, charged 'reserved'). A response
 * sets costUsd from the API's usage and releases the reservation ('billed'). An error status from the API is not
 * billed ('none'). A request without any answer (a lost connection, the deadline) may still have been billed, so the
 * budget keeps its reservation; it is reported as unresolved, never as measured cost.
 */
export interface RequestLog {
  turn: number; ms: number; reservedUsd: number; costUsd: number; charged: 'reserved' | 'billed' | 'none'
  stopReason: string | null; model: string | null; usage: Usage | null; error?: string
}
export interface ToolLog { turn: number; name: string; input: unknown; isError: boolean; ms: number }
/** The record so far. onUpdate gets it whenever it changes, before each request is sent included. */
export interface Progress { messages: Anthropic.MessageParam[]; requests: RequestLog[]; tools: ToolLog[]; finalText: string; ms: number }
export interface AgentRun extends Progress { ending: Ending }
export interface AgentInput {
  model: ModelKey; system: string; tools: Anthropic.Tool[]; prompt: string
  send: Send; exec: Exec
  afterTurn?: (turn: number, signal: AbortSignal) => Promise<void>
  onUpdate?: (progress: Progress) => Promise<void>
  budget?: Budget; limits?: typeof LIMITS; retries?: number; now?: () => number
}
export interface Totals {
  turns: number; toolCalls: Record<string, number>; toolErrors: number
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number }
  /** Billed, from the API's usage. */
  costUsd: number
  /** Reservations of requests that never got an answer: counted against the cap, not measured. */
  unresolvedUsd: number
  ms: number
}

const describe = (e: unknown) => (e instanceof Error ? e.stack ?? e.message : String(e))

/** Transient errors are retried and then replaced; an over-long prompt fails the run; anything else is our defect. */
export function classify(e: unknown): 'transient' | 'context' | 'defect' {
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return 'transient'
  // The API has no error type for a prompt over the context window; only its message says so.
  if (e instanceof Anthropic.APIError && (e.status === 413 || (e.status === 400 && /prompt is too long/i.test(e.message)))) return 'context'
  return 'defect'
}

// The API's retry-after header when it sends one, otherwise 1, 2 and 4 seconds.
function retryDelay(e: unknown, retry: number): number {
  const header = e instanceof Anthropic.APIError ? e.headers?.get('retry-after') : null
  return header == null || !Number.isFinite(Number(header)) ? 1000 * 2 ** retry : Number(header) * 1000
}

export async function runAgent(a: AgentInput): Promise<AgentRun> {
  const limits = a.limits ?? LIMITS, retries = a.retries ?? RETRIES, now = a.now ?? Date.now, start = now()
  const budget = a.budget ?? { maxUsd: Infinity, spentUsd: 0 }
  // One absolute deadline for the run. It aborts whatever is in flight: a model request, a tool call, the screenshot.
  const deadline = AbortSignal.timeout(limits.ms)
  const late = () => deadline.aborted || now() - start >= limits.ms
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: a.prompt }]
  const requests: RequestLog[] = [], tools: ToolLog[] = []
  let finalText = ''
  const progress = (): Progress => ({ messages, requests, tools, finalText, ms: now() - start })
  const save = async () => { await a.onUpdate?.(progress()) }
  const end = async (ending: Ending): Promise<AgentRun> => { await save(); return { ending, ...progress() } }
  const timeLimit: Ending = { kind: 'fail', reason: 'time_limit' }

  /** One model request, retried after transient errors. Returns the response, or how the run ends without one. */
  async function request(turn: number): Promise<Anthropic.Message | Ending> {
    const params = { ...settings(a.model), system: a.system, tools: a.tools, messages }
    // The prompt is at most the last billed prompt plus that response plus the tool results since; the first request
    // has nothing billed before it, so its whole JSON counts.
    const prev = requests.findLast(r => r.usage)?.usage
    const prompt = prev
      ? prev.input_tokens + prev.cache_read_input_tokens + prev.cache_creation_input_tokens + prev.output_tokens + tokensAtMost(messages.at(-1))
      : tokensAtMost({ system: params.system, tools: params.tools, messages })
    const reserve = worstCaseUsd(a.model, prompt, params.max_tokens)
    for (let retry = 0; ; retry++) {
      if (!(budget.spentUsd + reserve <= budget.maxUsd)) return { kind: 'stopped', reason: 'budget' } // NaN stops too
      const log: RequestLog = { turn, ms: 0, reservedUsd: reserve, costUsd: 0, charged: 'reserved', stopReason: null, model: null, usage: null }
      requests.push(log)
      budget.spentUsd += reserve
      await save()
      const sent = now()
      try {
        const res = await a.send(params, { signal: deadline })
        const u = res.usage
        log.usage = { input_tokens: u.input_tokens, cache_read_input_tokens: u.cache_read_input_tokens ?? 0, cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0, output_tokens: u.output_tokens }
        log.costUsd = costUsd(a.model, log.usage)
        log.charged = 'billed'
        log.ms = now() - sent
        log.stopReason = res.stop_reason
        log.model = res.model
        budget.spentUsd += log.costUsd - reserve
        // The cap rests on the reservation being the most a request can cost; a bill above it means that bound is wrong.
        if (log.costUsd > reserve) return { kind: 'defect', error: `Request billed $${log.costUsd}, above its reservation of $${reserve}` }
        return res
      } catch (e) {
        log.ms = now() - sent
        log.error = describe(e)
        // The API answered with an error status: nothing was billed. Without an answer it may have been.
        if (e instanceof Anthropic.APIError && typeof e.status === 'number') {
          log.charged = 'none'
          budget.spentUsd -= reserve
        }
        if (late()) return timeLimit
        const kind = classify(e)
        if (kind === 'context') return { kind: 'fail', reason: 'context' }
        if (kind === 'defect') return { kind: 'defect', error: describe(e) }
        if (retry >= retries) return { kind: 'transient', error: describe(e) }
        await save()
        await sleep(retryDelay(e, retry), undefined, { signal: deadline }).catch(() => {})
        if (late()) return timeLimit
      }
    }
  }

  for (let turn = 1; turn <= limits.turns; turn++) {
    if (late()) return end(timeLimit)
    const res = await request(turn)
    if ('kind' in res) return end(res)
    messages.push({ role: 'assistant', content: res.content })
    finalText = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n')
    await save()
    if (late()) return end(timeLimit)
    if (res.stop_reason === 'refusal') return end({ kind: 'fail', reason: 'refusal' })
    if (res.stop_reason === 'max_tokens') return end({ kind: 'fail', reason: 'max_tokens' })
    if (res.stop_reason === 'model_context_window_exceeded') return end({ kind: 'fail', reason: 'context' })
    const calls = res.content.filter(b => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !calls.length) return end({ kind: 'done' })

    // The results message is in the record from the start and grows with each call, saved each time, so a later call
    // that fails or times out never loses an earlier result. It is only sent once every call has its result.
    const results: Anthropic.ToolResultBlockParam[] = []
    messages.push({ role: 'user', content: results })
    for (const c of calls) {
      if (late()) return end(timeLimit) // no tool starts after the deadline
      const started = now()
      let out: ToolOutcome
      try {
        out = await a.exec(c.name, c.input, deadline)
      } catch (e) {
        return end(late() ? timeLimit : { kind: 'defect', error: describe(e) })
      }
      tools.push({ turn, name: c.name, input: c.input, isError: out.isError, ms: now() - started })
      results.push({ type: 'tool_result', tool_use_id: c.id, content: out.content, is_error: out.isError })
      await save()
    }
    try {
      await a.afterTurn?.(turn, deadline)
    } catch (e) {
      return end(late() ? timeLimit : { kind: 'defect', error: describe(e) })
    }
  }
  return end({ kind: 'fail', reason: 'turn_limit' })
}

/** Turns are answered requests. Cost is billed cost only; unanswered requests' reservations are kept apart. */
export function totals(run: Progress): Totals {
  const billed = run.requests.flatMap(r => (r.usage ? [r.usage] : []))
  const sum = (k: keyof Usage) => billed.reduce((s, u) => s + u[k], 0)
  const toolCalls: Record<string, number> = {}
  for (const t of run.tools) toolCalls[t.name] = (toolCalls[t.name] ?? 0) + 1
  return {
    turns: billed.length, toolCalls, toolErrors: run.tools.filter(t => t.isError).length,
    tokens: { input: sum('input_tokens'), cacheRead: sum('cache_read_input_tokens'), cacheWrite: sum('cache_creation_input_tokens'), output: sum('output_tokens') },
    costUsd: run.requests.reduce((s, r) => s + r.costUsd, 0),
    unresolvedUsd: run.requests.reduce((s, r) => s + (r.charged === 'reserved' ? r.reservedUsd : 0), 0),
    ms: run.ms,
  }
}
