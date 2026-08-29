import { expect, test } from '@playwright/test';
import type { Route } from '@playwright/test';
import { settle } from '../../src/browser/settle.js';
import { harvest } from '../../src/harvest/harvest.js';

// The shell every SPA fixture below starts from: what the server sends, before any
// XHR-delivered content exists. Four harvestable interactive elements plus a heading.
// `deferMs` decides *when* the content fetch is issued:
//   0   -- issued during parse, so it is already in flight when `settle` is entered
//         (the plain "delayed XHR hydration" shape, fixture (a));
//   800 -- issued well after the document itself has gone network-idle, so a wait for
//         `networkidle` alone is already satisfied before the fetch even starts
//         (fixture (a2)).
function shell(deferMs: number): string {
  const fire =
    `function go(){fetch('/api/items').then(function(r){return r.json();})`
    + `.then(function(items){document.getElementById('root').innerHTML=`
    + `items.map(function(i){return '<li><button data-testid="item-'+i+'">Buy '+i+'</button></li>';})`
    + `.join('');});}`;
  const kick = deferMs > 0 ? `setTimeout(go, ${deferMs});` : 'go();';
  return `<!DOCTYPE html><html><body>
    <header>
      <a href="/">Home</a>
      <a href="/about">About</a>
      <input type="search" aria-label="Search" />
      <button>Go</button>
    </header>
    <main><h1>Catalogue</h1><ul id="root"></ul></main>
    <script>${fire}${kick}</script>
  </body></html>`;
}

const ITEMS = Array.from({ length: 25 }, (_, i) => i + 1);

// A fixture whose content fetch resolves after `delay()` ms. `delay` is read per request
// so one page can be re-navigated with a different issue time and latency each time.
// Both are read per request precisely so a test can *sweep* either of them: the two are
// independent variables and a gate that sweeps only one proves only one.
function spaRoute(defer: () => number, delay: () => number) {
  return async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/items') {
      await new Promise((r) => setTimeout(r, delay()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ITEMS) });
    }
    return route.fulfill({ contentType: 'text/html', body: shell(defer()) });
  };
}

const itemCount = (records: Awaited<ReturnType<typeof harvest>>) =>
  records.filter((r) => (r.testId ?? '').startsWith('item-')).length;

// ---------------------------------------------------------------------------
// (a) Delayed XHR hydration -- the 36/11/11 reproduction in miniature.
//
// The 2000ms latency is chosen to be longer than the confirmation windows can cover on
// their own, so this fixture pins the `networkidle` wait specifically: only a wait whose
// length adapts to the actual request survives it.
// ---------------------------------------------------------------------------

test('settle waits for content that arrives by XHR after the quiet window would have expired', async ({ page }) => {
  await page.route('**/*', spaRoute(() => 0, () => 2000));
  await page.goto('https://spa.test/', { waitUntil: 'domcontentloaded' });

  const result = await settle(page);

  // The DOM is the property under test, so it is asserted first: an assertion on the
  // result shape would fail earlier against a `settle` that returns void, and a RED that
  // dies on an earlier line is not evidence for the line under test.
  expect(itemCount(await harvest(page, 'data-testid'))).toBe(25);
  expect(result).toEqual({ stable: true, reason: 'quiet', elapsedMs: expect.any(Number) });
});

// ---------------------------------------------------------------------------
// (a2) Deferred XHR -- the fetch is issued *after* the document is already
// network-idle, so waiting for `networkidle` once is not on its own enough.
// ---------------------------------------------------------------------------

test('settle waits for a fetch issued after the document has already gone network-idle', async ({ page }) => {
  await page.route('**/*', spaRoute(() => 800, () => 600));
  await page.goto('https://spa.test/', { waitUntil: 'domcontentloaded' });

  const result = await settle(page);

  expect(itemCount(await harvest(page, 'data-testid'))).toBe(25);
  expect(result).toEqual({ stable: true, reason: 'quiet', elapsedMs: expect.any(Number) });
});

// ---------------------------------------------------------------------------
// The mutation observer's positive path: wait out a DOM mutation stream that involves
// no network traffic at all.
//
// `browser.spec.ts:8` used to be the only test covering this. It still passes, but it
// stopped *discriminating* the moment the network-idle wait went in front of it: its
// mutation stream finishes at ~200ms and the network-idle wait alone runs ~500ms, so its
// assertions are satisfied before the observer does anything (review A-3, which measured
// it passing against a `settle` with the whole mutation phase deleted). Nothing else in
// the repo failed if that phase regressed.
//
// This fixture mutates for 1500ms -- three times the network-idle window -- with no
// requests whatsoever, so only the observer can get to the end of it. Nothing in
// `browser.spec.ts` was changed to achieve that; the coverage is added, not moved.
// ---------------------------------------------------------------------------

test('settle waits out a mutation stream that outlasts the network-idle wait and makes no requests', async ({ page }) => {
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><body><main><h1>Growing</h1><ul id="a"></ul></main><script>
      var n = 0;
      var t = setInterval(function(){
        n += 1;
        document.getElementById('a').innerHTML += '<li data-testid="row-' + n + '">row ' + n + '</li>';
        if (n === 15) clearInterval(t);
      }, 100);
    </script></body></html>`,
  }));
  await page.goto('https://growing.test/', { waitUntil: 'domcontentloaded' });

  const start = Date.now();
  const result = await settle(page);
  const elapsed = Date.now() - start;

  // The whole stream must be on the page: 15 rows, not the 5-ish a wait that gave up
  // after the network-idle window would have seen.
  expect(await page.locator('[data-testid^="row-"]').count()).toBe(15);
  // And it must have taken longer than the stream, which is the part only the observer
  // can deliver.
  expect(elapsed).toBeGreaterThan(1500);
  expect(result.stable).toBe(true);
});

// ---------------------------------------------------------------------------
// (b) Never-quiet page -- the budget path, and it must say so.
// ---------------------------------------------------------------------------

test('settle reports a never-quiet page as unstable rather than returning silently', async ({ page }) => {
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><body><main><h1>Ticker</h1><div id="a"></div></main><script>
      setInterval(function(){document.getElementById('a').textContent=String(Math.random());}, 20);
    </script></body></html>`,
  }));
  await page.goto('https://ticker.test/', { waitUntil: 'domcontentloaded' });

  const start = Date.now();
  const result = await settle(page, 300, 2500);

  // R2: the Node-side budget holds, not merely the in-page one.
  expect(Date.now() - start).toBeLessThan(4000);
  // The whole point of the result type is that exhaustion is not silence, so the shape is
  // asserted as a whole: against a `settle` that returns void this reads
  // `expect(undefined).toEqual({...})`, which names the missing contract instead of
  // dying on a TypeError one property in.
  expect(result).toEqual({ stable: false, reason: 'mutation', elapsedMs: expect.any(Number) });
  expect(result.elapsedMs).toBeLessThan(4000);
});

// ---------------------------------------------------------------------------
// Cause 3 -- the quiet timer must not survive the cap path.
//
// The page shims setTimeout/clearTimeout to track outstanding ids before `settle`'s
// in-page observer is installed, so a timer the observer leaves armed is directly
// observable from the test without production code exposing anything.
// ---------------------------------------------------------------------------

test('settle leaves no timer armed in the page when it gives up on a never-quiet page', async ({ page }) => {
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><body><main><h1>Ticker</h1><div id="a"></div></main><script>
      window.__pending = new Set();
      var _st = window.setTimeout, _ct = window.clearTimeout;
      window.setTimeout = function(fn, ms){
        var id = _st.call(window, function(){ window.__pending.delete(id); if (fn) fn(); }, ms);
        window.__pending.add(id);
        return id;
      };
      window.clearTimeout = function(id){ window.__pending.delete(id); return _ct.call(window, id); };
      setInterval(function(){document.getElementById('a').textContent=String(Math.random());}, 20);
    </script></body></html>`,
  }));
  await page.goto('https://ticker.test/', { waitUntil: 'domcontentloaded' });

  const result = await settle(page, 300, 2500);
  const armed = await page.evaluate(() => (window as unknown as { __pending: Set<number> }).__pending.size);

  // The leak is the property under test, so `armed` is asserted before anything about the
  // result: asserting `result.stable` first made this test's RED a TypeError that never
  // reached this line, which proved nothing about a leaked timer (review A-5).
  expect(armed).toBe(0);
  expect(result.stable).toBe(false);
});

// ---------------------------------------------------------------------------
// The abandoned path must not leave a live observer behind.
//
// When the in-page promise never settles -- here because the page's `setTimeout` has been
// replaced with a no-op, so neither the quiet timer nor the in-page cap can ever fire --
// the Node side stops waiting and returns. The observer it installed used to stay
// connected for the rest of the document's life, and `crawl.ts` runs `harvest` on that
// same document immediately afterwards, so it was a live document-wide observer with
// `attributes: true` running through the harvest (review A-6).
//
// The page shims `MutationObserver` to count connected instances, which is the only way
// to see this from outside.
// ---------------------------------------------------------------------------

test('settle disconnects its observer even when the in-page promise is abandoned', async ({ page }) => {
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><body><main><h1>Wedged</h1><div id="a"></div></main><script>
      window.__mo = { live: 0 };
      var Real = window.MutationObserver;
      window.MutationObserver = function(cb){
        var inner = new Real(cb), connected = false;
        return {
          observe: function(t, o){ if (!connected) { connected = true; window.__mo.live++; }
                                   return inner.observe(t, o); },
          disconnect: function(){ if (connected) { connected = false; window.__mo.live--; }
                                  return inner.disconnect(); },
          takeRecords: function(){ return inner.takeRecords(); }
        };
      };
      // setInterval still works, so the page keeps mutating; setTimeout does not, so
      // nothing inside settle's in-page promise can ever resolve it.
      setInterval(function(){document.getElementById('a').textContent=String(Math.random());}, 20);
      window.setTimeout = function(){ return 0; };
    </script></body></html>`,
  }));
  await page.goto('https://wedged.test/', { waitUntil: 'domcontentloaded' });

  const result = await settle(page, 300, 1500);
  // The observer disconnects itself on its next callback once it has outlived its cap,
  // so give the page's own interval a couple of ticks to deliver one.
  await page.waitForTimeout(200);
  const live = await page.evaluate(() => (window as unknown as { __mo: { live: number } }).__mo.live);

  expect(live).toBe(0);
  expect(result.stable).toBe(false);
});

// ---------------------------------------------------------------------------
// (c) Plain static page -- the control for R4, and the shape the caller branches on.
// ---------------------------------------------------------------------------

test('settle reports a plain static page stable, quickly', async ({ page }) => {
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!DOCTYPE html><html><body><main><h1>Static</h1><button>Go</button></main></body></html>',
  }));
  await page.goto('https://static.test/', { waitUntil: 'domcontentloaded' });

  const start = Date.now();
  const result = await settle(page);

  // R4: a server-rendered page must not pay a large fixed penalty. Measured from the
  // wall clock first, so this line does not depend on the result type existing.
  expect(Date.now() - start).toBeLessThan(2500);
  expect(result).toEqual({ stable: true, reason: 'quiet', elapsedMs: expect.any(Number) });
});

// ---------------------------------------------------------------------------
// The acceptance criterion (evidence bar section 3): sweep the content latency
// across the quiet window and require one single harvest result for all of it.
//
// The delay sweep is deliberate rather than random: 300..870ms straddles the 500ms
// quiet window, so a settle that races a fixed timer against the network is *forced*
// to produce a mixed distribution here, and one that waits for the content is forced
// to produce a single value. The distribution is printed either way.
// ---------------------------------------------------------------------------

test('harvest of an XHR-hydrated page is identical across 20 runs with the latency swept through the quiet window', async ({ page }) => {
  test.setTimeout(240_000);

  let delay = 300;
  await page.route('**/*', spaRoute(() => 0, () => delay));

  const counts: number[] = [];
  for (let i = 0; i < 20; i++) {
    delay = 300 + i * 30;
    await page.goto('https://spa.test/', { waitUntil: 'domcontentloaded' });
    await settle(page);
    counts.push((await harvest(page, 'data-testid')).length);
  }

  const distribution: Record<string, number> = {};
  for (const c of counts) distribution[c] = (distribution[c] ?? 0) + 1;
  console.log(`SETTLE DETERMINISM DISTRIBUTION (20 runs, delay 300..870ms): ${JSON.stringify(distribution)}`);
  console.log(`SETTLE DETERMINISM SEQUENCE: ${JSON.stringify(counts)}`);

  expect(new Set(counts).size).toBe(1);
});

// ---------------------------------------------------------------------------
// The acceptance criterion, second half. Latency and issue time are independent
// variables, and the sweep above only moves one of them: with the fetch issued during
// parse, `networkidle` covers every latency by construction, so that sweep is forced to
// come out single-valued whatever the confirmation logic does.
//
// This sweep moves the *issue* time instead, across the band immediately past the point
// where the document goes network-idle -- which is where a check that samples the
// in-flight count at one instant stops covering anything. Review A-1 measured the shipped
// code producing {"4":14,"29":6} over exactly this band while reporting `stable: true`
// every time; that is the original 36/11/11 defect, one quiet window later.
// ---------------------------------------------------------------------------

test('harvest of an XHR-hydrated page is identical across 20 runs with the request issue time swept past network-idle', async ({ page }) => {
  test.setTimeout(240_000);

  let defer = 900;
  await page.route('**/*', spaRoute(() => defer, () => 600));

  const counts: number[] = [];
  const reported: string[] = [];
  for (let i = 0; i < 20; i++) {
    defer = 900 + i * 20; // 900..1280ms after domcontentloaded
    await page.goto('https://spa.test/', { waitUntil: 'domcontentloaded' });
    const result = await settle(page);
    reported.push(`${result.stable}/${result.reason}`);
    counts.push((await harvest(page, 'data-testid')).length);
  }

  const distribution: Record<string, number> = {};
  for (const c of counts) distribution[c] = (distribution[c] ?? 0) + 1;
  console.log(`SETTLE ISSUE-TIME DISTRIBUTION (20 runs, issued 900..1280ms after DCL): ${JSON.stringify(distribution)}`);
  console.log(`SETTLE ISSUE-TIME SEQUENCE: ${JSON.stringify(counts)}`);
  console.log(`SETTLE ISSUE-TIME REPORTED: ${JSON.stringify([...new Set(reported)])}`);

  expect(new Set(counts).size).toBe(1);
});

// ---------------------------------------------------------------------------
// The residual boundary, pinned.
//
// `settle`'s guarantee is bounded and the bound is a number: content is waited for if its
// request is issued within `quietMs * MIN_QUIET_WINDOWS` (1000ms by default) of the page
// going network-idle. There is no latch available and no wait that covers everything, so
// the honest thing is to state where the edge is and make it fail loudly if anyone moves
// it inward. 1250ms is a quarter-window inside the edge and a quarter-window outside a
// single-window design, so this test distinguishes the two without sitting on the cliff.
// ---------------------------------------------------------------------------

test('content requested 1250ms after domcontentloaded is still waited for', async ({ page }) => {
  await page.route('**/*', spaRoute(() => 1250, () => 400));
  await page.goto('https://spa.test/', { waitUntil: 'domcontentloaded' });

  const result = await settle(page);

  expect(itemCount(await harvest(page, 'data-testid'))).toBe(25);
  expect(result.stable).toBe(true);
});

// ---------------------------------------------------------------------------
// R2 -- the total budget is a bound for ANY argument pair a caller can pass, not just
// the ones the repo happens to use. A page that neither reaches network-idle (a request
// the route never answers) nor goes DOM-quiet forces both phases to spend their full
// share, so the wall clock here is the bound actually being enforced.
// ---------------------------------------------------------------------------

function stuckAndNoisy() {
  return async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    // Never fulfilled and never aborted, so the network can never go idle.
    if (path === '/stream') return new Promise<void>(() => {});
    return route.fulfill({
      contentType: 'text/html',
      body: `<!DOCTYPE html><html><body><main><h1>Noisy</h1><div id="a"></div></main><script>
        fetch('/stream');
        setInterval(function(){document.getElementById('a').textContent=String(Math.random());}, 20);
      </script></body></html>`,
    });
  };
}

for (const [quietMs, budgetMs] of [[500, 8000], [500, 1500], [2000, 1000], [5000, 3000]] as const) {
  test(`settle stays inside a ${budgetMs}ms budget with quietMs=${quietMs}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.route('**/*', stuckAndNoisy());
    await page.goto('https://stuck.test/', { waitUntil: 'domcontentloaded' });

    const start = Date.now();
    const result = await settle(page, quietMs, budgetMs);
    const wall = Date.now() - start;

    // The bound is the property under test, so it is asserted before anything about the
    // shape of the result: a RED that dies on an earlier line proves nothing about this.
    expect(wall).toBeLessThan(budgetMs + 400);
    expect(result.elapsedMs).toBeLessThan(budgetMs + 400);
    expect(result.stable).toBe(false);
  });
}

// ---------------------------------------------------------------------------
// R2 again -- the wait for `domcontentloaded` is inside the budget too. A
// parser-blocking script that is never served holds DCL open, and `waitUntil: 'commit'`
// hands back a page that has committed but not reached DCL: a state the crawl's own
// `goto` never leaves behind, but one a caller can.
// ---------------------------------------------------------------------------

test('settle bounds its wait for domcontentloaded rather than running on the context default', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/blocking.js') return new Promise<void>(() => {});
    return route.fulfill({
      contentType: 'text/html',
      body: '<!DOCTYPE html><html><head><script src="/blocking.js"></script></head>'
        + '<body><main><h1>Never parsed</h1></main></body></html>',
    });
  });
  await page.goto('https://blocked.test/', { waitUntil: 'commit' });

  const start = Date.now();
  const result = await settle(page, 300, 1000);
  const wall = Date.now() - start;

  expect(wall).toBeLessThan(2000);
  expect(result.reason).toBe('budget');
  expect(result.stable).toBe(false);
});
