import { verifyAndOpen, type ActivationContext, type VerifyOpenHost } from './workflow';

interface HandlerHost extends VerifyOpenHost {
  handle(point: string, handler: (context: unknown) => Promise<'handled' | 'continue'>): () => void;
}

const mountedRoots = new WeakSet<ShadowRoot>();

function readContext(value: unknown): ActivationContext | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<ActivationContext>;
  if (typeof input.documentId !== 'string' || typeof input.filename !== 'string') return null;
  return {
    documentId: input.documentId,
    filename: input.filename,
    folderId: typeof input.folderId === 'string' ? input.folderId : null,
    pathParts: Array.isArray(input.pathParts) ? input.pathParts.filter((part): part is string => typeof part === 'string') : [],
    sha256: typeof input.sha256 === 'string' ? input.sha256 : null,
    size: typeof input.size === 'number' ? input.size : null,
  };
}

export function mount(root: ShadowRoot, _pluginId: string, host: HandlerHost): void {
  if (mountedRoots.has(root)) return;
  mountedRoots.add(root);
  host.handle('file.activate', async (detail) => {
    const context = readContext(detail);
    if (!context) return 'continue';
    return verifyAndOpen(host, context);
  });
}

declare const root: ShadowRoot | undefined;
declare const pluginId: string | undefined;
declare const host: HandlerHost | undefined;

if (typeof root !== 'undefined' && root && typeof host !== 'undefined' && host) {
  mount(root, typeof pluginId === 'string' ? pluginId : 'org.cfms.verify-open', host);
}
