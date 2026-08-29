// SPDX-License-Identifier: Apache-2.0

import type { Page } from '@playwright/test';

/**
 * Why `settle` stopped waiting.
 *
 * - `quiet`    -- the DOM was observed unchanged for a full quiet window with no request
 *                 outstanding. This is the only stable outcome.
 * - `network`  -- the page never went network-idle inside its share of the budget, or it
 *                 still had a request in flight after every confirmation round. Content
 *                 may still have been arriving when we stopped looking.
 * - `mutation` -- the DOM never stopped changing (a carousel, a ticker, a poller, or a
 *                 CSS animation churning a class attribute). The page was sampled at an
 *                 arbitrary point in a mutation stream.
 * - `budget`   -- the total wall-clock budget ran out between phases, or the in-page
 *                 promise failed to settle and the Node-side guard fired instead.
 * - `error`    -- the check itself could not be run: the page navigated or went away
 *                 mid-evaluate. Unverifiable for a third reason, and reported as such
 *                 rather than being mistaken for stability.
 */
export type SettleReason = 'quiet' | 'network' | 'mutation' | 'budget' | 'error';

export interface SettleResult {
  /** True only for `reason === 'quiet'`. */
  stable: boolean;
  reason: SettleReason;
  elapsedMs: number;
}

// How many times a quiet DOM with a request still outstanding is re-checked before the
// page is called unstable. Each extra round costs one quiet window and only happens when
// a request is genuinely in flight, so the common case never pays for it. Three is enough
// for the shape that motivates it -- a deferred fetch, then the render it triggers -- and
// bounds the cost on a page that emits an endless drip of requests.
const MAX_ROUNDS = 3;

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
async function quietWindow(
  page: Page,
  quietMs: number,
  allowanceMs: number,
): Promise<'quiet' | 'cap' | 'abandoned' | 'error'> {
  const capMs = Math.max(1, allowanceMs - GUARD_SLACK_MS);
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<'abandoned'>((resolve) => {
    guardTimer = setTimeout(() => resolve('abandoned'), Math.max(1, allowanceMs));
  });

  const observed = page
    .evaluate(
      ([quiet, cap]) =>
        new Promise<'quiet' | 'cap'>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          let hardStop: ReturnType<typeof setTimeout>;
          let observer: MutationObserver;
          const finish = (why: 'quiet' | 'cap') => {
            observer.disconnect();
            // The cap path used to clear only `hardStop`, leaving the quiet timer armed
            // in the page for the rest of the document's life.
            clearTimeout(timer);
            clearTimeout(hardStop);
            resolve(why);
          };
          observer = new MutationObserver(() => {
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
    .catch((): 'error' => 'error');

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
 *   2. The DOM is then unchanged for `quietMs`, with nothing outstanding at the end of
 *      that window. The second half matters because idle is not a latch: a page can fire
 *      a deferred fetch *after* going idle, and a quiet window that ends with a request
 *      still in flight has proved nothing. Those rounds repeat up to `MAX_ROUNDS`.
 *
 * `load` is deliberately not waited for separately. Playwright's lifecycle order is
 * `domcontentloaded` -> `load` -> `networkidle`, so a successful `networkidle` wait has
 * already awaited `load`, and an unsuccessful one would have consumed the same budget
 * either way.
 *
 * The result is returned rather than swallowed: a page sampled mid-flight must not be
 * recorded as if it had genuinely stabilised (R3).
 *
 * @param quietMs   The DOM must be unchanged for this long.
 * @param budgetMs  Total wall-clock bound for the whole call, enforced Node-side.
 */
export async function settle(page: Page, quietMs = 500, budgetMs = 8000): Promise<SettleResult> {
  const start = Date.now();
  const remaining = () => budgetMs - (Date.now() - start);
  const done = (reason: SettleReason): SettleResult =>
    ({ stable: reason === 'quiet', reason, elapsedMs: Date.now() - start });

  // Playwright's own network bookkeeping is not readable, so requests are counted here.
  // Anything already in flight when `settle` is entered is invisible to this counter and
  // can drive it negative as it completes, hence the clamp -- but the count is only ever
  // read after `networkidle`, by which point every earlier request has finished and the
  // counter and reality agree.
  let inFlight = 0;
  const opened = () => { inFlight += 1; };
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

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const left = remaining();
      if (left <= 0) return done('budget');

      const outcome = await quietWindow(page, quietMs, left);
      if (outcome === 'error') return done('error');
      if (outcome === 'abandoned') return done('budget');
      if (outcome === 'cap') return done('mutation');

      // The DOM has held still. Whether that means anything depends on the network:
      // if idle was never reached, or a request is outstanding right now, the page may
      // simply not have received its content yet.
      if (!networkIdle) return done('network');
      if (inFlight === 0) return done('quiet');
    }
    return done('network');
  } finally {
    page.off('request', opened);
    page.off('requestfinished', closed);
    page.off('requestfailed', closed);
  }
}
