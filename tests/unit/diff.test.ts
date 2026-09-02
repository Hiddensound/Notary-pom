import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffNotebooks, formatDrift, maxSeverity, severityToExitCode } from '../../src/diff/notebook.js';
import { refinedDiff } from '../../src/diff/run.js';
import type { IRElement, Notebook, PageIR, PomBuilderConfig } from '../../src/types.js';

const el = (id: string, over: Partial<IRElement> = {}): IRElement => ({
  id, name: 'someButton', nameSource: 'deterministic', kind: 'interactive',
  role: 'button', accessibleName: 'Some', group: 'main', status: 'resolved',
  locator: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'some' } },
  rejected: [], observed: {} as never, weak: false, ...over,
});

const nb = (pages: PageIR[]): Notebook =>
  ({ version: '2', site: 'https://s.test', generatedAt: 'now', pages });

const pg = (elements: IRElement[]): PageIR => ({
  routeTemplate: '/p', representativeUrl: 'https://s.test/p', sampleUrls: [],
  className: 'PPage', pageFingerprint: 'f', elements, collections: [],
});

describe('diffNotebooks', () => {
  it('reports an added element', () => {
    const r = diffNotebooks(nb([pg([el('a')])]), nb([pg([el('a'), el('b')])]));
    expect(r.elements).toEqual([{ page: '/p', id: 'b', name: 'someButton', change: 'added', detail: 'testId', severity: 'info' }]);
  });

  it('reports a removed element', () => {
    const r = diffNotebooks(nb([pg([el('a'), el('b')])]), nb([pg([el('a')])]));
    expect(r.elements[0].change).toBe('removed');
  });

  it('reports a strategy downgrade', () => {
    const before = el('a');
    const after = el('a', {
      locator: { scope: null, fragile: true, candidate: { strategy: 'css', value: 'body>button' } },
    });
    const r = diffNotebooks(nb([pg([before])]), nb([pg([after])]));
    expect(r.elements[0].change).toBe('strategyChanged');
    expect(r.elements[0].detail).toBe('testId -> css');
  });

  it('reports an element that stopped resolving', () => {
    const after = el('a', { status: 'unresolved', locator: null });
    const r = diffNotebooks(nb([pg([el('a')])]), nb([pg([after])]));
    expect(r.elements[0].change).toBe('nowUnresolved');
  });

  it('reports a renamed element', () => {
    const before = el('a');
    const after = el('a', { name: 'saveChangesButton' });
    const r = diffNotebooks(nb([pg([before])]), nb([pg([after])]));
    expect(r.elements[0].change).toBe('renamed');
    expect(r.elements[0].detail).toBe('someButton -> saveChangesButton');
  });

  it('reports an element that started resolving', () => {
    const before = el('a', { status: 'unresolved', locator: null });
    const after = el('a');
    const r = diffNotebooks(nb([pg([before])]), nb([pg([after])]));
    expect(r.elements[0].change).toBe('nowResolved');
    expect(r.elements[0].detail).toBe('testId');
  });

  it('reports page-level changes', () => {
    const other = { ...pg([]), routeTemplate: '/q' };
    const r = diffNotebooks(nb([pg([])]), nb([pg([]), other]));
    expect(r.addedPages).toEqual(['/q']);
    expect(r.removedPages).toEqual([]);
  });

  it('finds nothing between identical notebooks', () => {
    const r = diffNotebooks(nb([pg([el('a')])]), nb([pg([el('a')])]));
    expect(r.elements).toHaveLength(0);
  });

  // Regression for the fingerprint-collision fix in `resolveElements`: two elements that
  // fingerprint identically now get distinct ids, the first bare and the second suffixed
  // `_2`. Before that fix both collapsed onto one id and `diffNotebooks`' id-keyed
  // before/after maps silently dropped whichever member arrived first -- a regression on
  // that first member (here: it stops resolving) never reached the drift report. This
  // rebuilds the exact collision shape with the ordinal-suffixed second id and checks the
  // regression on the first member is now reported.
  it('reports a regression on the first member of a fingerprint-colliding pair', () => {
    const first = el('el_abc123456789', { name: 'goButton' });
    const second = el('el_abc123456789_2', { name: 'goButton2' });
    const firstRegressed = { ...first, status: 'unresolved' as const, locator: null };

    const r = diffNotebooks(nb([pg([first, second])]), nb([pg([firstRegressed, second])]));
    expect(r.elements).toEqual([
      {
        page: '/p', id: 'el_abc123456789', name: 'goButton', change: 'nowUnresolved',
        detail: 'no unique locator', severity: 'regression',
      },
    ]);
  });
});

describe('severity classification', () => {
  it('marks a strategy downgrade to a fragile candidate as a regression', () => {
    const before = el('a');
    const after = el('a', {
      locator: { scope: null, fragile: true, candidate: { strategy: 'css', value: 'body>button' } },
    });
    const r = diffNotebooks(nb([pg([before])]), nb([pg([after])]));
    expect(r.elements[0].severity).toBe('regression');
  });

  it('marks a strategy upgrade to a non-fragile candidate as a warning, not a regression', () => {
    const before = el('a', {
      locator: { scope: null, fragile: true, candidate: { strategy: 'css', value: 'body>button' } },
    });
    const after = el('a');
    const r = diffNotebooks(nb([pg([before])]), nb([pg([after])]));
    expect(r.elements[0].severity).toBe('warning');
  });

  it('marks a stopped-resolving element as a regression', () => {
    const after = el('a', { status: 'unresolved', locator: null });
    const r = diffNotebooks(nb([pg([el('a')])]), nb([pg([after])]));
    expect(r.elements[0].severity).toBe('regression');
  });
});

describe('maxSeverity', () => {
  it('is none for an unchanged notebook', () => {
    expect(maxSeverity(diffNotebooks(nb([pg([el('a')])]), nb([pg([el('a')])])))).toBe('none');
  });

  it('is regression when any element regressed, regardless of other drift', () => {
    const after = el('a', { status: 'unresolved', locator: null });
    const r = diffNotebooks(nb([pg([el('a'), el('b')])]), nb([pg([after, el('b')])]));
    expect(maxSeverity(r)).toBe('regression');
  });

  it('is warning for a removed page with no element-level drift', () => {
    const r = diffNotebooks(nb([pg([]), { ...pg([]), routeTemplate: '/q' }]), nb([pg([])]));
    expect(maxSeverity(r)).toBe('warning');
  });

  it('is info when only additions are present', () => {
    const r = diffNotebooks(nb([pg([el('a')])]), nb([pg([el('a'), el('b')])]));
    expect(maxSeverity(r)).toBe('info');
  });
});

describe('severityToExitCode', () => {
  it('maps none to 0', () => {
    expect(severityToExitCode('none')).toBe(0);
  });

  it('maps info to 1', () => {
    expect(severityToExitCode('info')).toBe(1);
  });

  it('maps warning to 1', () => {
    expect(severityToExitCode('warning')).toBe(1);
  });

  it('maps regression to 2', () => {
    expect(severityToExitCode('regression')).toBe(2);
  });
});

describe('formatDrift', () => {
  it('says so when nothing changed', () => {
    expect(formatDrift({ addedPages: [], removedPages: [], elements: [] })).toBe('No drift detected.');
  });

  it('annotates each element line with its severity', () => {
    const r = diffNotebooks(nb([pg([el('a')])]), nb([pg([el('a'), el('b')])]));
    expect(formatDrift(r)).toContain('[info]');
  });
});

// `crawl` stores LLM-refined names, but a bare `diffNotebooks(previous, next)` compared
// that refined `previous` against a freshly-crawled, never-refined `next` -- every
// refined element reported `renamed` on every diff run forever, with nothing having
// changed. `refinedDiff` closes that gap by refining `next` first, reusing `names.json`
// so an already-cached element costs no LLM call.
describe('refinedDiff', () => {
  let dir: string;
  const priorKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pb-refined-diff-'));
  });

  afterEach(async () => {
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
    await rm(dir, { recursive: true, force: true });
  });

  const config = () => ({ irDir: dir } as unknown as PomBuilderConfig);

  it('reports no rename when the fresh crawl refines to the same cached name as the stored notebook', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    await writeFile(join(dir, 'names.json'), JSON.stringify({ a: 'submitOrderButton' }), 'utf8');

    const previous = nb([pg([el('a', { name: 'submitOrderButton', nameSource: 'llm', accessibleName: null })])]);
    const next = nb([pg([el('a', { name: 'button', nameSource: 'deterministic', accessibleName: null })])]);

    const r = await refinedDiff(previous, next, config());
    expect(r.elements).toHaveLength(0);
  });

  it('behaves exactly like the old bare diffNotebooks call when ANTHROPIC_API_KEY is unset (regression guard)', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const previous = nb([pg([el('a', { name: 'submitOrderButton', nameSource: 'llm', accessibleName: null })])]);
    const next = nb([pg([el('a', { name: 'button', nameSource: 'deterministic', accessibleName: null })])]);

    const r = await refinedDiff(previous, next, config());
    expect(r).toEqual(diffNotebooks(previous, next));
    // And that shared behavior is still the pre-fix asymmetry the common no-key path keeps:
    // a name difference is reported as a rename, since refinement never ran.
    expect(r.elements).toEqual([
      { page: '/p', id: 'a', name: 'button', change: 'renamed', detail: 'submitOrderButton -> button', severity: 'info' },
    ]);
  });
});
