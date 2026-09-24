export interface ActivationContext {
  documentId: string;
  filename: string;
  folderId: string | null;
  pathParts: string[];
  sha256: string | null;
  size?: number | null;
}

export interface LocalState {
  existsLocally: boolean;
  isCurrent: boolean;
  localHash?: string | null;
  relativePath?: string;
}

export interface Task {
  task_id?: string;
  file_id?: string;
  status?: string;
  progress?: number;
  error?: string | null;
}

export interface VerifyOpenHost {
  call<T = unknown>(capability: string, args?: Record<string, unknown>): Promise<T>;
}

export type OpenResult = 'opened' | 'missing' | 'failed';

const ACTIVE = new Set(['pending', 'scheduled', 'downloading', 'decrypting', 'verifying']);
const SUCCESS = new Set(['completed', 'success', 'succeeded', 'done']);
const FAILURE = new Set(['failed', 'cancelled', 'canceled']);

export function relativeDocumentPath(context: ActivationContext): string {
  // Match the file manager's makeDownloadPath, not an independently guessed
  // normalization: both the normal download and verified open share one mirror.
  return [...context.pathParts, context.filename]
    .map((part) => part.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('/');
}

function taskIdOf(task: Task | null | undefined): string | null {
  return typeof task?.task_id === 'string' && task.task_id !== '' ? task.task_id : null;
}

async function openIfPresent(host: VerifyOpenHost, relativePath: string): Promise<OpenResult> {
  try {
    const result = await host.call<{ opened?: unknown }>('local.document.open', { relativePath });
    if (result?.opened === true) return 'opened';
    return 'missing';
  } catch {
    return 'failed';
  }
}

async function confirmOverwrite(host: VerifyOpenHost, context: ActivationContext): Promise<boolean> {
  try {
    const result = await host.call<{ confirmed?: unknown } | boolean>('ui.confirm', {
      title: 'Replace local document?',
      message: `The local copy of ${context.filename} is missing or differs from the server revision. Download the verified revision?`,
      confirmLabel: 'Download',
      cancelLabel: 'Cancel',
    });
    return typeof result === 'boolean' ? result : result?.confirmed === true;
  } catch {
    return false;
  }
}

async function waitForTask(host: VerifyOpenHost, taskId: string): Promise<Task | null> {
  try {
    const result = await host.call<Task | { task?: Task }>('tasks.wait', { taskId });
    return (result && typeof result === 'object' && 'task' in result ? result.task : result) ?? null;
  } catch {
    // Older hosts may expose only task reads. Polling remains bounded and does
    // not open anything until a fresh digest check succeeds.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const result = await host.call<Task[] | { tasks?: Task[] }>('tasks.read', { taskId });
        const tasks = Array.isArray(result) ? result : result?.tasks ?? [];
        const task = tasks.find((item) => item.task_id === taskId) ?? null;
        if (task && !ACTIVE.has(task.status ?? '') && (SUCCESS.has(task.status ?? '') || FAILURE.has(task.status ?? ''))) return task;
      } catch {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }
}

async function findActiveTask(host: VerifyOpenHost, documentId: string): Promise<string | null> {
  try {
    const result = await host.call<Task[] | { tasks?: Task[] }>('tasks.read', { fileId: documentId });
    const tasks = Array.isArray(result) ? result : result?.tasks ?? [];
    return taskIdOf(tasks.find((task) => task.file_id === documentId && ACTIVE.has(task.status ?? '')));
  } catch {
    return null;
  }
}

async function report(host: VerifyOpenHost, message: string): Promise<'handled'> {
  try {
    await host.call('ui.notify', { level: 'warning', message });
  } catch {
    // Reporting must never turn a handled failure into a second download.
  }
  return 'handled';
}

/** Run the verify, download, re-verify, open sequence. */
export async function verifyAndOpen(host: VerifyOpenHost, context: ActivationContext): Promise<'handled' | 'continue'> {
  const relativePath = relativeDocumentPath(context);
  let state: LocalState | null = null;
  try {
    state = await host.call<LocalState>('local.document.state', {
      relativePath,
      sha256: context.sha256,
      size: context.size ?? null,
    });
  } catch {
    return report(host, `Could not inspect the local copy of ${context.filename}.`);
  }

  if (state.isCurrent) {
    const opened = await openIfPresent(host, relativePath);
    if (opened === 'opened') return 'handled';
  } else if (state.existsLocally && !(await confirmOverwrite(host, context))) {
    return 'handled';
  }

  let taskId = await findActiveTask(host, context.documentId);
  if (!taskId) {
    try {
      const queued = await host.call<{ task_id?: unknown }>('server.document.download', {
        documentId: context.documentId,
        filename: relativePath,
      });
      taskId = typeof queued?.task_id === 'string' ? queued.task_id : null;
    } catch {
      return report(host, `Could not download ${context.filename}.`);
    }
  }
  if (!taskId) return report(host, `No download task was created for ${context.filename}.`);

  const task = await waitForTask(host, taskId);
  if (!task || FAILURE.has(task.status ?? '') || !SUCCESS.has(task.status ?? '')) {
    return report(host, `The download of ${context.filename} did not complete. See Transfers for details.`);
  }

  try {
    state = await host.call<LocalState>('local.document.state', {
      relativePath,
      sha256: context.sha256,
      size: context.size ?? null,
    });
  } catch {
    return report(host, `Could not verify the downloaded copy of ${context.filename}.`);
  }
  if (!state.isCurrent) {
    return report(host, `The downloaded copy of ${context.filename} does not match the server digest; it was not opened.`);
  }
  const opened = await openIfPresent(host, relativePath);
  return opened === 'opened'
    ? 'handled'
    : report(host, `Could not open the verified copy of ${context.filename}.`);
}
