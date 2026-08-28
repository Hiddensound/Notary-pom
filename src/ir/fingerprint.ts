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
 * Every disambiguator here is derived from the route itself, never from a counter or the
 * page's position in the notebook: the assignment depends on the *set* of routes, not the
 * order they arrive in, so a shift in crawl order cannot change the output and reruns stay
 * byte-identical.
 *
 *   tier 1  plain name                    /blog          -> BlogPage
 *   tier 2  parameter segments included   /blog/:param1  -> BlogParam1Page
 *   tier 3  sha256 prefix of the route    -> BlogRt<hex>Page, lengthened until free
 *
 * A tier is only taken when the name it produces is claimed by exactly one of the routes
 * still pending and is not already assigned, so no route can lose a name to whichever
 * route happened to be considered first.
 */
export function uniqueClassNames(routeTemplates: string[]): Map<string, string> {
  const routes = [...new Set(routeTemplates)].sort(compareStrings);
  const assigned = new Map<string, string>();
  const taken = new Set<string>();

  const tiers: Array<(route: string) => string> = [
    (route) => classNameForRoute(route),
    (route) => (route === '/' ? 'HomePage' : routeStem(route, true) + 'Page'),
  ];

  let pending = routes;
  for (const tier of tiers) {
    if (pending.length === 0) break;
    const names = new Map(pending.map((route) => [route, tier(route)]));
    const counts = new Map<string, number>();
    for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);

    const next: string[] = [];
    for (const route of pending) {
      const name = names.get(route)!;
      if (counts.get(name) === 1 && !taken.has(name)) {
        assigned.set(route, name);
        taken.add(name);
      } else {
        next.push(route);
      }
    }
    pending = next;
  }

  for (const route of pending) {
    const stem = routeStem(route, false);
    const digest = createHash('sha256').update(route).digest('hex');
    let name = `${stem}Rt${digest.slice(0, 8)}Page`;
    for (let len = 16; taken.has(name) && len <= digest.length; len += 8) {
      name = `${stem}Rt${digest.slice(0, len)}Page`;
    }
    assigned.set(route, name);
    taken.add(name);
  }

  return assigned;
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
