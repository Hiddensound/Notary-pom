// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Notebook } from '../types.js';

// Bumped to '2' when locator verification started proving identity rather than mere
// uniqueness, and when the test-id attribute started travelling on the candidate.
export const NOTEBOOK_VERSION: Notebook['version'] = '2';

// The README instructs users to commit the notebook and hand-edit it, so it *will* be
// hand-edited and merge-resolved. Beyond the version gate below, `readNotebook` used to be
// `JSON.parse` plus a blind type cast -- no structural validation at all -- so a bad
// hand-edit (a `strategy` that isn't a real `LocatorCandidate` variant, a `className` that
// isn't a valid identifier, a missing field) was accepted and handed straight to the
// emitters, which assume the shape is exactly what's declared below, and failed wherever
// the emitter happened to dereference the missing/wrong field with no message pointing at
// the actual corruption. This schema is the authoritative-shape check; keep it in sync with
// the `Notebook`/`PageIR`/`IRElement`/`IRCollection`/`ScopedCandidate`/`RejectedCandidate`/
// `ElementRecord` interfaces in ../types.ts, which remain the source of truth.

// Same leading-digit-guard discipline as `routeStem` (../ir/fingerprint.ts) and
// `deterministicName` (../name/deterministic.ts), applied as a check instead of a fix-up:
// `className`, `IRElement.name` and `IRCollection.name` all become class members or class
// names directly at emission, so each must be a syntactically valid, ASCII TypeScript
// identifier (this codebase's own generated names are always ASCII -- see `camelise`).
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const identifierSchema = (label: string) => z.string().refine(
  (s) => IDENTIFIER.test(s),
  { message: `"${label}" must be a valid TypeScript identifier` },
);

const landmarkRoleSchema = z.enum(['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search']);

const locatorCandidateSchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('testId'), value: z.string(), attribute: z.string() }),
  z.object({ strategy: z.literal('role'), role: z.string(), name: z.string(), exact: z.boolean() }),
  z.object({ strategy: z.literal('label'), value: z.string(), exact: z.boolean() }),
  z.object({ strategy: z.literal('placeholder'), value: z.string() }),
  z.object({ strategy: z.literal('altText'), value: z.string() }),
  z.object({ strategy: z.literal('title'), value: z.string() }),
  z.object({ strategy: z.literal('text'), value: z.string(), exact: z.boolean() }),
  z.object({ strategy: z.literal('css'), value: z.string() }),
]);

const scopedCandidateSchema = z.object({
  scope: landmarkRoleSchema.nullable(),
  candidate: locatorCandidateSchema,
  fragile: z.boolean(),
});

const rejectedCandidateSchema = z.object({
  scoped: scopedCandidateSchema,
  matchCount: z.number(),
  reason: z.enum(['ambiguous', 'notFound', 'hidden', 'identity', 'error']),
});

const elementRecordSchema = z.object({
  tag: z.string(),
  role: z.string().nullable(),
  accessibleName: z.string().nullable(),
  testId: z.string().nullable(),
  domId: z.string().nullable(),
  ariaLabel: z.string().nullable(),
  placeholder: z.string().nullable(),
  labelText: z.string().nullable(),
  altText: z.string().nullable(),
  title: z.string().nullable(),
  text: z.string().nullable(),
  landmark: landmarkRoleSchema.nullable(),
  domPath: z.string(),
  structureKey: z.string(),
  visible: z.boolean(),
  kind: z.enum(['interactive', 'heading', 'text']),
});

const irElementSchema = z.object({
  id: z.string(),
  name: identifierSchema('elements[].name'),
  nameSource: z.enum(['deterministic', 'llm', 'cached']),
  kind: z.enum(['interactive', 'heading', 'text']),
  role: z.string().nullable(),
  accessibleName: z.string().nullable(),
  group: landmarkRoleSchema.nullable(),
  status: z.enum(['resolved', 'unresolved']),
  locator: scopedCandidateSchema.nullable(),
  rejected: z.array(rejectedCandidateSchema),
  observed: elementRecordSchema,
  weak: z.boolean(),
});

const irCollectionSchema = z.object({
  id: z.string(),
  name: identifierSchema('collections[].name'),
  item: scopedCandidateSchema,
  count: z.number(),
});

const pageIrSchema = z.object({
  routeTemplate: z.string(),
  representativeUrl: z.string(),
  sampleUrls: z.array(z.string()),
  className: identifierSchema('pages[].className'),
  pageFingerprint: z.string(),
  elements: z.array(irElementSchema),
  collections: z.array(irCollectionSchema),
});

const notebookSchema = z.object({
  version: z.literal(NOTEBOOK_VERSION),
  site: z.string(),
  generatedAt: z.string(),
  pages: z.array(pageIrSchema),
});

export async function readNotebook(irDir: string): Promise<Notebook | null> {
  const path = join(irDir, 'notebook.json');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }

  // The version check runs first and separately from the full schema below, on the raw
  // parsed value rather than through a cast, because it needs its own targeted message: a
  // v1 (or otherwise unrecognised) notebook is not "malformed", it is a real notebook this
  // POMBuilder cannot trust, because `generate` emits from the stored notebook without
  // re-resolving anything -- a notebook written by an older POMBuilder would emit getters
  // whose `resolved` status only ever meant "this locator matched exactly one visible
  // node", never "and it is the node we observed". Refusing is the only honest answer: the
  // missing evidence is a live page, and no migration can invent it.
  const rawVersion = raw !== null && typeof raw === 'object' && 'version' in raw
    ? (raw as Record<string, unknown>).version
    : undefined;
  if (rawVersion !== NOTEBOOK_VERSION) {
    throw new Error(
      `The notebook at ${path} is version ${rawVersion ?? 'unknown'}, but this POMBuilder `
      + `writes version ${NOTEBOOK_VERSION}. Its locators were never checked against the `
      + 'elements they were harvested from, so they cannot be emitted safely. '
      + 'Re-run `pombuilder crawl` to rebuild it.');
  }

  const result = notebookSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `The notebook at ${path} does not match the shape this POMBuilder expects. It was `
      + 'likely hand-edited or merge-resolved into something invalid. Fix the issues below, '
      + 'or re-run `pombuilder crawl` to rebuild it from a live page:\n' + issues);
  }
  return result.data;
}

export async function writeNotebook(irDir: string, nb: Notebook): Promise<void> {
  await mkdir(irDir, { recursive: true });
  await writeFile(join(irDir, 'notebook.json'), JSON.stringify(nb, null, 2) + '\n', 'utf8');
}
