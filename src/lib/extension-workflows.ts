import {
  executeExtensionHostCall,
  readExtensionWorkflow,
  type ExtensionCapability,
} from '$lib/api/extensions';
import {
  runDeclarativeWorkflow,
  type DeclarativeWorkflowHost,
  type WorkflowRunOptions,
} from '$lib/declarative-workflow';

/**
 * Official extension interface: the declarative workflow engine bound to the
 * `extension_*` host calls.
 *
 * The engine itself lives in `$lib/declarative-workflow` and is shared with the
 * community plugin interface, which interprets the same workflow vocabulary.
 */

export type { WorkflowRunOptions } from '$lib/declarative-workflow';

/**
 * The official broker requires consent for downloads only. Community plugins
 * additionally require it to open a file, so that rule lives in their adapter
 * rather than here.
 */
function officialHost(extensionId: string): DeclarativeWorkflowHost {
  return {
    kindLabel: 'extension',
    executeHostCall: (capability, args, userConfirmed) =>
      executeExtensionHostCall(
        extensionId,
        capability as ExtensionCapability,
        args,
        userConfirmed,
      ),
    requiresConfirmation: (capability) => capability === 'transfers.download.enqueue',
    confirmationPrompt: () =>
      `Allow extension ${extensionId} to add this download?`,
  };
}

export async function runExtensionWorkflow(
  extensionId: string,
  workflowId: string,
  options: WorkflowRunOptions = {},
): Promise<unknown> {
  const workflow = await readExtensionWorkflow(extensionId, workflowId);
  return runDeclarativeWorkflow(officialHost(extensionId), workflow, options);
}
