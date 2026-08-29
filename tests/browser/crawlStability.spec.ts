import { chromium, expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';
import { crawlSite } from '../../src/crawl/crawl.js';
import type { UnstablePage } from '../../src/crawl/crawl.js';
import { withDefaults } from '../../src/config.js';

const ITEMS = Array.from({ length: 25 }, (_, i) => i + 1);

// A two-page SPA: the catalogue arrives by XHR after `delay` ms, which is what pass 1
// must see to find the links and what pass 2 must see to harvest the real page.
function spaSite(delay: number) {
  return async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/items') {
      await new Promise((r) => setTimeout(r, delay));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ITEMS) });
    }
    if (path === '/about') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body><main><h1>About</h1></main></body></html>',
      });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<!DOCTYPE html><html><body>
        <header><a href="/about">About</a></header>
        <main><h1>Catalogue</h1><ul id="root"></ul></main>
        <script>fetch('/api/items').then(function(r){return r.json();}).then(function(items){
          document.getElementById('root').innerHTML = items.map(function(i){
            return '<li><button data-testid="item-'+i+'">Buy '+i+'</button></li>';
          }).join('');
        });</script>
      </body></html>`,
    });
  };
}

const neverQuiet = async (route: Route) => route.fulfill({
  contentType: 'text/html',
  body: `<!DOCTYPE html><html><body><main><h1>Ticker</h1><div id="a"></div></main><script>
    setInterval(function(){document.getElementById('a').textContent=String(Math.random());}, 20);
  </script></body></html>`,
});

test('a crawl of an XHR-hydrated site harvests the same elements however slow the content is', async () => {
  test.setTimeout(180_000);
  const browser = await chromium.launch();
  try {
    const counts: number[] = [];
    const items: number[] = [];
    for (const delay of [350, 800]) {
      const nb = await crawlSite(
        browser,
        withDefaults({ seed: 'https://spa.test/', maxPages: 5 }),
        spaSite(delay),
      );
      const home = nb.pages.find((p) => p.routeTemplate === '/')!;
      counts.push(home.elements.length);
      items.push(home.elements.filter((e) => (e.observed.testId ?? '').startsWith('item-')).length);
    }
    expect(counts[0]).toBe(counts[1]);
    // Every one of the XHR-delivered buttons is present in both crawls, so the equality
    // above is equality on the hydrated page rather than on two identical shells.
    expect(items).toEqual([25, 25]);
  } finally {
    await browser.close();
  }
});

test('a crawl tells the caller which pages were sampled before they stabilised', async () => {
  test.setTimeout(180_000);
  const browser = await chromium.launch();
  try {
    const unstable: UnstablePage[] = [];
    await crawlSite(
      browser,
      withDefaults({ seed: 'https://ticker.test/', maxPages: 1 }),
      neverQuiet,
      (u) => unstable.push(u),
    );

    expect(unstable.length).toBeGreaterThan(0);
    expect(unstable.every((u) => u.url === 'https://ticker.test/')).toBe(true);
    expect(unstable.every((u) => u.reason === 'mutation')).toBe(true);
    expect(unstable.map((u) => u.phase)).toContain('discover');
    expect(unstable.map((u) => u.phase)).toContain('harvest');
  } finally {
    await browser.close();
  }
});

test('a crawl of a stable site reports nothing unstable', async () => {
  test.setTimeout(180_000);
  const browser = await chromium.launch();
  try {
    const unstable: UnstablePage[] = [];
    await crawlSite(
      browser,
      withDefaults({ seed: 'https://spa.test/', maxPages: 5 }),
      spaSite(350),
      (u) => unstable.push(u),
    );
    expect(unstable).toEqual([]);
  } finally {
    await browser.close();
  }
});
