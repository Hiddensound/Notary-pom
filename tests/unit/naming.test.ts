import { describe, it, expect } from 'vitest';
import { deterministicName } from '../../src/name/deterministic.js';
import { resolveCollisions } from '../../src/name/collisions.js';
import type { ElementRecord } from '../../src/types.js';

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
