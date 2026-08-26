// SPDX-License-Identifier: Apache-2.0

import type { ElementRecord, LandmarkRole, ScopedCandidate } from '../types.js';

const unscoped = (candidate: ScopedCandidate['candidate'], fragile = false): ScopedCandidate =>
  ({ scope: null, candidate, fragile });

export function parentPath(domPath: string): string {
  const segments = domPath.split(' > ');
  const parent = segments.slice(0, -1).map(seg => seg.replace(/:[\w-]+\([^)]*\)/g, '')).join(' > ');
  return parent;
}

export function buildCandidates(r: ElementRecord): ScopedCandidate[] {
  const out: ScopedCandidate[] = [];

  if (r.testId) out.push(unscoped({ strategy: 'testId', value: r.testId }));

  if (r.role && r.accessibleName) {
    out.push(unscoped({ strategy: 'role', role: r.role, name: r.accessibleName, exact: true }));
  }
  if (r.labelText) out.push(unscoped({ strategy: 'label', value: r.labelText, exact: true }));
  if (r.placeholder) out.push(unscoped({ strategy: 'placeholder', value: r.placeholder }));
  if (r.altText) out.push(unscoped({ strategy: 'altText', value: r.altText }));
  if (r.title) out.push(unscoped({ strategy: 'title', value: r.title }));
  if (r.role && r.accessibleName) {
    out.push(unscoped({ strategy: 'role', role: r.role, name: r.accessibleName, exact: false }));
  }
  if (r.kind === 'heading' && r.text) {
    out.push(unscoped({ strategy: 'text', value: r.text, exact: true }));
  }

  const parent = parentPath(r.domPath);
  const cssValue = parent ? `${parent} > ${r.tag}` : r.tag;
  out.push(unscoped({ strategy: 'css', value: cssValue }, true));

  return out;
}

export function scopeTo(sc: ScopedCandidate, landmark: LandmarkRole): ScopedCandidate {
  return { ...sc, scope: landmark };
}
