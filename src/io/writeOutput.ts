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
  // Files are keyed by class name, so two pages sharing one would silently overwrite each
  // other and lose a page object plus its smoke spec while still reporting both as
  // written. `uniqueClassNames` prevents that upstream; this is the backstop that makes
  // any future regression loud instead of invisible.
  const seen = new Set<string>();
  for (const page of nb.pages) {
    if (seen.has(page.className)) {
      throw new Error(
        `Duplicate page class name ${JSON.stringify(page.className)} for route ` +
        `${JSON.stringify(page.routeTemplate)}: two pages would write the same files. ` +
        'Refusing to overwrite the first page object.',
      );
    }
    seen.add(page.className);
  }

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
