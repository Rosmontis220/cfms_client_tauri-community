// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comExtStore } from '$lib/com-ext.svelte';
import { runComExtHooks, runComExtWorkflow } from '$lib/com-ext-workflow';
import type { ComExtInstallation, ComExtOverview } from '$lib/api/com-ext';

const mocks = vi.hoisted(() => ({
  readComExtWorkflow: vi.fn(),
  executeComExtHostCall: vi.fn(),
  goto: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$lib/api/com-ext', () => ({
  readComExtWorkflow: mocks.readComExtWorkflow,
  executeComExtHostCall: mocks.executeComExtHostCall,
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/stores.svelte', () => ({
  notificationStore: { info: mocks.info, error: mocks.error, success: vi.fn(), warning: vi.fn() },
}));

function installation(overrides: Partial<ComExtInstallation> = {}): ComExtInstallation {
  const base: ComExtInstallation = {
    package_digest: 'a'.repeat(64),
    installed_at: 1_700_000_000,
    enabled: true,
    granted_capabilities: ['files.open', 'transfers.download.enqueue'],
    disk_bytes: 1024,
    manifest: {
      format: 'cfmscomext',
      schema_version: 1,
      id: 'org.example.test',
      name: 'Test Plugin',
      description: 'A plugin used by tests',
      publisher: 'tests',
      version: '1.0.0',
      com_ext_api: '1.0.0',
      min_client_version: '1.0.0',
      requested_capabilities: ['files.open', 'transfers.download.enqueue'],
      entrypoints: {
        navigation: [],
        settings: [],
        pages: [],
        slots: [],
        actions: [],
        hooks: [],
        overrides: [],
      },
      background_triggers: [],
    },
  };
  return { ...base, ...overrides };
}

function withHooks(hooks: ComExtInstallation['manifest']['entrypoints']['hooks']) {
  const entry = installation();
  entry.manifest.entrypoints.hooks = hooks;
  return entry;
}

function overview(installed: ComExtInstallation[]): ComExtOverview {
  return {
    installed,
    hostApiVersion: '1.0.0',
    capabilities: ['files.open', 'transfers.download.enqueue'],
    packageExtension: 'cfmscomext',
    root: '/tmp/app/com_ext',
  };
}

function workflow(nodes: Array<Record<string, unknown>>) {
  return { schema_version: 1, start: nodes[0]?.id ?? 'a', nodes } as never;
}

beforeEach(() => {
  comExtStore.overview = overview([installation()]);
  comExtStore.error = null;
  mocks.readComExtWorkflow.mockReset();
  mocks.readComExtWorkflow.mockResolvedValue(workflow([{ id: 'a', type: 'result', value: null }]));
  mocks.executeComExtHostCall.mockReset();
  mocks.executeComExtHostCall.mockResolvedValue({ ok: true });
  mocks.goto.mockReset();
  mocks.goto.mockResolvedValue(undefined);
  mocks.info.mockReset();
  mocks.error.mockReset();
  mocks.warn.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(console, 'warn').mockImplementation(mocks.warn);
});

describe('community plugin workflow adapter', () => {
  it('reads the workflow from the plugin and runs it', async () => {
    mocks.readComExtWorkflow.mockResolvedValue(
      workflow([{ id: 'a', type: 'host_call', capability: 'tasks.read' }]),
    );

    await runComExtWorkflow('org.example.test', 'refresh');

    expect(mocks.readComExtWorkflow).toHaveBeenCalledWith('org.example.test', 'refresh');
    expect(mocks.executeComExtHostCall).toHaveBeenCalledWith(
      'org.example.test',
      'tasks.read',
      {},
      undefined,
    );
  });

  it('names the plugin when asking to open a file', async () => {
    mocks.readComExtWorkflow.mockResolvedValue(
      workflow([
        {
          id: 'a',
          type: 'host_call',
          capability: 'files.open',
          arguments: { documentId: 'doc-1', filename: 'report.pdf' },
        },
      ]),
    );

    await runComExtWorkflow('org.example.test', 'open');

    expect(window.confirm).toHaveBeenCalledWith(
      'Allow community plugin "Test Plugin" to open report.pdf?',
    );
    expect(mocks.executeComExtHostCall).toHaveBeenCalledWith(
      'org.example.test',
      'files.open',
      { documentId: 'doc-1', filename: 'report.pdf' },
      true,
    );
  });

  it('does not open a file when the user declines', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mocks.readComExtWorkflow.mockResolvedValue(
      workflow([
        { id: 'a', type: 'host_call', capability: 'files.open', arguments: { documentId: 'd' } },
      ]),
    );

    await expect(runComExtWorkflow('org.example.test', 'open')).rejects.toThrow(/cancelled/i);

    expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
  });

  it('falls back to the plugin id when the name is unknown', async () => {
    comExtStore.overview = overview([]);
    mocks.readComExtWorkflow.mockResolvedValue(
      workflow([
        { id: 'a', type: 'host_call', capability: 'files.open', arguments: { documentId: 'd' } },
      ]),
    );

    await runComExtWorkflow('org.gone.plugin', 'open');

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('org.gone.plugin'),
    );
  });
});

describe('community plugin hook registry', () => {
  it('runs only the hooks attached to the requested point', async () => {
    comExtStore.overview = overview([
      withHooks([
        { id: 'a', point: 'onLogin', workflow: 'welcome' },
        { id: 'b', point: 'onLogout', workflow: 'farewell' },
      ]),
    ]);

    await runComExtHooks('onLogin');

    expect(mocks.readComExtWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.readComExtWorkflow).toHaveBeenCalledWith('org.example.test', 'welcome');
  });

  it('ignores hooks belonging to a disabled plugin', async () => {
    const disabled = withHooks([{ id: 'a', point: 'onLogin', workflow: 'welcome' }]);
    disabled.enabled = false;
    comExtStore.overview = overview([disabled]);

    await runComExtHooks('onLogin');

    expect(mocks.readComExtWorkflow).not.toHaveBeenCalled();
  });

  it('keeps running the remaining plugins when one hook fails', async () => {
    const broken = installation({ manifest: { ...installation().manifest, id: 'org.broken' } });
    broken.manifest.entrypoints.hooks = [{ id: 'x', point: 'onLogin', workflow: 'boom' }];
    comExtStore.overview = overview([
      broken,
      withHooks([{ id: 'a', point: 'onLogin', workflow: 'welcome' }]),
    ]);
    mocks.readComExtWorkflow.mockImplementation(async (_pluginId: string, workflowId: string) => {
      if (workflowId === 'boom') throw new Error('workflow is corrupt');
      return workflow([{ id: 'a', type: 'result', value: null }]);
    });

    await runComExtHooks('onLogin');

    expect(mocks.readComExtWorkflow).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('org.broken'),
    );
  });

  it('runs hooks as background work, so a hook cannot prompt', async () => {
    comExtStore.overview = overview([
      withHooks([{ id: 'a', point: 'beforeDocumentOpen', workflow: 'peek' }]),
    ]);
    mocks.readComExtWorkflow.mockResolvedValue(
      workflow([
        {
          id: 'a',
          type: 'host_call',
          capability: 'files.open',
          arguments: { documentId: 'd' },
        },
      ]),
    );

    await runComExtHooks('beforeDocumentOpen');

    // The engine refuses rather than prompting, and the hook layer swallows it.
    expect(window.confirm).not.toHaveBeenCalled();
    expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it('passes the triggering context to the hook workflow', async () => {
    comExtStore.overview = overview([
      withHooks([{ id: 'a', point: 'beforeDocumentOpen', workflow: 'peek' }]),
    ]);
    mocks.readComExtWorkflow.mockResolvedValue(
      workflow([{ id: 'a', type: 'result', value: '$input.documentId' }]),
    );

    await runComExtHooks('beforeDocumentOpen', { documentId: 'doc-9' });

    expect(mocks.readComExtWorkflow).toHaveBeenCalledTimes(1);
  });
});
