// Model-free checks of the app and the bridge. The UI path drives the app exactly as the UI-only agent can.
// npm run smoke
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { serve } from './serve.ts'
import { openSession, outcomeText, type Session } from './browser.ts'
import { find, inRow, parseSnapshot } from './snapshot.ts'
import { tasks } from './tasks.ts'

const { server, url } = await serve()
const APP = `${url}/app/index.html`
let lastSnapshot = ''

function ui(s: Session) {
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const r = await s.run(name, input)
    const text = outcomeText(r.content)
    if (r.isError) throw new Error(`${name} failed: ${text}`)
    return text
  }
  const nodes = async () => parseSnapshot(lastSnapshot = await call('take_snapshot'))
  const click = (uid: string) => call('click', { uid })
  const waitFor = (text: string) => call('wait_for', { text: [text] })
  return {
    nodes,
    async openFlight(number: string) {
      // UI5 names a table cell's link with its column: "Flight ZX 400".
      await click(find(await nodes(), 'link', `Flight ${number}`).uid)
      await waitFor('Passengers')
    },
    /** With `refused`, Confirm on that flight first: the rules' error shows, and picking `target` clears it. */
    async rebook(names: string[], target: string, refused?: { target: string; error: string }) {
      for (const name of names) await click(inRow(await nodes(), name, 'checkbox').uid)
      await click(find(await nodes(), 'button', /^Rebook/).uid)
      await waitFor('Flights the rules allow')
      if (refused) {
        await click(inRow(await nodes(), refused.target, 'radio').uid)
        await click(find(await nodes(), 'button', 'Confirm').uid)
        await waitFor(refused.error)
      }
      await click(inRow(await nodes(), target, 'radio').uid)
      if (refused) {
        await sleep(300) // the dialog re-renders
        assert.ok(!(await nodes()).some(n => n.name.includes(refused.error)), `"${refused.error}" still shows after picking ${target}`)
      }
      await click(find(await nodes(), 'button', 'Confirm').uid)
      await waitFor(`to ${target}`)
      await sleep(600) // the dialog's close animation
    },
  }
}

async function uiPath() {
  for (const task of ['t2', 't3'] as const) {
    const s = await openSession(APP, 'ui')
    try {
      assert.equal(s.pageTools.length, 0)
      assert.equal(await s.evaluate("() => 'modelContext' in document"), false)
      // The full version (154.0.8037.98), not the reduced user agent's 154.0.0.0.
      assert.match(s.versions.chrome, /^\d+\.\d+\.[1-9]\d*\.\d+$/)
      // A tool the model was not given is an error result, not a crash.
      const excluded = await s.run('evaluate_script', { function: '() => 1' })
      assert.deepEqual(excluded, { content: [{ type: 'text', text: 'Unknown tool evaluate_script' }], isError: true })
      // No tool writes files: filePath is neither offered nor accepted.
      assert.deepEqual(s.tools.filter(t => 'filePath' in ((t.input_schema.properties ?? {}) as object)).map(t => t.name), [])
      assert.equal((await s.run('take_screenshot', { filePath: '/tmp/arf-smoke.png' })).isError, true)
      if (task === 't2') {
        // A wait longer than the MCP SDK's 60 s default is the model's choice: under the run's deadline it ends as the
        // tool's own error result, not as an exception (which the agent loop would count as a harness defect).
        const waited = await s.run('wait_for', { text: ['never shown'], timeout: 61_000 }, AbortSignal.timeout(120_000))
        assert.equal(waited.isError, true, outcomeText(waited.content))
      }
      const app = ui(s)
      await app.openFlight('ZX 400')
      const unnamed = (await app.nodes()).filter(n => ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'].includes(n.role) && !n.name)
      if (unnamed.length) console.warn(`warning: controls without an accessible name: ${unnamed.map(n => `${n.role} ${n.uid}`).join(', ')}`)
      if (task === 't2') await app.rebook(['Anna Novak'], 'ZX 402')
      else {
        await app.rebook(['Jan Horvat', 'Maja Horvat', 'Luka Horvat'], 'ZX 404')
        await app.rebook(['Elena Rossi', 'Marco Rossi'], 'ZX 406', { target: 'ZX 402', error: 'Only 1 business seat left on ZX 402' })
        await app.rebook(['Anna Novak', 'Tom Berger', 'Sara Lind'], 'ZX 402')
      }
      const g = tasks[task].grade('', await s.appData())
      assert.ok(g.pass, `${task} through the UI: ${g.differences.join('; ')}`)
      console.log(`ok - the UI path completes ${task}`)
    } finally {
      await s.close()
    }
  }
}

// WebMCP on: exactly the 4 page tools; each read tool answers; a rejected rebooking changes nothing and is an error
// result; a good one goes through and the screen follows. ?webmcp=0: no tools. All calls go through the agent's bridge.
async function webmcpChecks() {
  const s = await openSession(APP, 'webmcp')
  try {
    assert.deepEqual(s.pageTools.map(t => t.name).sort(), ['get_flight', 'list_alternatives', 'rebook_passengers', 'search_flights'])
    assert.equal(s.tools.length, 14)
    // A page tool's output as JSON; a rejected action must come back flagged as an error, a good one must not.
    const json = async (name: string, input: unknown, error = false) => {
      const r = await s.run(name, input)
      assert.equal(r.isError, error, outcomeText(r.content))
      return JSON.parse(outcomeText(r.content))
    }
    assert.equal((await json('search_flights', { from: 'FRA', to: 'JFK' })).flights.length, 4)
    const zx400 = await json('get_flight', { flightId: 'ZX 400' })
    assert.equal(zx400.passengers.length, 8)
    assert.deepEqual((await json('list_alternatives', { flightId: 'ZX400' })).flights.map((f: { id: string }) => f.id), ['ZX402', 'ZX404', 'ZX406'])

    const before = await s.appData()
    const rossis = zx400.passengers.filter((p: { booking: string }) => p.booking === 'RS2M9D').map((p: { id: string }) => p.id)
    assert.deepEqual(await json('rebook_passengers', { fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: rossis }, true),
      { ok: false, error: 'Only 1 business seat left on ZX 402' })
    assert.deepEqual(await json('rebook_passengers', { fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: 'q7d2ax' }, true),
      { ok: false, error: 'passengerIds must be a list of passenger IDs' })
    assert.deepEqual(await json('rebook_passengers', {}, true), { ok: false, error: 'A flight ID is required' })
    assert.deepEqual(await s.appData(), before)

    const anna = zx400.passengers.find((p: { name: string }) => p.name === 'Anna Novak').id
    assert.deepEqual(await json('rebook_passengers', { fromFlightId: 'ZX400', toFlightId: 'ZX402', passengerIds: [anna] }),
      { ok: true, moved: 1, to: 'ZX 402' })
    assert.ok(tasks.t2.grade('', await s.appData()).pass)
    // The screen follows the tools: ZX 400's detail is open and Anna has left its list.
    const names = (await ui(s).nodes()).map(n => n.name)
    assert.ok(names.some(n => n.includes('Tom Berger')))
    assert.ok(!names.some(n => n.includes('Anna Novak')))
    console.log('ok - the 4 page tools work through execute_webmcp_tool')
  } finally {
    await s.close()
  }
  const off = await openSession(`${APP}?webmcp=0`, 'webmcp')
  try {
    assert.equal(await off.evaluate("() => 'modelContext' in document"), true)
    assert.equal(off.pageTools.length, 0)
    console.log('ok - ?webmcp=0 exposes no tools')
  } finally {
    await off.close()
  }
}

try {
  await uiPath()
  await webmcpChecks()
  console.log('SMOKE OK')
} catch (e) {
  if (lastSnapshot) console.error('Last snapshot:\n' + lastSnapshot)
  throw e
} finally {
  server.close()
}
