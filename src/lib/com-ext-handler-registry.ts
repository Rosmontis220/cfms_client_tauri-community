/*
 * Foreground host actions a community plugin page can handle.
 *
 * A handler is an ordinary plugin HTML page with a bound host object. The
 * host awaits its answer at an action boundary, unlike background workflows:
 * returning `handled` suppresses the app's default action; returning `continue`
 * lets the next contributor (and eventually the app) handle it. Registration
 * belongs to the mounted page and is removed when that page is disposed.
 */
export type ComExtHandlerResult = 'handled' | 'continue' | boolean | void;
export type ComExtHandler = (
  context: Record<string, unknown>,
) => ComExtHandlerResult | Promise<ComExtHandlerResult>;

const registered = new Map<string, Map<string, Set<ComExtHandler>>>();

export function registerComExtHandler(
  ownerId: string,
  point: string,
  handler: ComExtHandler,
): () => void {
  let points = registered.get(ownerId);
  if (!points) {
    points = new Map();
    registered.set(ownerId, points);
  }
  let handlers = points.get(point);
  if (!handlers) {
    handlers = new Set();
    points.set(point, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers?.delete(handler);
    if (handlers?.size === 0) points?.delete(point);
    if (points?.size === 0) registered.delete(ownerId);
  };
}

/** Invoke a mounted contribution. Exceptions propagate to the host's policy. */
export async function invokeComExtHandler(
  ownerId: string,
  point: string,
  context: Record<string, unknown>,
): Promise<boolean> {
  for (const handler of [...(registered.get(ownerId)?.get(point) ?? [])]) {
    const answer = await handler(context);
    if (answer === true || answer === 'handled') return true;
  }
  return false;
}
