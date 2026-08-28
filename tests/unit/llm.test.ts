import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refineNames, refineNotebookNames, selectWeak } from '../../src/name/llm.js';
import { buildNotebook, buildPageIR } from '../../src/ir/build.js';
import type { IRElement, PomBuilderConfig } from '../../src/types.js';

const stub = vi.hoisted(() => ({ suggestions: {} as Record<string, string> }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => ({ content: [{ type: 'text', text: JSON.stringify(stub.suggestions) }] }),
    };
  },
}));

const el = (id: string, name: string, weak: boolean): IRElement => ({
  id, name, nameSource: 'deterministic', kind: 'interactive', role: 'button',
  accessibleName: weak ? null : name, group: 'main', status: 'resolved',
  locator: { scope: null, fragile: false, candidate: { strategy: 'testId', value: id } },
  rejected: [], observed: { text: 'x' } as never,
});

describe('selectWeak', () => {
  it('picks role-only and numerically suffixed names', () => {
    const weak = selectWeak([el('a', 'button', true), el('b', 'moreButton2', true), el('c', 'checkoutButton', false)]);
    expect(weak.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('refineNames', () => {
  it('does not call the model for cached fingerprints', async () => {
    const call = vi.fn();
    const cache = await refineNames([el('a', 'button', true)], { a: 'submitOrderButton' }, call);
    expect(call).not.toHaveBeenCalled();
    expect(cache.a).toBe('submitOrderButton');
  });

  it('calls the model only for uncached elements', async () => {
    const call = vi.fn().mockResolvedValue({ b: 'shareButton' });
    const cache = await refineNames([el('a', 'button', true), el('b', 'button', true)], { a: 'x' }, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].map((e: IRElement) => e.id)).toEqual(['b']);
    expect(cache).toEqual({ a: 'x', b: 'shareButton' });
  });

  it('discards a model name that is not a valid identifier', async () => {
    const call = vi.fn().mockResolvedValue({ a: '2 bad name!' });
    const cache = await refineNames([el('a', 'button', true)], {}, call);
    expect(cache.a).toBeUndefined();
  });

  it('survives a model failure by keeping deterministic names', async () => {
    const call = vi.fn().mockRejectedValue(new Error('429'));
    const cache = await refineNames([el('a', 'button', true)], {}, call);
    expect(cache).toEqual({});
  });
});

// `VALID` accepts any `/^[a-z][A-Za-z0-9]*$/`, so a refined name can be a reserved class
// member, and the post-refine `resolveCollisions` only dedupes elements against each
// other -- it cannot see collection accessors. Refinement can therefore reintroduce
// exactly the collisions `buildPageIR` already arbitrated, which is why the arbiter runs
// again here. The notebook must also show the names that get emitted, or `diff` compares
// against something the user never sees.
describe('refineNotebookNames re-runs the member-name arbiter', () => {
  let dir: string;
  const priorKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pb-llm-'));
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(async () => {
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
    await rm(dir, { recursive: true, force: true });
  });

  const config = () => ({ irDir: dir } as unknown as PomBuilderConfig);

  it('rescues a refined name that is a reserved class member', async () => {
    stub.suggestions = { 'el-a': 'constructor' };
    const nb = buildNotebook('https://s.test', [buildPageIR({
      group: { routeTemplate: '/x', representativeUrl: 'https://s.test/x', sampleUrls: [] },
      pageFingerprint: 'pg_x',
      elements: [{ ...el('el-a', 'button', true), id: 'el-a' }],
      collections: [],
    })], '2026-01-01T00:00:00Z');

    const out = await refineNotebookNames(nb, config());
    expect(out.pages[0].elements.map((e) => e.name)).toEqual(['constructorElement']);
  });

  it('rescues a refined name that collides with a collection accessor', async () => {
    stub.suggestions = { 'el-a': 'itemCount' };
    const nb = buildNotebook('https://s.test', [buildPageIR({
      group: { routeTemplate: '/x', representativeUrl: 'https://s.test/x', sampleUrls: [] },
      pageFingerprint: 'pg_x',
      elements: [{ ...el('el-a', 'button', true), id: 'el-a' }],
      collections: [{
        id: 'co-1', name: 'item', count: 3,
        item: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'i' } },
      }],
    })], '2026-01-01T00:00:00Z');

    const out = await refineNotebookNames(nb, config());
    expect(out.pages[0].elements.map((e) => e.name)).toEqual(['itemCount']);
    expect(out.pages[0].collections.map((c) => c.name)).toEqual(['item2']);
  });
});
