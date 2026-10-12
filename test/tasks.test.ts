import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { rules, startData, type DeskData } from '../bench/desk.ts'
import { diff, T4_END, T5_END, tasks } from '../bench/tasks.ts'

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

const sealed = readFileSync(new URL('../docs/scenario-2/tasks.md', import.meta.url), 'utf8')
/** A prompt as the sealed doc quotes it: paragraphs joined by a blank line, list items on their own lines. */
function quoted(label: string) {
  const lines = sealed.slice(sealed.indexOf(`**${label}**`)).split('\n').slice(1)
  const start = lines.findIndex(l => l.startsWith('>'))
  const end = lines.findIndex((l, i) => i > start && !l.startsWith('>'))
  return lines.slice(start, end).map(l => l.replace(/^> ?/, '')).join('\n').split(/\n\s*\n/)
    .map(block => block.split('\n').reduce((s, l) => (/^\d+\. /.test(l) ? s + (s ? '\n' : '') + l : s + (s ? ' ' : '') + l.trim()), ''))
    .join('\n\n')
}
const clone = (d: DeskData) => structuredClone(d)
const group = (d: DeskData, booking: string) => d.passengers.filter(p => p.booking === booking)

test('t4, t5: the prompts are the sealed wording, and both have the longer limits', () => {
  assert.equal(tasks.t4.prompt, quoted('T4'))
  assert.equal(tasks.t5.prompt, quoted('T5'))
  for (const t of [tasks.t4, tasks.t5]) assert.deepEqual(t.limits, { turns: 120, ms: 30 * 60_000 })
})

test('t4: the expected end state passes 1/1; the start data and a split group fail', () => {
  assert.deepEqual(tasks.t4.grade('', T4_END), { pass: true, differences: [], groups: { right: 1, total: 1 } })
  const none = tasks.t4.grade('', startData())
  assert.equal(none.pass, false)
  assert.deepEqual(none.groups, { right: 0, total: 1 })
  const split = clone(T4_END)
  const [greta, paul] = group(split, 'WN4R8C')
  greta.flightIds = ['ZX450', 'ZX460']
  assert.deepEqual(tasks.t4.grade('', split).groups, { right: 0, total: 1 })
  assert.ok(tasks.t4.grade('', split).differences.includes(`passengers[${greta.id}].flightIds: expected ["ZX470","ZX472"], got ["ZX450","ZX460"]`))
  assert.ok(paul)
})

test('t5: the expected end state with the right ANSWER passes 8/8, whatever the formatting', () => {
  for (const text of ['Done.\nANSWER: PD9X3K', '**answer: pd9x3k**', 'ANSWER: NONE\nCorrection:\nANSWER: `PD9X3K`'])
    assert.deepEqual(tasks.t5.grade(text, T5_END), { pass: true, differences: [], groups: { right: 8, total: 8 } }, text)
})

test('t5: a wrong ANSWER fails even with the right bookings; groups still count 8/8', () => {
  for (const [text, got] of [['ANSWER: NONE', '"NONE"'], ['ANSWER: PD9X3K, SV5J1N', '"PD9X3K, SV5J1N"'], ['ANSWER: PD9X3K,,,', '"PD9X3K,,,"'],
    ['ANSWER: PD9X3K.', '"PD9X3K."'], ['PD9X3K stays.', 'null']]) {
    const g = tasks.t5.grade(text, T5_END)
    assert.equal(g.pass, false, text)
    assert.equal(g.differences[0], `answer: expected "PD9X3K", got ${got}`)
    assert.deepEqual(g.groups, { right: 8, total: 8 })
  }
})

test('t5: splitting the group that fits nowhere fails, and only that group is wrong', () => {
  const split = clone(T5_END)
  const [piotr] = group(split, 'PD9X3K')
  piotr.flightIds = ['ZX446']
  split.flights.find(f => f.id === 'ZX446')!.free.Economy = 0
  const g = tasks.t5.grade('ANSWER: PD9X3K', split)
  assert.equal(g.pass, false)
  assert.deepEqual(g.groups, { right: 7, total: 8 })
})

test('t5: data that is not desk data fails with 0/8', () => {
  assert.deepEqual(tasks.t5.grade('ANSWER: PD9X3K', null).groups, { right: 0, total: 8 })
  assert.equal(tasks.t5.grade('ANSWER: PD9X3K', null).pass, false)
})

test('t5 trap, same arrival: the connection with more changes fails, naming the group and the seats', () => {
  const wrong = clone(T5_END)
  for (const p of group(wrong, 'LM2Q7H')) p.flightIds = ['ZX480', 'ZX482', 'ZX490']
  const free = (id: string) => wrong.flights.find(f => f.id === id)!.free
  free('ZX494').Business += 2
  free('ZX480').Business -= 2
  free('ZX482').Business -= 2
  const g = tasks.t5.grade('ANSWER: PD9X3K', wrong)
  assert.equal(g.pass, false)
  assert.deepEqual(g.groups, { right: 7, total: 8 })
  assert.ok(g.differences.includes('passengers[e8w3ks].flightIds: expected ["ZX494","ZX490"], got ["ZX480","ZX482","ZX490"]'))
  assert.ok(g.differences.includes('flights[ZX480].free.Business: expected 2, got 0'))
})
