// SPDX-License-Identifier: Apache-2.0

import type { Browser, Route } from '@playwright/test';
import robotsParserImport from 'robots-parser';
import type { Notebook, PageIR, PomBuilderConfig } from '../types.js';
import { createContext } from '../browser/context.js';
import { settle } from '../browser/settle.js';
import { LoginRedirectError, looksLikeLogin } from '../browser/guard.js';
import { harvest } from '../harvest/harvest.js';
import { resolveElements } from '../resolve/resolve.js';
import { templateRoutes } from '../url/routeTemplate.js';
import { scrubUrl } from '../url/scrub.js';
import { isDenied } from '../url/denyList.js';
import { buildNotebook, buildPageIR } from '../ir/build.js';
import { fingerprintPage } from '../ir/fingerprint.js';

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
interface Robots {
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

export async function crawlSite(
  browser: Browser,
  config: PomBuilderConfig,
  routeHandler?: (route: Route) => Promise<unknown>,
): Promise<Notebook> {
  const context = await createContext(browser, config);
  if (routeHandler) await context.route('**/*', routeHandler);

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
    await settle(page);

    if (await looksLikeLogin(page, config)) {
      await context.close();
      throw new LoginRedirectError(page.url());
    }

    discovered.push(url);
    if (depth >= config.maxDepth) continue;

    const links = await page.$$eval('a[href]', (nodes) =>
      nodes.map((n) => ({ href: (n as HTMLAnchorElement).href, text: n.textContent?.trim() ?? '' })));

    for (const link of links) {
      if (isDenied(link.href, link.text)) continue;
      let next: string;
      try { next = scrubUrl(link.href); } catch { continue; }
      if (new URL(next).origin !== origin) continue;
      const pathname = new URL(next).pathname;
      if (config.exclude.length && matchesAny(pathname, config.exclude)) continue;
      if (config.include.length && !matchesAny(pathname, config.include)) continue;
      if (robots && !robots.isAllowed(next)) continue;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ url: next, depth: depth + 1 });
    }
  }

  // ---- pass 2: harvest one representative per route template ----
  const pages: PageIR[] = [];

  for (const group of templateRoutes(discovered)) {
    await page.goto(group.representativeUrl, { waitUntil: 'domcontentloaded' });
    await settle(page);

    if (await looksLikeLogin(page, config)) {
      await context.close();
      throw new LoginRedirectError(page.url());
    }

    const snapshot = await page.locator('body').ariaSnapshot();
    const records = await harvest(page, config.testIdAttribute);
    const { elements, collections } = await resolveElements(page, records, group.routeTemplate);

    pages.push(buildPageIR({
      group,
      pageFingerprint: fingerprintPage(snapshot),
      elements,
      collections,
    }));
  }

  await context.close();
  return buildNotebook(origin, pages, new Date().toISOString());
}
