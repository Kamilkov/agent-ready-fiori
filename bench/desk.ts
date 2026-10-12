// The app's data and rules, loaded into Node from its UI5 modules: one source for the app, the tests and the graders.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export type Cabin = 'Economy' | 'Business'
export interface Flight {
  id: string; number: string; from: string; to: string; departs: string; arrives: string
  status: 'Scheduled' | 'Cancelled'; free: Record<Cabin, number>
}
export interface Passenger { id: string; name: string; booking: string; cabin: Cabin; flightIds: string[] }
/** 1 to 3 flights in order; arrives is the last flight's arrival, changes the number of flights less one. */
export interface Connection { flights: Flight[]; arrives: string; changes: number }
export interface DeskData { flights: Flight[]; passengers: Passenger[] }
export interface Filters { from: string; to: string; date: string; status: string }
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string }
export interface Rules {
  searchFlights(d: DeskData, input?: unknown): Result<{ filters: Filters; flights: Flight[] }>
  getFlight(d: DeskData, flightId: unknown): Result<{ flight: Flight; passengers: Passenger[] }>
  alternatives(d: DeskData, flightId: unknown, cabin?: unknown): Result<{ flights: Flight[] }>
  rebook(d: DeskData, input: unknown): Result<{ moved: number; to: string }>
  connections(d: DeskData, flightId: unknown, cabin?: unknown): Result<{ cabin: Cabin | ''; connections: Connection[] }>
  rebookConnection(d: DeskData, input: unknown): Result<{ moved: number; to: string[] }>
}

const require = createRequire(import.meta.url)
// Runs a UI5 module's factory under a stubbed sap.ui.define. The app's model modules have no UI5 dependencies.
function ui5<T>(path: string): T {
  let mod: unknown
  Object.assign(globalThis, { sap: { ui: { define: (_deps: string[], factory: () => unknown) => { mod = factory() } } } })
  require(fileURLToPath(new URL(path, import.meta.url)))
  return mod as T
}

export const rules = ui5<Rules>('../app/model/rebook.js')
const start = ui5<DeskData>('../app/model/data.js')
/** A fresh copy of the app's start data. */
export const startData = (): DeskData => structuredClone(start)
