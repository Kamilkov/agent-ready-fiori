// The page's WebMCP tools. Each one is a UI action and runs through the same controller method and rules
// (desk = the Main controller). Registered only when the browser has WebMCP and the URL does not say ?webmcp=0.
sap.ui.define(['./model/rebook'], rules => {
  'use strict'
  const reply = r => JSON.stringify(r)
  const flightId = { type: 'string', description: 'Flight number, e.g. "ZX 402" or "ZX402"' }

  const tools = desk => [
    {
      name: 'search_flights',
      title: 'Search flights',
      description: 'Lists flights sorted by departure, optionally filtered by departure airport, arrival airport, departure date and status. Shows the result on the Flights screen. Each flight has id, number, from, to, departs and arrives (local times), status and free seats per cabin.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Departure airport code, e.g. "FRA"' },
          to: { type: 'string', description: 'Arrival airport code, e.g. "JFK"' },
          date: { type: 'string', description: 'Departure date, YYYY-MM-DD' },
          status: { type: 'string', enum: ['Scheduled', 'Cancelled'] }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      execute: async input => reply(desk.showFlights(input))
    },
    {
      name: 'get_flight',
      title: 'Open a flight',
      description: "Opens a flight's detail screen and returns the flight with its free seats per cabin and the passengers booked on it (id, name, booking reference, cabin, and flightIds: all the flights they are booked on, in order).",
      inputSchema: { type: 'object', properties: { flightId }, required: ['flightId'], additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async input => reply(desk.openFlight(input?.flightId))
    },
    {
      name: 'list_alternatives',
      title: 'List rebooking options',
      description: 'For a cancelled flight, lists the flights its passengers may be rebooked onto: same route, scheduled, departing later, with free seats per cabin. With a cabin, only flights that have a free seat in that cabin.',
      inputSchema: {
        type: 'object',
        properties: { flightId, cabin: { type: 'string', enum: ['Economy', 'Business'] } },
        required: ['flightId'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      execute: async input => reply(rules.alternatives(desk.data(), input?.flightId, input?.cabin))
    },
    {
      name: 'rebook_passengers',
      title: 'Rebook passengers',
      description: "Moves passengers of a cancelled flight onto another flight; each keeps their cabin. Every rule is checked first: if any check fails, nothing changes and the error says why. Afterwards the cancelled flight's detail screen shows the passengers still to rebook.",
      inputSchema: {
        type: 'object',
        properties: {
          fromFlightId: flightId,
          toFlightId: flightId,
          passengerIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Passenger ids from get_flight' }
        },
        required: ['fromFlightId', 'toFlightId', 'passengerIds'],
        additionalProperties: false
      },
      annotations: { consequentialHint: true },
      execute: async input => reply(desk.rebook(input ?? {}))
    },
    {
      name: 'find_connections',
      title: 'Find connections',
      description: "For a cancelled flight, lists every connection its passengers may be rebooked onto: 1 to 3 scheduled flights in order (a direct flight is a connection of one) from its departure airport to its arrival airport, the first leaving after it and by the end of the second day after its departure date, 90 minutes to 12 hours for each change, no airport twice, and a free seat on every flight. Sorted by arrival, then fewer changes. Each connection has its flights (id, number, from, to, departs, arrives, free seats per cabin; local times), arrives and changes. With a cabin, every flight has a free seat in that cabin. Whether a whole group fits is not checked: compare each flight's free seats with the group's cabins. Opens the flight's Connections screen.",
      inputSchema: {
        type: 'object',
        properties: { flightId, cabin: { type: 'string', enum: ['Economy', 'Business'] } },
        required: ['flightId'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      execute: async input => reply(desk.showConnections(input ?? {}))
    },
    {
      name: 'rebook_onto_connection',
      title: 'Rebook onto a connection',
      description: "Moves passengers of a cancelled flight onto a connection of 1 to 3 flights in one step, e.g. one from find_connections; each keeps their cabin and is booked on all of the connection's flights. Every rule is checked first, including enough free seats in each passenger's cabin on every flight: if any check fails, nothing changes and the error says why. Afterwards the cancelled flight's detail screen shows the passengers still to rebook.",
      inputSchema: {
        type: 'object',
        properties: {
          fromFlightId: flightId,
          toFlightIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: 'The connection\'s flights in order, e.g. ["ZX 450", "ZX 460"]' },
          passengerIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Passenger ids from get_flight' }
        },
        required: ['fromFlightId', 'toFlightIds', 'passengerIds'],
        additionalProperties: false
      },
      annotations: { consequentialHint: true },
      execute: async input => reply(desk.rebookConnection(input ?? {}))
    }
  ]

  async function register(desk) {
    if (!('modelContext' in document) || new URLSearchParams(location.search).get('webmcp') === '0') return 0
    const list = tools(desk)
    for (const tool of list) await document.modelContext.registerTool(tool)
    return list.length
  }

  return { register }
})
