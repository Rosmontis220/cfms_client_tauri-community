// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { comExtStore } from '$lib/com-ext.svelte';
import { disposeComExtHandlers, runComExtHandlers } from '$lib/com-ext-handlers';

const mocks = vi.hoisted(() => ({ readComExtPage: vi.fn() }));
vi.mock('$lib/api/com-ext', () => ({ readComExtPage: mocks.readComExtPage }));

function installation(id: string, order: number, enabled = true) {
  return {
    enabled,
    package_digest: 'digest-1',
    manifest: {
      id,
      entrypoints: {
        handlers: [{ id: 'open', point: 'file.activate', page: 'open', order }],
      },
    },
  };
}

beforeEach(() => {
  disposeComExtHandlers();
  comExtStore.overview = { installed: [installation('test.plugin', 5)] } as never;
  mocks.readComExtPage.mockReset();
});
afterEach(() => {
  disposeComExtHandlers();
  document.querySelectorAll('[data-com-ext-handler]').forEach((element) => element.remove());
});

describe('page-backed foreground plugin handlers', () => {
  it('awaits an HTML handler and prevents the default action', async () => {
    mocks.readComExtPage.mockResolvedValue({
      kind: 'html',
      html: '<script>host.handle("file.activate", async ({documentId}) => documentId === "doc-1" ? "handled" : "continue")</script>',
    });
    await expect(runComExtHandlers('file.activate', { documentId: 'doc-1' })).resolves.toBe(true);
    await expect(runComExtHandlers('file.activate', { documentId: 'doc-2' })).resolves.toBe(false);
    expect(mocks.readComExtPage).toHaveBeenCalledTimes(1);
  });

  it('reloads a handler page after its package is updated', async () => {
    mocks.readComExtPage.mockResolvedValue({
      kind: 'html', html: '<script>host.handle("file.activate", () => "handled")</script>',
    });
    await expect(runComExtHandlers('file.activate', {})).resolves.toBe(true);
    comExtStore.overview = { installed: [{ ...installation('test.plugin', 5), package_digest: 'digest-2' }] } as never;
    await expect(runComExtHandlers('file.activate', {})).resolves.toBe(true);
    expect(mocks.readComExtPage).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('[data-com-ext-handler]')).toHaveLength(1);
  });

  it('skips a disabled plugin and disposes its mounted handler', async () => {
    mocks.readComExtPage.mockResolvedValue({
      kind: 'html', html: '<script>host.handle("file.activate", () => "handled")</script>',
    });
    await expect(runComExtHandlers('file.activate', {})).resolves.toBe(true);
    comExtStore.overview = { installed: [installation('test.plugin', 5, false)] } as never;
    await expect(runComExtHandlers('file.activate', {})).resolves.toBe(false);
    expect(document.querySelector('[data-com-ext-handler]')).toBeNull();
  });
});
