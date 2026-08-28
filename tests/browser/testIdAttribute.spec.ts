import { expect, test } from '@playwright/test';
import { selectors } from 'playwright';
import { createContext } from '../../src/browser/context.js';
import { harvest } from '../../src/harvest/harvest.js';
import { resolveElements } from '../../src/resolve/resolve.js';
import { bindCandidate } from '../../src/locator/bind.js';
import { withDefaults } from '../../src/config.js';

// `selectors.setTestIdAttribute` is process-global state shared by every Playwright
// worker in this process. Restoring the default after each test keeps a failure here
// from silently poisoning any sibling spec that runs later in the same worker.
test.afterEach(() => {
  selectors.setTestIdAttribute('data-testid');
});

test('createContext teaches Playwright the configured test-id attribute', async ({ browser }) => {
  const config = withDefaults({ seed: 'https://s.test', testIdAttribute: 'data-qa' });
  const context = await createContext(browser, config);
  try {
    const page = await context.newPage();
    await page.setContent('<main><button data-qa="cta">Buy</button></main>');
    await expect(page.getByTestId('cta')).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test('a configured test-id attribute does not bind the default attribute on another element', async ({ browser }) => {
  const config = withDefaults({ seed: 'https://s.test', testIdAttribute: 'data-qa' });
  const context = await createContext(browser, config);
  try {
    const page = await context.newPage();
    await page.setContent(
      '<main><button data-qa="save">Save</button><a data-testid="save" href="/x">Elsewhere</a></main>');
    const { elements } = await resolveElements(page, await harvest(page, config.testIdAttribute), '/p');
    const button = elements.find((e) => e.observed.tag === 'button')!;
    expect(button.status).toBe('resolved');
    expect(button.locator!.candidate).toEqual({ strategy: 'testId', value: 'save' });
    const tag = await bindCandidate(page, button.locator!).first().evaluate((n) => n.tagName);
    expect(tag).toBe('BUTTON');
  } finally {
    await context.close();
  }
});

test('the default attribute is restored for callers that never configured one', async ({ browser }) => {
  const context = await createContext(browser, withDefaults({ seed: 'https://s.test' }));
  try {
    const page = await context.newPage();
    await page.setContent('<main><button data-testid="cta">Buy</button></main>');
    await expect(page.getByTestId('cta')).toHaveCount(1);
  } finally {
    await context.close();
  }
});
