// The order of the runs: every task × mode × model slot, shuffled with a fixed seed, plus replacement attempts.
import type { Mode } from './browser.ts'
import type { ModelKey } from './models.ts'
import type { TaskId } from './tasks.ts'

export type Status = 'pass' | 'fail' | 'transient' | 'harness_error' | 'running' | 'interrupted'
export interface Slot { pos: number; task: TaskId; mode: Mode; model: ModelKey; replaces?: string }
export interface AttemptRecord {
  id: string; pos: number; dir: string; task: TaskId; mode: Mode; model: ModelKey
  status: Status; reason: string | null; replaces?: string
  /** Billed cost, and reservations of requests that never got an answer; the spending cap counts both. */
  costUsd: number; unresolvedUsd: number
}
export interface Schedule { seed: number; runs: number; slots: Slot[]; attempts: AttemptRecord[] }

export const MAX_REPLACEMENTS = 2

// mulberry32, a small seeded generator, so the shuffle can be reproduced from the seed.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeSchedule(o: { seed: number; runs: number; tasks: TaskId[]; modes: Mode[]; models: ModelKey[] }): Schedule {
  const cells = o.tasks.flatMap(task => o.modes.flatMap(mode => o.models.map(model => ({ task, mode, model }))))
  const slots = cells.flatMap(c => Array.from({ length: o.runs }, () => ({ ...c })))
  const rnd = random(o.seed)
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }
  return { seed: o.seed, runs: o.runs, slots: slots.map((s, pos) => ({ pos, ...s })), attempts: [] }
}

// A slot is done once an attempt in it passed, failed or was transient (and replaced). After a harness error or an
// interruption (crash, Ctrl-C, the spending cap) it runs again.
const FINISHED: Status[] = ['pass', 'fail', 'transient']

/** The next slot to run: the first one without a finished attempt. */
export const nextSlot = (s: Schedule) =>
  s.slots.find(slot => !s.attempts.some(a => a.pos === slot.pos && FINISHED.includes(a.status)))

export type Recovered = Pick<AttemptRecord, 'status' | 'reason' | 'costUsd' | 'unresolvedUsd'>

/** Before resuming: an attempt the schedule still marks running was cut off before the schedule was saved. `recover`
 *  reads its trace: a verdict the trace already holds stands, anything unfinished becomes interrupted. Returns the
 *  attempts it changed. */
export async function reconcile(s: Schedule, recover: (a: AttemptRecord) => Promise<Recovered>): Promise<AttemptRecord[]> {
  const cut = s.attempts.filter(a => a.status === 'running')
  for (const a of cut) Object.assign(a, await recover(a))
  return cut
}

const sameCell = (a: Omit<Slot, 'pos'>, b: Omit<Slot, 'pos'>) => a.task === b.task && a.mode === b.mode && a.model === b.model

/** Queues a replacement for a transient attempt. Returns null once the cell has had MAX_REPLACEMENTS; the batch then stops. */
export function addReplacement(s: Schedule, attempt: AttemptRecord): Slot | null {
  if (s.slots.filter(x => x.replaces && sameCell(x, attempt)).length >= MAX_REPLACEMENTS) return null
  const slot: Slot = { pos: s.slots.length, task: attempt.task, mode: attempt.mode, model: attempt.model, replaces: attempt.id }
  s.slots.push(slot)
  return slot
}

/** What the spending cap counts: billed cost plus unresolved reservations. */
export const spent = (s: Schedule) => s.attempts.reduce((sum, a) => sum + a.costUsd + a.unresolvedUsd, 0)
