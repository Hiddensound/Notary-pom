import { describe, it, expect } from 'vitest';
import { fingerprintElement, classNameForRoute, fingerprintPage, uniqueClassNames } from '../../src/ir/fingerprint.js';
import { buildNotebook, buildPageIR } from '../../src/ir/build.js';
import { templateRoutes } from '../../src/url/routeTemplate.js';
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

  // Every one of these produced a class name that could not be parsed as a TypeScript
  // identifier before the segments were sanitised.
  it.each([
    ['/about.html', 'AboutHtmlPage'],
    ['/products/index.php', 'ProductsIndexPhpPage'],
    ['/docs/v1.2/intro', 'DocsV12IntroPage'],
    ['/2024/spring-sale', 'N2024SpringSalePage'],
    ['/2fast', 'N2fastPage'],
    ['/caf%C3%A9/menu', 'CafC3A9MenuPage'],
    ["/o'brien", 'OBrienPage'],
    ['/a+b', 'ABPage'],
  ])('sanitises %s -> %s', (route, expected) => {
    expect(classNameForRoute(route)).toBe(expected);
  });

  it.each([
    '/', '/about.html', '/products/index.php', '/docs/v1.2/intro', '/2024/spring-sale',
    '/2fast', '/caf%C3%A9/menu', "/o'brien", '/a+b', '/product/:param1', '/+++', '/~',
    '/%E4%B8%AD%E6%96%87', '/a b c', '/9', '/-', '/_',
  ])('%s yields a legal TypeScript identifier', (route) => {
    expect(classNameForRoute(route)).toMatch(/^[A-Za-z][A-Za-z0-9]*Page$/);
  });
});

describe('uniqueClassNames', () => {
  it('separates a blog index from its posts, which both reduce to BlogPage', () => {
    expect(classNameForRoute('/blog')).toBe('BlogPage');
    expect(classNameForRoute('/blog/:param1')).toBe('BlogPage');

    const names = uniqueClassNames(['/blog', '/blog/:param1']);
    expect(names.get('/blog')).toBe('BlogPage');
    expect(names.get('/blog/:param1')).toBe('BlogParam1Page');
  });

  it('separates the real templateRoutes output for a blog index plus posts', () => {
    const routes = templateRoutes([
      'https://s.test/blog',
      'https://s.test/blog/one',
      'https://s.test/blog/two',
      'https://s.test/blog/three',
    ]).map((g) => g.routeTemplate);
    expect(routes).toEqual(['/blog', '/blog/:param1']);

    const names = [...uniqueClassNames(routes).values()];
    expect(new Set(names).size).toBe(routes.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z][A-Za-z0-9]*Page$/);
  });

  it('falls through to a route hash when even the verbose names collide', () => {
    // `/a/:b` and `/a-b` both reduce to `ABPage` at tier 1 and at tier 2.
    const names = uniqueClassNames(['/a/:b', '/a-b']);
    expect(new Set(names.values()).size).toBe(2);
    for (const n of names.values()) expect(n).toMatch(/^[A-Za-z][A-Za-z0-9]*Page$/);
  });

  it('assigns from the set of routes, not their order', () => {
    const routes = ['/blog', '/blog/:param1', '/a/:b', '/a-b', '/about.html', '/'];
    const forward = uniqueClassNames(routes);
    const backward = uniqueClassNames([...routes].reverse());
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
  });

  it('is injective over a wide route sample', () => {
    const routes = [
      '/', '/blog', '/blog/:param1', '/about.html', '/about-html', '/a+b', '/a-b',
      '/a/:b', "/o'brien", '/o-brien', '/2024/spring-sale', '/caf%C3%A9/menu',
      '/products/index.php', '/products/index-php',
    ];
    const names = uniqueClassNames(routes);
    expect(names.size).toBe(routes.length);
    expect(new Set(names.values()).size).toBe(routes.length);
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

  it('gives two routes that reduce to one class name distinct class names', () => {
    const page = (routeTemplate: string) => ({
      routeTemplate, representativeUrl: 'https://s.test' + routeTemplate,
      sampleUrls: [], className: 'ignored', pageFingerprint: 'f', elements: [], collections: [],
    });
    const nb = buildNotebook(
      'https://s.test',
      [page('/blog'), page('/blog/:param1')],
      '2026-01-01T00:00:00Z',
    );
    expect(nb.pages.map((p) => p.className)).toEqual(['BlogPage', 'BlogParam1Page']);
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
