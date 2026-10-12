// Runs a set of attempts in the scheduled order, one at a time, and writes every attempt's trace as it grows.
// node bench/run.ts --set pilot --runs 1 --max-usd 14.50 [--key-file <dotenv file>]
// --max-usd is required: a hard cap on the set's spend, checked before every request.
// --task/--mode/--model (repeatable) narrow the slots when the set's schedule is first created; later runs resume it.
import Anthropic from '@anthropic-ai/sdk'
import { VERSION } from '@anthropic-ai/sdk/version'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { parseArgs, parseEnv } from 'node:util'
import { openSession, type Mode, type Session } from './browser.ts'
import { LIMITS, runAgent, settings, totals, type AgentRun, type Budget, type Progress, type Send } from './agent.ts'
import type { ModelKey } from './models.ts'
import { addReplacement, makeSchedule, nextSlot, reconcile, spent, type AttemptRecord, type Recovered, type Schedule, type Slot, type Status } from './schedule.ts'
import { ROOT, serve } from './serve.ts'
import { tasks, type TaskId } from './tasks.ts'

const SEED = 20261009
const describe = (e: unknown) => (e instanceof Error ? e.stack ?? e.message : String(e))

export const systemPrompt = (attemptId: string) => `Run ID: ${attemptId}

You are a browser agent working for a dispatcher at ZX Airlines. The airline's Disruption desk app is open in the browser. Use the tools you have to do the dispatcher's task in the app. When you are done, reply with a short summary of what you did.`

// A file is replaced whole or not at all, so a crash never leaves half a trace or schedule.
async function writeJson(file: string, value: unknown) {
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2))
  await rename(`${file}.tmp`, file)
}

/** One process per set: a second would spend against the same cap and overwrite the schedule. The lock of a process
 *  that has ended (a crash, Ctrl-C) is taken over. Returns the release. */
export async function lockSet(dir: string): Promise<() => Promise<void>> {
  const file = join(dir, 'lock')
  await mkdir(dir, { recursive: true })
  for (;;) {
    try {
      await writeFile(file, String(process.pid), { flag: 'wx' })
      return () => unlink(file).catch(() => {})
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const pid = Number(await readFile(file, 'utf8').catch(() => ''))
      if (pid && running(pid)) throw new Error(`Set ${dir} is in use by process ${pid}`)
      await unlink(file).catch(() => {})
    }
  }
}
const running = (pid: number) => {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

/** The API client: the key goes to api.anthropic.com alone. The SDK would otherwise take a base URL, a second
 *  credential (ANTHROPIC_AUTH_TOKEN) and extra headers from the environment. It does not retry: agent.ts does, so
 *  every try passes the spending cap. */
export function apiClient(apiKey: string): Anthropic {
  if (process.env.ANTHROPIC_CUSTOM_HEADERS) throw new Error('ANTHROPIC_CUSTOM_HEADERS is set: unset it, so requests carry only the key')
  return new Anthropic({ apiKey, authToken: null, baseURL: 'https://api.anthropic.com', maxRetries: 0 })
}

// The app's revision, read for each attempt: a commit or an edit during a set shows in its traces.
function appRevision(): string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT }).toString().trim()
  return git('rev-parse', 'HEAD') + (git('status', '--porcelain', '--', 'app') ? '+dirty' : '')
}

// What decides an outcome besides the model: the app, the harness that runs attempts and the locked dependencies.
const NOT_IN_A_RUN = ['probe.ts', 'smoke.ts', 'summarize.ts', 'deploy.ts']
async function codeFingerprint(): Promise<string> {
  const app = (await readdir(join(ROOT, 'app'), { recursive: true, withFileTypes: true }))
    .filter(e => e.isFile() && e.name !== '.DS_Store').map(e => relative(ROOT, join(e.parentPath, e.name)))
  const bench = (await readdir(join(ROOT, 'bench'))).filter(f => f.endsWith('.ts') && !NOT_IN_A_RUN.includes(f)).map(f => join('bench', f))
  const hash = createHash('sha256')
  for (const f of [...app, ...bench, 'package-lock.json'].sort()) hash.update(`${f}\0`).update(await readFile(join(ROOT, f))).update('\0')
  return hash.digest('hex')
}

// A set's configuration, frozen by the first attempt that needs each part. A later attempt that differs stops before
// its first request, so a set never mixes configurations. set.json holds what every attempt shares: the prompt (without
// the run ID), limits, the code fingerprint and the Chrome, chrome-devtools-mcp, Node and SDK versions.
// <mode>-<model>.json holds what differs: request settings, tools and launch arguments.
// A mode is the tools it offers. WebMCP mode without exactly the app's page tools (WebMCP gone after a Chrome
// update, a registration that failed) would measure something else under its name; so would UI mode with any.
// Part 1's 4 tools plus the connection tools the scenario 2 build registered, sorted.
const CONNECTION_TOOLS = ['find_connections', 'rebook_onto_connection']
export const PAGE_TOOLS = [...['get_flight', 'list_alternatives', 'rebook_passengers', 'search_flights'], ...CONNECTION_TOOLS].sort()
/** A task's turn and time limits: its own (T4, T5) or the default. */
export const limitsFor = (task: TaskId) => tasks[task].limits ?? LIMITS

export async function checkConfig(dir: string, mode: Mode, model: ModelKey, session: Session, code: string) {
  const pageTools = session.pageTools.map(t => t.name).sort(), want = mode === 'webmcp' ? PAGE_TOOLS : []
  if (pageTools.join() !== want.join()) throw new Error(`${mode} mode has page tools [${pageTools.join(', ')}], not [${want.join(', ')}]`)
  await freeze(join(dir, 'config', 'set.json'), {
    systemPrompt: systemPrompt('<attempt ID>'), limits: Object.fromEntries((Object.keys(tasks) as TaskId[]).map(t => [t, limitsFor(t)])), code, versions: session.versions, node: process.version, anthropicSdk: VERSION,
  })
  await freeze(join(dir, 'config', `${mode}-${model}.json`), { request: settings(model), tools: session.tools, launchArgs: session.launchArgs })
}

async function freeze(file: string, config: Record<string, unknown>) {
  const old = (await readFile(file, 'utf8').then(JSON.parse, () => null)) as Record<string, unknown> | null
  if (old === null) {
    await mkdir(dirname(file), { recursive: true })
    await writeJson(file, config)
    return
  }
  const changed = Object.keys(config).filter(k => JSON.stringify(old[k]) !== JSON.stringify(config[k]))
  if (changed.length) throw new Error(`${file} differs from this attempt in: ${changed.join(', ')}. Restore them or start a new set.`)
}

// The attempt's status from how the run ended. A finished run ('done') is graded afterwards.
function ending(run: AgentRun): { status: Status; reason: string | null } {
  const e = run.ending
  if (e.kind === 'done') return { status: 'harness_error', reason: 'not graded' }
  if (e.kind === 'fail') return { status: 'fail', reason: e.reason }
  if (e.kind === 'stopped') return { status: 'interrupted', reason: 'stopped at the spending cap' }
  if (e.kind === 'transient') return { status: 'transient', reason: e.error }
  return { status: 'harness_error', reason: e.error }
}

// The conversation as sent, with each image the model saw written to img/ (once) and replaced by its file name.
async function saveImages(messages: Anthropic.MessageParam[], out: string, written: Set<string>): Promise<unknown[]> {
  let n = 0
  const copy = structuredClone(messages) as { role: string; content: unknown }[]
  for (const [i, m] of copy.entries()) {
    if (!Array.isArray(m.content)) continue
    for (const block of m.content as { type: string; content?: unknown }[]) {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue
      block.content = await Promise.all((block.content as { type: string; source?: { media_type: string; data: string } }[]).map(async c => {
        if (c.type !== 'image' || !c.source) return c
        const file = `img/t${String(i / 2).padStart(2, '0')}-${++n}.${c.source.media_type === 'image/png' ? 'png' : 'jpg'}`
        if (!written.has(file)) {
          await writeFile(join(out, file), Buffer.from(c.source.data, 'base64'))
          written.add(file)
        }
        return { type: 'image', file }
      }))
    }
  }
  return copy
}

const CUT = { status: 'interrupted', reason: 'the process ended during the attempt' } as const

/** How far an attempt the schedule still marks running got, from its trace (see reconcile in schedule.ts). A verdict
 *  the trace holds stands; an unfinished trace is marked interrupted. */
export async function recover(dir: string, a: AttemptRecord): Promise<Recovered> {
  const file = join(dir, 'attempts', a.dir, 'trace.json')
  const t = (await readFile(file, 'utf8').then(JSON.parse, () => null)) as
    { outcome?: { status: Status; reason: string | null }; totals?: { costUsd: number; unresolvedUsd: number } } | null
  const money = { costUsd: t?.totals?.costUsd ?? 0, unresolvedUsd: t?.totals?.unresolvedUsd ?? 0 }
  if (t?.outcome && t.outcome.status !== 'running') return { status: t.outcome.status, reason: t.outcome.reason, ...money }
  if (t) await writeJson(file, { ...t, outcome: CUT })
  return { ...CUT, ...money }
}

interface Context { dir: string; appUrl: string; send: Send; budget: Budget; base: Record<string, string> }

/** One attempt. `started` puts its record into the schedule (status running) before anything is spent. */
async function attempt(ctx: Context, slot: Slot, started: (rec: AttemptRecord) => Promise<void>): Promise<AttemptRecord> {
  const id = randomUUID() // new for every attempt, replacements included; the system prompt keeps it for the whole run
  const name = `${String(slot.pos).padStart(3, '0')}-${slot.task}-${slot.mode}-${slot.model}-${id.slice(0, 8)}`
  const out = join(ctx.dir, 'attempts', name)
  await mkdir(join(out, 'img'), { recursive: true })
  await mkdir(join(out, 'shots'), { recursive: true })
  const rec: AttemptRecord = { id, pos: slot.pos, dir: name, task: slot.task, mode: slot.mode, model: slot.model, status: 'running', reason: null, replaces: slot.replaces, costUsd: 0, unresolvedUsd: 0 }
  const trace: Record<string, unknown> = {
    attemptId: id, position: slot.pos, task: slot.task, mode: slot.mode, model: slot.model,
    replaces: slot.replaces ?? null, startedAt: new Date().toISOString(), versions: { ...ctx.base, app: appRevision() }, outcome: { status: 'running', reason: null },
  }
  const saveTrace = () => writeJson(join(out, 'trace.json'), trace)
  const written = new Set<string>()
  let progress: Progress | undefined
  // The record so far. runAgent hands it over before every request, after every response and after every tool call;
  // it is saved each time, so a crash keeps the conversation and every charge, reservations in flight included.
  const keep = async (p: Progress) => {
    progress = p
    Object.assign(trace, {
      finalText: p.finalText, conversation: await saveImages(p.messages, out, written), requests: p.requests, toolCalls: p.tools,
      totals: totals(p), cacheReadOnFirstRequest: p.requests.find(r => r.usage)?.usage?.cache_read_input_tokens ?? 0,
    })
    await saveTrace()
  }
  await saveTrace()
  await started(rec)
  let session: Session | undefined
  try {
    const s = session = await openSession(ctx.appUrl, slot.mode)
    trace.versions = { ...(trace.versions as object), ...s.versions }
    // Hashed for each attempt: the server reads app/ from disk on every request, so an edit mid-set is caught here.
    await checkConfig(ctx.dir, slot.mode, slot.model, s, await codeFingerprint())
    const run = await runAgent({
      model: slot.model, system: systemPrompt(id), tools: s.tools, prompt: tasks[slot.task].prompt, limits: limitsFor(slot.task),
      send: ctx.send, budget: ctx.budget, onUpdate: keep,
      exec: (tool, input, signal) => s.run(tool, input, signal),
      afterTurn: async (turn, signal) => writeFile(join(out, 'shots', `t${String(turn).padStart(2, '0')}.jpg`), await s.screenshot(signal)),
    })
    Object.assign(rec, ending(run))
    // The conversation and its cost are already saved; reading the final state can fail without losing them.
    if (run.ending.kind !== 'defect') {
      try {
        const appData = await s.appData()
        const grade = tasks[slot.task].grade(run.finalText, appData)
        Object.assign(trace, { appData, grade })
        if (run.ending.kind === 'done') Object.assign(rec, grade.pass ? { status: 'pass', reason: null } : { status: 'fail', reason: 'wrong_result' })
      } catch (e) {
        trace.finalStateError = describe(e)
        if (run.ending.kind === 'done') Object.assign(rec, { status: 'harness_error', reason: `reading the final state failed: ${describe(e)}` })
      }
    }
  } catch (e) {
    Object.assign(rec, { status: 'harness_error', reason: describe(e) })
  } finally {
    await session?.close().catch(() => {})
  }
  const t = progress ? totals(progress) : null
  rec.costUsd = t?.costUsd ?? 0
  rec.unresolvedUsd = t?.unresolvedUsd ?? 0
  if (t) trace.totals = t
  trace.outcome = { status: rec.status, reason: rec.reason }
  await saveTrace()
  if (Number(trace.cacheReadOnFirstRequest) > 0) console.warn(`  warning: the first request read ${trace.cacheReadOnFirstRequest} tokens from the cache`)
  return rec
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      set: { type: 'string' }, runs: { type: 'string', default: '5' }, 'max-usd': { type: 'string' },
      'key-file': { type: 'string', default: '.env' },
      task: { type: 'string', multiple: true }, mode: { type: 'string', multiple: true }, model: { type: 'string', multiple: true },
    },
  })
  if (!values.set) throw new Error('--set is required')
  const maxUsd = Number(values['max-usd'])
  if (!values['max-usd'] || !Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd is required: a dollar amount above 0')
  // Only this key is read from the file, without interpolation; nothing from it enters the environment.
  const apiKey = parseEnv(await readFile(values['key-file'], 'utf8')).ANTHROPIC_API_KEY
  if (!apiKey) throw new Error(`ANTHROPIC_API_KEY is missing from ${values['key-file']}`)

  const dir = join(ROOT, 'runs', values.set)
  const release = await lockSet(dir)
  const file = join(dir, 'schedule.json')
  const schedule: Schedule = await readFile(file, 'utf8').then(JSON.parse, () => makeSchedule({
    seed: SEED, runs: Number(values.runs),
    tasks: (values.task ?? ['t1', 't2', 't3']) as TaskId[], modes: (values.mode ?? ['ui', 'webmcp']) as Mode[], models: (values.model ?? ['opus', 'haiku']) as ModelKey[],
  }))
  await mkdir(dir, { recursive: true })
  const save = () => writeJson(file, schedule)
  // An attempt still marked running after a crash or Ctrl-C: its trace decides (see recover).
  let code = 0
  for (const a of await reconcile(schedule, a => recover(dir, a))) {
    console.warn(`Recovered ${a.dir}: ${a.status}, ${a.costUsd.toFixed(3)} billed, ${a.unresolvedUsd.toFixed(3)} unresolved`)
    // A transient attempt that ended just before the crash still needs its replacement.
    if (a.status === 'transient' && !schedule.slots.some(s => s.replaces === a.id) && !addReplacement(schedule, a)) {
      console.error(`Stopped: a third transient error in ${a.task} ${a.mode} ${a.model}`)
      code = 2
    }
  }
  await save()

  const budget: Budget = { maxUsd, spentUsd: spent(schedule) }
  const client = apiClient(apiKey)
  const send: Send = (p, o) => client.messages.create(p, o)

  const { server, url } = await serve()
  const ctx: Context = { dir, appUrl: `${url}/app/index.html`, send, budget, base: { node: process.version, anthropicSdk: VERSION } }
  try {
    for (let slot = code ? undefined : nextSlot(schedule); slot; slot = nextSlot(schedule)) {
      console.log(`#${slot.pos} ${slot.task} ${slot.mode} ${slot.model}${slot.replaces ? ' (replacement)' : ''}`)
      const rec = await attempt(ctx, slot, async r => { schedule.attempts.push(r); await save() })
      const stop = rec.status === 'transient' && !addReplacement(schedule, rec)
      await save()
      console.log(`  ${rec.status}${rec.reason ? ` (${rec.reason.split('\n')[0]})` : ''} · ${rec.costUsd.toFixed(3)}${rec.unresolvedUsd ? ` + ${rec.unresolvedUsd.toFixed(3)} unresolved` : ''} · ${rec.dir}`)
      if (stop) { console.error(`Stopped: a third transient error in ${rec.task} ${rec.mode} ${rec.model}`); code = 2; break }
      if (rec.status === 'harness_error') { console.error('Stopped: harness error. Decide what to rerun; see the trace.'); code = 3; break }
      if (rec.status === 'interrupted') { console.error(`Stopped at the spending cap: $${budget.spentUsd.toFixed(2)} of $${maxUsd} spent`); code = 4; break }
    }
  } finally {
    server.close()
    await release()
  }
  const unresolved = schedule.attempts.reduce((s, a) => s + a.unresolvedUsd, 0)
  console.log(`Counted against the cap: ${spent(schedule).toFixed(2)} of ${maxUsd} (${unresolved.toFixed(2)} of it unresolved reservations), ${schedule.attempts.length} attempts`)
  process.exitCode = code
}
