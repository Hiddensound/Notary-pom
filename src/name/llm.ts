// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IRElement, Notebook, PomBuilderConfig } from '../types.js';
import { resolveCollisions } from './collisions.js';
import { compareStrings } from '../util/order.js';

export type NameCache = Record<string, string>;
export type LlmCall = (elements: IRElement[]) => Promise<Record<string, string>>;

const VALID = /^[a-z][A-Za-z0-9]*$/;
const WEAK_PATTERNS = [/^(button|link|input|select|checkbox|radio|img|heading)$/i, /[0-9]$/];

export function selectWeak(elements: IRElement[]): IRElement[] {
  return elements.filter((e) => !e.accessibleName || WEAK_PATTERNS.some((p) => p.test(e.name)));
}

export async function refineNames(weak: IRElement[], cache: NameCache, call: LlmCall): Promise<NameCache> {
  const pending = weak.filter((e) => !(e.id in cache));
  if (pending.length === 0) return { ...cache };

  let suggestions: Record<string, string> = {};
  try {
    suggestions = await call(pending);
  } catch {
    return { ...cache }; // A model failure must never fail the build.
  }

  const next: NameCache = { ...cache };
  for (const [id, name] of Object.entries(suggestions)) {
    if (typeof name === 'string' && VALID.test(name)) next[id] = name;
  }
  return next;
}

async function anthropicCall(elements: IRElement[]): Promise<Record<string, string>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const payload = elements.map((e) => ({
    id: e.id, role: e.role, testId: e.observed.testId,
    text: e.observed.text?.slice(0, 60) ?? null, landmark: e.group,
  }));
  const message = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1000,
    system:
      'You name UI elements for a Playwright page object. Return ONLY a JSON object mapping ' +
      'each id to a camelCase TypeScript identifier ending in a role suffix such as Button, ' +
      'Link or Input. No prose, no markdown fences. Never invent a selector.',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const text = message.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim()) as Record<string, string>;
}

export async function refineNotebookNames(nb: Notebook, config: PomBuilderConfig): Promise<Notebook> {
  if (!process.env.ANTHROPIC_API_KEY) return nb;

  const cachePath = join(config.irDir, 'names.json');
  let cache: NameCache = {};
  try { cache = JSON.parse(await readFile(cachePath, 'utf8')) as NameCache; } catch { /* first run */ }

  const allWeak = nb.pages.flatMap((p) => selectWeak(p.elements));
  const next = await refineNames(allWeak, cache, anthropicCall);

  await mkdir(config.irDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(next, null, 2) + '\n', 'utf8');

  const pages = nb.pages.map((p) => {
    const renamed = p.elements.map((e) =>
      next[e.id] ? { ...e, name: next[e.id], nameSource: 'llm' as const } : e);
    // Renaming can create new collisions, so run the same disambiguation pass again.
    const settled = resolveCollisions(renamed.map((e) => ({ record: e.observed, name: e.name, weak: false })));
    const elements = renamed
      .map((e, i) => ({ ...e, name: settled[i].name }))
      .sort((a, b) => compareStrings(a.name, b.name));
    return { ...p, elements };
  });

  return { ...nb, pages };
}
