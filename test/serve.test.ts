import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { serve } from '../bench/serve.ts'

test('serves only the public folders, inside the root', async () => {
  const base = await mkdtemp(join(tmpdir(), 'serve-'))
  const root = join(base, 'site')
  for (const [file, body] of [['site/app/a.js', 'app'], ['site/.env', 'SECRET=1'], ['site/package.json', '{}'], ['site-other/app/x.js', 'sibling']]) {
    await mkdir(join(base, file, '..'), { recursive: true })
    await writeFile(join(base, file), body)
  }
  const { server, url } = await serve(0, root)
  try {
    const get = async (path: string) => { const r = await fetch(url + path); return [r.status, r.status === 200 ? await r.text() : ''] }
    assert.deepEqual(await get('/app/a.js'), [200, 'app'])
    assert.deepEqual(await get('/.env'), [403, ''])
    assert.deepEqual(await get('/package.json'), [403, ''])
    // A sibling folder whose name starts with the root's name is outside the root.
    assert.deepEqual(await get('/..%2Fsite-other/app/x.js'), [403, ''])
    assert.deepEqual(await get('/app%2F..%2F.env'), [403, ''])
    assert.deepEqual(await get('/app/missing.js'), [404, ''])
    assert.deepEqual(await get('/'), [404, '']) // the root's index.html is allowed; this root has none
    assert.deepEqual(await get('/app/%E0%A4%A'), [400, ''])
  } finally {
    server.close()
  }
})
