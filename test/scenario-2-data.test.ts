// Scenario 2's data as the sealed app spec gives it (docs/scenario-2/app-spec.md §3.2–3.4) against the app's own
// start data, so a seat count or a time typed in differently fails here, not halfway through a batch.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { startData } from '../bench/desk.ts'

const spec = readFileSync(new URL('../docs/scenario-2/app-spec.md', import.meta.url), 'utf8')
/** The body rows of the first table after `heading`, as trimmed cells. */
function table(heading: string): string[][] {
  const at = spec.indexOf(heading)
  assert.ok(at >= 0, `no "${heading}" in the app spec`)
  const lines = spec.slice(at).split('\n')
  const start = lines.findIndex(l => l.startsWith('|'))
  const end = lines.findIndex((l, i) => i > start && !l.startsWith('|'))
  return lines.slice(start + 2, end).map(l => l.split('|').slice(1, -1).map(c => c.trim()))
}
const d = startData()
const flight = (number: string) => d.flights.find(f => f.number === number)

test('part 1 flights have the arrival times of §3.2', () => {
  const rows = table('### 3.2')
  assert.equal(rows.length, 12)
  for (const [number, arrives] of rows) assert.equal(flight(number)?.arrives, arrives, number)
})

test('the new flights are exactly §3.3', () => {
  const rows = table('### 3.3')
  assert.equal(rows.length, 22)
  for (const [number, from, to, departs, arrives, economy, business, status] of rows) {
    const f = flight(number)
    assert.ok(f, `${number} is missing`)
    assert.deepEqual({ id: f.id, from: f.from, to: f.to, departs: f.departs, arrives: f.arrives, status: f.status, free: f.free },
      { id: number.replace(' ', ''), from, to, departs, arrives, status, free: { Economy: Number(economy), Business: Number(business) } }, number)
  }
  assert.equal(d.flights.length, 12 + 22)
})

test('the new passengers are exactly §3.4', () => {
  const rows = table('### 3.4')
  assert.equal(rows.length, 18)
  for (const [id, name, booking, cabin, flights] of rows) {
    const p = d.passengers.find(x => x.id === id)
    assert.ok(p, `${id} is missing`)
    assert.deepEqual({ name: p.name, booking: p.booking, cabin: p.cabin, flightIds: p.flightIds }, { name, booking, cabin, flightIds: [flights] }, id)
  }
  assert.equal(d.passengers.length, 10 + 18)
})
