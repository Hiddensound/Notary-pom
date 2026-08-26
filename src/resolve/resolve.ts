// SPDX-License-Identifier: Apache-2.0

import type { Page } from '@playwright/test';
import type { ElementRecord, IRCollection, IRElement, RejectedCandidate, ScopedCandidate } from '../types.js';
import { buildCandidates, scopeTo } from '../locator/candidates.js';
import { bindCandidate } from '../locator/bind.js';
import { fingerprintElement } from '../ir/fingerprint.js';
import { deterministicName } from '../name/deterministic.js';
import { resolveCollisions } from '../name/collisions.js';
import { detectCollections } from './collections.js';

interface Verdict {
  winner: ScopedCandidate | null;
  rejected: RejectedCandidate[];
}

async function verify(page: Page, sc: ScopedCandidate): Promise<{ ok: boolean; matchCount: number; reason: RejectedCandidate['reason'] }> {
  const locator = bindCandidate(page, sc);
  const matchCount = await locator.count();
  if (matchCount === 0) return { ok: false, matchCount, reason: 'notFound' };
  if (matchCount > 1) return { ok: false, matchCount, reason: 'ambiguous' };
  const visible = await locator.first().isVisible();
  if (!visible) return { ok: false, matchCount, reason: 'hidden' };
  return { ok: true, matchCount, reason: 'notFound' };
}

async function adjudicate(page: Page, record: ElementRecord): Promise<Verdict> {
  const rejected: RejectedCandidate[] = [];

  for (const sc of buildCandidates(record)) {
    const first = await verify(page, sc);
    if (first.ok) return { winner: sc, rejected };
    rejected.push({ scoped: sc, matchCount: first.matchCount, reason: first.reason });

    // Ambiguity is the one failure worth retrying, and only by narrowing the search
    // to the element's own landmark.
    if (first.reason === 'ambiguous' && record.landmark) {
      const scoped = scopeTo(sc, record.landmark);
      const second = await verify(page, scoped);
      if (second.ok) return { winner: scoped, rejected };
      rejected.push({ scoped, matchCount: second.matchCount, reason: second.reason });
    }
  }

  return { winner: null, rejected };
}

export interface ResolveResult {
  elements: IRElement[];
  collections: IRCollection[];
}

export async function resolveElements(
  page: Page,
  records: ElementRecord[],
  routeTemplate: string,
): Promise<ResolveResult> {
  const { collections, consumed } = detectCollections(records);
  const kept = records.filter((r) => !consumed.has(r.domPath));

  const named = resolveCollisions(
    kept.map((record) => ({ record, ...deterministicName(record) })),
  );

  const out: IRElement[] = [];

  for (const entry of named) {
    const { winner, rejected } = await adjudicate(page, entry.record);
    out.push({
      id: fingerprintElement(routeTemplate, entry.record),
      name: entry.name,
      nameSource: 'deterministic',
      kind: entry.record.kind,
      role: entry.record.role,
      accessibleName: entry.record.accessibleName,
      group: entry.record.landmark,
      status: winner ? 'resolved' : 'unresolved',
      locator: winner,
      rejected,
      observed: entry.record,
    });
  }

  return { elements: out, collections };
}
