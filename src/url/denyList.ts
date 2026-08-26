// SPDX-License-Identifier: Apache-2.0

const DENY_WORDS = [
  'signout', 'sign-out', 'logout', 'log-out',
  'delete', 'remove', 'cancel', 'deactivate', 'unsubscribe', 'destroy',
];

function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i').test(haystack);
}

export function isDenied(href: string, linkText: string): boolean {
  const target = `${href} ${linkText}`;
  return DENY_WORDS.some((w) => hasWord(target, w));
}
