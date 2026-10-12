# Agent-ready Fiori

A Fiori-style UI5 app ("Disruption desk") whose screens and WebMCP tools share the same rules, and a benchmark that
runs Claude on the same tasks with and without WebMCP.

The app shows cancelled flights and their passengers. In both modes the agent gets the same browser tools through
chrome-devtools-mcp: accessibility snapshots, clicks and typing. In WebMCP mode Chrome also lists the tools the page
registers: `search_flights`, `get_flight`, `list_alternatives` and `rebook_passengers` (part 1), and
`find_connections` and `rebook_onto_connection` (scenario 2). Each tool runs the same controller method and rules as
the matching screen action, and a rejected action comes back as an error result, just as the screen shows it.

## Results, part 1: three easy tasks

60 counted attempts: 3 tasks × 2 modes × 2 models × 5 runs. All 60 passed. Medians, UI only → WebMCP:

| Task | Model | Turns | Cost | Time |
|---|---|---|---|---|
| T1: count business passengers, find the best later flight (read only) | Opus 5.5 | 5 → 2 | $0.124 → $0.034 | 14 s → 6 s |
| | Haiku 5.5 | 3 → 2 | $0.003 → $0.001 | 8 s → 4 s |
| T2: rebook one passenger | Opus 5.5 | 5 → 4 | $0.146 → $0.036 | 11 s → 8 s |
| | Haiku 5.5 | 7 → 4 | $0.005 → $0.001 | 13 s → 5 s |
| T3: rebook all 8 passengers, booking groups together | Opus 5.5 | 10 → 4 | $0.267 → $0.058 | 28 s → 17 s |
| | Haiku 5.5 | 13 → 4 | $0.011 → $0.002 | 33 s → 9 s |

Haiku with WebMCP also beat Opus through the UI on every task: about 140× cheaper and 2–4× faster (T3: $0.0019 and
9.5 s against $0.267 and 28.3 s), with 5/5 runs on both sides. Most of the cost gap is the models' prices: Haiku
through the UI was already 24–50× cheaper than Opus, and WebMCP cut its cost by another 3–6×. The speed gap comes from
WebMCP: through the UI, Haiku was slower than Opus on T2 and T3. Even Haiku's slowest, most expensive WebMCP run beat
Opus's fastest, cheapest UI-only run. These tasks were easy enough for both models to pass every run; on harder ones
the smaller model might not.

The whole batch cost $3.41. The results page, with a replay of one run per cell and a link to every trace, is live at
https://webmcp-test.machros.here.now/. Locally: run `npm run serve` and open http://127.0.0.1:8080/.

Setup: Chrome 154.0.8037.98 with WebMCP turned on by a feature flag (UI-only runs use the same Chrome without it),
chrome-devtools-mcp 1.10.1, `claude-opus-5-5` and `claude-haiku-5-5` with adaptive thinking at medium effort,
UI5 1.136.8. Scenario 2 used the same setup.

## Results, scenario 2: a hard task

A new disruption on 9 November: ZX 440 Frankfurt–New York and ZX 444 Munich–New York are cancelled, with 18 passengers
in 8 booking groups, and the direct flights are nearly full. The desk gained a Connections screen (1 to 3 flights via
LHR, AMS, DUB, KEF or BOS, with free seats per cabin on every flight) and the two connection tools.

- T4: rebook one booking group with mixed cabins onto the earliest-arriving connection that has a seat in each
  passenger's cabin on every flight.
- T5: rebook everyone from both flights by a stated priority (groups with a Business passenger first, then larger
  groups, then by booking reference). Seats run out, so one group fits nowhere and must be left behind and named.

40 counted attempts: 2 tasks × 2 modes × 2 models × 5 runs. All 40 passed, and every T5 run placed all 8 booking
groups correctly. Medians, UI only → WebMCP:

| Task | Model | Turns | Cost | Time |
|---|---|---|---|---|
| T4: one group, via a connection | Opus 5.5 | 6 → 3 | $0.424 → $0.057 | 25 s → 8 s |
| | Haiku 5.5 | 6 → 4 | $0.012 → $0.002 | 20 s → 9 s |
| T5: everyone, by priority | Opus 5.5 | 39 → 4 | $2.274 → $0.121 | 174 s → 27 s |
| | Haiku 5.5 | 47 → 11 | $0.506 → $0.007 | 266 s → 44 s |

On T5, WebMCP cut Opus's cost 19× and Haiku's 68×. Haiku with WebMCP did T5 for $0.0074 in 44 s, against $2.27 and
174 s for Opus through the UI. The only failure came in the pilot (8 runs, not counted): Haiku through the UI misread
the free seats on one flight and put one group on a later connection, 7 of 8 groups right.

The batch cost $17.30 and the pilot $3.94. Results page: https://webmcp-test.machros.here.now/results/index.html?set=hard
(locally `results/index.html?set=hard`).

How the connection screens and tools were built: a separate Claude session built them from a written app spec and was
never given the tasks. The app spec and the tasks were sealed by SHA-256 in `bench/scenario-2.sha256` before the
build started; both are in `docs/scenario-2/`, and `shasum -a 256 -c bench/scenario-2.sha256` checks that they match.

## What's here

- `app/`: the UI5 app. `app/webmcp.js` registers the tools with `document.modelContext.registerTool`.
- `bench/`: the harness (TypeScript, run natively by Node 26).
- `runs/batch/`, `runs/hard/`: every attempt's full trace, with the images the model saw (`runs/hard-pilot-1/`: the
  scenario 2 pilot).
- `docs/scenario-2/`: the sealed app spec and tasks. `bench/reference.ts` derives T4's and T5's expected results from
  the data alone, independently of the app's rules.

## Reproduce

Node 26 and Chrome 154+.

```bash
npm install
npm run probe   # checks WebMCP in your Chrome
npm test
npm run smoke
node bench/run.ts --set mine --runs 1 --max-usd 5 --key-file <dotenv file with ANTHROPIC_API_KEY>
node bench/run.ts --set mine-hard --runs 1 --task t4 --task t5 --max-usd 10 --key-file <same file>
node bench/summarize.ts --set mine --print
```

`--max-usd` is a hard cap, checked before every request. Only `ANTHROPIC_API_KEY` is read from the key file. Without
`--task`, a set runs T1–T3. Part 1 ran on the code tagged `part-1`.

## Caveats

- WebMCP is a W3C Web Machine Learning Community Group draft, not a standard. Its API changed several times in 2026.
- We designed the app and its tools. Each tool does exactly what one screen action does, but a different app could
  favour either mode.
- Scenario 2's screens and tools were built by a separate Claude session that was never given the tasks, but from a
  spec we wrote, so they are not independent of us.
- `find_connections`' description tells the agent that it does not check whether a whole group fits; the screen shows
  no such hint.
- UI5 slides pages in and out. UI-only T5 runs had 6 to 25 failed tool calls each, nearly all of them clicks on a
  control that was not yet interactive, such as one on a page still sliding in or out, and spent turns on retries.
- The Flights screen's filters (UI5 `Select`) cannot be clicked through chrome-devtools-mcp. No task needs them.
- 5 runs per cell show a pattern, not statistical significance.

## License

MIT, see [LICENSE](LICENSE).
