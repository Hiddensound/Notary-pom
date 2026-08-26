// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';
import type { ElementRecord } from '../types.js';
import { harvestInPage } from './script.js';

export async function harvest(page: Page, testIdAttribute: string): Promise<ElementRecord[]> {
  return page.evaluate(harvestInPage, testIdAttribute);
}
