import { chromium, expect, test } from '@playwright/test';
import { crawlSite } from '../../src/crawl/crawl.js';
import { withDefaults } from '../../src/config.js';
import { LoginRedirectError } from '../../src/browser/guard.js';

// Same page shapes as templateValidation.spec.ts's SAME_SHAPE fixture, so pass 1
// discovers a /p/:param1 template with 2+ samples and validateGroups actually runs.
const PAGES: Record<string, string> = {
  '/': '<main><a href="/p/a">A</a><a href="/p/b">B</a><a href="/p/c">C</a></main>',
  '/p/a': '<main><h1>A</h1><button data-testid="add">Add</button></main>',
  '/p/b': '<main><h1>B</h1><button data-testid="add">Add</button></main>',
  '/p/c': '<main><h1>C</h1><button data-testid="add">Add</button></main>',
};

const LOGIN_BODY = '<form><input type="password" /></form>';

test('closes the browser context when the login redirect is detected inside validateGroups', async () => {
  const browser = await chromium.launch();

  // Spy on every context this browser hands out, so we can prove close() runs on the
  // path that only validateGroups (not pass 1 or pass 2) can trigger.
  const originalNewContext = browser.newContext.bind(browser);
  let closeCalls = 0;
  browser.newContext = (async (...args: Parameters<typeof originalNewContext>) => {
    const context = await originalNewContext(...args);
    const originalClose = context.close.bind(context);
    context.close = (async (...closeArgs: Parameters<typeof originalClose>) => {
      closeCalls++;
      return originalClose(...closeArgs);
    }) as typeof context.close;
    return context;
  }) as typeof browser.newContext;

  // Each path serves its normal fixture the first time it is requested -- so pass 1's
  // discovery walk completes normally and builds a validatable /p/:param1 group -- then
  // flips to a login-looking page on every subsequent request. That simulates a session
  // expiring between pass 1 and validateGroups' revisit of the very same URLs, so the
  // LoginRedirectError can only originate from inside validateGroups, never pass 1 or 2.
  const visitCounts = new Map<string, number>();
  const routeHandler = async (route: import('@playwright/test').Route) => {
    const path = new URL(route.request().url()).pathname;
    const body = PAGES[path];
    if (!body) return route.fulfill({ status: 404, body: 'nope' });
    const count = (visitCounts.get(path) ?? 0) + 1;
    visitCounts.set(path, count);
    const html = count === 1 ? body : LOGIN_BODY;
    return route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html><body>${html}</body></html>` });
  };

  const config = withDefaults({ seed: 'https://shop.test/' });
  await expect(crawlSite(browser, config, routeHandler)).rejects.toThrow(LoginRedirectError);

  expect(closeCalls).toBe(1);
  await browser.close();
});
