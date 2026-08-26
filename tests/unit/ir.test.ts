import { describe, it, expect } from 'vitest';
import { fingerprintElement, classNameForRoute } from '../../src/ir/fingerprint.js';
import { buildNotebook } from '../../src/ir/build.js';
import type { ElementRecord } from '../../src/types.js';

const base: ElementRecord = {
  tag: 'button', role: 'button', accessibleName: 'Add to cart', testId: 'add-to-cart',
  domId: null, ariaLabel: null, placeholder: null, labelText: null, altText: null,
  title: null, text: 'Add to cart', landmark: 'main', domPath: 'body>div:nth-child(2)>button',
  structureKey: 'main|button|button', visible: true, kind: 'interactive',
};

describe('fingerprintElement', () => {
  it('is stable when the DOM path moves', () => {
    const moved = { ...base, domPath: 'body>section>div>button' };
    expect(fingerprintElement('/product/:param1', moved))
      .toBe(fingerprintElement('/product/:param1', base));
  });

  it('changes when the accessible name changes', () => {
    const renamed = { ...base, accessibleName: 'Buy now', testId: null, text: 'Buy now' };
    expect(fingerprintElement('/product/:param1', renamed))
      .not.toBe(fingerprintElement('/product/:param1', base));
  });

  it('differs across routes for otherwise identical elements', () => {
    expect(fingerprintElement('/cart', base)).not.toBe(fingerprintElement('/checkout', base));
  });
});

describe('classNameForRoute', () => {
  it.each([
    ['/', 'HomePage'],
    ['/product/:param1', 'ProductPage'],
    ['/collections/:param1/items', 'CollectionsItemsPage'],
    ['/about-us', 'AboutUsPage'],
  ])('%s -> %s', (route, expected) => {
    expect(classNameForRoute(route)).toBe(expected);
  });
});

describe('buildNotebook', () => {
  it('sorts pages by route template for stable diffs', () => {
    const page = (routeTemplate: string) => ({
      routeTemplate, representativeUrl: 'https://s.test' + routeTemplate,
      sampleUrls: [], className: 'X', pageFingerprint: 'f', elements: [], collections: [],
    });
    const nb = buildNotebook('https://s.test', [page('/z'), page('/a')], '2026-01-01T00:00:00Z');
    expect(nb.pages.map((p) => p.routeTemplate)).toEqual(['/a', '/z']);
    expect(nb.version).toBe('1');
  });
});
