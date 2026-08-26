import { describe, it, expect } from 'vitest';
import { structuralFingerprint } from '../../src/ir/fingerprint.js';

const productA = `
- banner:
  - link "Home"
  - link "Cart"
- main:
  - heading "Red Mug" [level=1]
  - button "Add to cart"
`;

const productB = `
- banner:
  - link "Home"
  - link "Cart"
- main:
  - heading "Blue Teapot" [level=1]
  - button "Add to cart"
`;

const giftCard = `
- banner:
  - link "Home"
  - link "Cart"
- main:
  - heading "Gift Card" [level=1]
  - textbox "Amount"
  - button "Add to cart"
`;

describe('structuralFingerprint', () => {
  it('ignores accessible names so same-shaped pages agree', () => {
    expect(structuralFingerprint(productA)).toBe(structuralFingerprint(productB));
  });

  it('differs when the structure genuinely differs', () => {
    expect(structuralFingerprint(productA)).not.toBe(structuralFingerprint(giftCard));
  });

  it('keeps structural attributes that are not names', () => {
    const h1 = '- heading "X" [level=1]';
    const h2 = '- heading "X" [level=2]';
    expect(structuralFingerprint(h1)).not.toBe(structuralFingerprint(h2));
  });

  it('is deterministic and prefixed', () => {
    expect(structuralFingerprint(productA)).toBe(structuralFingerprint(productA));
    expect(structuralFingerprint(productA)).toMatch(/^st_/);
  });

  it('treats an empty snapshot as a stable value rather than throwing', () => {
    expect(structuralFingerprint('')).toMatch(/^st_/);
  });
});
