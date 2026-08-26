// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import type { ElementRecord } from '../types.js';

export function fingerprintElement(routeTemplate: string, r: ElementRecord): string {
  const identity = r.accessibleName ?? r.testId ?? r.domId ?? r.text ?? '';
  const parts = [routeTemplate, r.kind, r.role ?? '', identity, r.landmark ?? ''];
  return 'el_' + createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 12);
}

export function fingerprintPage(ariaSnapshot: string): string {
  return 'pg_' + createHash('sha256').update(ariaSnapshot).digest('hex').slice(0, 16);
}

export function classNameForRoute(routeTemplate: string): string {
  if (routeTemplate === '/') return 'HomePage';
  const words = routeTemplate
    .split('/')
    .filter((s) => s && !s.startsWith(':'))
    .flatMap((s) => s.split(/[-_]/))
    .filter(Boolean);
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return (pascal || 'Root') + 'Page';
}
