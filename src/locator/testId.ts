// SPDX-License-Identifier: Apache-2.0

import type { LocatorCandidate } from '../types.js';

export type TestIdCandidate = Extract<LocatorCandidate, { strategy: 'testId' }>;

// Playwright's own built-in default. `getByTestId` resolves against a PROCESS-GLOBAL
// attribute name (`selectors.setTestIdAttribute`), so it means one thing in this process
// and whatever the consumer's `playwright.config.ts` says in theirs. Emitting it is only
// safe when the candidate was read from this exact attribute -- then any consumer that has
// not reconfigured Playwright binds the same node, and the generated source stays
// byte-identical to everything written before the attribute was recorded. For any other
// attribute the emitted locator must name the attribute itself.
export const DEFAULT_TEST_ID_ATTRIBUTE = 'data-testid';

export function testIdAttributeOf(c: TestIdCandidate): string {
  // Notebooks are JSON.parse'd with no schema validation. `readNotebook` refuses the
  // versions that predate this field, but a hand-edited or truncated notebook can still
  // arrive without it, and `[undefined="cta"]` is a far worse answer than the one the
  // absence always meant.
  return c.attribute || DEFAULT_TEST_ID_ATTRIBUTE;
}

export function usesDefaultTestIdAttribute(c: TestIdCandidate): boolean {
  return testIdAttributeOf(c) === DEFAULT_TEST_ID_ATTRIBUTE;
}

// CSSOM's "serialize a string". The value comes from a page's attribute and can hold
// anything `getAttribute` can return -- quotes, backslashes, `]`, newlines, control
// characters -- and it has to survive into a CSS attribute selector intact.
export function cssString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code === 0) out += '�';
    else if (code <= 0x1f || code === 0x7f) out += `\\${code.toString(16)} `;
    else if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else out += ch;
  }
  return `${out}"`;
}

// CSSOM's "serialize an identifier", for the attribute NAME. In practice this is
// `data-qa` and passes through untouched, but the name comes from user config and a
// selector built from an unescaped one would be a different selector, not a syntax error.
export function cssIdentifier(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = ch.codePointAt(0)!;
    const digit = code >= 0x30 && code <= 0x39;
    if (code === 0) out += '�';
    else if (code <= 0x1f || code === 0x7f) out += `\\${code.toString(16)} `;
    else if (digit && (i === 0 || (i === 1 && value[0] === '-'))) out += `\\${code.toString(16)} `;
    else if (ch === '-' && value.length === 1) out += '\\-';
    else if (code >= 0x80 || ch === '-' || ch === '_' || digit
      || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) out += ch;
    else out += `\\${ch}`;
  }
  return out;
}

// The single definition of what a non-default test-id candidate means. `bindCandidate`
// verifies with it and `renderCandidate` emits it, so the locator POMBuilder proved and
// the locator it ships cannot be different locators.
export function testIdSelector(c: TestIdCandidate): string {
  return `[${cssIdentifier(testIdAttributeOf(c))}=${cssString(c.value)}]`;
}
