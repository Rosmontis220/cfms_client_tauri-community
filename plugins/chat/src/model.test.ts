import { describe, expect, it } from 'vitest';
import { combineRoomFiles, parseRoomText, type Room } from './model';

const emptyRoom = (): Room => ({ id: 'directory-id', roomId: 'room-folder', createdTime: null, messages: [], attachments: [], nonformat: [], loaded: false });

describe('chat records', () => {
  it('parses timestamps and reply references while retaining unrecognized lines', () => {
    const parsed = parseRoomText('abc1234', '# time | msg\n2026-01-03 | later // def5678 -> old reply\n# note\n2026-01-01 | earlier\nunsupported');
    expect(parsed.messages).toEqual([
      { user: 'abc1234', time: '2026-01-01', content: 'earlier', replyRef: null },
      { user: 'abc1234', time: '2026-01-03', content: 'later', replyRef: { user: 'def5678', text: 'old reply' } },
    ]);
    expect(parsed.nonformat).toEqual(['# note', 'unsupported']);
  });
  it('combines local and online record shapes and preserves attachment paths', () => {
    const result = combineRoomFiles(emptyRoom(), [
      { name: 'user.txt', content: '# time | msg\n2026-01-01 | hello', truncated: true },
      { name: 'clip.MP3', path: 'C:/chat/clip.MP3' },
      { name: 'picture.PNG', id: 'server-document' },
    ]);
    expect(result.loaded).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.attachments).toEqual([
      { id: '', name: 'clip.MP3', kind: 'audio', path: 'C:/chat/clip.MP3' },
      { id: 'server-document', name: 'picture.PNG', kind: 'image', path: undefined },
    ]);
  });
});
