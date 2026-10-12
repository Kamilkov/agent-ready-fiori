// The desk's rules: search, flight details, rebooking alternatives and connections, and the rebookings themselves. The
// screens and the WebMCP tools both call these, so both run the same checks. No UI5 dependencies, so tests load it in Node.
sap.ui.define([], () => {
  'use strict'
  const CABINS = ['Economy', 'Business']
  const STATUSES = ['Scheduled', 'Cancelled']
  const text = v => String(v ?? '').trim()
  // "ZX 402", "zx402" and "ZX402" are the same flight.
  const flightKey = v => text(v).replace(/\s+/g, '').toUpperCase()
  const oneOf = (list, v) => list.find(x => x.toLowerCase() === text(v).toLowerCase())
  const fail = error => ({ ok: false, error })
  const missing = id => fail(text(id) ? `Flight ${text(id)} does not exist` : 'A flight ID is required')
  const byDeparture = (a, b) => a.departs.localeCompare(b.departs)
  const find = (d, id) => d.flights.find(f => f.id === flightKey(id))
  // Local times as minutes. Every time is local to its airport; there is no time zone arithmetic.
  const minutes = t => Date.parse(`${t}Z`) / 60000

  function searchFlights(d, input) {
    const i = input ?? {}
    const filters = {
      from: text(i.from).toUpperCase(),
      to: text(i.to).toUpperCase(),
      date: text(i.date),
      status: oneOf(STATUSES, i.status) ?? text(i.status)
    }
    const flights = d.flights.filter(f =>
      (!filters.from || f.from === filters.from) && (!filters.to || f.to === filters.to) &&
      (!filters.date || f.departs.slice(0, 10) === filters.date) && (!filters.status || f.status === filters.status))
    return { ok: true, filters, flights: flights.sort(byDeparture) }
  }

  // A passenger is on every flight in their flightIds.
  function getFlight(d, flightId) {
    const flight = find(d, flightId)
    if (!flight) return missing(flightId)
    return { ok: true, flight, passengers: d.passengers.filter(p => p.flightIds.includes(flight.id)) }
  }

  // The flights a cancelled flight's passengers may move to: same route, scheduled, departing later.
  const allowed = (d, source) => d.flights
    .filter(f => f.from === source.from && f.to === source.to && f.status === 'Scheduled' && f.departs > source.departs)
    .sort(byDeparture)

  function alternatives(d, flightId, cabin) {
    const source = find(d, flightId)
    if (!source) return missing(flightId)
    if (source.status !== 'Cancelled') return fail(`${source.number} is not cancelled`)
    if (!text(cabin)) return { ok: true, flights: allowed(d, source) }
    const c = oneOf(CABINS, cabin)
    if (!c) return fail('Cabin must be Economy or Business')
    return { ok: true, flights: allowed(d, source).filter(f => f.free[c] > 0) }
  }

  // The passengers to move off a cancelled flight: each listed once and booked on that flight alone.
  function leaving(d, source, passengerIds) {
    if (!Array.isArray(passengerIds) || passengerIds.some(id => typeof id !== 'string')) return fail('passengerIds must be a list of passenger IDs')
    if (!passengerIds.length) return fail('Select at least one passenger')
    const twice = passengerIds.find((id, i) => passengerIds.indexOf(id) !== i)
    if (twice) return fail(`Passenger ${twice} is listed twice`)
    const moving = []
    for (const id of passengerIds) {
      const p = d.passengers.find(x => x.id === id && x.flightIds.length === 1 && x.flightIds[0] === source.id)
      if (!p) return fail(`Passenger ${id} is not booked on ${source.number}`)
      moving.push(p)
    }
    return { ok: true, moving }
  }

  // Why a flight has too few seats for these passengers in their cabins, or ''.
  function short(f, moving) {
    for (const c of CABINS) {
      const need = moving.filter(p => p.cabin === c).length, free = f.free[c], cabin = c.toLowerCase()
      if (need > free) return free ? `Only ${free} ${cabin} seat${free === 1 ? '' : 's'} left on ${f.number}` : `No ${cabin} seats left on ${f.number}`
    }
    return ''
  }

  function move(moving, flights) {
    for (const p of moving) {
      p.flightIds = flights.map(f => f.id)
      for (const f of flights) f.free[p.cabin]--
    }
  }

  // Every check runs before anything changes, so a rejected rebooking changes nothing.
  function rebook(d, input) {
    const { fromFlightId, toFlightId, passengerIds } = input ?? {}
    const source = find(d, fromFlightId), target = find(d, toFlightId)
    if (!source) return missing(fromFlightId)
    if (!target) return missing(toFlightId)
    if (source.status !== 'Cancelled') return fail(`${source.number} is not cancelled`)
    const m = leaving(d, source, passengerIds)
    if (!m.ok) return m
    if (target.from !== source.from || target.to !== source.to) return fail(`${target.number} does not fly ${source.from}→${source.to}`)
    if (target.status !== 'Scheduled') return fail(`${target.number} is not scheduled`)
    if (target.departs <= source.departs) return fail(`${target.number} does not depart after ${source.number}`)
    const why = short(target, m.moving)
    if (why) return fail(why)
    move(m.moving, [target])
    return { ok: true, moved: m.moving.length, to: target.number }
  }

  // Why flights in this order cannot be, or begin, a connection for the cancelled flight, or ''. The first flight leaves
  // its departure airport after it, by the end of the second day after its date; each next one leaves where the one
  // before arrives, 90 minutes to 12 hours later; no airport twice. Whether it ends at the right airport is not checked.
  function chainError(source, flights) {
    const first = flights[0]
    const lastDay = new Date(Date.parse(source.departs.slice(0, 10)) + 2 * 86400000).toISOString().slice(0, 10)
    if (first.from !== source.from) return `${first.number} does not depart from ${source.from}`
    if (first.departs <= source.departs) return `${first.number} does not depart after ${source.number}`
    if (first.departs.slice(0, 10) > lastDay) return `${first.number} departs after the rebooking window for ${source.number}, which ends ${lastDay} 23:59`
    for (let i = 1; i < flights.length; i++) {
      const prev = flights[i - 1], next = flights[i], wait = minutes(next.departs) - minutes(prev.arrives)
      if (next.from !== prev.to) return `${next.number} does not depart from ${prev.to}, where ${prev.number} arrives`
      if (wait < 90) return `${next.number} departs ${prev.to} less than 90 minutes after ${prev.number} arrives`
      if (wait > 720) return `${next.number} departs ${prev.to} more than 12 hours after ${prev.number} arrives`
    }
    const airports = [first.from, ...flights.map(f => f.to)]
    const twice = airports.find((a, i) => airports.indexOf(a) !== i)
    return twice ? `The connection passes ${twice} twice` : ''
  }

  // Every connection of 1 to 3 scheduled flights with a free seat (in the cabin, if given), by arrival, then changes.
  function connections(d, flightId, cabin) {
    const source = find(d, flightId)
    if (!source) return missing(flightId)
    if (source.status !== 'Cancelled') return fail(`${source.number} is not cancelled`)
    const c = text(cabin) ? oneOf(CABINS, cabin) : ''
    if (c === undefined) return fail('Cabin must be Economy or Business')
    const usable = d.flights.filter(f => f.status === 'Scheduled' && (c ? [c] : CABINS).some(k => f.free[k] > 0))
    const found = []
    const extend = chain => {
      for (const f of usable) {
        const next = [...chain, f]
        if (chainError(source, next)) continue
        if (f.to === source.to) found.push({ flights: next, arrives: f.arrives, changes: chain.length })
        else if (next.length < 3) extend(next)
      }
    }
    extend([])
    const key = x => x.flights.map(f => f.id).join()
    found.sort((a, b) => a.arrives.localeCompare(b.arrives) || a.changes - b.changes || key(a).localeCompare(key(b)))
    return { ok: true, cabin: c, connections: found }
  }

  // Moves passengers of a cancelled flight onto 1 to 3 flights at once. As in rebook, nothing changes unless all is well.
  function rebookConnection(d, input) {
    const { fromFlightId, toFlightIds, passengerIds } = input ?? {}
    const source = find(d, fromFlightId)
    if (!source) return missing(fromFlightId)
    if (source.status !== 'Cancelled') return fail(`${source.number} is not cancelled`)
    const m = leaving(d, source, passengerIds)
    if (!m.ok) return m
    if (!Array.isArray(toFlightIds) || toFlightIds.some(id => typeof id !== 'string')) return fail('toFlightIds must be a list of flight IDs')
    if (toFlightIds.length < 1 || toFlightIds.length > 3) return fail('A connection has 1 to 3 flights')
    const flights = []
    for (const id of toFlightIds) {
      const f = find(d, id)
      if (!f) return missing(id)
      if (f.status !== 'Scheduled') return fail(`${f.number} is not scheduled`)
      flights.push(f)
    }
    const end = flights.at(-1).to
    const why = chainError(source, flights) || (end === source.to ? '' : `The connection ends at ${end}, not ${source.to}`) ||
      flights.map(f => short(f, m.moving)).find(Boolean)
    if (why) return fail(why)
    move(m.moving, flights)
    return { ok: true, moved: m.moving.length, to: flights.map(f => f.number) }
  }

  return { searchFlights, getFlight, alternatives, rebook, connections, rebookConnection }
})
