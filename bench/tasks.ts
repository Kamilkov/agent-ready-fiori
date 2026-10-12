// The three benchmark tasks: what the agent is asked, and how its result is graded against the app's final data.
// Expected end states are written out from the start data (spec §6–7), independent of the app's rules.
import { startData, type Cabin, type DeskData } from './desk.ts'

export type TaskId = 't1' | 't2' | 't3' | 't4' | 't5'
export interface Grade { pass: boolean; differences: string[]; groups?: { right: number; total: number } }
export interface Task { prompt: string; grade(finalText: string, data: unknown): Grade; limits?: { turns: number; ms: number } }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasId = (v: unknown): v is { id: string } => isObject(v) && typeof v.id === 'string'

/** Where actual differs from expected, as "path: expected X, got Y". Arrays of objects with an id are matched by id;
 *  an id listed more than once is a difference in itself, so a duplicated passenger never hides behind the match. */
export function diff(expected: unknown, actual: unknown, path = ''): string[] {
  if (Array.isArray(expected) && Array.isArray(actual) && expected.every(hasId) && actual.every(hasId)) {
    const twice = (side: string, xs: { id: string }[]) => [...new Set(xs.map(x => x.id).filter((id, i, all) => all.indexOf(id) !== i))]
      .map(id => `${path}[${id}]: listed ${xs.filter(x => x.id === id).length} times in ${side}`)
    const dupes = [...twice('expected', expected), ...twice('got', actual)]
    if (dupes.length) return dupes
    const ids = [...new Set([...expected, ...actual].map(x => x.id))]
    return ids.flatMap(id => diff(expected.find(x => x.id === id), actual.find(x => x.id === id), `${path}[${id}]`))
  }
  if (isObject(expected) && isObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    return keys.flatMap(k => diff(expected[k], actual[k], path ? `${path}.${k}` : k))
  }
  return JSON.stringify(expected) === JSON.stringify(actual) ? [] : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`]
}

/** The start data with passengers (by name) moved and free seats set. */
function after(moves: Record<string, string>, free: Record<string, Partial<Record<Cabin, number>>>): DeskData {
  const d = startData()
  for (const [name, flightId] of Object.entries(moves)) {
    const p = d.passengers.find(p => p.name === name)
    if (!p) throw new Error(`No passenger ${name}`)
    p.flightIds = [flightId]
  }
  for (const [flightId, seats] of Object.entries(free)) {
    const f = d.flights.find(f => f.id === flightId)
    if (!f) throw new Error(`No flight ${flightId}`)
    Object.assign(f.free, seats)
  }
  return d
}

const T2_END = after({ 'Anna Novak': 'ZX402' }, { ZX402: { Economy: 1 } })
const T3_END = after(
  { 'Jan Horvat': 'ZX404', 'Maja Horvat': 'ZX404', 'Luka Horvat': 'ZX404', 'Elena Rossi': 'ZX406', 'Marco Rossi': 'ZX406',
    'Anna Novak': 'ZX402', 'Tom Berger': 'ZX402', 'Sara Lind': 'ZX402' },
  { ZX402: { Economy: 0, Business: 0 }, ZX404: { Economy: 0 }, ZX406: { Business: 2 } },
)

const graded = (differences: string[]): Grade => ({ pass: differences.length === 0, differences })
// Whitespace, case and markdown emphasis do not count in the T1 answer.
const norm = (s: string) => s.replace(/[\s*`]/g, '').toUpperCase()
const ROUTE = 'Flight ZX 400 from Frankfurt (FRA) to New York (JFK) is cancelled.'

/** The start data with booking groups (by reference) moved onto flights and free seats set. */
function endState(moves: Record<string, string[]>, free: Record<string, Partial<Record<Cabin, number>>>): DeskData {
  const d = startData()
  for (const [booking, flightIds] of Object.entries(moves)) {
    const group = d.passengers.filter(p => p.booking === booking)
    if (!group.length) throw new Error(`No booking ${booking}`)
    for (const p of group) p.flightIds = [...flightIds]
  }
  for (const [flightId, seats] of Object.entries(free)) {
    const f = d.flights.find(f => f.id === flightId)
    if (!f) throw new Error(`No flight ${flightId}`)
    Object.assign(f.free, seats)
  }
  return d
}

// docs/scenario-2/tasks.md §3, written out by hand; bench/reference.ts derives the same independently.
export const T4_END = endState({ WN4R8C: ['ZX470', 'ZX472'] }, { ZX470: { Economy: 3, Business: 1 }, ZX472: { Economy: 2, Business: 1 } })
export const T5_END = endState(
  { WN4R8C: ['ZX470', 'ZX472'], HB3K9W: ['ZX474', 'ZX472'], LM2Q7H: ['ZX494', 'ZX490'], EK1V7P: ['ZX454', 'ZX462'],
    OR6M2D: ['ZX454', 'ZX460'], CB8T4F: ['ZX494', 'ZX490'], SV5J1N: ['ZX470', 'ZX472'] },
  { ZX454: { Economy: 2, Business: 1 }, ZX460: { Economy: 0, Business: 0 }, ZX462: { Economy: 3, Business: 0 },
    ZX470: { Economy: 2, Business: 1 }, ZX472: { Economy: 0, Business: 0 }, ZX474: { Economy: 3, Business: 1 },
    ZX490: { Economy: 0, Business: 0 }, ZX494: { Economy: 2, Business: 1 } },
)
const T5_BOOKINGS = ['WN4R8C', 'HB3K9W', 'LM2Q7H', 'EK1V7P', 'PD9X3K', 'OR6M2D', 'CB8T4F', 'SV5J1N']
export const HARD = { turns: 120, ms: 30 * 60_000 }

/** Groups with the correct final assignment: every member has the expected flights (a group left behind included). */
function groupsRight(expected: DeskData, data: unknown, bookings: string[]) {
  const actual = isObject(data) && Array.isArray(data.passengers) ? (data.passengers as unknown[]).filter(isObject) : []
  const right = bookings.filter(b => expected.passengers.filter(p => p.booking === b)
    .every(p => JSON.stringify(actual.find(a => a.id === p.id)?.flightIds) === JSON.stringify(p.flightIds))).length
  return { right, total: bookings.length }
}
const lastAnswer = (text: string) => [...text.matchAll(/ANSWER:\s*([^\n]*)/gi)].at(-1)?.[1].trim() ?? null
const CANCELLED = 'Flight ZX 440 from Frankfurt (FRA) to New York (JFK) on 9 November is cancelled.'

export const tasks: Record<TaskId, Task> = {
  t1: {
    prompt: 'How many passengers on flight ZX 400 are booked in business class, and which later flight from Frankfurt (FRA) to New York (JFK) has the most free business seats? End your reply with one line in the form `ANSWER: <number>; <flight number>`, for example `ANSWER: 5; ZX 123`.',
    grade(finalText, data) {
      const answer = [...finalText.matchAll(/ANSWER:\s*([^\n]*)/gi)].at(-1)?.[1].trim() ?? null
      const differences = diff(startData(), data)
      if (answer === null || norm(answer) !== '3;ZX406') differences.unshift(`answer: expected "3; ZX 406", got ${JSON.stringify(answer)}`)
      return graded(differences)
    },
  },
  t2: {
    prompt: `${ROUTE} Rebook passenger Anna Novak onto the earliest flight on the same route that has a free seat in her cabin.`,
    grade: (_finalText, data) => graded(diff(T2_END, data)),
  },
  t3: {
    prompt: `${ROUTE} Rebook all of its passengers. Everyone keeps their cabin. Passengers with the same booking reference travel together on one flight. Put each booking group on the earliest flight on the same route that has enough free seats in its cabin for the whole group.`,
    grade: (_finalText, data) => graded(diff(T3_END, data)),
  },
  t4: {
    prompt: `${CANCELLED} Rebook the three passengers with booking reference WN4R8C together onto the connection that arrives in New York earliest and has a free seat in each passenger's cabin, for all three of them, on every flight. Everyone keeps their cabin.`,
    limits: HARD,
    grade: (_finalText, data) => ({ ...graded(diff(T4_END, data)), groups: groupsRight(T4_END, data, ['WN4R8C']) }),
  },
  t5: {
    prompt: [
      'Flights ZX 440 from Frankfurt (FRA) and ZX 444 from Munich (MUC) to New York (JFK) on 9 November are cancelled. Rebook all of their passengers onto connections to New York, following these rules:',
      [
        '1. Everyone keeps their cabin.',
        '2. Passengers with the same booking reference travel together on the same flights. Never split a booking group.',
        '3. Seats go to the booking groups by priority, one list for both flights: groups that include a Business passenger first; then larger groups before smaller ones; then by booking reference, alphabetically.',
        "4. Each group gets the connection that arrives in New York earliest and has enough free seats in each of its passengers' cabins on every flight, after all higher-priority groups have their seats. If two such connections arrive at the same time, take the one with fewer changes.",
        '5. If no connection has room for a whole group, leave that group on its cancelled flight.',
      ].join('\n'),
      'You may make the bookings in any order.',
      'End your reply with one line in the form `ANSWER: <booking references left on their cancelled flight, comma-separated, or NONE>`.',
    ].join('\n\n'),
    limits: HARD,
    grade(finalText, data) {
      const answer = lastAnswer(finalText)
      const differences = diff(T5_END, data)
      // tasks.md §4: only whitespace, backticks, asterisks and case are ignored. Extra entries, empty ones included, fail.
      if (answer === null || norm(answer) !== 'PD9X3K') differences.unshift(`answer: expected "PD9X3K", got ${JSON.stringify(answer)}`)
      return { ...graded(differences), groups: groupsRight(T5_END, data, T5_BOOKINGS) }
    },
  },
}
