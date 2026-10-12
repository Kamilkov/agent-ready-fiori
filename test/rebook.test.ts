import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rules, startData, type DeskData, type Result } from '../bench/desk.ts'

const ANNA = 'q7d2ax', SARA = 'm1z6wu', ELENA = 'b6n1vj', MARCO = 'y3h5sl', IVO = 'k8p4ty'
const HORVATS = ['c4m8pz', 'r2x7kd', 'w9t3fq']
const flight = (d: DeskData, id: string) => d.flights.find(f => f.id === id)!
const on = (d: DeskData, id: string) => d.passengers.find(p => p.id === id)!.flightIds
const ids = (r: Result<{ flights: { id: string }[] }>) => (r.ok ? r.flights.map(f => f.id) : r.error)

/** A rejected rebooking returns the error and leaves every flight and passenger as it was. */
function rejects(input: unknown, error: string, d = startData()) {
  const before = structuredClone(d)
  assert.deepEqual(rules.rebook(d, input), { ok: false, error })
  assert.deepEqual(d, before)
}

test('search: flights by departure; filters combine; values are normalized like the screen does', () => {
  assert.deepEqual(ids(rules.searchFlights(startData(), { from: 'FRA', to: 'JFK' })), ['ZX400', 'ZX402', 'ZX404', 'ZX406', 'ZX440', 'ZX446', 'ZX448', 'ZX449'])
  assert.deepEqual(ids(rules.searchFlights(startData(), { from: ' fra', to: 'jfk ', date: '2026-11-03' })), ['ZX404', 'ZX406'])
  assert.deepEqual(ids(rules.searchFlights(startData(), { status: 'cancelled' })), ['ZX424', 'ZX400', 'ZX444', 'ZX440'])
  assert.deepEqual(ids(rules.searchFlights(startData(), { status: 'Delayed' })), [])
  const all = rules.searchFlights(startData())
  assert.ok(all.ok)
  assert.equal(all.flights.length, 34)
  assert.deepEqual(all.filters, { from: '', to: '', date: '', status: '' })
})

test('get_flight: "ZX 400", "zx400" and "ZX400" are the same flight, with its 8 passengers', () => {
  for (const id of ['ZX 400', 'zx400', 'ZX400']) {
    const r = rules.getFlight(startData(), id)
    assert.ok(r.ok)
    assert.equal(r.flight.id, 'ZX400')
    assert.equal(r.passengers.length, 8)
    assert.equal(r.passengers.filter(p => p.cabin === 'Business').length, 3)
  }
  assert.deepEqual(rules.getFlight(startData(), 'ZX 999'), { ok: false, error: 'Flight ZX 999 does not exist' })
  assert.deepEqual(rules.getFlight(startData(), undefined), { ok: false, error: 'A flight ID is required' })
})

test('alternatives: same route, scheduled, later; a cabin keeps the flights with a free seat in it', () => {
  assert.deepEqual(ids(rules.alternatives(startData(), 'ZX400')), ['ZX402', 'ZX404', 'ZX406', 'ZX446', 'ZX448', 'ZX449'])
  assert.deepEqual(ids(rules.alternatives(startData(), 'zx 400', ' business')), ['ZX402', 'ZX406', 'ZX449'])
  assert.deepEqual(ids(rules.alternatives(startData(), 'ZX424')), ['ZX420', 'ZX422', 'ZX445'])
  assert.deepEqual(rules.alternatives(startData(), 'ZX402'), { ok: false, error: 'ZX 402 is not cancelled' })
  assert.deepEqual(rules.alternatives(startData(), 'ZX400', 'First'), { ok: false, error: 'Cabin must be Economy or Business' })
  assert.deepEqual(rules.alternatives(startData(), 'ZX999'), { ok: false, error: 'Flight ZX999 does not exist' })
})

test('rebook: Anna moves to ZX 402, its economy seats drop by one, ZX 400 itself is unchanged', () => {
  const d = startData(), zx400 = structuredClone(flight(d, 'ZX400'))
  assert.deepEqual(rules.rebook(d, { fromFlightId: 'ZX 400', toFlightId: 'zx402', passengerIds: [ANNA] }), { ok: true, moved: 1, to: 'ZX 402' })
  assert.deepEqual(on(d, ANNA), ['ZX402'])
  assert.deepEqual(flight(d, 'ZX402').free, { Economy: 1, Business: 1 })
  assert.deepEqual(flight(d, 'ZX400'), zx400)
})

test('rebook: one call can move both cabins; each keeps its cabin', () => {
  const d = startData()
  assert.deepEqual(rules.rebook(d, { fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [ANNA, SARA] }), { ok: true, moved: 2, to: 'ZX 402' })
  assert.deepEqual(flight(d, 'ZX402').free, { Economy: 1, Business: 0 })
})

test('rebook: not enough seats in a cabin rejects the whole call', () => {
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [ELENA, MARCO] }, 'Only 1 business seat left on ZX 402')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: HORVATS }, 'Only 2 economy seats left on ZX 402')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX404', passengerIds: [SARA] }, 'No business seats left on ZX 404')
  // All or nothing: Anna would fit, the Rossis would not, so Anna stays too.
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [ANNA, ELENA, MARCO] }, 'Only 1 business seat left on ZX 402')
})

test('rebook: the source must be cancelled; the target on the same route, scheduled and later', () => {
  rejects({ fromFlightId: 'ZX402', toFlightId: 'ZX404', passengerIds: [ANNA] }, 'ZX 402 is not cancelled')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX420', passengerIds: [ANNA] }, 'ZX 420 does not fly FRA→JFK')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX400', passengerIds: [ANNA] }, 'ZX 400 is not scheduled')
  rejects({ fromFlightId: 'ZX424', toFlightId: 'ZX418', passengerIds: [IVO] }, 'ZX 418 does not depart after ZX 424')
})

test('rebook: input checks run before anything changes', () => {
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX999', passengerIds: [ANNA] }, 'Flight ZX999 does not exist')
  rejects({ toFlightId: 'ZX402', passengerIds: [ANNA] }, 'A flight ID is required')
  rejects(undefined, 'A flight ID is required')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402' }, 'passengerIds must be a list of passenger IDs')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: ANNA }, 'passengerIds must be a list of passenger IDs')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [] }, 'Select at least one passenger')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [ANNA, ANNA] }, `Passenger ${ANNA} is listed twice`)
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [ANNA, 'nobody'] }, 'Passenger nobody is not booked on ZX 400')
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [IVO] }, `Passenger ${IVO} is not booked on ZX 400`)
})

test('rebook: a second rebooking of Anna is rejected and uses no seat', () => {
  const d = startData()
  assert.ok(rules.rebook(d, { fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [ANNA] }).ok)
  rejects({ fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [ANNA] }, `Passenger ${ANNA} is not booked on ZX 400`, d)
  assert.equal(flight(d, 'ZX402').free.Economy, 1)
})
