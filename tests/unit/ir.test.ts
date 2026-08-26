import { describe, it, expect } from 'vitest';
import { fingerprintElement, classNameForRoute, fingerprintPage } from '../../src/ir/fingerprint.js';
import { buildNotebook, buildPageIR } from '../../src/ir/build.js';
import type { ElementRecord, IRElement, IRCollection, RouteGroup } from '../../src/types.js';

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

describe('buildPageIR', () => {
  const makeElement = (name: string): IRElement => ({
    id: `el-${name}`, name, nameSource: 'deterministic', kind: 'interactive',
    role: 'button', accessibleName: name, group: 'main', status: 'resolved',
    locator: null, rejected: [],
    observed: { ...base, accessibleName: name, text: name },
  });

  const makeCollection = (name: string): IRCollection => ({
    id: `col-${name}`, name, count: 1,
    item: { scope: 'main', candidate: { strategy: 'text', value: name, exact: true }, fragile: false },
  });

  it('sorts elements by name in ordinal order', () => {
    const elements = [makeElement('Zebra'), makeElement('apple'), makeElement('Banana')];
    const pageIR = buildPageIR({
      group: { routeTemplate: '/test', representativeUrl: 'https://test.com/test', sampleUrls: [] },
      pageFingerprint: 'test-fp',
      elements,
      collections: [],
    });
    expect(pageIR.elements.map((e) => e.name)).toEqual(['Banana', 'Zebra', 'apple']);
  });

  it('sorts collections by name in ordinal order', () => {
    const collections = [makeCollection('Zebra'), makeCollection('apple'), makeCollection('Banana')];
    const pageIR = buildPageIR({
      group: { routeTemplate: '/test', representativeUrl: 'https://test.com/test', sampleUrls: [] },
      pageFingerprint: 'test-fp',
      elements: [],
      collections,
    });
    expect(pageIR.collections.map((c) => c.name)).toEqual(['Banana', 'Zebra', 'apple']);
  });

  it('derives className from routeTemplate', () => {
    const pageIR = buildPageIR({
      group: { routeTemplate: '/product/:id', representativeUrl: 'https://test.com/product/1', sampleUrls: [] },
      pageFingerprint: 'test-fp',
      elements: [],
      collections: [],
    });
    expect(pageIR.className).toBe('ProductPage');
  });

  it('carries through routeTemplate, representativeUrl, and sampleUrls', () => {
    const sampleUrls = ['https://test.com/1', 'https://test.com/2'];
    const pageIR = buildPageIR({
      group: { routeTemplate: '/items', representativeUrl: 'https://test.com/items', sampleUrls },
      pageFingerprint: 'fp123',
      elements: [],
      collections: [],
    });
    expect(pageIR.routeTemplate).toBe('/items');
    expect(pageIR.representativeUrl).toBe('https://test.com/items');
    expect(pageIR.sampleUrls).toEqual(sampleUrls);
    expect(pageIR.pageFingerprint).toBe('fp123');
  });

  it('does not mutate input arrays', () => {
    const elements = [makeElement('Zebra'), makeElement('apple')];
    const collections = [makeCollection('Z'), makeCollection('a')];
    const originalElementOrder = [...elements];
    const originalCollectionOrder = [...collections];

    buildPageIR({
      group: { routeTemplate: '/test', representativeUrl: 'https://test.com/test', sampleUrls: [] },
      pageFingerprint: 'test-fp',
      elements,
      collections,
    });

    expect(elements).toEqual(originalElementOrder);
    expect(collections).toEqual(originalCollectionOrder);
  });
});

describe('fingerprintPage', () => {
  it('is deterministic for the same input', () => {
    const snapshot = '<h1>Example</h1><p>Content</p>';
    const fp1 = fingerprintPage(snapshot);
    const fp2 = fingerprintPage(snapshot);
    expect(fp1).toBe(fp2);
  });

  it('differs for different input', () => {
    const fp1 = fingerprintPage('<h1>Page A</h1>');
    const fp2 = fingerprintPage('<h1>Page B</h1>');
    expect(fp1).not.toBe(fp2);
  });

  it('carries the pg_ prefix', () => {
    const fp = fingerprintPage('<h1>Test</h1>');
    expect(fp).toMatch(/^pg_/);
  });
});
