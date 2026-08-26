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
