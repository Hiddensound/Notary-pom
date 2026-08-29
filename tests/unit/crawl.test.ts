import { describe, it, expect } from 'vitest';
import robotsParserImport from 'robots-parser';
import { formatUnstable, shouldFollow, type Robots, type UnstablePage } from '../../src/crawl/crawl.js';
import { withDefaults } from '../../src/config.js';

// Same cast crawl.ts itself needs -- see the comment there on robots-parser's types.
const robotsParser = robotsParserImport as unknown as (url: string, robotstxt: string) => Robots;

const origin = 'https://shop.test';
const config = withDefaults({ seed: `${origin}/ecommerce/` });

describe('shouldFollow', () => {
  it('honours a trailing-slash-anchored robots.txt rule against a query-string variant', () => {
    // A real robots-parser instance, parsing a real robots.txt idiom: `Disallow: /ecommerce/`
    // blocks every sub-path of `/ecommerce/`, including one carrying a query string. This
    // is the exact shape scrapingcourse.com's own robots.txt uses.
    const robots = robotsParser(`${origin}/robots.txt`, 'User-agent: *\nDisallow: /ecommerce/\n');
    const link = { href: `${origin}/ecommerce/?add-to-cart=5`, text: 'Add to cart' };

    // scrubUrl would normalise this href to `${origin}/ecommerce?add-to-cart=5` -- no
    // trailing slash before the query string -- which the same rule does NOT match,
    // because it no longer starts with the literal `/ecommerce/` the rule disallows.
    // Checking robots.txt against the scrubbed URL therefore lets a disallowed link
    // through; checking it against the original href (what shouldFollow now does)
    // catches it correctly.
    expect(shouldFollow(link, origin, config, robots)).toBeNull();
  });

  it('still follows a link robots.txt does not disallow', () => {
    const robots = robotsParser(`${origin}/robots.txt`, 'User-agent: *\nDisallow: /ecommerce/\n');
    const link = { href: `${origin}/about`, text: 'About' };
    expect(shouldFollow(link, origin, config, robots)).toBe(`${origin}/about`);
  });

  it('still applies exclude/include and the deny-list when robots.txt is absent', () => {
    const excluding = withDefaults({ seed: `${origin}/`, exclude: ['/private.*'] });
    expect(shouldFollow({ href: `${origin}/private/x`, text: '' }, origin, excluding, null)).toBeNull();
    expect(shouldFollow({ href: `${origin}/logout`, text: 'Log out' }, origin, config, null)).toBeNull();
    expect(shouldFollow({ href: `${origin}/ok`, text: 'ok' }, origin, config, null)).toBe(`${origin}/ok`);
  });
});

describe('formatUnstable', () => {
  const sampled: UnstablePage[] = [
    { url: 'https://shop.test/', phase: 'discover', reason: 'mutation', elapsedMs: 8012 },
    { url: 'https://shop.test/live', phase: 'harvest', reason: 'network', elapsedMs: 8004 },
  ];

  it('says nothing at all when every page held still', () => {
    expect(formatUnstable([])).toBe('');
  });

  it('names each page, which visit it was, and why the wait ended', () => {
    const out = formatUnstable(sampled);
    expect(out).toContain('2 page loads were sampled before the page stabilised');
    expect(out).toContain('https://shop.test/ (discover, 8012ms): the DOM never stopped changing.');
    expect(out).toContain(
      'https://shop.test/live (harvest, 8004ms): the network never went idle, '
      + 'so content may still have been arriving.');
  });

  // The point of the warning is that spurious drift has an explanation, so it has to
  // offer that explanation rather than leaving the reader to suspect the site. Asserted
  // as the whole sentence: `toContain('may')` and `toContain('drift')` were true of any
  // English warning and so tested nothing (review B-6).
  it('attributes possible drift to the sampling rather than to the site', () => {
    expect(formatUnstable(sampled)).toContain(
      'The harvest may be incomplete, and `pombuilder diff` may report drift for '
      + 'elements that never actually changed.');
  });

  it('distinguishes a page that never went idle from one that kept making requests', () => {
    const out = formatUnstable([
      { url: 'https://shop.test/sse', phase: 'harvest', reason: 'network', elapsedMs: 4000 },
      { url: 'https://shop.test/poll', phase: 'harvest', reason: 'pending', elapsedMs: 5000 },
    ]);
    expect(out).toContain('https://shop.test/sse (harvest, 4000ms): the network never went idle,');
    expect(out).toContain(
      'https://shop.test/poll (harvest, 5000ms): the page kept making requests, '
      + 'so content may still have been arriving.');
  });

  it('reads correctly for a single page', () => {
    expect(formatUnstable(sampled.slice(0, 1)))
      .toContain('1 page load was sampled before the page stabilised');
  });

  // On a 50-page animated site every page is reported twice, so an uncapped list is 100+
  // lines of stderr in which the summary line is the only part anyone reads (review B-7).
  it('caps the list rather than emitting a line per page load without limit', () => {
    const many: UnstablePage[] = Array.from({ length: 40 }, (_, i) => ({
      url: `https://shop.test/p/${i}`,
      phase: 'harvest' as const,
      reason: 'mutation' as const,
      elapsedMs: 8000,
    }));
    const out = formatUnstable(many);

    // The count is never truncated, because it is the part that says how bad it is.
    expect(out).toContain('40 page loads were sampled before the page stabilised');
    expect(out.split(String.fromCharCode(10)).length).toBeLessThan(15);
    expect(out).toContain('https://shop.test/p/0 (harvest, 8000ms)');
    expect(out).toContain('and 30 more');
    expect(out).not.toContain('https://shop.test/p/39');
  });
});
