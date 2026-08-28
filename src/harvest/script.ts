// SPDX-License-Identifier: Apache-2.0
import type { ElementRecord } from '../types.js';

export function harvestInPage(testIdAttribute: string): ElementRecord[] {
  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=combobox],[role=switch]';
  const HEADINGS = 'h1,h2,h3,h4,h5,h6,[role=heading]';
  const TEXTISH = `[role=status],[role=alert],[${testIdAttribute}]`;
  const LANDMARKS: Record<string, string> = {
    HEADER: 'banner', NAV: 'navigation', MAIN: 'main', FOOTER: 'contentinfo', ASIDE: 'complementary',
  };
  const LANDMARK_ROLES = ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search'];

  // Measured against the installed Playwright (1.62.1), not recalled from the ARIA spec:
  // `<header>`/`<footer>` are banner/contentinfo only when they are NOT inside sectioning
  // content, where "sectioning content" is an article/aside/main/nav/section element or an
  // element whose explicit role is article/complementary/main/navigation/region. A plain
  // `<div>`, or one with `role="generic"`/`"group"`/`"presentation"`, does not scope them.
  // `<aside>`, `<nav>` and `<main>` are landmarks unconditionally on this version --
  // Playwright does not implement the newer "a nested `<aside>` needs an accessible name"
  // rule -- so only header and footer are listed here. The invariant this function owes is
  // agreement with Playwright's role engine, because that engine is what `getByRole`
  // re-scoping binds against; a disagreement makes the resolver narrow to a landmark the
  // element is not in and bind somebody else's element.
  const SECTIONED_LANDMARKS: Record<string, boolean> = { HEADER: true, FOOTER: true };
  const SECTIONING = 'article,aside,main,nav,section,'
    + '[role=article],[role=complementary],[role=main],[role=navigation],[role=region]';

  const IMPLICIT_ROLE: Record<string, string> = {
    A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    IMG: 'img', SUMMARY: 'button', H1: 'heading', H2: 'heading', H3: 'heading',
    H4: 'heading', H5: 'heading', H6: 'heading',
  };

  const INPUT_ROLE: Record<string, string> = {
    text: 'textbox', email: 'textbox', password: 'textbox', tel: 'textbox',
    url: 'textbox', number: 'textbox', search: 'searchbox',
    checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button',
  };

  function roleOf(el: Element): string | null {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    if (el.tagName === 'INPUT') {
      return INPUT_ROLE[(el as HTMLInputElement).type] ?? 'textbox';
    }
    if (el.tagName === 'A' && !el.getAttribute('href')) return null;
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

  function landmarkOf(el: Element): string | null {
    let node: Element | null = el.parentElement;
    while (node) {
      const explicit = node.getAttribute('role');
      if (explicit) {
        // An explicit role always wins over the tag's implicit one -- measured: a
        // `<nav role="presentation">` is not a navigation landmark to Playwright, and a
        // `<footer role="contentinfo">` inside an `<article>` still is one.
        if (LANDMARK_ROLES.includes(explicit)) return explicit;
      } else {
        const implicit = LANDMARKS[node.tagName];
        if (implicit && !(SECTIONED_LANDMARKS[node.tagName] && node.parentElement?.closest(SECTIONING))) {
          return implicit;
        }
      }
      node = node.parentElement;
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
