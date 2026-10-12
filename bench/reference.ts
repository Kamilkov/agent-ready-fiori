// Scenario 2's expected allocations derived from the start data alone, independently of the app's rules: the
// connection rules of docs/scenario-2/app-spec.md §4 and the priority of docs/scenario-2/tasks.md §1. The graders'
// hand-written end states must agree with it, and the app must offer what it lists (test/reference.test.ts, smoke).
import type { Cabin, DeskData, Flight } from './desk.ts'

export interface Connection { flights: Flight[]; arrives: number; changes: number }
export interface Group { booking: string; from: string; cabins: Cabin[]; ids: string[] }
/** A connection as offered to a dispatcher: its flights, their free seats, its arrival and changes. */
export interface Offered { ids: string[]; free: Record<Cabin, number>[]; arrives: string; changes: number }

const CABINS: Cabin[] = ['Economy', 'Business']
const minutes = (local: string) => Date.parse(`${local}:00Z`) / 60_000

/** Every connection for a cancelled flight (app spec §4), earliest arrival first, then fewer changes. */
export function connections(d: DeskData, cancelledId: string): Connection[] {
  const c = d.flights.find(f => f.id === cancelledId)
  if (!c) throw new Error(`No flight ${cancelledId}`)
  const last = minutes(`${c.departs.slice(0, 10)}T00:00`) + 3 * 1440 - 1
  const open = d.flights.filter(f => f.status === 'Scheduled' && (f.free.Economy > 0 || f.free.Business > 0))
  const found: Flight[][] = []
  const extend = (path: Flight[]) => {
    const at = path[path.length - 1]
    if (at.to === c.to) return void found.push(path)
    if (path.length === 3) return
    for (const f of open) {
      const gap = minutes(f.departs) - minutes(at.arrives)
      if (f.from === at.to && gap >= 90 && gap <= 720 && f.to !== c.from && !path.some(p => p.to === f.to)) extend([...path, f])
    }
  }
  for (const f of open) if (f.from === c.from && minutes(f.departs) > minutes(c.departs) && minutes(f.departs) <= last) extend([f])
  return found.map(flights => ({ flights, arrives: minutes(flights[flights.length - 1].arrives), changes: flights.length - 1 }))
    .sort((a, b) => a.arrives - b.arrives || a.changes - b.changes)
}

export const offered = (d: DeskData, cancelledId: string): Offered[] => connections(d, cancelledId).map(c => ({
  ids: c.flights.map(f => f.id), free: c.flights.map(f => ({ ...f.free })), arrives: c.flights[c.flights.length - 1].arrives, changes: c.changes,
}))

/** The same connections with the same seats, sorted by arrival then changes; order within a tie does not count. */
export function sameOffer(a: Offered[], b: Offered[]) {
  const keys = (l: Offered[]) => l.map(o => `${o.arrives} ${o.changes}`)
  const bag = (l: Offered[]) => l.map(o => JSON.stringify([o.ids, o.free, o.arrives, o.changes])).sort()
  return JSON.stringify(keys(a)) === JSON.stringify(keys(b)) && JSON.stringify(bag(a)) === JSON.stringify(bag(b))
}

/** The first connection with room for these cabins on every flight. */
export const firstFit = (list: Offered[], cabins: Cabin[]) =>
  list.find(o => o.free.every(f => CABINS.every(c => cabins.filter(x => x === c).length <= f[c])))

/** The booking groups still on the given cancelled flights, in data order. */
export function groups(d: DeskData, cancelledIds: string[]): Group[] {
  const out = new Map<string, Group>()
  for (const p of d.passengers) {
    if (p.flightIds.length !== 1 || !cancelledIds.includes(p.flightIds[0])) continue
    const g = out.get(p.booking) ?? { booking: p.booking, from: p.flightIds[0], cabins: [], ids: [] }
    g.cabins.push(p.cabin)
    g.ids.push(p.id)
    out.set(p.booking, g)
  }
  return [...out.values()]
}

/** T5's priority: groups with a Business passenger, then larger groups, then by booking reference. */
export const byPriority = (a: Group, b: Group) => Number(b.cabins.includes('Business')) - Number(a.cabins.includes('Business'))
  || b.cabins.length - a.cabins.length || a.booking.localeCompare(b.booking)

/** Each group in turn gets the earliest connection with room for it in every cabin on every flight; a tie on arrival
 *  goes to fewer changes, and a tie left after that throws (the task would have two answers). */
export function allocate(start: DeskData, order: Group[]): { data: DeskData; unbooked: string[] } {
  const d = structuredClone(start), unbooked: string[] = []
  for (const g of order) {
    const need = (c: Cabin) => g.cabins.filter(x => x === c).length
    const fit = connections(d, g.from).filter(k => k.flights.every(f => CABINS.every(c => need(c) <= f.free[c])))
    if (!fit.length) { unbooked.push(g.booking); continue }
    if (fit[1] && fit[1].arrives === fit[0].arrives && fit[1].changes === fit[0].changes)
      throw new Error(`${g.booking}: ${fit[0].flights.map(f => f.number).join(' + ')} and ${fit[1].flights.map(f => f.number).join(' + ')} tie`)
    for (const f of fit[0].flights) for (const c of CABINS) f.free[c] -= need(c)
    for (const p of d.passengers) if (g.ids.includes(p.id)) p.flightIds = fit[0].flights.map(f => f.id)
  }
  return { data: d, unbooked }
}
