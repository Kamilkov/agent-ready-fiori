// Model-free checks of the app and the bridge. The UI path drives the app exactly as the UI-only agent can.
// npm run smoke
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { serve } from './serve.ts'
import { openSession, outcomeText, type Session } from './browser.ts'
import { find, inRow, parseSnapshot, type SnapNode } from './snapshot.ts'
import { tasks } from './tasks.ts'
import type { DeskData } from './desk.ts'
import { allocate, byPriority, firstFit, groups, offered, sameOffer, type Group, type Offered } from './reference.ts'

const { server, url } = await serve()
const APP = `${url}/app/index.html`
let lastSnapshot = ''

// One flight line of a connection row on the Connections screen, as the screen shows it.
const FLIGHT_LINE = /^(ZX \d+) · [A-Z]{3} \S+ \S+ → [A-Z]{3} \S+ \S+ · free: (\d+) economy, (\d+) business$/
/** The rows of the "Connections the rules allow" grid, read from the snapshot alone; `label` is the row's flights cell. */
function connectionRows(nodes: SnapNode[]): (Offered & { label: string })[] {
  const grid = nodes.findIndex(n => n.role === 'grid' && n.name === 'Connections the rules allow')
  assert.ok(grid >= 0, 'no connections grid on screen')
  const below = (i: number) => { let j = i + 1; while (j < nodes.length && nodes[j].depth > nodes[i].depth) j++; return j }
  const rows: (Offered & { label: string })[] = []
  for (let i = grid + 1; i < below(grid); i++) {
    if (nodes[i].role !== 'row') continue
    const inside = nodes.slice(i, below(i))
    const flights = inside.filter(n => n.role === 'StaticText').map(n => FLIGHT_LINE.exec(n.name)).filter(m => m !== null)
    if (!flights.length) continue // the header row
    const cells = inside.filter(n => n.role === 'gridcell')
    rows.push({
      ids: flights.map(m => m[1].replace(' ', '')), free: flights.map(m => ({ Economy: Number(m[2]), Business: Number(m[3]) })),
      arrives: cells.at(-2)!.name.replace(' ', 'T'), changes: Number(cells.at(-1)!.name), label: cells[1].name,
    })
  }
  return rows
}

/** T5 through one interface: for each group by priority, the app's offer must equal the reference's (seats included),
 *  the first connection with room is chosen from the app's offer, and that choice must equal the reference's. After
 *  the first group the state must pass T4. */
async function t5Through(s: Session, offer: (from: string, g: Group) => Promise<Offered[]>, book: (from: string, g: Group, pick: Offered) => Promise<void>) {
  for (const g of groups(await s.appData() as DeskData, ['ZX440', 'ZX444']).sort(byPriority)) {
    const now = await s.appData() as DeskData
    const shown = await offer(g.from, g)
    assert.ok(sameOffer(shown, offered(now, g.from)), `${g.booking}: the app offers different connections or seats`)
    const pick = firstFit(shown, g.cabins)
    if (!pick) { assert.equal(g.booking, 'PD9X3K'); continue }
    assert.deepEqual(pick.ids, allocate(now, [g]).data.passengers.find(p => p.id === g.ids[0])!.flightIds, g.booking)
    await book(g.from, g, pick)
    if (g.booking === 'WN4R8C') assert.ok(tasks.t4.grade('', await s.appData()).pass, 'T4 after the first group')
  }
  const g = tasks.t5.grade('ANSWER: PD9X3K', await s.appData())
  assert.ok(g.pass, g.differences.join('; '))
}

function ui(s: Session) {
  let lastRows: (Offered & { label: string })[] = []
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
    click,
    waitFor,
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
    /** On a Connections screen: tick `names`, pick the connection whose row shows `row`, Rebook onto connection, wait for
     *  `done`. With `refused`, that connection first: the rules' error shows, and picking `row` clears it. */
    async rebookOnto(names: string[], row: string, done: string, refused?: { row: string; error: string }) {
      for (const name of names) await click(inRow(await nodes(), name, 'checkbox').uid)
      if (refused) {
        await click(inRow(await nodes(), refused.row, 'radio').uid)
        await click(find(await nodes(), 'button', 'Rebook onto connection').uid)
        await waitFor(refused.error)
      }
      await click(inRow(await nodes(), row, 'radio').uid)
      if (refused) {
        await sleep(300)
        assert.ok(!(await nodes()).some(n => n.name.includes(refused.error)), `"${refused.error}" still shows after picking ${row}`)
      }
      await click(find(await nodes(), 'button', 'Rebook onto connection').uid)
      await waitFor(done)
      await sleep(600) // the page transition
    },
    /** From wherever the desk is: back to the Flights list, open the cancelled flight, Find connections, and read the
     *  connections the screen shows. Nothing is reloaded (a reload would reset the data). */
    async connectionsShown(from: string) {
      const number = (await s.appData() as DeskData).flights.find(f => f.id === from)!.number
      for (let n = await nodes(); n.some(x => x.role === 'button' && /^Back to /.test(x.name)); n = await nodes()) {
        await click(find(n, 'button', /^Back to /).uid)
        await sleep(600) // the page transition
      }
      // wait_for also matches a page that is still sliding, and UI5 queues a navigation asked for during a slide: wait for
      // the page's own heading, then for the slide to end.
      const until = async (what: string, ok: (n: SnapNode[]) => boolean) => {
        for (let t = 0; ; t++) {
          const n = await nodes()
          if (ok(n)) return n
          assert.ok(t < 40, `timed out waiting for ${what}`)
          await sleep(250)
        }
      }
      await click(find(await nodes(), 'link', `Flight ${number}`).uid)
      await until(`Flight ${number}`, n => n.some(x => x.role === 'heading' && x.name === `Flight ${number}`) && n.some(x => x.role === 'button' && x.name === 'Find connections'))
      await sleep(600)
      await click(find(await nodes(), 'button', 'Find connections').uid)
      const shown = await until(`Connections for ${number}`, n => n.some(x => x.name === `Connections for ${number}`) && n.some(x => x.role === 'grid' && x.name === 'Connections the rules allow'))
      await sleep(600)
      return lastRows = connectionRows(shown)
    },
    /** On the Connections screen: tick the group's passengers, pick `pick`'s row, Rebook onto connection, and wait until
     *  the data shows the move and the cancelled flight's detail is back. */
    async bookShown(g: Group, pick: Offered) {
      const d = await s.appData() as DeskData
      for (const id of g.ids) await click(inRow(await nodes(), d.passengers.find(p => p.id === id)!.name, 'checkbox').uid)
      const row = lastRows.find(r => r.ids.join() === pick.ids.join())!
      await click(inRow(await nodes(), row.label, 'radio').uid)
      // What a UI-only agent sees in the click's own snapshot: the moved passengers must be gone at once, not only once
      // the Connections screen has slid out (else the agent may think the rebooking failed and try again).
      const names = g.ids.map(id => d.passengers.find(p => p.id === id)!.name)
      const after = parseSnapshot(lastSnapshot = await call('click', { uid: find(await nodes(), 'button', 'Rebook onto connection').uid, includeSnapshot: true }))
      assert.deepEqual(names.filter(name => after.some(n => n.name.includes(name))), [], `${g.booking}: still listed right after the rebooking`)
      const moved = async () => (await s.appData() as DeskData).passengers.filter(p => g.ids.includes(p.id)).every(p => p.flightIds.join() === pick.ids.join())
      for (let t = 0; !(await moved()); t++) {
        assert.ok(t < 40, `${g.booking}: not rebooked onto ${row.label}`)
        await sleep(250)
      }
      await waitFor('Passengers')
      await sleep(600) // the page transition
    },
  }
}

function warnUnnamed(nodes: SnapNode[]) {
  const unnamed = nodes.filter(n => ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'].includes(n.role) && !n.name)
  if (unnamed.length) console.warn(`warning: controls without an accessible name: ${unnamed.map(n => `${n.role} ${n.uid}`).join(', ')}`)
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
      warnUnnamed(await app.nodes())
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

// The Connections screen as the UI-only agent drives it: opened from ZX 440's detail, the cabin filter lists again, a
// refused rebooking shows the rules' error, a good one moves the Lunds onto both flights and ZX 440 shows who is left.
async function uiConnections() {
  const s = await openSession(APP, 'ui')
  try {
    const app = ui(s)
    const radios = async () => (await app.nodes()).filter(n => n.role === 'radio').length
    await app.openFlight('ZX 440')
    await app.click(find(await app.nodes(), 'button', 'Find connections').uid)
    await app.waitFor('Connections the rules allow')
    warnUnnamed(await app.nodes())
    assert.equal(await radios(), 11)
    await app.click(find(await app.nodes(), 'option', 'Business').uid)
    await sleep(300)
    assert.equal(await radios(), 6)
    await app.rebookOnto(['Henrik Lund', 'Ingrid Lund'], 'ZX 464', 'to ZX 456 → ZX 464', { row: 'ZX 462', error: 'Only 1 business seat left on ZX 462' })
    const d = await s.appData() as DeskData
    assert.deepEqual(d.passengers.filter(p => p.booking === 'LM2Q7H').map(p => p.flightIds), [['ZX456', 'ZX464'], ['ZX456', 'ZX464']])
    const names = (await app.nodes()).map(n => n.name)
    assert.ok(names.some(n => n.includes('Greta Weiss')) && !names.some(n => n.includes('Henrik Lund')), 'ZX 440 still lists the Lunds')
    console.log('ok - the UI path rebooks onto a connection')
  } finally {
    await s.close()
  }
}

// WebMCP on: exactly the 6 page tools; each read tool answers; a rejected rebooking changes nothing and is an error
// result; a good one goes through and the screen follows. ?webmcp=0: no tools. All calls go through the agent's bridge.
async function webmcpChecks() {
  const s = await openSession(APP, 'webmcp')
  try {
    assert.deepEqual(s.pageTools.map(t => t.name).sort(),
      ['find_connections', 'get_flight', 'list_alternatives', 'rebook_onto_connection', 'rebook_passengers', 'search_flights'])
    assert.equal(s.tools.length, 16)
    // A page tool's output as JSON; a rejected action must come back flagged as an error, a good one must not.
    const json = async (name: string, input: unknown, error = false) => {
      const r = await s.run(name, input)
      assert.equal(r.isError, error, outcomeText(r.content))
      return JSON.parse(outcomeText(r.content))
    }
    assert.equal((await json('search_flights', { from: 'FRA', to: 'JFK' })).flights.length, 8)
    const zx400 = await json('get_flight', { flightId: 'ZX 400' })
    assert.equal(zx400.passengers.length, 8)
    assert.deepEqual((await json('list_alternatives', { flightId: 'ZX400' })).flights.map((f: { id: string }) => f.id),
      ['ZX402', 'ZX404', 'ZX406', 'ZX446', 'ZX448', 'ZX449'])

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
    console.log('ok - the 4 part 1 page tools work through execute_webmcp_tool')

    // Connections: find_connections lists them and opens the screen; a rejected rebooking onto one changes nothing; a
    // good one books the group on every flight of it, and ZX 440's detail shows who is left.
    const zx440 = await json('get_flight', { flightId: 'ZX 440' })
    const group = (booking: string) => zx440.passengers.filter((p: { booking: string }) => p.booking === booking).map((p: { id: string }) => p.id)
    const legs = (r: { connections: { flights: { id: string }[] }[] }) => r.connections.map(c => c.flights.map(f => f.id).join('+'))
    const all = await json('find_connections', { flightId: 'ZX440' })
    assert.equal(all.connections.length, 11)
    assert.deepEqual(legs(all).slice(0, 2), ['ZX450+ZX460', 'ZX470+ZX472'])
    assert.deepEqual(legs(await json('find_connections', { flightId: 'zx 440', cabin: 'Business' })),
      ['ZX470+ZX472', 'ZX494+ZX490', 'ZX480+ZX482+ZX490', 'ZX450+ZX462', 'ZX456+ZX464', 'ZX449'])
    assert.ok((await ui(s).nodes()).some(n => n.name === 'Connections the rules allow'), 'find_connections did not open the Connections screen')
    assert.deepEqual(await json('find_connections', { flightId: 'ZX446' }, true), { ok: false, error: 'ZX 446 is not cancelled' })

    const unconnected = await s.appData()
    const dabrowskis = group('PD9X3K')
    assert.deepEqual(await json('rebook_onto_connection', { fromFlightId: 'ZX440', toFlightIds: ['ZX450', 'ZX460'], passengerIds: dabrowskis }, true),
      { ok: false, error: 'Only 3 economy seats left on ZX 460' })
    assert.deepEqual(await json('rebook_onto_connection', { fromFlightId: 'ZX440', toFlightIds: ['ZX450', 'ZX472'], passengerIds: dabrowskis }, true),
      { ok: false, error: 'ZX 472 does not depart from LHR, where ZX 450 arrives' })
    assert.deepEqual(await json('rebook_onto_connection', { fromFlightId: 'ZX440', toFlightIds: 'ZX470', passengerIds: dabrowskis }, true),
      { ok: false, error: 'toFlightIds must be a list of flight IDs' })
    assert.deepEqual(await s.appData(), unconnected)

    assert.deepEqual(await json('rebook_onto_connection', { fromFlightId: 'ZX440', toFlightIds: ['ZX470', 'ZX472'], passengerIds: dabrowskis }),
      { ok: true, moved: 4, to: ['ZX 470', 'ZX 472'] })
    const d = await s.appData() as DeskData
    assert.deepEqual(d.passengers.filter(p => dabrowskis.includes(p.id)).map(p => p.flightIds.join('+')), Array(4).fill('ZX470+ZX472'))
    assert.deepEqual(d.flights.filter(f => ['ZX470', 'ZX472'].includes(f.id)).map(f => f.free), [{ Economy: 1, Business: 2 }, { Economy: 0, Business: 2 }])
    // A navigation asked for during a page transition (here: back to ZX 440 while the Connections screen slides in)
    // runs when that transition ends.
    await sleep(1000)
    const left = (await ui(s).nodes()).map(n => n.name)
    assert.ok(left.some(n => n.includes('Greta Weiss')))
    assert.ok(!left.some(n => n.includes('Piotr Dabrowski')))
    console.log('ok - find_connections and rebook_onto_connection work through execute_webmcp_tool')
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

// T4 and T5 through the screens, choosing only from what the Connections screen shows.
async function uiT5() {
  const s = await openSession(APP, 'ui')
  try {
    const app = ui(s)
    await t5Through(s, from => app.connectionsShown(from), (_from, g, pick) => app.bookShown(g, pick))
    console.log('ok - T4 and T5 complete through the screens, choosing from what they show')
  } finally {
    await s.close()
  }
}

// T4 and T5 through the connection tools, choosing only from what find_connections returns.
async function webmcpT5() {
  const s = await openSession(APP, 'webmcp')
  try {
    const json = async (name: string, input: unknown) => {
      const r = await s.run(name, input)
      assert.equal(r.isError, false, outcomeText(r.content))
      return JSON.parse(outcomeText(r.content))
    }
    type Shown = { flights: { id: string; free: { Economy: number; Business: number } }[]; arrives: string; changes: number }
    await t5Through(s,
      async from => ((await json('find_connections', { flightId: from })).connections as Shown[]).map(c => ({
        ids: c.flights.map(f => f.id), free: c.flights.map(f => ({ Economy: f.free.Economy, Business: f.free.Business })), arrives: c.arrives, changes: c.changes,
      })),
      async (from, g, pick) => { await json('rebook_onto_connection', { fromFlightId: from, toFlightIds: pick.ids, passengerIds: g.ids }) })
    console.log('ok - T4 and T5 complete through the connection tools, choosing from what they return')
  } finally {
    await s.close()
  }
}

try {
  await uiPath()
  await uiConnections()
  await uiT5()
  await webmcpChecks()
  await webmcpT5()
  console.log('SMOKE OK')
} catch (e) {
  if (lastSnapshot) console.error('Last snapshot:\n' + lastSnapshot)
  throw e
} finally {
  server.close()
}
