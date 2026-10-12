// The Disruption desk: one JSON model. Screen handlers and the WebMCP tools act through the same methods and rules.
sap.ui.define([
  'sap/ui/core/mvc/Controller', 'sap/ui/model/json/JSONModel', 'sap/m/MessageToast', './model/data', './model/rebook', './webmcp'
], (Controller, JSONModel, MessageToast, data, rules, webmcp) => {
  'use strict'
  const clone = v => JSON.parse(JSON.stringify(v))
  const any = { key: '', text: 'Any' }

  return Controller.extend('desk.Main', {
    onInit() {
      const start = clone(data)
      const airports = [...new Set(start.flights.flatMap(f => [f.from, f.to]))].sort()
      this.model = new JSONModel({
        data: start,
        filters: { from: '', to: '', date: '', status: '' },
        airports: [any, ...airports.map(a => ({ key: a, text: a }))],
        statuses: [any, { key: 'Scheduled', text: 'Scheduled' }, { key: 'Cancelled', text: 'Cancelled' }],
        rows: [], selected: null, selection: [],
        dialog: { title: '', targets: [], target: '', error: '' },
        connect: { flight: null, cabin: '', list: [], passengers: [], selection: [], chosen: [], error: '' }
      })
      this.getView().setModel(this.model)
      this.onFilter()
      // The page's WebMCP tools. The benchmark waits for deskData, so it is set once the tools are registered.
      // deskData is never offered to the agent.
      webmcp.register(this)
        .catch(e => console.error('WebMCP tools were not registered', e))
        .finally(() => { window.deskData = () => clone(this.model.getProperty('/data')) })
    },

    when: departs => (departs ? departs.replace('T', ' ') : ''),
    // A passenger's flights in order, by number: "ZX 450 → ZX 460".
    flightNumbers(ids) { return (ids ?? []).map(id => this.data().flights.find(f => f.id === id)?.number ?? id).join(' → ') },
    data() { return this.model.getProperty('/data') },
    // Goes to a page, or back to it when it is the page before (a flight's detail, from its connections).
    show(id) {
      const nav = this.byId('nav'), page = this.byId(id)
      if (nav.getCurrentPage() === page) return
      if (nav.getPreviousPage() === page) nav.back()
      else nav.to(page)
    },

    // Flights screen. search_flights sets the same filters.
    onFilter() {
      const r = rules.searchFlights(this.data(), this.model.getProperty('/filters'))
      this.model.setProperty('/rows', r.flights)
      return r
    },
    showFlights(input) {
      const r = rules.searchFlights(this.data(), input)
      this.model.setProperty('/filters', r.filters)
      this.model.setProperty('/rows', r.flights)
      this.byId('nav').to(this.byId('flightsPage'))
      return r
    },

    // Flight detail. get_flight opens it the same way.
    onOpenFlight(e) { this.openFlight(e.getSource().getBindingContext().getProperty('id')) },
    openFlight(flightId) {
      const r = rules.getFlight(this.data(), flightId)
      if (!r.ok) return r
      this.model.setProperty('/selected', r)
      this.model.setProperty('/selection', [])
      this.byId('passengerTable').removeSelections(true)
      this.show('detailPage')
      return r
    },
    onBack() { this.byId('nav').back() },
    onPassengerSelect() {
      this.model.setProperty('/selection', this.byId('passengerTable').getSelectedContexts().map(c => c.getProperty('id')))
    },

    // Rebook dialog: the flights the rules allow. Confirm rebooks the selected passengers.
    onOpenRebook() {
      const r = rules.alternatives(this.data(), this.model.getProperty('/selected/flight/id'))
      const n = this.model.getProperty('/selection').length
      this.model.setProperty('/dialog', {
        title: `Rebook ${n} passenger${n === 1 ? '' : 's'}`, targets: r.ok ? r.flights : [], target: '', error: r.ok ? '' : r.error
      })
      this.byId('targetTable').removeSelections(true)
      this.byId('rebookDialog').open()
    },
    onTargetSelect(e) {
      this.model.setProperty('/dialog/target', e.getParameter('listItem').getBindingContext().getProperty('id'))
      this.model.setProperty('/dialog/error', '') // a refused Confirm's error belongs to the flight picked before
    },
    onConfirmRebook() {
      const r = this.rebook({
        fromFlightId: this.model.getProperty('/selected/flight/id'),
        toFlightId: this.model.getProperty('/dialog/target'),
        passengerIds: this.model.getProperty('/selection')
      })
      if (r.ok) this.byId('rebookDialog').close()
      else this.model.setProperty('/dialog/error', r.error)
    },
    onCancelRebook() { this.byId('rebookDialog').close() },

    // One rebooking, from Confirm or from rebook_passengers.
    rebook(input) {
      const r = rules.rebook(this.data(), input)
      if (r.ok) this.rebooked(input.fromFlightId, r.moved, r.to)
      return r
    },
    // After any rebooking the cancelled flight's detail shows who is left.
    rebooked(fromFlightId, moved, to) {
      this.model.refresh(true)
      this.onFilter()
      this.openFlight(fromFlightId)
      MessageToast.show(`Rebooked ${moved} passenger${moved === 1 ? '' : 's'} to ${to}`)
    },

    // Connections screen, from a cancelled flight's detail; the cabin filter lists again. find_connections does both.
    onFindConnections() { this.showConnections({ flightId: this.model.getProperty('/selected/flight/id') }) },
    onCabinChange(e) {
      const key = e.getParameter('item').getKey()
      this.showConnections({ flightId: this.model.getProperty('/connect/flight/id'), cabin: key === 'Any' ? '' : key })
    },
    showConnections(input) {
      const r = rules.connections(this.data(), input?.flightId, input?.cabin)
      if (!r.ok) return r
      const { flight, passengers } = rules.getFlight(this.data(), input.flightId)
      // Listing again on the open screen keeps the ticked passengers; opening it starts afresh.
      if (this.byId('nav').getCurrentPage() !== this.byId('connectionsPage') || this.model.getProperty('/connect/flight/id') !== flight.id) {
        this.model.setProperty('/connect/flight', flight)
        this.model.setProperty('/connect/passengers', passengers)
        this.model.setProperty('/connect/selection', [])
        this.byId('connectPassengerTable').removeSelections(true)
      }
      this.model.setProperty('/connect/cabin', r.cabin)
      this.model.setProperty('/connect/list', r.connections)
      this.model.setProperty('/connect/chosen', [])
      this.model.setProperty('/connect/error', '')
      this.byId('connectionTable').removeSelections(true)
      this.show('connectionsPage')
      return r
    },
    onConnectPassengerSelect() {
      this.model.setProperty('/connect/selection', this.byId('connectPassengerTable').getSelectedContexts().map(c => c.getProperty('id')))
      this.model.setProperty('/connect/error', '')
    },
    onConnectionSelect(e) {
      this.model.setProperty('/connect/chosen', e.getParameter('listItem').getBindingContext().getProperty('flights').map(f => f.id))
      this.model.setProperty('/connect/error', '')
    },
    onRebookConnection() {
      const c = this.model.getProperty('/connect')
      const r = this.rebookConnection({ fromFlightId: c.flight.id, toFlightIds: c.chosen, passengerIds: c.selection })
      if (!r.ok) this.model.setProperty('/connect/error', r.error)
    },
    // One rebooking onto a connection, from the Connections screen or from rebook_onto_connection.
    rebookConnection(input) {
      const r = rules.rebookConnection(this.data(), input)
      if (!r.ok) return r
      // A Connections screen showing this flight drops the moved passengers and shows the new seats at once, not only
      // after it has slid out: an agent reading it mid-slide must not think the rebooking failed.
      const { flight, passengers } = rules.getFlight(this.data(), input.fromFlightId)
      if (this.model.getProperty('/connect/flight/id') === flight.id) {
        const list = rules.connections(this.data(), flight.id, this.model.getProperty('/connect/cabin'))
        this.model.setProperty('/connect/passengers', passengers)
        if (list.ok) this.model.setProperty('/connect/list', list.connections)
        this.model.setProperty('/connect/selection', [])
        this.model.setProperty('/connect/chosen', [])
        this.byId('connectPassengerTable').removeSelections(true)
        this.byId('connectionTable').removeSelections(true)
      }
      this.rebooked(input.fromFlightId, r.moved, r.to.join(' → '))
      return r
    }
  })
})
