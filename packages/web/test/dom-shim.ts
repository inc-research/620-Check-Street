// SPDX-License-Identifier: MIT
//
// Vendored verbatim from Second Floor: packages/web/test/dom-shim.ts
// Do not edit in place (SF-17). Changes belong in a new Third Floor module.
// Verified byte-identical by scripts/check-vendored.mjs.
//
// ---- vendored body below; do not edit (SF-17) ----
// SPDX-License-Identifier: MIT
//
// Vendored verbatim from First Floor: packages/web/test/dom-shim.ts
// Do not edit in place (SF-17). Changes belong in a new Second Floor module.
// Verified byte-identical by scripts/check-vendored.mjs.
//
// ---- vendored body below; do not edit (SF-17) ----
// SPDX-License-Identifier: MIT

/**
 * A minimal DOM, enough to render and drive the page's views in Node.
 *
 * This exists because the page's job is to render eleven sections of a report
 * without throwing on the awkward cases — a structure with no held asset, a
 * blocked figure, a missing composition — and that is worth checking on every
 * commit rather than by opening a browser. It implements only what the views
 * actually touch, and it is a test fixture, not a DOM implementation.
 */

interface Listener {
  (event: { type: string; target: FakeElement }): void;
}

export class FakeNode {
  parent: FakeElement | null = null;
  get textContent(): string {
    return '';
  }
}

export class FakeText extends FakeNode {
  // Written out rather than as a parameter property: Node's type-stripping
  // loader is strip-only and cannot synthesise the assignment.
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
  override get textContent(): string {
    return this.data;
  }
}

export class FakeElement extends FakeNode {
  childNodes: FakeNode[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  style: Record<string, string> = {};
  value = '';
  disabled = false;
  files: unknown[] | null = null;

  tagName: string;
  constructor(tagName: string) {
    super();
    this.tagName = tagName;
  }

  appendChild<T extends FakeNode>(node: T): T {
    node.parent = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node: FakeNode): void {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parent = null;
  }

  remove(): void {
    this.parent?.removeChild(this);
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    // A browser seeds the `value` property from the attribute, and view code
    // legitimately relies on that for pre-filled date and number inputs. Without
    // this the shim reads them back as empty and the tests would be checking a
    // behaviour the real page does not have.
    if (name === 'value') this.value = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, target: this });
  }

  click(): void {
    this.dispatch('click');
  }

  select(): void {}

  override get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    this.childNodes = [];
    if (v !== '') this.appendChild(new FakeText(v));
  }

  /** Depth-first walk, for assertions. */
  *walk(): Generator<FakeElement> {
    yield this;
    for (const c of this.childNodes) {
      if (c instanceof FakeElement) yield* c.walk();
    }
  }

  findAll(tagName: string): FakeElement[] {
    return [...this.walk()].filter((e) => e.tagName === tagName);
  }

  /** All elements carrying a given class token. */
  findByClass(cls: string): FakeElement[] {
    return [...this.walk()].filter((e) => (e.getAttribute('class') ?? '').split(/\s+/).includes(cls));
  }
}

export interface InstalledDom {
  root: FakeElement;
  uninstall: () => void;
}

/** Install the shim onto globalThis for the duration of a test. */
export function installDom(): InstalledDom {
  const root = new FakeElement('div');
  root.setAttribute('id', 'app');

  const document = {
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (data: string) => new FakeText(data),
    getElementById: (id: string) => (id === 'app' ? root : null),
    body: new FakeElement('body'),
    execCommand: () => true,
  };

  // `navigator` is an accessor on globalThis in modern Node, so plain
  // assignment throws. defineProperty covers both cases and lets uninstall put
  // the original descriptor back exactly as it was.
  const names = ['document', 'window', 'navigator'] as const;
  const saved = new Map<string, PropertyDescriptor | undefined>(
    names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]),
  );

  const set = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  };

  set('document', document);
  set('window', { scrollTo: () => {} });
  // No clipboard and no blob URLs: the tests never exercise them, and stubbing
  // them silently would hide a view that had started depending on one.
  set('navigator', {});

  return {
    root,
    uninstall: () => {
      for (const name of names) {
        const descriptor = saved.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}
