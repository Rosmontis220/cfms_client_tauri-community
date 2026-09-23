// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import ComExtAppFrame from '$lib/components/ComExtAppFrame.svelte';

afterEach(cleanup);

function frame(html: string, pluginId = 'org.example.app') {
  return render(ComExtAppFrame, { html, pluginId });
}

function shadowOf(container: HTMLElement): ShadowRoot {
  const host = container.querySelector('[data-com-ext-app]');
  expect(host).not.toBeNull();
  const shadow = (host as HTMLElement).shadowRoot;
  expect(shadow).not.toBeNull();
  return shadow as ShadowRoot;
}

describe('community plugin application page', () => {
  it('mounts the page markup into a shadow root', () => {
    const { container } = frame('<!doctype html><p id="out">hello</p>');

    expect(shadowOf(container).querySelector('#out')?.textContent).toBe('hello');
    // The page's markup must not join the app's own document.
    expect(container.querySelector('#out')).toBeNull();
  });

  it('runs the page script with the shadow root bound to `root`', () => {
    const { container } = frame(
      '<p id="out"></p><script>root.querySelector("#out").textContent = "computed";</script>',
    );

    expect(shadowOf(container).querySelector('#out')?.textContent).toBe('computed');
  });

  it('tells the page which plugin it belongs to', () => {
    const { container } = frame(
      '<p id="out"></p><script>root.querySelector("#out").textContent = pluginId;</script>',
      'org.example.tools',
    );

    expect(shadowOf(container).querySelector('#out')?.textContent).toBe('org.example.tools');
  });

  it('runs several scripts in the order the page declares them', () => {
    const { container } = frame(
      '<p id="out"></p><script>root.querySelector("#out").textContent = "a";</script>' +
        '<script>root.querySelector("#out").textContent += "b";</script>',
    );

    expect(shadowOf(container).querySelector('#out')?.textContent).toBe('ab');
  });

  it('keeps the page style inside the shadow root', () => {
    const { container } = frame('<style>p { color: red }</style><p>styled</p>');

    expect(shadowOf(container).querySelector('style')?.textContent).toContain('color: red');
    expect(container.querySelector('style')).toBeNull();
  });

  it('reports a failing script instead of showing a silently blank page', () => {
    frame('<p>hi</p><script>throw new Error("boom")</script>');

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/boom/)).toBeTruthy();
  });

  it('mounts a page that ships no script at all', () => {
    const { container } = frame('<p id="out">static</p>');

    expect(shadowOf(container).querySelector('#out')?.textContent).toBe('static');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
