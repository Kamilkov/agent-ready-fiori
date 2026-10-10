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
        dialog: { title: '', targets: [], target: '', error: '' }
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
    data() { return this.model.getProperty('/data') },

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
      this.byId('nav').to(this.byId('detailPage'))
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

    // One rebooking, from Confirm or from rebook_passengers. On success the source flight's detail shows who is left.
    rebook(input) {
      const r = rules.rebook(this.data(), input)
      if (!r.ok) return r
      this.model.refresh(true)
      this.onFilter()
      this.openFlight(input.fromFlightId)
      MessageToast.show(`Rebooked ${r.moved} passenger${r.moved === 1 ? '' : 's'} to ${r.to}`)
      return r
    }
  })
})
