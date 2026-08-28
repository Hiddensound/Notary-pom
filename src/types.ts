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
export interface RejectedCandidate {
  scoped: ScopedCandidate;
  matchCount: number;
  reason: 'ambiguous' | 'notFound' | 'hidden' | 'identity';
}

export type ElementStatus = 'resolved' | 'unresolved';
export type NameSource = 'deterministic' | 'llm' | 'cached';

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
  respectRobots: boolean;
  contextOptions: Record<string, unknown>;
}
