// The three benchmark tasks: what the agent is asked, and how its result is graded against the app's final data.
// Expected end states are written out from the start data (spec §6–7), independent of the app's rules.
import { startData, type Cabin, type DeskData } from './desk.ts'

export type TaskId = 't1' | 't2' | 't3'
export interface Grade { pass: boolean; differences: string[] }
export interface Task { prompt: string; grade(finalText: string, data: unknown): Grade }

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
    p.flightId = flightId
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
}
