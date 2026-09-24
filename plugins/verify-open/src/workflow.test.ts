import { describe, expect, it, vi } from 'vitest';
import { relativeDocumentPath, verifyAndOpen, type ActivationContext } from './workflow';

const context: ActivationContext = {
  documentId: 'doc-1',
  filename: 'report.pdf',
  folderId: 'folder-1',
  pathParts: ['Projects', '2026'],
  sha256: 'abc123',
  size: 42,
};

describe('verify-open workflow', () => {
  it('builds the same relative download path as the host', () => {
    expect(relativeDocumentPath({ ...context, pathParts: ['\\Projects\\', '/2026/'] })).toBe('Projects/2026/report.pdf');
  });

  it('opens a current local copy without downloading', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ isCurrent: true, existsLocally: true })
      .mockResolvedValueOnce({ opened: true });
    await expect(verifyAndOpen({ call }, context)).resolves.toBe('handled');
    expect(call.mock.calls.map(([capability]) => capability)).toEqual([
      'local.document.state',
      'local.document.open',
    ]);
  });

  it('downloads, re-verifies, then opens a stale copy', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ isCurrent: false, existsLocally: true })
      .mockResolvedValueOnce({ confirmed: true })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ task_id: 'task-1' })
      .mockResolvedValueOnce({ task_id: 'task-1', status: 'completed' })
      .mockResolvedValueOnce({ isCurrent: true, existsLocally: true })
      .mockResolvedValueOnce({ opened: true });
    await expect(verifyAndOpen({ call }, context)).resolves.toBe('handled');
    expect(call.mock.calls.map(([capability]) => capability)).toEqual([
      'local.document.state',
      'ui.confirm',
      'tasks.read',
      'server.document.download',
      'tasks.wait',
      'local.document.state',
      'local.document.open',
    ]);
  });

  it('does not open when the post-download digest is still stale', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ isCurrent: false, existsLocally: false })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ task_id: 'task-1' })
      .mockResolvedValueOnce({ task_id: 'task-1', status: 'completed' })
      .mockResolvedValueOnce({ isCurrent: false, existsLocally: true });
    await expect(verifyAndOpen({ call }, context)).resolves.toBe('handled');
    expect(call.mock.calls.some(([capability]) => capability === 'local.document.open')).toBe(false);
  });
});
