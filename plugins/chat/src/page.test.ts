import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './page';
import { readFileSync } from 'node:fs';

const html = readFileSync('plugins/chat/src/page.html', 'utf8');
async function settle() { for (let n = 0; n < 8; n++) await new Promise((resolve) => setTimeout(resolve, 0)); }
function fixture(call: (name: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = container.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  mount(root, 'org.cfms.chat', { call });
  return root;
}
beforeEach(() => { document.body.replaceChildren(); });
describe('chat page host bridge', () => {
  it('loads online rooms lazily and falls back to walking directories', async () => {
    const calls: { name: string; args?: Record<string, unknown> }[] = [];
    const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'storage.read') return { value: null };
      if (name === 'server.path.resolve') throw Error('node_lookup absent');
      if (name === 'server.directory.list') {
        if (args?.folderId === null) return { folders: [{ id: 'runtime-id', name: '.runtime' }], documents: [] };
        if (args?.folderId === 'runtime-id') return { folders: [{ id: 'box-id', name: 'chatbox' }], documents: [] };
        if (args?.folderId === 'box-id') return { folders: [{ id: 'room-id', name: 'room-name', created_time: 123 }], documents: [] };
        return { folders: [], documents: [{ id: 'text-id', title: 'user.txt' }, { id: 'attachment-id', title: 'file.png' }] };
      }
      if (name === 'server.document.readText') return { content: '# time | msg\n2026-01-01 | hello // abc1234 -> reply', truncated: false };
      return {};
    });
    const root = fixture(call);
    await settle();
    expect(root.textContent).toContain('hello');
    expect(root.textContent).toContain('file.png');
    expect(calls.some((entry) => entry.name === 'server.path.resolve')).toBe(true);
    expect(calls.some((entry) => entry.name === 'server.document.readText' && entry.args?.documentId === 'text-id')).toBe(true);
  });
  it('restores local folder through storage and opens scanned attachment', async () => {
    const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'storage.read') return { value: args?.key === 'cfms:chatbox:mode' ? 'local' : args?.key === 'cfms:chatbox:localPath' ? 'C:/records' : null };
      if (name === 'local.directory.scan') return [{ id: 'room-a', files: [{ name: 'u.txt', kind: 'text', path: 'C:/records/room-a/u.txt', content: '2026-01-01 | local hello' }, { name: 'audio.mp3', kind: 'audio', path: 'C:/records/room-a/audio.mp3', content: null }] }];
      return {};
    });
    const root = fixture(call);
    await settle();
    expect(root.textContent).toContain('local hello');
    root.querySelector<HTMLButtonElement>('.chat-attachments button')?.click();
    await settle();
    expect(call).toHaveBeenCalledWith('local.path.open', { path: 'C:/records/room-a/audio.mp3' });
  });
});
