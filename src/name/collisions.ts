// SPDX-License-Identifier: Apache-2.0

import type { ElementRecord, LandmarkRole } from '../types.js';

export interface NamedEntry {
  record: ElementRecord;
  name: string;
  weak: boolean;
}

const LANDMARK_PREFIX: Record<LandmarkRole, string> = {
  banner: 'header', navigation: 'nav', main: 'main', contentinfo: 'footer',
  complementary: 'aside', search: 'search',
};

function prefixed(prefix: string, name: string): string {
  return prefix + name[0].toUpperCase() + name.slice(1);
}

export function resolveCollisions(entries: NamedEntry[]): NamedEntry[] {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);

  const pass1 = entries.map((e) => {
    if ((counts.get(e.name) ?? 0) < 2 || !e.record.landmark) return e;

    // Only apply landmark prefix if entries have different landmarks
    const sameNameEntries = entries.filter(other => other.name === e.name);
    const landmarks = new Set(sameNameEntries.map(other => other.record.landmark));
    if (landmarks.size === 1) return e; // All have same landmark, skip prefix

    return { ...e, name: prefixed(LANDMARK_PREFIX[e.record.landmark], e.name) };
  });

  const counts2 = new Map<string, number>();
  for (const e of pass1) counts2.set(e.name, (counts2.get(e.name) ?? 0) + 1);

  const seen = new Map<string, number>();
  return pass1.map((e) => {
    if ((counts2.get(e.name) ?? 0) < 2) return e;
    const n = (seen.get(e.name) ?? 0) + 1;
    seen.set(e.name, n);
    return { ...e, name: `${e.name}${n}`, weak: true };
  });
}
