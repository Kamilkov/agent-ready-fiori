// The scenario 2 documents committed after the build are the ones sealed before it (bench/scenario-2.sha256).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
test('docs/scenario-2 matches the seal, line by line', () => {
  const lines = readFileSync(new URL('bench/scenario-2.sha256', root), 'utf8').trim().split('\n')
  assert.ok(lines.length >= 2)
  for (const line of lines) {
    const [hash, path] = line.split(/\s+/)
    assert.equal(createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex'), hash, path)
  }
})
