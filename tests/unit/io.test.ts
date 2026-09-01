import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGenerated } from '../../src/io/writeOutput.js';
import { readNotebook, writeNotebook } from '../../src/io/notebookStore.js';
import type { Notebook } from '../../src/types.js';

const nb: Notebook = {
  version: '2', site: 'https://s.test', generatedAt: '2026-01-01T00:00:00Z',
  pages: [{
    routeTemplate: '/', representativeUrl: 'https://s.test/', sampleUrls: [],
    className: 'HomePage', pageFingerprint: 'pg_a', collections: [],
    elements: [{
      id: 'el_1', name: 'ctaButton', nameSource: 'deterministic', kind: 'interactive',
      role: 'button', accessibleName: 'Go', group: 'main', status: 'resolved',
      locator: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'cta' } },
      rejected: [], observed: {} as never, weak: false,
    }],
  }],
};

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'pb-')); });

describe('writeGenerated', () => {
  it('writes base, subclass and smoke on a first run', async () => {
    const { written } = await writeGenerated(dir, nb);
    expect(written.some((f) => f.endsWith('generated/HomePage.generated.ts'))).toBe(true);
    expect(written.some((f) => f.endsWith('pages/HomePage.ts'))).toBe(true);
    expect(written.some((f) => f.endsWith('smoke/HomePage.smoke.spec.ts'))).toBe(true);
  });

  it('never overwrites an existing subclass', async () => {
    await writeGenerated(dir, nb);
    const subclass = join(dir, 'pages', 'HomePage.ts');
    await writeFile(subclass, '// my precious edits');
    const { skipped } = await writeGenerated(dir, nb);
    expect(skipped).toContain(subclass);
    expect(await readFile(subclass, 'utf8')).toBe('// my precious edits');
  });

  it('does overwrite the generated base', async () => {
    await writeGenerated(dir, nb);
    const base = join(dir, 'pages', 'generated', 'HomePage.generated.ts');
    await writeFile(base, '// stale');
    await writeGenerated(dir, nb);
    expect(await readFile(base, 'utf8')).toContain('ctaButton');
  });

  it('throws rather than silently overwriting a page that shares a class name', async () => {
    // Before uniquification, `/blog` and `/blog/:param1` both produced `BlogPage`: the
    // second write clobbered the first, three files landed while five were reported, and
    // the `/blog` index page object plus its smoke spec disappeared without a warning.
    const collided: Notebook = {
      ...nb,
      pages: [
        { ...nb.pages[0], routeTemplate: '/blog', className: 'BlogPage' },
        { ...nb.pages[0], routeTemplate: '/blog/:param1', className: 'BlogPage' },
      ],
    };
    await expect(writeGenerated(dir, collided)).rejects.toThrow(/Duplicate page class name "BlogPage"/);
  });

  it('writes nothing at all when it detects a duplicate class name', async () => {
    const collided: Notebook = {
      ...nb,
      pages: [
        { ...nb.pages[0], routeTemplate: '/blog', className: 'BlogPage' },
        { ...nb.pages[0], routeTemplate: '/blog/:param1', className: 'BlogPage' },
      ],
    };
    await expect(writeGenerated(dir, collided)).rejects.toThrow();
    await expect(readFile(join(dir, 'pages', 'generated', 'BlogPage.generated.ts'), 'utf8')).rejects.toThrow();
  });
});

describe('notebookStore', () => {
  it('round-trips and returns null when absent', async () => {
    expect(await readNotebook(dir)).toBeNull();
    await writeNotebook(dir, nb);
    expect((await readNotebook(dir))!.pages[0].className).toBe('HomePage');
  });

  it('refuses a notebook from before locators were verified for identity', async () => {
    // `generate` emits from the stored notebook without re-resolving, so a version-1
    // notebook would emit getters whose `resolved` only ever meant "unique". There is no
    // migration: the missing evidence can only come from a fresh crawl.
    await writeNotebook(dir, nb);
    await writeFile(join(dir, 'notebook.json'), JSON.stringify({ ...nb, version: '1' }, null, 2) + '\n');
    await expect(readNotebook(dir)).rejects.toThrow(/pombuilder crawl/);
    await expect(readNotebook(dir)).rejects.toThrow(/version 1/);
  });

  it('refuses a notebook whose version it does not recognise at all', async () => {
    await writeNotebook(dir, nb);
    await writeFile(join(dir, 'notebook.json'), JSON.stringify({ ...nb, version: '99' }, null, 2) + '\n');
    await expect(readNotebook(dir)).rejects.toThrow(/pombuilder crawl/);
  });

  it('writes stable json so git diffs are meaningful', async () => {
    await writeNotebook(dir, nb);
    const first = await readFile(join(dir, 'notebook.json'), 'utf8');
    await writeNotebook(dir, nb);
    expect(await readFile(join(dir, 'notebook.json'), 'utf8')).toBe(first);
  });
});
