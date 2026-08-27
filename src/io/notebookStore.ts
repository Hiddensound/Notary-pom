// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Notebook } from '../types.js';

export async function readNotebook(irDir: string): Promise<Notebook | null> {
  try {
    return JSON.parse(await readFile(join(irDir, 'notebook.json'), 'utf8')) as Notebook;
  } catch {
    return null;
  }
}

export async function writeNotebook(irDir: string, nb: Notebook): Promise<void> {
  await mkdir(irDir, { recursive: true });
  await writeFile(join(irDir, 'notebook.json'), JSON.stringify(nb, null, 2) + '\n', 'utf8');
}
