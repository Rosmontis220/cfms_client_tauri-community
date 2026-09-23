import { readComExtWorkflow, type ComExtCapability } from '$lib/api/com-ext';
import { COM_EXT_SIDE_EFFECTING_CAPABILITIES, comExtStore } from '$lib/com-ext.svelte';
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
    executeHostCall: (capability, args, userConfirmed) =>
      comExtStore.callHost(
        pluginId,
        capability as ComExtCapability,
        args as Record<string, unknown>,
        // The engine has already asked the user. Hand that decision to the
        // broker's own check instead of prompting a second time; the check
        // still refuses when consent was not obtained.
        () => userConfirmed === true,
      ),
    requiresConfirmation: (capability) =>
      COM_EXT_SIDE_EFFECTING_CAPABILITIES.has(capability as ComExtCapability),
    confirmationPrompt: (capability, args) => {
      const name =
        typeof args.filename === 'string' && args.filename ? args.filename : 'this file';
      const action = capability === 'files.open' ? 'open' : 'download';
      return `Allow community plugin "${comExtStore.displayNameFor(pluginId)}" to ${action} ${name}?`;
    },
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
 * are always treated as background: they may not prompt, navigate, or enqueue a
 * download, because they run as a side effect of something the user already
 * asked for.
 */
export async function runComExtHooks(
  point: string,
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
