import { expect, test } from '@playwright/test';
import { selectors } from 'playwright';
import type { Locator, Page } from '@playwright/test';
import { createContext } from '../../src/browser/context.js';
import { harvest } from '../../src/harvest/harvest.js';
import { resolveElements } from '../../src/resolve/resolve.js';
import { bindCandidate } from '../../src/locator/bind.js';
import { renderCandidate } from '../../src/locator/render.js';
import { withDefaults } from '../../src/config.js';

// `selectors.setTestIdAttribute` is process-global state shared by every Playwright
// worker in this process. POMBuilder itself no longer touches it -- that is half of what
// this file exists to prove -- but several tests below set it deliberately, to stand in
// for a *consumer* project's own Playwright config. Restoring the default after each one
// keeps a failure here from poisoning a sibling spec in the same worker.
test.afterEach(() => {
  selectors.setTestIdAttribute('data-testid');
});

// The emitted getter body is a TypeScript expression rooted at `this.page`. Evaluating it
// as JavaScript against a real page is the only honest test of what a consumer project
// runs: it exercises both escaping layers at once -- the CSS attribute selector, and the
// TypeScript string literal that selector is embedded in -- instead of trusting the text.
function evaluateRendered(page: Page, source: string): Locator {
  const prefix = 'this.page.';
  expect(source.startsWith(prefix), `rendered source: ${source}`).toBe(true);
  return new Function('page', `return page.${source.slice(prefix.length)};`)(page) as Locator;
}

async function isSameNodeAs(locator: Locator, expected: Awaited<ReturnType<Page['$']>>): Promise<boolean> {
  const actual = await locator.first().elementHandle();
  if (!actual || !expected) return false;
  try {
    return await expected.evaluate((node, other) => node === other, actual);
  } finally {
    await actual.dispose();
  }
}

const SAVE_FIXTURE =
  '<main><button data-qa="save">Save</button><a data-testid="save" href="/x">Elsewhere</a></main>';

test('the emitted locator binds the observed node whatever the consumer project configured', async ({ browser }) => {
  const config = withDefaults({ seed: 'https://s.test', testIdAttribute: 'data-qa' });
  const context = await createContext(browser, config);
  try {
    const page = await context.newPage();
    await page.setContent(SAVE_FIXTURE);
    const records = await harvest(page, config.testIdAttribute);
    const { elements } = await resolveElements(page, records, '/p', config.testIdAttribute);
    const button = elements.find((e) => e.observed.tag === 'button')!;
    expect(button.status).toBe('resolved');
    expect(button.locator!.candidate.strategy).toBe('testId');

    const observed = await page.$(button.observed.domPath);

    // Two consumer projects: one on Playwright's default, one that configured something
    // else entirely. Neither knows POMBuilder used `data-qa`. The emitted source is the
    // only thing that ships, so it has to bind the observed <button> in both.
    for (const consumerAttribute of ['data-testid', 'data-cy']) {
      selectors.setTestIdAttribute(consumerAttribute);
      const rendered = evaluateRendered(page, renderCandidate(button.locator!));
      expect(await rendered.count(), consumerAttribute).toBe(1);
      expect(await isSameNodeAs(rendered, observed), consumerAttribute).toBe(true);
    }
    await observed?.dispose();
  } finally {
    await context.close();
  }
});

test('creating a context leaves the process-wide test-id attribute alone', async ({ browser }) => {
  const context = await createContext(
    browser, withDefaults({ seed: 'https://s.test', testIdAttribute: 'data-qa' }));
  try {
    const page = await context.newPage();
    await page.setContent('<main><button data-testid="cta">Buy</button><i data-qa="cta">x</i></main>');
    // `getByTestId` still means `data-testid` here, because nothing POMBuilder did
    // redefined it. A crawl configured for `data-qa` must not reach out and change what
    // `getByTestId` means for every other context in the process.
    expect(await page.getByTestId('cta').count()).toBe(1);
    expect(await page.getByTestId('cta').evaluate((n) => n.tagName)).toBe('BUTTON');
  } finally {
    await context.close();
  }
});

test('two contexts with different test-id attributes do not clobber each other', async ({ browser }) => {
  const first = await createContext(
    browser, withDefaults({ seed: 'https://a.test', testIdAttribute: 'data-qa' }));
  const second = await createContext(
    browser, withDefaults({ seed: 'https://b.test', testIdAttribute: 'data-tid' }));
  try {
    const pageA = await first.newPage();
    await pageA.setContent('<main><button data-qa="x">A</button><span data-tid="x">decoy</span></main>');
    const pageB = await second.newPage();
    await pageB.setContent('<main><span data-qa="x">decoy</span><button data-tid="x">B</button></main>');

    // The first context is resolved *after* the second one exists: that ordering is what
    // used to silently repoint context A's `getByTestId` at context B's attribute.
    for (const [page, attribute] of [[pageA, 'data-qa'], [pageB, 'data-tid']] as const) {
      const { elements } = await resolveElements(
        page, await harvest(page, attribute), '/p', attribute);
      const button = elements.find((e) => e.observed.tag === 'button')!;
      expect(button.status, attribute).toBe('resolved');
      expect(button.locator!.candidate, attribute).toMatchObject({ strategy: 'testId', value: 'x' });
      const bound = bindCandidate(page, button.locator!);
      expect(await bound.count(), attribute).toBe(1);
      expect(await bound.first().evaluate((n) => n.tagName), attribute).toBe('BUTTON');
    }
  } finally {
    await first.close();
    await second.close();
  }
});

// Two escaping layers stacked: the attribute value goes into a CSS attribute selector,
// and that selector goes into a single-quoted TypeScript string literal. Anything that
// survives `getAttribute` has to survive both, so the corpus is deliberately hostile.
const ADVERSARIAL = [
  "single'quote",
  'double"quote',
  'back\\slash',
  'bracket]close',
  'new\nline',
  'carriage\rreturn',
  'line\u2028separator',
  'para\u2029separator',
  'dollar$sign',
  'back`tick',
  'template${value}',
  'emoji \u{1F600} here',
  'selector[data-testid="save"]',
  'space separated',
  'tab\there',
  'control\u0001char',
  'everything \'"\\]$`${x}\u2028\n\t\u0001 at once',
];

test('an adversarial test-id value binds the same node bound, rendered and re-evaluated', async ({ browser }) => {
  const config = withDefaults({ seed: 'https://s.test', testIdAttribute: 'data-qa' });
  const context = await createContext(browser, config);
  try {
    const page = await context.newPage();
    for (const value of ADVERSARIAL) {
      const label = JSON.stringify(value);
      await page.setContent('<main></main>');
      await page.evaluate((v) => {
        const main = document.querySelector('main')!;
        const button = document.createElement('button');
        button.setAttribute('data-qa', v);
        button.textContent = 'Save';
        const decoy = document.createElement('a');
        decoy.setAttribute('data-testid', v);
        decoy.setAttribute('href', '/x');
        decoy.textContent = 'Elsewhere';
        main.append(button, decoy);
      }, value);

      const records = await harvest(page, config.testIdAttribute);
      const { elements } = await resolveElements(page, records, '/p', config.testIdAttribute);
      const button = elements.find((e) => e.observed.tag === 'button')!;
      expect(button.status, label).toBe('resolved');
      expect(button.locator!.candidate, label).toMatchObject({ strategy: 'testId', value });

      const bound = bindCandidate(page, button.locator!);
      expect(await bound.count(), label).toBe(1);
      expect(await bound.first().evaluate((n) => n.tagName), label).toBe('BUTTON');
      const boundHandle = await bound.first().elementHandle();

      // Evaluate the emitted source as a consumer project would: with the process-wide
      // test-id attribute at something POMBuilder never saw. The rendered locator has to
      // bind the very node `bindCandidate` just verified, not merely something.
      selectors.setTestIdAttribute('data-consumer');
      try {
        const rendered = evaluateRendered(page, renderCandidate(button.locator!));
        expect(await rendered.count(), label).toBe(1);
        expect(await isSameNodeAs(rendered, boundHandle), label).toBe(true);
      } finally {
        selectors.setTestIdAttribute('data-testid');
        await boundHandle?.dispose();
      }
    }
  } finally {
    await context.close();
  }
});

test('the default attribute still emits getByTestId, so existing output is unchanged', async ({ browser }) => {
  const config = withDefaults({ seed: 'https://s.test' });
  const context = await createContext(browser, config);
  try {
    const page = await context.newPage();
    await page.setContent('<main><button data-testid="cta">Buy</button></main>');
    const { elements } = await resolveElements(
      page, await harvest(page, config.testIdAttribute), '/p', config.testIdAttribute);
    const button = elements.find((e) => e.observed.tag === 'button')!;
    expect(button.status).toBe('resolved');
    expect(renderCandidate(button.locator!)).toBe("this.page.getByTestId('cta')");
  } finally {
    await context.close();
  }
});
