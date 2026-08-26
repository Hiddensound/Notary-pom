// SPDX-License-Identifier: Apache-2.0

import type { IRCollection, IRElement, Notebook, PageIR, RouteGroup } from '../types.js';
import { classNameForRoute } from './fingerprint.js';
import { compareStrings } from '../util/order.js';

export function buildPageIR(args: {
  group: RouteGroup;
  pageFingerprint: string;
  elements: IRElement[];
  collections: IRCollection[];
}): PageIR {
  return {
    routeTemplate: args.group.routeTemplate,
    representativeUrl: args.group.representativeUrl,
    sampleUrls: args.group.sampleUrls,
    className: classNameForRoute(args.group.routeTemplate),
    pageFingerprint: args.pageFingerprint,
    elements: [...args.elements].sort((a, b) => compareStrings(a.name, b.name)),
    collections: [...args.collections].sort((a, b) => compareStrings(a.name, b.name)),
  };
}

export function buildNotebook(site: string, pages: PageIR[], now: string): Notebook {
  return {
    version: '1',
    site,
    generatedAt: now,
    pages: [...pages].sort((a, b) => compareStrings(a.routeTemplate, b.routeTemplate)),
  };
}
