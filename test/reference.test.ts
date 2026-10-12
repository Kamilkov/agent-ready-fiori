import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rules, startData, type DeskData } from '../bench/desk.ts'
import { allocate, byPriority, connections, firstFit, groups, offered, sameOffer, type Offered } from '../bench/reference.ts'
import { diff, T4_END, T5_END, tasks } from '../bench/tasks.ts'

const names = (d: DeskData, id: string) => connections(d, id).map(c => c.flights.map(f => f.number).join(' + '))
/** The app's connection list in the reference's terms. */
const fromApp = (d: DeskData, id: string): Offered[] => {
  const r = rules.connections(d, id)
  assert.ok(r.ok, r.ok ? '' : r.error)
  return r.connections.map(c => ({ ids: c.flights.map(f => f.id), free: c.flights.map(f => ({ ...f.free })), arrives: c.arrives, changes: c.changes }))
}

test('connections from the start data are those of tasks §2', () => {
  const d = startData()
  assert.deepEqual(names(d, 'ZX440'), ['ZX 450 + ZX 460', 'ZX 470 + ZX 472', 'ZX 486 + ZX 488', 'ZX 494 + ZX 490',
    'ZX 480 + ZX 482 + ZX 490', 'ZX 446', 'ZX 450 + ZX 462', 'ZX 494 + ZX 492', 'ZX 480 + ZX 482 + ZX 492', 'ZX 456 + ZX 464', 'ZX 449'])
  assert.deepEqual(names(d, 'ZX444'), ['ZX 454 + ZX 460', 'ZX 474 + ZX 472', 'ZX 454 + ZX 462', 'ZX 445'])
})

test('the reference derivation agrees with the hand-written end states, with no tie left', () => {
  const d = startData()
  const t4 = allocate(d, groups(d, ['ZX440']).filter(g => g.booking === 'WN4R8C'))
  assert.deepEqual([diff(T4_END, t4.data), t4.unbooked], [[], []])
  const order = groups(d, ['ZX440', 'ZX444']).sort(byPriority)
  assert.deepEqual(order.map(g => g.booking), ['WN4R8C', 'HB3K9W', 'LM2Q7H', 'EK1V7P', 'PD9X3K', 'OR6M2D', 'CB8T4F', 'SV5J1N'])
  const t5 = allocate(d, order)
  assert.deepEqual([diff(T5_END, t5.data), t5.unbooked], [[], ['PD9X3K']])
})

test('traps, priority and shared flights: list order or size alone fails the T5 grader, naming who went where', () => {
  const d = startData(), all = groups(d, ['ZX440', 'ZX444'])
  const graded = (order: typeof all) => {
    const r = allocate(d, order)
    return tasks.t5.grade(`ANSWER: ${r.unbooked.join(', ') || 'NONE'}`, r.data)
  }
  // List order: FRA groups take ZX 460's economy seats first, so the Rahimis (MUC) lose them.
  const listed = graded(all)
  assert.equal(listed.pass, false)
  assert.ok(listed.differences.includes('passengers[g7k2zt].flightIds: expected ["ZX470","ZX472"], got ["ZX450","ZX460"]'))
  assert.ok(listed.differences.includes('passengers[b5t1xw].flightIds: expected ["ZX454","ZX460"], got ["ZX454","ZX462"]'))
  // Size alone: the Dabrowskis come first and fit on ZX 470 + ZX 472, pushing the Weisses off ZX 472.
  const bySize = graded([...all].sort((a, b) => b.cabins.length - a.cabins.length))
  assert.equal(bySize.pass, false)
  assert.ok(bySize.differences.includes('passengers[u2j8lc].flightIds: expected ["ZX440"], got ["ZX470","ZX472"]'))
  assert.ok(bySize.differences.includes('passengers[h7c2nv].flightIds: expected ["ZX470","ZX472"], got ["ZX494","ZX490"]'))
  for (const g of [listed, bySize]) assert.ok(g.groups!.right < 8)
})

test('sameOffer: a missing connection or a different seat count is a difference; tie order is not', () => {
  const d = startData(), list = offered(d, 'ZX440')
  assert.ok(sameOffer(list, list))
  assert.ok(!sameOffer(list, list.filter(o => o.ids.join() !== 'ZX494,ZX490')))
  const seats = structuredClone(list)
  seats[0].free[1].Economy--
  assert.ok(!sameOffer(list, seats))
  const swapped = [...list]
  const i = swapped.findIndex(o => o.ids.join() === 'ZX494,ZX492')
  ;[swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]] // the two 22:55 arrivals with 1 and 2 changes
  assert.ok(!sameOffer(list, swapped), 'fewer changes must come first')
})

test("the app's own rules list the reference's connections at every step and reach T4/T5's end states", () => {
  for (const [end, ids, only] of [[T4_END, ['ZX440'], ['WN4R8C']], [T5_END, ['ZX440', 'ZX444'], null]] as const) {
    const d = startData()
    for (const g of groups(d, [...ids]).sort(byPriority)) {
      if (only && !(only as readonly string[]).includes(g.booking)) continue
      const app = fromApp(d, g.from)
      assert.ok(sameOffer(app, offered(d, g.from)), `${g.booking}: the app offers different connections or seats`)
      const pick = firstFit(app, g.cabins)
      if (!pick) { assert.equal(g.booking, 'PD9X3K'); continue }
      assert.deepEqual(pick.ids, allocate(d, [g]).data.passengers.find(p => p.id === g.ids[0])!.flightIds, g.booking)
      const r = rules.rebookConnection(d, { fromFlightId: g.from, toFlightIds: pick.ids, passengerIds: g.ids })
      assert.ok(r.ok, `${g.booking}: ${r.ok ? '' : r.error}`)
    }
    assert.deepEqual(diff(end, d), [])
  }
})
