// Reads chrome-devtools-mcp's take_snapshot text: one node per line, `uid=<id> <role> "<name>" …`, indented by depth.
export interface SnapNode { uid: string; role: string; name: string; depth: number }

export function parseSnapshot(text: string): SnapNode[] {
  return text.split('\n').flatMap(line => {
    const m = /^(\s*)uid=(\S+) (\S+)(?: "((?:[^"\\]|\\.)*)")?/.exec(line)
    return m ? [{ depth: m[1].length, uid: m[2], role: m[3], name: m[4] ?? '' }] : []
  })
}

const matches = (name: string, want: string | RegExp) => (typeof want === 'string' ? name === want : want.test(name))

export function find(nodes: SnapNode[], role: string, name: string | RegExp): SnapNode {
  const node = nodes.find(n => n.role === role && matches(n.name, name))
  if (!node) throw new Error(`No ${role} "${name}" in the snapshot`)
  return node
}

/** The first `role` node (a row's checkbox or radio button) inside the table row that shows `text`. */
export function inRow(nodes: SnapNode[], text: string, role: string): SnapNode {
  for (const [r, row] of nodes.entries()) {
    if (row.role !== 'row') continue
    let end = r + 1
    while (end < nodes.length && nodes[end].depth > row.depth) end++
    const inside = nodes.slice(r, end)
    if (!inside.some(n => n.name.includes(text))) continue
    const hit = inside.find(n => n.role === role)
    if (hit) return hit
  }
  throw new Error(`No ${role} in a row showing "${text}"`)
}
