# Agent-ready Fiori

A Fiori-style UI5 app ("Disruption desk") whose screens and WebMCP tools share the same rules, and a benchmark that
runs Claude on the same tasks with and without WebMCP.

The app shows a cancelled flight, ZX 400, and its 8 passengers. In both modes the agent gets the same browser tools
through chrome-devtools-mcp: accessibility snapshots, clicks and typing. In WebMCP mode Chrome also lists the 4 tools
the page registers (`search_flights`, `get_flight`, `list_alternatives`, `rebook_passengers`). Each tool runs the same
controller method and rules as the matching screen action, and a rejected action comes back as an error result, just
as the screen shows it.

## Results

60 counted attempts: 3 tasks × 2 modes × 2 models × 5 runs. All 60 passed. Medians, UI only → WebMCP:

| Task | Model | Turns | Cost | Time |
|---|---|---|---|---|
| T1: count business passengers, find the best later flight (read only) | Opus 5.5 | 5 → 2 | $0.124 → $0.034 | 14 s → 6 s |
| | Haiku 5.5 | 3 → 2 | $0.003 → $0.001 | 8 s → 4 s |
| T2: rebook one passenger | Opus 5.5 | 5 → 4 | $0.146 → $0.036 | 11 s → 8 s |
| | Haiku 5.5 | 7 → 4 | $0.005 → $0.001 | 13 s → 5 s |
| T3: rebook all 8 passengers, booking groups together | Opus 5.5 | 10 → 4 | $0.267 → $0.058 | 28 s → 17 s |
| | Haiku 5.5 | 13 → 4 | $0.011 → $0.002 | 33 s → 9 s |

The whole batch cost $3.41. The results page, with a replay of one run per cell and a link to every trace, is
`results/index.html`: run `npm run serve` and open http://127.0.0.1:8080/.

Setup: Chrome 154.0.8037.98 with WebMCP turned on by a feature flag (UI-only runs use the same Chrome without it),
chrome-devtools-mcp 1.10.1, `claude-opus-5-5` and `claude-haiku-5-5` with adaptive thinking at medium effort,
UI5 1.136.8.

## What's here

- `app/`: the UI5 app. `app/webmcp.js` registers the tools with `document.modelContext.registerTool`.
- `bench/`: the harness (TypeScript, run natively by Node 26).
- `runs/batch/`: every attempt's full trace, with the images the model saw.

## Reproduce

Node 26 and Chrome 154+.

```bash
npm install
npm run probe   # checks WebMCP in your Chrome
npm test
npm run smoke
node bench/run.ts --set mine --runs 1 --max-usd 5 --key-file <dotenv file with ANTHROPIC_API_KEY>
node bench/summarize.ts --set mine --print
```

`--max-usd` is a hard cap, checked before every request. Only `ANTHROPIC_API_KEY` is read from the key file.

## Caveats

- WebMCP is a W3C Web Machine Learning Community Group draft, not a standard. Its API changed several times in 2026.
- We designed the app and its tools. Each tool does exactly what one screen action does, but a different app could
  favour either mode.
- 5 runs per cell show a pattern, not statistical significance.

## License

MIT, see [LICENSE](LICENSE).
