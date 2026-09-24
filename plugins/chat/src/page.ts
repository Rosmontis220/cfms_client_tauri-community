import { combineRoomFiles, type Attachment, type Room } from './model';
import { DEFAULT_ROOMS, DEFAULT_USERS } from './names';

interface PluginHost {
  call<T = unknown>(capability: string, args?: Record<string, unknown>): Promise<T>;
}
interface Listing { folders: { id: string; name: string; created_time?: number | null }[]; documents: { id: string; title: string }[] }
interface LocalRoom { id: string; files: { name: string; path: string; kind: string; size: number; content: string | null; truncated: boolean }[] }
type Mode = 'online' | 'local';
type Source = 'runtime' | 'echo';
const SOURCES: Record<Source, { path: string; segments: string[] }> = {
  runtime: { path: '/.runtime/chatbox', segments: ['.runtime', 'chatbox'] },
  echo: { path: '/回响/.reserved/chatbox', segments: ['回响', '.reserved', 'chatbox'] },
};
const COLORS = ['#ffffff','#b8e4ff','#c8f7c5','#fff5b8','#ffe0ec','#e8d5ff','#ffddc4','#b8f0f0'];
const STRIPS = ['#e0e0e0','#6cc4f5','#5cd65c','#f0d800','#f580a8','#b070f0','#f09050','#40c8c8'];
const mounted = new WeakSet<ShadowRoot>();
const key = (name: string) => `cfms:chatbox:${name}`;
const node = <T extends HTMLElement>(root: ShadowRoot, role: string): T => {
  const found = root.querySelector<T>(`[data-role="${role}"]`);
  if (!found) throw Error(`Missing chat element ${role}`);
  return found;
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function safeNames(value: string | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.fromEntries(Object.entries(parsed).filter(([k, v]) => k !== '__proto__' && typeof v === 'string'));
  } catch { /* malformed older setting */ }
  return {};
}
const roomBase = (id: string, roomId: string, createdTime: number | null = null): Room => ({ id, roomId, createdTime, messages: [], attachments: [], nonformat: [], loaded: false });

export function mount(root: ShadowRoot, _pluginId: string, host: PluginHost): void {
  if (mounted.has(root)) return;
  mounted.add(root);
  void start(root, host);
}
async function start(root: ShadowRoot, host: PluginHost) {
  const roomsNode = node(root, 'rooms');
  const view = node(root, 'view');
  const hint = node(root, 'hint');
  const error = node(root, 'error');
  const sources = node(root, 'sources');
  const controls = (name: string) => root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  let mode: Mode = 'online';
  let source: Source = 'runtime';
  let localPath = '';
  let roomNames: Record<string, string> = {};
  let userNames: Record<string, string> = {};
  let rooms: Room[] = [];
  let selected: string | null = null;
  let busy = false;
  let loadingRoom: string | null = null;
  let showNonformat = false;
  let generation = 0;
  let errorMessage = '';
  const save = async (name: string, value: string) => {
    try { await host.call('storage.write', { key: key(name), value }); }
    catch (reason) { errorMessage = `无法保存设置：${errorText(reason)}`; render(); }
  };
  const read = async (name: string): Promise<string | null> => {
    const result = await host.call<{ value?: unknown }>('storage.read', { key: key(name) });
    return typeof result?.value === 'string' ? result.value : null;
  };
  const roomName = (id: string) => roomNames[id] ?? DEFAULT_ROOMS[id] ?? `${id.slice(0, 8)}…`;
  const userName = (id: string) => userNames[id] ?? DEFAULT_USERS[id] ?? `${id.slice(0, 8)}…`;
  function state(text: string) { return el('div', 'chat-state', text); }
  function rename(kind: 'room' | 'user', id: string) {
    const names = kind === 'room' ? roomNames : userNames;
    const next = window.prompt(kind === 'room' ? '聊天室名称（留空恢复）' : '用户名称（留空恢复）', names[id] ?? '');
    if (next === null) return;
    const updated = { ...names };
    if (next.trim()) updated[id] = next.trim(); else delete updated[id];
    if (kind === 'room') roomNames = updated; else userNames = updated;
    void save(kind === 'room' ? 'roomNames' : 'userNames', JSON.stringify(updated));
    render();
  }
  async function folderId(which: Source): Promise<string | null> {
    const config = SOURCES[which];
    try {
      const response = await host.call<{ node_ids: string[] }>('server.path.resolve', { path: config.path });
      const id = response.node_ids?.at(-1);
      if (id && id !== '/') return id;
    } catch { /* optional node_lookup; walk directory tree instead */ }
    let current: string | null = null;
    for (const segment of config.segments) {
      const listing = await host.call<Listing>('server.directory.list', { folderId: current });
      current = listing.folders.find((item) => item.name === segment)?.id ?? null;
      if (!current) return null;
    }
    return current;
  }
  async function refresh() {
    const ticket = ++generation;
    errorMessage = '';
    busy = true;
    rooms = [];
    selected = null;
    loadingRoom = null;
    render();
    try {
      if (mode === 'online') {
        const id = await folderId(source);
        if (!id) throw Error(`找不到目录 ${SOURCES[source].path}`);
        const listing = await host.call<Listing>('server.directory.list', { folderId: id });
        if (ticket !== generation) return;
        rooms = listing.folders.map((folder) => roomBase(folder.id, folder.name, folder.created_time ?? null));
        rooms.sort((a, b) => (b.createdTime ?? 0) - (a.createdTime ?? 0));
      } else if (localPath) {
        const scanned = await host.call<LocalRoom[]>('local.directory.scan', { dir: localPath });
        if (ticket !== generation) return;
        rooms = scanned.map((item) => combineRoomFiles(roomBase(item.id, item.id), item.files));
        rooms.sort((a, b) => (b.messages.at(-1)?.time ?? '').localeCompare(a.messages.at(-1)?.time ?? ''));
      }
      if (rooms.length) selected = rooms[0].roomId;
    } catch (reason) {
      if (ticket === generation) errorMessage = `加载聊天记录失败：${errorText(reason)}`;
    } finally {
      if (ticket === generation) { busy = false; render(); if (selected && mode === 'online') void loadRoom(selected); }
    }
  }
  async function loadRoom(roomId: string) {
    const ticket = generation;
    const room = rooms.find((entry) => entry.roomId === roomId);
    if (!room || room.loaded || loadingRoom === roomId) return;
    loadingRoom = roomId;
    render();
    try {
      const listing = await host.call<Listing>('server.directory.list', { folderId: room.id });
      const files: { id: string; name: string; content?: string; truncated?: boolean }[] = [];
      for (const doc of listing.documents) {
        const file: (typeof files)[number] = { id: doc.id, name: doc.title };
        if (doc.title.toLowerCase().endsWith('.txt')) {
          try {
            const result = await host.call<{ content: string; truncated: boolean }>('server.document.readText', { documentId: doc.id });
            file.content = result.content;
            file.truncated = result.truncated;
          } catch { /* Other readable records and attachments still appear. */ }
        }
        files.push(file);
      }
      if (ticket !== generation) return;
      const index = rooms.findIndex((entry) => entry.id === room.id);
      if (index >= 0) rooms[index] = combineRoomFiles(rooms[index], files);
    } catch (reason) {
      if (ticket === generation) {
        const index = rooms.findIndex((entry) => entry.id === room.id);
        if (index >= 0) rooms[index] = { ...rooms[index], loaded: true, failed: true };
        errorMessage = `加载聊天室失败：${errorText(reason)}`;
      }
    } finally { if (ticket === generation) { loadingRoom = null; render(); } }
  }
  async function attachmentAction(attachment: Attachment) {
    try {
      if (attachment.path) await host.call('local.path.open', { path: attachment.path });
      else await host.call('server.document.download', { documentId: attachment.id, filename: attachment.name });
      if (!attachment.path) { errorMessage = `已加入下载队列：${attachment.name}`; render(); }
    } catch (reason) { errorMessage = `附件操作失败：${errorText(reason)}`; render(); }
  }
  function render() {
    error.hidden = !errorMessage;
    error.textContent = errorMessage;
    sources.hidden = mode !== 'online';
    controls('folder').hidden = mode !== 'local';
    controls('refresh').disabled = busy;
    for (const name of ['online','local','runtime','echo'] as const) {
      controls(name).setAttribute('aria-pressed', String(name === mode || (mode === 'online' && name === source)));
    }
    hint.textContent = mode === 'online' ? `在线目录：${SOURCES[source].path}` : localPath ? `本地目录：${localPath}` : '请选择聊天记录目录或包含 .runtime/chatbox 的根目录。';
    roomsNode.replaceChildren();
    if (busy && !rooms.length) roomsNode.append(state('正在加载聊天室…'));
    else if (mode === 'local' && !localPath) roomsNode.append(state('尚未选择文件夹'));
    else if (!rooms.length) roomsNode.append(state(errorMessage ? '无法列出聊天室' : '暂无聊天室'));
    for (const room of rooms) {
      const row = el('div', 'chat-room');
      row.dataset.active = String(selected === room.roomId);
      const select = el('button', 'chat-room-select');
      select.type = 'button';
      select.title = `打开 ${room.roomId}`;
      select.append(el('strong', '', roomName(room.roomId)), el('small', '', room.loaded ? `${room.messages.length} 条消息${room.messages.at(-1) ? ` · ${room.messages.at(-1)!.time}` : ''}` : room.createdTime ? new Date(room.createdTime * 1000).toLocaleString() : '…'));
      select.onclick = () => { selected = room.roomId; showNonformat = false; render(); if (mode === 'online') void loadRoom(room.roomId); };
      const edit = el('button', 'chat-rename', '✎');
      edit.type = 'button'; edit.title = '重命名聊天室'; edit.setAttribute('aria-label', `重命名 ${room.roomId}`);
      edit.onclick = () => rename('room', room.roomId);
      row.append(select, edit); roomsNode.append(row);
    }
    view.replaceChildren();
    const room = rooms.find((item) => item.roomId === selected);
    if (!room) { view.append(state('请选择聊天室')); return; }
    const header = el('header', 'chat-view-header');
    const title = el('div'); title.append(el('h2', '', roomName(room.roomId)), el('p', '', `房间 ID：${room.roomId}`)); header.append(title);
    const count = room.nonformat.reduce((n, block) => n + block.lines.length, 0);
    if (count) {
      const toggle = el('button', 'chat-action', `未识别记录 (${count})`);
      toggle.type = 'button'; toggle.setAttribute('aria-pressed', String(showNonformat));
      toggle.onclick = () => { showNonformat = !showNonformat; render(); };
      header.append(toggle);
    }
    view.append(header);
    if (loadingRoom === room.roomId && !room.loaded) { view.append(state('正在加载消息…')); return; }
    if (room.failed) view.append(state('加载聊天室失败，请刷新重试'));
    else if (!room.messages.length) view.append(state('暂无消息'));
    else {
      const messages = el('div', 'chat-messages');
      const users = [...new Set(room.messages.map((message) => message.user))];
      for (const message of room.messages) {
        const index = users.indexOf(message.user);
        const article = el('article', 'chat-msg');
        const head = el('div', 'chat-msg-head');
        const who = el('button', '', userName(message.user)); who.type = 'button'; who.title = '重命名用户'; who.onclick = () => rename('user', message.user);
        head.append(who, el('time', '', message.time));
        const bubble = el('div', 'chat-bubble'); bubble.style.background = COLORS[index % COLORS.length]; bubble.style.borderColor = STRIPS[index % STRIPS.length];
        if (message.replyRef) bubble.append(el('div', 'chat-reply', `↩ ${userName(message.replyRef.user)}：${message.replyRef.text.slice(0, 60)}${message.replyRef.text.length > 60 ? '…' : ''}`));
        const body = el('div');
        const url = /https?:\/\/[^\s)]+/g;
        let cursor = 0;
        for (const match of message.content.matchAll(url)) {
          const index = match.index ?? 0;
          body.append(document.createTextNode(message.content.slice(cursor, index)));
          const link = el('a', '', match[0]); link.href = match[0]; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link);
          cursor = index + match[0].length;
        }
        body.append(document.createTextNode(message.content.slice(cursor)));
        bubble.append(body); article.append(head, bubble); messages.append(article);
      }
      view.append(messages);
    }
    if (room.truncated) view.append(el('div', 'chat-state', '部分文本超出读取上限，仅展示已读取的内容。'));
    if (showNonformat && count) {
      const section = el('section', 'chat-nonformat'); section.append(el('h3', '', '未识别记录'));
      for (const block of room.nonformat) {
        section.append(el('p', '', block.file));
        for (const line of block.lines) section.append(el('code', '', line));
      }
      view.append(section);
    }
    const footer = el('footer', 'chat-attachments'); footer.append(el('strong', '', '附件'));
    if (!room.attachments.length) footer.append(el('span', '', '暂无附件'));
    for (const attachment of room.attachments) {
      const button = el('button', '', `${attachment.kind === 'image' ? '▧' : attachment.kind === 'audio' ? '♫' : '↧'} ${attachment.name}`);
      button.type = 'button'; button.title = attachment.path ? '打开本地附件' : '下载在线附件';
      button.onclick = () => { void attachmentAction(attachment); };
      footer.append(button);
    }
    view.append(footer);
  }
  controls('online').onclick = () => { if (mode === 'online') return; mode = 'online'; void save('mode', mode); void refresh(); };
  controls('local').onclick = () => { if (mode === 'local') return; mode = 'local'; void save('mode', mode); void refresh(); };
  for (const which of ['runtime','echo'] as const) controls(which).onclick = () => { if (source === which) return; source = which; void save('source', source); if (mode === 'online') void refresh(); else render(); };
  controls('refresh').onclick = () => { void refresh(); };
  controls('folder').onclick = async () => {
    try {
      const picked = await host.call<string | { path?: string | null } | null>('local.folder.choose', { title: '选择聊天记录文件夹' });
      const path = typeof picked === 'string' ? picked : picked?.path;
      if (path) { localPath = path; void save('localPath', path); await refresh(); }
    } catch (reason) { errorMessage = `无法选择文件夹：${errorText(reason)}`; render(); }
  };
  try {
    const values = await Promise.all(['mode','source','localPath','roomNames','userNames'].map(read));
    mode = values[0] === 'local' ? 'local' : 'online';
    source = values[1] === 'echo' ? 'echo' : 'runtime';
    localPath = values[2] ?? '';
    roomNames = safeNames(values[3]);
    userNames = safeNames(values[4]);
  } catch (reason) { errorMessage = `无法读取设置：${errorText(reason)}`; }
  render();
  if (mode === 'online' || localPath) void refresh();
}
// The host evaluates the bundle inside new Function(root, pluginId, host, code).
// Some hosts also call ComExtPlugin.mount; mount is idempotent for either path.
declare const root: ShadowRoot | undefined;
declare const pluginId: string | undefined;
declare const host: PluginHost | undefined;
if (typeof root !== 'undefined' && root && typeof root.querySelector === 'function' &&
    typeof host !== 'undefined' && host && typeof host.call === 'function') {
  mount(root, typeof pluginId === 'string' ? pluginId : 'org.cfms.chat', host);
}
