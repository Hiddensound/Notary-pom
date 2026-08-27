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
  interactive element, heading and label on one representative page per route
  template, and writes the result as a notebook (`<irDir>/notebook.json`, default
  `.pombuilder/notebook.json`). Prints a one-line summary: pages found, elements
  harvested, elements left unresolved. Nothing under `outDir` is touched.
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
  before it silently breaks a page object.

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
  loginUrlPattern: null,              // default: null — regex-ish string; matching it mid-crawl aborts as a login redirect
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

## The base/subclass split

`generate` (and `build`) write three files per page object under `outDir`:

```
tests/pages/generated/<ClassName>.generated.ts   # base class — regenerated every run
tests/pages/<ClassName>.ts                        # subclass — written once, then left alone
tests/smoke/<ClassName>.smoke.spec.ts             # smoke spec — regenerated every run
```

The **base class** (`<ClassName>Base`) holds every locator getter, single-element
action (`clickX`, `fillX`, `checkX`), and collection accessor POMBuilder resolved. It
is marked `// GENERATED BY POMBUILDER — DO NOT EDIT` and is overwritten on every
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

**Fixed in this same round: robots.txt was checked against the wrong URL.**
`src/crawl/crawl.ts`'s link-discovery loop used to call `scrubUrl()` (which, among
other things, strips a trailing slash) *before* checking `robots.isAllowed()`, so a
`Disallow` rule anchored with a trailing slash — a very common robots.txt idiom — could
be silently defeated for any query-string variant of that path. The check now runs
against the original, browser-resolved `href`, before any normalisation, so a site's
published rule is honoured exactly as written regardless of what URL canonicalisation
happens afterwards. See `shouldFollow` in `src/crawl/crawl.ts` and its tests in
`tests/unit/crawl.test.ts` for the fixed behaviour and the regression it guards against.
