# POMBuilder

POMBuilder crawls a web application, verifies every candidate locator against the live
page, and emits Playwright page objects and smoke specs from what it actually confirmed
— not from a guess. Locators are never generated from static markup alone: every
locator that ships in the output was counted, checked for visibility, and disambiguated
against the running page during the crawl.

## Install

```bash
npm install
npx playwright install chromium
npm run build
```

`npm run build` compiles `src/` and `mcp/` to `dist/`. The CLI entry point is
`dist/src/cli.js` (also exposed as the `pombuilder` bin once the package is installed
globally or linked).

## CLI commands

All four commands accept an optional `-c, --config <path>` pointing at a config file
(see [Config file](#config-file) below). `crawl`, `build` and `diff` also take a `[url]`
positional argument, which is the seed URL to crawl; it overrides `seed` in the config
file when both are given.

```bash
node dist/src/cli.js crawl <url> [-c config.js]
node dist/src/cli.js generate [-c config.js]
node dist/src/cli.js build <url> [-c config.js]
node dist/src/cli.js diff <url> [-c config.js]
```

- **`crawl`** — Crawls the site starting at `<url>`, harvests and resolves every
  interactive element and heading on one representative page per route template — plus
  any other element that carries a `data-testid` (or configured `testIdAttribute`) or
  has role `status`/`alert`; an ordinary label or paragraph with no stable handle of its
  own is not harvested — and writes the result as a notebook (`<irDir>/notebook.json`,
  default `.pombuilder/notebook.json`). Prints a one-line summary: pages found, elements
  harvested, elements left unresolved. Nothing under `outDir` is touched. If any page
  had to be sampled before it stopped changing, a warning naming those pages is printed
  to stderr — see [Pages that never hold still](#pages-that-never-hold-still).
- **`generate`** — Reads the stored notebook and turns it into TypeScript: one base
  class per page (locators, single-element actions), one subclass per page (yours to
  extend), and one smoke spec per page. Fails if no notebook exists yet — run `crawl`
  first.
- **`build`** — `crawl` followed by `generate` in one step. This is the command most
  projects want day to day.
- **`diff`** — Re-crawls the same site and compares the fresh result against the
  stored notebook, without writing anything. Reports pages added or removed and, per
  element, whether it was added, removed, renamed, changed locator strategy, or
  flipped between resolved and unresolved. Use this in CI to catch locator drift
  before it silently breaks a page object. It prints the same unstable-page warning as
  `crawl`, because that is the first thing to check when a diff looks larger than the
  change that caused it.

## Config file

A config file is a plain ES module (`.js`, since this package is `"type": "module"`)
whose default export is a `Partial<PomBuilderConfig>` — every field is optional and
falls back to a documented default. See [`pombuilder.config.js`](./pombuilder.config.js)
in this repo for a working example (used by this project's own acceptance run against a
live third-party site).

```js
// pombuilder.config.js
export default {
  seed: 'https://example.com/',       // default: none — required unless passed on the CLI
  outDir: 'tests',                    // default: 'tests' — where generated files land
  irDir: '.pombuilder',               // default: '.pombuilder' — where the notebook is cached
  maxDepth: 3,                        // default: 3 — how many link-hops from the seed to follow
  maxPages: 50,                       // default: 50 — hard cap on distinct URLs visited
  include: [],                        // default: [] — if non-empty, only these path patterns are crawled
  exclude: [],                        // default: [] — path patterns never crawled (matched against pathname only)
  testIdAttribute: 'data-testid',     // default: 'data-testid' — attribute checked first when locating elements
  loginUrlPattern: null,              // default: null — a substring checked against the landed URL (not a regex); matching it mid-crawl aborts as a login redirect
  respectRobots: true,                // default: true — honor the site's robots.txt
  contextOptions: {},                 // default: {} — passed straight through to playwright's browser.newContext()
};
```

`include`/`exclude` match against the URL **pathname only** (not the query string), so
they can steer the crawler away from whole sections of a site but cannot distinguish
two URLs that differ only in query parameters.

### `contextOptions` — authenticated and gated crawls

POMBuilder never logs in on its own — if it lands on something that looks like a login
page mid-crawl it aborts loudly (`LoginRedirectError`) rather than harvesting a login
form and calling it the target page. To crawl behind auth, put Playwright's own context
options in `contextOptions`; they are passed through to `browser.newContext()`
unmodified, with two conveniences: a `storageState` that is falsy is dropped (so you can
write `storageState: process.env.STORAGE_STATE_PATH` without an `if`), and any
`extraHTTPHeaders` entry whose value is an empty string is stripped (so an unset
environment variable never becomes the literal header value `"undefined"`).

```js
export default {
  seed: 'https://app.example.com/dashboard',
  contextOptions: {
    // Cookie/session state saved earlier with `await context.storageState({ path })`.
    storageState: './.auth/state.json',

    // Header-based gates (staging bypass tokens, feature-flag headers, etc.).
    extraHTTPHeaders: {
      'x-bypass-token': process.env.BYPASS_TOKEN ?? '',
    },

    // HTTP Basic Auth.
    httpCredentials: { username: 'demo', password: process.env.DEMO_PASSWORD },
  },
};
```

### LLM name refinement

Deterministic naming falls back to a role/tag base (`button1`, `link2`, ...) whenever an
element has no usable accessible name — commonly on a non-Latin-script site, since
`deterministicName` strips non-ASCII characters. POMBuilder can optionally send those
*weakly-named* elements to Claude for a better name.

**What turns it on.** Setting the `ANTHROPIC_API_KEY` environment variable — nothing in
the config file — is what enables refinement. If it's set, every `crawl` that harvests
any weakly-named element not already in the cache makes a paid Anthropic API call.
There is no separate opt-in and no dry-run: **exporting this variable silently turns
every applicable `crawl` into a billed API call.** Unset it (or don't set it) to keep
`crawl` fully offline and free.

**What gets sent.** Per weakly-named element: its `id`, `role`, `testId`, up to 60
characters of its text content, and its enclosing landmark (`src/name/llm.ts`'s
`anthropicCall`). No locator, no selector, and no surrounding page content is sent —
only that small, per-element identifying record.

**Where the result is cached.** Suggested names are cached at `<irDir>/names.json`,
keyed by element id, and reused on every later `crawl` — an element already in the
cache is never re-sent. This file is meant to be committed alongside the notebook, so a
teammate (or CI) without `ANTHROPIC_API_KEY` set still gets the refined names.

**What happens on failure.** A request or API failure never fails the build: refinement
falls back to the deterministic name for whatever it couldn't get, silently. The
`@anthropic-ai/sdk` dependency itself is an optional peer dependency, imported lazily
only when refinement actually runs, so it is not required at all when
`ANTHROPIC_API_KEY` is unset.

**How you'd notice this without reading the code.** `crawl`/`build` print a warning
(`formatWeakNaming`) whenever a page's naming looks like it degraded to the role/tag
fallback for most of its elements — that warning is also what tells you to consider
setting `ANTHROPIC_API_KEY` in the first place.

## The base/subclass split

`generate` (and `build`) write three files per page object under `outDir`:

```
tests/pages/generated/<ClassName>.generated.ts   # base class — regenerated every run
tests/pages/<ClassName>.ts                        # subclass — written once, then left alone
tests/smoke/<ClassName>.smoke.spec.ts             # smoke spec — regenerated every run
```

The **base class** (`<ClassName>Base`) holds every locator getter, single-element
action (`clickX`, `fillX`, `checkX`, `selectX`), and collection accessor POMBuilder
resolved. It is marked `// GENERATED BY POMBUILDER — DO NOT EDIT` and is overwritten on every
`generate`/`build` run — re-crawling a site whose markup hasn't changed produces
byte-for-byte identical output.

The **subclass** (`<ClassName>`) is where you add multi-step flows (`addToCartAndCheckout()`,
page-specific assertions, whatever your tests need). POMBuilder writes it exactly once,
the first time it sees that class name, with an empty body extending the base class. On
every later run it checks whether the file already exists and, if so, leaves it
completely untouched — your hand edits are safe no matter how many times you re-crawl.

The **smoke spec** is also regenerated every run. It asserts every resolved locator on
the page has a unique, visible match, so a broken locator shows up as a normal test
failure the next time you run it, before anyone builds a real test on top of it.

## `unresolved` elements

Every element POMBuilder harvests gets a `status` of `resolved` or `unresolved`. An
element becomes `unresolved` when POMBuilder could not find one single, visible match
for any of its candidate locators — every candidate either matched zero elements,
matched more than one (even after narrowing the search to the element's own landmark),
or matched exactly one element that turned out to be hidden.

POMBuilder deliberately does not fall back to a weaker locator (a brittle CSS path, an
`nth()` index) to force a resolution. An `unresolved` element is left out of the base
class entirely — no getter is emitted for it — rather than shipping a locator that
looks confident and breaks the first time the page's markup shifts. The `unresolved`
count is printed by `crawl`/`build` and recorded in the base class's header comment
(`// unresolved: N`), and every rejected candidate — with its match count and reason —
is kept in the notebook so you can see exactly why an element didn't resolve and add a
`data-testid` (or similar) if you want it covered.

In this project's own acceptance run against a live public storefront
(`https://www.scrapingcourse.com/ecommerce/`), 120 of 123 harvested elements resolved —
about 97.6%.

## MCP server

`mcp/server.ts` (built to `dist/mcp/server.js`) exposes the same crawl/generate/diff
pipeline as three MCP tools — `pombuilder_crawl`, `pombuilder_generate`,
`pombuilder_diff` — so an MCP-aware client can drive POMBuilder directly. The tools do
pure argument marshalling; all of the actual logic still lives in `src/`.

Add it to `claude_desktop_config.json`:

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

Run `npm run build` first so `dist/mcp/server.js` exists. The server speaks stdio MCP and
takes no flags of its own — all configuration (seed URL, `irDir`, `maxPages`, `outDir`)
is passed per tool call as arguments.

## Known limitations

### Pages that never hold still

Before harvesting, POMBuilder waits for a page to stop changing: first for the network
to go idle — which is what makes a single-page app's XHR-delivered content arrive
before, rather than after, the harvest — and then for two consecutive 500 ms windows in
which the DOM does not change, no request starts, and none is left outstanding.

**What that guarantees, precisely.** The crawl is deterministic with respect to content
whose request is issued within 1 second of the page going network-idle. It is not
deterministic beyond that, and it cannot tell that it was not: past that edge a page
that is about to fetch something looks exactly like one that has finished — nothing in
flight, nothing moving, nothing left to observe — so POMBuilder records it as settled
and says nothing. The edge is a real number rather than a promise because every bounded
wait has one; there is no signal a page emits that means "I am done." In practice the
edge lands well past a second after `domcontentloaded`, because network-idle itself does
not arrive until the page has finished its initial burst (measured at 2.0-2.1 s after
`domcontentloaded` on a React storefront and 0.55-0.92 s on a server-rendered WooCommerce
page, the slower end of each on a cold cache).

**What it costs.** A page that settles promptly costs about 1.5 s per page load. A page
that keeps making requests after it has gone idle -- an analytics beacon, a heartbeat, a
session ping -- costs up to about 3.6 s instead, because each request restarts the
confirmation and the wait runs to its internal limit. That is the ceiling, not the
typical case, and it is per page load: a crawl of a beacon-carrying site is slower by
roughly two seconds per page and route template. There is no setting for it.

**What it warns about.** Some pages never satisfy the wait at all: a carousel, a ticker,
a polling widget, a CSS animation that churns a class attribute, or a page holding a
long-lived request open (server-sent events, a long poll). Those are sampled at an
arbitrary point rather than at a settled one, so the elements harvested from them can
vary between runs and `diff` may report drift for elements that never actually changed.
`crawl`, `build` and `diff` all name those pages on stderr, and the `pombuilder_crawl`
and `pombuilder_diff` MCP tools return the same text in their tool result.

The warning is deliberately narrow, so that it means something when it fires. A page
whose background requests never touch the DOM — analytics, telemetry, a keep-alive — is
**not** warned about, even though those requests do make the page slower to settle: the
DOM held still throughout, the harvest is the same one an identical page without the
beacon would produce, and warning about it would fire on most commercial sites while
saying nothing about the harvest. What is warned about is a page whose DOM was still
changing, or still being changed by arriving content, when POMBuilder had to stop
looking.

**What to do when it fires.** In order:

1. **Open the page and look at what moves.** The reason on each line says which kind it
   is: `the DOM never stopped changing` is an animation, carousel or ticker;
   `the page kept making requests` is content still streaming in; `the network never went
   idle` is a long-lived connection.
2. **Check the getters for that page object.** The harvest is a real snapshot, just an
   early one, and everything in it was verified against the live DOM at the time. What a
   warning means is that elements may be *missing*, not that the ones present are wrong.
   If the page object has the members you need, the warning costs you nothing.
3. **Re-run `crawl` and `diff` the two.** Drift on a warned page between two runs of an
   unchanged site tells you which members are the unreliable ones.
4. **If the page is genuinely never going to hold still**, keep the crawler off it with
   `exclude`, and hand-write that one page object against the generated base class — the
   base/subclass split exists for exactly this. Use `exclude` for a page, never for a
   whole site: a site-wide warning almost always means an animation in shared chrome (a
   header carousel, a marquee), and excluding every page is not the remedy.

**What it does not warn about.** The notebook does not record which pages were unstable,
so only the *fresh* side of a `diff` is covered. If yesterday's `build` wrote its
baseline from a moving page and today's site has settled, today's `diff` reports drift
with nothing on stderr — the current crawl was fine, and the notebook cannot say the
stored one was not. If a `diff` looks larger than the change that caused it, check the
crawl log that produced the baseline before you suspect the site.

There is no setting for the wait budget, deliberately: it is one of the few numbers that
determines whether the notebook is reproducible, and a per-site override would make
"POMBuilder is deterministic" a claim about someone's config rather than about the tool.

**Same-page, state-mutating links aren't recognised as such.** The deny-list
(`src/url/denyList.ts`) only flags destructive-sounding words — sign-out, delete,
remove, cancel, deactivate, unsubscribe, destroy — in a link's href or text. A plain
`<a href="?add-to-cart=123">` (a common WooCommerce pattern, among others) reads as an
ordinary link and passes straight through. If the crawler follows one, it mutates
shared session state (a server-side cart, in that example) for the rest of the crawl,
so a *later* harvest of what looks like the same, unchanged page can pick up elements
that only exist because of that earlier visit — and those elements will not exist in a
fresh browser session, which is exactly what a generated smoke spec runs in. This
surfaced for real during this project's own acceptance run against
`https://www.scrapingcourse.com/ecommerce/` (see `pombuilder.config.js`'s comments for
the full trace) and is not something POMBuilder currently detects or guards against; if
a target site has this shape of link, steer the crawler around it with `exclude` (or a
narrower `maxDepth`) rather than relying on the deny-list to catch it.

## Fixed since the initial release

**robots.txt was checked against the wrong URL.** `src/crawl/crawl.ts`'s
link-discovery loop used to call `scrubUrl()` (which, among other things, strips a
trailing slash) *before* checking `robots.isAllowed()`, so a `Disallow` rule anchored
with a trailing slash — a very common robots.txt idiom — could be silently defeated for
any query-string variant of that path. The check now runs against the original,
browser-resolved `href`, before any normalisation, so a site's published rule is
honoured exactly as written regardless of what URL canonicalisation happens afterwards.
See `shouldFollow` in `src/crawl/crawl.ts` and its tests in `tests/unit/crawl.test.ts`
for the fixed behaviour and the regression it guards against.
