import { chromium } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { crawlSite } from '../../src/crawl/crawl.js';
import { withDefaults } from '../../src/config.js';
import { LoginRedirectError } from '../../src/browser/guard.js';

const PAGES: Record<string, string> = {
  '/': `<main><h1>Home</h1>
        <a href="/product/a">A</a><a href="/product/b">B</a><a href="/product/c">C</a>
        <a href="/account/logout">Log out</a></main>`,
  '/product/a': '<main><h1>A</h1><button data-testid="add">Add to cart</button></main>',
  '/product/b': '<main><h1>B</h1><button data-testid="add">Add to cart</button></main>',
  '/product/c': '<main><h1>C</h1><button data-testid="add">Add to cart</button></main>',
  '/account/logout': '<main><h1>Bye</h1></main>',
};

async function siteFixture(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  return async (route: import('@playwright/test').Route) => {
    const path = new URL(route.request().url()).pathname;
    const body = PAGES[path];
    if (!body) return route.fulfill({ status: 404, body: 'nope' });
    return route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html><body>${body}</body></html>` });
  };
}

test('templates product routes and harvests one representative', async () => {
  const browser = await chromium.launch();
  const config = withDefaults({ seed: 'https://shop.test/', maxPages: 20 });
  const notebook = await crawlSite(browser, config, await siteFixture(browser));
  await browser.close();

  const routes = notebook.pages.map((p) => p.routeTemplate).sort();
  expect(routes).toContain('/product/:param1');
  expect(notebook.pages.filter((p) => p.routeTemplate.startsWith('/product'))).toHaveLength(1);
});

test('never follows a logout link', async () => {
  const browser = await chromium.launch();
  const config = withDefaults({ seed: 'https://shop.test/' });
  const notebook = await crawlSite(browser, config, await siteFixture(browser));
  await browser.close();
  expect(notebook.pages.map((p) => p.routeTemplate)).not.toContain('/account/logout');
});

test('aborts loudly when a page looks like a login', async () => {
  const browser = await chromium.launch();
  const config = withDefaults({ seed: 'https://shop.test/' });
  const loginRoute = async (route: import('@playwright/test').Route) =>
    route.fulfill({ contentType: 'text/html', body: '<form><input type="password"></form>' });
  await expect(crawlSite(browser, config, loginRoute)).rejects.toThrow(LoginRedirectError);
  await browser.close();
});
