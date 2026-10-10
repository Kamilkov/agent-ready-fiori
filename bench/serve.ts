// A static file server for the app, the results page, the runs and the WebMCP probe. Nothing else in the repo
// (.env, package files, the harness) is reachable. Used by the benchmark and for viewing.
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PUBLIC = ['app', 'results', 'runs', join('bench', 'probe')]
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
}

export function serve(port = 0, root = ROOT): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    let path: string
    try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname) } catch { res.writeHead(400).end(); return }
    const file = resolve(root, '.' + path + (path.endsWith('/') ? 'index.html' : ''))
    // The path relative to the root decides, segment by segment: "../x" and "../site-other/x" are both outside.
    const rel = relative(root, file)
    if (rel !== 'index.html' && !PUBLIC.some(dir => rel.startsWith(dir + sep))) { res.writeHead(403).end(); return }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
    } catch {
      res.writeHead(404).end('Not found')
    }
  })
  return new Promise(ok => server.listen(port, '127.0.0.1', () => {
    const address = server.address()
    ok({ server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}` })
  }))
}

if (import.meta.main) {
  const { url } = await serve(Number(process.argv[2] ?? 8080))
  console.log(`Serving ${ROOT} at ${url}`)
}
