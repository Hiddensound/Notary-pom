# Notary-POM

**Generates Playwright page objects containing only locators it has proven work against the live page.**

Point it at a URL. Notary-POM opens a real browser, waits for the page to actually stop moving, harvests
every interactive element, and then — for each one — tries a ladder of locator strategies **against the
running DOM** until one provably resolves to the exact element it observed. What it cannot prove, it
refuses to emit.

You get page objects, a smoke spec that passes on first generation, and a checked-in JSON *notebook*
recording every decision and every rejected candidate — which makes a re-crawl a readable diff of what
changed on the site.

---

## Why you'd use this

Every codegen tool will happily hand you `getByTestId('search')`. Notary-POM runs that locator against
the page first. Here is a real, unedited result from crawling a live storefront:

```
name: searchForInput2  |  locator: null   ← nothing was emitted
   tried testId       -> matched 2 | ambiguous
   tried testId       -> matched 1 | identity     ← ONE match, still rejected
   tried role         -> matched 1 | identity
   tried label        -> matched 1 | identity
   tried placeholder  -> matched 1 | identity
   ... 9 candidates, all rejected
```

Read `matched 1 | identity` again. The locator resolved to **exactly one element — and it was the wrong
one.** That page has two search boxes (header and sidebar widget). A tool that asks *"is this unique?"*
ships that locator with confidence. Notary-POM asks *"is this the element I actually harvested?"* — and
when it can't prove that, it emits **nothing**.

You get a visible gap you can fix, instead of a green test quietly asserting against the wrong box.

That's the whole premise: **never emit a guess.**

---

## Requirements

- Node.js 20+
- Chromium (installed via Playwright below)

## Install

```bash
npm install
```
```bash
npx playwright install chromium
```
```bash
npm run build
```

`npm run build` compiles `src/` and `mcp/` to `dist/`. The CLI entry point is `dist/src/cli.js` (also
exposed as the `pombuilder` bin once the package is installed globally or linked).

---

## Quickstart — a complete run in six steps

A real walkthrough against a public practice storefront (`scrapingcourse.com/ecommerce`, a site built for
exactly this kind of exercise). **Every output below is actual output from that run.**

### 1. Write a config

Create `demo.config.js` — a plain ES module, since this package is `"type": "module"`:

```js
export default {
  seed: 'https://www.scrapingcourse.com/ecommerce/',
  irDir: 'demo/.pombuilder',   // where the notebook is cached
  outDir: 'demo/tests',        // where generated code lands
  maxPages: 8,
};
```

> **Paths resolve from where you run the command**, not from the config file's location. If you keep the
> config in a subfolder, still write `irDir`/`outDir` relative to your repo root — and pass the real path
> to `-c` (e.g. `-c demo/demo.config.js`), including the `.js` extension.

### 2. Crawl

```bash
node dist/src/cli.js crawl -c demo.config.js
```

```
1 pages, 123 elements, 4 unresolved.
```

### 3. Read the receipt

The notebook lands at `demo/.pombuilder/notebook.json`. From that run:

| strategy | count |
|---|---|
| `role` | 56 |
| `css` (positional, fragile) | 39 |
| `testId` | 24 |
| **unresolved** | **4** |

Every element carries its full adjudication trail. Here's one that had to fall back:

```
name: defaultSortingSortByPopularity2   →  SHIPPED: css (fragile: true)
  tried testId  → matched 2 | ambiguous     ← the obvious locator was wrong
  tried testId  → matched 2 | ambiguous     ← retried scoped to its landmark, still wrong
```

That page has a `data-testid` that *looks* perfect. It matches **two** elements — the top and bottom
sorting forms. That's a flaky test you didn't ship.

**This step is where the value is.** Before writing a line of test code you can see how much of the page
is reliably addressable and how much is held together with positional paths — which is exactly the
evidence you need to go ask a developer for a handful of `data-testid` attributes.

### 4. Generate

```bash
node dist/src/cli.js generate -c demo.config.js
```

```
Wrote 3 files. Left 0 hand-owned files untouched.
```

### 5. Give the generated tests a Playwright config

Generated specs live under your `outDir`, so point a config at them. Create
`demo/tests/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'smoke', use: { headless: true } });
```

### 6. Run the generated smoke spec

```bash
npx playwright test -c demo/tests/playwright.config.ts
```

```
1 passed (5.4s)
```

119 locators asserted unique-and-visible against the live site — **passing by construction**, because
every one was verified before it was written. A failure here later is real signal about the site, never
generator sloppiness.

`crawl` + `generate` in one step is `build`:

```bash
node dist/src/cli.js build -c demo.config.js
```

---

## What you get

Three files per page:

```
<outDir>/pages/generated/<ClassName>.generated.ts   # regenerated every run
<outDir>/pages/<ClassName>.ts                       # yours — written once, never touched again
<outDir>/smoke/<ClassName>.smoke.spec.ts            # regenerated every run
```

**The generated base class** carries a header summary and inline warnings:

```ts
// GENERATED BY POMBUILDER — DO NOT EDIT
// route: /ecommerce
// page fingerprint: pg_608e1b06e30df986
// unresolved: 4
// fragile: 39

export abstract class EcommercePageBase {
  static readonly route = '/ecommerce';
  static readonly url = 'https://www.scrapingcourse.com/ecommerce';

  constructor(protected readonly page: Page) {}

  get abominableHoodieHeading(): Locator { return this.page.getByRole('heading', { name: 'Abominable Hoodie', exact: true }); }
  get defaultSortingSortByPopularity2(): Locator { return this.page.locator('body > div:nth-child(1) > ...'); } // fragile: positional CSS path

  async clickAddToCartAffirmWater(): Promise<void> { await this.addToCartAffirmWaterLink.click(); }
}
```

`// fragile: 39` plus the per-getter `// fragile:` markers mean you can see which locators are brittle
without opening the notebook. Single-element actions (`clickX`, `fillX`, `checkX`, `selectX`) are derived
from each element's role.

**The subclass is yours forever.** Notary-POM writes it once, the first time it sees that class name,
then never touches it again — so your multi-step flows survive every re-crawl:

```ts
export class EcommercePage extends EcommercePageBase {
  async addToCartAndCheckout(): Promise<void> { /* yours */ }
}
```

Generated code gets only what's mechanically derivable. Anything requiring judgement stays on your side
of the line.

---

## Drift detection and the CI gate

The notebook is meant to be **committed**. That makes `diff` a structural comparison of your whole site's
locator health — not a single failing selector discovered after a test already broke.

```bash
node dist/src/cli.js diff -c demo.config.js
```

Simulating a developer removing a `data-testid`:

```
/ecommerce  strategyChanged  defaultSortingSortByPopularity2  (testId -> css) [regression]
```

…and the process exits **2**. Against an unchanged site:

```
No drift detected.
```

…exit **0**.

| exit code | meaning |
|---|---|
| `0` | nothing changed |
| `1` | worst drift is `info` or `warning` |
| `2` | something **regressed** — block the merge |

| severity | assigned when |
|---|---|
| `info` | an element or page appeared, was renamed, or started resolving again |
| `warning` | an element or page disappeared, or a locator strategy changed |
| `regression` | a locator **stopped resolving**, or degraded to a `fragile` one |

So a CI gate is one exit-code check. Add `--json` for the full `DriftReport` if you want to feed it to
tooling instead.

> Two consecutive live crawls returning `No drift detected` is the determinism guarantee doing its job.
> Without it, a diff-based gate would cry wolf on every SPA.

---

## MCP server

Notary-POM ships an [MCP](https://modelcontextprotocol.io) server exposing the same pipeline as tools, so
an MCP-aware client (Claude Desktop, Claude Code, or anything else that speaks MCP) can drive it
directly. All logic stays in `src/` — the server is pure argument marshalling.

Build first, then add it to your client's MCP config — e.g. `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pombuilder": {
      "command": "node",
      "args": ["/absolute/path/to/pombuilder/dist/mcp/server.js"]
    }
  }
}
```

Tool surface, verified against the built server over a live stdio handshake:

| tool | arguments |
|---|---|
| `pombuilder_crawl` | `url` *(required)*, `irDir`, `maxPages`, `config` |
| `pombuilder_generate` | `outDir`, `irDir` |
| `pombuilder_diff` | `url` *(required)*, `irDir`, `config`, `json` |

**Worth knowing before you wire it up:**

- **Give it a few seconds to start.** The server imports Playwright at module load, so it isn't
  responsive instantly. A client with an aggressive startup timeout may declare it dead before it
  answers.
- **`config` is how you reach everything else.** The tool arguments are deliberately minimal; anything
  not listed (`contextOptions`/`storageState`, `exclude`, `loginDetection`, `maxDepth`, …) is set by
  pointing `config` at a config file, loaded through the same loader the CLI uses. **This is the only way
  to crawl an authenticated site over MCP.**
- **MCP has no process exit code**, so `pombuilder_diff` returns an `Overall severity: …` line ahead of
  the drift report instead, and `json: true` returns the same `DriftReport` shape the CLI's `--json`
  prints.
- **`pombuilder_generate` takes no `config` parameter** — it never opens a browser and has no auth
  surface, so it reads only `outDir`/`irDir`. A minor asymmetry with the CLI, noted here rather than
  papered over.
- The unstable-page warning that `crawl`/`diff` print to stderr is returned in the MCP tool result too.

---

## CLI reference

All four commands accept `-c, --config <path>`. `crawl`, `build` and `diff` also take a `[url]`
positional that overrides `seed` when both are given.

```bash
node dist/src/cli.js crawl <url> [-c config.js]
node dist/src/cli.js generate [-c config.js]
node dist/src/cli.js build <url> [-c config.js]
node dist/src/cli.js diff <url> [-c config.js] [--json]
```

- **`crawl`** — Crawls from `<url>`, harvests and resolves every interactive element and heading on one
  representative page per route template — plus any element carrying a `data-testid` (or your configured
  `testIdAttribute`) or a `status`/`alert` role; an ordinary label or paragraph with no stable handle of
  its own is not harvested. Writes `<irDir>/notebook.json`. Nothing under `outDir` is touched.
- **`generate`** — Notebook → TypeScript. Fails if no notebook exists yet.
- **`build`** — `crawl` then `generate`. The day-to-day command.
- **`diff`** — Re-crawls and compares against the stored notebook, writing nothing. Exits `0`/`1`/`2` by
  severity; `--json` emits the full report.

---

## Configuration

```js
export default {
  seed: 'https://example.com/',       // required unless passed on the CLI
  outDir: 'tests',                    // where generated files land
  irDir: '.pombuilder',               // where the notebook is cached
  maxDepth: 3,                        // link-hops from the seed to follow
  maxPages: 50,                       // hard cap on distinct URLs visited
  include: [],                        // if non-empty, only these path patterns are crawled
  exclude: [],                        // path patterns never crawled (matched against pathname only)
  testIdAttribute: 'data-testid',     // attribute checked first when locating elements
  loginUrlPattern: null,              // a substring checked against the landed URL (not a regex)
  loginDetection: 'identifier-first', // how aggressively a page is treated as a login page — see below
  respectRobots: true,                // honor the site's robots.txt
  contextOptions: {},                 // passed straight through to browser.newContext()
};
```

`include`/`exclude` match the URL **pathname only** (not the query string), so they can steer the crawler
away from whole sections but cannot distinguish two URLs differing only in query parameters.

### `contextOptions` — authenticated and gated crawls

Notary-POM **never logs in on its own** — if it lands on something that looks like a login page it aborts
loudly (`LoginRedirectError`) rather than harvesting a login form and calling it your app. To crawl
behind auth, hand it a session Playwright already established:

```js
export default {
  seed: 'https://app.example.com/dashboard',
  contextOptions: {
    // Cookie/session state saved earlier with `await context.storageState({ path })`.
    storageState: './.auth/state.json',

    // Header-based gates (staging bypass tokens, feature-flag headers, etc.).
    extraHTTPHeaders: { 'x-bypass-token': process.env.BYPASS_TOKEN ?? '' },

    // HTTP Basic Auth.
    httpCredentials: { username: 'demo', password: process.env.DEMO_PASSWORD },
  },
};
```

`contextOptions` is passed to `browser.newContext()` unmodified, with two conveniences: a falsy
`storageState` is dropped (so `storageState: process.env.STORAGE_STATE_PATH` needs no `if`), and any
`extraHTTPHeaders` entry whose value is an empty string is stripped (so an unset environment variable
never becomes the literal header value `"undefined"`).

### `loginDetection` — tuning the login-redirect guard

That abort is a heuristic, and one arm of it can false-positive: an ordinary **newsletter signup in a
site footer** (email input + submit button) looks identical to an identifier-first login screen (Okta,
Azure AD, Google Workspace, magic-link flows), which shows no password field on its first screen. A crawl
of an otherwise-public retail or marketing site can abort on that footer form.

| value | behavior |
|---|---|
| `'identifier-first'` **(default)** | `loginUrlPattern` match, OR a password field, OR an identifier field (email/username) paired with a submit control. |
| `'password-only'` | `loginUrlPattern` match, OR a password field. Drops the identifier+submit arm — **this is what fixes the newsletter false positive.** |
| `'off'` | No heuristics at all. For a site you know is fully public, or where `loginUrlPattern` alone should decide. |

`loginUrlPattern`, when set, is honored in **every** mode including `'off'` — it's explicit configuration
you supplied, not a heuristic, so relaxing detection never disables it.

The strict default is deliberate: a false abort is loud and one config line away from fixed, while a
false negative silently harvests an identity provider's DOM under your own site's name. If you hit
`LoginRedirectError` on a page you know isn't a login page, that's the setting to reach for.

### LLM name refinement (optional)

Deterministic naming falls back to a role/tag base (`button1`, `link2`, …) whenever an element has no
usable accessible name — commonly on a non-Latin-script site, since names are stripped to ASCII
identifiers. Notary-POM can optionally send those *weakly-named* elements to Claude for a better name.

- **What turns it on:** the `ANTHROPIC_API_KEY` environment variable — nothing in the config file. There
  is no separate opt-in and no dry-run: **exporting this variable silently turns every applicable
  `crawl` into a billed API call.** Unset it to keep `crawl` fully offline and free.
- **What gets sent,** per weakly-named element: `id`, `role`, `testId`, up to 60 characters of text, and
  the enclosing landmark. No locator, no selector, no surrounding page content.
- **Where it's cached:** `<irDir>/names.json`, keyed by element id, reused on every later crawl. Commit
  it so teammates and CI get refined names without a key.
- **On failure:** never fails the build — it falls back to deterministic names silently. The
  `@anthropic-ai/sdk` dependency is an optional peer dependency, imported lazily only when refinement
  actually runs.
- **How you'd notice you need it:** `crawl`/`build` warn when a page's naming degraded to role/tag
  fallback for most of its elements.

---

## `unresolved` elements

Every harvested element gets a `status` of `resolved` or `unresolved`. An element becomes `unresolved`
when no candidate locator could be proven: every one either matched zero elements, matched more than one
(even after narrowing to the element's own landmark), matched exactly one *hidden* element, or matched
exactly one element that **wasn't the one harvested**.

Notary-POM deliberately does not fall back to a weaker locator to force a resolution. An `unresolved`
element is left out of the base class entirely — no getter — rather than shipping something that looks
confident and breaks on the first markup shift. The count is printed by `crawl`/`build`, recorded in the
base class header (`// unresolved: N`), and every rejected candidate with its match count and reason is
kept in the notebook, so you can see exactly why and add a `data-testid` if you want it covered.

In this project's own acceptance run against a live public storefront, 119 of 123 harvested elements
resolved — about 97%.

---

## Known limitations

### Pages that never hold still

Before harvesting, Notary-POM waits for the network to go idle — which is what makes an SPA's
XHR-delivered content arrive *before* the harvest — then for two consecutive 500 ms windows in which the
DOM does not change, no request starts, and none is left outstanding.

**What that guarantees, precisely.** The crawl is deterministic for content whose request is issued
within 1 second of the page going network-idle. It is not deterministic beyond that, and it cannot tell
that it wasn't: past that edge, a page about to fetch something looks exactly like one that has finished
— nothing in flight, nothing moving, nothing left to observe. Every bounded wait has an edge; there is no
signal a page emits meaning "I am done." Measured, network-idle itself lands 2.0–2.1 s after
`domcontentloaded` on a React storefront and 0.55–0.92 s on a server-rendered WooCommerce page.

**What it costs.** ~1.5 s per page load for a page that settles promptly; up to ~3.6 s for one that keeps
making requests after going idle (an analytics beacon, a heartbeat), because each request restarts the
confirmation. There is no setting for the wait budget, deliberately — it's one of the few numbers that
determines whether the notebook is reproducible, and a per-site override would make "Notary-POM is
deterministic" a claim about someone's config rather than about the tool.

**What it warns about.** Some pages never satisfy the wait: a carousel, a ticker, a polling widget, a CSS
animation churning a class attribute, or a page holding a long-lived request open. Those are sampled at
an arbitrary point, so harvested elements can vary between runs and `diff` may report drift for elements
that never changed. `crawl`, `build` and `diff` name those pages on stderr with a reason.

The warning is deliberately narrow so it means something when it fires: a page whose background requests
never touch the DOM (analytics, telemetry, keep-alives) is **not** warned about — the DOM held still, the
harvest is identical to one without the beacon, and warning would fire on most commercial sites while
saying nothing about the harvest.

**What to do when it fires.** Open the page and see what moves — the reason says which kind it is. Then
check whether the page object actually has the members you need; the harvest is a real snapshot, just an
early one, and everything in it was verified against the live DOM. Re-run `crawl` and `diff` the two to
find which members are unreliable. If the page will genuinely never settle, keep the crawler off it with
`exclude` and hand-write that one page object against the generated base class — the base/subclass split
exists for exactly this. Use `exclude` for a page, never a whole site: a site-wide warning almost always
means an animation in shared chrome.

**What it does not warn about.** The notebook doesn't record which pages were unstable, so only the
*fresh* side of a `diff` is covered. If yesterday's baseline was written from a moving page and today's
site has settled, today's `diff` reports drift with nothing on stderr.

### Same-page, state-mutating links

The deny-list (`src/url/denyList.ts`) flags destructive-sounding words — `signout`, `logout`, `delete`,
`remove`, `cancel`, `deactivate`, `unsubscribe`, `destroy` — in a link's href or text. A plain
`<a href="?add-to-cart=123">` (a common WooCommerce pattern) reads as an ordinary link and passes
straight through. Following one mutates shared session state for the rest of the crawl, so a later
harvest of the same page can pick up elements a fresh browser session would never see — which is exactly
what a generated smoke spec runs in. Steer around these with `exclude` or a narrower `maxDepth`.

### Sites behind bot management

Akamai/Cloudflare-style protection commonly rejects headless Chromium at the protocol layer —
`net::ERR_HTTP2_PROTOCOL_ERROR` before any response arrives, even when a plain `curl` to the same URL
returns 200. That's the site declining automation, not a Notary-POM bug. Use a staging environment, or
get your test origin allowlisted by whoever owns the WAF configuration.

### Collections

Repeated-structure detection (parameterised accessors for product grids and similar) is a v1 stub. It
does not fire on real-world markup and is documented as a known limitation rather than a working feature.

---

## Fixed since the initial release

**robots.txt was checked against the wrong URL.** The link-discovery loop used to call `scrubUrl()`
(which strips a trailing slash, among other things) *before* checking `robots.isAllowed()`, so a
`Disallow` rule anchored with a trailing slash — a very common robots.txt idiom — could be silently
defeated for any query-string variant of that path. The check now runs against the original,
browser-resolved `href` before any normalisation, so a site's published rule is honoured exactly as
written. See `shouldFollow` in `src/crawl/crawl.ts` and its tests.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
