import { describe, it, expect } from 'vitest';
import { detectCollections } from '../../src/resolve/collections.js';
import type { ElementRecord } from '../../src/types.js';

const card = (n: number, over: Partial<ElementRecord> = {}): ElementRecord => ({
  tag: 'a', role: 'link', accessibleName: `Product ${n}`, testId: 'product-card',
  domId: null, ariaLabel: null, placeholder: null, labelText: null, altText: null,
  title: null, text: `Product ${n}`, landmark: 'main',
  domPath: `body > main:nth-child(1) > a:nth-child(${n})`,
  structureKey: 'MAIN.grid>A.card', visible: true, kind: 'interactive', ...over,
});

describe('detectCollections', () => {
  it('groups 3+ structurally identical siblings into one collection', () => {
    const { collections, consumed } = detectCollections([card(1), card(2), card(3)]);
    expect(collections).toHaveLength(1);
    expect(collections[0].count).toBe(3);
    expect(collections[0].item.candidate)
      .toEqual({ strategy: 'testId', value: 'product-card', attribute: 'data-testid' });
    expect(consumed.size).toBe(3);
  });

  it('leaves 2 siblings alone', () => {
    const { collections, consumed } = detectCollections([card(1), card(2)]);
    expect(collections).toHaveLength(0);
    expect(consumed.size).toBe(0);
  });

  it('names the collection from the shared test id', () => {
    expect(detectCollections([card(1), card(2), card(3)]).collections[0].name).toBe('productCard');
  });

  it('falls back to a css item locator when siblings share no test id', () => {
    const plain = (n: number) => card(n, { testId: null });
    const { collections } = detectCollections([plain(1), plain(2), plain(3)]);
    expect(collections[0].item.candidate.strategy).toBe('css');
    expect(collections[0].item.fragile).toBe(true);
  });

  it('does not group elements with different structure keys', () => {
    const mixed = [card(1), card(2), card(3, { structureKey: 'MAIN.grid>DIV.banner' })];
    expect(detectCollections(mixed).collections).toHaveLength(0);
  });

  it('is order-independent', () => {
    const a = detectCollections([card(1), card(2), card(3)]).collections[0];
    const b = detectCollections([card(3), card(1), card(2)]).collections[0];
    expect(a.id).toBe(b.id);
  });
});
