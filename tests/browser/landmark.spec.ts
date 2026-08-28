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
