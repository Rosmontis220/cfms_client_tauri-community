// Parsing and sorting shared by the online and local chat viewers.
export interface ChatMessage {
  user: string;
  time: string;
  content: string;
  replyRef: { user: string; text: string } | null;
}
export interface NonformatBlock { file: string; lines: string[] }
export interface Attachment { id: string; name: string; kind: 'image' | 'audio' | 'other'; path?: string }
export interface Room {
  id: string;
  roomId: string;
  createdTime: number | null;
  messages: ChatMessage[];
  attachments: Attachment[];
  nonformat: NonformatBlock[];
  loaded: boolean;
  failed?: boolean;
  truncated?: boolean;
}
const REPLY_PATTERN = /\s*\/\/\s*(\w{7})\s*->\s*(.*)$/s;
export function parseRoomText(user: string, text: string): { messages: ChatMessage[]; nonformat: string[] } {
  const messages: ChatMessage[] = [];
  const nonformat: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '# time | msg') continue;
    if (line.startsWith('#') || !line.includes(' | ')) { nonformat.push(line); continue; }
    const separator = line.indexOf(' | ');
    const time = line.slice(0, separator);
    let content = line.slice(separator + 3);
    const match = REPLY_PATTERN.exec(content);
    const replyRef = match ? { user: match[1], text: match[2].trim() } : null;
    if (match) content = content.slice(0, match.index);
    messages.push({ user, time, content, replyRef });
  }
  messages.sort((a, b) => a.time.localeCompare(b.time));
  return { messages, nonformat };
}
export function attachmentKind(name: string): Attachment['kind'] {
  const extension = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension ?? '')) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(extension ?? '')) return 'audio';
  return 'other';
}
export function combineRoomFiles(room: Room, files: { name: string; id?: string; path?: string; kind?: string; content?: string | null; truncated?: boolean }[]): Room {
  const messages: ChatMessage[] = [];
  const nonformat: NonformatBlock[] = [];
  const attachments: Attachment[] = [];
  let truncated = false;
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.txt')) {
      if (file.content === null || file.content === undefined) continue;
      const parsed = parseRoomText(file.name.slice(0, -4), file.content);
      messages.push(...parsed.messages);
      if (parsed.nonformat.length && parsed.messages.length) nonformat.push({ file: file.name, lines: parsed.nonformat });
      truncated ||= !!file.truncated;
    } else {
      attachments.push({ name: file.name, id: file.id ?? '', path: file.path, kind: attachmentKind(file.name) });
    }
  }
  messages.sort((a, b) => a.time.localeCompare(b.time));
  return { ...room, messages, nonformat, attachments, loaded: true, truncated };
}
