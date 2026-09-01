import { describe, it, expect } from 'vitest';
import { deterministicName } from '../../src/name/deterministic.js';
import { resolveCollisions } from '../../src/name/collisions.js';
import { formatWeakNaming } from '../../src/name/llm.js';
import type { ElementRecord, IRElement, Notebook, PageIR } from '../../src/types.js';

const rec = (over: Partial<ElementRecord>): ElementRecord => ({
  tag: 'button', role: 'button', accessibleName: null, testId: null, domId: null,
  ariaLabel: null, placeholder: null, labelText: null, altText: null, title: null,
  text: null, landmark: null, domPath: 'x', structureKey: 'k', visible: true,
  kind: 'interactive', ...over,
});

describe('deterministicName', () => {
  it('prefers accessible name and adds a role suffix', () => {
    expect(deterministicName(rec({ accessibleName: 'Add to cart' })).name).toBe('addToCartButton');
  });

  it('falls back to test id', () => {
    expect(deterministicName(rec({ testId: 'primary-cta' })).name).toBe('primaryCtaButton');
  });

  it('maps textbox role to an Input suffix', () => {
    const r = rec({ role: 'textbox', tag: 'input', placeholder: 'Search products' });
    expect(deterministicName(r).name).toBe('searchProductsInput');
  });

  it('marks role-only names weak', () => {
    expect(deterministicName(rec({})).weak).toBe(true);
  });

  it('marks a well-named element strong', () => {
    expect(deterministicName(rec({ accessibleName: 'Checkout' })).weak).toBe(false);
  });

  it('sanitises punctuation and leading digits', () => {
    expect(deterministicName(rec({ accessibleName: '2 for 1 — Offers!' })).name)
      .toBe('n2For1OffersButton');
  });

  it('escapes TypeScript reserved words', () => {
    expect(deterministicName(rec({ accessibleName: 'delete', role: 'link' })).name)
      .toBe('deleteLink');
  });
});

describe('resolveCollisions', () => {
  it('disambiguates by landmark first', () => {
    const out = resolveCollisions([
      { record: rec({ accessibleName: 'Search', landmark: 'banner' }), name: 'searchButton', weak: false },
      { record: rec({ accessibleName: 'Search', landmark: 'contentinfo' }), name: 'searchButton', weak: false },
    ]);
    expect(out.map((e) => e.name)).toEqual(['headerSearchButton', 'footerSearchButton']);
  });

  it('falls back to a numeric suffix and marks them weak', () => {
    const out = resolveCollisions([
      { record: rec({ accessibleName: 'More', landmark: 'main' }), name: 'moreButton', weak: false },
      { record: rec({ accessibleName: 'More', landmark: 'main' }), name: 'moreButton', weak: false },
    ]);
    expect(out.map((e) => e.name)).toEqual(['moreButton1', 'moreButton2']);
    expect(out.every((e) => e.weak)).toBe(true);
  });

  it('leaves unique names alone', () => {
    const out = resolveCollisions([
      { record: rec({ accessibleName: 'A' }), name: 'aButton', weak: false },
      { record: rec({ accessibleName: 'B' }), name: 'bButton', weak: false },
    ]);
    expect(out.map((e) => e.name)).toEqual(['aButton', 'bButton']);
  });
});

// ---------------------------------------------------------------------------
// formatWeakNaming: detects a page whose deterministic naming degraded to a
// role/tag fallback for most of its elements -- the profile of a non-Latin-script
// site running through `camelise`'s ASCII-only stripping (see the comment above
// `WEAK_NAME_WARN_THRESHOLD` in src/name/llm.ts). Detect-and-warn only: this does
// not transliterate anything.
// ---------------------------------------------------------------------------

const el = (id: string, weak: boolean): IRElement => ({
  id, name: weak ? `button${id}` : `submit${id}Button`, nameSource: 'deterministic',
  kind: 'interactive', role: 'button', accessibleName: weak ? null : `Submit ${id}`,
  group: null, status: 'resolved',
  locator: { scope: null, fragile: false, candidate: { strategy: 'testId', value: id } },
  rejected: [], observed: rec({}), weak,
});

const page = (routeTemplate: string, elements: IRElement[]): PageIR => ({
  routeTemplate, representativeUrl: `https://s.test${routeTemplate}`, sampleUrls: [],
  className: 'P', pageFingerprint: 'f', elements, collections: [],
});

const notebook = (pages: PageIR[]): Notebook =>
  ({ version: '2', site: 'https://s.test', generatedAt: 'now', pages });

describe('formatWeakNaming', () => {
  it('warns when every element on a page fell back to a role/tag name', () => {
    const nb = notebook([page('/', [el('a', true), el('b', true), el('c', true)])]);
    const warning = formatWeakNaming(nb);
    expect(warning).not.toBe('');
    // Concrete and actionable: names the fraction, the likely cause, and a remedy --
    // not just "some names are weak".
    expect(warning).toContain('3/3');
    expect(warning).toContain('role/tag fallback');
    expect(warning).toContain('non-Latin-script');
    expect(warning).toContain('ANTHROPIC_API_KEY');
  });

  it('does not warn when only a minority of a page fell back', () => {
    const nb = notebook([page('/', [el('a', true), el('b', false), el('c', false)])]);
    expect(formatWeakNaming(nb)).toBe('');
  });

  it('does not warn on a page with no elements', () => {
    const nb = notebook([page('/empty', [])]);
    expect(formatWeakNaming(nb)).toBe('');
  });

  it('names the affected route and truncates past ten pages', () => {
    const pages = Array.from({ length: 12 }, (_, i) => page(`/p${i}`, [el(`${i}a`, true), el(`${i}b`, true)]));
    const warning = formatWeakNaming(notebook(pages));
    expect(warning).toContain('/p0');
    expect(warning).toContain('and 2 more');
  });
});
