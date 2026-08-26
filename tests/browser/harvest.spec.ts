import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { harvest } from '../../src/harvest/harvest.js';

const html = readFileSync('tests/fixtures/storefront.html', 'utf8');

test.beforeEach(async ({ page }) => { await page.setContent(html); });

test('captures interactive elements with roles and accessible names', async ({ page }) => {
  const records = await harvest(page, 'data-testid');
  const addToCart = records.find((r) => r.testId === 'add-to-cart');
  expect(addToCart).toBeDefined();
  expect(addToCart!.role).toBe('button');
  expect(addToCart!.accessibleName).toBe('Add to cart');
  expect(addToCart!.kind).toBe('interactive');
  expect(addToCart!.landmark).toBe('main');
});

test('derives accessible name from aria-label when there is no text', async ({ page }) => {
  const records = await harvest(page, 'data-testid');
  expect(records.find((r) => r.ariaLabel === 'Share this product')!.accessibleName)
    .toBe('Share this product');
});

test('associates a label element with its control', async ({ page }) => {
  const records = await harvest(page, 'data-testid');
  expect(records.find((r) => r.domId === 'qty')!.labelText).toBe('Quantity');
});

test('captures headings', async ({ page }) => {
  const records = await harvest(page, 'data-testid');
  const h = records.find((r) => r.kind === 'heading');
  expect(h!.role).toBe('heading');
  expect(h!.text).toBe('Red Mug');
});

test('captures text only when it has a stable handle', async ({ page }) => {
  const records = await harvest(page, 'data-testid');
  const texts = records.filter((r) => r.kind === 'text');
  expect(texts.map((r) => r.testId ?? r.role).sort()).toEqual(['product-price', 'status']);
  expect(texts.some((r) => r.text?.includes('Unlabelled prose'))).toBe(false);
});

test('records the landmark ancestor', async ({ page }) => {
  const records = await harvest(page, 'data-testid');
  expect(records.find((r) => r.testId === 'cart-link')!.landmark).toBe('navigation');
  expect(records.find((r) => r.text === 'Privacy')!.landmark).toBe('contentinfo');
});

test('returns records in DOM order for deterministic numbering', async ({ page }) => {
  const records = await harvest(page, 'data-testid');
  const i = (t: string) => records.findIndex((r) => r.text === t || r.testId === t);
  expect(i('Home')).toBeLessThan(i('add-to-cart'));
});

test('skips hidden elements', async ({ page }) => {
  await page.setContent('<button style="display:none">Ghost</button><button>Real</button>');
  const records = await harvest(page, 'data-testid');
  expect(records.map((r) => r.text)).toEqual(['Real']);
});
