import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addReplacement, makeSchedule, nextSlot, reconcile, spent, type AttemptRecord, type Slot, type Status } from '../bench/schedule.ts'

const ALL = { tasks: ['t1', 't2', 't3'] as const, modes: ['ui', 'webmcp'] as const, models: ['opus', 'haiku'] as const }
const make = (seed: number, runs: number) => makeSchedule({ seed, runs, tasks: [...ALL.tasks], modes: [...ALL.modes], models: [...ALL.models] })
const rec = (slot: Slot, status: Status, n = 0): AttemptRecord =>
  ({ id: `a${slot.pos}-${n}`, pos: slot.pos, dir: `d${slot.pos}`, task: slot.task, mode: slot.mode, model: slot.model, status, reason: null, replaces: slot.replaces, costUsd: 0.5, unresolvedUsd: 0 })
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`)

test('the order is fixed by the seed and every cell appears runs times', () => {
  const a = make(7, 5)
  assert.deepEqual(a, make(7, 5))
  assert.notDeepEqual(a.slots, make(8, 5).slots)
  assert.equal(a.slots.length, 60)
  assert.deepEqual(a.slots.map(s => s.pos), [...Array(60).keys()])
  const counts = new Map<string, number>()
  for (const s of a.slots) counts.set(`${s.task} ${s.mode} ${s.model}`, (counts.get(`${s.task} ${s.mode} ${s.model}`) ?? 0) + 1)
  assert.equal(counts.size, 12)
  assert.ok([...counts.values()].every(n => n === 5))
})

test('nextSlot: finished slots are skipped; a slot whose attempt hit a harness error or was interrupted runs again', () => {
  const s = make(1, 1)
  s.attempts.push(rec(s.slots[0], 'pass'), rec(s.slots[1], 'fail'), rec(s.slots[2], 'harness_error'), rec(s.slots[2], 'interrupted', 1))
  assert.equal(nextSlot(s)?.pos, 2)
  s.attempts.push(rec(s.slots[2], 'pass', 2))
  assert.equal(nextSlot(s)?.pos, 3)
  for (const slot of s.slots.slice(3)) s.attempts.push(rec(slot, 'pass'))
  assert.equal(nextSlot(s), undefined)
  assert.equal(spent(s), 0.5 * 14)
})

test('reconcile: a finished trace keeps its verdict, an unfinished one is interrupted, and only that slot runs again', async () => {
  const s = make(1, 1)
  s.attempts.push(rec(s.slots[0], 'running'), rec(s.slots[1], 'running'), rec(s.slots[2], 'fail'))
  const changed = await reconcile(s, async a => (a.pos === 0
    ? { status: 'pass', reason: null, costUsd: 0.4, unresolvedUsd: 0 }
    : { status: 'interrupted', reason: 'the process ended during the attempt', costUsd: 0.25, unresolvedUsd: 0.5 }))
  assert.deepEqual(changed.map(a => [a.pos, a.status]), [[0, 'pass'], [1, 'interrupted']])
  assert.equal(nextSlot(s)?.pos, 1)
  close(spent(s), 0.4 + 0.25 + 0.5 + 0.5)
  assert.deepEqual(await reconcile(s, async () => { throw new Error('nothing is left running') }), [])
})

test('a transient attempt gets a replacement at the end; a cell gets at most two', () => {
  const s = make(1, 1)
  const cell = s.slots[0]
  const first = rec(cell, 'transient')
  s.attempts.push(first)
  const r1 = addReplacement(s, first)
  assert.deepEqual(r1, { pos: 12, task: cell.task, mode: cell.mode, model: cell.model, replaces: first.id })
  const second = rec(r1!, 'transient')
  s.attempts.push(second)
  const r2 = addReplacement(s, second)
  assert.equal(r2?.pos, 13)
  const third = rec(r2!, 'transient')
  s.attempts.push(third)
  assert.equal(addReplacement(s, third), null)
  assert.equal(s.slots.length, 14)
})
