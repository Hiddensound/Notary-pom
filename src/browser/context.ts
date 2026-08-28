// SPDX-License-Identifier: Apache-2.0

import type { Browser, BrowserContext } from '@playwright/test';
import type { PomBuilderConfig } from '../types.js';

export async function createContext(browser: Browser, config: PomBuilderConfig): Promise<BrowserContext> {
  // Deliberately does NOT call `selectors.setTestIdAttribute(config.testIdAttribute)`.
  // That setting is process-global: a second context created with a different config
  // silently repoints the first one's `getByTestId`, and nothing in the crawl notices.
  // It also could not have helped where it mattered -- it configures *this* process, and
  // the generated getters run in the user's project, under the user's own Playwright
  // config. Both are closed at the source instead: `config.testIdAttribute` is threaded
  // into `buildCandidates`, recorded on the candidate, and read back by `bindCandidate`
  // and `renderCandidate`, so nothing here depends on process-wide state.

  // contextOptions carries storageState, extraHTTPHeaders and httpCredentials straight
  // through to Playwright. POMBuilder never performs a login itself.
  const options = { ...config.contextOptions } as Record<string, unknown>;

  // Drop header entries whose env var was unset, so an absent bypass token does not
  // become the literal string "undefined".
  const headers = options.extraHTTPHeaders as Record<string, unknown> | undefined;
  if (headers) {
    options.extraHTTPHeaders = Object.fromEntries(
      Object.entries(headers).filter(([, v]) => typeof v === 'string' && v.length > 0),
    );
  }
  if (!options.storageState) delete options.storageState;

  const context = await browser.newContext(options);
  context.setDefaultTimeout(15_000);
  return context;
}
