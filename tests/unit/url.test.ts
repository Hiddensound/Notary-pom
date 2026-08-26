import { describe, it, expect } from 'vitest';
import { scrubUrl } from '../../src/url/scrub.js';
import { isDenied } from '../../src/url/denyList.js';

describe('scrubUrl', () => {
  it('strips credential-bearing params but keeps benign ones', () => {
    const out = scrubUrl('https://s.test/p?token=abc123&colour=red&code=xyz');
    expect(out).toBe('https://s.test/p?colour=red');
  });

  it('drops the hash fragment and trailing slash', () => {
    expect(scrubUrl('https://s.test/p/#top')).toBe('https://s.test/p');
  });

  it('leaves a clean url untouched', () => {
    expect(scrubUrl('https://s.test/p')).toBe('https://s.test/p');
  });

  it('sorts params so identical pages fingerprint identically', () => {
    expect(scrubUrl('https://s.test/p?b=2&a=1')).toBe('https://s.test/p?a=1&b=2');
  });
});

describe('isDenied', () => {
  it('denies logout by href', () => {
    expect(isDenied('/account/signout', 'Account')).toBe(true);
  });

  it('denies delete by link text regardless of href', () => {
    expect(isDenied('/x/42', 'Delete account')).toBe(true);
  });

  it('allows an ordinary product link', () => {
    expect(isDenied('/product/red-mug', 'Red Mug')).toBe(false);
  });

  it('does not deny on a substring inside an unrelated word', () => {
    expect(isDenied('/collections/deletable-art', 'Deletable Art')).toBe(false);
  });
});
