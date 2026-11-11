import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HANDOFF_CHAR_LIMIT, HANDOFF_HEADER, HANDOFF_MESSAGE_LIMIT, TURN_ENTRY_TYPE, createLegacyHistory, handoffNote } from './session-owner.mjs';

function scratchHistory(root = mkdtempSync(join(tmpdir(), 'beeftv-legacy-history-'))) {
  const legacy = createLegacyHistory({ sessionRoot: join(root, 'sessions'), workspaceRoot: join(root, 'workspace') });
  return { root, legacy };
}

function writeLegacySession(legacy, canvasId, sessionId, messages = []) {
  const cwd = legacy.canvasWorkspace(canvasId);
  mkdirSync(cwd, { recursive: true });
  const sessionDir = legacy.canvasSessionDir(canvasId);
  const timestamp = '2026-10-07T12:00:00.000Z';
  const file = join(sessionDir, `2026-10-07T12-00-00-000Z_${sessionId}.jsonl`);
  const rows = [{ type: 'session', version: 3, id: sessionId, timestamp, cwd }];
  let parentId = null;
  let index = 0;
  for (const message of messages) {
    const id = `entry-${index++}`;
    rows.push({ type: 'message', id, parentId, timestamp,
      message: { role: message.role, content: [{ type: 'text', text: message.text }], timestamp: 1791374400000 + index } });
    parentId = id;
  }
  if (messages.length > 0) {
    rows.push({ type: 'custom', id: 'turn-old', parentId, timestamp, customType: TURN_ENTRY_TYPE,
      data: { turnId: 'turn-legacy', userText: messages[0].text, reply: 'old receipt', toolCalls: [], proposals: [], error: null, cancelled: false, createdAt: timestamp } });
  }
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

describe('Old JSONL session read-only history', () => {
  test('Read user messages and BeefTV rounds from JSONL v3 before upgrade without changing session identity', () => {
    const { root, legacy } = scratchHistory();
    try {
      const canvasId = 'legacy-v3';
      const sessionId = 'legacy-pi-0871-session';
      writeLegacySession(legacy, canvasId, sessionId, [{ role: 'user', text: 'Original words from old conversation' }, { role: 'assistant', text: 'old receipt' }]);
      legacy.writeCurrentSessionId(canvasId, sessionId);
      expect(legacy.readCurrentSessionId(canvasId)).toBe(sessionId);
      const opened = legacy.openLegacySession(canvasId, sessionId);
      expect(opened.manager.getSessionId()).toBe(sessionId);
      expect(legacy.turnEntries(opened.manager)[0].reply).toBe('old receipt');
      expect(opened.manager.buildSessionContext().messages[0].content[0].text).toBe('Original words from old conversation');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('openLegacySession throws session_not_found when the session cannot be found.', () => {
    const { root, legacy } = scratchHistory();
    try {
      expect(() => legacy.openLegacySession('missing-canvas', 'no-such-session')).toThrow(/session_not_found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('When current.json is a directory, session_pointer_failed is thrown when reading', () => {
    const { root, legacy } = scratchHistory();
    try {
      mkdirSync(legacy.currentSessionPointerPath('bad-pointer'), { recursive: true });
      expect(() => legacy.readCurrentSessionId('bad-pointer')).toThrow(/当前会话指针无法读取/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('When the content of current.json is damaged, session_pointer_failed is thrown when reading.', () => {
    const { root, legacy } = scratchHistory();
    try {
      writeFileSync(legacy.currentSessionPointerPath('bad-json'), '{');
      expect(() => legacy.readCurrentSessionId('bad-json')).toThrow(/当前会话指针内容无效/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('listCanvasSessions lists the titles and turns of old sessions', async () => {
    const { root, legacy } = scratchHistory();
    try {
      writeLegacySession(legacy, 'list-canvas', 'legacy-list-session', [{ role: 'user', text: 'list title' }, { role: 'assistant', text: 'return receipt' }]);
      const list = await legacy.listCanvasSessions('list-canvas');
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe('legacy-list-session');
      expect(list[0].title).toBe('list title');
      expect(list[0].turnCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('deleteSession deletes the old session file and cleans current.json, and throws session_not_found when it is not found.', async () => {
    const { root, legacy } = scratchHistory();
    try {
      writeLegacySession(legacy, 'delete-canvas', 'legacy-del-session', [{ role: 'user', text: 'Conversation to be deleted' }, { role: 'assistant', text: 'return receipt' }]);
      legacy.writeCurrentSessionId('delete-canvas', 'legacy-del-session');
      const result = legacy.deleteSession('delete-canvas', 'legacy-del-session');
      expect(result.deleted).toBe(true);
      expect(result.sessionId).toBe('legacy-del-session');
      expect(legacy.readCurrentSessionId('delete-canvas')).toBe('');
      expect(await legacy.listCanvasSessions('delete-canvas')).toHaveLength(0);
      expect(() => legacy.deleteSession('delete-canvas', 'legacy-del-session')).toThrow(/session_not_found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Old Session → Durable Handover Instructions', () => {
  test('readHandoffNote contains the most recent user/assistant text from the old session', () => {
    const { root, legacy } = scratchHistory();
    try {
      writeLegacySession(legacy, 'handoff-canvas', 'legacy-handoff-session', [
        { role: 'user', text: 'The first original sentence of the old conversation' },
        { role: 'assistant', text: 'First receipt from old conversation' },
      ]);
      const note = legacy.readHandoffNote('handoff-canvas', 'legacy-handoff-session');
      expect(note.startsWith(HANDOFF_HEADER)).toBe(true);
      expect(note).toContain('User: the first original sentence of the old conversation');
      expect(note).toContain('Assistant: First receipt for old conversation');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('readHandoffNote returns an empty note when the old session cannot be found', () => {
    const { root, legacy } = scratchHistory();
    try {
      expect(legacy.readHandoffNote('no-canvas', 'no-session')).toBe('');
      expect(legacy.readHandoffNote('no-canvas', '')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('handoffNote only keeps the latest 20 messages', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `No.${index}items` }));
    const note = handoffNote(messages);
    expect(note).toContain('Article 29');
    expect(note).toContain('Article 10');
    expect(note).not.toContain('Article 9');
    const lines = note.split('\n').slice(1);
    expect(lines).toHaveLength(HANDOFF_MESSAGE_LIMIT);
  });

  test('The total length of handoffNote is truncated to approximately 8000 characters and the latest content is retained.', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `${index}`.padEnd(900, 'x') }));
    const note = handoffNote(messages);
    const body = note.split('\n').slice(1).join('\n');
    expect(body.length).toBeLessThanOrEqual(HANDOFF_CHAR_LIMIT);
    expect(note).toContain('19');
    expect(note).not.toContain('0' + 'x'.repeat(800));
  });

  test('When a single message exceeds the limit, it will be truncated and not discarded as a whole.', () => {
    const note = handoffNote([{ role: 'user', text: 'y'.repeat(20000) }]);
    const body = note.split('\n').slice(1).join('\n');
    expect(body.length).toBeLessThanOrEqual(HANDOFF_CHAR_LIMIT);
    expect(body.startsWith('User:yyy')).toBe(true);
  });

  test('Handover instructions are not generated without user/assistant text', () => {
    expect(handoffNote([])).toBe('');
    expect(handoffNote([{ role: 'user', text: '' }])).toBe('');
  });
});
