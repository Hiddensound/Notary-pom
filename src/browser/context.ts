// SPDX-License-Identifier: Apache-2.0

import type { Browser, BrowserContext } from '@playwright/test';
import type { PomBuilderConfig } from '../types.js';

export async function createContext(browser: Browser, config: PomBuilderConfig): Promise<BrowserContext> {
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
