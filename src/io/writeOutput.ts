// SPDX-License-Identifier: Apache-2.0

import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Notebook } from '../types.js';
import { emitBase } from '../emit/base.js';
import { emitSubclass } from '../emit/subclass.js';
import { emitSmoke } from '../emit/smoke.js';

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

// Normalize to forward slashes for the returned `written` list so log output
// and path-suffix checks are platform-independent (Windows `path.join` uses
// backslashes). The `skipped` list keeps native separators since it holds
// paths callers may feed back into fs APIs alongside OS-native paths.
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export async function writeGenerated(
  outDir: string,
  nb: Notebook,
): Promise<{ written: string[]; skipped: string[] }> {
  const generatedDir = join(outDir, 'pages', 'generated');
  const pagesDir = join(outDir, 'pages');
  const smokeDir = join(outDir, 'smoke');
  await mkdir(generatedDir, { recursive: true });
  await mkdir(smokeDir, { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];

  for (const page of nb.pages) {
    const basePath = join(generatedDir, `${page.className}.generated.ts`);
    await writeFile(basePath, emitBase(page), 'utf8');
    written.push(toPosix(basePath));

    const subclassPath = join(pagesDir, `${page.className}.ts`);
    if (await exists(subclassPath)) {
      skipped.push(subclassPath);
    } else {
      await writeFile(subclassPath, emitSubclass(page), 'utf8');
      written.push(toPosix(subclassPath));
    }

    const smokePath = join(smokeDir, `${page.className}.smoke.spec.ts`);
    await writeFile(smokePath, emitSmoke(page), 'utf8');
    written.push(toPosix(smokePath));
  }

  return { written, skipped };
}
