import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { actionNameFor, planActions, resolveMemberNames, RESERVED_MEMBERS } from '../../src/name/members.js';
import { buildNotebook, buildPageIR } from '../../src/ir/build.js';
import { detectCollections } from '../../src/resolve/collections.js';
import { deterministicName } from '../../src/name/deterministic.js';
import { emitBase } from '../../src/emit/base.js';
import { writeGenerated } from '../../src/io/writeOutput.js';
import type { ElementRecord, IRCollection, IRElement, Notebook, PageIR } from '../../src/types.js';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '..', '..');

// ---------------------------------------------------------------------------
// Verification approach
//
// `typecheck` runs the real `tsc --noEmit` over everything `writeGenerated` emits --
// generated base, hand-owned subclass and smoke spec -- rather than a structural stand-in.
// It was cheap enough to keep honest: ~1s per invocation, and `@playwright/test` resolves
// through a `paths` mapping back into this repo's node_modules, so no fixture packages are
// needed. `declaredMembers` is kept alongside it as a fast assertion that names a
// duplicate directly instead of leaving it as a tsc diagnostic to read.
// ---------------------------------------------------------------------------

async function typecheck(nb: Notebook): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pb-tsc-'));
  try {
    await mkdir(dir, { recursive: true });
    await writeGenerated(dir, nb);
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
          strict: true, noEmit: true, skipLibCheck: true, types: [],
          baseUrl: '.',
          paths: {
            '@playwright/test': [join(repoRoot, 'node_modules', '@playwright', 'test').replace(/\\/g, '/')],
          },
        },
        include: ['**/*.ts'],
      }),
      'utf8',
    );
    try {
      await execFileAsync(
        process.execPath,
        [join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', dir],
        { cwd: dir },
      );
      return '';
    } catch (err) {
      return String((err as { stdout?: string }).stdout ?? err);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Every member the generated class declares: `constructor(...)`, `get x()`, `xAt(...)`,
 * `async clickX(...)`. Duplicates here are exactly the TS2300/TS2393/TS1341 family.
 */
function declaredMembers(src: string): string[] {
  return src
    .split('\n')
    .map((line) => /^ {2}(?:get\s+|async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]);
}

function duplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const n of names) (seen.has(n) ? dupes : seen).add(n);
  return [...dupes].sort();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const record = (over: Partial<ElementRecord> = {}): ElementRecord => ({
  tag: 'button', role: 'button', accessibleName: null, testId: null, domId: null,
  ariaLabel: null, placeholder: null, labelText: null, altText: null, title: null,
  text: null, landmark: 'main', domPath: 'body > button', structureKey: 'BODY>BUTTON',
  visible: true, kind: 'interactive', ...over,
});

const el = (over: Partial<IRElement> = {}): IRElement => ({
  id: 'el_' + (over.name ?? 'x'), name: 'thingButton', nameSource: 'deterministic',
  kind: 'interactive', role: 'button', accessibleName: null, group: 'main',
  status: 'resolved',
  locator: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'thing' } },
  rejected: [], observed: record(), ...over,
});

const buildPage = (
  elements: IRElement[],
  collections: IRCollection[] = [],
  routeTemplate = '/demo',
): PageIR =>
  buildPageIR({
    group: {
      routeTemplate,
      representativeUrl: `https://s.test${routeTemplate}`,
      sampleUrls: [`https://s.test${routeTemplate}`],
    },
    pageFingerprint: 'pg_demo',
    elements,
    collections,
  });

const notebookOf = (...pages: PageIR[]): Notebook =>
  buildNotebook('https://s.test', pages, '2026-01-01T00:00:00Z');

// A <nav> of three plain links and a <footer> of three plain links: two sibling groups
// that both fall through `collectionName` to `camelise(tag)` -> "a".
function navFooterLinkRecords(): ElementRecord[] {
  const link = (container: string, structureKey: string, n: number, label: string): ElementRecord =>
    record({
      tag: 'a', role: 'link', kind: 'interactive', accessibleName: label, text: label,
      landmark: container === 'nav' ? 'navigation' : 'contentinfo',
      domPath: `body > ${container}:nth-child(1) > a:nth-child(${n})`,
      structureKey,
    });
  return [
    link('nav', 'NAV>A', 1, 'Home'),
    link('nav', 'NAV>A', 2, 'Shop'),
    link('nav', 'NAV>A', 3, 'Blog'),
    link('footer', 'FOOTER>A', 1, 'Terms'),
    link('footer', 'FOOTER>A', 2, 'Privacy'),
    link('footer', 'FOOTER>A', 3, 'Contact'),
  ];
}

// ---------------------------------------------------------------------------

describe('actionNameFor', () => {
  it('returns null for non-interactive elements', () => {
    expect(actionNameFor(el({ kind: 'text' }))).toBeNull();
    expect(actionNameFor(el({ kind: 'heading' }))).toBeNull();
  });

  it.each([
    ['textbox', 'fill'],
    ['searchbox', 'fill'],
    ['checkbox', 'check'],
    ['radio', 'check'],
    ['button', 'click'],
    ['link', 'click'],
    [null, 'click'],
  ])('role %s picks the %s verb', (role, verb) => {
    expect(actionNameFor(el({ role }))!.verb).toBe(verb);
  });

  it.each([
    ['viewDetailsButton', 'ViewDetails'],
    ['viewDetailsLink', 'ViewDetails'],
    ['emailInput', 'Email'],
    ['countrySelect', 'Country'],
    ['termsCheckbox', 'Terms'],
    ['sizeRadio', 'Size'],
    ['homeTab', 'Home'],
    ['copyMenuItem', 'Copy'],
    ['redOption', 'Red'],
    ['savedCart', 'SavedCart'],
  ])('strips the trailing role suffix of %s', (name, stem) => {
    const action = actionNameFor(el({ name }))!;
    expect(action.stem).toBe(stem);
    expect(action.full).toBe(name[0].toUpperCase() + name.slice(1));
  });
});

describe('resolveMemberNames: duplicate collection accessors', () => {
  it('a nav and a footer of plain links really do both name their collection "a"', () => {
    const { collections } = detectCollections(navFooterLinkRecords());
    expect(collections).toHaveLength(2);
    expect(collections.map((c) => c.name)).toEqual(['a', 'a']);
  });

  it('renames the second so aAt/aByText/aCount are not declared twice', () => {
    const { collections } = detectCollections(navFooterLinkRecords());
    const page = buildPage([], collections);
    expect(page.collections.map((c) => c.name)).toEqual(['a', 'a2']);
    expect(duplicates(declaredMembers(emitBase(page)))).toEqual([]);
  });
});

describe('resolveMemberNames: collection accessor vs element getter', () => {
  it('moves the collection aside for an element already named itemCount', () => {
    const page = buildPage(
      [el({ id: 'el_1', name: 'itemCount', kind: 'text', role: null })],
      [{
        id: 'co_1', name: 'item', count: 3,
        item: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'item' } },
      }],
    );
    expect(page.elements[0].name).toBe('itemCount');
    expect(page.collections[0].name).toBe('item2');
    expect(duplicates(declaredMembers(emitBase(page)))).toEqual([]);
  });
});

describe('resolveMemberNames: reserved class members', () => {
  it('renames an element named constructor', () => {
    // Reachable: <div role="switch" aria-label="constructor"> -- role `switch` has no
    // ROLE_SUFFIX entry, so no suffix is appended and the bare name survives.
    const page = buildPage([el({ id: 'el_1', name: 'constructor', role: 'switch' })]);
    expect(page.elements[0].name).toBe('constructorElement');
    expect(emitBase(page)).not.toContain('get constructor(');
  });

  // Both names below come out of the real deterministicName path: role `switch` has no
  // ROLE_SUFFIX entry, so aria-label="url" yields `url` and aria-label="URL element"
  // yields `urlElement`.
  it('both names in the incumbent case are what deterministicName actually produces', () => {
    const sw = (ariaLabel: string) => record({ tag: 'div', role: 'switch', ariaLabel, kind: 'interactive' });
    expect(deterministicName(sw('url')).name).toBe('url');
    expect(deterministicName(sw('URL element')).name).toBe('urlElement');
  });

  it('leaves the incumbent urlElement alone and pushes the reserved rewrite past it', () => {
    // A reserved rewrite is a newcomer to the name it lands on. Taking it from the element
    // that legitimately holds it would rename a getter a user's subclass already calls.
    const page = buildPage([
      el({ id: 'el_1', name: 'urlElement', role: 'switch' }),
      el({ id: 'el_2', name: 'url', role: 'switch' }),
    ]);
    expect(page.elements.map((e) => `${e.id}:${e.name}`)).toEqual(['el_1:urlElement', 'el_2:urlElement2']);
  });

  it('gives the reserved element the plain rewrite when there is no incumbent', () => {
    const page = buildPage([el({ id: 'el_2', name: 'url', role: 'switch' })]);
    expect(page.elements.map((e) => e.name)).toEqual(['urlElement']);
  });

  it('adding a reserved-named element does not rename the incumbent', () => {
    const before = buildPage([el({ id: 'el_1', name: 'urlElement', role: 'switch' })]);
    const after = buildPage([
      el({ id: 'el_1', name: 'urlElement', role: 'switch' }),
      el({ id: 'el_2', name: 'url', role: 'switch' }),
    ]);
    const nameOf = (p: PageIR, id: string) => p.elements.find((e) => e.id === id)!.name;
    expect(nameOf(after, 'el_1')).toBe(nameOf(before, 'el_1'));
  });

  it.each(['constructor', 'page', 'route', 'url', 'toString'])('never emits a getter named %s', (name) => {
    const page = buildPage([el({ id: 'el_1', name, role: 'switch' })]);
    expect(page.elements[0].name).toBe(`${name}Element`);
    expect(RESERVED_MEMBERS.has(page.elements[0].name)).toBe(false);
  });
});

describe('planActions: action method vs element getter', () => {
  it('falls back to the full form when a getter already owns the short action name', () => {
    const page = buildPage([
      el({ id: 'el_1', name: 'clickHere', kind: 'text', role: null, status: 'resolved' }),
      el({ id: 'el_2', name: 'hereButton', role: 'button' }),
    ]);
    const actions = planActions(page);
    expect(actions.map((a) => a.method)).toEqual(['clickHereButton']);
    expect(duplicates(declaredMembers(emitBase(page)))).toEqual([]);
  });

  it('sends every contestant to the full form, so none silently wins the short name', () => {
    const page = buildPage([
      el({ id: 'el_1', name: 'viewDetailsButton', role: 'button' }),
      el({ id: 'el_2', name: 'viewDetailsLink', role: 'link' }),
    ]);
    expect(planActions(page).map((a) => a.method)).toEqual(['clickViewDetailsButton', 'clickViewDetailsLink']);
  });

  it('keeps the short name when nothing contests it', () => {
    const page = buildPage([el({ id: 'el_1', name: 'addToCartButton', role: 'button' })]);
    expect(planActions(page).map((a) => a.method)).toEqual(['clickAddToCart']);
  });

  it('yields to a collection accessor too', () => {
    const page = buildPage(
      [el({ id: 'el_1', name: 'saveButton', role: 'button' })],
      [{
        id: 'co_1', name: 'clickSaveBy', count: 3,
        item: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'row' } },
      }],
    );
    // The collection contributes `clickSaveByText`, which is exactly the action name a
    // `saveByTextButton`-style element would want; here it is the plain `clickSave` that
    // must survive untouched.
    expect(planActions(page).map((a) => a.method)).toEqual(['clickSave']);
    expect(duplicates(declaredMembers(emitBase(page)))).toEqual([]);
  });
});

describe('resolveMemberNames: idempotency, determinism and churn', () => {
  const messy = (): PageIR => ({
    routeTemplate: '/demo',
    representativeUrl: 'https://s.test/demo',
    sampleUrls: [],
    className: 'DemoPage',
    pageFingerprint: 'pg_demo',
    elements: [
      el({ id: 'el_1', name: 'constructor', role: 'switch' }),
      el({ id: 'el_2', name: 'itemCount', kind: 'text', role: null }),
      el({ id: 'el_3', name: 'page', role: 'switch' }),
      el({ id: 'el_4', name: 'hereButton', role: 'button' }),
      el({ id: 'el_5', name: 'clickHere', kind: 'text', role: null }),
    ],
    collections: [
      { id: 'co_1', name: 'item', count: 3, item: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'i' } } },
      { id: 'co_2', name: 'a', count: 3, item: { scope: null, fragile: false, candidate: { strategy: 'css', value: 'nav > a' } } },
      { id: 'co_3', name: 'a', count: 3, item: { scope: null, fragile: false, candidate: { strategy: 'css', value: 'footer > a' } } },
    ],
  });

  it('is idempotent', () => {
    const once = resolveMemberNames(messy());
    const twice = resolveMemberNames(once);
    expect(twice).toEqual(once);
  });

  it('is independent of the input array order', () => {
    const shuffled = messy();
    shuffled.elements = [...shuffled.elements].reverse();
    shuffled.collections = [...shuffled.collections].reverse();
    expect(resolveMemberNames(shuffled)).toEqual(resolveMemberNames(messy()));
  });

  it('does not mutate its input', () => {
    const input = messy();
    const before = JSON.parse(JSON.stringify(input));
    resolveMemberNames(input);
    expect(input).toEqual(before);
  });

  it('renames nothing that is not colliding', () => {
    const clean = buildPage(
      [
        el({ id: 'el_1', name: 'addToCartButton', role: 'button' }),
        el({ id: 'el_2', name: 'emailInput', role: 'textbox' }),
        el({ id: 'el_3', name: 'priceText', kind: 'text', role: null }),
      ],
      [{
        id: 'co_1', name: 'productCard', count: 12,
        item: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'product-card' } },
      }],
    );
    expect(clean.elements.map((e) => e.name)).toEqual(['addToCartButton', 'emailInput', 'priceText']);
    expect(clean.collections.map((c) => c.name)).toEqual(['productCard']);
  });
});

describe('emitted output type-checks', () => {
  it('compiles a page carrying every 1.1 collision trigger at once', async () => {
    const { collections } = detectCollections(navFooterLinkRecords());
    const page = buildPage(
      [
        el({ id: 'el_1', name: 'constructor', role: 'switch' }),
        el({ id: 'el_2', name: 'itemCount', kind: 'text', role: null }),
        el({ id: 'el_3', name: 'clickHere', kind: 'text', role: null }),
        el({ id: 'el_4', name: 'hereButton', role: 'button' }),
        el({ id: 'el_5', name: 'viewDetailsButton', role: 'button' }),
        el({ id: 'el_6', name: 'viewDetailsLink', role: 'link' }),
        el({ id: 'el_7', name: 'emailInput', role: 'textbox' }),
        el({ id: 'el_8', name: 'termsCheckbox', role: 'checkbox' }),
      ],
      [
        ...collections,
        { id: 'co_x', name: 'item', count: 3, item: { scope: null, fragile: false, candidate: { strategy: 'testId', value: 'i' } } },
      ],
    );
    expect(duplicates(declaredMembers(emitBase(page)))).toEqual([]);
    expect(await typecheck(notebookOf(page))).toBe('');
  }, 60_000);

  it('compiles a route and url containing an apostrophe', async () => {
    const page = buildPage(
      [el({ id: 'el_1', name: 'menuButton', role: 'button' })],
      [],
      "/o'brien",
    );
    const src = emitBase(page);
    expect(src).toContain("static readonly route = '/o\\'brien';");
    expect(src).toContain("static readonly url = 'https://s.test/o\\'brien';");
    expect(await typecheck(notebookOf(page))).toBe('');
  }, 60_000);

  it('compiles routes whose class names needed sanitising', async () => {
    const pages = ['/about.html', '/2024/spring-sale', "/o'brien", '/a+b', '/caf%C3%A9/menu']
      .map((route) => buildPage([el({ id: 'el_1', name: 'menuButton', role: 'button' })], [], route));
    expect(await typecheck(notebookOf(...pages))).toBe('');
  }, 60_000);
});
