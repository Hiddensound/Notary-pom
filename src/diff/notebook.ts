// SPDX-License-Identifier: Apache-2.0

import type { IRElement, Notebook } from '../types.js';
import { compareStrings } from '../util/order.js';

export type DriftSeverity = 'info' | 'warning' | 'regression';

export interface ElementDrift {
  page: string;
  id: string;
  name: string;
  change: 'added' | 'removed' | 'renamed' | 'strategyChanged' | 'nowUnresolved' | 'nowResolved';
  detail: string;
  severity: DriftSeverity;
}

export interface DriftReport {
  addedPages: string[];
  removedPages: string[];
  elements: ElementDrift[];
}

const strategyOf = (e: IRElement): string => e.locator?.candidate.strategy ?? 'none';

function severityOf(change: ElementDrift['change'], fragileAfter?: boolean): DriftSeverity {
  switch (change) {
    case 'added':
    case 'nowResolved':
    case 'renamed':
      return 'info';
    case 'removed':
      return 'warning';
    case 'nowUnresolved':
      return 'regression';
    case 'strategyChanged':
      return fragileAfter ? 'regression' : 'warning';
  }
}

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
        elements.push({ page: route, id, name: e.name, change: 'added', detail: strategyOf(e), severity: severityOf('added') });
        continue;
      }
      if (b.status === 'resolved' && e.status === 'unresolved') {
        elements.push({ page: route, id, name: e.name, change: 'nowUnresolved', detail: 'no unique locator', severity: severityOf('nowUnresolved') });
      } else if (b.status === 'unresolved' && e.status === 'resolved') {
        elements.push({ page: route, id, name: e.name, change: 'nowResolved', detail: strategyOf(e), severity: severityOf('nowResolved') });
      } else if (strategyOf(b) !== strategyOf(e)) {
        elements.push({
          page: route, id, name: e.name, change: 'strategyChanged', detail: `${strategyOf(b)} -> ${strategyOf(e)}`,
          severity: severityOf('strategyChanged', e.locator?.fragile),
        });
      } else if (b.name !== e.name) {
        elements.push({ page: route, id, name: e.name, change: 'renamed', detail: `${b.name} -> ${e.name}`, severity: severityOf('renamed') });
      }
    }

    for (const [id, b] of before) {
      if (!after.has(id)) {
        elements.push({ page: route, id, name: b.name, change: 'removed', detail: strategyOf(b), severity: severityOf('removed') });
      }
    }
  }

  elements.sort((a, b) => compareStrings(a.page, b.page) || compareStrings(a.id, b.id));
  return { addedPages, removedPages, elements };
}

const SEVERITY_RANK: Record<DriftSeverity, number> = { info: 0, warning: 1, regression: 2 };

export function maxSeverity(r: DriftReport): 'none' | DriftSeverity {
  const pageSeverities: DriftSeverity[] = [
    ...r.addedPages.map((): DriftSeverity => 'info'),
    ...r.removedPages.map((): DriftSeverity => 'warning'),
  ];
  const all = [...pageSeverities, ...r.elements.map((e) => e.severity)];
  if (!all.length) return 'none';
  return all.reduce((worst, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst), 'info' as DriftSeverity);
}

// A CLI process exit code is a shape severity can be reduced to but formatDrift/JSON output
// cannot -- kept as a pure function (no process.exitCode/console.* here) so it is testable
// without spinning up a browser or a subprocess, the same shape refinedDiff already
// established in src/diff/run.ts for CLI/MCP-shared logic.
export function severityToExitCode(severity: 'none' | DriftSeverity): number {
  switch (severity) {
    case 'none':
      return 0;
    case 'regression':
      return 2;
    default:
      return 1;
  }
}

export function formatDrift(r: DriftReport): string {
  if (!r.addedPages.length && !r.removedPages.length && !r.elements.length) return 'No drift detected.';
  const lines: string[] = [];
  for (const p of r.addedPages) lines.push(`+ page ${p}`);
  for (const p of r.removedPages) lines.push(`- page ${p}`);
  for (const e of r.elements) lines.push(`  ${e.page}  ${e.change.padEnd(16)} ${e.name}  (${e.detail}) [${e.severity}]`);
  return lines.join('\n');
}
