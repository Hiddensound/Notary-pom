// SPDX-License-Identifier: Apache-2.0

export type ElementKind = 'interactive' | 'heading' | 'text';

export type LandmarkRole = 'banner' | 'navigation' | 'main' | 'contentinfo' | 'complementary' | 'search';

export interface ElementRecord {
  tag: string;
  role: string | null;
  accessibleName: string | null;
  testId: string | null;
  domId: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  labelText: string | null;
  altText: string | null;
  title: string | null;
  text: string | null;
  landmark: LandmarkRole | null;
  domPath: string;
  structureKey: string;
  visible: boolean;
  kind: ElementKind;
}

export type LocatorCandidate =
  // `attribute` is the DOM attribute `value` was read from. It travels on the candidate
  // so that binding and emission both derive from it, rather than from Playwright's
  // process-global test-id attribute -- which POMBuilder does not set and the consumer
  // project may have set to anything.
  | { strategy: 'testId'; value: string; attribute: string }
  | { strategy: 'role'; role: string; name: string; exact: boolean }
  | { strategy: 'label'; value: string; exact: boolean }
  | { strategy: 'placeholder'; value: string }
  | { strategy: 'altText'; value: string }
  | { strategy: 'title'; value: string }
  | { strategy: 'text'; value: string; exact: boolean }
  | { strategy: 'css'; value: string };

export interface ScopedCandidate {
  scope: LandmarkRole | null;
  candidate: LocatorCandidate;
  fragile: boolean;
}

// `identity` means the candidate matched exactly one visible node that is not the node
// the harvester observed -- or that the observed node could not be re-found at all, so
// the match could not be confirmed either way. Both are unverifiable, and an
// unverifiable element is omitted from generated code rather than emitted hopefully.
//
// `error` means the check itself could not be run: Playwright refused the selector, or
// the page went away mid-check. Unverifiable for a third reason, and rejected the same
// way -- a per-candidate failure must not be allowed to abort the crawl.
export interface RejectedCandidate {
  scoped: ScopedCandidate;
  matchCount: number;
  reason: 'ambiguous' | 'notFound' | 'hidden' | 'identity' | 'error';
}

export type ElementStatus = 'resolved' | 'unresolved';
export type NameSource = 'deterministic' | 'llm' | 'cached';

// Controls how aggressively `looksLikeLogin` (src/browser/guard.ts) treats a landed page
// as a login page. `'identifier-first'` is the default -- it also fires on an identifier
// field (email/username) paired with a submit control, to catch identifier-first and
// passwordless identity providers that show no password field on their first screen.
// That arm is indistinguishable from an ordinary newsletter-signup form, so
// `'password-only'` drops it while keeping the password-field guard, and `'off'` drops
// all heuristics -- `loginUrlPattern` is still honored in every mode, since it is
// explicit user configuration rather than a heuristic.
export type LoginDetection = 'identifier-first' | 'password-only' | 'off';

export interface IRElement {
  id: string;
  name: string;
  nameSource: NameSource;
  kind: ElementKind;
  role: string | null;
  accessibleName: string | null;
  group: LandmarkRole | null;
  status: ElementStatus;
  locator: ScopedCandidate | null;
  rejected: RejectedCandidate[];
  observed: ElementRecord;
  // True when the name was not derived from a real accessible name -- a role/tag
  // fallback, or a collision suffix `resolveCollisions` had to append. This is the
  // signal `selectWeak` (src/name/llm.ts) uses to pick refinement candidates; it is
  // required rather than optional so every construction site has to supply a real
  // value instead of silently compiling with `weak` falsy-undefined.
  weak: boolean;
}

export interface IRCollection {
  id: string;
  name: string;
  item: ScopedCandidate;
  count: number;
}

export interface PageIR {
  routeTemplate: string;
  representativeUrl: string;
  sampleUrls: string[];
  className: string;
  pageFingerprint: string;
  elements: IRElement[];
  collections: IRCollection[];
}

export interface Notebook {
  version: '2';
  site: string;
  generatedAt: string;
  pages: PageIR[];
}

export interface RouteGroup {
  routeTemplate: string;
  representativeUrl: string;
  sampleUrls: string[];
}

export interface PomBuilderConfig {
  seed: string;
  outDir: string;
  irDir: string;
  maxDepth: number;
  maxPages: number;
  include: string[];
  exclude: string[];
  testIdAttribute: string;
  loginUrlPattern: string | null;
  loginDetection: LoginDetection;
  respectRobots: boolean;
  contextOptions: Record<string, unknown>;
}
