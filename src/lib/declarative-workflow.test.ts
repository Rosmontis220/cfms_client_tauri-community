// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateExpression,
  resolveValue,
  runDeclarativeWorkflow,
  type DeclarativeWorkflowHost,
} from '$lib/declarative-workflow';

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/stores.svelte', () => ({
  notificationStore: {
    info: mocks.info,
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
  },
}));

function host(overrides: Partial<DeclarativeWorkflowHost> = {}): DeclarativeWorkflowHost {
  return {
    kindLabel: 'community plugin',
    executeHostCall: vi.fn(async () => ({ ok: true })),
    requiresConfirmation: () => false,
    confirmationPrompt: () => 'Continue?',
    ...overrides,
  };
}

function workflow(nodes: Array<Record<string, unknown>>, start = 'a') {
  return { schema_version: 1, start, nodes } as never;
}

beforeEach(() => {
  mocks.goto.mockReset();
  mocks.goto.mockResolvedValue(undefined);
  mocks.info.mockReset();
  mocks.success.mockReset();
  mocks.warning.mockReset();
  mocks.error.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('declarative workflow engine', () => {
  it('rejects an unsupported schema version', async () => {
    await expect(
      runDeclarativeWorkflow(host(), { schema_version: 2, start: 'a', nodes: [] } as never),
    ).rejects.toThrow(/unsupported community plugin workflow schema/i);
  });

  it('rejects a jump to a node that does not exist', async () => {
    await expect(
      runDeclarativeWorkflow(host(), workflow([{ id: 'a', type: 'result', value: 1 }], 'missing')),
    ).rejects.toThrow(/does not exist/i);
  });

  it('calls the host and exposes the result to later nodes', async () => {
    const executeHostCall = vi.fn(async () => ({ total: 7 }));
    const result = await runDeclarativeWorkflow(
      host({ executeHostCall }),
      workflow([
        { id: 'a', type: 'host_call', capability: 'tasks.read', result: 'tasks', next: 'b' },
        { id: 'b', type: 'result', value: '$results.tasks.total' },
      ]),
    );

    expect(executeHostCall).toHaveBeenCalledWith('tasks.read', {}, undefined);
    expect(result).toBe(7);
  });

  it('branches on a condition', async () => {
    const result = await runDeclarativeWorkflow(
      host(),
      workflow(
        [
          { id: 'a', type: 'condition', expression: { op: 'eq', args: [1, 2] }, if_true: 'yes', if_false: 'no' },
          { id: 'yes', type: 'result', value: 'took true branch' },
          { id: 'no', type: 'result', value: 'took false branch' },
        ],
        'a',
      ),
    );

    expect(result).toBe('took false branch');
  });

  it('asks for confirmation before a capability that needs it', async () => {
    const executeHostCall = vi.fn(async () => ({}));
    await runDeclarativeWorkflow(
      host({
        executeHostCall,
        requiresConfirmation: (capability) => capability === 'files.open',
        confirmationPrompt: () => 'Allow opening?',
      }),
      workflow([{ id: 'a', type: 'host_call', capability: 'files.open' }]),
    );

    expect(window.confirm).toHaveBeenCalledWith('Allow opening?');
    expect(executeHostCall).toHaveBeenCalledWith('files.open', {}, true);
  });

  it('does not reach the host when the user declines', async () => {
    const executeHostCall = vi.fn(async () => ({}));
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await expect(
      runDeclarativeWorkflow(
        host({ executeHostCall, requiresConfirmation: () => true }),
        workflow([{ id: 'a', type: 'host_call', capability: 'files.open' }]),
      ),
    ).rejects.toThrow(/cancelled/i);

    expect(executeHostCall).not.toHaveBeenCalled();
  });

  it('refuses a background workflow that would need confirmation', async () => {
    const executeHostCall = vi.fn(async () => ({}));

    await expect(
      runDeclarativeWorkflow(
        host({ executeHostCall, requiresConfirmation: () => true }),
        workflow([{ id: 'a', type: 'host_call', capability: 'files.open' }]),
        { background: true },
      ),
    ).rejects.toThrow(/background workflows cannot call/i);

    expect(executeHostCall).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('refuses navigation outside the home workspace', async () => {
    await expect(
      runDeclarativeWorkflow(
        host(),
        workflow([{ id: 'a', type: 'navigate', to: 'https://example.invalid/' }]),
      ),
    ).rejects.toThrow(/must stay inside the home workspace/i);

    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('navigates inside the home workspace', async () => {
    await runDeclarativeWorkflow(
      host(),
      workflow([{ id: 'a', type: 'navigate', to: '/home/tasks' }]),
    );

    expect(mocks.goto).toHaveBeenCalledWith('/home/tasks');
  });

  it('refuses a background workflow that would navigate', async () => {
    await expect(
      runDeclarativeWorkflow(
        host(),
        workflow([{ id: 'a', type: 'navigate', to: '/home/tasks' }]),
        { background: true },
      ),
    ).rejects.toThrow(/background workflows cannot navigate/i);
  });

  it('routes each notify tone to the matching notification', async () => {
    for (const [tone, sink] of [
      ['success', mocks.success],
      ['warning', mocks.warning],
      ['danger', mocks.error],
      ['info', mocks.info],
    ] as const) {
      await runDeclarativeWorkflow(
        host(),
        workflow([{ id: 'a', type: 'notify', message: 'hello', tone }]),
      );
      expect(sink).toHaveBeenCalledWith('hello');
    }
  });

  it('rejects an unknown node type', async () => {
    await expect(
      runDeclarativeWorkflow(host(), workflow([{ id: 'a', type: 'teleport' }])),
    ).rejects.toThrow(/unsupported community plugin workflow node type/i);
  });

  it('stops a workflow that exceeds the step limit', async () => {
    await expect(
      runDeclarativeWorkflow(
        host(),
        workflow([{ id: 'a', type: 'transform', expression: { op: 'value', value: 1 }, next: 'a' }]),
      ),
    ).rejects.toThrow(/exceeded its execution limit/i);
  });

  it('stops a workflow that has already been cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runDeclarativeWorkflow(
        host(),
        workflow([{ id: 'a', type: 'result', value: 1 }]),
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/cancelled/i);
  });
});

describe('workflow expressions', () => {
  const context = { input: { name: 'Ada', count: 3 }, results: { list: [1, 2] } };

  it('resolves $ paths from the context', () => {
    expect(resolveValue('$input.name', context)).toBe('Ada');
    expect(resolveValue('$results.missing.deeper', context)).toBeUndefined();
  });

  it('resolves nested structures element by element', () => {
    expect(resolveValue({ who: '$input.name', n: '$input.count' }, context)).toEqual({
      who: 'Ada',
      n: 3,
    });
  });

  it('evaluates comparisons and logic', () => {
    expect(evaluateExpression({ op: 'eq', args: [2, 2] }, context)).toBe(true);
    expect(evaluateExpression({ op: 'neq', args: [2, 3] }, context)).toBe(true);
    expect(evaluateExpression({ op: 'and', args: [true, true] }, context)).toBe(true);
    expect(evaluateExpression({ op: 'or', args: [false, true] }, context)).toBe(true);
    expect(evaluateExpression({ op: 'not', args: [false] }, context)).toBe(true);
    expect(evaluateExpression({ op: 'gte', args: [3, 3] }, context)).toBe(true);
    expect(evaluateExpression({ op: 'lt', args: [1, 3] }, context)).toBe(true);
  });

  it('evaluates string and collection helpers', () => {
    expect(evaluateExpression({ op: 'concat', args: ['a', 1, 'b'] }, context)).toBe('a1b');
    expect(evaluateExpression({ op: 'length', args: ['$input.name'] }, context)).toBe(3);
    expect(evaluateExpression({ op: 'length', args: ['$results.list'] }, context)).toBe(2);
    expect(evaluateExpression({ op: 'length', args: [42] }, context)).toBe(0);
  });

  it('rejects an unknown operator rather than returning a wrong answer', () => {
    expect(() => evaluateExpression({ op: 'explode', args: [] }, context)).toThrow(
      /unsupported workflow expression operator/i,
    );
  });
});
