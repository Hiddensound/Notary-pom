import { describe, it, expect } from 'vitest';
import { scrubUrl } from '../../src/url/scrub.js';
import { isDenied } from '../../src/url/denyList.js';

describe('scrubUrl', () => {
  // The spec is unconditional: strip every query parameter, not a blocklist. This
  // replaces the old 'strips credential-bearing params but keeps benign ones' case, which
  // asserted the spec-violating behavior (a benign `colour=red` surviving) as correct.
  it('strips every query parameter, not just known credential names', () => {
    const out = scrubUrl('https://s.test/p?colour=red&X-Amz-Signature=DEADBEEF&mkt_tok=abc&sso=zzz&access-token=t');
    expect(out).toBe('https://s.test/p');
  });

  it('drops the hash fragment and trailing slash', () => {
    expect(scrubUrl('https://s.test/p/#top')).toBe('https://s.test/p');
  });

  it('leaves a clean url untouched', () => {
    expect(scrubUrl('https://s.test/p')).toBe('https://s.test/p');
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

  // The discriminating case: "delete" in "undeleted" is not bounded by a non-alphanumeric
  // character on the left ('n' precedes it), so the correct, boundary-aware answer is
  // `false` -- while a naive `target.includes('delete')` would wrongly return `true` here,
  // since "delete" really is a substring of "undeleted". `deletable-art` below does not
  // discriminate the two implementations: "deletable".includes("delete") is already false
  // (character 6 is 'a', not 'e'), so a naive substring check would also correctly say
  // `false` there, for an unrelated reason.
  it('does not deny on a substring inside an unrelated word', () => {
    expect(isDenied('/undeleted', 'Undeleted items')).toBe(false);
  });

  it('does not deny on a substring inside an unrelated word (second example)', () => {
    expect(isDenied('/collections/deletable-art', 'Deletable Art')).toBe(false);
  });

  it('denies Devise-style sign_out and log_out', () => {
    expect(isDenied('/users/sign_out', 'Sign out')).toBe(true);
    expect(isDenied('/log_out', 'Log out')).toBe(true);
  });
});
