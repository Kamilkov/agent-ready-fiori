// One benchmark browser: a fresh Chrome via chrome-devtools-mcp with the app open, and the tools the model gets.
import type Anthropic from '@anthropic-ai/sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { startDevtools, textOf, type Devtools } from './devtools.ts'

export type Mode = 'ui' | 'webmcp'
// The model's UI tools, the same in both modes. Everything else chrome-devtools-mcp has (evaluate_script, navigate_page,
// new_page, performance, network, memory, extension and Lighthouse tools) is never offered to the model.
export const UI_TOOLS = ['take_snapshot', 'click', 'fill', 'fill_form', 'press_key', 'type_text', 'hover', 'wait_for', 'handle_dialog', 'take_screenshot']

export interface ToolOutcome { content: Anthropic.ToolResultBlockParam['content']; isError: boolean }
export interface PageTool { name: string; description: string; inputSchema: Anthropic.Tool.InputSchema; annotations?: Record<string, unknown> }
export interface Session {
  tools: Anthropic.Tool[]
  pageTools: PageTool[]
  /** Runs one of the model's tools. The signal carries the run's deadline into the browser call. */
  run(name: string, input: unknown, signal?: AbortSignal): Promise<ToolOutcome>
  screenshot(signal?: AbortSignal): Promise<Buffer>
  appData(): Promise<unknown>
  evaluate(fn: string): Promise<unknown>
  versions: { chrome: string; chromeDevtoolsMcp: string }
  launchArgs: string[]
  close(): Promise<void>
}

export const outcomeText = (content: ToolOutcome['content']) =>
  typeof content === 'string' ? content : (content ?? []).flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n')
const failure = (text: string): ToolOutcome => ({ content: [{ type: 'text', text }], isError: true })
const READY = `async () => { for (let i = 0; i < 300; i++) { if (window.deskData) return true; await new Promise(r => setTimeout(r, 50)) } throw new Error('The app did not start') }`

/** Opens the app in a fresh Chrome. In ui mode Chrome runs without WebMCP, so the page registers no tools. */
export async function openSession(url: string, mode: Mode): Promise<Session> {
  const dt = await startDevtools({ webmcp: mode === 'webmcp' })
  try {
    const nav = await dt.call('navigate_page', { type: 'url', url })
    if (nav.isError) throw new Error(`navigate_page failed: ${textOf(nav)}`)
    await dt.evaluate(READY)
    const all = (await dt.client.listTools()).tools
    const uiTools: Anthropic.Tool[] = UI_TOOLS.map(name => {
      const t = all.find(t => t.name === name)
      if (!t) throw new Error(`chrome-devtools-mcp has no ${name} tool`)
      // No tool writes files: take_snapshot's and take_screenshot's filePath is removed here and refused in runUiTool.
      const { filePath: _, ...properties } = (t.inputSchema.properties ?? {}) as Record<string, unknown>
      return { name, description: t.description ?? '', input_schema: { ...t.inputSchema, properties } as Anthropic.Tool.InputSchema }
    })
    const pageTools = mode === 'webmcp' ? await listPageTools(dt) : []
    const pageNames = new Set(pageTools.map(t => t.name))
    // navigator.userAgent is reduced to 154.0.0.0; the full version decides whether a set may resume.
    const brands = (await dt.evaluate("async () => (await navigator.userAgentData.getHighEntropyValues(['fullVersionList'])).fullVersionList")) as { brand: string; version: string }[]
    const chrome = brands.find(b => b.brand === 'Chromium')?.version
    if (!chrome) throw new Error(`No Chromium version in ${JSON.stringify(brands)}`)
    return {
      tools: [...uiTools, ...pageTools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))],
      pageTools,
      run: (name, input, signal) =>
        pageNames.has(name) ? runPageTool(dt, name, input, signal)
        : UI_TOOLS.includes(name) ? runUiTool(dt, name, input, signal)
        : Promise.resolve(failure(`Unknown tool ${name}`)),
      async screenshot(signal) {
        const r = await dt.call('take_screenshot', { format: 'jpeg', quality: 70 }, signal)
        const img = r.content.find(c => c.type === 'image')
        if (!img || img.type !== 'image') throw new Error(`take_screenshot returned no image: ${textOf(r)}`)
        return Buffer.from(img.data, 'base64')
      },
      appData: () => dt.evaluate('() => window.deskData()'),
      evaluate: fn => dt.evaluate(fn),
      versions: { chrome, chromeDevtoolsMcp: dt.version },
      launchArgs: dt.args,
      close: () => dt.close(),
    }
  } catch (e) {
    await dt.close()
    throw e
  }
}

async function listPageTools(dt: Devtools): Promise<PageTool[]> {
  const r = await dt.call('list_webmcp_tools')
  if (r.isError) throw new Error(`list_webmcp_tools failed: ${textOf(r)}`)
  return (r.structuredContent as { webmcpTools?: PageTool[] } | undefined)?.webmcpTools ?? []
}

// MCP content becomes Claude tool_result content: the text and images the model sees.
function blocks(r: CallToolResult): (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] {
  const out = r.content.flatMap((c): (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] =>
    c.type === 'text' ? [{ type: 'text', text: c.text }]
    : c.type === 'image' ? [{ type: 'image', source: { type: 'base64', media_type: c.mimeType as 'image/jpeg' | 'image/png', data: c.data } }]
    : [])
  return out.length ? out : [{ type: 'text', text: '(no output)' }]
}

async function runUiTool(dt: Devtools, name: string, input: unknown, signal?: AbortSignal): Promise<ToolOutcome> {
  if (typeof input === 'object' && input !== null && 'filePath' in input) return failure('filePath is not available: tools cannot write files')
  const r = await dt.call(name, (input ?? {}) as Record<string, unknown>, signal)
  return { content: blocks(r), isError: !!r.isError }
}

// A page tool runs through execute_webmcp_tool. The model sees the tool's own output, as a WebMCP browser agent would.
// The app reports a rejected action as {ok:false, error}; that is an error result, with the app's message unchanged.
async function runPageTool(dt: Devtools, name: string, input: unknown, signal?: AbortSignal): Promise<ToolOutcome> {
  const r = await dt.call('execute_webmcp_tool', { toolName: name, input: JSON.stringify(input ?? {}) }, signal)
  if (r.isError) return failure(textOf(r))
  const message = (r.structuredContent as { message?: string } | undefined)?.message
  const { status, output, errorText } = JSON.parse(String(message)) as { status: string; output?: unknown; errorText?: string }
  if (status !== 'Completed') return failure(errorText || `The tool ended with status ${status}`)
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  return { content: [{ type: 'text', text }], isError: rejected(text) }
}

const rejected = (text: string) => {
  try { return (JSON.parse(text) as { ok?: unknown } | null)?.ok === false } catch { return false }
}
