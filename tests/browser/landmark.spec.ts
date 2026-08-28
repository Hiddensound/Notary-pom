import { expect, test } from '@playwright/test';
import { harvest } from '../../src/harvest/harvest.js';

// Measured against the installed Playwright (1.62.1) with a throwaway probe: `<header>`
// and `<footer>` carry banner/contentinfo only when they are not inside an
// article/aside/main/nav/section element or an element whose explicit role is
// article/complementary/main/navigation/region. `<aside>`, `<nav>` and `<main>` are
// landmarks unconditionally on this version -- Playwright does not implement the newer
// "nested aside needs an accessible name" rule -- so the harvester must not either.
async function landmarkOfProbe(page: import('@playwright/test').Page, html: string) {
  await page.setContent(html);
  const records = await harvest(page, 'data-testid');
  return records.find((r) => r.testId === 'probe')!.landmark;
}

const NON_LANDMARK_CONTEXTS: Array<[string, string]> = [
  ['article', '<article>{X}</article>'],
  ['section', '<section>{X}</section>'],
  ['aside', '<aside>{X}</aside>'],
  ['nav', '<nav>{X}</nav>'],
  ['main', '<main>{X}</main>'],
  ['role=region', '<div role="region" aria-label="R">{X}</div>'],
  ['role=article', '<div role="article">{X}</div>'],
  ['article > div', '<article><div>{X}</div></article>'],
];

for (const tag of ['header', 'footer'] as const) {
  const role = tag === 'header' ? 'banner' : 'contentinfo';

  test(`<${tag}> at the top level is ${role}`, async ({ page }) => {
    const got = await landmarkOfProbe(page, `<${tag}><button data-testid="probe">P</button></${tag}>`);
    expect(got).toBe(role);
  });

  test(`<${tag}> inside a plain <div> is still ${role}`, async ({ page }) => {
    const got = await landmarkOfProbe(
      page, `<div><${tag}><button data-testid="probe">P</button></${tag}></div>`);
    expect(got).toBe(role);
  });

  for (const [label, wrapper] of NON_LANDMARK_CONTEXTS) {
    test(`<${tag}> inside ${label} is not ${role}`, async ({ page }) => {
      const inner = `<${tag}><button data-testid="probe">P</button></${tag}>`;
      const got = await landmarkOfProbe(page, wrapper.replace('{X}', inner));
      expect(got).not.toBe(role);
    });
  }
}

test('<aside> stays complementary however it is nested, matching Playwright', async ({ page }) => {
  const inner = '<aside><button data-testid="probe">P</button></aside>';
  for (const wrapper of ['<article>{X}</article>', '<section>{X}</section>', '<main>{X}</main>', '{X}']) {
    expect(await landmarkOfProbe(page, wrapper.replace('{X}', inner))).toBe('complementary');
  }
});

test('<nav> and <main> stay landmarks however they are nested', async ({ page }) => {
  expect(await landmarkOfProbe(
    page, '<article><nav><button data-testid="probe">P</button></nav></article>')).toBe('navigation');
  expect(await landmarkOfProbe(
    page, '<section><main><button data-testid="probe">P</button></main></section>')).toBe('main');
});

test('the nearest landmark still wins when a non-landmark footer sits inside one', async ({ page }) => {
  const got = await landmarkOfProbe(
    page, '<nav><article><footer><button data-testid="probe">P</button></footer></article></nav>');
  expect(got).toBe('navigation');
});

test('an explicit role on the footer itself still wins', async ({ page }) => {
  const got = await landmarkOfProbe(
    page, '<article><footer role="contentinfo"><button data-testid="probe">P</button></footer></article>');
  expect(got).toBe('contentinfo');
});

// ---------------------------------------------------------------------------
// Agreement matrix. Rather than hard-coding an expected landmark per case, each
// case below asks the installed Playwright which landmark actually contains the
// probe -- `getByRole(L)` is precisely what the resolver re-scopes with -- and
// requires the harvester to name the same one. Ground truth is the NEAREST
// containing landmark, measured by walking the probe's ancestor chain and asking
// which of them `getByRole(L)` matched. A harvester that names a landmark
// Playwright disagrees with mis-binds; one that names `null` where Playwright
// sees a landmark silently costs a resolvable element.
// ---------------------------------------------------------------------------

const LANDMARKS = ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search'] as const;
const P = '<button data-testid="probe">P</button>';

async function playwrightLandmark(page: import('@playwright/test').Page): Promise<string | null> {
  let nearest: string | null = null;
  let best = Infinity;
  for (const role of LANDMARKS) {
    const depth = await page.getByRole(role).evaluateAll((nodes) => {
      const probe = document.querySelector('[data-testid=probe]');
      let d = 0;
      for (let n = probe!.parentElement; n; n = n.parentElement, d++) {
        if (nodes.includes(n)) return d;
      }
      return -1;
    });
    if (depth >= 0 && depth < best) { best = depth; nearest = role; }
  }
  return nearest;
}

async function expectAgreement(
  page: import('@playwright/test').Page,
  cases: Array<[string, string]>,
): Promise<void> {
  const disagreements: string[] = [];
  for (const [label, html] of cases) {
    await page.setContent(html);
    const records = await harvest(page, 'data-testid');
    const harvested = records.find((r) => r.testId === 'probe')?.landmark ?? null;
    const truth = await playwrightLandmark(page);
    if (harvested !== truth) {
      disagreements.push(`${label}: harvest=${harvested} playwright=${truth}`);
    }
  }
  expect(disagreements, `${disagreements.length}/${cases.length} disagreed`).toEqual([]);
}

test('landmark tags and explicit landmark roles agree with Playwright', async ({ page }) => {
  const cases: Array<[string, string]> = [];
  for (const t of ['header', 'nav', 'main', 'footer', 'aside', 'search']) {
    cases.push([`bare <${t}>`, `<${t}>${P}</${t}>`]);
  }
  for (const r of LANDMARKS) cases.push([`div role=${r}`, `<div role="${r}" aria-label="x">${P}</div>`]);
  cases.push(['form role=search', `<form role="search">${P}</form>`]);
  cases.push(['span role=contentinfo', `<span role="contentinfo">${P}</span>`]);
  cases.push(['no landmark at all', `<div>${P}</div>`]);
  await expectAgreement(page, cases);
});

test('a role attribute that names no valid ARIA role falls back to the tag', async ({ page }) => {
  const cases: Array<[string, string]> = [];
  for (const t of ['nav', 'header', 'footer', 'aside', 'main', 'search']) {
    cases.push([`<${t} role=garbage>`, `<${t} role="garbage">${P}</${t}>`]);
    cases.push([`<${t} role=UPPERCASE>`, `<${t} role="${t.toUpperCase()}">${P}</${t}>`]);
    cases.push([`<${t} role="">`, `<${t} role="">${P}</${t}>`]);
    cases.push([`<${t} role=" ">`, `<${t} role=" ">${P}</${t}>`]);
  }
  cases.push(['nav role="garbage navigation"', `<nav role="garbage navigation">${P}</nav>`]);
  cases.push(['nav role="navigation garbage"', `<nav role="navigation garbage">${P}</nav>`]);
  cases.push(['nav role="Navigation"', `<nav role="Navigation">${P}</nav>`]);
  cases.push(['div role="main navigation"', `<div role="main navigation">${P}</div>`]);
  cases.push(['div role="foo main"', `<div role="foo main">${P}</div>`]);
  cases.push(['div role="  main  "', `<div role="  main  ">${P}</div>`]);
  // Playwright splits the role attribute on a literal space, not on /\s+/, so a
  // tab-separated pair is a single token and names no role at all.
  cases.push(['div role="main<TAB>navigation"', `<div role="main\tnavigation">${P}</div>`]);
  await expectAgreement(page, cases);
});

test('presentational-role-conflict resolution agrees with Playwright', async ({ page }) => {
  await expectAgreement(page, [
    ['nav role=presentation', `<nav role="presentation">${P}</nav>`],
    ['nav role=none', `<nav role="none">${P}</nav>`],
    ['nav role=presentation + aria-label', `<nav role="presentation" aria-label="x">${P}</nav>`],
    ['nav role=none + aria-label', `<nav role="none" aria-label="x">${P}</nav>`],
    ['nav role=presentation + tabindex=0', `<nav role="presentation" tabindex="0">${P}</nav>`],
    ['nav role=presentation + tabindex=-1', `<nav role="presentation" tabindex="-1">${P}</nav>`],
    ['nav role=presentation + aria-live', `<nav role="presentation" aria-live="polite">${P}</nav>`],
    ['nav role=presentation + aria-hidden', `<nav role="presentation" aria-hidden="true">${P}</nav>`],
    ['nav role=presentation + data-foo', `<nav role="presentation" data-foo="1">${P}</nav>`],
    ['header role=presentation + aria-label', `<header role="presentation" aria-label="x">${P}</header>`],
    ['div role=presentation + aria-label', `<div role="presentation" aria-label="x">${P}</div>`],
    ['search role=none', `<search role="none">${P}</search>`],
    ['search role=none + aria-label', `<search role="none" aria-label="x">${P}</search>`],
    ['aria-hidden nav inside a main', `<main><nav aria-hidden="true">${P}</nav></main>`],
  ]);
});

const WRAPPERS: Array<[string, string]> = [
  ['article', '<article>{X}</article>'],
  ['section', '<section>{X}</section>'],
  ['aside', '<aside>{X}</aside>'],
  ['nav', '<nav>{X}</nav>'],
  ['main', '<main>{X}</main>'],
  ['div', '<div>{X}</div>'],
  ['article role=presentation', '<article role="presentation">{X}</article>'],
  ['section role=group', '<section role="group">{X}</section>'],
  ['section role=region', '<section role="region">{X}</section>'],
  ['section role=garbage', '<section role="garbage">{X}</section>'],
  ['article role=""', '<article role="">{X}</article>'],
  ['article role=article', '<article role="article">{X}</article>'],
  ['div role=region', '<div role="region" aria-label="R">{X}</div>'],
  ['div role=article', '<div role="article">{X}</div>'],
  ['div role=navigation', '<div role="navigation">{X}</div>'],
  ['section aria-label', '<section aria-label="S">{X}</section>'],
  ['article > div', '<article><div>{X}</div></article>'],
];

for (const tag of ['header', 'footer'] as const) {
  test(`<${tag}> nesting agrees with Playwright's ancestor-preventing-landmark rule`, async ({ page }) => {
    await expectAgreement(page, WRAPPERS.map(([label, w]) =>
      [`<${tag}> in ${label}`, w.replace('{X}', `<${tag}>${P}</${tag}>`)] as [string, string]));
  });
}

test('nesting and <search> agree with Playwright', async ({ page }) => {
  await expectAgreement(page, [
    ['<search> in article', `<article><search>${P}</search></article>`],
    ['nav > article > footer', `<nav><article><footer>${P}</footer></article></nav>`],
    ['main > nav', `<main><nav>${P}</nav></main>`],
    ['header > nav', `<header><nav>${P}</nav></header>`],
    ['nav > header', `<nav><header>${P}</header></nav>`],
    ['footer > nav', `<footer><nav>${P}</nav></footer>`],
    ['article > aside', `<article><aside>${P}</aside></article>`],
    ['section > aside', `<section><aside>${P}</aside></section>`],
    ['div role=banner > div', `<div role="banner"><div>${P}</div></div>`],
    ['footer role=contentinfo in article', `<article><footer role="contentinfo">${P}</footer></article>`],
    ['footer role=banner', `<footer role="banner">${P}</footer>`],
  ]);
});
