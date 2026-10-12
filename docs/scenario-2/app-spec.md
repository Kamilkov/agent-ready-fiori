# Disruption desk, scenario 2: app spec (the builder's brief)

Status: draft for Kamil's review, 2026-10-12. This is the only document the builder receives.

## 1. What you are building and why

The Disruption desk (`app/`) is a freestyle UI5 1.136.8 app for an airline dispatcher. It is the subject of a
benchmark in which AI Agents do dispatcher work, either through the screens alone or with WebMCP tools that the page
registers. You extend the desk with **connection rebooking**: when no direct seats are left, passengers of a cancelled
flight are moved onto connections via other airports.

You decide how the new screens look and which WebMCP tools exist, with their names, inputs and descriptions. Design
them the way you would for a real dispatcher and a real Agent.

## 2. Fixed principles (as in the existing desk)

1. **One rules module.** The new rules go in `app/model/rebook.js` (or a sibling module with no UI5 dependencies),
   and both the screens and the tools call them, so both run the same checks. Tests load it in Node via
   `bench/desk.ts`.
2. **Each tool does exactly what one screen action does**: the same controller method, the same rules, the same
   result on screen. No tool may do something the screens cannot, and no screen action may be missing a tool.
3. **Tools never throw.** A rejected action returns `{ ok: false, error }` with a message saying why, as the screen
   shows it. (chrome-devtools-mcp drops the message of a thrown error.)
4. **Registration** with `document.modelContext.registerTool` in `app/webmcp.js`, alongside the 4 existing tools.
5. **Part 1 stays as it was.** The 4 existing tools (`search_flights`, `get_flight`, `list_alternatives`,
   `rebook_passengers`) and their screens keep their behaviour. The only change to them is the data shape in §3.
6. **`window.deskData`** keeps exposing the live data (flights and passengers) after every change.
7. Test-first (Node's built-in test runner, as in `test/`). `npm test`, `npx tsc --noEmit` and `npm run smoke` green.
   `bench/smoke.ts` checks the page's tools in a real Chrome: update its expected tool list and count, and add a check
   that each new tool works through `execute_webmcp_tool` (a rejected call changes nothing and comes back as an
   error result; a good one changes the data and the screen follows). No new dependencies. Fiori look, using UI5
   controls already in use where they fit.

## 3. Data

### 3.1 Shape changes

- Every flight gets `arrives`: local arrival date and time, `YYYY-MM-DDTHH:MM`, like `departs`. All times are local
  to their airport; there is no time zone arithmetic anywhere.
- Every passenger's `flightId` becomes `flightIds`: the flights they are booked on, in order. A direct flight is a
  list of one. Part 1's rebooking sets it to `[target]`. A passenger "is on" a flight when its id is in the list.
- `bench/desk.ts` types, `bench/tasks.ts` (T1–T3) and their tests follow the new shape; T1–T3's expected results do
  not change.

### 3.2 Arrival times for part 1's flights

| Flight | Arrives |
|---|---|
| ZX 400 | 2026-11-02T12:45 |
| ZX 402 | 2026-11-02T20:45 |
| ZX 404 | 2026-11-03T09:45 |
| ZX 406 | 2026-11-03T12:45 |
| ZX 401 | 2026-11-02T12:00 |
| ZX 403 | 2026-11-03T12:00 |
| ZX 410 | 2026-11-01T08:45 |
| ZX 412 | 2026-11-02T12:45 |
| ZX 418 | 2026-11-01T18:00 |
| ZX 420 | 2026-11-02T12:00 |
| ZX 422 | 2026-11-03T14:00 |
| ZX 424 | 2026-11-02T11:00 |

### 3.3 New flights (append to `flights`)

Free seats are Economy / Business.

| Flight | From | To | Departs | Arrives | Free E | Free B | Status |
|---|---|---|---|---|---|---|---|
| ZX 440 | FRA | JFK | 2026-11-09T10:00 | 2026-11-09T12:45 | 0 | 0 | Cancelled |
| ZX 444 | MUC | JFK | 2026-11-09T09:30 | 2026-11-09T12:30 | 0 | 0 | Cancelled |
| ZX 446 | FRA | JFK | 2026-11-09T18:00 | 2026-11-09T20:45 | 1 | 0 | Scheduled |
| ZX 448 | FRA | JFK | 2026-11-10T10:00 | 2026-11-10T12:45 | 0 | 0 | Scheduled |
| ZX 449 | FRA | JFK | 2026-11-11T10:00 | 2026-11-11T12:45 | 3 | 1 | Scheduled |
| ZX 445 | MUC | JFK | 2026-11-10T09:30 | 2026-11-10T12:30 | 0 | 1 | Scheduled |
| ZX 450 | FRA | LHR | 2026-11-09T12:00 | 2026-11-09T12:45 | 8 | 4 | Scheduled |
| ZX 456 | FRA | LHR | 2026-11-10T07:00 | 2026-11-10T07:45 | 6 | 2 | Scheduled |
| ZX 454 | MUC | LHR | 2026-11-09T11:00 | 2026-11-09T12:10 | 5 | 2 | Scheduled |
| ZX 460 | LHR | JFK | 2026-11-09T15:00 | 2026-11-09T17:55 | 3 | 0 | Scheduled |
| ZX 462 | LHR | JFK | 2026-11-09T19:00 | 2026-11-09T21:55 | 3 | 1 | Scheduled |
| ZX 464 | LHR | JFK | 2026-11-10T10:00 | 2026-11-10T12:55 | 3 | 2 | Scheduled |
| ZX 470 | FRA | AMS | 2026-11-09T13:00 | 2026-11-09T14:10 | 5 | 2 | Scheduled |
| ZX 474 | MUC | AMS | 2026-11-09T11:30 | 2026-11-09T13:05 | 4 | 2 | Scheduled |
| ZX 472 | AMS | JFK | 2026-11-09T16:30 | 2026-11-09T18:40 | 4 | 2 | Scheduled |
| ZX 480 | FRA | DUB | 2026-11-09T11:30 | 2026-11-09T12:50 | 3 | 2 | Scheduled |
| ZX 482 | DUB | BOS | 2026-11-09T15:00 | 2026-11-09T17:10 | 3 | 2 | Scheduled |
| ZX 486 | FRA | KEF | 2026-11-09T13:00 | 2026-11-09T15:40 | 0 | 2 | Scheduled |
| ZX 488 | KEF | JFK | 2026-11-09T17:30 | 2026-11-09T19:10 | 4 | 0 | Scheduled |
| ZX 494 | FRA | BOS | 2026-11-09T13:30 | 2026-11-09T16:10 | 4 | 3 | Scheduled |
| ZX 490 | BOS | JFK | 2026-11-09T19:00 | 2026-11-09T20:25 | 2 | 2 | Scheduled |
| ZX 492 | BOS | JFK | 2026-11-09T21:30 | 2026-11-09T22:55 | 3 | 0 | Scheduled |

### 3.4 New passengers (append to `passengers`)

| ID | Name | Booking | Cabin | Flights |
|---|---|---|---|---|
| h7c2nv | Greta Weiss | WN4R8C | Business | ZX440 |
| t4q9mx | Paul Weiss | WN4R8C | Economy | ZX440 |
| z1r6bd | Nina Weiss | WN4R8C | Economy | ZX440 |
| e8w3ks | Henrik Lund | LM2Q7H | Business | ZX440 |
| n5y7fa | Ingrid Lund | LM2Q7H | Business | ZX440 |
| u2j8lc | Piotr Dabrowski | PD9X3K | Economy | ZX440 |
| a6m1qr | Ewa Dabrowska | PD9X3K | Economy | ZX440 |
| x9d4wg | Kasia Dabrowska | PD9X3K | Economy | ZX440 |
| s3v5pe | Jakub Dabrowski | PD9X3K | Economy | ZX440 |
| g7k2zt | Sofia Vidal | SV5J1N | Economy | ZX440 |
| d1x8hn | Teo Costa | CB8T4F | Economy | ZX440 |
| p4f6ry | Bia Costa | CB8T4F | Economy | ZX440 |
| v9a3mc | Hugo Brandt | HB3K9W | Business | ZX444 |
| k2n7ue | Mila Brandt | HB3K9W | Economy | ZX444 |
| b5t1xw | Omar Rahimi | OR6M2D | Economy | ZX444 |
| m8g4jd | Leila Rahimi | OR6M2D | Economy | ZX444 |
| r3e9vk | Sami Rahimi | OR6M2D | Economy | ZX444 |
| f6p2ql | Erik Kask | EK1V7P | Business | ZX444 |

## 4. Feature 1: find connections

For a **cancelled** flight, list the connections its passengers may be rebooked onto. A connection is 1 to 3 flights
in order where:

1. the first flight departs from the cancelled flight's departure airport, **after** its departure, and no later than
   the end of the second day after its departure date (ZX 440 on 9 Nov: up to 11 Nov 23:59);
2. each next flight departs from the airport where the previous one arrives, **90 minutes to 12 hours** (inclusive)
   after that arrival;
3. the last flight arrives at the cancelled flight's arrival airport;
4. no airport appears twice (counting the departure airport);
5. every flight is Scheduled and has at least one free seat (in any cabin; with the cabin filter, in that cabin).

Sort by arrival of the last flight, earliest first, then fewer changes first. Remaining ties: any order, but the same
every time. List all connections (no limit). Each connection shows its flights in order, each with number, from, to,
departs, arrives and free seats per cabin, plus the connection's arrival and number of changes.

Optional input: **cabin** (Economy or Business), meaning every flight has at least one free seat in that cabin.
There is **no** filter for party size; checking that a whole group fits is the dispatcher's job.

Errors: unknown flight, flight not cancelled, unknown cabin; as in part 1's `alternatives`.

These rules match flight-rescue's `search` (`srv/lib/itineraries.js`) except the date window, which is counted from
the cancelled flight. Copy the logic you need; do not import from that repo.

## 5. Feature 2: rebook onto a connection

Move selected passengers of a cancelled flight onto a connection of 1 to 3 flights in one step. Input: the cancelled
flight, the flights in order, the passenger IDs. Each passenger keeps their cabin.

Every check runs before anything changes; if any check fails, nothing changes and the error says why:

- the cancelled flight exists and is cancelled; at least one passenger; each listed once and booked on it (its
  `flightIds` is exactly `[cancelled flight]`);
- 1 to 3 flights, each existing and Scheduled;
- the flights satisfy §4 rules 1–4 (window, chain, 90 min to 12 h, no airport twice);
- **every** flight has enough free seats in each cabin for the passengers in that cabin.

On success: each passenger's `flightIds` becomes the connection's flights; each flight's free seats in each cabin drop
by the passengers moved in that cabin. Afterwards the cancelled flight's screen shows the passengers still to rebook,
as in part 1.

## 6. Screens and tools

- Reachable from a cancelled flight's detail screen. Show what §4 lists, and let the dispatcher select passengers and
  a connection and rebook (§5), with the error shown on screen when a check fails.
- Passenger lists on flight screens show each passenger's flights, so a dispatcher can see who went where.
- Tools: one per new screen action, registered with the existing 4. Names, inputs and descriptions are yours.

## 7. Not in scope

Time zones, durations, prices, undo, splitting or merging bookings, multiple airlines, a party-size filter, changes to
the benchmark harness beyond the data-shape follow-up in §3.1.

## 8. Deliverable

Commits on your branch, `npm test`, `npx tsc --noEmit` and `npm run smoke` green, and a short report: the new screens
(with the accessible names of their controls), the new rules functions (name and signature), the new tools (name,
input schema, description, exactly as registered), the tests you added, and anything in this spec you found
ambiguous with what you decided.
