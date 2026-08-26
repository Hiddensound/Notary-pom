// SPDX-License-Identifier: Apache-2.0

import type { Page } from '@playwright/test';
import type { PomBuilderConfig } from '../types.js';

export class LoginRedirectError extends Error {
  constructor(url: string) {
    super(
      `Crawl aborted: landed on what looks like a login page (${url}). ` +
      `The session has probably expired. Refresh your storageState and re-run. ` +
      `Continuing would generate page objects that are all secretly LoginPage.`,
    );
    this.name = 'LoginRedirectError';
  }
}

export async function looksLikeLogin(page: Page, config: PomBuilderConfig): Promise<boolean> {
  if (config.loginUrlPattern && page.url().includes(config.loginUrlPattern)) return true;
  const passwordFields = await page.locator('input[type="password"]').count();
  return passwordFields > 0;
}
