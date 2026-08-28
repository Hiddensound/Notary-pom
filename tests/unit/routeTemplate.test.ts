import { describe, it, expect } from 'vitest';
import { mergeRouteGroups, templateRoutes } from '../../src/url/routeTemplate.js';
import { scrubUrl } from '../../src/url/scrub.js';
import { uniqueClassNames } from '../../src/ir/fingerprint.js';

describe('templateRoutes', () => {
  it('collapses a varying segment once 3+ siblings differ', () => {
    const groups = templateRoutes([
      'https://s.test/product/a',
      'https://s.test/product/b',
      'https://s.test/product/c',
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].routeTemplate).toBe('/product/:param1');
    expect(groups[0].sampleUrls).toHaveLength(3);
  });

  it('does not collapse below the threshold', () => {
    const groups = templateRoutes(['https://s.test/product/a', 'https://s.test/product/b']);
    expect(groups.map((g) => g.routeTemplate).sort()).toEqual(['/product/a', '/product/b']);
  });

  it('keeps different depths apart', () => {
    const groups = templateRoutes([
      'https://s.test/a', 'https://s.test/b', 'https://s.test/c',
      'https://s.test/x/1', 'https://s.test/x/2', 'https://s.test/x/3',
    ]);
    expect(groups.map((g) => g.routeTemplate).sort()).toEqual(['/:param0', '/x/:param1']);
  });

  it('is deterministic — representativeUrl is the lexicographically first sample', () => {
    const a = templateRoutes(['https://s.test/p/c', 'https://s.test/p/a', 'https://s.test/p/b']);
    const b = templateRoutes(['https://s.test/p/b', 'https://s.test/p/c', 'https://s.test/p/a']);
    expect(a[0].representativeUrl).toBe(b[0].representativeUrl);
    expect(a[0].representativeUrl).toBe('https://s.test/p/a');
  });

  it('handles the root path', () => {
    expect(templateRoutes(['https://s.test/'])[0].routeTemplate).toBe('/');
  });
});

describe('mergeRouteGroups', () => {
  // The trigger is real end to end: scrubUrl strips only a credential blocklist, so utm_*
  // survives and two distinct crawled URLs share one pathname. validateGroups' fallback
  // keys its groups on that pathname, so it emits the same routeTemplate twice.
  it('the utm_* pair really does survive scrubUrl with one shared pathname', () => {
    const a = scrubUrl('https://s.test/product/b?utm_source=nav');
    const b = scrubUrl('https://s.test/product/b?utm_source=footer');
    expect(a).not.toBe(b);
    expect(new URL(a).pathname).toBe(new URL(b).pathname);
  });

  it('folds groups sharing a route template into one, merging their samples', () => {
    const merged = mergeRouteGroups([
      { routeTemplate: '/product/b', representativeUrl: 'https://s.test/product/b?utm_source=nav', sampleUrls: ['https://s.test/product/b?utm_source=nav'] },
      { routeTemplate: '/product/b', representativeUrl: 'https://s.test/product/b?utm_source=footer', sampleUrls: ['https://s.test/product/b?utm_source=footer'] },
      { routeTemplate: '/product/a', representativeUrl: 'https://s.test/product/a', sampleUrls: ['https://s.test/product/a'] },
    ]);

    expect(merged.map((g) => g.routeTemplate)).toEqual(['/product/a', '/product/b']);
    expect(merged[1].sampleUrls).toEqual([
      'https://s.test/product/b?utm_source=footer',
      'https://s.test/product/b?utm_source=nav',
    ]);
    // Lexicographically first, matching templateRoutes' own convention, so the result does
    // not depend on which duplicate arrived first.
    expect(merged[1].representativeUrl).toBe('https://s.test/product/b?utm_source=footer');
  });

  it('is order-independent', () => {
    const groups = [
      { routeTemplate: '/p', representativeUrl: 'https://s.test/p?utm_source=nav', sampleUrls: ['https://s.test/p?utm_source=nav'] },
      { routeTemplate: '/p', representativeUrl: 'https://s.test/p?utm_source=footer', sampleUrls: ['https://s.test/p?utm_source=footer'] },
      { routeTemplate: '/q', representativeUrl: 'https://s.test/q', sampleUrls: ['https://s.test/q'] },
    ];
    expect(mergeRouteGroups(groups)).toEqual(mergeRouteGroups([...groups].reverse()));
  });

  it('leaves already-distinct groups untouched', () => {
    const groups = templateRoutes(['https://s.test/a', 'https://s.test/b']);
    expect(mergeRouteGroups(groups)).toEqual(groups);
  });

  it('deduplicates repeated sample urls rather than accumulating them', () => {
    const merged = mergeRouteGroups([
      { routeTemplate: '/p', representativeUrl: 'https://s.test/p', sampleUrls: ['https://s.test/p'] },
      { routeTemplate: '/p', representativeUrl: 'https://s.test/p', sampleUrls: ['https://s.test/p'] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sampleUrls).toEqual(['https://s.test/p']);
  });

  it('leaves a route-template set uniqueClassNames can name without refusing', () => {
    // Unmerged, these two are the exact input uniqueClassNames must reject.
    const duplicated = [
      { routeTemplate: '/p', representativeUrl: 'https://s.test/p', sampleUrls: ['https://s.test/p'] },
      { routeTemplate: '/p', representativeUrl: 'https://s.test/p', sampleUrls: ['https://s.test/p'] },
    ];
    expect(() => uniqueClassNames(duplicated)).toThrow();
    expect(uniqueClassNames(mergeRouteGroups(duplicated))).toEqual(['PPage']);
  });
});
