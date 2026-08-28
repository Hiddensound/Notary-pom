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
  const routed = (routeTemplate: string, representativeUrl = 'https://s.test' + routeTemplate) =>
    ({ routeTemplate, representativeUrl });
  const HASHED = /^[A-Za-z][A-Za-z0-9]*Rt[0-9a-f]{8,}Page$/;

  it('separates a blog index from its posts, which both reduce to BlogPage', () => {
    expect(classNameForRoute('/blog')).toBe('BlogPage');
    expect(classNameForRoute('/blog/:param1')).toBe('BlogPage');

    expect(uniqueClassNames([routed('/blog'), routed('/blog/:param1')]))
      .toEqual(['BlogPage', 'BlogParam1Page']);
  });

  it('separates the real templateRoutes output for a blog index plus posts', () => {
    const groups = templateRoutes([
      'https://s.test/blog',
      'https://s.test/blog/one',
      'https://s.test/blog/two',
      'https://s.test/blog/three',
    ]);
    expect(groups.map((g) => g.routeTemplate)).toEqual(['/blog', '/blog/:param1']);

    const names = uniqueClassNames(groups);
    expect(new Set(names).size).toBe(groups.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z][A-Za-z0-9]*Page$/);
  });

  // Tier 3 is only reached when tiers 1 and 2 both fail. `/a/:b` and `/a-b` do NOT
  // qualify: `/a/:b` drops its parameter at tier 1 and is already `APage`, so that pair
  // separates immediately and never exercises the hash at all.
  it('does not reach the hash tier for a pair that separates at tier 1', () => {
    expect(uniqueClassNames([routed('/a/:b'), routed('/a-b')])).toEqual(['APage', 'ABPage']);
  });

  it('hashes when tier 1 and tier 2 produce the same name for both routes', () => {
    // `/1` gets the leading-digit guard and `/n1` is already `N1`, so both reduce to
    // `N1Page` at tier 1, and neither has a parameter segment to add at tier 2.
    expect(classNameForRoute('/1')).toBe('N1Page');
    expect(classNameForRoute('/n1')).toBe('N1Page');

    const names = uniqueClassNames([routed('/1'), routed('/n1')]);
    expect(new Set(names).size).toBe(2);
    for (const n of names) expect(n).toMatch(HASHED);
  });

  it('hashes when the tier 2 name is already taken by another route', () => {
    // `/blog` and `/blog/:param1` both want `BlogPage` at tier 1; at tier 2 the second
    // wants `BlogParam1Page`, which `/blog-param1` already took at tier 1.
    const names = uniqueClassNames([routed('/blog'), routed('/blog/:param1'), routed('/blog-param1')]);
    expect(names[0]).toBe('BlogPage');
    expect(names[2]).toBe('BlogParam1Page');
    expect(names[1]).toMatch(HASHED);
    expect(new Set(names).size).toBe(3);
  });

  it('hashes every route that reduces to Root', () => {
    const routes = ['/%', '/+', '/-', '/_', '/~'];
    for (const r of routes) expect(classNameForRoute(r)).toBe('RootPage');

    const names = uniqueClassNames(routes.map((r) => routed(r)));
    expect(new Set(names).size).toBe(routes.length);
    for (const n of names) expect(n).toMatch(HASHED);
  });

  it('assigns from the set of pages, not their order', () => {
    const pages = ['/blog', '/blog/:param1', '/blog-param1', '/1', '/n1', '/about.html', '/']
      .map((r) => routed(r));
    const forward = pages.map((p, i) => [p.routeTemplate, uniqueClassNames(pages)[i]]);
    const reversed = [...pages].reverse();
    const backward = reversed.map((p, i) => [p.routeTemplate, uniqueClassNames(reversed)[i]]);
    expect(forward.slice().sort()).toEqual(backward.slice().sort());
  });

  it('is injective over a wide route sample', () => {
    const pages = [
      '/', '/blog', '/blog/:param1', '/blog-param1', '/about.html', '/about-html', '/a+b',
      '/a-b', '/a/:b', "/o'brien", '/o-brien', '/2024/spring-sale', '/caf%C3%A9/menu',
      '/products/index.php', '/products/index-php', '/1', '/n1', '/%', '/+', '/~',
    ].map((r) => routed(r));
    const names = uniqueClassNames(pages);
    expect(names).toHaveLength(pages.length);
    expect(new Set(names).size).toBe(pages.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z][A-Za-z0-9]*Page$/);
  });

  // Defence in depth for the case `mergeRouteGroups` now prevents upstream. Keying on
  // route strings collapsed these two pages into one entry and gave both the same class
  // name; keying on pages separates them by representative URL instead.
  it('separates two pages that share a route template', () => {
    const names = uniqueClassNames([
      routed('/p', 'https://s.test/p?utm_source=nav'),
      routed('/p', 'https://s.test/p?utm_source=footer'),
    ]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    for (const n of names) expect(n).toMatch(/^[A-Za-z][A-Za-z0-9]*Page$/);
  });

  it('throws rather than returning a duplicate for two wholly identical pages', () => {
    expect(() => uniqueClassNames([routed('/p'), routed('/p')]))
      .toThrow(/Cannot derive a unique class name for route "\/p"/);
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
    expect(nb.version).toBe('2');
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
