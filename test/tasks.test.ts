import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rules, startData, type DeskData } from '../bench/desk.ts'
import { diff, tasks } from '../bench/tasks.ts'

function move(d: DeskData, names: string[], to: string) {
  const passengerIds = names.map(n => d.passengers.find(p => p.name === n)!.id)
  const r = rules.rebook(d, { fromFlightId: 'ZX400', toFlightId: to, passengerIds })
  assert.ok(r.ok, r.ok ? '' : r.error)
}

test('diff: no differences for equal data; paths name flights and passengers by id', () => {
  const a = startData(), b = startData()
  assert.deepEqual(diff(a, b), [])
  b.flights.find(f => f.id === 'ZX402')!.free.Economy = 0
  const lea = b.passengers.pop()!
  assert.deepEqual(diff(a, b), [
    'flights[ZX402].free.Economy: expected 2, got 0',
    `passengers[${lea.id}]: expected ${JSON.stringify(lea)}, got undefined`,
  ])
})

test('diff: a passenger listed twice is a difference, even when every id matches', () => {
  const twice = startData()
  twice.passengers.push(structuredClone(twice.passengers[0]))
  assert.deepEqual(diff(startData(), twice), [`passengers[${twice.passengers[0].id}]: listed 2 times in got`])
  assert.equal(tasks.t1.grade('ANSWER: 3; ZX 406', twice).pass, false)
})

test('t1: the last ANSWER line counts (whitespace, case and emphasis aside), and the data must be unchanged', () => {
  assert.ok(tasks.t1.grade('Three fly business.\nANSWER: 3; ZX 406', startData()).pass)
  assert.ok(tasks.t1.grade('**answer: 3;zx406**', startData()).pass)
  assert.ok(tasks.t1.grade('ANSWER: 2; ZX 406\nCorrection:\nANSWER: 3; ZX 406', startData()).pass)
  assert.deepEqual(tasks.t1.grade('ANSWER: 3; ZX 402', startData()), { pass: false, differences: ['answer: expected "3; ZX 406", got "3; ZX 402"'] })
  assert.deepEqual(tasks.t1.grade('Three, ZX 406', startData()), { pass: false, differences: ['answer: expected "3; ZX 406", got null'] })
  const changed = startData()
  move(changed, ['Anna Novak'], 'ZX402')
  assert.equal(tasks.t1.grade('ANSWER: 3; ZX 406', changed).pass, false)
})

test('t2: Anna on ZX 402 with one economy seat fewer there, nothing else', () => {
  const d = startData()
  move(d, ['Anna Novak'], 'ZX402')
  assert.deepEqual(tasks.t2.grade('', d), { pass: true, differences: [] })
  const wrong = startData()
  move(wrong, ['Anna Novak'], 'ZX404')
  assert.equal(tasks.t2.grade('', wrong).pass, false)
  assert.equal(tasks.t2.grade('', startData()).pass, false)
})

const GROUPS: [string[], string][] = [
  [['Jan Horvat', 'Maja Horvat', 'Luka Horvat'], 'ZX404'],
  [['Elena Rossi', 'Marco Rossi'], 'ZX406'],
  [['Anna Novak'], 'ZX402'],
  [['Tom Berger'], 'ZX402'],
  [['Sara Lind'], 'ZX402'],
]
function* orders<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) { yield items; return }
  for (const [i, x] of items.entries()) for (const rest of orders(items.filter((_, j) => j !== i))) yield [x, ...rest]
}

test('t3: each group on the earliest flight that fits it passes in every one of the 120 orders', () => {
  let n = 0
  for (const order of orders(GROUPS)) {
    const d = startData()
    for (const [names, to] of order) move(d, names, to)
    assert.deepEqual(tasks.t3.grade('', d), { pass: true, differences: [] })
    n++
  }
  assert.equal(n, 120)
})

test('t3: a split family fails', () => {
  const d = startData()
  move(d, ['Jan Horvat', 'Maja Horvat'], 'ZX402')
  move(d, ['Luka Horvat'], 'ZX404')
  move(d, ['Elena Rossi', 'Marco Rossi'], 'ZX406')
  move(d, ['Sara Lind'], 'ZX402')
  assert.equal(tasks.t3.grade('', d).pass, false)
})
