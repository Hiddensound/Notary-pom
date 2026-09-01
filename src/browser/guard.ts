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

// A same-origin URL can still 302 to a consent screen, an interstitial, or a geo-gate
// hosted on someone else's domain. That landing does not look like a login page, so
// `LoginRedirectError` never fires for it -- but it is just as much "not the site under
// test" and just as dangerous to harvest under the requested route's own name.
export class OffOriginError extends Error {
  constructor(expectedOrigin: string, actualUrl: string) {
    super(
      `Crawl aborted: landed on ${actualUrl}, which is not on ${expectedOrigin}, the site under ` +
      `test. This route may redirect through a consent screen, interstitial, or geo-gate. ` +
      `Continuing would generate a page object that is secretly a page from a different site.`,
    );
    this.name = 'OffOriginError';
  }
}

// Identifier-first and passwordless identity providers (Okta, Azure AD, Google
// Workspace, magic-link flows) present no password field on the first screen, so the
// password-field heuristic alone has nothing to fire on for them. This widens the guard
// to also match an identifier field (username/email) paired with a submit control, when
// no password field was found. It is the same false-positive/false-negative cost
// tradeoff this project has already accepted for the password heuristic -- see the
// Wave 9 ledger note on this function -- so the selector list stops here rather than
// growing to chase every remaining shape.
export async function looksLikeLogin(page: Page, config: PomBuilderConfig): Promise<boolean> {
  if (config.loginUrlPattern && page.url().includes(config.loginUrlPattern)) return true;
  const passwordFields = await page.locator('input[type="password"]').count();
  if (passwordFields > 0) return true;

  const identifierFields = await page.locator(
    'input[type="email"], input[autocomplete="username"], input[autocomplete="email"]',
  ).count();
  if (identifierFields === 0) return false;

  const submitControls = await page.locator('button[type="submit"], input[type="submit"]').count();
  return submitControls > 0;
}
