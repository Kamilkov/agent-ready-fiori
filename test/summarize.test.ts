import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeSchedule, type Status } from '../bench/schedule.ts'
import { groupsOf, pickReplay, stat, summarizeCells, type Attempt } from '../bench/summarize.ts'
import type { TaskId } from '../bench/tasks.ts'

const totals = (turns: number, cost = 1) => ({
  turns, toolCalls: {}, toolErrors: 0, tokens: { input: 100, cacheRead: 300, cacheWrite: 100, output: 10 }, costUsd: cost, unresolvedUsd: 0, ms: turns * 1000,
})
const schedule = makeSchedule({ seed: 1, runs: 4, tasks: ['t2'], modes: ['ui'], models: ['haiku'] })
const attempt = (pos: number, status: Status, turns: number, cost = 1): Attempt => ({
  id: `a${pos}`, pos, dir: `d${pos}`, task: 't2', mode: 'ui', model: 'haiku', status, reason: status === 'fail' ? 'turn_limit' : null,
  costUsd: cost, totals: totals(turns, cost), startedAt: '2026-10-10T10:00:00Z', versions: {}, models: ['claude-haiku-5-5'], cacheReadOnFirstRequest: 0,
  overReserved: false, unresolvedUsd: 0, grade: null,
})

test('stat: median of an odd and an even count', () => {
  assert.deepEqual(stat([5, 1, 3]), { median: 3, min: 1, max: 5 })
  assert.deepEqual(stat([4, 1, 3, 2]), { median: 2.5, min: 1, max: 4 })
})

test('pickReplay: the lower median by turns, so an even count still picks an actual run; ties go to the earlier run', () => {
  assert.equal(pickReplay([attempt(0, 'pass', 9), attempt(1, 'pass', 3), attempt(2, 'pass', 7), attempt(3, 'pass', 5)])?.pos, 3)
  // Turns 5, 5, 9: the median is 5, and of the two 5-turn runs the earlier one (position 1) is replayed.
  assert.equal(pickReplay([attempt(2, 'pass', 5), attempt(1, 'pass', 5), attempt(0, 'pass', 9)])?.pos, 1)
  assert.equal(pickReplay([attempt(4, 'pass', 6), attempt(3, 'pass', 6), attempt(1, 'pass', 2), attempt(0, 'pass', 6)])?.pos, 0)
  assert.equal(pickReplay([]), undefined)
})

test('no successes: stats null, spend per success N/A (null), a failed run is replayed and labelled', () => {
  const [cell] = summarizeCells(schedule, [attempt(0, 'fail', 60), attempt(1, 'fail', 40), attempt(2, 'transient', 3, 0.25)])
  assert.equal(cell.counted, 2)
  assert.equal(cell.successes, 0)
  assert.equal(cell.stats, null)
  assert.equal(cell.spendUsd, 2.25)
  assert.equal(cell.spendPerSuccessUsd, null)
  assert.deepEqual(cell.replay, { dir: 'd1', failed: true })
})

test('spend is billed cost; reservations for requests without an answer are shown apart', () => {
  const lost = { ...attempt(1, 'transient', 2, 0.25), unresolvedUsd: 0.75 }
  const [cell] = summarizeCells(schedule, [attempt(0, 'pass', 10, 2), lost])
  assert.equal(cell.spendUsd, 2.25)
  assert.equal(cell.unresolvedUsd, 0.75)
  assert.equal(cell.spendPerSuccessUsd, 2.25)
})

test('stats cover successful runs only; spend covers every attempt; cache read share is shown', () => {
  const [cell] = summarizeCells(schedule, [attempt(0, 'pass', 10, 2), attempt(1, 'pass', 20, 4), attempt(2, 'fail', 60, 9), attempt(3, 'harness_error', 1, 0.5)])
  assert.equal(cell.counted, 3)
  assert.equal(cell.successes, 2)
  assert.deepEqual(cell.stats?.turns, { median: 15, min: 10, max: 20 })
  assert.deepEqual(cell.stats?.costUsd, { median: 3, min: 2, max: 4 })
  assert.equal(cell.spendUsd, 15.5)
  assert.equal(cell.spendPerSuccessUsd, 7.75)
  assert.equal(cell.cacheReadShare, 0.6)
  assert.deepEqual(cell.replay, { dir: 'd0', failed: false })
})

// T4 and T5 are not TaskIds until part B; the summary keys cells by name, so a cast is enough here.
const t5 = 't5' as TaskId
const t5Schedule = makeSchedule({ seed: 1, runs: 5, tasks: [t5], modes: ['ui'], models: ['haiku'] })
const g = (right: number) => ({ pass: right === 8, differences: [], groups: { right, total: 8 } })

test('groups: every counted attempt counts, failures included; transient ones do not; ungraded shown apart', () => {
  const [cell] = summarizeCells(t5Schedule, [
    { ...attempt(0, 'pass', 9), task: t5, grade: g(8) }, { ...attempt(1, 'fail', 9), task: t5, grade: g(5) },
    { ...attempt(2, 'fail', 60), task: t5, grade: null }, { ...attempt(3, 'transient', 2), task: t5, grade: g(1) },
  ])
  assert.deepEqual(cell.groups, { scores: [8, 5, null], right: 13, total: 16, ungraded: 1 })
})

test('groups: five ungraded T5 failures still give the figure, as five missing grades', () => {
  const fails = [0, 1, 2, 3, 4].map(i => ({ ...attempt(i, 'fail', 120), task: t5, grade: null }))
  assert.deepEqual(summarizeCells(t5Schedule, fails)[0].groups, { scores: [null, null, null, null, null], right: 0, total: 0, ungraded: 5 })
})

test('groups: null for a task without the figure, whatever its grades say', () => {
  assert.equal(summarizeCells(schedule, [{ ...attempt(0, 'pass', 9), grade: g(8) }])[0].groups, null)
  assert.deepEqual(groupsOf([]), { scores: [], right: 0, total: 0, ungraded: 0 })
})
