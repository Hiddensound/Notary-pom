// SPDX-License-Identifier: Apache-2.0

import type { Page } from '@playwright/test';

/**
 * Why `settle` stopped waiting.
 *
 * - `quiet`    -- the DOM was observed unchanged, with no request starting and none
 *                 outstanding, across `MIN_QUIET_WINDOWS` consecutive windows. The only
 *                 stable outcome.
 * - `network`  -- the page never went network-idle inside its share of the budget, so
 *                 nothing could establish that its content had finished arriving.
 * - `pending`  -- the page did go idle, but requests kept arriving for as long as we
 *                 watched AND at least one of them changed the DOM, so content was
 *                 demonstrably still being delivered. Requests that never changed
 *                 anything do not produce this: see the note on the confirmation loop.
 * - `mutation` -- the DOM never stopped changing (a carousel, a ticker, a poller, or a
 *                 CSS animation churning a class attribute). The page was sampled at an
 *                 arbitrary point in a mutation stream.
 * - `budget`   -- the total wall-clock budget ran out between phases, or the in-page
 *                 promise failed to settle and the Node-side guard fired instead.
 * - `error`    -- the check itself could not be run: the page navigated or went away
 *                 mid-evaluate. Unverifiable for a third reason, and reported as such
 *                 rather than being mistaken for stability.
 */
export type SettleReason = 'quiet' | 'network' | 'pending' | 'mutation' | 'budget' | 'error';

/** Every reason other than the one stable one. */
export type UnstableReason = Exclude<SettleReason, 'quiet'>;

/**
 * `stable` is the discriminant, not a convenience copy of `reason === 'quiet'`: writing
 * it as a union is what lets `if (!result.stable)` narrow `reason` to `UnstableReason`
 * at the call site, so a reporter that cannot represent a settled page does not have to
 * re-check anything or widen its own type to accept one.
 */
export type SettleResult =
  | { stable: true; reason: 'quiet'; elapsedMs: number }
  | { stable: false; reason: UnstableReason; elapsedMs: number };

// How many consecutive clean windows must be observed before a page is called settled.
//
// This is the number that sets `settle`'s guarantee, and it is a straight trade: each
// window costs `quietMs` of wall clock on every page and buys `quietMs` of coverage past
// the moment the network went idle. Two was chosen on measurement, not preference --
// see the contract note on `settle` below for what it buys and what it does not.
//
// One is not enough, and that is measured rather than argued: with a single window the
// in-flight count is sampled at one instant, and a request issued after that instant is
// never waited for. Sweeping the issue time across the band just past network-idle,
// one window harvests two different DOMs from an unchanged page (14 runs of one, 6 of
// the other) while reporting `stable: true` every time.
const MIN_QUIET_WINDOWS = 2;

// The hard stop on iteration, and the thing that sets the ceiling on what `settle` can
// cost. Each window that sees network activity resets the confirmation count, so a page
// that keeps making requests -- an analytics beacon, a heartbeat, a session ping -- never
// confirms and watches until this runs out. Measured on an 800ms beacon: ~3.6s, against
// ~1.5s for a page that confirms immediately. That tail is the real cost of `settle` on a
// beacon-carrying site, and `settle bounds what a page that re-arms the confirmation every
// window can cost` pins it; the budget remains the outer bound beyond that.
//
// Six is the smallest value the deferred-content shapes actually need: a request issued
// late in the covered band takes one window to start, one or two for the response and the
// render it triggers, then MIN_QUIET_WINDOWS clean ones to confirm.
const MAX_ROUNDS = 6;

// How much of a quiet window's allowance is held back from the in-page cap so the
// Node-side guard can fire *after* it rather than racing it. Without the gap a wedged
// renderer would be indistinguishable from a busy one; with it, the guard is strictly the
// backstop and the whole window still fits inside the allowance it was given.
const GUARD_SLACK_MS = 250;

/**
 * Wait for one window of `quietMs` with no DOM mutation, within a total allowance of
 * `allowanceMs`.
 *
 * The in-page cap is duplicated by a Node-side guard: if the in-page promise never
 * settles at all -- a wedged renderer, a page that swaps its own timers out -- the caller
 * must still get an answer inside its budget rather than hanging to the 15s context
 * default (R2). Both fit inside `allowanceMs`, so this function never overruns what it
 * was given.
 */
interface QuietWindow {
  outcome: 'quiet' | 'cap' | 'abandoned' | 'error';
  /**
   * Whether the DOM actually changed while this window was open.
   *
   * This is the observable property that separates two states the caller would otherwise
   * have to guess between: requests that are delivering content, and requests that are
   * not. It is what lets a page whose beacons fire forever without touching the DOM be
   * called settled, and a `cap` on a page that never mutated be called what it is -- a
   * budget that ran out -- rather than a mutation stream that does not exist.
   */
  changed: boolean;
}

async function quietWindow(
  page: Page,
  quietMs: number,
  allowanceMs: number,
): Promise<QuietWindow> {
  const capMs = Math.max(1, allowanceMs - GUARD_SLACK_MS);
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<QuietWindow>((resolve) => {
    // A guard that fires knows nothing about what the DOM did -- the in-page promise
    // never came back to say -- so it reports no change rather than inventing one.
    guardTimer = setTimeout(() => resolve({ outcome: 'abandoned', changed: false }), Math.max(1, allowanceMs));
  });

  const observed = page
    .evaluate(
      ([quiet, cap]) =>
        new Promise<{ outcome: 'quiet' | 'cap'; changed: boolean }>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          let hardStop: ReturnType<typeof setTimeout>;
          let observer: MutationObserver;
          let changed = false;
          const finish = (outcome: 'quiet' | 'cap') => {
            observer.disconnect();
            // The cap path used to clear only `hardStop`, leaving the quiet timer armed
            // in the page for the rest of the document's life.
            clearTimeout(timer);
            clearTimeout(hardStop);
            resolve({ outcome, changed });
          };
          // The Node side gives up on this promise if it never settles, and the caller
          // then harvests this very document -- so the observer must be able to retire
          // without being told. It cannot rely on its own timers to do that, because a
          // page whose timers still work would have resolved through `finish` already.
          // Checking the clock on each callback costs nothing and disconnects on the next
          // mutation; a document that never mutates again leaves an observer that never
          // runs, which is the harmless half of the problem.
          const deadline = Date.now() + cap;
          observer = new MutationObserver(() => {
            changed = true;
            if (Date.now() > deadline) {
              finish('cap');
              return;
            }
            clearTimeout(timer);
            timer = setTimeout(() => finish('quiet'), quiet);
          });
          hardStop = setTimeout(() => finish('cap'), cap);
          timer = setTimeout(() => finish('quiet'), quiet);
          observer.observe(document, {
            childList: true, subtree: true, attributes: true, characterData: true,
          });
        }),
      [quietMs, capMs] as const,
    )
    .catch((): QuietWindow => ({ outcome: 'error', changed: false }));

  try {
    return await Promise.race([observed, guard]);
  } finally {
    clearTimeout(guardTimer);
  }
}

/**
 * Wait until a page has finished rendering the content it is going to render.
 *
 * A quiet-period detector on its own cannot tell "not started yet" from "finished": an
 * SPA that fetches its content over XHR produces no mutations at all until the response
 * lands, so a quiet timer armed at `domcontentloaded` is a pure wall-clock race against
 * network latency. Three crawls of the same unchanged React site harvested 36, 11 and 11
 * elements.
 *
 * So stability is established in two parts, and both must hold:
 *
 *   1. The network goes idle. The XHR that fetches an SPA's content keeps the network
 *      non-idle until it has completed, which is what closes the race a fixed timer
 *      loses. Playwright discourages `networkidle` for *assertions*; a crawler deciding
 *      when a page is done is the case it fits.
 *   2. `MIN_QUIET_WINDOWS` consecutive windows of `quietMs` then pass in which the DOM
 *      does not change, no request starts, and none is outstanding at the end. Idle is
 *      not a latch -- a page can defer its content fetch until after the document has
 *      already gone idle -- so one window proves nothing on its own.
 *
 * `load` is deliberately not waited for separately. Playwright's lifecycle order is
 * `domcontentloaded` -> `load` -> `networkidle`, so a successful `networkidle` wait has
 * already awaited `load`, and an unsuccessful one would have consumed the same budget
 * either way.
 *
 * ## What this does and does not guarantee
 *
 * **`settle` is deterministic with respect to content whose request is issued within
 * `quietMs * MIN_QUIET_WINDOWS` -- 1000ms with the defaults -- of the moment the page's
 * network last went idle. It is not deterministic beyond that, and it cannot tell that it
 * was not.**
 *
 * That is not a defect to be fixed later; it is what a bounded wait is. Every wait has an
 * edge, and past the edge the page is indistinguishable from one that has finished: no
 * request is in flight, the DOM is not moving, and there is nothing left to observe. So
 * past the edge `settle` returns `stable: true` and the crawl records the page as settled.
 * **No `UnstablePage` is reported for this case, and none can be** -- R3 covers budget
 * exhaustion, which is observable, not late work, which is not.
 *
 * The floor stated above is in terms of network-idle rather than `domcontentloaded`
 * because that is what the code actually measures, and it is the more generous of the
 * two: Playwright's `networkidle` cannot fire less than 500ms after the last request, so
 * the floor is never earlier than DCL + 500ms + 1000ms. On real pages it is considerably
 * later, because the page is busy for a while first. Measured on the reference sites,
 * `networkidle` arrives at DCL + 2.0-2.1s (a React storefront) and DCL + 0.55-0.92s (a
 * server-rendered WooCommerce page) -- the high end of each range on a cold cache, the low
 * end warm -- so the effective edge is roughly DCL + 3.0s and DCL + 1.9s cold, DCL + 2.1s
 * and DCL + 1.55s warm. The guarantee itself is the network-idle-relative one; these are
 * what it works out to in practice, and they are quoted as ranges because a cold first
 * visit and a warm re-visit differ by about a second on the SPA.
 *
 * The result is returned rather than swallowed: a page sampled mid-flight must not be
 * recorded as if it had genuinely stabilised (R3) -- within the limit stated above.
 *
 * @param quietMs   The DOM must be unchanged for this long.
 * @param budgetMs  Total wall-clock bound for the whole call, enforced Node-side.
 */
export async function settle(page: Page, quietMs = 500, budgetMs = 8000): Promise<SettleResult> {
  const start = Date.now();
  const remaining = () => budgetMs - (Date.now() - start);
  const done = (reason: SettleReason): SettleResult =>
    reason === 'quiet'
      ? { stable: true, reason, elapsedMs: Date.now() - start }
      : { stable: false, reason, elapsedMs: Date.now() - start };

  // Playwright's own network bookkeeping is not readable, so requests are counted here.
  // Anything already in flight when `settle` is entered is invisible to this counter and
  // can drive it negative as it completes, hence the clamp -- but the count is only ever
  // read after `networkidle`, by which point every earlier request has finished and the
  // counter and reality agree.
  let inFlight = 0;
  // Monotonic, so a request that both starts and finishes inside one quiet window is
  // still visible at the end of it. `inFlight` alone cannot see that request, and its
  // render can land after we have already returned.
  let started = 0;
  const opened = () => { inFlight += 1; started += 1; };
  const closed = () => { inFlight = Math.max(0, inFlight - 1); };
  page.on('request', opened);
  page.on('requestfinished', closed);
  page.on('requestfailed', closed);

  try {
    // Inside the budget like every other phase. Every caller in this repo `goto`s with
    // `waitUntil: 'domcontentloaded'` first, so in practice this returns immediately --
    // but on a page that has committed without reaching DCL it would otherwise run on the
    // context default (15s) and reject out of `settle` as an outcome `SettleResult`
    // cannot express, which would make the R2 claim below false.
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: Math.max(1, remaining()) });
    } catch {
      return done(remaining() <= 0 ? 'budget' : 'error');
    }

    // The network phase gets at most half the budget, and never more than what is left
    // once the other half is reserved for the mutation phase. Both clamps are on the same
    // quantity, so no combination of `quietMs` and `budgetMs` can hand the network phase
    // more than half -- and a page that never reaches idle (a websocket, a long poll, a
    // periodic beacon) is still harvested at a DOM-quiet instant rather than at whatever
    // moment the budget happened to expire.
    const half = Math.floor(budgetMs / 2);
    const networkMs = Math.min(half, Math.max(0, remaining() - half));
    let networkIdle = false;
    if (networkMs > 0) {
      try {
        await page.waitForLoadState('networkidle', { timeout: networkMs });
        networkIdle = true;
      } catch {
        networkIdle = false;
      }
    }

    // A quiet window runs even when idle was never reached: such a page is going to be
    // harvested regardless, and harvesting it at a DOM-quiet instant beats harvesting it
    // at whatever moment the network phase happened to give up.
    let confirmed = 0;
    let sawChange = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const left = remaining();
      if (left <= 0) return done('budget');

      const startedBefore = started;
      const window = await quietWindow(page, quietMs, left);
      sawChange = sawChange || window.changed;
      if (window.outcome === 'error') return done('error');
      if (window.outcome === 'abandoned') return done('budget');
      // A window that hit its cap because the DOM would not stop changing is a mutation
      // stream. A window that hit its cap on a page that never mutated at all was simply
      // given less time than one quiet window needs, which is a budget, not a carousel.
      if (window.outcome === 'cap') return done(window.changed ? 'mutation' : 'budget');

      // Idle was never reached, so no number of quiet windows can establish that the
      // content finished arriving. Say that, rather than counting windows towards a
      // confirmation that would not mean anything.
      if (!networkIdle) return done('network');

      // A window only counts as confirmation if the network was silent for the whole of
      // it -- nothing started, nothing outstanding at the end. Any activity resets the
      // count, so the windows that confirm are consecutive ones.
      confirmed = (started === startedBefore && inFlight === 0) ? confirmed + 1 : 0;
      if (confirmed >= MIN_QUIET_WINDOWS) return done('quiet');
    }

    // The watch ran out of rounds with requests still arriving. What that means depends on
    // whether any of them ever changed anything: a page that polled for the whole watch
    // without the DOM moving once has demonstrated its requests are not delivering
    // content -- an analytics beacon, a heartbeat, a session ping -- and calling it
    // unstable would be a false alarm on a property uncorrelated with harvest quality,
    // since the identical page without the beacon is called stable and harvests the same.
    // If the DOM did move, the requests were delivering, and `pending` is the truth.
    return done(sawChange ? 'pending' : 'quiet');
  } finally {
    page.off('request', opened);
    page.off('requestfinished', closed);
    page.off('requestfailed', closed);
  }
}
