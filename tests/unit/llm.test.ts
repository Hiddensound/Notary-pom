import { describe, it, expect, vi } from 'vitest';
import { refineNames, selectWeak } from '../../src/name/llm.js';
import type { IRElement } from '../../src/types.js';

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
