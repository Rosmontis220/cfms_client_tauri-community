// @vitest-environment jsdom
//
// Drives the real built 小工具 plugin page through the host's own mount path.
//
// This is the test that answers "can a user actually install a plugin and use
// it": it reads the artifact `pnpm plugin:build tools` produces, mounts it the
// way the host does, and then operates the UI — typing into a tool, pressing
// its button, and checking the answer. A regression in the page contract, the
// mount, or the tool logic all land here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createComExtPageHost } from '$lib/com-ext-page-host';

const pluginPage = resolve('plugins/tools/dist/pages/tools.html');

/// Mount the built page the way `ComExtAppFrame` mounts a plugin page.
function mountPluginPage(html: string, pluginId: string): ShadowRoot {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts: string[] = [];
  for (const script of parsed.querySelectorAll('script')) {
    scripts.push(script.textContent ?? '');
    script.remove();
  }

  const fragment = document.createDocumentFragment();
  for (const node of parsed.head.childNodes) fragment.append(node.cloneNode(true));
  for (const node of parsed.body.childNodes) fragment.append(node.cloneNode(true));
  shadow.append(fragment);

  for (const code of scripts) {
    new Function('root', 'pluginId', 'host', code)(shadow, pluginId, createComExtPageHost(pluginId));
  }
  return shadow;
}

// The artifact is not committed, so `vitest.global-setup.ts` builds it before
// the suite runs. Reading it unconditionally makes a missing build a failure
// rather than a silently skipped — and therefore green — test.
describe('built 小工具 plugin page', () => {
  const html = readFileSync(pluginPage, 'utf8');

  it('renders a tab per tool', () => {
    const shadow = mountPluginPage(html, 'org.cfms.tools');

    const tabs = shadow.querySelectorAll('[data-role="tabs"] [role="tab"]');
    // 14 cipher/encoding tools plus the matrix panel.
    expect(tabs.length).toBe(15);
    expect(shadow.querySelector('[data-role="title"]')?.textContent).toContain('小工具');
  });

  it('computes an Atbash cipher, which needs no key', () => {
    const shadow = mountPluginPage(html, 'org.cfms.tools');

    activate(shadow, 'atbash');
    setInput(shadow, 'ABC');
    press(shadow, 'encode');

    expect(outputOf(shadow)).toBe('ZYX');
  });

  it('round-trips a Caesar cipher with its key', () => {
    const shadow = mountPluginPage(html, 'org.cfms.tools');

    activate(shadow, 'caesar');
    setInput(shadow, 'HELLO');
    setKey(shadow, '3');
    press(shadow, 'encode');
    expect(outputOf(shadow)).toBe('KHOOR');

    setInput(shadow, 'KHOOR');
    press(shadow, 'decode');
    expect(outputOf(shadow)).toBe('HELLO');
  });

  it('round-trips Base64', () => {
    const shadow = mountPluginPage(html, 'org.cfms.tools');

    activate(shadow, 'base');
    setInput(shadow, 'CFMS');
    press(shadow, 'encode');
    expect(outputOf(shadow)).toBe('Q0ZNUw==');

    setInput(shadow, outputOf(shadow));
    press(shadow, 'decode');
    expect(outputOf(shadow)).toBe('CFMS');
  });

  it('computes a SHA-256, a tool with no decode direction', () => {
    const shadow = mountPluginPage(html, 'org.cfms.tools');

    activate(shadow, 'sha256');
    setInput(shadow, 'abc');
    press(shadow, 'compute');

    expect(outputOf(shadow)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('surfaces a bad key as a message instead of throwing out of the handler', () => {
    const shadow = mountPluginPage(html, 'org.cfms.tools');

    activate(shadow, 'caesar');
    setInput(shadow, 'HELLO');
    setKey(shadow, 'not-a-number');
    press(shadow, 'encode');

    // Whatever the wording, the failure must be visible in the panel.
    const panel = activePanel(shadow);
    expect(panel.textContent ?? '').toMatch(/[^\s]/);
    expect(panel.querySelector('[data-role="error"]')?.textContent).toBeTruthy();
  });

  it('switches panels without losing what another panel holds', () => {
    const shadow = mountPluginPage(html, 'org.cfms.tools');

    activate(shadow, 'atbash');
    setInput(shadow, 'ABC');
    press(shadow, 'encode');
    expect(outputOf(shadow)).toBe('ZYX');

    activate(shadow, 'sha256');
    expect(outputOf(shadow)).toBe('');

    activate(shadow, 'atbash');
    expect(outputOf(shadow)).toBe('ZYX');
  });

  it('generates a matrix for a server key', () => {
    const shadow = mountPluginPage(html, 'org.cfms.tools');

    activate(shadow, 'matrix');
    const ip = shadow.querySelector<HTMLInputElement>('[data-role="matrix-ip"]');
    expect(ip).not.toBeNull();
    ip!.value = '127.0.0.1';

    press(shadow, 'generate');

    // The tool fills the 7x7 grid with single digits.
    const cells = shadow.querySelectorAll<HTMLInputElement>('[data-role="matrix-cell"]');
    expect(cells.length).toBe(49);
    const digits = [...cells].map((cell) => cell.value);
    expect(digits.every((value) => /^\d$/.test(value))).toBe(true);
  });
});

// -- helpers ---------------------------------------------------------------

function activate(shadow: ShadowRoot, toolId: string) {
  const tab = shadow.querySelector<HTMLElement>(`[data-role="tabs"] [data-tool="${toolId}"]`);
  expect(tab, `no tab for tool "${toolId}"`).not.toBeNull();
  tab!.click();
}

function activePanel(shadow: ShadowRoot): HTMLElement {
  const panel = shadow.querySelector<HTMLElement>('[data-role="panel"]:not([hidden])');
  expect(panel, 'no visible panel').not.toBeNull();
  return panel!;
}

function setInput(shadow: ShadowRoot, value: string) {
  const input = activePanel(shadow).querySelector<HTMLTextAreaElement>('[data-role="input"]');
  expect(input, 'the active panel has no input').not.toBeNull();
  input!.value = value;
}

function setKey(shadow: ShadowRoot, value: string) {
  const key = activePanel(shadow).querySelector<HTMLInputElement>('[data-role="key"]');
  expect(key, 'the active panel has no key field').not.toBeNull();
  key!.value = value;
}

function outputOf(shadow: ShadowRoot): string {
  const output = activePanel(shadow).querySelector<HTMLTextAreaElement>('[data-role="output"]');
  expect(output, 'the active panel has no output').not.toBeNull();
  return output!.value;
}

/// Press a named action button in the active panel. Selecting by action rather
/// than by label keeps this test out of the zh-CN wording.
function press(shadow: ShadowRoot, action: string) {
  const button = activePanel(shadow).querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  expect(button, `the active panel has no "${action}" button`).not.toBeNull();
  button!.click();
}
