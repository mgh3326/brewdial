// #589 test support: a local mock of the xBloom reference site (index → recipe
// pages → /r/*.yaml), served over node:http on 127.0.0.1 with a random port.
//
// ALL content here is self-authored — invented roasters, coffees and notes that
// only mimic the site's HTML *structure* (h1 "Roaster — Bean", spec line,
// "Notes:" line, per-section `/r/<file>.yaml` download links). No page or YAML
// text from the real site is committed (it carries no license notice).
//
// Exported as `@brewdial/db/testing` (not from the main entry).

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockRequest {
  path: string
  startedAt: number
  endedAt: number
}

export interface MockRoute {
  status: number
  body: string
  contentType?: string
}

export interface XBloomMockSite {
  url: string // e.g. http://127.0.0.1:54321/
  origin: string // e.g. http://127.0.0.1:54321
  requests: MockRequest[]
  maxInFlight: number
  /** Replace (or add) the response for an exact request path. */
  setRoute(path: string, route: MockRoute): void
  yamlPaths: { hotA: string; icedA: string; hotB: string }
  pagePaths: { a: string; b: string }
  /** Latency added to every response (lets tests observe overlap). */
  latencyMs: number
  close(): Promise<void>
}

function page(opts: {
  title: string
  spec: string
  notes: string
  hotYaml: string
  hotNote: string
  iced?: { yaml: string; note: string }
}): string {
  const iced = opts.iced
    ? `<h2 id="iced">Iced — over ice<a class="headerlink" href="#iced">&para;</a></h2>
<p class="status-chip">starting point</p>
<p><a download="x.yaml" href="${opts.iced.yaml}">Download this recipe (.yaml)</a></p>
<p>${opts.iced.note}</p>`
    : ''
  return `<!doctype html><html><head><title>${opts.title}</title></head><body>
<nav><a href="../../">Home</a> <a href="../../recipes/">All recipes</a></nav>
<article class="md-content__inner md-typeset">
<h1 id="t">${opts.title}<a class="headerlink" href="#t" title="Permanent link">&para;</a></h1>
<p><img src="https://example.invalid/bag.jpg" alt="bag"></p>
<p><strong>${opts.spec}</strong></p>
<h2 id="xbloom-recipe">xBloom recipe<a class="headerlink" href="#xbloom-recipe">&para;</a></h2>
<p><a download="h.yaml" href="${opts.hotYaml}">Download this recipe (.yaml)</a></p>
<p><a href="${opts.hotYaml}?v=2">same file, cache-busted link</a></p>
<p><strong>Notes:</strong> ${opts.notes}</p>
<p>${opts.hotNote}</p>
${iced}
<h2 id="cli">Using these recipes<a class="headerlink" href="#cli">&para;</a></h2>
<pre><code>brew ${opts.hotYaml}</code></pre>
</article></body></html>`
}

/** Self-authored xbloom-ble style YAML: only the first pour carries a label. */
export function mockYaml(opts: { name: string; dose: number; grind: number; temp: number; iced?: boolean }): string {
  const t = opts.temp
  if (opts.iced) {
    return `name: ${opts.name}
dose_g: ${opts.dose}
grind: ${opts.grind}
stage_temps:
- 110.0
- ${t}.0
pours:
- label: Bloom
  ml: 40
  temp_c: ${t}
  pattern: spiral
  pause_s: 45
  rpm: 120
  flow_ml_s: 3.0
  agitation: after
- ml: 110
  temp_c: ${t}
  pattern: spiral
  pause_s: 5
  rpm: 120
  flow_ml_s: 3.0
  agitation: false
ratio: 10
kind: custom
dripper: Omni
water_ml: 150
ice_g: 90
time: ~2:00
note: 'Mock iced note: brew the concentrate onto ice; grind one step finer.'
`
  }
  return `name: ${opts.name}
dose_g: ${opts.dose}
grind: ${opts.grind}
stage_temps:
- 110.0
- ${t}.0
pours:
- label: Bloom
  ml: 45
  temp_c: ${t}
  pattern: spiral
  pause_s: 40
  rpm: 110
  flow_ml_s: 3.0
  agitation: false
- ml: 100
  temp_c: ${t}
  pattern: spiral
  pause_s: 5
  rpm: 110
  flow_ml_s: 3.0
  agitation: false
- ml: 95
  temp_c: ${t}
  pattern: ring
  pause_s: 5
  rpm: 110
  flow_ml_s: 3.2
  agitation: false
ratio: 15.5
kind: custom
dripper: Omni
water_ml: 240
time: 2:40–3:10
note: 'Mock dial-in log: 62 read sour, 58 read clean — settled on **${opts.grind}**.


  **Off?** Sour → finer. Bitter → coarser.'
`
}

/**
 * Start a mock site. `tag` is embedded in slugs/names so concurrent test files
 * (and leftover rows from aborted runs) never collide.
 */
export async function startXBloomMockSite(tag: string): Promise<XBloomMockSite> {
  const t = tag.toLowerCase().replace(/[^a-z0-9]/g, '')
  const slugA = `mock-roastery-kenya-${t}`
  const slugB = `other-roast-brazil-${t}`
  const yamlPaths = { hotA: `/r/${slugA}.yaml`, icedA: `/r/${slugA}-iced.yaml`, hotB: `/r/${slugB}.yaml` }
  const pagePaths = { a: `/recipes/${slugA}/`, b: `/recipes/${slugB}/` }

  const routes = new Map<string, MockRoute>()
  const html = (body: string): MockRoute => ({ status: 200, body, contentType: 'text/html; charset=utf-8' })
  const yml = (body: string): MockRoute => ({ status: 200, body, contentType: 'text/yaml; charset=utf-8' })

  routes.set(
    '/',
    html(`<!doctype html><html><body><nav>
<a href="./">Home</a> <a href="./recipes/">Recipes</a> <a href="./roasters/mock/">Roaster</a>
<a href="./recipes/${slugA}/">Mock Roastery — Kenya</a>
<a href="recipes/${slugA.toUpperCase()}/?ref=nav#top">duplicate link, other spelling</a>
<a href="./recipes/${slugB}/">Other Roast — Brazil</a>
<a href="https://elsewhere.invalid/recipes/not-ours/">external</a>
</nav></body></html>`),
  )
  routes.set(
    pagePaths.a,
    html(
      page({
        title: `Mock Roastery ${t} — Kenya Kiambu &amp; Friends`,
        spec: 'Kenya · Kiambu · SL28 · washed · light roast',
        notes: 'blackcurrant · tomato · cane sugar',
        hotYaml: yamlPaths.hotA,
        hotNote: 'Mock dial-in log.',
        iced: { yaml: yamlPaths.icedA, note: 'Mock iced note.' },
      }),
    ),
  )
  routes.set(
    pagePaths.b,
    html(
      page({
        title: `Other Roast ${t} — Brazil Cerrado`,
        spec: 'Brazil · Cerrado · Yellow Bourbon · natural · medium roast',
        notes: 'cocoa · hazelnut',
        hotYaml: yamlPaths.hotB,
        hotNote: 'Mock dial-in log B.',
      }),
    ),
  )
  routes.set(yamlPaths.hotA, yml(mockYaml({ name: `Mock Roastery Kenya ${t}`, dose: 16, grind: 59, temp: 94 })))
  routes.set(
    yamlPaths.icedA,
    yml(mockYaml({ name: `Mock Roastery Kenya Iced ${t}`, dose: 16, grind: 56, temp: 93, iced: true })),
  )
  routes.set(yamlPaths.hotB, yml(mockYaml({ name: `Other Roast Brazil ${t}`, dose: 15.5, grind: 62, temp: 91 })))

  const requests: MockRequest[] = []
  let inFlight = 0
  const site = {
    requests,
    maxInFlight: 0,
    latencyMs: 0,
  } as XBloomMockSite

  const server: Server = createServer((req, res) => {
    const startedAt = Date.now()
    inFlight += 1
    site.maxInFlight = Math.max(site.maxInFlight, inFlight)
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const route = routes.get(path) ?? { status: 404, body: 'not found', contentType: 'text/plain' }
    setTimeout(() => {
      res.writeHead(route.status, { 'content-type': route.contentType ?? 'text/plain' })
      res.end(route.body, () => {
        inFlight -= 1
        requests.push({ path, startedAt, endedAt: Date.now() })
      })
    }, site.latencyMs)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  site.origin = `http://127.0.0.1:${port}`
  site.url = `${site.origin}/`
  site.yamlPaths = yamlPaths
  site.pagePaths = pagePaths
  site.setRoute = (path, route) => void routes.set(path, route)
  site.close = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  return site
}
