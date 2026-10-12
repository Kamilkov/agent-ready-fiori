import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Session } from '../bench/browser.ts'
import { LIMITS } from '../bench/agent.ts'
import { apiClient, checkConfig, limitsFor, lockSet, PAGE_TOOLS, recover } from '../bench/run.ts'
import type { AttemptRecord } from '../bench/schedule.ts'
import { tasks } from '../bench/tasks.ts'

const session = (mode: string, launchArgs = [`--${mode}`], chrome = '154.0.8037.98', pageTools = mode === 'webmcp' ? PAGE_TOOLS : []) =>
  ({ tools: [{ name: `tool-${mode}` }], pageTools: pageTools.map(name => ({ name })), versions: { chrome, chromeDevtoolsMcp: '1.10.1' }, launchArgs }) as unknown as Session

test('checkConfig: WebMCP mode needs exactly the 4 page tools and UI mode none, before anything is frozen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'set-'))
  // WebMCP gone after a Chrome update, or a failed registration: the webmcp column would measure UI-only runs.
  await assert.rejects(checkConfig(dir, 'webmcp', 'haiku', session('webmcp', undefined, undefined, []), 'code-A'), new RegExp(`webmcp mode has page tools \\[\\], not \\[${PAGE_TOOLS[0]}`))
  await assert.rejects(checkConfig(dir, 'ui', 'haiku', session('ui', undefined, undefined, ['search_flights']), 'code-A'), /ui mode has page tools \[search_flights\], not \[\]/)
  await assert.rejects(readFile(join(dir, 'config', 'set.json')))
})

test('lockSet: one process per set; the lock of a process that has ended is taken over', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'set-'))
  const release = await lockSet(dir)
  await assert.rejects(lockSet(dir), new RegExp(`in use by process ${process.pid}`))
  await release()
  await (await lockSet(dir))()
  await writeFile(join(dir, 'lock'), String(spawnSync(process.execPath, ['-e', '']).pid))
  await (await lockSet(dir))()
})

test('apiClient: the key goes to api.anthropic.com alone, whatever the environment says', () => {
  const keep = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS'].map(k => [k, process.env[k]] as const)
  try {
    Object.assign(process.env, { ANTHROPIC_BASE_URL: 'https://proxy.example.test', ANTHROPIC_AUTH_TOKEN: 'another-credential' })
    const client = apiClient('sk-test')
    assert.equal(client.baseURL, 'https://api.anthropic.com')
    assert.equal(client.authToken, null)
    assert.equal(client.maxRetries, 0)
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'X-Extra: 1'
    assert.throws(() => apiClient('sk-test'), /ANTHROPIC_CUSTOM_HEADERS/)
  } finally {
    for (const [k, v] of keep) if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
})

test('checkConfig: the code fingerprint is frozen once per set, whichever mode × model comes first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'set-'))
  await checkConfig(dir, 'ui', 'haiku', session('ui'), 'code-A')
  await checkConfig(dir, 'ui', 'haiku', session('ui'), 'code-A')
  // The first WebMCP attempt brings another revision: refused, although its own mode file does not exist yet.
  await assert.rejects(checkConfig(dir, 'webmcp', 'haiku', session('webmcp'), 'code-B'), /set\.json differs from this attempt in: code\b/)
  await checkConfig(dir, 'webmcp', 'haiku', session('webmcp'), 'code-A')
  await assert.rejects(checkConfig(dir, 'webmcp', 'haiku', session('webmcp', ['--other']), 'code-A'), /webmcp-haiku\.json differs from this attempt in: launchArgs/)
  // A Chrome patch update is a different browser: the set does not resume on it.
  await assert.rejects(checkConfig(dir, 'ui', 'haiku', session('ui', undefined, '154.0.8037.99'), 'code-A'), /set\.json differs from this attempt in: versions\b/)
})

test('recover: a trace that finished keeps its verdict and cost; an unfinished one becomes interrupted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'set-'))
  const write = async (name: string, trace: object) => {
    await mkdir(join(dir, 'attempts', name), { recursive: true })
    await writeFile(join(dir, 'attempts', name, 'trace.json'), JSON.stringify(trace))
  }
  const totals = { costUsd: 0.4, unresolvedUsd: 0.1 }
  await write('done', { outcome: { status: 'pass', reason: null }, totals })
  await write('cut', { outcome: { status: 'running', reason: null }, totals })
  const a = (dir: string) => ({ dir }) as AttemptRecord
  const cut = { status: 'interrupted', reason: 'the process ended during the attempt' }
  assert.deepEqual(await recover(dir, a('done')), { status: 'pass', reason: null, costUsd: 0.4, unresolvedUsd: 0.1 })
  assert.deepEqual(await recover(dir, a('cut')), { ...cut, costUsd: 0.4, unresolvedUsd: 0.1 })
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'attempts', 'cut', 'trace.json'), 'utf8')).outcome, cut)
  assert.deepEqual(await recover(dir, a('missing')), { ...cut, costUsd: 0, unresolvedUsd: 0 })
})

test('limits: a task without its own uses the default; set.json freezes every task\'s limits', async () => {
  assert.deepEqual(limitsFor('t1'), LIMITS)
  const dir = await mkdtemp(join(tmpdir(), 'set-'))
  await checkConfig(dir, 'ui', 'haiku', session('ui'), 'code-A')
  const set = JSON.parse(await readFile(join(dir, 'config', 'set.json'), 'utf8'))
  assert.deepEqual(Object.keys(set.limits), Object.keys(tasks))
  assert.deepEqual(set.limits.t1, LIMITS)
})

test('PAGE_TOOLS: part 1\'s 4 tools and the connection tools, sorted', () => {
  assert.deepEqual(PAGE_TOOLS, [...PAGE_TOOLS].sort())
  for (const t of ['get_flight', 'list_alternatives', 'rebook_passengers', 'search_flights']) assert.ok(PAGE_TOOLS.includes(t), t)
  assert.ok(PAGE_TOOLS.length > 4)
})
