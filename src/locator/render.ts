// SPDX-License-Identifier: Apache-2.0

import type { ScopedCandidate } from '../types.js';

const q = (s: string) => {
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
    case 'testId': return `getByTestId(${q(c.value)})`;
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