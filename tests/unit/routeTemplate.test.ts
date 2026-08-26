import { describe, it, expect } from 'vitest';
import { templateRoutes } from '../../src/url/routeTemplate.js';

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
