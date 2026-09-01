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

// ---------------------------------------------------------------------------
// roleOf: same validation defect Wave 2A fixed in landmarkOf/landmarkRoleOf,
// now fixed for the general role too. `data-testid` is on every probe so that
// each element clears harvestInPage's "text needs a stable handle" gate and is
// captured regardless of its role.
// ---------------------------------------------------------------------------

async function roleOfProbe(page: import('@playwright/test').Page, html: string): Promise<string | null> {
  await page.setContent(html);
  const records = await harvest(page, 'data-testid');
  return records.find((r) => r.testId === 'probe')?.role ?? null;
}

test('an explicit role with the wrong case falls back to the implicit role', async ({ page }) => {
  expect(await roleOfProbe(page, '<button role="Button" data-testid="probe">X</button>')).toBe('button');
});

test('an explicit role that names no real ARIA role falls back to the implicit role', async ({ page }) => {
  expect(await roleOfProbe(page, '<button role="bogus-not-a-real-role" data-testid="probe">X</button>'))
    .toBe('button');
});

test('role=presentation without a global aria-* attribute or tabindex is null', async ({ page }) => {
  // <button> without any aria-* attribute or tabindex, per the fix's own documented
  // "known gap" comment above roleOf: real Playwright would still resolve this to
  // `button` (buttons are natively focusable), but this harvester's conflict check
  // deliberately does not model native focusability, only the aria-attribute/tabindex
  // half of the rule. This test pins the implemented (narrower) behavior.
  expect(await roleOfProbe(page, '<button role="presentation" data-testid="probe">X</button>')).toBe(null);
});

test('role=presentation with a global aria-* attribute falls back to the implicit role', async ({ page }) => {
  expect(await roleOfProbe(
    page, '<button role="presentation" aria-label="Confirm" data-testid="probe">X</button>')).toBe('button');
});

test('role=presentation with a tabindex falls back to the implicit role', async ({ page }) => {
  // <img> is not natively focusable, so this isolates the tabindex arm of
  // hasPresentationalConflict from the native-focusability gap the button tests above
  // work around.
  expect(await roleOfProbe(
    page,
    '<img alt="pic" role="presentation" tabindex="0" data-testid="probe" style="width:10px;height:10px" />',
  )).toBe('img');
});

const NEW_IMPLICIT_ROLE_ROWS: Array<[string, string, string]> = [
  ['search', '<search data-testid="probe">X</search>', 'search'],
  ['article', '<article data-testid="probe">X</article>', 'article'],
  ['details', '<details data-testid="probe">X</details>', 'group'],
  ['progress', '<progress value="1" max="10" data-testid="probe"></progress>', 'progressbar'],
  ['meter', '<meter value="1" min="0" max="10" data-testid="probe"></meter>', 'meter'],
  ['output', '<output data-testid="probe">X</output>', 'status'],
];

for (const [tag, html, role] of NEW_IMPLICIT_ROLE_ROWS) {
  test(`<${tag}> has the implicit role ${role}`, async ({ page }) => {
    expect(await roleOfProbe(page, html)).toBe(role);
  });
}

test('<section> is a region only when it has an explicit accessible name', async ({ page }) => {
  expect(await roleOfProbe(page, '<section data-testid="probe">Lots of prose here.</section>')).toBe(null);
  expect(await roleOfProbe(page, '<section aria-label="Reviews" data-testid="probe">X</section>')).toBe('region');
});

test('<form> is a form only when it has an explicit accessible name', async ({ page }) => {
  expect(await roleOfProbe(page, '<form data-testid="probe"><input /></form>')).toBe(null);
  expect(await roleOfProbe(page, '<form aria-label="Sign in" data-testid="probe"><input /></form>'))
    .toBe('form');
});

test('a text input wired to a <datalist> via list is a combobox', async ({ page }) => {
  expect(await roleOfProbe(
    page,
    '<input list="opts" data-testid="probe" /><datalist id="opts"><option value="a"></datalist>',
  )).toBe('combobox');
});

test('a search input without a matching datalist keeps its searchbox role', async ({ page }) => {
  expect(await roleOfProbe(page, '<input type="search" data-testid="probe" />')).toBe('searchbox');
});
