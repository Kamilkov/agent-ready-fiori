// The desk's rules: search, flight details, rebooking alternatives and the rebooking itself. The screens and the
// WebMCP tools both call these, so both run the same checks. No UI5 dependencies, so tests load it in Node.
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

  function getFlight(d, flightId) {
    const flight = find(d, flightId)
    if (!flight) return missing(flightId)
    return { ok: true, flight, passengers: d.passengers.filter(p => p.flightId === flight.id) }
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

  // Every check runs before anything changes, so a rejected rebooking changes nothing.
  function rebook(d, input) {
    const { fromFlightId, toFlightId, passengerIds } = input ?? {}
    const source = find(d, fromFlightId), target = find(d, toFlightId)
    if (!source) return missing(fromFlightId)
    if (!target) return missing(toFlightId)
    if (source.status !== 'Cancelled') return fail(`${source.number} is not cancelled`)
    if (!Array.isArray(passengerIds) || passengerIds.some(id => typeof id !== 'string')) return fail('passengerIds must be a list of passenger IDs')
    if (!passengerIds.length) return fail('Select at least one passenger')
    const twice = passengerIds.find((id, i) => passengerIds.indexOf(id) !== i)
    if (twice) return fail(`Passenger ${twice} is listed twice`)
    const moving = []
    for (const id of passengerIds) {
      const p = d.passengers.find(x => x.id === id && x.flightId === source.id)
      if (!p) return fail(`Passenger ${id} is not booked on ${source.number}`)
      moving.push(p)
    }
    if (target.from !== source.from || target.to !== source.to) return fail(`${target.number} does not fly ${source.from}→${source.to}`)
    if (target.status !== 'Scheduled') return fail(`${target.number} is not scheduled`)
    if (target.departs <= source.departs) return fail(`${target.number} does not depart after ${source.number}`)
    for (const c of CABINS) {
      const need = moving.filter(p => p.cabin === c).length, free = target.free[c]
      if (need > free) {
        const cabin = c.toLowerCase()
        return fail(free ? `Only ${free} ${cabin} seat${free === 1 ? '' : 's'} left on ${target.number}` : `No ${cabin} seats left on ${target.number}`)
      }
    }
    for (const p of moving) { p.flightId = target.id; target.free[p.cabin]-- }
    return { ok: true, moved: moving.length, to: target.number }
  }

  return { searchFlights, getFlight, alternatives, rebook }
})
