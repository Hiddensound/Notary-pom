// SPDX-License-Identifier: Apache-2.0

import type { ElementHandle, Page } from '@playwright/test';
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

// A discriminated union rather than a flat record: the success path has no match count or
// rejection reason to report, and the previous shape had to invent `reason: 'notFound'`
// as filler on a verdict that was not a rejection at all.
type Verification =
  | { ok: true }
  | { ok: false; matchCount: number; reason: RejectedCandidate['reason'] };

// `expected` is a live handle to the node the harvester observed. Counting and visibility
// prove a candidate is unambiguous; only comparing node identity proves it is unambiguous
// about the *right* element. Without this a candidate that resolves uniquely to some other
// element is accepted and emitted as a named getter -- "verified" would mean "unique",
// not "the element we observed".
async function verify(
  page: Page,
  sc: ScopedCandidate,
  expected: ElementHandle<SVGElement | HTMLElement> | null,
): Promise<Verification> {
  try {
    const locator = bindCandidate(page, sc);
    const matchCount = await locator.count();
    if (matchCount === 0) return { ok: false, matchCount, reason: 'notFound' };
    if (matchCount > 1) return { ok: false, matchCount, reason: 'ambiguous' };
    const visible = await locator.first().isVisible();
    if (!visible) return { ok: false, matchCount, reason: 'hidden' };

    if (!expected) return { ok: false, matchCount, reason: 'identity' };
    const actual = await locator.first().elementHandle();
    if (!actual) return { ok: false, matchCount, reason: 'identity' };
    try {
      // Compare in-page: two handles to the same node are distinct JS objects here, so
      // identity has to be decided where the nodes themselves live.
      const same = await expected.evaluate((node, other) => node === other, actual);
      return same ? { ok: true } : { ok: false, matchCount, reason: 'identity' };
    } finally {
      await actual.dispose();
    }
  } catch {
    // Every call above can throw -- a selector Playwright refuses to parse, a node that
    // detaches mid-check, a page that navigates or closes underneath us. Uncaught, one
    // such failure aborted the crawl of every remaining element on every remaining page,
    // which is a wildly disproportionate response to one bad candidate and inconsistent
    // with the deliberate fail-closed handling of `page.$(record.domPath)` in the caller.
    // A candidate whose check could not be run is unverifiable, which is exactly what the
    // rejection list already means. `matchCount` is 0 because nothing was counted: the
    // failure may have happened before `count()` ever returned.
    //
    // Handles are still released: the inner `finally` runs before this catch, and the
    // caller's `finally` disposes `expected` whatever happens here.
    return { ok: false, matchCount: 0, reason: 'error' };
  }
}

async function adjudicate(
  page: Page,
  record: ElementRecord,
  testIdAttribute: string,
): Promise<Verdict> {
  const rejected: RejectedCandidate[] = [];

  // `domPath` is already a valid CSS selector for the observed node, so the node can be
  // re-found once per record instead of every candidate. A selector this fails to parse
  // must not abort the crawl; the record simply becomes unverifiable, which is the
  // correct direction to fail.
  let expected: ElementHandle<SVGElement | HTMLElement> | null = null;
  try {
    expected = await page.$(record.domPath);
  } catch {
    expected = null;
  }

  try {
    for (const sc of buildCandidates(record, testIdAttribute)) {
      const first = await verify(page, sc, expected);
      if (first.ok) return { winner: sc, rejected };
      rejected.push({ scoped: sc, matchCount: first.matchCount, reason: first.reason });

      // Ambiguity is the one failure worth retrying, and only by narrowing the search
      // to the element's own landmark.
      //
      // An `identity` rejection is deliberately NOT retried the same way. Scoping can only
      // ever shrink the match set -- `page.getByRole(scope).getByX(...)` matches the
      // descendants of the scope root that the unscoped locator already matched. So when
      // the unscoped candidate matched exactly one node and that node was the wrong one,
      // the scoped variant matches either that same wrong node or nothing. It cannot
      // reach the right one, because the right one did not match unscoped in the first
      // place. Retrying would cost two extra round-trips per rejection and recover
      // nothing. Confirmed empirically: a build with the identity retry enabled, crawled
      // against the reference site, produced an identical winner and status for all 123
      // elements -- its only effect on the notebook was two extra `rejected` entries
      // recording the wasted attempts (139 -> 141).
      if (first.reason === 'ambiguous' && record.landmark) {
        const scoped = scopeTo(sc, record.landmark);
        const second = await verify(page, scoped, expected);
        if (second.ok) return { winner: scoped, rejected };
        rejected.push({ scoped, matchCount: second.matchCount, reason: second.reason });
      }
    }

    return { winner: null, rejected };
  } finally {
    // One handle per element on a 120-element page is a leak worth not having.
    await expected?.dispose();
  }
}

export interface ResolveResult {
  elements: IRElement[];
  collections: IRCollection[];
}

export async function resolveElements(
  page: Page,
  records: ElementRecord[],
  routeTemplate: string,
  testIdAttribute = 'data-testid',
): Promise<ResolveResult> {
  const { collections, consumed } = detectCollections(records, testIdAttribute);
  const kept = records.filter((r) => !consumed.has(r.domPath));

  const named = resolveCollisions(
    kept.map((record) => ({ record, ...deterministicName(record) })),
  );

  const out: IRElement[] = [];

  // Two elements can share route, kind, role, landmark and identity-fallback and so
  // fingerprint identically -- ordinary duplicated page furniture such as top/bottom
  // pagination is the common case, not an edge case. Without a disambiguator the second
  // element's id collides with the first's: `diffNotebooks` keys its before/after maps by
  // id, so only the last of a colliding group survives and a regression on an earlier
  // member is invisible to drift detection. The ordinal below is local to this call --
  // `fingerprintElement` itself stays pure -- and only the second and later occurrence of
  // a base fingerprint is suffixed, so the common case of no collision keeps today's ids
  // and today's `names.json` cache entries intact.
  const seen = new Map<string, number>();
  for (const entry of named) {
    const base = fingerprintElement(routeTemplate, entry.record);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}_${n}`;

    const { winner, rejected } = await adjudicate(page, entry.record, testIdAttribute);
    out.push({
      id,
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
      weak: entry.weak,
    });
  }

  return { elements: out, collections };
}
