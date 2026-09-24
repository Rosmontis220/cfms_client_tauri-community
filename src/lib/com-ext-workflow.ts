import { readComExtWorkflow, type ComExtCapability, type ComExtHookPoint } from '$lib/api/com-ext';
import { comExtStore } from '$lib/com-ext.svelte';
import {
  runDeclarativeWorkflow,
  type DeclarativeWorkflowHost,
  type WorkflowRunOptions,
} from '$lib/declarative-workflow';

/**
 * Community plugin interface: the shared declarative workflow engine bound to
 * the `com_ext_*` host calls.
 */

export type { WorkflowRunOptions } from '$lib/declarative-workflow';

function communityHost(pluginId: string): DeclarativeWorkflowHost {
  return {
    kindLabel: 'community plugin',
    executeHostCall: (capability, args) =>
      comExtStore.callHost(
        pluginId,
        capability as ComExtCapability,
        args as Record<string, unknown>,
      ),
    requiresConfirmation: () => false,
    confirmationPrompt: () => '',
  };
}

export async function runComExtWorkflow(
  pluginId: string,
  workflowId: string,
  options: WorkflowRunOptions = {},
): Promise<unknown> {
  const workflow = await readComExtWorkflow(pluginId, workflowId);
  return runDeclarativeWorkflow(communityHost(pluginId), workflow, options);
}

/**
 * Run every enabled plugin's workflow attached to a lifecycle hook point.
 *
 * A failing plugin must not break the host action that triggered the hook, so
 * each failure is reported and the remaining plugins still run. Hook workflows
 * run in the background; explicit workflow `confirm` steps and navigation are
 * unavailable there. Foreground interception belongs to page-backed handlers.
 */
export async function runComExtHooks(
  point: ComExtHookPoint,
  input: Record<string, unknown> = {},
): Promise<void> {
  for (const contributor of comExtStore.hookContributors(point)) {
    try {
      await runComExtWorkflow(contributor.pluginId, contributor.workflow, {
        input,
        background: true,
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      console.warn(
        `Community plugin "${contributor.pluginId}" hook ${point} failed: ${reason}`,
      );
    }
  }
}
