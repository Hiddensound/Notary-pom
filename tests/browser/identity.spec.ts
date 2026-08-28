import { expect, test } from '@playwright/test';
import { harvest } from '../../src/harvest/harvest.js';
import { resolveElements } from '../../src/resolve/resolve.js';
import { bindCandidate } from '../../src/locator/bind.js';
import type { IRElement } from '../../src/types.js';

// Assert the property the whole tool rests on: a `resolved` element's locator binds the
// very node the harvester observed, not merely *a* unique node.
async function assertBindsObservedNode(
  page: import('@playwright/test').Page,
  elements: IRElement[],
): Promise<void> {
  for (const e of elements) {
    if (e.status !== 'resolved' || !e.locator) continue;
    const expected = await page.$(e.observed.domPath);
    expect(expected, `no node at domPath for ${e.name}`).not.toBeNull();
    const actual = await bindCandidate(page, e.locator).first().elementHandle();
    expect(actual, `locator for ${e.name} matched nothing`).not.toBeNull();
    const same = await expected!.evaluate((node, other) => node === other, actual);
    expect(same, `${e.name} binds a different node than the one harvested`).toBe(true);
    await expected!.dispose();
    await actual!.dispose();
  }
}

// The harvester's `accessibleName` is a hand-rolled approximation: it reads
// `el.textContent`, which includes text inside a `display:none` descendant. Playwright's
// role engine follows the accname spec and excludes hidden subtrees. So the first button
// below is harvested as "Secret Go" while Playwright names it "Go" -- and the candidate
// built from that name matches exactly one visible element, the *second* button.
// Count-and-visibility verification accepts it; identity verification must not.
const NAME_DIVERGENCE = `<main>
  <button id="one"><span style="display:none">Secret </span>Go</button>
  <button id="two">Secret Go</button>
</main>`;

test('rejects a candidate that uniquely matches a node other than the harvested one', async ({ page }) => {
  await page.setContent(NAME_DIVERGENCE);
  const records = await harvest(page, 'data-testid');
  const { elements } = await resolveElements(page, records, '/p');

  const first = elements.find((e) => e.observed.domPath.endsWith('button:nth-child(1)'))!;
  expect(first).toBeDefined();
  expect(first.status).toBe('unresolved');
  expect(first.locator).toBeNull();
  expect(first.rejected.some((r) => r.reason === 'identity')).toBe(true);
});

test('no two resolved elements bind the same node', async ({ page }) => {
  await page.setContent(NAME_DIVERGENCE);
  const { elements } = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  const resolved = elements.filter((e) => e.status === 'resolved' && e.locator);
  const handles = await Promise.all(
    resolved.map((e) => bindCandidate(page, e.locator!).first().elementHandle()),
  );
  const distinct = await page.evaluate((hs) => new Set(hs).size, handles);
  expect(distinct).toBe(resolved.length);
  await Promise.all(handles.map((h) => h!.dispose()));
});

test('every resolved locator binds the node its record describes', async ({ page }) => {
  await page.setContent(NAME_DIVERGENCE);
  const { elements } = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  await assertBindsObservedNode(page, elements);
});

// A `<footer>` inside `<article>` is not `contentinfo` (Playwright agrees), so the
// harvester must not label the anchor's landmark `contentinfo` and the resolver must not
// re-scope into the *other* footer. This is the deterministic reproduction of the
// shipped `searchForInput1`/`searchForInput2` defect.
test('does not bind a nested-footer element into the real contentinfo landmark', async ({ page }) => {
  await page.setContent(`<main>
    <article><footer><a data-testid="x" href="/one">One</a></footer></article>
  </main>
  <div role="contentinfo"><a data-testid="x" href="/two">Two</a></div>`);
  const { elements } = await resolveElements(page, await harvest(page, 'data-testid'), '/p');
  await assertBindsObservedNode(page, elements);
  const one = elements.find((e) => e.observed.text === 'One')!;
  expect(one.group).not.toBe('contentinfo');
});

test('an element whose domPath cannot be re-found is unresolved, not guessed', async ({ page }) => {
  await page.setContent('<main><button data-testid="cta">Buy</button></main>');
  const records = await harvest(page, 'data-testid');
  // Point the record at a sibling index that does not exist. Only the last segment is
  // changed so the parent path the css fallback candidate is built from stays valid --
  // every candidate then matches exactly one visible node, and every one of them must be
  // rejected purely because the observed node can no longer be found to compare against.
  const doctored = records.map((r) => ({ ...r, domPath: r.domPath.replace(/\(1\)$/, '(9)') }));
  expect(doctored[0].domPath).not.toBe(records[0].domPath);
  const { elements } = await resolveElements(page, doctored, '/p');
  expect(elements[0].status).toBe('unresolved');
  expect(elements[0].rejected.length).toBeGreaterThan(0);
  expect(elements[0].rejected.every((r) => r.reason === 'identity')).toBe(true);
});

test('a domPath that is not a parsable selector fails closed instead of aborting', async ({ page }) => {
  await page.setContent('<main><button data-testid="cta">Buy</button></main>');
  const records = await harvest(page, 'data-testid');
  const doctored = records.map((r) => ({ ...r, domPath: 'body > :::not a selector:::' }));
  const { elements } = await resolveElements(page, doctored, '/p');
  expect(elements[0].status).toBe('unresolved');
  expect(elements[0].rejected.some((r) => r.reason === 'identity')).toBe(true);
});

// The landmark is not decoration: it is the only retry the resolver has for an ambiguous
// candidate. A `<nav>` carrying a role attribute that names no valid ARIA role is still a
// navigation landmark to Playwright, and treating it as none costs a resolvable element
// outright -- the ambiguity is never narrowed and the element is dropped from the
// generated class. This is the recall half of the landmark agreement matrix, measured
// where it is actually paid.
test('an ambiguous element in a landmark with an unrecognised role is still recovered', async ({ page }) => {
  // Two `Cart` links, so the role candidate is ambiguous for both. The nav also holds a
  // sibling link, so the positional css fallback is ambiguous there too -- the landmark
  // re-scope is the only route left to a locator.
  await page.setContent(`<nav role="site-nav"><a href="/shop">Shop</a><a href="/cart">Cart</a></nav>
    <footer><a href="/cart">Cart</a></footer>`);
  const { elements } = await resolveElements(page, await harvest(page, 'data-testid'), '/p', 'data-testid');
  expect(elements).toHaveLength(3);
  expect(elements.filter((e) => e.status === 'resolved')).toHaveLength(3);
  await assertBindsObservedNode(page, elements);

  const carts = elements.filter((e) => e.observed.text === 'Cart');
  expect(carts).toHaveLength(2);
  expect(carts.map((e) => e.locator!.scope).sort()).toEqual(['contentinfo', 'navigation']);
  expect(carts.every((e) => !e.locator!.fragile)).toBe(true);
});

// `page.$(record.domPath)` already fails closed. `count()`, `isVisible()`,
// `elementHandle()` and the in-page identity comparison did not: one throw took down the
// crawl of every remaining element on every remaining page. The blast radius of a
// per-candidate failure has to be that candidate.
test('a candidate Playwright cannot evaluate rejects the candidate, not the crawl', async ({ page }) => {
  await page.setContent(
    '<main><button data-testid="ok">Fine</button><button data-testid="bad">Boom</button></main>');
  const records = await harvest(page, 'data-testid');
  // Strip the poisoned record down to its css fallback, then make that fallback
  // unparsable. Every other record is untouched and must still resolve.
  const doctored = records.map((r) => (r.testId === 'bad'
    ? { ...r, testId: null, accessibleName: null, role: null, text: null, tag: 'button:::[' }
    : r));
  const { elements } = await resolveElements(page, doctored, '/p', 'data-testid');

  const healthy = elements.find((e) => e.observed.testId === 'ok')!;
  expect(healthy.status, 'a sibling failure must not cost a good element').toBe('resolved');

  const poisoned = elements.find((e) => e.observed.tag === 'button:::[')!;
  expect(poisoned.status).toBe('unresolved');
  expect(poisoned.rejected.some((r) => r.reason === 'error')).toBe(true);
});

test('a page that dies mid-resolve leaves elements unresolved instead of aborting', async ({ page }) => {
  await page.setContent('<main><button data-testid="cta">Buy</button></main>');
  const records = await harvest(page, 'data-testid');
  await page.close();
  const { elements } = await resolveElements(page, records, '/p', 'data-testid');
  expect(elements).toHaveLength(1);
  expect(elements[0].status).toBe('unresolved');
  expect(elements[0].rejected.length).toBeGreaterThan(0);
  expect(elements[0].rejected.every((r) => r.reason === 'error')).toBe(true);
});
