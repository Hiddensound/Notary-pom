// SPDX-License-Identifier: Apache-2.0

import { selectors } from 'playwright';
import type { Browser, BrowserContext } from '@playwright/test';
import type { PomBuilderConfig } from '../types.js';

export async function createContext(browser: Browser, config: PomBuilderConfig): Promise<BrowserContext> {
  // `harvestInPage` reads `config.testIdAttribute` directly, but `bindCandidate` and
  // `renderCandidate` both call `getByTestId`, which resolves against a *process-global*
  // attribute name that defaults to `data-testid`. Left unset, a configured
  // `testIdAttribute: 'data-qa'` means the testId strategy silently never fires -- and
  // worse, a `data-qa="save"` button whose page also holds a `data-testid="save"` anchor
  // binds the anchor at match count 1. This is the config -> browser boundary every crawl
  // passes through, so it is where harvest and bind are made to agree.
  //
  // `selectors` here is the same object `@playwright/test` exports (verified by identity);
  // it is imported from `playwright` because that is this package's runtime dependency,
  // whereas `@playwright/test` is a devDependency and appears in `src/` only as types.
  selectors.setTestIdAttribute(config.testIdAttribute);

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
