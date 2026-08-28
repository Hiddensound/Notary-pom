// SPDX-License-Identifier: Apache-2.0

// Three naming systems -- element getters, collection accessors and derived action
// methods -- all land in one TypeScript class namespace. Before this module, each stage
// owned at most one of them: `resolveCollisions` deduped element-vs-element, `emitBase`
// deduped action-vs-action, and nobody owned collection-vs-collection,
// collection-vs-element, action-vs-getter or reserved class members. This module is the
// single arbiter that sees every member the emitted class will expose.

import type { IRElement, PageIR } from '../types.js';
import { RESERVED_WORDS } from './deterministic.js';
import { compareStrings } from '../util/order.js';

export type ActionVerb = 'click' | 'fill' | 'check';

const ROLE_SUFFIX_RE = /(Button|Link|Input|Select|Checkbox|Radio|Tab|MenuItem|Option)$/;

// Names the emitted class cannot use for a getter, accessor or action: JavaScript
// keywords (via RESERVED_WORDS), the members `<X>Base` declares itself (`page`, `route`,
// `url`) and the members every class inherits from Object.prototype. `get constructor()`
// is TS1341; the rest are duplicate-identifier or override errors.
export const RESERVED_MEMBERS: ReadonlySet<string> = new Set<string>([
  ...RESERVED_WORDS,
  'constructor', 'prototype', '__proto__',
  'page', 'route', 'url',
  'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toLocaleString',
]);

export interface ActionName {
  verb: ActionVerb;
  /** The element name with its trailing role suffix stripped: `viewDetailsLink` -> `ViewDetails`. */
  stem: string;
  /** The element name capitalised but otherwise intact: `viewDetailsLink` -> `ViewDetailsLink`. */
  full: string;
}

/**
 * The single source of truth for how an element's action-method name is derived.
 * Previously duplicated inside `emitBase` (once in its counting loop, once in
 * `computeActionName`), where a one-sided edit would have desynced detection from
 * emission. Returns null for elements that get no action method.
 */
export function actionNameFor(e: IRElement): ActionName | null {
  if (e.kind !== 'interactive') return null;
  if (!e.name) return null;
  const full = e.name[0].toUpperCase() + e.name.slice(1);
  const stem = full.replace(ROLE_SUFFIX_RE, '');
  const verb: ActionVerb =
    e.role === 'textbox' || e.role === 'searchbox' ? 'fill'
      : e.role === 'checkbox' || e.role === 'radio' ? 'check'
        : 'click';
  return { verb, stem, full };
}

/** The three public members a collection named `c` contributes to the class. */
export function collectionMembers(base: string): string[] {
  return [`${base}At`, `${base}ByText`, `${base}Count`];
}

/**
 * First candidate whose members are all free, else the last candidate with an ordinal
 * appended. Ordinals are only ever a last resort, so nothing is renamed that is not
 * actually colliding -- a rename here changes a getter name a user's hand-owned subclass
 * may already call.
 */
function firstFree(candidates: string[], fallback: string, isFree: (name: string) => boolean): string {
  for (const c of candidates) if (c && isFree(c)) return c;
  const base = candidates.filter(Boolean).pop() ?? fallback;
  for (let n = 2; ; n++) {
    const c = `${base}${n}`;
    if (isFree(c)) return c;
  }
}

// `deterministicName` already resolves its own reserved words by appending `Element`;
// keep that convention for the reserved *members* this module adds, so a `constructor`
// element becomes `constructorElement` rather than `constructor2`.
function elementCandidates(name: string): string[] {
  return RESERVED_MEMBERS.has(name) ? [name, `${name}Element`] : [name];
}

// Claiming order must not depend on the caller's array order, or the arbiter's output
// would change with it. Sorting by (name, id, index) is total in practice: element names
// reaching this point are already distinct after `resolveCollisions`, and after one pass
// they are distinct by construction.
function claimOrder<T extends { name: string; id: string }>(items: T[]): Array<{ item: T; index: number }> {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      compareStrings(a.item.name, b.item.name)
      || compareStrings(a.item.id, b.item.id)
      || a.index - b.index);
}

/**
 * The arbiter. Renames whatever it must so the complete member set the emitted class
 * exposes is unique and legal, then returns the page with elements and collections
 * re-sorted by their final names.
 *
 * Priority, highest first: reserved members, element getters, collection accessors.
 * Getters outrank collection accessors because a getter name is the primary API surface
 * a user's subclass calls. Action methods are not considered here at all: they are
 * derived at emit time by `planActions`, always yield to everything above, and can always
 * be disambiguated without touching a stored name -- so an action collision never costs a
 * getter rename.
 *
 * Unresolved elements participate even though they emit nothing. Their names live in the
 * notebook, and basing the member set on `status` would make a getter name shift whenever
 * an unrelated element flipped resolved/unresolved between runs.
 *
 * Idempotent: after one pass every member is unique and non-reserved, so a second pass
 * finds every preferred name free and renames nothing.
 */
export function resolveMemberNames(page: PageIR): PageIR {
  const claimed = new Set<string>(RESERVED_MEMBERS);

  const elementNames = new Map<number, string>();
  for (const { item, index } of claimOrder(page.elements)) {
    const name = firstFree(elementCandidates(item.name), 'element', (n) => !claimed.has(n));
    claimed.add(name);
    elementNames.set(index, name);
  }

  const collectionNames = new Map<number, string>();
  for (const { item, index } of claimOrder(page.collections)) {
    const name = firstFree(
      [item.name],
      'collection',
      (n) => collectionMembers(n).every((m) => !claimed.has(m)),
    );
    for (const m of collectionMembers(name)) claimed.add(m);
    collectionNames.set(index, name);
  }

  const elements = page.elements
    .map((e, index) => (elementNames.get(index) === e.name ? e : { ...e, name: elementNames.get(index)! }))
    .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.id, b.id));

  const collections = page.collections
    .map((c, index) => (collectionNames.get(index) === c.name ? c : { ...c, name: collectionNames.get(index)! }))
    .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.id, b.id));

  return { ...page, elements, collections };
}

export interface PlannedAction {
  element: IRElement;
  method: string;
  verb: ActionVerb;
}

/**
 * The action methods the class exposes, for a page whose stored names have already been
 * settled by `resolveMemberNames`. Emitters call this instead of deriving names again.
 */
export function planActions(page: PageIR): PlannedAction[] {
  const claimed = new Set<string>(RESERVED_MEMBERS);
  for (const e of page.elements) claimed.add(e.name);
  for (const c of page.collections) for (const m of collectionMembers(c.name)) claimed.add(m);

  const interactive = claimOrder(page.elements)
    .map(({ item, index }) => ({ element: item, index, action: actionNameFor(item) }))
    .filter((x): x is { element: IRElement; index: number; action: ActionName } => x.action !== null);

  // A preferred name two or more elements want sends *every* contestant to the full form,
  // so no element silently wins the short name over an equally good claim to it.
  const contested = new Map<string, number>();
  for (const x of interactive) {
    const preferred = `${x.action.verb}${x.action.stem}`;
    contested.set(preferred, (contested.get(preferred) ?? 0) + 1);
  }

  const out: PlannedAction[] = [];
  for (const x of interactive) {
    const preferred = `${x.action.verb}${x.action.stem}`;
    const fallback = `${x.action.verb}${x.action.full}`;
    const candidates = (contested.get(preferred) ?? 0) > 1 ? [fallback] : [preferred, fallback];
    const method = firstFree(candidates, x.action.verb, (n) => !claimed.has(n));
    claimed.add(method);
    out.push({ element: x.element, method, verb: x.action.verb });
  }
  return out;
}
