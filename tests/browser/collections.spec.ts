import { expect, test } from '@playwright/test';
import { harvest } from '../../src/harvest/harvest.js';
import { resolveElements } from '../../src/resolve/resolve.js';

test('a product grid becomes one collection, not twelve unresolved elements', async ({ page }) => {
  const cards = Array.from({ length: 12 }, (_, i) =>
    `<a class="card" data-testid="product-card" href="/p/${i}">Product ${i}</a>`).join('');
  await page.setContent(`<main class="grid">${cards}</main>`);

  const result = await resolveElements(page, await harvest(page, 'data-testid'), '/c');
  expect(result.collections).toHaveLength(1);
  expect(result.collections[0].count).toBe(12);
  expect(result.elements.filter((e) => e.status === 'unresolved')).toHaveLength(0);
});
