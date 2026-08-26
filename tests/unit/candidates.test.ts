import { describe, it, expect } from 'vitest';
import { buildCandidates, scopeTo, parentPath } from '../../src/locator/candidates.js';
import { renderCandidate } from '../../src/locator/render.js';
import type { ElementRecord } from '../../src/types.js';

const rec = (over: Partial<ElementRecord>): ElementRecord => ({
  tag: 'button', role: 'button', accessibleName: null, testId: null, domId: null,
  ariaLabel: null, placeholder: null, labelText: null, altText: null, title: null,
  text: null, landmark: null, domPath: 'body>button', structureKey: 'k',
  visible: true, kind: 'interactive', ...over,
});

describe('buildCandidates', () => {
  it('puts testId first and role second', () => {
    const c = buildCandidates(rec({ testId: 'cta', accessibleName: 'Buy' }));
    expect(c.map((x) => x.candidate.strategy).slice(0, 2)).toEqual(['testId', 'role']);
  });

  it('marks the css fallback fragile and places it last', () => {
    const c = buildCandidates(rec({ testId: 'cta' }));
    expect(c.at(-1)!.candidate.strategy).toBe('css');
    expect(c.at(-1)!.fragile).toBe(true);
  });

  it('omits text candidates for non-heading kinds', () => {
    const c = buildCandidates(rec({ text: 'Hello', kind: 'interactive' }));
    expect(c.some((x) => x.candidate.strategy === 'text')).toBe(false);
  });

  it('allows text candidates for headings', () => {
    const c = buildCandidates(rec({ role: 'heading', text: 'Our Range', kind: 'heading' }));
    expect(c.some((x) => x.candidate.strategy === 'text')).toBe(true);
  });

  it('never emits a role candidate without an accessible name', () => {
    const c = buildCandidates(rec({ domId: 'x' }));
    expect(c.some((x) => x.candidate.strategy === 'role')).toBe(false);
  });

  it('two structurally identical siblings produce the identical css candidate value', () => {
    const sibling1 = buildCandidates(rec({
      domPath: 'body > main:nth-child(1) > button:nth-child(1)',
      tag: 'button',
    }));
    const sibling2 = buildCandidates(rec({
      domPath: 'body > main:nth-child(1) > button:nth-child(2)',
      tag: 'button',
    }));

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
