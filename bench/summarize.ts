// Turns a set's attempts into runs/<set>/summary.json for the results page, or prints the table (the pilot report).
// node bench/summarize.ts --set batch --repo <owner>/<repo>   links point at HEAD on GitHub; the traces must be committed
// node bench/summarize.ts --set dev --local                   no links (local preview)
// node bench/summarize.ts --set pilot --print                 table only
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { Totals } from './agent.ts'
import type { AttemptRecord, Schedule, Slot } from './schedule.ts'
import { ROOT } from './serve.ts'

export interface Attempt extends AttemptRecord {
  totals: Totals | null; startedAt: string; versions: Record<string, string>; models: string[]; cacheReadOnFirstRequest: number
  /** A request billed more than its reservation: the spending cap's bound is wrong and must be fixed before more runs. */
  overReserved: boolean
}
export interface Stat { median: number; min: number; max: number }

const METRICS = {
  turns: (t: Totals) => t.turns, input: (t: Totals) => t.tokens.input, cacheRead: (t: Totals) => t.tokens.cacheRead,
  cacheWrite: (t: Totals) => t.tokens.cacheWrite, output: (t: Totals) => t.tokens.output, costUsd: (t: Totals) => t.costUsd,
  seconds: (t: Totals) => t.ms / 1000,
}
const ORDER: Record<string, number> = { t1: 0, t2: 1, t3: 2, opus: 0, haiku: 1, ui: 0, webmcp: 1 }

export function stat(values: number[]): Stat {
  const v = [...values].sort((a, b) => a - b), mid = Math.floor(v.length / 2)
  return { median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, min: v[0], max: v[v.length - 1] }
}

/** The run to replay: first the median turn count (the lower one for an even count, so it is always an actual run's),
 *  then the earliest run in the schedule with that count. */
export function pickReplay<T extends { pos: number; totals: Totals | null }>(runs: T[]): T | undefined {
  const turns = (r: T) => r.totals?.turns ?? 0
  const sorted = runs.map(turns).sort((a, b) => a - b)
  const median = sorted[Math.floor((sorted.length - 1) / 2)]
  return runs.filter(r => turns(r) === median).sort((a, b) => a.pos - b.pos)[0]
}

export function summarizeCells(schedule: Schedule, attempts: Attempt[]) {
  const key = (c: Omit<Slot, 'pos'>) => `${c.task} ${c.mode} ${c.model}`
  const cells = [...new Map(schedule.slots.map(s => [key(s), { task: s.task, mode: s.mode, model: s.model }])).values()]
    .sort((a, b) => ORDER[a.task] - ORDER[b.task] || ORDER[a.model] - ORDER[b.model] || ORDER[a.mode] - ORDER[b.mode])
  return cells.map(cell => {
    const mine = attempts.filter(a => key(a) === key(cell))
    // Transient, harness-error and interrupted attempts were replaced or rerun: they count for spend, not for success.
    const counted = mine.filter(a => a.status === 'pass' || a.status === 'fail')
    const wins = counted.filter(a => a.status === 'pass')
    const won = wins.flatMap(a => (a.totals ? [a.totals] : []))
    // Spend is billed cost. Reservations for requests that never got an answer are not measured spend: kept apart.
    const spendUsd = mine.reduce((s, a) => s + a.costUsd, 0)
    const unresolvedUsd = mine.reduce((s, a) => s + a.unresolvedUsd, 0)
    const tokens = mine.flatMap(a => (a.totals ? [a.totals.tokens] : []))
    const read = tokens.reduce((s, t) => s + t.cacheRead, 0), prompt = tokens.reduce((s, t) => s + t.input + t.cacheRead + t.cacheWrite, 0)
    const replay = pickReplay(wins) ?? pickReplay(counted)
    return {
      ...cell, counted: counted.length, successes: wins.length,
      stats: won.length ? Object.fromEntries(Object.entries(METRICS).map(([k, f]) => [k, stat(won.map(f))])) as Record<keyof typeof METRICS, Stat> : null,
      spendUsd, unresolvedUsd, spendPerSuccessUsd: wins.length ? spendUsd / wins.length : null,
      cacheReadShare: prompt ? read / prompt : 0,
      replay: replay ? { dir: replay.dir, failed: replay.status !== 'pass' } : null,
      attempts: mine.map(a => ({ dir: a.dir, pos: a.pos, status: a.status, reason: a.reason })),
    }
  })
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { set: { type: 'string' }, repo: { type: 'string' }, local: { type: 'boolean', default: false }, print: { type: 'boolean', default: false } } })
  if (!values.set) throw new Error('--set is required')
  const set = values.set, dir = join(ROOT, 'runs', set)
  const schedule = JSON.parse(await readFile(join(dir, 'schedule.json'), 'utf8')) as Schedule
  const attempts: Attempt[] = await Promise.all(schedule.attempts.map(async a => {
    const t = JSON.parse(await readFile(join(dir, 'attempts', a.dir, 'trace.json'), 'utf8'))
    const requests = (t.requests ?? []) as { model: string | null; charged: string; costUsd: number; reservedUsd: number }[]
    return { ...a, totals: t.totals ?? null, startedAt: t.startedAt, versions: t.versions ?? {}, cacheReadOnFirstRequest: t.cacheReadOnFirstRequest ?? 0,
      models: [...new Set(requests.flatMap(r => (r.model ? [r.model] : [])))],
      overReserved: requests.some(r => r.charged === 'billed' && r.costUsd > r.reservedUsd) }
  }))
  const cells = summarizeCells(schedule, attempts)
  const cacheLeaks = attempts.filter(a => a.cacheReadOnFirstRequest > 0).map(a => a.dir)
  const overReserved = attempts.filter(a => a.overReserved).map(a => a.dir)
  const total = attempts.reduce((s, a) => s + a.costUsd, 0)
  const unresolved = attempts.reduce((s, a) => s + a.unresolvedUsd, 0)

  if (values.print) {
    console.table(cells.map(c => ({
      task: c.task, mode: c.mode, model: c.model, success: `${c.successes}/${c.counted}`, turns: c.stats?.turns.median ?? '-',
      costMedian: c.stats ? c.stats.costUsd.median.toFixed(3) : '-', spend: c.spendUsd.toFixed(3), unresolved: c.unresolvedUsd ? c.unresolvedUsd.toFixed(3) : '-',
      perSuccess: c.spendPerSuccessUsd?.toFixed(3) ?? 'N/A', cacheRead: `${Math.round(c.cacheReadShare * 100)}%`,
    })))
    console.log(`Billed ${total.toFixed(2)}, plus ${unresolved.toFixed(2)} reserved for requests without an answer. At 5 runs per cell: about ${(total * 5 / schedule.runs).toFixed(2)} billed.`)
    console.log(`First requests that read from the cache: ${cacheLeaks.length ? cacheLeaks.join(', ') : 'none'}`)
    console.log(`Requests billed above their reservation: ${overReserved.length ? overReserved.join(', ') : 'none'}`)
  } else {
    let revision: string | null = null, traceBase: string | null = null
    if (!values.local) {
      if (!values.repo) throw new Error('--repo <owner>/<repo> is required (or --local)')
      const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT }).toString().trim()
      const dirty = git('status', '--porcelain', '--', `runs/${set}/attempts`, `runs/${set}/schedule.json`, `runs/${set}/config`)
      if (dirty) throw new Error(`Commit runs/${set} first: the trace links point at the current commit.\n${dirty}`)
      revision = git('rev-parse', 'HEAD')
      traceBase = `https://github.com/${values.repo}/blob/${revision}/runs/${set}/attempts/`
    }
    const versions = Object.fromEntries(['chrome', 'chromeDevtoolsMcp', 'anthropicSdk', 'node', 'app']
      .map(k => [k, [...new Set(attempts.map(a => a.versions[k]).filter(Boolean))]]))
    const dates = attempts.map(a => a.startedAt).sort()
    const summary = {
      set, generatedAt: new Date().toISOString(), revision, traceBase, seed: schedule.seed, runsPerCell: schedule.runs,
      dates: { first: dates[0], last: dates.at(-1) }, versions: { ...versions, models: [...new Set(attempts.flatMap(a => a.models))] },
      cacheLeaks, cells,
    }
    await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
    console.log(`Wrote runs/${set}/summary.json (${cells.length} cells, ${total.toFixed(2)} billed, ${unresolved.toFixed(2)} unresolved)`)
  }
}
