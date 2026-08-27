import { describe, it, expect } from 'vitest';
import robotsParserImport from 'robots-parser';
import { shouldFollow, type Robots } from '../../src/crawl/crawl.js';
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
