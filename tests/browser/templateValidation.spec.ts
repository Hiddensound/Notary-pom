import { chromium, expect, test } from '@playwright/test';
import { crawlSite } from '../../src/crawl/crawl.js';
import { withDefaults } from '../../src/config.js';

const SAME_SHAPE: Record<string, string> = {
  '/': '<main><a href="/p/a">A</a><a href="/p/b">B</a><a href="/p/c">C</a></main>',
  '/p/a': '<main><h1>A</h1><button data-testid="add">Add</button></main>',
  '/p/b': '<main><h1>B</h1><button data-testid="add">Add</button></main>',
  '/p/c': '<main><h1>C</h1><button data-testid="add">Add</button></main>',
};

const MIXED_SHAPE: Record<string, string> = {
  '/': '<main><a href="/p/a">A</a><a href="/p/b">B</a><a href="/p/c">C</a></main>',
  '/p/a': '<main><h1>A</h1><button data-testid="add">Add</button></main>',
  '/p/b': '<main><h1>B</h1><form><input type="number" /><select></select></form></main>',
  '/p/c': '<main><h1>C</h1><button data-testid="add">Add</button></main>',
};

// Same structural disagreement as MIXED_SHAPE, but /p/b is reached by two distinct URLs
// that differ only in a `utm_*` param. scrubUrl keeps utm_*, so both survive pass 1 as
// separate URLs, and validateGroups' fallback keys its groups on `new URL(url).pathname`
// -- which is identical for the two. Without mergeRouteGroups that emits /p/b twice.
const MIXED_SHAPE_WITH_QUERY_TWINS: Record<string, string> = {
  '/': '<main>'
    + '<a href="/p/a">A</a>'
    + '<a href="/p/b?utm_source=nav">B via nav</a>'
    + '<a href="/p/b?utm_source=footer">B via footer</a>'
    + '<a href="/p/c">C</a>'
    + '</main>',
  '/p/a': '<main><h1>A</h1><button data-testid="add">Add</button></main>',
  '/p/b': '<main><h1>B</h1><form><input type="number" /><select></select></form></main>',
  '/p/c': '<main><h1>C</h1><button data-testid="add">Add</button></main>',
};

const serve = (pages: Record<string, string>) =>
  async (route: import('@playwright/test').Route) => {
    const path = new URL(route.request().url()).pathname;
    const body = pages[path];
    if (!body) return route.fulfill({ status: 404, body: 'nope' });
    return route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html><body>${body}</body></html>` });
  };

test('keeps one template when the samples share a structure', async () => {
  const browser = await chromium.launch();
  const nb = await crawlSite(browser, withDefaults({ seed: 'https://shop.test/' }), serve(SAME_SHAPE));
  await browser.close();
  expect(nb.pages.map((p) => p.routeTemplate)).toContain('/p/:param1');
});

test('splits the template when two samples are structurally different', async () => {
  const browser = await chromium.launch();
  const nb = await crawlSite(browser, withDefaults({ seed: 'https://shop.test/' }), serve(MIXED_SHAPE));
  await browser.close();

  const routes = nb.pages.map((p) => p.routeTemplate);
  expect(routes).not.toContain('/p/:param1');
  expect(routes).toEqual(expect.arrayContaining(['/p/a', '/p/b', '/p/c']));
});

test('emits one page per pathname when the split fallback sees two urls sharing one', async () => {
  const browser = await chromium.launch();
  const nb = await crawlSite(
    browser,
    withDefaults({ seed: 'https://shop.test/' }),
    serve(MIXED_SHAPE_WITH_QUERY_TWINS),
  );
  await browser.close();

  const routes = nb.pages.map((p) => p.routeTemplate);
  // The fallback fired, so the template really did split into literal pathnames.
  expect(routes).not.toContain('/p/:param1');
  expect(routes).toEqual(expect.arrayContaining(['/p/a', '/p/b', '/p/c']));

  // One page per pathname, not one per URL.
  expect(routes.filter((r) => r === '/p/b')).toHaveLength(1);
  expect(new Set(routes).size).toBe(routes.length);

  // Class names stay injective, so writeGenerated cannot lose a page object, and
  // diffNotebooks -- which keys pages by routeTemplate -- cannot silently drop one.
  const classNames = nb.pages.map((p) => p.className);
  expect(new Set(classNames).size).toBe(classNames.length);

  // Both URLs are preserved as samples of the one page rather than one being discarded.
  const b = nb.pages.find((p) => p.routeTemplate === '/p/b')!;
  expect(b.sampleUrls).toEqual([
    'https://shop.test/p/b?utm_source=footer',
    'https://shop.test/p/b?utm_source=nav',
  ]);
});
