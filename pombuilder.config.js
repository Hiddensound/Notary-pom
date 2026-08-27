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
// `maxDepth: 0` is deliberate, not a workaround to dodge failures: this site's
// robots.txt is `Disallow: /ecommerce/*`, which (matched against the request path
// including a trailing slash) blocks every sub-path - including every product detail
// page - while the bare listing path `/ecommerce` itself slips through because it has
// no trailing slash. Crawling deeper than the seed therefore cannot discover any
// additional *route template* here, it can only follow same-page WooCommerce
// "add-to-cart" anchors (`/ecommerce?add-to-cart=<id>`), which are real `<a href>`
// links, not excludable by `exclude` (which matches pathname only, and these differ
// only by query string), and are not caught by the deny-list (which flags
// remove/cancel/delete-style words, not "add"). Visiting one mutates the shared
// session's server-side cart for the rest of the crawl, so a later harvest of the
// *same* bare listing page picks up transient mini-cart elements ("View cart",
// "Remove X from cart") that will not exist in a fresh session - exactly the kind of
// contamination the generated smoke spec then fails on. Since respecting robots.txt
// already caps this site at one route, `maxDepth: 0` gets an honest, uncontaminated
// harvest of that one route without touching crawler source for a single site's quirk.
export default {
  maxPages: 20,
  maxDepth: 0,
};
