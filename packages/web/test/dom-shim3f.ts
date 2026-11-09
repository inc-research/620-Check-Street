// SPDX-License-Identifier: MIT
//
// Third Floor's extension to the vendored test DOM (dom-shim.ts is verbatim and
// never edited in place, SF-17). The selected reports (3F D-25) draw SVG and look
// up their tooltip by class, so this adds `createElementNS` and a one-class
// `querySelector`, and makes any use of `innerHTML` fail the test: every text on
// the page goes through textContent.

import { FakeElement, installDom as vendoredInstall, type InstalledDom } from './dom-shim.ts';

type Patched = FakeElement & { querySelector?: unknown };

export function installDom(): InstalledDom {
  const installed = vendoredInstall();
  const doc = (globalThis as unknown as { document: Record<string, unknown> }).document;
  doc['createElementNS'] = (_ns: string, tag: string) => new FakeElement(tag);

  const proto = FakeElement.prototype as Patched;
  const had = Object.getOwnPropertyDescriptor(proto, 'querySelector');
  const hadInner = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
  Object.defineProperty(proto, 'querySelector', {
    configurable: true,
    value(this: FakeElement, selector: string) {
      if (!selector.startsWith('.')) throw new Error(`the shim only answers .class selectors, not ${selector}`);
      return this.findByClass(selector.slice(1)).find((e) => e !== this) ?? null;
    },
  });
  Object.defineProperty(proto, 'innerHTML', {
    configurable: true,
    set() {
      throw new Error('innerHTML was used; text must go through textContent');
    },
  });

  return {
    root: installed.root,
    uninstall: () => {
      installed.uninstall();
      if (had) Object.defineProperty(proto, 'querySelector', had); else delete (proto as Record<string, unknown>)['querySelector'];
      if (hadInner) Object.defineProperty(proto, 'innerHTML', hadInner); else delete (proto as Record<string, unknown>)['innerHTML'];
    },
  };
}
