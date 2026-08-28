// SPDX-License-Identifier: Apache-2.0

import type { IRCollection, IRElement, Notebook, PageIR, RouteGroup } from '../types.js';
import { classNameForRoute, uniqueClassNames } from './fingerprint.js';
import { resolveMemberNames } from '../name/members.js';
import { compareStrings } from '../util/order.js';

export function buildPageIR(args: {
  group: RouteGroup;
  pageFingerprint: string;
  elements: IRElement[];
  collections: IRCollection[];
}): PageIR {
  // `resolveMemberNames` is the single arbiter over every member the emitted class will
  // expose, and it also re-sorts elements and collections by their final names.
  return resolveMemberNames({
    routeTemplate: args.group.routeTemplate,
    representativeUrl: args.group.representativeUrl,
    sampleUrls: args.group.sampleUrls,
    className: classNameForRoute(args.group.routeTemplate),
    pageFingerprint: args.pageFingerprint,
    elements: [...args.elements].sort((a, b) => compareStrings(a.name, b.name)),
    collections: [...args.collections].sort((a, b) => compareStrings(a.name, b.name)),
  });
}

export function buildNotebook(site: string, pages: PageIR[], now: string): Notebook {
  // Class names can only be made injective where every route is visible at once, which is
  // here -- `buildPageIR` sees one page and cannot know what the others reduced to.
  const classNames = uniqueClassNames(pages.map((p) => p.routeTemplate));
  return {
    version: '1',
    site,
    generatedAt: now,
    pages: [...pages]
      .map((p) => ({ ...p, className: classNames.get(p.routeTemplate) ?? p.className }))
      .sort((a, b) => compareStrings(a.routeTemplate, b.routeTemplate)),
  };
}
