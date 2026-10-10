// Checks that this machine's Chrome and the pinned chrome-devtools-mcp expose a page's WebMCP tools, and prints the
// raw responses the benchmark's bridge relies on. Run it again after a Chrome or chrome-devtools-mcp update.
// node bench/probe.ts [--headful] [--args "<chrome-devtools-mcp args that turn WebMCP on>"]
import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { serve } from './serve.ts'
import { startDevtools, textOf, WEBMCP_ARGS, type Devtools } from './devtools.ts'

const { values } = parseArgs({ options: { headful: { type: 'boolean', default: false }, args: { type: 'string' } } })
const webmcpArgs = values.args ? values.args.trim().split(/\s+/) : WEBMCP_ARGS
const headless = !values.headful
const SCHEMAS = ['take_snapshot', 'click', 'fill', 'fill_form', 'press_key', 'type_text', 'hover', 'wait_for', 'handle_dialog',
  'take_screenshot', 'evaluate_script', 'navigate_page', 'list_webmcp_tools', 'execute_webmcp_tool']
const json = (v: unknown) => JSON.stringify(v, null, 2)

const { server, url } = await serve()
async function open(dt: Devtools) {
  const r = await dt.call('navigate_page', { type: 'url', url: `${url}/bench/probe/index.html` })
  assert.ok(!r.isError, textOf(r))
  return (await dt.evaluate(
    'async () => { await new Promise(r => setTimeout(r, 300)); return { ...window.probe, userAgent: navigator.userAgent } }',
  )) as { hasModelContext: boolean; registered: number; error: string | null; userAgent: string }
}

try {
  const on = await startDevtools({ webmcp: true, headless, webmcpArgs })
  try {
    console.log('chrome-devtools-mcp', on.version, '· args', webmcpArgs.join(' '), '· headless', headless)
    const state = await open(on)
    console.log('page with WebMCP:', state)
    assert.equal(state.hasModelContext, true, 'document.modelContext is missing: WebMCP is off in this Chrome')
    assert.equal(state.error, null)
    assert.equal(state.registered, 4)

    const list = await on.call('list_webmcp_tools')
    console.log('list_webmcp_tools:', json({ isError: list.isError, text: textOf(list), structuredContent: list.structuredContent }))
    const listed = (list.structuredContent as { webmcpTools?: { name: string }[] } | undefined)?.webmcpTools ?? []
    assert.deepEqual(listed.map(t => t.name).sort(), ['echo', 'echo_object', 'echo_text', 'fail'])

    // The bridge's assumptions: the result is {status, output, errorText} JSON in structuredContent.message. Chrome hands
    // a JSON string output back already parsed, so the bridge serializes non-string output again (asText).
    const asText = (output: unknown) => (typeof output === 'string' ? output : JSON.stringify(output))
    const run = async (toolName: string) => {
      const r = await on.call('execute_webmcp_tool', { toolName, input: JSON.stringify({ text: 'hi' }) })
      console.log(`execute_webmcp_tool ${toolName}:`, json({ isError: r.isError, text: textOf(r), structuredContent: r.structuredContent }))
      return JSON.parse(String((r.structuredContent as { message?: string } | undefined)?.message)) as { status: string; output?: unknown; errorText?: string }
    }
    for (const toolName of ['echo', 'echo_object']) {
      const result = await run(toolName)
      assert.equal(result.status, 'Completed')
      assert.deepEqual(JSON.parse(asText(result.output)), { ok: true, got: { text: 'hi' } })
    }
    const text = await run('echo_text')
    assert.equal(text.status, 'Completed')
    assert.equal(asText(text.output), 'plain hi')
    // A thrown error: the bridge turns any status but Completed into an is_error result with errorText.
    const thrown = await run('fail')
    assert.notEqual(thrown.status, 'Completed')
    console.log('thrown error arrives as', json(thrown))

    const tools = (await on.client.listTools()).tools
    for (const name of SCHEMAS) console.log(`schema ${name}:`, JSON.stringify(tools.find(t => t.name === name)?.inputSchema ?? 'MISSING'))
    console.log('take_snapshot:\n' + textOf(await on.call('take_snapshot')))
  } finally {
    await on.close()
  }

  // UI-only mode starts Chrome without the WebMCP args: the page must not see document.modelContext.
  const off = await startDevtools({ webmcp: false, headless })
  try {
    const state = await open(off)
    console.log('page without WebMCP:', state)
    assert.equal(state.hasModelContext, false)
  } finally {
    await off.close()
  }
  console.log('PROBE OK')
} finally {
  server.close()
}
