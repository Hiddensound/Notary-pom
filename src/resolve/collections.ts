// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import type { ElementRecord, IRCollection, ScopedCandidate } from '../types.js';
import { deterministicName } from '../name/deterministic.js';
import { parentPath } from '../locator/candidates.js';
import { compareStrings } from '../util/order.js';

const MIN_SIBLINGS = 3;

function itemCandidate(group: ElementRecord[]): ScopedCandidate {
  const testIds = new Set(group.map((r) => r.testId));
  if (testIds.size === 1 && group[0].testId) {
    return { scope: null, fragile: false, candidate: { strategy: 'testId', value: group[0].testId } };
  }
  const container = parentPath(group[0].domPath);
  const tag = group[0].tag;
  return { scope: null, fragile: true, candidate: { strategy: 'css', value: `${container} > ${tag}` } };
}

function collectionName(group: ElementRecord[]): string {
  if (group[0].testId) {
    return deterministicName({ ...group[0], accessibleName: null, role: null }).name;
  }
  return deterministicName({ ...group[0], accessibleName: null, testId: null, text: null, role: null }).name;
}

export function detectCollections(
  records: ElementRecord[],
  minSiblings = MIN_SIBLINGS,
): { collections: IRCollection[]; consumed: Set<string> } {
  const groups = new Map<string, ElementRecord[]>();
  for (const r of records) {
    const key = `${parentPath(r.domPath)}::${r.structureKey}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const collections: IRCollection[] = [];
  const consumed = new Set<string>();

  for (const [key, group] of [...groups.entries()].sort(([a], [b]) => compareStrings(a, b))) {
    if (group.length < minSiblings) continue;
    const sorted = [...group].sort((a, b) => compareStrings(a.domPath, b.domPath));
    collections.push({
      id: 'co_' + createHash('sha256').update(key).digest('hex').slice(0, 12),
      name: collectionName(sorted),
      item: itemCandidate(sorted),
      count: sorted.length,
    });
    for (const r of sorted) consumed.add(r.domPath);
  }

  return { collections, consumed };
}
