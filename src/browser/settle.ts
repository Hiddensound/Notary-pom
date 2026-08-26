// SPDX-License-Identifier: Apache-2.0

import type { Page } from '@playwright/test';

export async function settle(page: Page, quietMs = 500, capMs = 5000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(
    ([quiet, cap]) =>
      new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(finish, quiet);
        });
        const finish = () => {
          observer.disconnect();
          clearTimeout(hardStop);
          resolve();
        };
        const hardStop = setTimeout(finish, cap);
        timer = setTimeout(finish, quiet);
        observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
      }),
    [quietMs, capMs] as const,
  );
}
