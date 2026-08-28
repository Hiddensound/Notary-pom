// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import type { ElementRecord } from '../types.js';
import { compareStrings } from '../util/order.js';

export function fingerprintElement(routeTemplate: string, r: ElementRecord): string {
  const identity = r.accessibleName ?? r.testId ?? r.domId ?? r.text ?? '';
  const parts = [routeTemplate, r.kind, r.role ?? '', identity, r.landmark ?? ''];
  return 'el_' + createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 12);
}

export function fingerprintPage(ariaSnapshot: string): string {
  return 'pg_' + createHash('sha256').update(ariaSnapshot).digest('hex').slice(0, 16);
}

// A route segment carries anything a URL path may carry: dots (`about.html`,
// `index.php`, `v1.2`), percent escapes (`caf%C3%A9`), apostrophes, plus signs. Splitting
// only on `-` and `_` let all of that through verbatim into an identifier position, so
// `/about.html` emitted `class About.htmlPageBase` -- TS1005 plus 19 further parse
// errors. Split on every non-alphanumeric run instead, and guard a leading digit the same
// way `deterministicName` does (capitalised here, to keep the class name PascalCase).
function routeStem(routeTemplate: string, keepParams: boolean): string {
  const words = routeTemplate
    .split('/')
    .filter((s) => s && (keepParams || !s.startsWith(':')))
    .map((s) => (s.startsWith(':') ? s.slice(1) : s))
    .flatMap((s) => s.split(/[^A-Za-z0-9]+/))
    .filter(Boolean);
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') || 'Root';
  return /^[0-9]/.test(pascal) ? 'N' + pascal : pascal;
}

export function classNameForRoute(routeTemplate: string): string {
  if (routeTemplate === '/') return 'HomePage';
  return routeStem(routeTemplate, false) + 'Page';
}

/**
 * `classNameForRoute` is deliberately lossy -- it drops `:param` segments -- so it is not
 * injective: `/blog` and `/blog/:param1` both reduce to `BlogPage`. `writeGenerated` keys
 * files by class name, so the second silently overwrote the first and an entire page
 * object plus its smoke spec vanished with the CLI still reporting it as written.
 *
 * Takes pages rather than route strings, and returns one name per page positionally.
 * Deduping route *strings* would collapse two pages that share a `routeTemplate` into one
 * entry and hand both the same class name -- and two pages genuinely can share one:
 * `validateGroups`' fallback keys on `new URL(url).pathname`, while `scrubUrl` keeps
 * `utm_*`, so `/p?utm_source=nav` and `/p?utm_source=footer` are two distinct URLs with
 * one pathname. `mergeRouteGroups` prevents that upstream; this signature is what makes
 * the invariant enforceable here instead of merely assumed.
 *
 * Every disambiguator is derived from the page itself, never from a counter or the page's
 * position in the notebook: the assignment depends on the *set* of pages, not the order
 * they arrive in, so a shift in crawl order cannot change the output and reruns stay
 * byte-identical.
 *
 *   tier 1  plain name                    /blog          -> BlogPage
 *   tier 2  parameter segments included   /blog/:param1  -> BlogParam1Page
 *   tier 3  sha256 prefix of the route    -> BlogRt<hex>Page, lengthened until free
 *
 * A tier is only taken when the name it produces is claimed by exactly one of the pages
 * still pending and is not already assigned, so no page can lose a name to whichever page
 * happened to be considered first. Tier 3 hashes the route template alone where it is
 * unique and the route template plus the representative URL where it is not, so two pages
 * sharing a route template still separate.
 */
export interface RoutedPage {
  routeTemplate: string;
  representativeUrl: string;
}

export function uniqueClassNames(pages: RoutedPage[]): string[] {
  const entries = pages
    .map((page, index) => ({ page, index }))
    .sort((a, b) =>
      compareStrings(a.page.routeTemplate, b.page.routeTemplate)
      || compareStrings(a.page.representativeUrl, b.page.representativeUrl)
      || a.index - b.index);

  const assigned = new Array<string | null>(pages.length).fill(null);
  const taken = new Set<string>();

  const tiers: Array<(page: RoutedPage) => string> = [
    (page) => classNameForRoute(page.routeTemplate),
    (page) => (page.routeTemplate === '/' ? 'HomePage' : routeStem(page.routeTemplate, true) + 'Page'),
  ];

  let pending = entries;
  for (const tier of tiers) {
    if (pending.length === 0) break;
    const names = pending.map((e) => tier(e.page));
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);

    const next: typeof pending = [];
    pending.forEach((e, i) => {
      const name = names[i];
      if (counts.get(name) === 1 && !taken.has(name)) {
        assigned[e.index] = name;
        taken.add(name);
      } else {
        next.push(e);
      }
    });
    pending = next;
  }

  const routeCounts = new Map<string, number>();
  for (const page of pages) {
    routeCounts.set(page.routeTemplate, (routeCounts.get(page.routeTemplate) ?? 0) + 1);
  }

  const keyed = pending.map((e) => ({
    entry: e,
    key: (routeCounts.get(e.page.routeTemplate) ?? 0) > 1
      ? `${e.page.routeTemplate}\u0000${e.page.representativeUrl}`
      : e.page.routeTemplate,
  }));

  // Two pages identical in both route template and representative URL hash to one key and
  // are indistinguishable to every tier. Letting the length-extension loop below separate
  // them would decide by position in the input -- exactly the order-dependence this
  // function exists to avoid -- so refuse instead. The notebook is malformed if this fires.
  const keyCounts = new Map<string, number>();
  for (const { key } of keyed) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  for (const { entry, key } of keyed) {
    if (keyCounts.get(key)! > 1) {
      throw new Error(
        `Cannot derive a unique class name for route ${JSON.stringify(entry.page.routeTemplate)} ` +
        `(${JSON.stringify(entry.page.representativeUrl)}): the notebook holds two pages ` +
        'identical in both route template and representative URL.',
      );
    }
  }

  for (const { entry, key } of keyed) {
    const stem = routeStem(entry.page.routeTemplate, false);
    const digest = createHash('sha256').update(key).digest('hex');
    let name = `${stem}Rt${digest.slice(0, 8)}Page`;
    for (let len = 16; taken.has(name) && len <= digest.length; len += 8) {
      name = `${stem}Rt${digest.slice(0, len)}Page`;
    }
    if (taken.has(name)) {
      // Requires every prefix length of a sha256 to collide with an already-assigned
      // name. Throwing keeps the function total rather than returning a duplicate the
      // caller would only discover by overwriting a file.
      throw new Error(
        `Cannot derive a unique class name for route ${JSON.stringify(entry.page.routeTemplate)}: ` +
        `every hash length for ${JSON.stringify(key)} is already taken.`,
      );
    }
    assigned[entry.index] = name;
    taken.add(name);
  }

  return assigned as string[];
}

// An aria snapshot embeds accessible names ( heading "Red Mug" ), which differ across
// two instances of the same template. Stripping the quoted names leaves the structure —
// roles, nesting and non-name attributes — which is what template validation compares.
export function structuralFingerprint(ariaSnapshot: string): string {
  const structure = ariaSnapshot
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n');
  return 'st_' + createHash('sha256').update(structure).digest('hex').slice(0, 16);
}
