// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Notebook } from '../types.js';

// Bumped to '2' when locator verification started proving identity rather than mere
// uniqueness, and when the test-id attribute started travelling on the candidate.
export const NOTEBOOK_VERSION: Notebook['version'] = '2';

export async function readNotebook(irDir: string): Promise<Notebook | null> {
  const path = join(irDir, 'notebook.json');
  let nb: Notebook | null;
  try {
    nb = JSON.parse(await readFile(path, 'utf8')) as Notebook;
  } catch {
    return null;
  }

  // `generate` emits from the stored notebook without re-resolving anything, so a notebook
  // written by an older POMBuilder would emit getters whose `resolved` status only ever
  // meant "this locator matched exactly one visible node" -- never "and it is the node we
  // observed". Refusing is the only honest answer: the missing evidence is a live page,
  // and no migration can invent it.
  if (!nb || nb.version !== NOTEBOOK_VERSION) {
    throw new Error(
      `The notebook at ${path} is version ${nb?.version ?? 'unknown'}, but this POMBuilder `
      + `writes version ${NOTEBOOK_VERSION}. Its locators were never checked against the `
      + 'elements they were harvested from, so they cannot be emitted safely. '
      + 'Re-run `pombuilder crawl` to rebuild it.');
  }
  return nb;
}

export async function writeNotebook(irDir: string, nb: Notebook): Promise<void> {
  await mkdir(irDir, { recursive: true });
  await writeFile(join(irDir, 'notebook.json'), JSON.stringify(nb, null, 2) + '\n', 'utf8');
}
