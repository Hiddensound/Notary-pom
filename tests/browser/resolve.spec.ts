import { expect, test } from '@playwright/test';
import { harvest } from '../../src/harvest/harvest.js';
import { resolveElements } from '../../src/resolve/resolve.js';

test('prefers testId and records the winning strategy', async ({ page }) => {
  await page.setContent('<main><button data-testid="cta">Buy</button></main>');
  const ir = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  expect(ir).toHaveLength(1);
  expect(ir[0].status).toBe('resolved');
  expect(ir[0].locator!.candidate.strategy).toBe('testId');
});

test('falls back to role when there is no testId', async ({ page }) => {
  await page.setContent('<main><button>Buy now</button></main>');
  const ir = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  expect(ir[0].locator!.candidate.strategy).toBe('role');
});

test('re-scopes to the landmark when a candidate is ambiguous', async ({ page }) => {
  await page.setContent(`
    <nav><a href="/cart">Cart</a></nav>
    <footer><a href="/cart">Cart</a></footer>`);
  const ir = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  const scopes = ir.map((e) => e.locator?.scope).sort();
  expect(scopes).toEqual(['contentinfo', 'navigation']);
  expect(ir.every((e) => e.status === 'resolved')).toBe(true);
});

test('marks an element unresolved rather than guessing', async ({ page }) => {
  await page.setContent('<main><button>Go</button><button>Go</button></main>');
  const ir = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  const unresolved = ir.filter((e) => e.status === 'unresolved');
  expect(unresolved.length).toBeGreaterThan(0);
  expect(unresolved[0].locator).toBeNull();
  expect(unresolved[0].rejected.length).toBeGreaterThan(0);
  expect(unresolved[0].rejected[0].reason).toBe('ambiguous');
});

test('assigns unique names', async ({ page }) => {
  await page.setContent(`
    <nav><button>Search</button></nav>
    <footer><button>Search</button></footer>`);
  const ir = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  expect(new Set(ir.map((e) => e.name)).size).toBe(ir.length);
});

test('is deterministic across two runs', async ({ page }) => {
  const html = '<main><button data-testid="a">A</button><h1>Title</h1></main>';
  await page.setContent(html);
  const first = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  await page.setContent(html);
  const second = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});
