// SPDX-License-Identifier: Apache-2.0

import type { Browser, Page, Route } from '@playwright/test';
import robotsParserImport from 'robots-parser';
import type { Notebook, PageIR, PomBuilderConfig, RouteGroup } from '../types.js';
import { createContext } from '../browser/context.js';
import { settle } from '../browser/settle.js';
import type { UnstableReason } from '../browser/settle.js';
import { LoginRedirectError, looksLikeLogin } from '../browser/guard.js';
import { harvest } from '../harvest/harvest.js';
import { resolveElements } from '../resolve/resolve.js';
import { mergeRouteGroups, templateRoutes } from '../url/routeTemplate.js';
import { scrubUrl } from '../url/scrub.js';
import { isDenied } from '../url/denyList.js';
import { buildNotebook, buildPageIR } from '../ir/build.js';
import { fingerprintPage, structuralFingerprint } from '../ir/fingerprint.js';
import { compareStrings } from '../util/order.js';

// robots-parser's shipped index.d.ts declares its export with ESM `export default`
// syntax, but the package has no "type": "module" in package.json (its runtime is
// `module.exports = function robotsParser() {...}`), so under NodeNext module
// resolution TypeScript treats the .d.ts as CommonJS-implied: a default import then
// binds to the whole module-namespace object instead of the function, and it has no
// call signatures. This reproduces identically with `import x from 'robots-parser'`
// and `import x = require('robots-parser')`, so it is not an import-style mistake --
// it is how the package's own types are authored. There is no @types/robots-parser
// package on npm (registry 404) to pull a corrected declaration from instead. This
// local interface mirrors the Robots shape robots-parser documents in its own
// index.d.ts, and the cast through `unknown` recovers a precisely-typed, callable
// function rather than reaching for `any`.
export interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
  getMatchingLineNumber(url: string, ua?: string): number;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
  getPreferredHost(): string | null;
}
const robotsParser = robotsParserImport as unknown as (url: string, robotstxt: string) => Robots;

function matchesAny(pathname: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp('^' + p.replace(/\*/g, '.*') + '$').test(pathname));
}

/**
 * Which visit of a URL was sampled before the page stabilised.
 *
 * - `discover` -- pass 1. The page's links may be incomplete, so routes it would have
 *   led to may be missing from the crawl entirely.
 * - `validate` -- the two-sample structural comparison behind a route template. An
 *   unstable sample makes a *disagreement* untrustworthy; see `validateGroups`.
 * - `harvest`  -- pass 2, the DOM the generated page object is built from. The most
 *   consequential of the three: elements may be missing, and `pombuilder diff` will
 *   report their absence as drift on the next run.
 */
export type SettlePhase = 'discover' | 'validate' | 'harvest';

export interface UnstablePage {
  url: string;
  phase: SettlePhase;
  // Narrowed to exclude `quiet`: an `UnstablePage` is only ever constructed for a page
  // `settle` refused to call stable, so `quiet` is not a state this can reach. The
  // narrowing is what deletes the corresponding branch from `WHY` below, which would
  // otherwise have been able to render the word "stabilised" underneath a heading saying
  // the page did not stabilise.
  reason: UnstableReason;
  elapsedMs: number;
}

export type UnstableReporter = (page: UnstablePage) => void;

// `network` and `pending` were one reason until they were measured apart: a page that
// never reached idle and a page that reached it and then kept making requests are
// different diagnoses, and the single string used to be wrong for the second of them.
const WHY: Record<UnstableReason, string> = {
  network: 'the network never went idle, so content may still have been arriving',
  pending: 'the page kept making requests, so content may still have been arriving',
  mutation: 'the DOM never stopped changing',
  budget: 'the settle budget ran out',
  error: 'the stability check could not be run',
};

// How many individual page loads the warning names before summarising the rest.
const MAX_LISTED = 10;

/**
 * Render the unstable-page report for a human. Shared by the CLI and the MCP server so
 * both say the same thing; a crawl that sampled a moving page must not look like one
 * that did not.
 */
export function formatUnstable(pages: UnstablePage[]): string {
  if (pages.length === 0) return '';
  // Every page is reported once per visit, so a 50-page animated site would otherwise
  // emit 100+ lines of stderr and bury the one line that says how widespread it is. The
  // count is never truncated; only the list is.
  const lines = pages.slice(0, MAX_LISTED).map(
    (p) => `  ${p.url} (${p.phase}, ${p.elapsedMs}ms): ${WHY[p.reason]}.`);
  if (pages.length > MAX_LISTED) lines.push(`  ... and ${pages.length - MAX_LISTED} more.`);
  return `Warning: ${pages.length} page load${pages.length === 1 ? ' was' : 's were'} sampled `
    + 'before the page stabilised. The harvest may be incomplete, and `pombuilder diff` may '
    + 'report drift for elements that never actually changed.\n'
    + lines.join('\n');
}

// `settle` returns a result rather than void precisely so exhaustion is not silence. The
// crawl's reaction is the same at all three call sites -- record it and carry on -- and
// deliberately so: aborting would throw away a usable partial result over a page the site
// may simply always animate, and retrying an unstable page just spends the budget twice
// on a page that by construction is not going to hold still.
async function settleAt(
  page: Page,
  phase: SettlePhase,
  report: UnstableReporter | undefined,
): Promise<void> {
  const result = await settle(page);
  if (!result.stable) {
    // `page.url()`, not the URL the crawl asked for: under a redirect those differ, and
    // the one worth naming is the page actually sampled. This is only the message --
    // comparing that URL's origin to the seed is a different, deliberately deferred job.
    report?.({ url: page.url(), phase, reason: result.reason, elapsedMs: result.elapsedMs });
  }
}

// Pass 1's per-link filtering decision, pulled out as a pure function so it is directly
// unit-testable (a real `robots-parser` instance, no browser) rather than only reachable
// through a full `crawlSite` run.
//
// The robots.txt check runs against `link.href` -- the browser-resolved, un-normalised
// URL -- and NOT against `scrubUrl`'s output. `scrubUrl` strips a trailing slash (among
// other things), and a `Disallow` rule anchored with a trailing slash (a common
// robots.txt idiom) would otherwise be silently defeated for every query-string variant
// of that same path: `/ecommerce/?x=1` is blocked by `Disallow: /ecommerce/`, but the
// scrubbed `/ecommerce?x=1` is not, because it no longer starts with `/ecommerce/`.
// Checking the raw href first means the site's own published rule is honoured exactly
// as written, regardless of what URL-canonicalisation happens afterwards.
export function shouldFollow(
  link: { href: string; text: string },
  origin: string,
  config: PomBuilderConfig,
  robots: Robots | null,
): string | null {
  if (isDenied(link.href, link.text)) return null;
  if (robots && !robots.isAllowed(link.href)) return null;

  let next: string;
  try { next = scrubUrl(link.href); } catch { return null; }
  if (new URL(next).origin !== origin) return null;

  const pathname = new URL(next).pathname;
  if (config.exclude.length && matchesAny(pathname, config.exclude)) return null;
  if (config.include.length && !matchesAny(pathname, config.include)) return null;

  return next;
}

// The spec validates a route template by comparing two of its samples. Templates with a
// single sample are trivially consistent and cost nothing to accept.
export async function validateGroups(
  page: Page,
  groups: RouteGroup[],
  config: PomBuilderConfig,
  report?: UnstableReporter,
): Promise<RouteGroup[]> {
  const out: RouteGroup[] = [];

  for (const group of groups) {
    if (group.sampleUrls.length < 2 || !group.routeTemplate.includes(':param')) {
      out.push(group);
      continue;
    }

    const [first, second] = [group.representativeUrl, group.sampleUrls[1]];
    const prints: string[] = [];
    for (const url of [first, second]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await settleAt(page, 'validate', report);
      if (await looksLikeLogin(page, config)) throw new LoginRedirectError(page.url());
      prints.push(structuralFingerprint(await page.locator('body').ariaSnapshot()));
    }

    if (prints[0] === prints[1]) {
      out.push(group);
      continue;
    }

    // Structures disagree: the URL shape was a coincidence, not a template. Fall back to
    // one literal route per sample rather than emitting a page object that is right for
    // some of them and quietly wrong for the rest.
    //
    // An unstable sample makes a disagreement here untrustworthy -- two fingerprints can
    // differ because the pages really are different shapes, or because one of them was
    // photographed mid-render -- but the fallback is still the right answer under that
    // uncertainty: one page object per sample is never wrong for any of them, whereas
    // merging on a coincidence is quietly wrong for some. So instability is reported
    // above and deliberately does not change the decision made here.
    //
    // Two samples can share a pathname -- `scrubUrl` keeps `utm_*`, so `/p?utm_source=nav`
    // and `/p?utm_source=footer` are distinct URLs here -- and the route template is the
    // pathname, so `mergeRouteGroups` below folds those back into one group. Without it
    // the notebook carries two pages with one route template, which `uniqueClassNames`
    // cannot separate by route alone and `diffNotebooks` silently drops one of.
    for (const url of group.sampleUrls) {
      out.push({
        routeTemplate: new URL(url).pathname,
        representativeUrl: url,
        sampleUrls: [url],
      });
    }
  }

  return mergeRouteGroups(out);
}

export async function crawlSite(
  browser: Browser,
  config: PomBuilderConfig,
  routeHandler?: (route: Route) => Promise<unknown>,
  onUnstable?: UnstableReporter,
): Promise<Notebook> {
  const context = await createContext(browser, config);
  if (routeHandler) await context.route('**/*', routeHandler);

  try {
    const origin = new URL(config.seed).origin;
    let robots: ReturnType<typeof robotsParser> | null = null;

    const page = await context.newPage();

    if (config.respectRobots && !routeHandler) {
      try {
        const res = await page.request.get(`${origin}/robots.txt`);
        if (res.ok()) robots = robotsParser(`${origin}/robots.txt`, await res.text());
      } catch { /* no robots.txt is not an error */ }
    }

    // ---- pass 1: discover URLs ----
    const seed = scrubUrl(config.seed);
    const queue: Array<{ url: string; depth: number }> = [{ url: seed, depth: 0 }];
    const seen = new Set<string>([seed]);
    const discovered: string[] = [];

    while (queue.length && discovered.length < config.maxPages) {
      const { url, depth } = queue.shift()!;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await settleAt(page, 'discover', onUnstable);

      if (await looksLikeLogin(page, config)) {
        throw new LoginRedirectError(page.url());
      }

      discovered.push(url);
      if (depth >= config.maxDepth) continue;

      const links = await page.$$eval('a[href]', (nodes) =>
        nodes.map((n) => ({ href: (n as HTMLAnchorElement).href, text: n.textContent?.trim() ?? '' })));

      for (const link of links) {
        const next = shouldFollow(link, origin, config, robots);
        if (!next) continue;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push({ url: next, depth: depth + 1 });
      }
    }

    // ---- pass 2: harvest one representative per route template ----
    const pages: PageIR[] = [];

    const groups = await validateGroups(page, templateRoutes(discovered), config, onUnstable);
    for (const group of groups) {
      await page.goto(group.representativeUrl, { waitUntil: 'domcontentloaded' });
      await settleAt(page, 'harvest', onUnstable);

      if (await looksLikeLogin(page, config)) {
        throw new LoginRedirectError(page.url());
      }

      const snapshot = await page.locator('body').ariaSnapshot();
      const records = await harvest(page, config.testIdAttribute);
      const { elements, collections } = await resolveElements(
        page, records, group.routeTemplate, config.testIdAttribute);

      pages.push(buildPageIR({
        group,
        pageFingerprint: fingerprintPage(snapshot),
        elements,
        collections,
      }));
    }

    return buildNotebook(origin, pages, new Date().toISOString());
  } finally {
    await context.close();
  }
}
