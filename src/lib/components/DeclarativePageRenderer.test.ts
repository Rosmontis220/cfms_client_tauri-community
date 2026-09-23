// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeclarativePageRenderer from '$lib/components/DeclarativePageRenderer.svelte';
import type { DeclarativePageHost } from '$lib/declarative-page';
import type { DeclarativePage } from '$lib/api/extensions';

const mocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('$lib/stores.svelte', () => ({
  notificationStore: { error: mocks.error, info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function page(blocks: DeclarativePage['blocks']): DeclarativePage {
  return { schema_version: 1, title: 'Plugin dashboard', blocks };
}

function host(overrides: Partial<DeclarativePageHost> = {}): DeclarativePageHost {
  return {
    kindLabel: 'community plugin',
    loadPage: vi.fn(async () => page([{ type: 'text', text: 'Hello from a plugin' }])),
    runWorkflow: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.error.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('declarative page renderer', () => {
  it('renders the page title and a text block', async () => {
    render(DeclarativePageRenderer, { host: host(), pageId: 'main' });

    expect(await screen.findByText('Plugin dashboard')).toBeTruthy();
    expect(screen.getByText('Hello from a plugin')).toBeTruthy();
  });

  it('names the interface in a load failure', async () => {
    const failing = host({
      loadPage: vi.fn(async () => {
        throw new Error('page document is missing');
      }),
    });

    render(DeclarativePageRenderer, { host: failing, pageId: 'main' });

    expect(await screen.findByText(/unable to open community plugin/i)).toBeTruthy();
    expect(screen.getByText('page document is missing')).toBeTruthy();
  });

  it('rejects an unsupported page schema instead of rendering it', async () => {
    const wrongSchema = host({
      loadPage: vi.fn(async () => ({ schema_version: 2, title: 'x', blocks: [] }) as never),
    });

    render(DeclarativePageRenderer, { host: wrongSchema, pageId: 'main' });

    expect(await screen.findByText(/unsupported community plugin page schema/i)).toBeTruthy();
  });

  it('retries the load when asked', async () => {
    const loadPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([{ type: 'text', text: 'Recovered' }]));
    render(DeclarativePageRenderer, { host: host({ loadPage }), pageId: 'main' });

    await fireEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Recovered')).toBeTruthy();
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it('renders a status card, alert, list and table', async () => {
    const rich = host({
      loadPage: vi.fn(async () =>
        page([
          { type: 'status_card', title: 'Plugins', value: '3' },
          { type: 'alert', message: 'Unsigned packages', tone: 'warning' },
          { type: 'list', title: 'Items', items: [{ title: 'First', value: '1' }] },
          {
            type: 'table',
            title: 'Rows',
            columns: [{ key: 'name', label: 'Name' }],
            rows: [{ name: 'alpha' }],
          },
        ]),
      ),
    });

    render(DeclarativePageRenderer, { host: rich, pageId: 'main' });

    expect(await screen.findByText('Plugins')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Unsigned packages')).toBeTruthy();
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('alpha')).toBeTruthy();
  });

  it('runs the action workflow with the current form values', async () => {
    const runWorkflow = vi.fn(async () => null);
    const form = host({
      runWorkflow,
      loadPage: vi.fn(async () =>
        page([
          {
            type: 'form',
            id: 'settings',
            fields: [{ id: 'query', label: 'Query', type: 'text' }],
          },
          {
            type: 'actions',
            actions: [{ id: 'go', label: 'Run', workflow: 'search', tone: 'primary' }],
          },
        ]),
      ),
    });

    render(DeclarativePageRenderer, { host: form, pageId: 'main' });

    await fireEvent.input(await screen.findByLabelText('Query'), {
      target: { value: 'annual report' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(runWorkflow).toHaveBeenCalledWith('search', { settings: { query: 'annual report' } }),
    );
  });

  it('surfaces a workflow failure without breaking the page', async () => {
    const failing = host({
      runWorkflow: vi.fn(async () => {
        throw new Error('plugin capability is not authorized');
      }),
      loadPage: vi.fn(async () =>
        page([{ type: 'actions', actions: [{ id: 'go', label: 'Run', workflow: 'search' }] }]),
      ),
    });

    render(DeclarativePageRenderer, { host: failing, pageId: 'main' });
    await fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('plugin capability is not authorized'),
    );
    // The page is still usable afterwards.
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
  });
});
