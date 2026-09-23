import type { DeclarativePage } from '$lib/api/extensions';

/**
 * Binds the shared declarative page renderer to one extension interface.
 *
 * The renderer itself knows nothing about which system it is displaying; it
 * only asks the host to fetch a page document and to run a workflow. This keeps
 * the official and community interfaces on one implementation instead of two
 * that would render the same block vocabulary differently over time.
 */
export interface DeclarativePageHost {
  /** Noun used in user-facing messages, e.g. `extension` or `community plugin`. */
  kindLabel: string;
  /** Fetch the page document by its declared id. */
  loadPage(pageId: string): Promise<DeclarativePage>;
  /**
   * Run the named workflow. `input` carries the page's current form values,
   * which workflows reach as `$input`.
   */
  runWorkflow(workflowId: string, input: Record<string, unknown>): Promise<unknown>;
}
