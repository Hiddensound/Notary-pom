// SPDX-License-Identifier: Apache-2.0

import type { IRElement, Notebook } from '../types.js';
import { compareStrings } from '../util/order.js';

export interface ElementDrift {
  page: string;
  id: string;
  name: string;
  change: 'added' | 'removed' | 'renamed' | 'strategyChanged' | 'nowUnresolved' | 'nowResolved';
  detail: string;
}

export interface DriftReport {
  addedPages: string[];
  removedPages: string[];
  elements: ElementDrift[];
}

const strategyOf = (e: IRElement): string => e.locator?.candidate.strategy ?? 'none';

export function diffNotebooks(prev: Notebook, next: Notebook): DriftReport {
  const prevPages = new Map(prev.pages.map((p) => [p.routeTemplate, p]));
  const nextPages = new Map(next.pages.map((p) => [p.routeTemplate, p]));

  const addedPages = [...nextPages.keys()].filter((k) => !prevPages.has(k)).sort(compareStrings);
  const removedPages = [...prevPages.keys()].filter((k) => !nextPages.has(k)).sort(compareStrings);

  const elements: ElementDrift[] = [];

  for (const [route, nextPage] of nextPages) {
    const prevPage = prevPages.get(route);
    if (!prevPage) continue;

    const before = new Map(prevPage.elements.map((e) => [e.id, e]));
    const after = new Map(nextPage.elements.map((e) => [e.id, e]));

    for (const [id, e] of after) {
      const b = before.get(id);
      if (!b) {
        elements.push({ page: route, id, name: e.name, change: 'added', detail: strategyOf(e) });
        continue;
      }
      if (b.status === 'resolved' && e.status === 'unresolved') {
        elements.push({ page: route, id, name: e.name, change: 'nowUnresolved', detail: 'no unique locator' });
      } else if (b.status === 'unresolved' && e.status === 'resolved') {
        elements.push({ page: route, id, name: e.name, change: 'nowResolved', detail: strategyOf(e) });
      } else if (strategyOf(b) !== strategyOf(e)) {
        elements.push({ page: route, id, name: e.name, change: 'strategyChanged', detail: `${strategyOf(b)} -> ${strategyOf(e)}` });
      } else if (b.name !== e.name) {
        elements.push({ page: route, id, name: e.name, change: 'renamed', detail: `${b.name} -> ${e.name}` });
      }
    }

    for (const [id, b] of before) {
      if (!after.has(id)) {
        elements.push({ page: route, id, name: b.name, change: 'removed', detail: strategyOf(b) });
      }
    }
  }

  elements.sort((a, b) => compareStrings(a.page, b.page) || compareStrings(a.id, b.id));
  return { addedPages, removedPages, elements };
}

export function formatDrift(r: DriftReport): string {
  if (!r.addedPages.length && !r.removedPages.length && !r.elements.length) return 'No drift detected.';
  const lines: string[] = [];
  for (const p of r.addedPages) lines.push(`+ page ${p}`);
  for (const p of r.removedPages) lines.push(`- page ${p}`);
  for (const e of r.elements) lines.push(`  ${e.page}  ${e.change.padEnd(16)} ${e.name}  (${e.detail})`);
  return lines.join('\n');
}
