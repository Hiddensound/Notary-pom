import { expect, test } from '@playwright/test';
import { harvest } from '../../src/harvest/harvest.js';
import { resolveElements } from '../../src/resolve/resolve.js';

test('prefers testId and records the winning strategy', async ({ page }) => {
  await page.setContent('<main><button data-testid="cta">Buy</button></main>');
  const ir = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  expect(ir).toHaveLength(1);
  expect(ir[0].status).toBe('resolved');
  expect(ir[0].locator!.candidate.strategy).toBe('testId');
});

test('falls back to role when there is no testId', async ({ page }) => {
  await page.setContent('<main><button>Buy now</button></main>');
  const ir = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  expect(ir[0].locator!.candidate.strategy).toBe('role');
});

test('re-scopes to the landmark when a candidate is ambiguous', async ({ page }) => {
  await page.setContent(`
    <nav><a href="/cart">Cart</a></nav>
    <footer><a href="/cart">Cart</a></footer>`);
  const ir = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  const scopes = ir.map((e) => e.locator?.scope).sort();
  expect(scopes).toEqual(['contentinfo', 'navigation']);
  expect(ir.every((e) => e.status === 'resolved')).toBe(true);
});

test('marks an element unresolved rather than guessing', async ({ page }) => {
  await page.setContent('<main><button>Go</button><button>Go</button></main>');
  const ir = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
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
  const ir = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  expect(new Set(ir.map((e) => e.name)).size).toBe(ir.length);
});

test('is deterministic across two runs', async ({ page }) => {
  const html = '<main><button data-testid="a">A</button><h1>Title</h1></main>';
  await page.setContent(html);
  const first = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  await page.setContent(html);
  const second = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

// Two buttons with identical text, in the same landmark, with no testId or dom id, share
// route/kind/role/landmark and identity-fallback (accessibleName here), so they
// fingerprint identically -- exactly the duplicated-page-furniture case (top/bottom
// pagination) that silently collapsed two elements onto one id before this fix.
test('elements colliding on fingerprint get distinct ids, first bare and second suffixed', async ({ page }) => {
  await page.setContent('<main><button>Go</button><button>Go</button></main>');
  const ir = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  expect(ir).toHaveLength(2);
  expect(ir[0].id).toMatch(/^el_[0-9a-f]{12}$/);
  expect(ir[1].id).toBe(`${ir[0].id}_2`);
  expect(ir[0].id).not.toBe(ir[1].id);
});

test('a page with no colliding elements keeps bare, unsuffixed ids', async ({ page }) => {
  await page.setContent(`
    <main><button data-testid="a">Buy</button><h1>Title</h1></main>`);
  const ir = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  for (const e of ir) expect(e.id).toMatch(/^el_[0-9a-f]{12}$/);
});

// Two structurally-identical, unlabelled buttons: no testId, no accessible name (empty
// content, no aria-label/alt/title), so `buildCandidates` has nothing to offer but the
// css fallback -- and both buttons share the same parent, so the css value (bare tag
// under the parent's path, no nth-child on the target itself) matches both and is
// ambiguous. This is the one candidate the landmark retry can never rescue (its value is
// an absolute path rooted at `body`, which is never a descendant of the landmark), so it
// must not be retried: each element's `rejected` should carry exactly one entry, not two.
test('a css-strategy ambiguity inside a landmark is not retried', async ({ page }) => {
  await page.setContent(
    '<nav><button style="width:20px;height:20px"></button>'
    + '<button style="width:20px;height:20px"></button></nav>',
  );
  const ir = (await resolveElements(page, await harvest(page, 'data-testid'), '/p')).elements;
  expect(ir).toHaveLength(2);
  for (const e of ir) {
    expect(e.status).toBe('unresolved');
    expect(e.rejected).toHaveLength(1);
    expect(e.rejected[0].reason).toBe('ambiguous');
    expect(e.rejected[0].scoped.candidate.strategy).toBe('css');
    expect(e.rejected[0].scoped.scope).toBeNull();
  }
});
