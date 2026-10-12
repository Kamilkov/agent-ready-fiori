// Publishes the app and the results page to here.now (publish, upload, finalize): both sets' summaries, every trace with
// the images the model saw, and the replayed runs' screenshots, so every link on the page works without GitHub.
// node bench/deploy.ts --dry-run | node --env-file=<dotenv file with HERE_NOW_API_KEY> bench/deploy.ts
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { ROOT } from './serve.ts'

const API = 'https://here.now/api/v1'
const STATE = join(ROOT, 'deploy.json')
const SETS = ['batch', 'hard']
const WORKSPACE = 'machros', LABEL = 'webmcp-test' // served at https://webmcp-test.machros.here.now/
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
}
const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } })

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true, recursive: true })
  return entries.filter(e => e.isFile() && e.name !== '.DS_Store').map(e => relative(ROOT, join(e.parentPath, e.name)))
}

const paths = ['index.html', ...await files('app'), ...await files('results')]
for (const set of SETS) {
  const summary = JSON.parse(await readFile(join(ROOT, `runs/${set}/summary.json`), 'utf8')) as { traceBase: string | null; cells: { replay: { dir: string } | null }[] }
  if (summary.traceBase) throw new Error(`runs/${set}/summary.json links its traces to GitHub: run node bench/summarize.ts --set ${set} --local`)
  const replays = new Set(summary.cells.flatMap(c => (c.replay ? [c.replay.dir] : [])))
  paths.push(`runs/${set}/summary.json`, ...(await files(`runs/${set}/attempts`)).filter(p => {
    const [, , , dir, sub] = p.split('/')
    return p.endsWith('/trace.json') || sub === 'img' || (sub === 'shots' && replays.has(dir))
  }))
}
const list = await Promise.all(paths.map(async path => ({ path, size: (await stat(join(ROOT, path))).size, contentType: TYPES[extname(path)] ?? 'application/octet-stream' })))
console.log(`${list.length} files, ${(list.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(1)} MB`)
if (values['dry-run']) {
  const groups = Map.groupBy(list, f => f.path.split('/').slice(0, f.path.startsWith('runs/') ? 2 : 1).join('/') + (f.path.includes('/shots/') ? ' (shots)' : f.path.includes('/img/') ? ' (img)' : ''))
  for (const [k, fs] of groups) console.log(String(fs.length).padStart(5), k)
} else {
  const key = process.env.HERE_NOW_API_KEY
  if (!key) throw new Error('HERE_NOW_API_KEY is missing: pass --env-file')
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-herenow-client': 'claude-code/agent-ready-fiori-deploy', 'x-herenow-account': WORKSPACE }
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
    return data
  }
  const state = (await readFile(STATE, 'utf8').then(JSON.parse, () => null)) as { slug: string } | null
  const site = await api(state ? 'PUT' : 'POST', state ? `/publish/${state.slug}` : '/publish', { files: list, displayName: 'Agent-ready Fiori' })
  for (const u of site.upload.uploads as { path: string; method: string; url: string; headers: Record<string, string> }[]) {
    const res = await fetch(u.url, { method: u.method, headers: u.headers, body: await readFile(join(ROOT, u.path)) })
    if (!res.ok) throw new Error(`upload ${u.path}: ${res.status}`)
  }
  const done = await api('POST', `/publish/${site.slug}/finalize`, { versionId: site.upload.versionId })
  if (!state) {
    // A new workspace Site is members-only and labelled after its display name: open it to anyone and rename the label.
    await writeFile(STATE, JSON.stringify({ slug: site.slug }, null, 2) + '\n')
    await api('PATCH', `/publish/${site.slug}/access`, { mode: 'anyone_with_link', allowedEmails: [], allowedDomains: [] })
    const { accounts } = await api('GET', '/accounts') as { accounts: { accountId: string; subdomain: string | null }[] }
    const account = accounts.find(a => a.subdomain === WORKSPACE)
    if (!account) throw new Error(`No workspace ${WORKSPACE} for this key`)
    const labels = `/accounts/${account.accountId}/site-labels`
    const { siteLabels } = await api('GET', labels) as { siteLabels: { label: string; slug: string }[] }
    const current = siteLabels.find(l => l.slug === site.slug)
    if (current) await api('PATCH', `${labels}/${current.label}`, { label: LABEL, redirect: false })
    else await api('POST', labels, { slug: site.slug, label: LABEL })
  }
  console.log('live:', done.primaryUrl ?? done.siteUrl)
}
