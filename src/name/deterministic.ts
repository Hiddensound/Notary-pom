// SPDX-License-Identifier: Apache-2.0

import type { ElementRecord } from '../types.js';

const ROLE_SUFFIX: Record<string, string> = {
  button: 'Button', link: 'Link', textbox: 'Input', searchbox: 'Input',
  combobox: 'Select', listbox: 'Select', checkbox: 'Checkbox', radio: 'Radio',
  heading: 'Heading', img: 'Image', tab: 'Tab', menuitem: 'MenuItem',
  option: 'Option', status: 'Status', alert: 'Alert',
};

// Exported so the member-name arbiter (src/name/members.ts) can extend this one list
// rather than keeping a second, drifting copy of it.
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'delete', 'new', 'class', 'function', 'return', 'default', 'export',
  'import', 'const', 'let', 'var', 'this', 'super', 'page',
]);

const MAX_WORDS = 5;

function camelise(raw: string): string {
  const words = raw
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  if (words.length === 0) return '';
  const head = words[0].toLowerCase();
  const tail = words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return head + tail.join('');
}

export function deterministicName(r: ElementRecord): { name: string; weak: boolean } {
  const sources: Array<[string | null, boolean]> = [
    [r.accessibleName, false],
    [r.testId, false],
    [r.ariaLabel, false],
    [r.labelText, false],
    [r.placeholder, false],
    [r.altText, false],
    [r.domId, false],
    [r.text, true],
  ];

  let base = '';
  let weak = true;
  for (const [value, isTruncatable] of sources) {
    if (!value) continue;
    const c = camelise(value);
    if (!c) continue;
    base = c;
    weak = isTruncatable && value.trim().split(/\s+/).length > MAX_WORDS;
    break;
  }

  if (!base) {
    base = camelise(r.role ?? r.tag);
    weak = true;
  }

  const suffix = ROLE_SUFFIX[r.role ?? ''] ?? '';
  let name = base.endsWith(suffix) && suffix ? base : base + suffix;
  if (/^[0-9]/.test(name)) name = 'n' + name;
  if (RESERVED_WORDS.has(name)) name = name + 'Element';
  return { name, weak };
}
