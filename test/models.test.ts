import assert from 'node:assert/strict'
import { test } from 'node:test'
import { costUsd, tokensAtMost, worstCaseUsd } from '../bench/models.ts'

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`)
const usage = (input: number, read: number, write: number, output: number) =>
  ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: output })

test('opus: input $4, cache write $5, cache read $0.20, output $20 per million tokens', () => {
  close(costUsd('opus', usage(1e6, 0, 0, 0)), 4)
  close(costUsd('opus', usage(0, 1e6, 1e6, 1e6)), 0.2 + 5 + 20)
})

test('haiku: a prompt over 100,000 tokens, cache reads and writes included, pays the higher prices', () => {
  close(costUsd('haiku', usage(1_000, 99_000, 0, 1_000)), (1_000 * 0.1 + 99_000 * 0.01 + 1_000 * 0.5) / 1e6)
  close(costUsd('haiku', usage(1_000, 98_000, 1_001, 1_000)), (1_000 * 0.5 + 98_000 * 0.05 + 1_001 * 0.625 + 1_000 * 2.5) / 1e6)
})

test('worst case: the prompt plus 2,000 framing tokens at the cache-write price, plus max_tokens; Haiku at its higher tier', () => {
  close(worstCaseUsd('opus', 998_000, 0), 5)
  close(worstCaseUsd('opus', 0, 1e6), (2_000 * 5 + 1e6 * 20) / 1e6)
  close(worstCaseUsd('haiku', 998_000, 1e6), 0.625 + 2.5)
  // Never below the billed cost, whatever the mix of cache reads and writes.
  const u = usage(5_000, 80_000, 15_000, 16_000)
  assert.ok(worstCaseUsd('haiku', 100_000, 16_000) > costUsd('haiku', u))
  assert.ok(worstCaseUsd('opus', 100_000, 16_000) > costUsd('opus', u))
})

test('tokensAtMost: UTF-8 bytes of the JSON, and a fixed count per image whatever its size', () => {
  assert.equal(tokensAtMost('äb'), 5) // "äb" in JSON is 5 bytes
  const image = (data: string) => [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }]
  assert.equal(tokensAtMost(image('x')), tokensAtMost(image('x'.repeat(100_000))))
  assert.equal(tokensAtMost(image('x')), Buffer.byteLength('[null]') + 5_000)
})
