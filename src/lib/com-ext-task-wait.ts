import { downloadStore } from '$lib/stores.svelte';
import type { DownloadTaskDto } from '$lib/api';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * Await a download task without guessing how long a large transfer takes.
 * The backend event listener updates this store, and this wait is deliberately
 * page-independent so any plugin can await a task it has enqueued. Timeout is
 * explicit; the caller can query tasks.read and decide whether to keep waiting.
 */
export async function waitForComExtDownloadTask(
  taskId: string,
  timeoutMs = 120_000,
): Promise<DownloadTaskDto> {
  if (!taskId.trim()) throw new Error('tasks.wait requires taskId');
  const expires = Date.now() + Math.min(Math.max(timeoutMs, 100), 600_000);
  while (Date.now() < expires) {
    const task = downloadStore.tasks.get(taskId);
    if (task && TERMINAL.has(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for download task ${taskId}`);
}
