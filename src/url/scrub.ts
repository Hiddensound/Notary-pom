// SPDX-License-Identifier: Apache-2.0

// The spec (POMBuilder-design-v1.md: "Crawled URLs are stripped of query parameters
// before being written as `representativeUrl`, because magic links and OAuth callbacks
// carry tokens in the URL and would otherwise land in a file pushed to GitHub") is
// unconditional -- strip every query parameter, not a blocklist. A blocklist approach
// verifiably under-strips: `X-Amz-Signature` (S3 presigned URLs), `access-token`
// (hyphenated -- a blocklist keyed on `access_token` misses it), `mkt_tok`, `sso`,
// `saml_response` and `oauth_token` all survived a 24-entry blocklist and would have
// landed in a notebook committed to source control and in the generated smoke spec's
// `page.goto(...)`.
export function scrubUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.search = '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}
