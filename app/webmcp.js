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
      description: 'Lists flights sorted by departure, optionally filtered by departure airport, arrival airport, departure date and status. Shows the result on the Flights screen. Each flight has id, number, from, to, departs (local time), status and free seats per cabin.',
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
      description: "Opens a flight's detail screen and returns the flight with its free seats per cabin and the passengers booked on it (id, name, booking reference, cabin).",
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
