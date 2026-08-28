// SPDX-License-Identifier: Apache-2.0

import type { ScopedCandidate } from '../types.js';
import { testIdSelector, usesDefaultTestIdAttribute } from './testId.js';

// Exported because page-level interpolations (route, representativeUrl, test titles) go
// into single-quoted literals in the emitted source too, and an unescaped apostrophe in a
// pathname -- which `new URL(...).pathname` does not percent-encode -- is a syntax error.
export const q = (s: string) => {
  const escapes: Record<string, string> = {
    '\\': '\\\\',
    "'": "\\'",
    '\n': '\\n',
    '\r': '\\r',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  const escaped = s.replace(/[\\'\n\r\u2028\u2029]/g, (ch) => escapes[ch]!);
  return `'${escaped}'`;
};

export function renderCall(c: ScopedCandidate['candidate']): string {
  switch (c.strategy) {
    // `getByTestId` in the emitted file resolves against the CONSUMER project's configured
    // test-id attribute, which POMBuilder has no way to know. It is therefore only correct
    // when the attribute is Playwright's own default; for anything else the attribute has
    // to be named in the locator, or the shipped getter binds a different node than the one
    // the resolver verified. Two escaping layers here: `testIdSelector` produces a CSS
    // string, `q` puts it inside a TypeScript string literal.
    case 'testId': return usesDefaultTestIdAttribute(c)
      ? `getByTestId(${q(c.value)})`
      : `locator(${q(testIdSelector(c))})`;
    case 'role': return `getByRole(${q(c.role)}, { name: ${q(c.name)}, exact: ${c.exact} })`;
    case 'label': return `getByLabel(${q(c.value)}, { exact: ${c.exact} })`;
    case 'placeholder': return `getByPlaceholder(${q(c.value)})`;
    case 'altText': return `getByAltText(${q(c.value)})`;
    case 'title': return `getByTitle(${q(c.value)})`;
    case 'text': return `getByText(${q(c.value)}, { exact: ${c.exact} })`;
    case 'css': return `locator(${q(c.value)})`;
  }
}

export function renderCandidate(sc: ScopedCandidate): string {
  const tail = renderCall(sc.candidate);
  return sc.scope
    ? `this.page.getByRole(${q(sc.scope)}).${tail}`
    : `this.page.${tail}`;
}
