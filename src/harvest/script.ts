// SPDX-License-Identifier: Apache-2.0
import type { ElementRecord } from '../types.js';

export function harvestInPage(testIdAttribute: string): ElementRecord[] {
  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=combobox],[role=switch]';
  const HEADINGS = 'h1,h2,h3,h4,h5,h6,[role=heading]';
  const TEXTISH = `[role=status],[role=alert],[${testIdAttribute}]`;
  const LANDMARK_ROLES = ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search'];

  // The invariant this file owes is agreement with Playwright's role engine, because that
  // engine is what the resolver's `page.getByRole(landmark)` re-scoping binds against. A
  // disagreement in one direction narrows to a landmark the element is not in and binds
  // somebody else's element; a disagreement in the other silently costs a resolvable
  // element. So the rules below are transcribed from `roleUtils.ts` in the installed
  // playwright-core (1.62.1) rather than recalled from the ARIA spec, and
  // `tests/browser/landmark.spec.ts` re-derives them by asking the live `getByRole`.
  //
  // Playwright's own `validRoles`, verbatim. A `role` token that is not in this set is not
  // a role to Playwright at all -- `<nav role="garbage">` and `<nav role="NAV">` both fall
  // straight back to the tag's implicit role. Treating any non-empty `role` as
  // authoritative loses every one of those landmarks.
  const VALID_ARIA_ROLES = new Set([
    'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button',
    'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary',
    'contentinfo', 'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis',
    'feed', 'figure', 'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img',
    'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'mark', 'marquee',
    'math', 'meter', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'navigation', 'none', 'note', 'option', 'paragraph', 'presentation', 'progressbar',
    'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search',
    'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'strong', 'subscript',
    'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox',
    'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
  ]);

  // Playwright's `kGlobalAriaAttributes`, minus its per-role prohibition lists. Those lists
  // only ever prohibit `aria-label`/`aria-labelledby`/`aria-roledescription` for roles like
  // `generic` and `presentation`; no landmark role appears in any of them, and neither does
  // the empty role, so within this function the prohibitions can never change the answer.
  const GLOBAL_ARIA_ATTRIBUTES = [
    'aria-atomic', 'aria-busy', 'aria-controls', 'aria-current', 'aria-describedby',
    'aria-details', 'aria-dropeffect', 'aria-flowto', 'aria-grabbed', 'aria-hidden',
    'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-live', 'aria-owns',
    'aria-relevant', 'aria-roledescription',
  ];

  // Playwright's `kAncestorPreventingLandmark`, verbatim. Note `:not([role])`: the
  // *presence* of a role attribute, whatever it says, disqualifies a sectioning tag from
  // suppressing a nested header/footer. `<article role="">`, `<article role="garbage">` and
  // `<section role="group">` therefore all leave a nested `<footer>` as contentinfo.
  const ANCESTOR_PREVENTING_LANDMARK = 'article:not([role]),aside:not([role]),main:not([role]),'
    + 'nav:not([role]),section:not([role]),'
    + '[role=article],[role=complementary],[role=main],[role=navigation],[role=region]';

  // `<aside>`, `<nav>`, `<main>` and `<search>` are landmarks unconditionally on this
  // version -- Playwright does not implement the newer "a nested `<aside>` needs an
  // accessible name" rule -- so only header and footer consult the selector above.
  const IMPLICIT_LANDMARK: Record<string, string> = {
    NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', SEARCH: 'search',
  };
  const SECTIONED_LANDMARK: Record<string, string> = { HEADER: 'banner', FOOTER: 'contentinfo' };

  // Rows verified against `kImplicitRoleByTagName` in the installed playwright-core
  // (1.62.1) bundle, same transcription discipline as the landmark tables above. `SECTION`
  // and `FORM` are handled separately in `roleOf` below -- Playwright only grants them
  // `region`/`form` when the element carries an explicit accessible name, which is not
  // something a flat tag map can express.
  const IMPLICIT_ROLE: Record<string, string> = {
    A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    IMG: 'img', SUMMARY: 'button', H1: 'heading', H2: 'heading', H3: 'heading',
    H4: 'heading', H5: 'heading', H6: 'heading',
    SEARCH: 'search', ARTICLE: 'article', DETAILS: 'group', PROGRESS: 'progressbar',
    METER: 'meter', OUTPUT: 'status',
  };

  const INPUT_ROLE: Record<string, string> = {
    text: 'textbox', email: 'textbox', password: 'textbox', tel: 'textbox',
    url: 'textbox', number: 'textbox', search: 'searchbox',
    checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button',
  };

  // Playwright's `hasExplicitAccessibleName`: only `aria-label`/`aria-labelledby` count,
  // never text content. This is what actually gates `SECTION`'s and `FORM`'s implicit
  // role, so it has to be checked with this exact narrow rule and not this file's own
  // broader `accessibleName()` helper (which falls back to text content and would
  // over-grant `region`/`form` to any section or form that merely contains readable text).
  function hasExplicitAccessibleName(el: Element): boolean {
    return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
  }

  // Playwright's presentational-role-conflict resolution (the aria-attribute/tabindex half
  // of it -- see the comment on `roleOf` for the natively-focusable half this deliberately
  // does not replicate). Shared between `roleOf` and `landmarkRoleOf` so the two can't
  // drift apart on what "conflicted" means.
  function hasPresentationalConflict(el: Element): boolean {
    return GLOBAL_ARIA_ATTRIBUTES.some((a) => el.hasAttribute(a))
      || !Number.isNaN(Number(String(el.getAttribute('tabindex'))));
  }

  // Same defect shape Wave 2A fixed in `landmarkOf`: an explicit `role` attribute must be
  // validated (case-sensitive, must name a real ARIA role -- `explicitRoleOf` below) before
  // being handed back, and a discarded `presentation`/`none` role must fall through to the
  // implicit-role computation rather than being returned as an invalid string or a bare
  // `null`. Presentational-role-conflict resolution is a general ARIA rule, not a
  // landmark-specific one, so it applies here too, via the shared `hasPresentationalConflict`.
  //
  // Known gap: real Playwright's conflict check also fires whenever the element is
  // natively focusable -- a bare `<button role="presentation">` with no aria-* attribute
  // and no tabindex is *still* resolved back to `button`, because buttons are focusable by
  // default (see `isFocusable`/`isNativelyFocusable` in roleUtils.ts). Replicating that
  // exactly would also mean replicating `isNativelyDisabled`'s fieldset/optgroup
  // exceptions -- more machinery than this ride-along fix is scoped for. Left as a known
  // narrowing: a natively-interactive element deliberately marked presentational/none with
  // no aria-* attribute and no tabindex can resolve to `null` here where real Playwright
  // would still resolve its implicit role. This fails closed (costs recall, not
  // correctness), consistent with this function's other failure modes.
  function roleOf(el: Element): string | null {
    const explicit = explicitRoleOf(el);
    if (explicit === 'none' || explicit === 'presentation') {
      if (!hasPresentationalConflict(el)) return null;
      // conflicted: fall through to the implicit-role computation below.
    } else if (explicit) {
      return explicit;
    }
    if (el.tagName === 'INPUT') {
      const type = (el as HTMLInputElement).type;
      // Playwright: a text-ish input wired to a <datalist> via `list` is a combobox,
      // regardless of its own type.
      if (['email', 'search', 'tel', 'text', 'url'].includes(type)) {
        const listId = el.getAttribute('list');
        const list = listId ? document.getElementById(listId) : null;
        if (list?.tagName === 'DATALIST') return 'combobox';
      }
      return INPUT_ROLE[type] ?? 'textbox';
    }
    if (el.tagName === 'A' && !el.getAttribute('href')) return null;
    if (el.tagName === 'SECTION') return hasExplicitAccessibleName(el) ? 'region' : null;
    if (el.tagName === 'FORM') return hasExplicitAccessibleName(el) ? 'form' : null;
    return IMPLICIT_ROLE[el.tagName] ?? null;
  }

  function isVisible(el: Element): boolean {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0 && el.tagName !== 'INPUT') return false;
    return true;
  }

  function labelFor(el: Element): string | null {
    const id = el.getAttribute('id');
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab?.textContent?.trim()) return lab.textContent.trim();
    }
    const wrapper = el.closest('label');
    return wrapper?.textContent?.trim() || null;
  }

  function accessibleName(el: Element): string | null {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/)
        .map((i) => document.getElementById(i)?.textContent?.trim() ?? '')
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    const aria = el.getAttribute('aria-label')?.trim();
    if (aria) return aria;
    const label = labelFor(el);
    if (label) return label;
    const alt = el.getAttribute('alt')?.trim();
    if (alt) return alt;
    const value = (el as HTMLInputElement).value;
    if (el.tagName === 'INPUT' && INPUT_ROLE[(el as HTMLInputElement).type] === 'button' && value) return value;
    const text = el.textContent?.replace(/\s+/g, ' ').trim();
    return text || null;
  }

  // Playwright's `getExplicitAriaRole`: split the attribute on a literal space (NOT on
  // /\s+/), trim each token, take the first that names a real role. A tab-separated
  // `role="foo\tmain"` is one token to Playwright and names no role; splitting on /\s+/
  // here would claim a landmark the role engine does not see.
  function explicitRoleOf(el: Element): string | null {
    for (const raw of (el.getAttribute('role') ?? '').split(' ')) {
      const token = raw.trim();
      if (VALID_ARIA_ROLES.has(token)) return token;
    }
    return null;
  }

  function implicitLandmarkOf(el: Element): string | null {
    const sectioned = SECTIONED_LANDMARK[el.tagName];
    if (sectioned) return el.closest(ANCESTOR_PREVENTING_LANDMARK) ? null : sectioned;
    return IMPLICIT_LANDMARK[el.tagName] ?? null;
  }

  // Playwright's `computeAriaRole`, narrowed to the landmark question. Only the landmark
  // subset of implicit roles is modelled, because a non-landmark answer and `null` are the
  // same answer to the caller: keep walking up.
  function landmarkRoleOf(el: Element): string | null {
    const explicit = explicitRoleOf(el);
    if (!explicit) return implicitLandmarkOf(el);
    if (explicit === 'none' || explicit === 'presentation') {
      // Presentational-role-conflict resolution (shared with `roleOf` via
      // `hasPresentationalConflict`): `role="presentation"` is discarded, and the implicit
      // role reinstated, when the element carries a global aria-* attribute or a tabindex.
      // Playwright's `isFocusable` also admits natively-focusable tags, but none of those
      // (button/details/select/textarea/a[href]/area[href]/input) has a landmark as its
      // implicit role, so that arm can never change a landmark answer -- see `roleOf`'s own
      // comment for why the general function does not get to make the same simplification.
      return hasPresentationalConflict(el) ? implicitLandmarkOf(el) : null;
    }
    return explicit;
  }

  function landmarkOf(el: Element): string | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const role = landmarkRoleOf(node);
      if (!role || !LANDMARK_ROLES.includes(role)) continue;
      // `getByRole` only matches elements in the accessibility tree, so a landmark hidden
      // by `aria-hidden` is not addressable and scoping to it would find nothing. Skip it
      // and keep climbing: an outer landmark above the hidden subtree is still addressable,
      // and `getByTestId`/`getByText` under it will still reach the element.
      if (node.closest('[aria-hidden="true"]')) continue;
      return role;
    }
    return null;
  }

  function domPath(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.tagName !== 'BODY') {
      const parent: Element | null = node.parentElement;
      if (!parent) break;
      const index = [...parent.children].indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parent;
    }
    return 'body > ' + parts.join(' > ');
  }

  function structureKey(el: Element): string {
    const classes = [...el.classList].sort().join('.');
    const parent = el.parentElement;
    const parentClasses = parent ? [...parent.classList].sort().join('.') : '';
    return `${parent?.tagName ?? ''}.${parentClasses}>${el.tagName}.${classes}`;
  }

  const seen = new Set<Element>();
  const out: ElementRecord[] = [];

  const all = [...document.querySelectorAll(`${INTERACTIVE},${HEADINGS},${TEXTISH}`)];

  for (const el of all) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!isVisible(el)) continue;

    const role = roleOf(el);
    const testId = el.getAttribute(testIdAttribute);
    const matchesInteractive = el.matches(INTERACTIVE);
    const matchesHeading = el.matches(HEADINGS);

    let kind: ElementRecord['kind'];
    if (matchesInteractive) kind = 'interactive';
    else if (matchesHeading) kind = 'heading';
    else kind = 'text';

    // A text element earns its place only if it has a stable handle of its own.
    if (kind === 'text' && !testId && role !== 'status' && role !== 'alert') continue;

    out.push({
      tag: el.tagName.toLowerCase(),
      role,
      accessibleName: accessibleName(el),
      testId,
      domId: el.getAttribute('id'),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      labelText: labelFor(el),
      altText: el.getAttribute('alt'),
      title: el.getAttribute('title'),
      text: el.textContent?.replace(/\s+/g, ' ').trim() || null,
      landmark: landmarkOf(el) as ElementRecord['landmark'],
      domPath: domPath(el),
      structureKey: structureKey(el),
      visible: true,
      kind,
    });
  }

  return out;
}
