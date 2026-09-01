import { chromium } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { crawlSite } from '../../src/crawl/crawl.js';
import { withDefaults } from '../../src/config.js';
import { LoginRedirectError, OffOriginError } from '../../src/browser/guard.js';

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

// Pass 1: a same-origin link that redirects to a different origin. The off-origin
// landing is not a page of the site under test, so it must be skipped -- not pushed
// into the notebook and not treated as a source of further links -- while the rest of
// the queued, genuinely same-origin crawl still completes normally.
//
// The redirect is done client-side (`location.href = ...`) rather than via an HTTP 3xx
// from `route.fulfill`: this sandbox's Chromium resolves DNS for the browser-followed
// hop of a `route.fulfill`-issued redirect on a navigation request even when the
// target is nominally intercepted (reproduced independently of this fixture -- it
// fails identically for a same-origin, same-port redirect target, so it is not
// specific to crossing origins), which makes `*.test` fixture hosts unusable for that
// shape here. A script redirect exercises the exact code path `crawlSite` actually
// reacts to: `page.goto()` resolving with `page.url()` on the final, off-origin
// destination -- crawl.ts never inspects HTTP status codes, only `page.url()`.
test('skips a same-origin link that redirects off-origin during discovery, without following its own links', async () => {
  const browser = await chromium.launch();
  const config = withDefaults({ seed: 'https://shop.test/', maxPages: 20 });
  const routeHandler = async (route: import('@playwright/test').Route) => {
    const url = route.request().url();
    if (url === 'https://shop.test/') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body><main><h1>Home</h1>'
          + '<a href="/redirect-away">Away</a><a href="/product/a">A</a></main></body></html>',
      });
    }
    if (url === 'https://shop.test/redirect-away') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<script>location.href = "https://other.test/landing";</script>',
      });
    }
    if (url === 'https://other.test/landing') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body><main><h1>Other site</h1>'
          + '<a href="/should-not-leak">Leak</a></main></body></html>',
      });
    }
    if (url === 'https://shop.test/product/a') {
      return route.fulfill({ contentType: 'text/html', body: '<main><h1>A</h1></main>' });
    }
    return route.fulfill({ status: 404, body: 'nope' });
  };

  const notebook = await crawlSite(browser, config, routeHandler);
  await browser.close();

  const routes = notebook.pages.map((p) => p.routeTemplate);
  // The dangerous case: without the origin check, `discovered` is pushed with the
  // *requested* same-origin URL ('/redirect-away'), not `page.url()` -- so the mislabel
  // shows up as a page object named after the site's own route, secretly built from the
  // other site's DOM. Asserting on '/landing' would miss this entirely.
  expect(routes).not.toContain('/redirect-away');
  expect(routes).not.toContain('/landing');
  expect(routes).not.toContain('/should-not-leak');
  expect(routes).toContain('/product/a');
});

// Pass 2: the URL chosen as a route template's sole representative looked fine on
// discovery but redirects off-origin when re-visited for harvest. There is no fallback
// representative to try instead, so this must abort loudly with a distinct diagnosis from
// LoginRedirectError -- an off-origin landing is not necessarily a login page.
test('aborts loudly when the chosen representative redirects off-origin on the harvest pass', async () => {
  const browser = await chromium.launch();
  const config = withDefaults({ seed: 'https://shop.test/', maxPages: 20 });
  let gateHits = 0;
  const routeHandler = async (route: import('@playwright/test').Route) => {
    const url = route.request().url();
    if (url === 'https://shop.test/') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body><main><h1>Home</h1><a href="/gate">Gate</a></main></body></html>',
      });
    }
    if (url === 'https://shop.test/gate') {
      gateHits += 1;
      // First visit is pass 1 discovery: looks like an ordinary same-origin page. Second
      // visit is pass 2 harvest, re-navigating the same representativeUrl: redirects
      // off-origin. `/gate` is not parameterised, so `validateGroups` never revisits it
      // (single-sample groups and non-`:param` templates both skip its comparison loop),
      // which keeps this to exactly two navigations and makes the fixture unambiguous.
      if (gateHits === 1) {
        return route.fulfill({ contentType: 'text/html', body: '<main><h1>Gate</h1></main>' });
      }
      return route.fulfill({
        contentType: 'text/html',
        body: '<script>location.href = "https://other.test/landing";</script>',
      });
    }
    if (url === 'https://other.test/landing') {
      return route.fulfill({ contentType: 'text/html', body: '<main><h1>Other</h1></main>' });
    }
    return route.fulfill({ status: 404, body: 'nope' });
  };

  await expect(crawlSite(browser, config, routeHandler)).rejects.toThrow(OffOriginError);
  await browser.close();
});
