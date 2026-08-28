import { describe, it, expect } from 'vitest';
import { diffNotebooks, formatDrift } from '../../src/diff/notebook.js';
import type { IRElement, Notebook, PageIR } from '../../src/types.js';

const el = (id: string, over: Partial<IRElement> = {}): IRElement => ({
  id, name: 'someButton', nameSource: 'deterministic', kind: 'interactive',
  role: 'button', accessibleName: 'Some', group: 'main', status: 'resolved',
  locator: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'some' } },
  rejected: [], observed: {} as never, ...over,
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
    expect(r.elements).toEqual([{ page: '/p', id: 'b', name: 'someButton', change: 'added', detail: 'testId' }]);
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
});

describe('formatDrift', () => {
  it('says so when nothing changed', () => {
    expect(formatDrift({ addedPages: [], removedPages: [], elements: [] })).toBe('No drift detected.');
  });
});
