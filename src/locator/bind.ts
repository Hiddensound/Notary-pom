// SPDX-License-Identifier: Apache-2.0

import type { Locator, Page } from '@playwright/test';
import type { ScopedCandidate } from '../types.js';

export function bindCandidate(page: Page, sc: ScopedCandidate): Locator {
  const root: Page | Locator = sc.scope ? page.getByRole(sc.scope) : page;
  const c = sc.candidate;
  switch (c.strategy) {
    case 'testId': return root.getByTestId(c.value);
    case 'role': return root.getByRole(c.role as never, { name: c.name, exact: c.exact });
    case 'label': return root.getByLabel(c.value, { exact: c.exact });
    case 'placeholder': return root.getByPlaceholder(c.value);
    case 'altText': return root.getByAltText(c.value);
    case 'title': return root.getByTitle(c.value);
    case 'text': return root.getByText(c.value, { exact: c.exact });
    case 'css': return root.locator(c.value);
  }
}
