// SPDX-License-Identifier: Apache-2.0

// Example POMBuilder configuration, used by the acceptance run documented in the README
// and in docs/superpowers/plans/POMBuilder-design-v1.md (Task 16, Step 5).
//
// A config file is a plain ES module whose default export is a `Partial<PomBuilderConfig>`
// (see src/types.ts for the full shape) - `loadConfig` in src/cli.ts merges it over the
// built-in defaults from `withDefaults`, and a `seed` URL passed on the command line always
// overrides whatever `seed` (if any) is set here.
//
// This example tightens `maxPages` below the default of 50. The default is already a safe
// upper bound, but a smaller cap makes an acceptance run against a live third-party demo
// site (https://www.scrapingcourse.com/ecommerce/) faster and more courteous while still
// exercising route templating, collections and the resolver against real markup.
//
// This site's own robots.txt is `Disallow: /ecommerce/*`, which blocks every sub-path
// of the listing page - including every product detail page - so `maxDepth` beyond the
// seed cannot discover any additional *route template* here regardless of its value;
// `maxPages: 20` is enough headroom to prove that on its own without a long crawl.
//
// Earlier iterations of this config also carried `maxDepth: 0`, to work around a real
// crawler bug: `src/crawl/crawl.ts` used to check `robots.isAllowed()` against the URL
// *after* `scrubUrl` had already stripped a trailing slash, which silently defeated
// this exact `Disallow: /ecommerce/*` rule for same-page WooCommerce "add-to-cart"
// anchors (`/ecommerce/?add-to-cart=<id>`) - those links share the bare listing page's
// pathname, aren't caught by the deny-list (which flags remove/cancel/delete-style
// words, not "add"), and visiting one mutates the shared session's server-side cart,
// contaminating a later harvest of the *same* listing page with transient mini-cart
// elements a fresh session would never see. That has been fixed at the source: the
// robots.txt check in `src/crawl/crawl.ts` now runs against the original,
// browser-resolved `href` before any normalisation, so this rule is honoured exactly
// as the site published it and the add-to-cart links are never even queued. See the
// "Known limitations" section of README.md for the full writeup.
export default {
  maxPages: 20,
};
