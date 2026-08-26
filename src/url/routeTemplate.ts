// SPDX-License-Identifier: Apache-2.0

import type { RouteGroup } from '../types.js';
import { compareStrings } from '../util/order.js';

const VARY_THRESHOLD = 3;

function segmentsOf(url: string): string[] {
  const p = new URL(url).pathname;
  return p === '/' ? [] : p.replace(/^\//, '').split('/');
}

export function templateRoutes(urls: string[]): RouteGroup[] {
  const unique = [...new Set(urls)].sort();
  const byDepth = new Map<number, string[]>();
  for (const u of unique) {
    const d = segmentsOf(u).length;
    byDepth.set(d, [...(byDepth.get(d) ?? []), u]);
  }

  const groups = new Map<string, string[]>();

  for (const [depth, cohort] of byDepth) {
    if (depth === 0) {
      groups.set('/', cohort);
      continue;
    }
    // A segment index is variable when enough URLs sharing the same prefix differ there.
    const variable = new Set<number>();
    for (let i = 0; i < depth; i++) {
      const byPrefix = new Map<string, Set<string>>();
      for (const u of cohort) {
        const segs = segmentsOf(u);
        const prefix = segs.slice(0, i).join('/');
        const set = byPrefix.get(prefix) ?? new Set<string>();
        set.add(segs[i]);
        byPrefix.set(prefix, set);
      }
      if ([...byPrefix.values()].some((s) => s.size >= VARY_THRESHOLD)) variable.add(i);
    }

    for (const u of cohort) {
      const segs = segmentsOf(u);
      const template = '/' + segs.map((s, i) => (variable.has(i) ? `:param${i}` : s)).join('/');
      groups.set(template, [...(groups.get(template) ?? []), u]);
    }
  }

  return [...groups.entries()]
    .map(([routeTemplate, sampleUrls]) => {
      const sorted = [...sampleUrls].sort();
      return { routeTemplate, representativeUrl: sorted[0], sampleUrls: sorted };
    })
    .sort((a, b) => compareStrings(a.routeTemplate, b.routeTemplate));
}
