// One chrome-devtools-mcp server, and the Chrome it starts, as an MCP client. Version pinned in package.json.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js', import.meta.url))
// Every session: a throwaway profile, no telemetry, one window size, structured results next to the text ones, and
// one page, so page tools need no pageId (1.10.1 requires it by default).
const BASE_ARGS = ['--isolated', '--usageStatistics=false', '--performanceCrux=false', '--viewport=1280x900', '--experimentalStructuredContent=true', '--pageIdRouting=false']
// What WebMCP needs (checked by bench/probe.ts): the Chrome feature and the server's experimental WebMCP tools.
export const WEBMCP_ARGS = ['--chromeArg=--enable-features=WebMCP', '--categoryExperimentalWebmcp=true']
// A call's own timeout when the caller's signal carries a deadline: longer than any run (agent.ts LIMITS.ms is 10 min).
const SIGNALLED_MS = 60 * 60_000

export interface Devtools {
  client: Client
  call(name: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>
  evaluate(fn: string, signal?: AbortSignal): Promise<unknown>
  version: string
  /** The server's launch arguments, recorded in each set's configuration. */
  args: string[]
  close(): Promise<void>
}

export const textOf = (r: CallToolResult) => r.content.flatMap(c => (c.type === 'text' ? [c.text] : [])).join('\n')

export async function startDevtools(o: { webmcp: boolean; headless?: boolean; webmcpArgs?: string[] }): Promise<Devtools> {
  const args = [...BASE_ARGS, ...((o.headless ?? true) ? ['--headless'] : []), ...(o.webmcp ? (o.webmcpArgs ?? WEBMCP_ARGS) : [])]
  const client = new Client({ name: 'agent-ready-fiori', version: '1.0.0' })
  // No env option: the SDK passes the child only a minimal environment (PATH, HOME, …), never the harness's own.
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, ...args], stderr: 'inherit' }))
  // An aborted signal rejects the call and tells the server to cancel it; the run's deadline arrives this way. With a
  // signal, the deadline governs, not the SDK's 60 s request timeout: a long wait_for is the model's choice, not a crash.
  const call = async (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) =>
    (await client.callTool({ name, arguments: args }, undefined, signal ? { signal, timeout: SIGNALLED_MS } : undefined)) as CallToolResult
  return {
    client,
    call,
    // Runs a function in the page and returns its JSON result. Harness only: never offered to the model.
    async evaluate(fn, signal) {
      const r = await call('evaluate_script', { function: fn }, signal)
      const text = textOf(r)
      if (r.isError) throw new Error(`evaluate_script failed: ${text}`)
      const json = /```json\n([\s\S]*)\n```/.exec(text)
      if (!json) throw new Error(`evaluate_script returned no JSON: ${text}`)
      return JSON.parse(json[1])
    },
    version: client.getServerVersion()?.version ?? 'unknown',
    args,
    close: () => client.close(),
  }
}
