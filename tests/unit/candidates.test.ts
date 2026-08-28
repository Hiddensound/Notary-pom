import { describe, it, expect } from 'vitest';
import { buildCandidates, scopeTo, parentPath } from '../../src/locator/candidates.js';
import { renderCandidate } from '../../src/locator/render.js';
import { testIdSelector } from '../../src/locator/testId.js';
import type { ElementRecord } from '../../src/types.js';

const rec = (over: Partial<ElementRecord>): ElementRecord => ({
  tag: 'button', role: 'button', accessibleName: null, testId: null, domId: null,
  ariaLabel: null, placeholder: null, labelText: null, altText: null, title: null,
  text: null, landmark: null, domPath: 'body>button', structureKey: 'k',
  visible: true, kind: 'interactive', ...over,
});

describe('buildCandidates', () => {
  it('puts testId first and role second', () => {
    const c = buildCandidates(rec({ testId: 'cta', accessibleName: 'Buy' }), 'data-testid');
    expect(c.map((x) => x.candidate.strategy).slice(0, 2)).toEqual(['testId', 'role']);
  });

  it('records the attribute the test id was read from on the candidate itself', () => {
    // Carried on the candidate rather than looked up from process-global state, so what
    // the resolver verifies and what the emitter renders cannot drift apart.
    const c = buildCandidates(rec({ testId: 'cta' }), 'data-qa');
    expect(c[0].candidate).toEqual({ strategy: 'testId', value: 'cta', attribute: 'data-qa' });
  });

  it('marks the css fallback fragile and places it last', () => {
    const c = buildCandidates(rec({ testId: 'cta' }), 'data-testid');
    expect(c.at(-1)!.candidate.strategy).toBe('css');
    expect(c.at(-1)!.fragile).toBe(true);
  });

  it('omits text candidates for non-heading kinds', () => {
    const c = buildCandidates(rec({ text: 'Hello', kind: 'interactive' }), 'data-testid');
    expect(c.some((x) => x.candidate.strategy === 'text')).toBe(false);
  });

  it('allows text candidates for headings', () => {
    const c = buildCandidates(rec({ role: 'heading', text: 'Our Range', kind: 'heading' }), 'data-testid');
    expect(c.some((x) => x.candidate.strategy === 'text')).toBe(true);
  });

  it('never emits a role candidate without an accessible name', () => {
    const c = buildCandidates(rec({ domId: 'x' }), 'data-testid');
    expect(c.some((x) => x.candidate.strategy === 'role')).toBe(false);
  });

  it('two structurally identical siblings produce the identical css candidate value', () => {
    const sibling1 = buildCandidates(rec({
      domPath: 'body > main:nth-child(1) > button:nth-child(1)',
      tag: 'button',
    }), 'data-testid');
    const sibling2 = buildCandidates(rec({
      domPath: 'body > main:nth-child(1) > button:nth-child(2)',
      tag: 'button',
    }), 'data-testid');

    const css1 = sibling1.at(-1)!.candidate;
    const css2 = sibling2.at(-1)!.candidate;

    // Both should be css strategy
    expect(css1.strategy).toBe('css');
    expect(css2.strategy).toBe('css');

    // Both should have identical css values
    expect(css1.value).toBe(css2.value);

    // Parent indices preserved, element's own index removed
    expect(css1.value).toBe('body > main:nth-child(1) > button');

    // No positional index on the element itself (at the end)
    expect(css1.value).not.toMatch(/:nth-child\(\d+\)$/);
  });
});

describe('renderCandidate', () => {
  it('renders testId', () => {
    const sc = { scope: null, fragile: false, candidate: { strategy: 'testId' as const, value: 'cta' } };
    expect(renderCandidate(sc)).toBe("this.page.getByTestId('cta')");
  });

  it('renders the default attribute as getByTestId, so existing output is byte-identical', () => {
    const sc = {
      scope: null, fragile: false,
      candidate: { strategy: 'testId' as const, value: 'cta', attribute: 'data-testid' },
    };
    expect(renderCandidate(sc)).toBe("this.page.getByTestId('cta')");
  });

  it('renders a non-default attribute as an explicit attribute selector', () => {
    const sc = {
      scope: null, fragile: false,
      candidate: { strategy: 'testId' as const, value: 'cta', attribute: 'data-qa' },
    };
    // `getByTestId` would resolve against whatever the *consumer* project configured.
    // An attribute selector says what it means and is right in any project.
    expect(renderCandidate(sc)).toBe('this.page.locator(\'[data-qa="cta"]\')');
  });

  it('serializes the CSS attribute selector layer by CSSOM rules', () => {
    // Asserted against literal expected text rather than against `testIdSelector`'s own
    // output, so a regression in the CSS layer cannot hide behind both sides agreeing.
    const sel = (value: string) =>
      testIdSelector({ strategy: 'testId' as const, value, attribute: 'data-qa' });
    expect(sel('plain')).toBe('[data-qa="plain"]');
    expect(sel('a"b')).toBe('[data-qa="a\\"b"]');
    expect(sel('a\\b')).toBe('[data-qa="a\\\\b"]');
    expect(sel(']x[')).toBe('[data-qa="]x["]');
    expect(sel('a\nb')).toBe('[data-qa="a\\a b"]');
    expect(sel('a\u0001b')).toBe('[data-qa="a\\1 b"]');
    expect(sel('a\u007fb')).toBe('[data-qa="a\\7f b"]');
  });

  it('survives the CSS and TypeScript escaping layers stacked on each other', () => {
    const value = 'a"b\\c\']d\ne\u2028f\u0001g${x}`h';
    const sc = {
      scope: null, fragile: false,
      candidate: { strategy: 'testId' as const, value, attribute: 'data-qa' },
    };
    const out = renderCandidate(sc);
    expect(out).not.toMatch(/[\n\r\u2028\u2029]/);
    const prefix = 'this.page.locator(';
    expect(out.startsWith(prefix) && out.endsWith(')')).toBe(true);
    // Evaluate the emitted TypeScript string literal. What it yields must be exactly the
    // CSS selector the resolver bound with -- one escaping layer must not eat the other.
    const literal = new Function(`return ${out.slice(prefix.length, -1)};`)() as string;
    expect(literal).toBe(testIdSelector(sc.candidate));
  });

  it('renders an exact role locator', () => {
    const sc = {
      scope: null, fragile: false,
      candidate: { strategy: 'role' as const, role: 'button', name: 'Buy now', exact: true },
    };
    expect(renderCandidate(sc)).toBe("this.page.getByRole('button', { name: 'Buy now', exact: true })");
  });

  it('nests inside a landmark scope', () => {
    const sc = {
      scope: 'navigation' as const, fragile: false,
      candidate: { strategy: 'text' as const, value: 'Cart', exact: true },
    };
    expect(renderCandidate(sc))
      .toBe("this.page.getByRole('navigation').getByText('Cart', { exact: true })");
  });

  it('escapes single quotes in values', () => {
    const sc = { scope: null, fragile: false, candidate: { strategy: 'testId' as const, value: "o'brien" } };
    expect(renderCandidate(sc)).toBe("this.page.getByTestId('o\\'brien')");
  });

  it('R16: escapes line terminators to prevent syntax errors', () => {
    const sc = { scope: null, fragile: false, candidate: { strategy: 'title' as const, value: 'Foo\nBar' } };
    const out = renderCandidate(sc);
    expect(out).not.toMatch(/[\n\r]/);
    expect(out).toContain('\\n');
  });

  it('renders label locator', () => {
    const sc = { scope: null, fragile: false, candidate: { strategy: 'label' as const, value: 'Email', exact: true } };
    expect(renderCandidate(sc)).toBe("this.page.getByLabel('Email', { exact: true })");
  });

  it('renders placeholder locator', () => {
    const sc = { scope: null, fragile: false, candidate: { strategy: 'placeholder' as const, value: 'Enter name' } };
    expect(renderCandidate(sc)).toBe("this.page.getByPlaceholder('Enter name')");
  });

  it('renders altText locator', () => {
    const sc = { scope: null, fragile: false, candidate: { strategy: 'altText' as const, value: 'Logo' } };
    expect(renderCandidate(sc)).toBe("this.page.getByAltText('Logo')");
  });

  it('renders title locator', () => {
    const sc = { scope: null, fragile: false, candidate: { strategy: 'title' as const, value: 'Help' } };
    expect(renderCandidate(sc)).toBe("this.page.getByTitle('Help')");
  });
});
