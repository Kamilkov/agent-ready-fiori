import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rules, startData, type Connection, type DeskData, type Flight, type Result } from '../bench/desk.ts'

const WEISS = ['h7c2nv', 't4q9mx', 'z1r6bd'], LUNDS = ['e8w3ks', 'n5y7fa'], DABROWSKIS = ['u2j8lc', 'a6m1qr', 'x9d4wg', 's3v5pe']
const SOFIA = 'g7k2zt', COSTAS = ['d1x8hn', 'p4f6ry'], HUGO = 'v9a3mc'
const flight = (d: DeskData, id: string) => d.flights.find(f => f.id === id)!
const on = (d: DeskData, id: string) => d.passengers.find(p => p.id === id)!.flightIds
const legs = (r: Result<{ connections: Connection[] }>) => (r.ok ? r.connections.map(c => c.flights.map(f => f.id).join('+')) : r.error)
/** The start data with one flight moved to another departure (and arrival): edge cases the start data does not have. */
function startDataWith(id: string, departs: string, arrives?: string) {
  const d = startData()
  Object.assign(flight(d, id), { departs, arrives: arrives ?? flight(d, id).arrives })
  return d
}
const add = (d: DeskData, number: string, from: string, to: string, departs: string, arrives: string): DeskData => {
  d.flights.push({ id: number.replace(' ', ''), number, from, to, departs, arrives, status: 'Scheduled', free: { Economy: 5, Business: 5 } })
  return d
}

/** A rejected connection rebooking returns the error and leaves every flight and passenger as it was. */
function rejects(input: unknown, error: string, d = startData()) {
  const before = structuredClone(d)
  assert.deepEqual(rules.rebookConnection(d, input), { ok: false, error })
  assert.deepEqual(d, before)
}
const onto = (toFlightIds: unknown, passengerIds: unknown = WEISS, fromFlightId: unknown = 'ZX440') => ({ fromFlightId, toFlightIds, passengerIds })

// The spec's §3.2–3.4, as written there.
const ARRIVES = 'ZX 400 2026-11-02T12:45, ZX 402 2026-11-02T20:45, ZX 404 2026-11-03T09:45, ZX 406 2026-11-03T12:45, ZX 401 2026-11-02T12:00, ZX 403 2026-11-03T12:00, ZX 410 2026-11-01T08:45, ZX 412 2026-11-02T12:45, ZX 418 2026-11-01T18:00, ZX 420 2026-11-02T12:00, ZX 422 2026-11-03T14:00, ZX 424 2026-11-02T11:00'
const NEW_FLIGHTS = `
ZX 440 | FRA | JFK | 2026-11-09T10:00 | 2026-11-09T12:45 | 0 | 0 | Cancelled
ZX 444 | MUC | JFK | 2026-11-09T09:30 | 2026-11-09T12:30 | 0 | 0 | Cancelled
ZX 446 | FRA | JFK | 2026-11-09T18:00 | 2026-11-09T20:45 | 1 | 0 | Scheduled
ZX 448 | FRA | JFK | 2026-11-10T10:00 | 2026-11-10T12:45 | 0 | 0 | Scheduled
ZX 449 | FRA | JFK | 2026-11-11T10:00 | 2026-11-11T12:45 | 3 | 1 | Scheduled
ZX 445 | MUC | JFK | 2026-11-10T09:30 | 2026-11-10T12:30 | 0 | 1 | Scheduled
ZX 450 | FRA | LHR | 2026-11-09T12:00 | 2026-11-09T12:45 | 8 | 4 | Scheduled
ZX 456 | FRA | LHR | 2026-11-10T07:00 | 2026-11-10T07:45 | 6 | 2 | Scheduled
ZX 454 | MUC | LHR | 2026-11-09T11:00 | 2026-11-09T12:10 | 5 | 2 | Scheduled
ZX 460 | LHR | JFK | 2026-11-09T15:00 | 2026-11-09T17:55 | 3 | 0 | Scheduled
ZX 462 | LHR | JFK | 2026-11-09T19:00 | 2026-11-09T21:55 | 3 | 1 | Scheduled
ZX 464 | LHR | JFK | 2026-11-10T10:00 | 2026-11-10T12:55 | 3 | 2 | Scheduled
ZX 470 | FRA | AMS | 2026-11-09T13:00 | 2026-11-09T14:10 | 5 | 2 | Scheduled
ZX 474 | MUC | AMS | 2026-11-09T11:30 | 2026-11-09T13:05 | 4 | 2 | Scheduled
ZX 472 | AMS | JFK | 2026-11-09T16:30 | 2026-11-09T18:40 | 4 | 2 | Scheduled
ZX 480 | FRA | DUB | 2026-11-09T11:30 | 2026-11-09T12:50 | 3 | 2 | Scheduled
ZX 482 | DUB | BOS | 2026-11-09T15:00 | 2026-11-09T17:10 | 3 | 2 | Scheduled
ZX 486 | FRA | KEF | 2026-11-09T13:00 | 2026-11-09T15:40 | 0 | 2 | Scheduled
ZX 488 | KEF | JFK | 2026-11-09T17:30 | 2026-11-09T19:10 | 4 | 0 | Scheduled
ZX 494 | FRA | BOS | 2026-11-09T13:30 | 2026-11-09T16:10 | 4 | 3 | Scheduled
ZX 490 | BOS | JFK | 2026-11-09T19:00 | 2026-11-09T20:25 | 2 | 2 | Scheduled
ZX 492 | BOS | JFK | 2026-11-09T21:30 | 2026-11-09T22:55 | 3 | 0 | Scheduled`
const NEW_PASSENGERS = `
h7c2nv | Greta Weiss | WN4R8C | Business | ZX440
t4q9mx | Paul Weiss | WN4R8C | Economy | ZX440
z1r6bd | Nina Weiss | WN4R8C | Economy | ZX440
e8w3ks | Henrik Lund | LM2Q7H | Business | ZX440
n5y7fa | Ingrid Lund | LM2Q7H | Business | ZX440
u2j8lc | Piotr Dabrowski | PD9X3K | Economy | ZX440
a6m1qr | Ewa Dabrowska | PD9X3K | Economy | ZX440
x9d4wg | Kasia Dabrowska | PD9X3K | Economy | ZX440
s3v5pe | Jakub Dabrowski | PD9X3K | Economy | ZX440
g7k2zt | Sofia Vidal | SV5J1N | Economy | ZX440
d1x8hn | Teo Costa | CB8T4F | Economy | ZX440
p4f6ry | Bia Costa | CB8T4F | Economy | ZX440
v9a3mc | Hugo Brandt | HB3K9W | Business | ZX444
k2n7ue | Mila Brandt | HB3K9W | Economy | ZX444
b5t1xw | Omar Rahimi | OR6M2D | Economy | ZX444
m8g4jd | Leila Rahimi | OR6M2D | Economy | ZX444
r3e9vk | Sami Rahimi | OR6M2D | Economy | ZX444
f6p2ql | Erik Kask | EK1V7P | Business | ZX444`
const rows = (table: string) => table.trim().split('\n').map(line => line.split('|').map(s => s.trim()))

test('data: part 1 flights arrive as in the spec; scenario 2 flights and passengers are appended; flightIds is a list', () => {
  const d = startData()
  for (const [number, arrives] of ARRIVES.split(', ').map(s => [s.slice(0, 6), s.slice(7)])) assert.equal(flight(d, number.replace(' ', '')).arrives, arrives, number)
  assert.deepEqual(d.flights.slice(12), rows(NEW_FLIGHTS).map(([number, from, to, departs, arrives, economy, business, status]): Flight =>
    ({ id: number.replace(' ', ''), number, from, to, departs, arrives, status: status as Flight['status'], free: { Economy: +economy, Business: +business } })))
  assert.deepEqual(d.passengers.slice(10).map(p => [p.id, p.name, p.booking, p.cabin, p.flightIds.join()]), rows(NEW_PASSENGERS))
  assert.deepEqual(d.passengers.slice(0, 10).map(p => p.flightIds), [...Array(8).fill(['ZX400']), ['ZX424'], ['ZX424']])
  for (const f of d.flights) assert.match(f.arrives, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/, f.number)
})

test('connections: ZX 440 has 11, by arrival, then fewer changes; each lists its flights, arrival and changes', () => {
  const r = rules.connections(startData(), 'ZX 440')
  assert.deepEqual(legs(r), [
    'ZX450+ZX460', 'ZX470+ZX472', 'ZX486+ZX488', 'ZX494+ZX490', 'ZX480+ZX482+ZX490', 'ZX446',
    'ZX450+ZX462', 'ZX494+ZX492', 'ZX480+ZX482+ZX492', 'ZX456+ZX464', 'ZX449',
  ])
  assert.ok(r.ok)
  assert.equal(r.cabin, '')
  const d = startData()
  assert.deepEqual(r.connections[0], { flights: [flight(d, 'ZX450'), flight(d, 'ZX460')], arrives: '2026-11-09T17:55', changes: 1 })
  assert.deepEqual(r.connections.map(c => `${c.arrives} ${c.changes}`).slice(3, 6), ['2026-11-09T20:25 1', '2026-11-09T20:25 2', '2026-11-09T20:45 0'])
  assert.deepEqual(legs(rules.connections(startData(), 'zx444')), ['ZX454+ZX460', 'ZX474+ZX472', 'ZX454+ZX462', 'ZX445'])
})

test('connections: with a cabin, every flight has a free seat in it; without one, a seat in any cabin will do', () => {
  const business = rules.connections(startData(), 'ZX440', ' business')
  assert.deepEqual(legs(business), ['ZX470+ZX472', 'ZX494+ZX490', 'ZX480+ZX482+ZX490', 'ZX450+ZX462', 'ZX456+ZX464', 'ZX449'])
  assert.ok(business.ok)
  assert.equal(business.cabin, 'Business')
  assert.deepEqual(legs(rules.connections(startData(), 'ZX440', 'Economy')), [
    'ZX450+ZX460', 'ZX470+ZX472', 'ZX494+ZX490', 'ZX480+ZX482+ZX490', 'ZX446', 'ZX450+ZX462', 'ZX494+ZX492', 'ZX480+ZX482+ZX492', 'ZX456+ZX464', 'ZX449',
  ])
  // ZX 448 has no seat at all; a flight with none in a cabin drops out of that cabin's list only.
  const d = startData()
  flight(d, 'ZX460').free = { Economy: 0, Business: 0 }
  flight(d, 'ZX472').status = 'Cancelled'
  assert.deepEqual(legs(rules.connections(d, 'ZX440')).slice(0, 3), ['ZX486+ZX488', 'ZX494+ZX490', 'ZX480+ZX482+ZX490'])
})

test('connections: errors as for alternatives', () => {
  assert.deepEqual(rules.connections(startData(), 'ZX 999'), { ok: false, error: 'Flight ZX 999 does not exist' })
  assert.deepEqual(rules.connections(startData(), undefined), { ok: false, error: 'A flight ID is required' })
  assert.deepEqual(rules.connections(startData(), 'ZX446'), { ok: false, error: 'ZX 446 is not cancelled' })
  assert.deepEqual(rules.connections(startData(), 'ZX440', 'First'), { ok: false, error: 'Cabin must be Economy or Business' })
})

test('connections: the first flight departs after the cancelled one and by the end of the second day after its date', () => {
  const at = (id: string, departs: string) => legs(rules.connections(startDataWith(id, departs), 'ZX440'))
  assert.ok(at('ZX449', '2026-11-11T23:59').includes('ZX449'))
  assert.ok(!at('ZX449', '2026-11-12T00:00').includes('ZX449'))
  assert.ok(!at('ZX446', '2026-11-09T10:00').includes('ZX446'))
  assert.ok(at('ZX446', '2026-11-09T10:01').includes('ZX446'))
})

test('connections: a change takes 90 minutes to 12 hours, both included', () => {
  const at = (id: string, departs: string) => legs(rules.connections(startDataWith(id, departs), 'ZX440'))
  // ZX 450 arrives at LHR at 12:45.
  assert.ok(at('ZX460', '2026-11-09T14:15').includes('ZX450+ZX460'))
  assert.ok(!at('ZX460', '2026-11-09T14:14').includes('ZX450+ZX460'))
  assert.ok(at('ZX464', '2026-11-10T00:45').includes('ZX450+ZX464'))
  assert.ok(!at('ZX464', '2026-11-10T00:46').includes('ZX450+ZX464'))
})

test('connections: no airport twice, counting the departure airport', () => {
  // FRA → LHR → FRA → JFK chains up in time, but passes FRA twice. ZX 902 alone is fine.
  const d = add(add(startData(), 'ZX 900', 'LHR', 'FRA', '2026-11-09T14:30', '2026-11-09T17:00'), 'ZX 902', 'FRA', 'JFK', '2026-11-09T19:00', '2026-11-09T21:45')
  const r = legs(rules.connections(d, 'ZX440'))
  assert.ok(r.includes('ZX902'))
  assert.ok(!String(r).includes('ZX900'))
})

test('connections: equal arrival and changes come in the same order every time', () => {
  // ZX 905 makes ties with ZX 450's connections; reversing the flight list must not change the order.
  const d = add(startData(), 'ZX 905', 'FRA', 'LHR', '2026-11-09T11:00', '2026-11-09T11:45'), reversed = structuredClone(d)
  reversed.flights.reverse()
  const r = legs(rules.connections(d, 'ZX440'))
  assert.deepEqual(r.slice(0, 2), ['ZX450+ZX460', 'ZX905+ZX460'])
  assert.deepEqual(legs(rules.connections(reversed, 'ZX440')), r)
})

test('rebookConnection: the Weiss family moves onto ZX 470 → ZX 472; both flights lose their seats; ZX 440 is unchanged', () => {
  const d = startData(), zx440 = structuredClone(flight(d, 'ZX440'))
  assert.deepEqual(rules.rebookConnection(d, onto(['zx 470', 'ZX472'])), { ok: true, moved: 3, to: ['ZX 470', 'ZX 472'] })
  for (const id of WEISS) assert.deepEqual(on(d, id), ['ZX470', 'ZX472'])
  assert.deepEqual(flight(d, 'ZX470').free, { Economy: 3, Business: 1 })
  assert.deepEqual(flight(d, 'ZX472').free, { Economy: 2, Business: 1 })
  assert.deepEqual(flight(d, 'ZX440'), zx440)
  // Everyone on a flight shows on its screen, connecting passengers included; ZX 440 shows who is left.
  const zx472 = rules.getFlight(d, 'ZX472')
  assert.ok(zx472.ok)
  assert.deepEqual(zx472.passengers.map(p => p.id), WEISS)
  const zx440now = rules.getFlight(d, 'ZX440')
  assert.ok(zx440now.ok)
  assert.equal(zx440now.passengers.length, 9)
})

test('rebookConnection: a direct flight is a connection of one, three flights are the most', () => {
  const d = startData()
  assert.deepEqual(rules.rebookConnection(d, onto(['ZX446'], [SOFIA])), { ok: true, moved: 1, to: ['ZX 446'] })
  assert.deepEqual(on(d, SOFIA), ['ZX446'])
  assert.deepEqual(flight(d, 'ZX446').free, { Economy: 0, Business: 0 })
  assert.deepEqual(rules.rebookConnection(d, onto(['ZX480', 'ZX482', 'ZX490'], COSTAS)), { ok: true, moved: 2, to: ['ZX 480', 'ZX 482', 'ZX 490'] })
  assert.deepEqual([flight(d, 'ZX480').free.Economy, flight(d, 'ZX482').free.Economy, flight(d, 'ZX490').free.Economy], [1, 1, 0])
  rejects(onto(['ZX480', 'ZX482', 'ZX490', 'ZX492'], [SOFIA]), 'A connection has 1 to 3 flights')
  rejects(onto([], [SOFIA]), 'A connection has 1 to 3 flights')
})

test('rebookConnection: every flight needs enough seats in each cabin; all or nothing', () => {
  rejects(onto(['ZX450', 'ZX460'], DABROWSKIS), 'Only 3 economy seats left on ZX 460')
  rejects(onto(['ZX450', 'ZX460'], LUNDS), 'No business seats left on ZX 460')
  rejects(onto(['ZX486', 'ZX488']), 'No economy seats left on ZX 486')
  rejects(onto(['ZX486', 'ZX488'], ['h7c2nv']), 'No business seats left on ZX 488')
  rejects(onto(['ZX448'], [SOFIA]), 'No economy seats left on ZX 448')
  // All or nothing: Sofia would fit on ZX 446, Greta would not, so Sofia stays too.
  rejects(onto(['ZX446'], [SOFIA, 'h7c2nv']), 'No business seats left on ZX 446')
})

test('rebookConnection: the connection follows the rules of find connections', () => {
  rejects(onto(['ZX402']), 'ZX 402 does not depart after ZX 440')
  rejects(onto(['ZX454', 'ZX460']), 'ZX 454 does not depart from FRA')
  rejects(onto(['ZX449']), 'ZX 449 departs after the rebooking window for ZX 440, which ends 2026-11-11 23:59', startDataWith('ZX449', '2026-11-12T10:00', '2026-11-12T12:45'))
  rejects(onto(['ZX450', 'ZX472']), 'ZX 472 does not depart from LHR, where ZX 450 arrives')
  rejects(onto(['ZX450', 'ZX460']), 'ZX 460 departs LHR less than 90 minutes after ZX 450 arrives', startDataWith('ZX460', '2026-11-09T14:00'))
  rejects(onto(['ZX450', 'ZX464']), 'ZX 464 departs LHR more than 12 hours after ZX 450 arrives')
  rejects(onto(['ZX450']), 'The connection ends at LHR, not JFK')
  const loop = add(add(startData(), 'ZX 900', 'LHR', 'FRA', '2026-11-09T14:30', '2026-11-09T17:00'), 'ZX 902', 'FRA', 'JFK', '2026-11-09T19:00', '2026-11-09T21:45')
  rejects(onto(['ZX450', 'ZX900', 'ZX902']), 'The connection passes FRA twice', loop)
})

test('rebookConnection: its flights must exist and be scheduled', () => {
  rejects(onto('ZX450'), 'toFlightIds must be a list of flight IDs')
  rejects(onto(undefined), 'toFlightIds must be a list of flight IDs')
  rejects(onto(['ZX450', 'ZX999']), 'Flight ZX999 does not exist')
  rejects(onto(['ZX444']), 'ZX 444 is not scheduled')
  rejects(onto(['ZX440']), 'ZX 440 is not scheduled')
})

test('rebookConnection: the cancelled flight and the passengers are checked first', () => {
  rejects(undefined, 'A flight ID is required')
  rejects(onto(['ZX470', 'ZX472'], WEISS, 'ZX 999'), 'Flight ZX 999 does not exist')
  rejects(onto(['ZX470', 'ZX472'], WEISS, 'ZX446'), 'ZX 446 is not cancelled')
  rejects(onto(['ZX470', 'ZX472'], []), 'Select at least one passenger')
  rejects(onto(['ZX470', 'ZX472'], 'h7c2nv'), 'passengerIds must be a list of passenger IDs')
  rejects(onto(['ZX470', 'ZX472'], [SOFIA, SOFIA]), `Passenger ${SOFIA} is listed twice`)
  rejects(onto(['ZX470', 'ZX472'], [SOFIA, HUGO]), `Passenger ${HUGO} is not booked on ZX 440`)
  rejects(onto([], [HUGO]), `Passenger ${HUGO} is not booked on ZX 440`)
  // Booked on ZX 440 and something else: not hers to rebook off ZX 440 (flightIds must be exactly ['ZX440']).
  const d = startData()
  d.passengers.find(p => p.id === SOFIA)!.flightIds = ['ZX440', 'ZX446']
  rejects(onto(['ZX470', 'ZX472'], [SOFIA]), `Passenger ${SOFIA} is not booked on ZX 440`, d)
})

test('rebookConnection: a passenger already rebooked is rejected and uses no seat; part 1 rebooking sets flightIds to [target]', () => {
  const d = startData()
  assert.ok(rules.rebookConnection(d, onto(['ZX470', 'ZX472'])).ok)
  rejects(onto(['ZX470', 'ZX472'], ['h7c2nv']), 'Passenger h7c2nv is not booked on ZX 440', d)
  assert.deepEqual(rules.rebook(d, { fromFlightId: 'ZX440', toFlightId: 'ZX449', passengerIds: ['h7c2nv'] }), { ok: false, error: 'Passenger h7c2nv is not booked on ZX 440' })
  assert.deepEqual(rules.rebook(d, { fromFlightId: 'ZX440', toFlightId: 'ZX449', passengerIds: [SOFIA] }), { ok: true, moved: 1, to: 'ZX 449' })
  assert.deepEqual(on(d, SOFIA), ['ZX449'])
})
