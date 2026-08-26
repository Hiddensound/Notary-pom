import { describe, it, expect } from 'vitest';
import { compareStrings } from '../../src/util/order.js';

describe('compareStrings', () => {
  it('uses ordinal comparison (uppercase before lowercase)', () => {
    // This assertion fails under localeCompare ('B' > 'a' in most locales)
    // but passes under ordinal comparison ('B' < 'a' in UTF-16 order)
    expect(compareStrings('B', 'a')).toBeLessThan(0);
  });

  it('returns 0 for equal strings', () => {
    expect(compareStrings('test', 'test')).toBe(0);
  });

  it('orders lowercase strings correctly', () => {
    expect(compareStrings('apple', 'banana')).toBeLessThan(0);
    expect(compareStrings('zebra', 'apple')).toBeGreaterThan(0);
  });
});
