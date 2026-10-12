# Agent-ready Fiori, scenario 2: the sealed tasks

Status: draft for Kamil's review, 2026-10-12. SEALED: never give this file, its folder or its contents to the
builder. After Kamil approves it, its SHA-256 and the app spec's go into
`bench/scenario-2.sha256` before the build starts; the file itself is committed only after the build.

Data: the app spec, §3 (`docs/superpowers/specs/2026-10-12-scenario-2-app-spec.md`). Flight IDs below are the
data's ids (`ZX470` for ZX 470).

## 1. Prompts (verbatim)

**T4**

> Flight ZX 440 from Frankfurt (FRA) to New York (JFK) on 9 November is cancelled. Rebook the three passengers with
> booking reference WN4R8C together onto the connection that arrives in New York earliest and has a free seat in each
> passenger's cabin, for all three of them, on every flight. Everyone keeps their cabin.

**T5**

> Flights ZX 440 from Frankfurt (FRA) and ZX 444 from Munich (MUC) to New York (JFK) on 9 November are cancelled.
> Rebook all of their passengers onto connections to New York, following these rules:
>
> 1. Everyone keeps their cabin.
> 2. Passengers with the same booking reference travel together on the same flights. Never split a booking group.
> 3. Seats go to the booking groups by priority, one list for both flights: groups that include a Business passenger
>    first; then larger groups before smaller ones; then by booking reference, alphabetically.
> 4. Each group gets the connection that arrives in New York earliest and has enough free seats in each of its
>    passengers' cabins on every flight, after all higher-priority groups have their seats. If two such connections
>    arrive at the same time, take the one with fewer changes.
> 5. If no connection has room for a whole group, leave that group on its cancelled flight.
>
> You may make the bookings in any order.
>
> End your reply with one line in the form `ANSWER: <booking references left on their cancelled flight,
> comma-separated, or NONE>`.

## 2. Connections (from the start data)

From ZX 440 (FRA), by arrival on 9 Nov unless noted: ZX 450 + ZX 460 (17:55), ZX 470 + ZX 472 (18:40), ZX 486 +
ZX 488 (19:10), ZX 494 + ZX 490 (20:25, 1 change), ZX 480 + ZX 482 + ZX 490 (20:25, 2 changes), ZX 446 (20:45),
ZX 450 + ZX 462 (21:55), ZX 494 + ZX 492 (22:55, 1 change), ZX 480 + ZX 482 + ZX 492 (22:55, 2 changes),
ZX 456 + ZX 464 (10 Nov 12:55), ZX 449 (11 Nov 12:45). ZX 448 is full and not offered.

From ZX 444 (MUC): ZX 454 + ZX 460 (17:55), ZX 474 + ZX 472 (18:40), ZX 454 + ZX 462 (21:55), ZX 445 (10 Nov 12:30).

## 3. Expected results

### T4

WN4R8C goes on ZX 470 + ZX 472. The earliest connection, ZX 450 + ZX 460, has economy seats but no business seat on
ZX 460 (the trap). End state: Greta, Paul and Nina Weiss `flightIds: ["ZX470","ZX472"]`; ZX 470 free E 3 / B 1;
ZX 472 free E 2 / B 1. Everything else as in the start data.

### T5

Priority: WN4R8C, HB3K9W, LM2Q7H, EK1V7P (Business groups: size 3, then size 2 by reference, then size 1), then
PD9X3K, OR6M2D, CB8T4F, SV5J1N. The priority decides who gets which seats, not the order of the bookings: the grader
checks the final allocation only, and any booking sequence that reaches it passes. Booking a lower-priority group
first onto seats a higher-priority group needs leads to a different final state and fails.

| # | Group | From | Cabins | Result | Why |
|---|---|---|---|---|---|
| 1 | WN4R8C | ZX 440 | 1 B, 2 E | ZX 470 + ZX 472 | ZX 460 has no business seat |
| 2 | HB3K9W | ZX 444 | 1 B, 1 E | ZX 474 + ZX 472 | ZX 460 has no business seat; ZX 472 left E 2 / B 1 |
| 3 | LM2Q7H | ZX 440 | 2 B | ZX 494 + ZX 490 | ZX 472 now B 0, ZX 488 B 0; ties with ZX 480 + 482 + 490 at 20:25, fewer changes wins |
| 4 | EK1V7P | ZX 444 | 1 B | ZX 454 + ZX 462 | ZX 460 B 0, ZX 472 B 0 |
| 5 | PD9X3K | ZX 440 | 4 E | stays on ZX 440 | no connection has 4 economy seats on every flight any more (ZX 472 has 1 left) |
| 6 | OR6M2D | ZX 444 | 3 E | ZX 454 + ZX 460 | ZX 460 has exactly 3 economy seats |
| 7 | CB8T4F | ZX 440 | 2 E | ZX 494 + ZX 490 | ZX 460 now E 0, ZX 472 E 1, ZX 486 E 0; same tie as #3 |
| 8 | SV5J1N | ZX 440 | 1 E | ZX 470 + ZX 472 | the last economy seat on ZX 472 |

Free seats after (E / B), only flights that change: ZX 454 2 / 1, ZX 460 0 / 0, ZX 462 3 / 0, ZX 470 2 / 1,
ZX 472 0 / 0, ZX 474 3 / 1, ZX 490 0 / 0, ZX 494 2 / 1.

`ANSWER: PD9X3K`.

## 4. Grading

- Pass/fail: exact comparison of the whole data (every passenger's `flightIds`, every flight's free seats) with the
  expected end state, as part 1's `diff`. T5 also needs the last `ANSWER:` line to equal `PD9X3K` after removing
  whitespace, backticks and asterisks and ignoring case; `NONE` or extra references fail.
- Secondary: **groups with the correct final assignment**, per attempt: the number of booking groups whose members'
  `flightIds` all equal the expected ones. A group correctly left behind counts (PD9X3K: `["ZX440"]`). T4: out of 1,
  T5: out of 8. Reported, not used for pass/fail.
- Per cell: every counted attempt's score, **failures included**, and their sum over all graded counted attempts
  (e.g. `8, 8, 6, 8, 5 → 35/40`). A counted attempt without a grade (no final data) is shown as `–` and counted
  separately, never as 0 and never dropped silently. Unlike the cost and time medians, this figure is never
  restricted to successful attempts.
- Grader tests: the expected end state passes; each trap below, done wrong, fails with the right difference named.

## 5. Traps and what a wrong run looks like

1. **Mixed cabins (T4, T5 #1, #2):** filtering by Economy only makes ZX 450 + ZX 460 look fine; booking it is
   rejected by the desk (no business seat), so the cost is turns, unless the Agent then splits the group.
2. **Priority (T5):** allocating in list order, by flight, or by size alone changes the outcome
   (checked: by size alone, ties in list order, PD9X3K gets ZX 470 + ZX 472 and six other groups end up elsewhere).
3. **Shared flights (T5):** FRA and MUC groups compete for ZX 460 and ZX 472.
4. **Same arrival (T5 #3, #7):** ZX 494 + ZX 490 and ZX 480 + ZX 482 + ZX 490 both arrive 20:25; fewer changes wins.
5. **A group that fits nowhere (T5 #5):** PD9X3K could fit if it had higher priority; with its priority it fits
   nowhere. The temptation is to split it (3 + 1 onto ZX 460 / ZX 446 etc.) or to report NONE.

## 6. Checks done on this data

`check-data.mjs` (this folder) enumerates connections by the app spec's rules and applies both tasks. It agrees with
§3, finds no tie left after "fewer changes" at any decision, and confirms that list order, size-only order and
reverse order each give a different end state. The plan replaces it with the committed reference script.
