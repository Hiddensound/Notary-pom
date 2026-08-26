import { describe, it, expect } from 'vitest';
import { withDefaults } from '../../src/config.js';

describe('withDefaults', () => {
  it('fills defaults around a bare seed', () => {
    const c = withDefaults({ seed: 'https://shop.test' });
    expect(c.maxDepth).toBe(3);
    expect(c.maxPages).toBe(50);
    expect(c.testIdAttribute).toBe('data-testid');
    expect(c.respectRobots).toBe(true);
  });

  it('rejects a missing seed', () => {
    expect(() => withDefaults({} as never)).toThrow(/seed/i);
  });

  it('preserves caller overrides', () => {
    expect(withDefaults({ seed: 'https://s.test', maxPages: 5 }).maxPages).toBe(5);
  });
});
